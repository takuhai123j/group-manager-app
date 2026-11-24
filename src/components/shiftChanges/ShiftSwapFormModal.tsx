'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Save, Trash2, AlertTriangle, CalendarCheck, CalendarOff, Info, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildCalendarCandidates, targetKey, parseTargetKey, sameTarget } from '@/lib/shiftChangeCalendar'
import { shiftSwapService, shiftSwapErrorMessage, shiftSwapErrorCode } from '@/services/shiftSwapService'
import { formatFullDateWeek, formatMonthDayWeek } from '@/lib/shiftSwapMail'
import { getEventTypeConfig, isShiftSwapEventType } from '@/constants/eventTypes'
import type {
  Facility, GroupManager, MeetingAssigneeRef, ScheduleEvent, ShiftSwap, ShiftSwapInput, ShiftSwapNotifyResult, StaffMember,
} from '@/lib/types'

// 勤務・休日振替（振替出勤・振替休日）の登録・編集・取消。2日分を1件として扱う。
//   振替出勤日: 休み → 勤務（例: 既に予定されているMTへの急な出席・本部業務・研修など）。休日出勤（割増のある勤務）とは別の区分
//   MT（MT管理・MT同時開催）とは連動しない。勤務内容は自由入力
//   振替休日  : 勤務日（例: フリー＝施設勤務のない勤務日）→ 休み。振休（代替出勤者の休み）とは別の区分
// 対象者はG長・主任・スタッフのマスタから選ぶ（名前では照合しない）。カレンダーに表示するかは別に選ぶ
interface Props {
  isOpen: boolean
  swapId: string | null          // 編集する振替（新規は null）
  facilities: Facility[]
  managers: GroupManager[]
  staffMembers: StaffMember[]
  events: ScheduleEvent[]        // カレンダーの全予定（公休の非表示・予定の重なりの確認に使う。非表示にする前のもの）
  onClose: () => void
  onChanged: () => Promise<void> | void   // 保存・取消のあと（一覧・カレンダーを読み直す）
}

const GROUP_ORDER = ['G長・主任', 'リーダー', 'ラウンダー', '現場社員']
const DEFAULT_WORK_ORIGINAL = '休み'
const DEFAULT_OFF_ORIGINAL = 'フリー（施設勤務なし）'

const personKeyOf = (e: ScheduleEvent) => e.staffMemberId ?? (e.groupLeaderId || null)
const isManualKyukyu = (e: ScheduleEvent) => e.type === 'kyukyu' && !e.shiftChangeRecordId
const timeText = (e: ScheduleEvent) => (e.isAllDay ? '終日' : `${e.startTime}〜${e.endTime}`)

// ── 予定の重なりの警告（登録は止めない。既存の予定は変更・削除しない） ──
// 確認できるのは、このアプリのカレンダーに登録されている本人の予定だけ（施設の通常勤務や、担当でないMTへの出席は分からない）
type WarnKind = 'kyukyu' | 'kyukyu_kept' | 'mt' | 'activity' | 'shift_change' | 'swap' | 'other'
const WARN_TEXT: Record<WarnKind, string> = {
  kyukyu: 'この日は既に公休です。振替休日の日付を確認してください',
  kyukyu_kept: 'この日の公休を非表示にしていません。振替出勤と公休が重なって表示されます',
  mt: 'この日はMTの予定があります。出席・代理対応を確認してください',
  activity: 'この日に別の予定があります。予定の変更・取消が必要か確認してください',
  shift_change: 'この日にシフト変更の記録があります。内容に矛盾がないか確認してください',
  swap: 'この日には別の勤務・休日振替が登録されています（同じ日に2件は登録できません）',
  other: 'この日に別の予定があります。内容を確認してください',
}
// 巡回・会議などの業務の予定
const ACTIVITY_TYPES = ['patrol', 'meeting', 'interview', 'job_interview', 'office', 'vacancy', 'trouble', 'holiday_work']
const WARN_ORDER: WarnKind[] = ['swap', 'kyukyu', 'kyukyu_kept', 'mt', 'shift_change', 'activity', 'other']
type DayWarning = { kind: WarnKind; events: ScheduleEvent[] }

function warnKindOf(e: ScheduleEvent): WarnKind {
  if (isShiftSwapEventType(e.type)) return 'swap'
  if (e.shiftChangeRecordId || e.type === 'shift_change') return 'shift_change'
  if (e.type === 'kyukyu') return 'kyukyu'
  if (e.type === 'mt') return 'mt'
  if (ACTIVITY_TYPES.includes(e.type)) return 'activity'
  return 'other'
}
function groupWarnings(list: { kind: WarnKind; e: ScheduleEvent }[]): DayWarning[] {
  return WARN_ORDER
    .map(kind => ({ kind, events: list.filter(x => x.kind === kind).map(x => x.e) }))
    .filter(w => w.events.length > 0)
}
function eventText(e: ScheduleEvent): string {
  const label = getEventTypeConfig(e.type).label
  const title = e.title?.trim()
  return `${label}${title && title !== label ? `「${title}」` : ''} ${timeText(e)}`
}

// 日付欄のすぐ下・確認画面に出す警告の枠
function DayWarnings({ warnings, testId }: { warnings: DayWarning[]; testId: string }) {
  if (warnings.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 space-y-1.5" role="note" data-testid={testId}>
      {warnings.map(w => (
        <div key={w.kind} className="text-xs text-amber-900" data-warn-kind={w.kind}>
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5 text-amber-600" />{WARN_TEXT[w.kind]}
          </p>
          <ul className="ml-5 mt-0.5 list-disc space-y-0.5 text-amber-800">
            {w.events.map(e => <li key={e.id} className="break-words">{eventText(e)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}

function workDetailText(original: string, content: string): string {
  return `${original.trim() || DEFAULT_WORK_ORIGINAL} → ${content.trim() || '勤務'}（振替出勤）`
}
function offDetailText(original: string): string {
  return `${original.trim() || DEFAULT_OFF_ORIGINAL} → 休み（振替休日）`
}

type FormState = {
  personKey: string           // 'group_manager:<id>' / 'staff_member:<id>'
  showOnCalendar: boolean
  workDate: string
  workOriginal: string
  workContent: string
  workFacilityId: string      // '' = 施設勤務なし
  offDate: string
  offOriginal: string
  offFacilityId: string
  reason: string
  handledBy: string
  memo: string
}

const EMPTY_FORM: FormState = {
  personKey: '', showOnCalendar: true,
  workDate: '', workOriginal: DEFAULT_WORK_ORIGINAL, workContent: '', workFacilityId: '',
  offDate: '', offOriginal: DEFAULT_OFF_ORIGINAL, offFacilityId: '',
  reason: '', handledBy: '', memo: '',
}

// 通知 API の結果を画面の文言にする
function notifyMessage(kind: '登録' | '変更' | '取消', st: ShiftSwapNotifyResult): { kind: 'success' | 'warning'; message: string } {
  const action = kind === '取消' ? '取り消' : kind
  if (st === 'sent') return { kind: 'success', message: `振替を${action}し、本部へ通知メールを送信しました` }
  if (st === 'sending') return { kind: 'warning', message: `振替を${action}しました。通知メールは送信中です（シフト変更記録の「本部への通知」で状態を確認できます）` }
  if (st === 'needs_check') return { kind: 'warning', message: `振替を${action}しました。通知メールは要確認です（本部に届いているか確認してください。シフト変更記録の「本部への通知」から片付けられます）` }
  return { kind: 'warning', message: `振替は${action}しましたが、通知メールをまだ送れていません。シフト変更記録の「本部への通知」から再送できます（送信済みのものは二重に送られません）` }
}

export function ShiftSwapFormModal({ isOpen, swapId, facilities, managers, staffMembers, events, onClose, onChanged }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [editing, setEditing] = useState<ShiftSwap | null>(null)
  const [loadingSwap, setLoadingSwap] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [done, setDone] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null)
  // 操作ID（登録・変更・取消の1回ごと）。応答が失われて同じ内容で送り直すときは同じIDを使い、内容を変えたら新しくする
  const saveOpRef = useRef<{ id: string; payload: string } | null>(null)
  const cancelOpRef = useRef<{ id: string; swapId: string; updatedAt: string } | null>(null)
  // 新規の振替ID（画面を開いたときに1回だけ発行。応答が失われて送り直しても二重にならない）
  const newIdRef = useRef<string>('')
  // 公休の非表示の初期選択を自動で決めるか（編集で開いた直後は保存済みの選択を保つ）
  const autoHiddenRef = useRef(true)

  // ── 開いたとき: 新規は空のフォーム、編集は振替を読み込む ──
  useEffect(() => {
    if (!isOpen) return
    setError(null); setShowConfirm(false); setConfirmDelete(false); setDone(null); setSaving(false)
    saveOpRef.current = null; cancelOpRef.current = null
    if (!swapId) {
      newIdRef.current = crypto.randomUUID()
      setEditing(null); setForm(EMPTY_FORM); setHiddenIds([]); autoHiddenRef.current = true
      return
    }
    let cancelled = false
    setEditing(null); setForm(EMPTY_FORM); setHiddenIds([]); autoHiddenRef.current = true
    setLoadingSwap(true)
    shiftSwapService.getById(swapId)
      .then(s => {
        if (cancelled) return
        setEditing(s)
        autoHiddenRef.current = false
        setHiddenIds(s.hiddenScheduleIds)
        setForm({
          personKey: targetKey(s.person), showOnCalendar: s.showOnCalendar,
          workDate: s.work.date, workOriginal: s.work.originalShift, workContent: s.workContent,
          workFacilityId: s.work.facilityId ?? '',
          offDate: s.off.date, offOriginal: s.off.originalShift, offFacilityId: s.off.facilityId ?? '',
          reason: s.reason, handledBy: s.handledBy, memo: s.memo,
        })
      })
      .catch(e => { if (!cancelled) setError(shiftSwapErrorMessage(e, '振替を読み込めませんでした（取り消された可能性があります）')) })
      .finally(() => { if (!cancelled) setLoadingSwap(false) })
    return () => { cancelled = true }
  }, [isOpen, swapId])

  const person = parseTargetKey(form.personKey)
  const personId = person?.id ?? null

  // 対象者の候補（有効な人。編集中の振替の対象者は無効化済みでも残す）
  const candidates = useMemo(
    () => buildCalendarCandidates(managers, staffMembers, editing ? [editing.person] : []),
    [managers, staffMembers, editing],
  )
  const groups = GROUP_ORDER
    .map(label => ({ label, people: candidates.filter(c => c.groupLabel === label) }))
    .filter(g => g.people.length > 0)
  const selectedPerson = person ? candidates.find(c => sameTarget(c, person)) ?? null : null

  // 振替出勤日の本人の手動の公休（非表示にできるのはこれだけ）
  const kyukyuOnWorkDay = useMemo(
    () => (personId && form.workDate
      ? events.filter(e => isManualKyukyu(e) && e.date === form.workDate && personKeyOf(e) === personId)
      : []),
    [events, personId, form.workDate],
  )
  // 対象者・振替出勤日が変わったら、公休が1件だけのときに非表示を初期ONにする（複数なら本人が選ぶ）
  useEffect(() => {
    if (!isOpen) return
    if (!autoHiddenRef.current) { autoHiddenRef.current = true; return }
    setHiddenIds(kyukyuOnWorkDay.length === 1 ? [kyukyuOnWorkDay[0].id] : [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, personId, form.workDate])

  if (!isOpen) return null

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => ({ ...prev, [key]: value }))
  const facilityName = (id: string) => facilities.find(f => f.id === id)?.name ?? ''
  const activeFacilities = facilities.filter(f => f.active || f.id === form.workFacilityId || f.id === form.offFacilityId)
  // ── 警告（保存は止めない）。日付ごとに、本人の予定の種類に応じた案内を出す ──
  const isOwnSwapEvent = (e: ScheduleEvent) => !!(editing && e.shiftChangeRecordId && [editing.work.recordId, editing.off.recordId].includes(e.shiftChangeRecordId))
  // 振替出勤日: 非表示にする公休とこの振替の自動予定は除く。残した公休は「重なって表示される」案内（カレンダーに出すときだけ）
  const otherOnWorkDay = personId && form.workDate
    ? events.filter(e => e.date === form.workDate && personKeyOf(e) === personId && !hiddenIds.includes(e.id) && !isOwnSwapEvent(e))
    : []
  const workWarnings = groupWarnings(otherOnWorkDay
    .filter(e => !isManualKyukyu(e) || form.showOnCalendar)
    .map(e => ({ kind: isManualKyukyu(e) ? 'kyukyu_kept' as const : warnKindOf(e), e })))
  // 振替休日: この振替の自動予定は除く
  const otherOnOffDay = personId && form.offDate
    ? events.filter(e => e.date === form.offDate && personKeyOf(e) === personId && !isOwnSwapEvent(e))
    : []
  const offWarnings = groupWarnings(otherOnOffDay.map(e => ({ kind: warnKindOf(e), e })))
  // ── 入力の確認 ──
  const validate = (): string | null => {
    if (!person) return '対象者を選んでください'
    if (!form.workDate) return '振替出勤日を入力してください'
    if (!form.offDate) return '振替休日を入力してください'
    if (form.workDate === form.offDate) return '振替出勤日と振替休日は別の日にしてください'
    if (!form.workContent.trim()) return '振替出勤日の勤務内容を入力してください（例：MT出席・本部業務・研修）'
    if (form.workContent.trim().length > 100) return '勤務内容は100文字以内にしてください'
    if (!form.reason.trim()) return '理由を入力してください'
    if (!form.handledBy.trim()) return '入力者を入力してください'
    return null
  }

  const buildInput = (): ShiftSwapInput => ({
    id: editing ? editing.id : newIdRef.current,
    mode: editing ? 'update' : 'create',
    expectedUpdatedAt: editing?.updatedAt,
    person: person as MeetingAssigneeRef,
    showOnCalendar: form.showOnCalendar,
    workContent: form.workContent.trim(),
    reason: form.reason.trim(),
    handledBy: form.handledBy.trim(),
    memo: form.memo,
    work: { date: form.workDate, facilityId: form.workFacilityId || null, originalShift: form.workOriginal.trim(), changeDetail: workDetailText(form.workOriginal, form.workContent) },
    off: { date: form.offDate, facilityId: form.offFacilityId || null, originalShift: form.offOriginal.trim(), changeDetail: offDetailText(form.offOriginal) },
    hiddenScheduleIds: form.showOnCalendar ? hiddenIds : [],
  })

  // 編集で、保存済みの内容から何も変えていないか（変えていなければ保存も通知もしない）
  const isUnchanged = (inp: ShiftSwapInput): boolean => {
    if (!editing) return false
    const norm = (x: Pick<ShiftSwapInput, 'person' | 'showOnCalendar' | 'workContent' | 'reason' | 'handledBy' | 'memo' | 'work' | 'off' | 'hiddenScheduleIds'>) => JSON.stringify([
      targetKey(x.person), x.showOnCalendar, x.workContent.trim(), x.reason.trim(), x.handledBy.trim(), x.memo,
      [x.work.date, x.work.facilityId || null, x.work.originalShift.trim(), x.work.changeDetail.trim()],
      [x.off.date, x.off.facilityId || null, x.off.originalShift.trim(), x.off.changeDetail.trim()],
      Array.from(new Set(x.hiddenScheduleIds)).sort(),
    ])
    return norm(inp) === norm(editing)
  }

  const handleConfirm = () => {
    const v = validate()
    if (v) { setError(v); return }
    if (isUnchanged(buildInput())) { setError('変更点がありません（保存・通知は不要です）'); return }
    setError(null)
    setShowConfirm(true)
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    const before = editing
    const input = buildInput()
    const payload = JSON.stringify(input)
    if (!saveOpRef.current || saveOpRef.current.payload !== payload) saveOpRef.current = { id: crypto.randomUUID(), payload }
    const opId = saveOpRef.current.id
    try {
      const { swap: saved } = await shiftSwapService.save(input, opId)
      saveOpRef.current = null
      setEditing(saved)
      await onChanged()
      // 本部への通知は操作IDだけを渡す（文面はサーバーが DB の内容から作る。送信済みなら送らない）
      const st = await shiftSwapService.notify(opId)
      setShowConfirm(false)
      setDone(notifyMessage(before ? '変更' : '登録', st))
      await onChanged()
    } catch (e) {
      setShowConfirm(false)
      setError(shiftSwapErrorMessage(e, '保存を確認できませんでした。もう一度「確認」から保存してください（同じ内容なら二重に登録・通知されません）'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editing) return
    setSaving(true); setError(null)
    const c = cancelOpRef.current
    if (!c || c.swapId !== editing.id || c.updatedAt !== editing.updatedAt) {
      cancelOpRef.current = { id: crypto.randomUUID(), swapId: editing.id, updatedAt: editing.updatedAt }
    }
    const opId = (cancelOpRef.current as { id: string }).id
    try {
      await shiftSwapService.remove(editing.id, editing.updatedAt, opId)
      cancelOpRef.current = null
      await onChanged()
      const st = await shiftSwapService.notify(opId)
      setConfirmDelete(false)
      setDone(notifyMessage('取消', st))
      await onChanged()
    } catch (e) {
      setConfirmDelete(false)
      const code = shiftSwapErrorCode(e)
      if (code === 'SCC_NOT_FOUND') {
        // 別の操作（他の端末など）で取り消し済み。この画面の取消は成功していないので、ここからは通知しない
        await onChanged()
        setDone({ kind: 'warning', message: 'この振替は既に取り消されています（他の端末などで取り消した操作の通知は、シフト変更記録の「本部への通知」で確認できます）' })
      } else {
        setError(shiftSwapErrorMessage(e, '取消を確認できませんでした。もう一度「取消」を押してください（同じ取消なら二重に処理・通知されません）'))
      }
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1'
  const req = <span className="text-red-500">*</span>
  const input = (() => { try { return buildInput() } catch { return null } })()

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" data-testid="shift-swap-form">
      <div className="relative bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col">

        {/* ── 確認画面 ── */}
        {showConfirm && input && (
          <div className="absolute inset-0 z-10 bg-white sm:rounded-2xl rounded-t-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-800">振替の{editing ? '変更' : '登録'}内容の確認</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-sm">
              <div className="space-y-1 text-gray-700">
                <div><span className="font-medium text-gray-500">対象者：</span>{selectedPerson?.name ?? ''}（{selectedPerson?.groupLabel ?? ''}）</div>
                <div><span className="font-medium text-gray-500">理由：</span>{input.reason}</div>
                <div><span className="font-medium text-gray-500">入力者：</span>{input.handledBy}</div>
                {input.memo && <div><span className="font-medium text-gray-500">メモ：</span>{input.memo}</div>}
              </div>
              <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 space-y-0.5">
                <p className="font-semibold text-green-900">振替出勤日 {formatFullDateWeek(input.work.date)}</p>
                <p className="text-green-900">{input.work.changeDetail}</p>
                <p className="text-xs text-green-800">施設：{input.work.facilityId ? facilityName(input.work.facilityId) : 'なし（施設勤務なし）'}</p>
              </div>
              <DayWarnings warnings={workWarnings} testId="swap-confirm-warnings-work" />
              <div className="rounded-lg border border-pink-300 bg-pink-50 px-3 py-2 space-y-0.5">
                <p className="font-semibold text-pink-900">振替休日 {formatFullDateWeek(input.off.date)}</p>
                <p className="text-pink-900">{input.off.changeDetail}</p>
                <p className="text-xs text-pink-800">施設：{input.off.facilityId ? facilityName(input.off.facilityId) : 'なし（施設勤務なし）'}</p>
              </div>
              <DayWarnings warnings={offWarnings} testId="swap-confirm-warnings-off" />
              {input.showOnCalendar ? (
                <p className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                  {selectedPerson?.name}のカレンダーに「振替出勤」「振替休日」を終日で表示します。
                  {input.hiddenScheduleIds.length > 0 && ` ${formatMonthDayWeek(input.work.date)}の公休${input.hiddenScheduleIds.length}件はカレンダーで非表示にします（公休の予定そのものは削除しません）。`}
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2" data-testid="swap-no-calendar-warning">
                  <CalendarOff size={13} className="flex-shrink-0 mt-0.5" />
                  カレンダーに表示しない設定です。この振替はカレンダーには表示されません（シフト変更記録の一覧と通知メールには残ります）。
                </p>
              )}
              <p className="text-xs text-gray-500">
                予定の重なりは、このアプリに登録されている本人の予定だけで確認しています（施設の通常勤務や、担当になっていないMTへの出席は確認できません）。
              </p>
              <p className="text-xs text-gray-500">保存すると、本部（シフト変更の通知先）へ通知メールを送ります。</p>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowConfirm(false)} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">戻る</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />{saving ? '保存中…' : editing ? '変更を保存' : '登録'}
              </button>
            </div>
          </div>
        )}

        {/* ── ヘッダー ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-gray-800">
            <ArrowLeftRight size={16} className="text-green-700" />
            勤務・休日振替{done ? '' : editing ? 'の編集' : 'の登録'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        {/* ── ボディ ── */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {loadingSwap ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : done ? (
            <p className={cn('text-sm rounded-lg px-3 py-2 border',
              done.kind === 'success' ? 'text-green-700 bg-green-50 border-green-200' : 'text-amber-700 bg-amber-50 border-amber-200')} role="status">
              {done.message}
            </p>
          ) : null}
          {loadingSwap || done ? null : (
            <>
              <p className="flex items-start gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <Info size={13} className="flex-shrink-0 mt-0.5" />
                公休日に急きょ出勤し（例：既に予定されているMTへの出席・本部業務・研修）、別の勤務日を休日にする申請です（他の人との交代はありません）。「休日出勤」「振休」とは別の区分として記録し、2日分を1件として登録・変更・取消します。
              </p>

              {/* 対象者 */}
              <div>
                <label className={labelCls}>対象者 {req}</label>
                <select value={form.personKey} onChange={e => set('personKey', e.target.value)} className={inputCls} data-testid="swap-person">
                  <option value="">選択してください</option>
                  {groups.map(g => (
                    <optgroup key={g.label} label={g.label}>
                      {g.people.map(c => <option key={targetKey(c)} value={targetKey(c)}>{c.name}{c.active ? '' : '（無効化済み）'}</option>)}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">G長・主任とスタッフ（リーダー・ラウンダー・現場社員）の一覧から選びます。一覧にいない人は、先にスタッフとして登録してください。</p>
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={form.showOnCalendar} onChange={e => set('showOnCalendar', e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-indigo-600" data-testid="swap-show-calendar" />
                <span className="text-xs text-indigo-900">
                  <span className="font-medium flex items-center gap-1"><CalendarCheck size={13} />本人のカレンダーに表示する（任意）</span>
                  表示しない場合、この振替はカレンダーに出ません（記録と通知メールは残ります）。
                </span>
              </label>

              {/* 振替出勤日 */}
              <fieldset className="rounded-lg border border-green-300 bg-green-50/50 px-3 py-3 space-y-3">
                <legend className="px-1 text-sm font-semibold text-green-900">振替出勤日（休み → 勤務）</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>日付 {req}</label>
                    <input type="date" value={form.workDate} onChange={e => set('workDate', e.target.value)} className={inputCls} data-testid="swap-work-date" />
                  </div>
                  <div>
                    <label className={labelCls}>元の状態</label>
                    <input type="text" value={form.workOriginal} onChange={e => set('workOriginal', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <DayWarnings warnings={workWarnings} testId="swap-warnings-work" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>勤務内容 {req}</label>
                    <input type="text" value={form.workContent} onChange={e => set('workContent', e.target.value)}
                      placeholder="例：MT出席・本部業務・研修" maxLength={100} className={inputCls} data-testid="swap-work-content" />
                  </div>
                  <div>
                    <label className={labelCls}>施設（任意）</label>
                    <select value={form.workFacilityId} onChange={e => set('workFacilityId', e.target.value)} className={inputCls}>
                      <option value="">なし（施設勤務なし）</option>
                      {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-green-900">変更内容：{workDetailText(form.workOriginal, form.workContent)}</p>

                {/* 公休の非表示 */}
                {form.showOnCalendar && kyukyuOnWorkDay.length > 0 && (
                  <div className="rounded-md border border-slate-300 bg-white px-2.5 py-2 space-y-1" data-testid="swap-hidden-list">
                    <p className="text-xs font-medium text-slate-800">
                      この日の公休をカレンダーで非表示にする{kyukyuOnWorkDay.length > 1 && '（複数あります。非表示にするものを選んでください）'}
                    </p>
                    {kyukyuOnWorkDay.map(e => (
                      <label key={e.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-slate-600" checked={hiddenIds.includes(e.id)}
                          onChange={ev => setHiddenIds(prev => ev.target.checked ? [...prev, e.id] : prev.filter(x => x !== e.id))} />
                        公休「{e.title}」（{timeText(e)}）
                      </label>
                    ))}
                    <p className="text-xs text-slate-500">公休の予定そのものは削除しません。振替を取り消すと、また表示されます。</p>
                  </div>
                )}
              </fieldset>

              {/* 振替休日 */}
              <fieldset className="rounded-lg border border-pink-300 bg-pink-50/50 px-3 py-3 space-y-3">
                <legend className="px-1 text-sm font-semibold text-pink-900">振替休日（勤務日 → 休み）</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>日付 {req}</label>
                    <input type="date" value={form.offDate} onChange={e => set('offDate', e.target.value)} className={inputCls} data-testid="swap-off-date" />
                  </div>
                  <div>
                    <label className={labelCls}>元の状態</label>
                    <input type="text" value={form.offOriginal} onChange={e => set('offOriginal', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <DayWarnings warnings={offWarnings} testId="swap-warnings-off" />
                <div>
                  <label className={labelCls}>施設（任意）</label>
                  <select value={form.offFacilityId} onChange={e => set('offFacilityId', e.target.value)} className={inputCls}>
                    <option value="">なし（施設勤務なし）</option>
                    {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <p className="text-xs text-pink-900">変更内容：{offDetailText(form.offOriginal)}</p>
                <p className="text-xs text-gray-500">「フリー」は施設勤務のない勤務日です。予定が登録されていなくても休日とは扱いません。</p>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>理由 {req}</label>
                  <input type="text" value={form.reason} onChange={e => set('reason', e.target.value)} className={inputCls} data-testid="swap-reason" />
                </div>
                <div>
                  <label className={labelCls}>入力者 {req}</label>
                  <input type="text" value={form.handledBy} onChange={e => set('handledBy', e.target.value)} className={inputCls} data-testid="swap-handled-by" />
                </div>
              </div>
              <div>
                <label className={labelCls}>メモ</label>
                <textarea value={form.memo} onChange={e => set('memo', e.target.value)} rows={2} className={inputCls} />
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert">{error}</p>}
        </div>

        {/* ── フッター ── */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t flex-shrink-0">
          {editing && !done ? (
            confirmDelete ? (
              // 取消の2段階目。スマートフォンでは文言の下にボタンを横いっぱいに並べ（やめる＝左、取り消す＝右）、PCでは1行に並べる
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3" data-testid="swap-delete-confirm-area">
                <span className="text-sm font-medium text-red-700 sm:text-xs sm:font-normal sm:mr-auto">2日分とも取り消します。よろしいですか？</span>
                <div className="flex gap-3 sm:gap-2">
                  <button onClick={() => setConfirmDelete(false)} disabled={saving}
                    className="flex-1 sm:flex-none whitespace-nowrap min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    data-testid="swap-delete-cancel">やめる</button>
                  <button onClick={handleDelete} disabled={saving}
                    className="flex-1 sm:flex-none whitespace-nowrap min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    data-testid="swap-delete-confirm">
                    {saving ? '取消中…' : '取り消す'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={saving || loadingSwap}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-60" data-testid="swap-delete">
                <Trash2 size={14} />取消
              </button>
            )
          ) : <div />}
          {!confirmDelete && (
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
                {done ? '閉じる' : 'キャンセル'}
              </button>
              {!done && (
                <button onClick={handleConfirm} disabled={saving || loadingSwap}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60" data-testid="swap-confirm">
                  <Save size={14} />確認
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
