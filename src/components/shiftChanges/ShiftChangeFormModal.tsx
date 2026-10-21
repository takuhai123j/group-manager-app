'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { X, Save, Trash2, Plus, Minus, CheckSquare, Link2 } from 'lucide-react'
import { cn, toDateString } from '@/lib/utils'
import { SHIFT_CHANGE_TYPES } from '@/lib/types'
import type {
  ShiftChangeRecord, CreateShiftChangeInput, Facility, ShiftChangeType,
  CompensatoryLeaveStatus, GroupManager, StaffMember, MeetingAssigneeRef,
} from '@/lib/types'
import {
  buildCalendarCandidates, validateCalendarTime, targetKey, formatCalendarTime,
} from '@/lib/shiftChangeCalendar'
import { shiftChangeErrorMessage } from '@/services/shiftChangeService'
import { CalendarTargetField, CalendarTimeFields } from './CalendarTargetField'
import { buildChangeDetailText, usesAfterShift } from '@/lib/shiftChangeDetailText'
import { chainSteps, chainWorkFacilities, validateChain, chainSummary, detailPlaceFacilities, MAX_CHAIN } from '@/lib/shiftChangeChain'

interface Props {
  isOpen: boolean
  editing: ShiftChangeRecord | null
  facilities: Facility[]
  managers: GroupManager[]
  staffMembers: StaffMember[]
  onClose: () => void
  onSave: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  // 期間・複数日の一括登録（全日分を1トランザクションで保存）
  onSaveBatch: (inputs: (CreateShiftChangeInput & { id: string })[]) => Promise<ShiftChangeRecord[]>
  onDelete?: (id: string) => Promise<void>
  onLoadRelatedGroup: (groupId: string) => Promise<ShiftChangeRecord[]>
  onCreateLinkedRecord: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onLinkCompensatoryLeave: (detailId: string) => Promise<void>
}

const MAX_TARGETS = 5

type DateMode = 'single' | 'range' | 'multi'

type DetailDraft = {
  employeeName: string
  changeType: ShiftChangeType
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityId: string
  // 変更前シフト（original_shift として保存）と変更後シフト（文章を作るための画面上の入力。保存しない）
  originalShift: string | null
  afterShift: string
  // 変更内容を自動で作るか。手で書き換えたら false にして以後は上書きしない（保存済みの記録を開いたときも false）
  detailAuto: boolean
  // 保存済みの変更内容（編集で開いた明細だけ。新しく足した明細は null）。表示を優先し、置き換えるときは確認する
  savedDetail: string | null
  // 変更後担当と振休の状態。振休の状態は単日の画面に出さないが、複数日入力で設定された値を編集保存で消さないよう保持する
  replacementName: string | null
  replacementOriginalShift: string | null
  compensatoryLeaveStatus: CompensatoryLeaveStatus | null
  // 個人カレンダーへの反映先と時刻（時刻は任意。空なら終日）
  calendarTarget: MeetingAssigneeRef | null
  startTime: string
  endTime: string
  // 名前から反映先を提案するか（新しい明細・名前を書き換えた明細だけ。保存済みの「反映しない」は保つ）
  suggestTarget: boolean
  // 変更後担当（代わりに入る人）の反映先と時刻。元の対象者とは独立して設定する
  replacementCalendarTarget: MeetingAssigneeRef | null
  replacementStartTime: string
  replacementEndTime: string
  suggestReplacementTarget: boolean
  // 「＋変更後担当を入力」で欄を開いたか（交代出勤・入力済みのときは常に開く）
  showReplacement: boolean
  // 応援チェーンの順番（1〜5。チェーン外は null）。勤務先は保存時に順番から決める（shiftChangeChain）
  chainPosition: number | null
  // チェーンの操作で、この明細の「代わりに入る人（変更後担当）」が変わったか（変更内容に古い名前が残っていないかの警告に使う）
  chainReplacementChanged: boolean
}

type CompensatoryLeaveTiming = 'now' | 'later'

type DayPersonDraft = {
  changeType: ShiftChangeType
  originalShift: string
  afterShift: string
  // 変更内容（自動で作った文章。手で書き換えたら detailAuto を false にして以後は上書きしない）
  changeDetail: string
  detailAuto: boolean
  replacementName: string
  replacementOriginalShift: string
  isExternalSupport: boolean
  supportFromFacilityId: string
  // 振休
  wantsCompensatoryLeave: boolean
  compensatoryLeaveTiming: CompensatoryLeaveTiming
  compensatoryLeaveDate: string
  compensatoryLeaveDetail: string
  compensatoryLeaveReplacementName: string
  // 個人カレンダーへの反映先（日付ごと・対象者ごと）と時刻（反映先がある場合だけ使う。空なら終日）
  calendarTarget: MeetingAssigneeRef | null
  startTime: string
  endTime: string
  // 変更後担当の反映先と時刻（日付ごと。変更後担当の名前がある日だけ使う）
  replacementCalendarTarget: MeetingAssigneeRef | null
  replacementStartTime: string
  replacementEndTime: string
}

type DayDraft = {
  date: string
  persons: DayPersonDraft[]
}

const EMPTY_DETAIL: DetailDraft = {
  employeeName: '',
  changeType: '欠勤',
  changeDetail: buildChangeDetailText({ changeType: '欠勤' }),
  isExternalSupport: false,
  supportFromFacilityId: '',
  originalShift: null,
  afterShift: '',
  detailAuto: true,
  savedDetail: null,
  replacementName: null,
  replacementOriginalShift: null,
  compensatoryLeaveStatus: null,
  calendarTarget: null,
  startTime: '',
  endTime: '',
  suggestTarget: true,
  replacementCalendarTarget: null,
  replacementStartTime: '',
  replacementEndTime: '',
  suggestReplacementTarget: true,
  showReplacement: false,
  chainPosition: null,
  chainReplacementChanged: false,
}

const EMPTY_PERSON_DRAFT_FIELDS: DayPersonDraft = {
  changeType: '欠勤',
  originalShift: '',
  afterShift: '',
  changeDetail: buildChangeDetailText({ changeType: '欠勤' }),
  detailAuto: true,
  replacementName: '',
  replacementOriginalShift: '',
  isExternalSupport: false,
  supportFromFacilityId: '',
  wantsCompensatoryLeave: false,
  compensatoryLeaveTiming: 'later',
  compensatoryLeaveDate: '',
  compensatoryLeaveDetail: '',
  compensatoryLeaveReplacementName: '',
  calendarTarget: null,
  startTime: '',
  endTime: '',
  replacementCalendarTarget: null,
  replacementStartTime: '',
  replacementEndTime: '',
}

const EMPTY_FORM = { facilityId: '', targetDate: '', reason: '', handledBy: '', memo: '' }

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function getDatesInRange(start: string, end: string): string[] {
  if (!start || !end || end < start) return []
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addOneDay(cur)
  }
  return dates
}

function formatDateJP(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  const weeks = ['日', '月', '火', '水', '木', '金', '土']
  return `${m}/${d}（${weeks[day]}）`
}

function formatDateSlash(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${y}/${m}/${d}`
}

// 入力した名前の比較用（空白・全角半角の違いだけを無視する）。名前を別人に変えたら、前の名前で選んだ反映先を外すのに使う
function typedNameKey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKC').replace(/\s+/g, '')
}

// 保存用: 変更後担当の反映先と時刻（名前がない・反映先がないときは送らない）
function replacementInput(name: string | null, target: MeetingAssigneeRef | null, startTime: string, endTime: string) {
  const t = name?.trim() ? target : null
  return {
    replacementCalendarTarget: t,
    replacementStartTime: t && startTime ? startTime : null,
    replacementEndTime: t && endTime ? endTime : null,
  }
}

// 単日の明細で変更後担当の欄を開くか（交代出勤・入力済み・「＋変更後担当を入力」を押した）
function replacementOpen(d: DetailDraft): boolean {
  return d.showReplacement || d.changeType === '交代出勤' || !!d.replacementName?.trim() || !!d.replacementCalendarTarget
}

type ChangeDetailDraft = {
  changeType: string
  originalShift: string | null
  afterShift: string
  replacementName: string | null
  replacementOriginalShift: string | null
  changeDetail: string
  detailAuto: boolean
  savedDetail?: string | null
}

// 文章に入れる勤務元・勤務先の施設名（記録の施設・応援元施設・応援チェーンの勤務先から決める）
type DetailPlace = { beforeFacility?: string; afterFacility?: string; omitReplacement?: boolean }

// 入力から作る変更内容の文章
function generatedDetail(d: ChangeDetailDraft, place?: DetailPlace): string {
  return buildChangeDetailText({
    changeType: d.changeType, beforeShift: d.originalShift, afterShift: d.afterShift,
    replacementName: d.replacementName, replacementOriginalShift: d.replacementOriginalShift,
    ...place,
  })
}

// 自動のままの明細だけ、入力に合わせて文章を作り直す（手で書き換えた文章・保存済みの文章はそのまま）
function withAutoDetail<T extends ChangeDetailDraft>(d: T, place?: DetailPlace): T {
  return d.detailAuto ? { ...d, changeDetail: generatedDetail(d, place) } : d
}

// 応援チェーンの明細をそろえる。順番を1から振り直し、各人は次の応援者を変更後担当（名前・元シフト）として持つ。
// 変更後担当のカレンダー反映はチェーンでは使わない（次の応援者は自分の明細で反映する＝同じ人を2回入れない）。
// 2人目以降は他施設からの応援。チェーンが1人だけになったら解除し、いなくなった次の応援者の変更後担当も外す
function normalizeChain(details: DetailDraft[]): DetailDraft[] {
  const steps = chainSteps(details)
  if (steps.length === 0) return details
  const out = [...details]
  const changed = (step: DetailDraft, rep: string | null) =>
    step.chainReplacementChanged || typedNameKey(step.replacementName) !== typedNameKey(rep)
  if (steps.length === 1) {
    const { index, step } = steps[0]
    out[index] = withAutoDetail({ ...step, chainPosition: null, replacementName: null, replacementOriginalShift: null, chainReplacementChanged: changed(step, null) })
    return out
  }
  steps.forEach(({ index, step }, k) => {
    const next = steps[k + 1]?.step
    const rep = next ? (next.employeeName.trim() || null) : null
    out[index] = withAutoDetail({
      ...step,
      chainPosition: k + 1,
      isExternalSupport: k === 0 ? step.isExternalSupport : true,
      chainReplacementChanged: changed(step, rep),
      replacementName: rep,
      replacementOriginalShift: next ? (next.originalShift?.trim() || null) : null,
      replacementCalendarTarget: null, replacementStartTime: '', replacementEndTime: '',
      showReplacement: false,
    })
  })
  return out
}

// 振休日の追加記録（振休を取る人・その日の代替出勤者）は反映先を選ぶ欄がないため、カレンダーには反映しない
function CompensatoryCalendarNote() {
  return (
    <p className="text-xs text-purple-900 bg-white/70 border border-purple-200 rounded-md px-2 py-1.5">
      振休日の記録（振休・振休日の代替出勤者）は、カレンダーに自動反映されません。
      反映したい場合は、登録後にシフト変更の一覧からその記録を開き、「カレンダーに反映」で本人を選んで保存してください。
    </p>
  )
}

type DetailPatch = { originalShift?: string; afterShift?: string; changeDetail?: string; detailAuto?: boolean }

// 変更前シフト・変更後シフト（欠勤・振休では変更後シフトを出さない）
function ShiftBeforeAfterFields({ draft, onChange }: { draft: ChangeDetailDraft; onChange: (patch: DetailPatch) => void }) {
  const showAfter = usesAfterShift(draft.changeType) || draft.afterShift.trim() !== ''
  return (
    <div className={cn('grid gap-2', showAfter ? 'grid-cols-2' : 'grid-cols-1')}>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">変更前シフト</label>
        <input type="text" value={draft.originalShift ?? ''}
          onChange={e => onChange({ originalShift: e.target.value })}
          placeholder="例：09:00～18:00"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      {showAfter && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">変更後シフト</label>
          <input type="text" value={draft.afterShift}
            onChange={e => onChange({ afterShift: e.target.value })}
            placeholder="例：13:00～18:00"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      )}
    </div>
  )
}

// 変更内容。自動のあいだは入力に合わせて文章が変わり、書き換えたら以後は自動で変えない。
// 手入力（保存済みの記録を含む）のときは、押した場合だけ入力内容から作り直す
function ChangeDetailTextField({ draft, place, required, warning, onChange }: {
  draft: ChangeDetailDraft; place?: DetailPlace; required?: boolean; warning?: string | null; onChange: (patch: DetailPatch) => void
}) {
  const generated = generatedDetail(draft, place)
  const saved = draft.savedDetail ?? null
  // 文章の長さに合わせて高さを広げる（施設名が長いと2行に収まらず、後ろが隠れるため。最低2行）
  const textRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [draft.changeDetail])
  const showingSaved = saved !== null && draft.changeDetail === saved
  // 保存済みの文章を置き換えるときだけ確認する（キャンセルなら何も変えない。保存するまで記録は変わらない）
  const rebuild = () => {
    if (showingSaved && !confirm(`保存済みの変更内容を置き換えますか？（保存するまで記録は変わりません）\n\n今：${saved}\n新：${generated}`)) return
    onChange({ changeDetail: generated, detailAuto: true })
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label className="flex-shrink-0 whitespace-nowrap text-xs font-medium text-gray-700">
          変更内容 {required ? <span className="text-red-500">*</span> : <span className="text-gray-400 font-normal">（任意）</span>}
        </label>
        <span className="min-w-0 text-right text-[11px] text-gray-400">
          {showingSaved ? '保存済みの文章（種別・シフト・施設を変えても自動では変わりません）' : draft.detailAuto ? '種別・シフト・施設から自動作成（書き換え可）' : '手入力'}
        </span>
      </div>
      <textarea ref={textRef} value={draft.changeDetail}
        onChange={e => onChange({ changeDetail: e.target.value, detailAuto: false })}
        rows={2} placeholder="例：9:00-13:00 → 14:00-19:00"
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      {warning && (
        <p className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">{warning}</p>
      )}
      {!draft.detailAuto && generated && generated !== draft.changeDetail && (
        <button type="button" onClick={rebuild}
          className="mt-1 block text-left text-xs text-blue-700 underline hover:text-blue-900">
          入力内容から作り直す（「{generated}」にする）
        </button>
      )}
      {saved !== null && !showingSaved && (
        <button type="button" onClick={() => onChange({ changeDetail: saved, detailAuto: false })}
          className="mt-1 block text-left text-xs text-gray-600 underline hover:text-gray-900">
          保存済みの文章に戻す（「{saved}」）
        </button>
      )}
    </div>
  )
}

const MODE_LABELS: Record<DateMode, string> = {
  single: '単日',
  range: '期間',
  multi: '複数日選択',
}

export function ShiftChangeFormModal({
  isOpen, editing, facilities, managers, staffMembers, onClose, onSave, onSaveBatch, onDelete,
  onLoadRelatedGroup, onCreateLinkedRecord, onLinkCompensatoryLeave,
}: Props) {
  // ── 単日モード ──
  const [form, setForm] = useState(EMPTY_FORM)
  const [details, setDetails] = useState<DetailDraft[]>([{ ...EMPTY_DETAIL }])

  // ── モード ──
  const [dateMode, setDateMode] = useState<DateMode>('single')

  // ── 期間モード ──
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // ── 複数日選択モード ──
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [newDateInput, setNewDateInput] = useState('')

  // ── 期間・複数日共通 ──
  const [periodForm, setPeriodForm] = useState({ facilityId: '', handledBy: '', reason: '', memo: '' })
  const [periodEmployeeNames, setPeriodEmployeeNames] = useState<string[]>([''])
  const [dayDrafts, setDayDrafts] = useState<DayDraft[]>([])

  // 一括入力
  const [bulk, setBulk] = useState({
    changeType: '欠勤' as ShiftChangeType,
    originalShift: '',
    afterShift: '',
    replacementName: '',
    replacementOriginalShift: '',
    isExternalSupport: false,
    supportFromFacilityId: '',
    startTime: '',
    endTime: '',
  })

  // 新規登録のID（画面を開いている間は同じIDを使い、保存の再試行で二重登録しないようにする）。
  // 単日は1つ、期間・複数日は「日付（＋振休の追加分）」ごとに1つ
  const singleIdRef = useRef<string>('')
  const multiIdsRef = useRef<Map<string, string>>(new Map())
  const idFor = (key: string): string => {
    let id = multiIdsRef.current.get(key)
    if (!id) { id = crypto.randomUUID(); multiIdsRef.current.set(key, id) }
    return id
  }

  // ── 確認ダイアログ ──
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingInputs, setPendingInputs] = useState<(CreateShiftChangeInput & { id: string })[]>([])
  // 確認画面で「振休日を同時に設定」した追加記録を見分ける（カレンダーには反映しない旨を出す）
  const [compensatoryInputIds, setCompensatoryInputIds] = useState<Set<string>>(new Set())

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailWarning, setEmailWarning] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)

  // ── 関連する振休グループ ──
  const [relatedRecords, setRelatedRecords] = useState<ShiftChangeRecord[]>([])
  const [loadingRelated, setLoadingRelated] = useState(false)

  // ── 振休日を後から設定するサブフォーム ──
  const [linkingDetailId, setLinkingDetailId] = useState<string | null>(null)
  const [linkForm, setLinkForm] = useState({ date: '', changeDetail: '振休', replacementName: '' })
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [locallyLinkedIds, setLocallyLinkedIds] = useState<Set<string>>(new Set())
  // この画面で応援チェーンから削除した人の名前（変更内容に残っていないかの警告に使う）
  const [removedChainNames, setRemovedChainNames] = useState<string[]>([])

  const activeFacilities = facilities.filter(f => f.active)

  // リセット
  useEffect(() => {
    if (!isOpen) return
    setError(null); setEmailSuccess(null); setEmailWarning(null)
    setShowConfirm(false); setPendingInputs([])
    setRelatedRecords([]); setLinkingDetailId(null); setLinkError(null)
    setLocallyLinkedIds(new Set())
    setRemovedChainNames([])
    singleIdRef.current = crypto.randomUUID()
    multiIdsRef.current = new Map()

    if (editing) {
      setDateMode('single')
      setForm({
        facilityId: editing.facilityId,
        targetDate: editing.targetDate,
        reason: editing.reason,
        handledBy: editing.handledBy,
        memo: editing.memo,
      })
      setDetails(
        editing.details.length > 0
          ? editing.details.map(d => ({
              employeeName: d.employeeName,
              changeType: (SHIFT_CHANGE_TYPES as readonly string[]).includes(d.changeType)
                ? d.changeType as ShiftChangeType : 'その他',
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityId: d.supportFromFacilityId ?? '',
              // 複数日入力で設定された値は編集UIで表示・変更しないが、保存時に消えないよう保持する
              originalShift: d.originalShift,
              afterShift: '',
              detailAuto: false,
              savedDetail: d.changeDetail,
              replacementName: d.replacementName,
              replacementOriginalShift: d.replacementOriginalShift,
              compensatoryLeaveStatus: d.compensatoryLeaveStatus,
              calendarTarget: d.calendarTarget,
              startTime: d.startTime ?? '',
              endTime: d.endTime ?? '',
              suggestTarget: false,
              replacementCalendarTarget: d.replacementCalendarTarget,
              replacementStartTime: d.replacementStartTime ?? '',
              replacementEndTime: d.replacementEndTime ?? '',
              suggestReplacementTarget: false,
              showReplacement: false,
              chainPosition: d.chainPosition,
              chainReplacementChanged: false,
            }))
          : [{ ...EMPTY_DETAIL }]
      )
    } else {
      // 端末の現地日付（toISOString は UTC のため、日本時間の0〜9時は前日になる）
      const today = toDateString(new Date())
      setDateMode('single')
      setForm({ ...EMPTY_FORM, targetDate: today })
      setDetails([{ ...EMPTY_DETAIL }])
      setStartDate(today)
      setEndDate(today)
      setSelectedDates([])
      setNewDateInput(today)
      setPeriodForm({ facilityId: '', handledBy: '', reason: '', memo: '' })
      setPeriodEmployeeNames([''])
      setDayDrafts([])
      setBulk({ changeType: '欠勤', originalShift: '', afterShift: '', replacementName: '', replacementOriginalShift: '', isExternalSupport: false, supportFromFacilityId: '', startTime: '', endTime: '' })
    }
  }, [isOpen, editing])

  // 関連する振休グループの取得（編集対象がグループに属する場合）
  useEffect(() => {
    if (!isOpen || !editing?.relatedChangeGroupId) { setRelatedRecords([]); return }
    const groupId = editing.relatedChangeGroupId
    setLoadingRelated(true)
    onLoadRelatedGroup(groupId)
      .then(recs => setRelatedRecords(recs.filter(r => r.id !== editing.id)))
      .catch(() => setRelatedRecords([]))
      .finally(() => setLoadingRelated(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing?.id, editing?.relatedChangeGroupId])

  // 期間モード → dayDrafts
  useEffect(() => {
    if (dateMode !== 'range') return
    const dates = getDatesInRange(startDate, endDate)
    setDayDrafts(prev => {
      const prevMap = new Map(prev.map(d => [d.date, d]))
      return dates.map(date => {
        const existing = prevMap.get(date)
        const persons = periodEmployeeNames.map((_, i) => existing?.persons[i] ?? { ...EMPTY_PERSON_DRAFT_FIELDS })
        return { date, persons }
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, dateMode, periodEmployeeNames.length])

  // 複数日選択モード → dayDrafts
  useEffect(() => {
    if (dateMode !== 'multi') return
    const sorted = [...selectedDates].sort()
    setDayDrafts(prev => {
      const prevMap = new Map(prev.map(d => [d.date, d]))
      return sorted.map(date => {
        const existing = prevMap.get(date)
        const persons = periodEmployeeNames.map((_, i) => existing?.persons[i] ?? { ...EMPTY_PERSON_DRAFT_FIELDS })
        return { date, persons }
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDates, dateMode, periodEmployeeNames.length])

  if (!isOpen) return null

  const setField = <K extends keyof typeof EMPTY_FORM>(key: K, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const setPeriodField = <K extends keyof typeof periodForm>(key: K, val: string) =>
    setPeriodForm(prev => ({ ...prev, [key]: val }))

  // ── 変更内容の施設名 ──
  const facName = (id: string | null | undefined) => (id ? facilities.find(f => f.id === id)?.name : undefined) ?? ''
  // 単日の明細ごとの勤務元・勤務先の施設名（応援チェーンでは次の応援者を文章に重ねない）
  const singlePlaces = (list: DetailDraft[], recordFacilityId: string): DetailPlace[] =>
    detailPlaceFacilities(list, recordFacilityId).map(p => ({
      beforeFacility: facName(p.before), afterFacility: facName(p.after), omitReplacement: p.inChain,
    }))
  // チェーンをそろえてから、自動のままの文章を施設名つきで作り直す（記録の施設を変えたときは新しい施設で）
  const syncDetails = (list: DetailDraft[], recordFacilityId = form.facilityId): DetailDraft[] => {
    const normalized = normalizeChain(list)
    const places = singlePlaces(normalized, recordFacilityId)
    return normalized.map((d, i) => withAutoDetail(d, places[i]))
  }
  // 期間・複数日の勤務元・勤務先（勤務先は記録の施設。応援チェーンはない）
  const dayPlace = (p: Pick<DayPersonDraft, 'isExternalSupport' | 'supportFromFacilityId'>, recordFacilityId = periodForm.facilityId): DetailPlace => ({
    beforeFacility: facName(p.isExternalSupport ? p.supportFromFacilityId : recordFacilityId),
    afterFacility: facName(recordFacilityId),
  })
  // 施設を変えたら、自動のままの文章だけ新しい施設名で作り直す
  const changeRecordFacility = (val: string) => {
    setField('facilityId', val)
    setDetails(prev => syncDetails(prev, val))
  }
  const changePeriodFacility = (val: string) => {
    setPeriodField('facilityId', val)
    setDayDrafts(prev => prev.map(d => ({ ...d, persons: d.persons.map(p => withAutoDetail(p, dayPlace(p, val))) })))
  }

  const updateDetail = (i: number, patch: Partial<DetailDraft>) =>
    setDetails(prev => syncDetails(prev.map((d, idx) => idx === i ? { ...d, ...patch } : d)))

  // ── 応援チェーン（単日） ──
  const chain = chainSteps(details)
  const chainWork = chainWorkFacilities(details, form.facilityId)
  const detailPlaces = singlePlaces(details, form.facilityId)
  // この明細を1人目にして、2人目（他施設からの応援者）の明細をすぐ後ろに足す。
  // 1人目の変更後担当に入れていた名前・元シフト・カレンダー反映は2人目の明細へ移す（同じ人を2回入れないため）
  const startChain = (i: number) => setDetails(prev => {
    const head = prev[i]
    const second: DetailDraft = withAutoDetail({
      ...EMPTY_DETAIL,
      employeeName: head.replacementName?.trim() ?? '',
      changeType: '交代出勤',
      originalShift: head.replacementOriginalShift?.trim() || null,
      isExternalSupport: true,
      calendarTarget: head.replacementCalendarTarget,
      startTime: head.replacementCalendarTarget ? head.replacementStartTime : '',
      endTime: head.replacementCalendarTarget ? head.replacementEndTime : '',
      suggestTarget: !head.replacementCalendarTarget,
      chainPosition: 2,
    })
    const next = [...prev]
    next[i] = { ...head, chainPosition: 1 }
    next.splice(i + 1, 0, second)
    return syncDetails(next)
  })
  // 最後の応援者の元施設へ応援する人を、必要なときだけ足す（交代出勤を選んでも自動では足さない）
  const continueChain = () => setDetails(prev => {
    const steps = chainSteps(prev)
    const last = steps[steps.length - 1]
    const added: DetailDraft = withAutoDetail({ ...EMPTY_DETAIL, changeType: '交代出勤', isExternalSupport: true, chainPosition: steps.length + 1 })
    const next = [...prev]
    next.splice(last.index + 1, 0, added)
    return syncDetails(next)
  })
  // 明細の削除。チェーンの2人目以降を消すと後ろの応援者のつながりも切れるので一緒に消す（確認する）。1人目を消すとチェーンを解除する
  const removeDetail = (i: number) => {
    const d = details[i]
    if (d.chainPosition == null) { setDetails(prev => syncDetails(prev.filter((_, idx) => idx !== i))); return }
    if (d.chainPosition === 1) {
      if (!confirm(`応援チェーンの1人目（${d.employeeName.trim() || '名前未入力'}）を削除すると、応援チェーンは解除されます（2人目以降は通常の明細として残ります）。削除しますか？`)) return
      setRemovedChainNames(prev => [...prev, d.employeeName.trim()].filter(Boolean))
      setDetails(prev => syncDetails(prev.filter((_, idx) => idx !== i).map(x => x.chainPosition != null ? { ...x, chainPosition: null } : x)))
      return
    }
    const removed = chain.filter(s => (s.step.chainPosition ?? 0) >= d.chainPosition!)
    if (!confirm(`次の明細を削除しますか？${removed.length > 1 ? '（後ろの応援者もつながりが切れるため一緒に削除します）' : ''}\n\n${removed.map(s => `応援チェーン${s.step.chainPosition}人目：${s.step.employeeName.trim() || '名前未入力'}`).join('\n')}`)) return
    const drop = new Set(removed.map(s => s.index))
    setRemovedChainNames(prev => [...prev, ...removed.map(s => s.step.employeeName.trim())].filter(Boolean))
    setDetails(prev => syncDetails(prev.filter((_, idx) => !drop.has(idx))))
  }
  // 変更内容（手入力・保存済み）に、今は代わりに入っていない人の名前が残っていないか。
  // ① チェーンの操作で変更後担当が変わった明細で「変更後担当：○○」が今の変更後担当と違う
  // ② この画面でチェーンから削除した人の名前が書かれている（自分の明細の名前は除く）
  const staleNameWarning = (d: DetailDraft): string | null => {
    if (d.detailAuto) return null
    const found = new Set<string>()
    if (d.chainReplacementChanged) {
      for (const m of Array.from(d.changeDetail.matchAll(/変更後担当：([^（／\s]+)/g))) {
        if (typedNameKey(m[1]) !== typedNameKey(d.replacementName)) found.add(m[1])
      }
    }
    const text = typedNameKey(d.changeDetail)
    for (const n of removedChainNames) {
      if (typedNameKey(n) && typedNameKey(n) !== typedNameKey(d.employeeName) && text.includes(typedNameKey(n))) found.add(n)
    }
    if (found.size === 0) return null
    const now = d.replacementName?.trim()
    return `変更内容に、今は代わりに入っていない人の名前（${Array.from(found).join('、')}）が残っています。${now ? `今の代わりに入る人は「${now}」です。` : ''}必要なら書き換えるか「入力内容から作り直す」を押してください`
  }
  // チェーンだけを解除する（明細はすべて残す。2人目以降の勤務先は記録の施設の扱いに戻る）
  const unlinkChain = () => {
    if (!confirm('応援チェーンを解除しますか？\n明細は残りますが、2人目以降の勤務先は記録の施設として扱われます（カレンダーの施設も記録の施設になります）。')) return
    setDetails(prev => syncDetails(prev.map(x => x.chainPosition != null ? { ...x, chainPosition: null } : x)))
  }

  const updateDayPerson = (dayIdx: number, personIdx: number, patch: Partial<DayPersonDraft>) =>
    setDayDrafts(prev => prev.map((d, di) => di !== dayIdx ? d : {
      ...d,
      persons: d.persons.map((p, pi) => pi === personIdx ? withAutoDetail({ ...p, ...patch }, dayPlace({ ...p, ...patch })) : p),
    }))

  const addPersonName = () => {
    if (periodEmployeeNames.length >= MAX_TARGETS) return
    setPeriodEmployeeNames(prev => [...prev, ''])
  }
  const removePersonName = (i: number) => {
    setPeriodEmployeeNames(prev => prev.filter((_, idx) => idx !== i))
    // 日別入力の行も同じ位置を詰める（後ろの人の入力が前の人にずれないように）
    setDayDrafts(prev => prev.map(d => ({ ...d, persons: d.persons.filter((_, idx) => idx !== i) })))
  }
  // 反映先の選択。「反映しない」にしたら時刻も消す（単日と同じ）
  const updateDayPersonTarget = (dayIdx: number, personIdx: number, target: MeetingAssigneeRef | null) =>
    updateDayPerson(dayIdx, personIdx, target ? { calendarTarget: target } : { calendarTarget: null, startTime: '', endTime: '' })
  // ある日に選んだ反映先を、同じ対象者の他の日にもまとめて設定する（時刻は日ごとの入力のまま）。
  // 別の人を個別に選んである日を上書きする場合だけ確認する（未設定の日はそのまま設定する）
  const copyTargetToAllDays = (personIdx: number, target: MeetingAssigneeRef) => {
    const overwritten = dayDrafts.filter(d => {
      const current = d.persons[personIdx]?.calendarTarget
      return current && targetKey(current) !== targetKey(target)
    })
    if (overwritten.length > 0) {
      const list = overwritten.map(d => `${formatDateJP(d.date)}：${targetName(d.persons[personIdx].calendarTarget)}`).join('\n')
      if (!confirm(`次の日は別の人の反映先を選んでいます。「${targetName(target)}」に上書きしますか？\n\n${list}`)) return
    }
    setDayDrafts(prev => prev.map(d => ({
      ...d,
      persons: d.persons.map((p, pi) => pi === personIdx ? { ...p, calendarTarget: target } : p),
    })))
  }
  // 対象者名を別の名前に変えたら、前の名前で選んだ反映先・時刻を全日から外す（別人のカレンダーに入らないように）。
  // 空白・全角半角の違いだけなら同じ人として残す
  const updatePersonName = (i: number, val: string) => {
    if (typedNameKey(val) !== typedNameKey(periodEmployeeNames[i])) {
      setDayDrafts(prev => prev.map(d => ({
        ...d,
        persons: d.persons.map((p, pi) => pi === i && p.calendarTarget ? { ...p, calendarTarget: null, startTime: '', endTime: '' } : p),
      })))
    }
    setPeriodEmployeeNames(prev => prev.map((n, idx) => idx === i ? val : n))
  }

  // ── 変更後担当の反映先（元の対象者とは独立） ──
  const CLEAR_REPLACEMENT_TARGET = { replacementCalendarTarget: null, replacementStartTime: '', replacementEndTime: '' } as const
  // 単日: 変更後担当の名前を別人に変えたら、前の名前で選んだ反映先・時刻を外して提案し直す
  const updateDetailReplacementName = (i: number, val: string) =>
    setDetails(prev => syncDetails(prev.map((d, idx) => idx !== i ? d : {
      ...d,
      replacementName: val,
      suggestReplacementTarget: true,
      ...(typedNameKey(val) !== typedNameKey(d.replacementName) ? CLEAR_REPLACEMENT_TARGET : {}),
    })))
  // 期間・複数日: 日ごとの変更後担当の名前（別人に変えたらその日の反映先・時刻を外す）
  const updateDayReplacementName = (dayIdx: number, personIdx: number, val: string) =>
    setDayDrafts(prev => prev.map((d, di) => di !== dayIdx ? d : {
      ...d,
      persons: d.persons.map((p, pi) => pi !== personIdx ? p : withAutoDetail({
        ...p,
        replacementName: val,
        ...(typedNameKey(val) !== typedNameKey(p.replacementName) ? CLEAR_REPLACEMENT_TARGET : {}),
      }, dayPlace(p))),
    }))
  const updateDayReplacementTarget = (dayIdx: number, personIdx: number, target: MeetingAssigneeRef | null) =>
    updateDayPerson(dayIdx, personIdx, target ? { replacementCalendarTarget: target } : CLEAR_REPLACEMENT_TARGET)
  // ある日に選んだ変更後担当の反映先を、同じ対象者で変更後担当の名前が同じ日にまとめて設定する（時刻は日ごとのまま）。
  // 別の人を個別に選んである日を上書きする場合だけ確認する
  const copyReplacementTargetToSameNameDays = (personIdx: number, name: string, target: MeetingAssigneeRef) => {
    const sameName = (p: DayPersonDraft | undefined) => !!p && typedNameKey(p.replacementName) === typedNameKey(name)
    const overwritten = dayDrafts.filter(d => {
      const p = d.persons[personIdx]
      return sameName(p) && p.replacementCalendarTarget && targetKey(p.replacementCalendarTarget) !== targetKey(target)
    })
    if (overwritten.length > 0) {
      const list = overwritten.map(d => `${formatDateJP(d.date)}：${targetName(d.persons[personIdx].replacementCalendarTarget)}`).join('\n')
      if (!confirm(`次の日は別の人の反映先を選んでいます。「${targetName(target)}」に上書きしますか？\n\n${list}`)) return
    }
    setDayDrafts(prev => prev.map(d => ({
      ...d,
      persons: d.persons.map((p, pi) => pi === personIdx && sameName(p) ? { ...p, replacementCalendarTarget: target } : p),
    })))
  }

  const applyBulk = () => {
    // カレンダーの時刻は一括で入れたときだけ全日に入れる（空なら日ごとの時刻をそのまま残す）。反映先（元の対象者）は変えない
    const bulkTimed = !!bulk.startTime && !!bulk.endTime
    const bulkPlace = dayPlace(bulk)
    const next = dayDrafts.map(d => ({
      ...d,
      // 「全日に適用」は全日の入力をまとめて置き換える操作なので、変更内容も入力から作り直す（その後の手修正は可能）
      persons: d.persons.map(existing => withAutoDetail({
        ...existing,
        changeType: bulk.changeType,
        originalShift: bulk.originalShift,
        afterShift: bulk.afterShift,
        detailAuto: true,
        replacementName: bulk.replacementName,
        replacementOriginalShift: bulk.replacementOriginalShift,
        isExternalSupport: bulk.isExternalSupport,
        supportFromFacilityId: bulk.isExternalSupport ? bulk.supportFromFacilityId : '',
        startTime: bulkTimed ? bulk.startTime : existing.startTime,
        endTime: bulkTimed ? bulk.endTime : existing.endTime,
        // 一括で変更後担当を別の人にした日は、前の変更後担当の反映先を外す（別人のカレンダーに入らないように）
        ...(typedNameKey(bulk.replacementName) !== typedNameKey(existing.replacementName) ? CLEAR_REPLACEMENT_TARGET : {}),
      }, bulkPlace)),
    }))
    // 手で書き換えた変更内容を上書きする日・変更後担当の反映先が外れる日があれば、日付を示して確認する（キャンセルなら何も変えない）
    const changes: string[] = []
    dayDrafts.forEach((d, di) => d.persons.forEach((p, pi) => {
      const n = next[di].persons[pi]
      const who = periodEmployeeNames[pi]?.trim() || `対象者${pi + 1}`
      if (!p.detailAuto && p.changeDetail !== n.changeDetail) {
        changes.push(`${formatDateJP(d.date)} ${who}：手入力の変更内容「${p.changeDetail}」を「${n.changeDetail || '（空）'}」にする`)
      }
      if (p.replacementCalendarTarget && !n.replacementCalendarTarget) {
        changes.push(`${formatDateJP(d.date)} ${who}：変更後担当のカレンダー反映（${targetName(p.replacementCalendarTarget)}）を外す`)
      }
    }))
    if (changes.length > 0 && !confirm(`全日に適用すると、次の内容が変わります。適用しますか？\n\n${changes.join('\n')}`)) return
    setDayDrafts(next)
  }

  // カレンダー反映先の候補（有効な人＋編集中の明細で指定済みの人。変更後担当の反映先も含む）と表示名
  const calendarCandidates = buildCalendarCandidates(managers, staffMembers,
    editing?.details.flatMap(d => [d.calendarTarget, d.replacementCalendarTarget]) ?? [])
  const targetName = (t: MeetingAssigneeRef | null | undefined) =>
    calendarCandidates.find(c => targetKey(c) === targetKey(t))?.name ?? ''
  const hasDuplicateTarget = (targets: (MeetingAssigneeRef | null | undefined)[]) => {
    const keys = targets.filter(Boolean).map(t => targetKey(t))
    return new Set(keys).size !== keys.length
  }

  const addSelectedDate = () => {
    if (!newDateInput || selectedDates.includes(newDateInput)) return
    setSelectedDates(prev => [...prev, newDateInput].sort())
  }

  const removeSelectedDate = (date: string) => setSelectedDates(prev => prev.filter(d => d !== date))

  const datesCount = dayDrafts.length
  const facilityName = activeFacilities.find(f => f.id === periodForm.facilityId)?.name ?? ''
  const isMultiDay = !editing && (dateMode === 'range' || dateMode === 'multi')

  // ── 単日保存 ──
  const handleSaveSingle = async () => {
    if (!form.facilityId)       { setError('施設を選択してください'); return }
    if (!form.targetDate)       { setError('対象日を入力してください'); return }
    if (!form.handledBy.trim()) { setError('入力者を入力してください'); return }
    if (!form.reason.trim())    { setError('理由を入力してください'); return }
    for (let i = 0; i < details.length; i++) {
      if (!details[i].employeeName.trim()) { setError(`対象者${i + 1}の名前を入力してください`); return }
      if (!details[i].changeDetail.trim()) { setError(`対象者${i + 1}の変更内容を入力してください`); return }
      // 応援チェーンの人の応援元は validateChain で確かめる（チェーン用の文言で出す）
      if (details[i].isExternalSupport && details[i].chainPosition == null && !details[i].supportFromFacilityId) {
        setError(`対象者${i + 1}の調整元施設を選択してください`); return
      }
      if (details[i].calendarTarget) {
        const timeError = validateCalendarTime(details[i].startTime, details[i].endTime)
        if (timeError) { setError(`対象者${i + 1}：${timeError}`); return }
      }
      if (details[i].replacementCalendarTarget) {
        if (!details[i].replacementName?.trim()) { setError(`対象者${i + 1}：変更後担当の名前を入力してください`); return }
        const timeError = validateCalendarTime(details[i].replacementStartTime, details[i].replacementEndTime)
        if (timeError) { setError(`対象者${i + 1}の変更後担当：${timeError}`); return }
      }
    }
    const chainError = validateChain(details, form.facilityId)
    if (chainError) { setError(chainError); return }
    const stale = details.map((d, i) => ({ i, w: staleNameWarning(d) })).filter(x => x.w)
    if (stale.length > 0 && !confirm(`次の明細の変更内容に、今は代わりに入っていない人の名前が残っています。このまま保存しますか？\n\n${stale.map(x => `${x.i + 1}人目（${details[x.i].employeeName.trim()}）：${details[x.i].changeDetail}`).join('\n')}`)) return
    if (hasDuplicateTarget(details.flatMap(d => [d.calendarTarget, d.replacementCalendarTarget]))) {
      setError('同じ人のカレンダーが2回指定されています（元の対象者・変更後担当・応援チェーンを合わせて1人1回にしてください）'); return
    }
    setSaving(true); setError(null); setEmailWarning(null); setEmailSuccess(null)
    try {
      const saved = await onSave({
        id: editing ? undefined : singleIdRef.current,
        facilityId: form.facilityId,
        targetDate: form.targetDate,
        reason: form.reason,
        handledBy: form.handledBy,
        memo: form.memo,
        details: details.map((d, i) => ({
          employeeName: d.employeeName,
          changeType: d.changeType,
          changeDetail: d.changeDetail,
          isExternalSupport: d.isExternalSupport,
          supportFromFacilityId: d.isExternalSupport ? d.supportFromFacilityId || null : null,
          // 応援チェーン（チェーン外は null）。勤務先は順番から決める（1・2人目＝記録の施設、3人目以降＝1つ前の人の元施設）
          chainPosition: d.chainPosition,
          workFacilityId: d.chainPosition != null ? chainWork[i] : null,
          // 変更前シフトは画面で編集できる（空なら null）。振休の状態は単日の編集UIにないため、既存値をそのまま引き継ぐ
          originalShift: d.originalShift?.trim() ? d.originalShift : null,
          replacementName: d.replacementName?.trim() ? d.replacementName.trim() : null,
          replacementOriginalShift: d.replacementOriginalShift?.trim() ? d.replacementOriginalShift.trim() : null,
          compensatoryLeaveStatus: d.compensatoryLeaveStatus,
          calendarTarget: d.calendarTarget,
          startTime: d.calendarTarget && d.startTime ? d.startTime : null,
          endTime: d.calendarTarget && d.endTime ? d.endTime : null,
          ...replacementInput(d.replacementName, d.replacementCalendarTarget, d.replacementStartTime, d.replacementEndTime),
        })),
        relatedChangeGroupId: editing?.relatedChangeGroupId ?? null,
      })
      if (!editing) {
        try {
          const payload = {
            facilityName: saved.facilityName,
            targetDate: saved.targetDate,
            reason: saved.reason,
            handledBy: saved.handledBy,
            memo: saved.memo,
            details: saved.details.map(d => ({
              employeeName: d.employeeName,
              changeType: d.changeType,
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityName: d.supportFromFacilityId
                ? facilities.find(f => f.id === d.supportFromFacilityId)?.name : undefined,
              // 応援チェーンで記録の施設と別の施設に入る人だけ勤務先を書く
              workFacilityName: d.workFacilityId && d.workFacilityId !== saved.facilityId ? facName(d.workFacilityId) : undefined,
            })),
            chainSummary: chainSteps(saved.details).length > 0 ? chainSummary(saved.details, facName) : undefined,
          }
          const res = await fetch('/api/shift-change-notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) { setEmailWarning('記録は保存しましたが、メール通知に失敗しました'); return }
          setEmailSuccess('記録を保存し、通知メールを送信しました'); return
        } catch {
          setEmailWarning('記録は保存しましたが、メール通知に失敗しました'); return
        }
      }
      onClose()
    } catch (e) {
      // 通信が切れた場合は保存できたかどうか画面側では分からないが、同じ内容で保存し直しても二重にはならない
      setError(shiftChangeErrorMessage(e, '保存を確認できませんでした。もう一度「保存」を押してください（同じ内容なら二重に登録されません）'))
    } finally {
      setSaving(false)
    }
  }

  // ── 複数日（期間 or 複数日選択）→ 確認へ ──
  const handleSaveMultiDay = () => {
    if (!periodForm.facilityId)       { setError('施設を選択してください'); return }
    if (dateMode === 'range') {
      if (!startDate)               { setError('開始日を入力してください'); return }
      if (!endDate)                 { setError('終了日を入力してください'); return }
      if (endDate < startDate)      { setError('終了日は開始日以降を指定してください'); return }
      if (datesCount > 31)          { setError('期間は31日以内に設定してください'); return }
    }
    if (dateMode === 'multi' && selectedDates.length === 0) {
      setError('対象日を1日以上選択してください'); return
    }
    if (datesCount === 0)             { setError('対象日を設定してください'); return }
    if (!periodForm.handledBy.trim()) { setError('入力者を入力してください'); return }
    if (!periodForm.reason.trim())    { setError('理由を入力してください'); return }
    for (let i = 0; i < periodEmployeeNames.length; i++) {
      if (!periodEmployeeNames[i].trim()) { setError(`対象者${i + 1}の名前を入力してください`); return }
    }
    for (const d of dayDrafts) {
      if (hasDuplicateTarget(d.persons.flatMap(p => [p.calendarTarget, p.replacementName.trim() ? p.replacementCalendarTarget : null]))) {
        setError(`${formatDateJP(d.date)}：同じ人のカレンダーが2回指定されています（元の対象者・変更後担当を合わせて1日に1人1回にしてください）`); return
      }
      for (const [personIdx, p] of d.persons.entries()) {
        if (p.replacementName.trim() && p.wantsCompensatoryLeave && p.compensatoryLeaveTiming === 'now' && !p.compensatoryLeaveDate) {
          setError(`${formatDateJP(d.date)}の振休日を入力してください`); return
        }
        if (p.calendarTarget) {
          const timeError = validateCalendarTime(p.startTime, p.endTime)
          if (timeError) { setError(`${formatDateJP(d.date)}（${periodEmployeeNames[personIdx].trim()}）：${timeError}`); return }
        }
        if (p.replacementName.trim() && p.replacementCalendarTarget) {
          const timeError = validateCalendarTime(p.replacementStartTime, p.replacementEndTime)
          if (timeError) { setError(`${formatDateJP(d.date)}（変更後担当 ${p.replacementName.trim()}）：${timeError}`); return }
        }
      }
    }

    const trimmedNames = periodEmployeeNames.map(n => n.trim())

    // 振休を設定する対象者がいる日には、代替出勤日と振休日を紐付けるグループIDを発行する
    const dayGroupIds = new Map<number, string>()
    const inputs: (CreateShiftChangeInput & { id: string })[] = dayDrafts.map((d, dayIdx) => {
      const detailInputs = d.persons.map((p, idx) => {
        const wantsLeave = p.replacementName.trim() !== '' && p.wantsCompensatoryLeave
        if (wantsLeave && !dayGroupIds.has(dayIdx)) dayGroupIds.set(dayIdx, crypto.randomUUID())
        return {
          employeeName: trimmedNames[idx],
          changeType: p.changeType,
          changeDetail: p.changeDetail.trim() || '（未入力）',
          isExternalSupport: p.isExternalSupport,
          supportFromFacilityId: p.isExternalSupport ? p.supportFromFacilityId || null : null,
          originalShift: p.originalShift || null,
          replacementName: p.replacementName.trim() || null,
          replacementOriginalShift: p.replacementOriginalShift || null,
          compensatoryLeaveStatus: wantsLeave
            ? (p.compensatoryLeaveTiming === 'now' ? 'linked' as const : 'unset' as const)
            : null,
          calendarTarget: p.calendarTarget,
          startTime: p.calendarTarget && p.startTime ? p.startTime : null,
          endTime: p.calendarTarget && p.endTime ? p.endTime : null,
          ...replacementInput(p.replacementName, p.replacementCalendarTarget, p.replacementStartTime, p.replacementEndTime),
        }
      })
      return {
        id: idFor(d.date),
        facilityId: periodForm.facilityId,
        targetDate: d.date,
        reason: periodForm.reason,
        handledBy: periodForm.handledBy,
        memo: periodForm.memo,
        details: detailInputs,
        relatedChangeGroupId: dayGroupIds.get(dayIdx) ?? null,
      }
    })

    // 振休日を同時に設定した分の追加レコードを生成
    const compensatoryInputs: (CreateShiftChangeInput & { id: string })[] = []
    dayDrafts.forEach((d, dayIdx) => {
      d.persons.forEach((p, personIdx) => {
        if (!p.replacementName.trim() || !p.wantsCompensatoryLeave) return
        if (p.compensatoryLeaveTiming !== 'now' || !p.compensatoryLeaveDate) return
        const leaveDetails: CreateShiftChangeInput['details'] = [{
          employeeName: p.replacementName.trim(),
          changeType: '振休',
          changeDetail: p.compensatoryLeaveDetail.trim() || '振休',
          isExternalSupport: false,
          supportFromFacilityId: null,
        }]
        if (p.compensatoryLeaveReplacementName.trim()) {
          leaveDetails.push({
            employeeName: p.compensatoryLeaveReplacementName.trim(),
            changeType: '交代出勤',
            changeDetail: `${p.replacementName.trim()}の振休対応で代替出勤`,
            isExternalSupport: false,
            supportFromFacilityId: null,
          })
        }
        compensatoryInputs.push({
          id: idFor(`${d.date}|振休|${personIdx}|${p.compensatoryLeaveDate}`),
          facilityId: periodForm.facilityId,
          targetDate: p.compensatoryLeaveDate,
          reason: periodForm.reason,
          handledBy: periodForm.handledBy,
          memo: periodForm.memo,
          details: leaveDetails,
          relatedChangeGroupId: dayGroupIds.get(dayIdx) ?? null,
        })
      })
    })

    setPendingInputs([...inputs, ...compensatoryInputs])
    setCompensatoryInputIds(new Set(compensatoryInputs.map(c => c.id)))
    setError(null)
    setShowConfirm(true)
  }

  // ── 確定保存 ──
  const handleConfirmSave = async () => {
    setShowConfirm(false)
    setSaving(true); setError(null); setEmailWarning(null); setEmailSuccess(null)
    try {
      // 全日分を1回でまとめて保存する（途中で失敗したら1件も保存されない。再試行しても同じIDなので二重にならない）
      const savedList = await onSaveBatch(pendingInputs)
      try {
        const facilityMap = new Map(facilities.map(f => [f.id, f.name]))
        const dayDetails = savedList.map(saved => ({
          date: saved.targetDate,
          persons: saved.details.map(det => ({
            employeeName: det.employeeName,
            changeType: det.changeType,
            originalShift: det.originalShift ?? undefined,
            replacementName: det.replacementName ?? undefined,
            replacementOriginalShift: det.replacementOriginalShift ?? undefined,
            isExternalSupport: det.isExternalSupport,
            supportFromFacilityName: det.supportFromFacilityId
              ? facilityMap.get(det.supportFromFacilityId) : undefined,
          })),
        }))

        const base = {
          facilityName: savedList[0].facilityName,
          reason: periodForm.reason,
          handledBy: periodForm.handledBy,
          memo: periodForm.memo,
          dayDetails,
        }
        const payload = dateMode === 'range'
          ? { ...base, isPeriod: true, startDate, endDate, count: savedList.length }
          : { ...base, isMulti: true, targetDates: [...selectedDates].sort(), count: savedList.length }

        const res = await fetch('/api/shift-change-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          setEmailWarning(`${savedList.length}件の記録は保存しましたが、メール通知に失敗しました`); return
        }
        setEmailSuccess(`${savedList.length}件の記録を保存し、通知メールを送信しました`); return
      } catch {
        setEmailWarning(`${savedList.length}件の記録は保存しましたが、メール通知に失敗しました`); return
      }
    } catch (e) {
      // 通信が切れた場合は保存できたかどうか画面側では分からないが、同じ内容で再登録しても二重にはならない
      setError(shiftChangeErrorMessage(e, '保存を確認できませんでした。もう一度「確認」から登録してください（同じ内容なら二重に登録されません）'))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (dateMode === 'single' || editing) handleSaveSingle()
    else handleSaveMultiDay()
  }

  // ── 振休日を後から設定 ──
  const handleLinkCompensatoryLeave = async () => {
    if (!editing || !linkingDetailId) return
    const targetDetail = editing.details.find(d => d.id === linkingDetailId)
    if (!targetDetail) return
    if (!linkForm.date) { setLinkError('振休日を入力してください'); return }

    setLinking(true); setLinkError(null)
    try {
      // 代替出勤日の登録時に発行済みのグループIDを引き継ぐ（通常は必ず存在する）
      const groupId = editing.relatedChangeGroupId ?? crypto.randomUUID()

      const leaveDetails: CreateShiftChangeInput['details'] = [{
        employeeName: targetDetail.employeeName,
        changeType: '振休',
        changeDetail: linkForm.changeDetail.trim() || '振休',
        isExternalSupport: false,
        supportFromFacilityId: null,
      }]
      if (linkForm.replacementName.trim()) {
        leaveDetails.push({
          employeeName: linkForm.replacementName.trim(),
          changeType: '交代出勤',
          changeDetail: `${targetDetail.employeeName}の振休対応で代替出勤`,
          isExternalSupport: false,
          supportFromFacilityId: null,
        })
      }

      const saved = await onCreateLinkedRecord({
        facilityId: editing.facilityId,
        targetDate: linkForm.date,
        reason: editing.reason,
        handledBy: editing.handledBy,
        memo: '',
        details: leaveDetails,
        relatedChangeGroupId: groupId,
      })
      await onLinkCompensatoryLeave(linkingDetailId)
      setLocallyLinkedIds(prev => new Set(prev).add(linkingDetailId))
      setRelatedRecords(prev => [...prev, saved])
      setLinkingDetailId(null)

      // 通知メール送信（失敗しても記録の保存には影響しない）
      try {
        await fetch('/api/shift-change-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isCompensatoryLeaveUpdate: true,
            facilityName: saved.facilityName,
            originalDate: editing.targetDate,
            compensatoryDate: saved.targetDate,
            employeeName: targetDetail.employeeName,
            replacementName: linkForm.replacementName.trim() || undefined,
            reason: editing.reason,
            handledBy: editing.handledBy,
          }),
        })
      } catch {
        // 通知失敗はここでは無視する（記録自体は保存済みのため）
      }
    } catch {
      setLinkError('振休日の設定に失敗しました')
    } finally {
      setLinking(false)
    }
  }

  const handleDelete = async () => {
    if (!editing || !onDelete) return
    if (!confirm('この記録を削除しますか？')) return
    setDeleting(true)
    try { await onDelete(editing.id); onClose() }
    catch { setError('削除に失敗しました') }
    finally { setDeleting(false) }
  }

  const saveLabel = saving ? '保存中…'
    : isMultiDay ? `確認（${datesCount}件）`
    : '保存'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="relative bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col">

        {/* ── 確認ダイアログ ── */}
        {showConfirm && (
          <div className="absolute inset-0 z-10 bg-white sm:rounded-2xl rounded-t-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-800">登録内容の確認</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                以下の内容で<span className="font-semibold text-blue-700">{pendingInputs.length}件</span>登録します。
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 space-y-1.5">
                {dateMode === 'range' ? (
                  <div><span className="font-medium text-gray-500">期間：</span>{formatDateSlash(startDate)} ～ {formatDateSlash(endDate)}</div>
                ) : (
                  <div>
                    <span className="font-medium text-gray-500">対象日：</span>
                    <span>{pendingInputs.map(i => formatDateSlash(i.targetDate)).join('、')}</span>
                  </div>
                )}
                <div><span className="font-medium text-gray-500">登録件数：</span>{pendingInputs.length}件</div>
                <div>
                  <span className="font-medium text-gray-500">カレンダー反映：</span>
                  {pendingInputs.reduce((n, inp) => n + inp.details.filter(d => d.calendarTarget).length, 0)}件
                  {(() => {
                    const rep = pendingInputs.reduce((n, inp) => n + inp.details.filter(d => d.replacementCalendarTarget).length, 0)
                    return rep > 0 ? `（ほかに変更後担当の代替出勤 ${rep}件）` : null
                  })()}
                </div>
                <div><span className="font-medium text-gray-500">施設：</span>{facilityName}</div>
                <div><span className="font-medium text-gray-500">入力者：</span>{periodForm.handledBy}</div>
                <div><span className="font-medium text-gray-500">理由：</span>{periodForm.reason}</div>
                {periodForm.memo && <div><span className="font-medium text-gray-500">メモ：</span>{periodForm.memo}</div>}
              </div>
              <div className="space-y-1.5">
                {pendingInputs.map((inp, inpIdx) => (
                  <div key={`${inp.targetDate}-${inpIdx}`} className="px-3 py-2 bg-blue-50 rounded-lg text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-blue-800 w-20 flex-shrink-0">{formatDateJP(inp.targetDate)}</span>
                      <span className="text-blue-600 text-xs">{inp.details.length}名</span>
                      {inp.details.some(d => d.changeType === '振休') && (
                        <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">振休</span>
                      )}
                    </div>
                    {compensatoryInputIds.has(inp.id) && (
                      <p className="pl-1 text-xs text-purple-800">この振休日の記録はカレンダーに自動反映されません</p>
                    )}
                    {inp.details.map((det, i) => (
                      <div key={i} className="flex items-center gap-2 pl-1 flex-wrap">
                        <span className="text-blue-700 text-xs flex-shrink-0">{det.employeeName}</span>
                        <span className="text-blue-700 text-xs flex-shrink-0">{det.changeType}</span>
                        <span className="text-blue-600 text-xs truncate">{det.changeDetail}</span>
                        {det.calendarTarget ? (
                          <span className="text-indigo-800 text-xs flex-shrink-0">
                            → {targetName(det.calendarTarget)}のカレンダー（{formatCalendarTime(det.startTime, det.endTime)}）
                          </span>
                        ) : !compensatoryInputIds.has(inp.id) && (
                          <span className="text-gray-400 text-xs flex-shrink-0">カレンダー：反映しない</span>
                        )}
                        {det.replacementName && (
                          <span className="w-full pl-3 text-xs">
                            <span className="text-teal-800">変更後担当 {det.replacementName}</span>
                            {det.replacementCalendarTarget ? (
                              <span className="text-teal-800">
                                {' '}→ {targetName(det.replacementCalendarTarget)}のカレンダー（代替出勤・{formatCalendarTime(det.replacementStartTime, det.replacementEndTime)}）
                              </span>
                            ) : (
                              <span className="text-gray-400">：カレンダー反映しない</span>
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowConfirm(false)} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                キャンセル
              </button>
              <button onClick={handleConfirmSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />{saving ? '保存中…' : '登録する'}
              </button>
            </div>
          </div>
        )}

        {/* ── ヘッダー ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {editing ? 'シフト変更記録を編集' : 'シフト変更を記録'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* ── ボディ ── */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* モード切替 */}
          {!editing && (
            <div className="flex gap-5">
              {(['single', 'range', 'multi'] as DateMode[]).map(mode => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="radio" name="dateMode" checked={dateMode === mode}
                    onChange={() => { setDateMode(mode); setError(null) }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm font-medium text-gray-700">{MODE_LABELS[mode]}</span>
                </label>
              ))}
            </div>
          )}

          {/* ════════ 単日モード ════════ */}
          {(editing || dateMode === 'single') && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">施設 <span className="text-red-500">*</span></label>
                <select value={form.facilityId} onChange={e => changeRecordFacility(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">選択してください</option>
                  {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">対象日 <span className="text-red-500">*</span></label>
                  <input type="date" value={form.targetDate} onChange={e => setField('targetDate', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">入力者 <span className="text-red-500">*</span></label>
                  <input type="text" value={form.handledBy} onChange={e => setField('handledBy', e.target.value)}
                    placeholder="例：福田"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-gray-600 mb-3">対象者明細（最大{MAX_TARGETS}名）</p>
                {details.map((d, i) => (
                  <div key={i} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                        {i + 1}人目
                        {d.chainPosition != null && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-medium">
                            <Link2 size={11} />応援チェーン {d.chainPosition}人目
                          </span>
                        )}
                      </span>
                      {details.length > 1 && (
                        <button type="button" onClick={() => removeDetail(i)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-500 hover:bg-red-50 border border-red-200">
                          <Minus size={11} />削除
                        </button>
                      )}
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1">対象者 <span className="text-red-500">*</span></label>
                      <input type="text" value={d.employeeName}
                        onChange={e => updateDetail(i, { employeeName: e.target.value, suggestTarget: true })}
                        placeholder="例：山田パート"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {d.chainPosition != null && (() => {
                        const k = d.chainPosition
                        const prevStep = chain[k - 2]?.step
                        const why = k === 1 ? 'この記録の施設'
                          : k === 2 ? `${prevStep?.employeeName.trim() || '1人目'}さんの代わり`
                          : `${prevStep?.employeeName.trim() || `${k - 1}人目`}さんの元施設`
                        return (
                          <p className="mt-1 text-xs text-indigo-900">
                            勤務先：<span className="font-semibold">{facName(chainWork[i]) || '（施設・応援元を選んでください）'}</span>
                            <span className="text-gray-500">（{why}）</span>
                          </p>
                        )
                      })()}
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">変更種別 <span className="text-red-500">*</span></label>
                      <div className="flex flex-wrap gap-1.5">
                        {SHIFT_CHANGE_TYPES.map(t => (
                          <button key={t} type="button" onClick={() => updateDetail(i, { changeType: t })}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                              d.changeType === t
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                            )}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-2.5 space-y-2">
                      <ShiftBeforeAfterFields draft={d} onChange={patch => updateDetail(i, patch)} />
                      <ChangeDetailTextField draft={d} place={detailPlaces[i]} required warning={staleNameWarning(d)} onChange={patch => updateDetail(i, patch)} />
                    </div>
                    <div className="mb-2.5 space-y-2">
                      <CalendarTargetField
                        employeeName={d.employeeName}
                        value={d.calendarTarget}
                        candidates={calendarCandidates}
                        suggest={d.suggestTarget}
                        onChange={target => updateDetail(i, target ? { calendarTarget: target } : { calendarTarget: null, startTime: '', endTime: '' })}
                      />
                      {d.calendarTarget && (
                        <CalendarTimeFields
                          startTime={d.startTime}
                          endTime={d.endTime}
                          onChange={(startTime, endTime) => updateDetail(i, { startTime, endTime })}
                        />
                      )}
                      {d.calendarTarget && d.chainPosition != null && chainWork[i] && chainWork[i] !== form.facilityId && (
                        <p className="text-xs text-indigo-900">カレンダーには「{facName(chainWork[i])}／{d.changeType}」で入ります</p>
                      )}
                    </div>

                    {/* 応援チェーンの人は、次の応援者を自分の明細で入れる（変更後担当の欄は使わない＝同じ人を2回入れない） */}
                    {d.chainPosition != null ? (
                      <div className="mb-2.5 p-2.5 rounded-lg border border-indigo-200 bg-indigo-50/60 space-y-1.5">
                        {(() => {
                          const next = chain[d.chainPosition]?.step
                          const isLast = d.chainPosition === chain.length
                          return (
                            <>
                              {next ? (
                                <p className="text-xs text-indigo-900">
                                  代わりに入る人：<span className="font-semibold">{next.employeeName.trim() || '（名前未入力）'}</span>
                                  <span className="text-gray-500">（応援チェーン{d.chainPosition + 1}人目の明細で入力・カレンダー反映します）</span>
                                </p>
                              ) : null}
                              {isLast && d.chainPosition >= 2 && (
                                chain.length < MAX_CHAIN && details.length < MAX_TARGETS ? (
                                  d.supportFromFacilityId ? (
                                    <button type="button" onClick={continueChain}
                                      className="text-xs text-indigo-700 underline hover:text-indigo-900">
                                      ＋ 応援の続きを追加（{d.employeeName.trim() || 'この人'}さんの元施設「{facName(d.supportFromFacilityId)}」へ応援する人）
                                    </button>
                                  ) : (
                                    <p className="text-xs text-gray-500">応援元施設を選ぶと、その施設へ応援する人を続けて追加できます（必要なときだけ）</p>
                                  )
                                ) : (
                                  <p className="text-xs text-gray-500">応援チェーンは{MAX_CHAIN}人まで（明細は全体で{MAX_TARGETS}名まで）です</p>
                                )
                              )}
                              {d.chainPosition === 1 && (
                                <button type="button" onClick={unlinkChain}
                                  className="block text-xs text-gray-600 underline hover:text-gray-900">
                                  応援チェーンを解除（明細は残す）
                                </button>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    ) : replacementOpen(d) ? (
                      <div className="mb-2.5 p-2.5 rounded-lg border border-teal-200 bg-teal-50/50 space-y-2">
                        <p className="text-xs font-semibold text-teal-900">変更後担当（代わりに入る人） <span className="font-normal text-gray-400">（任意）</span></p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当</label>
                            <input type="text" value={d.replacementName ?? ''}
                              onChange={e => updateDetailReplacementName(i, e.target.value)}
                              placeholder="例：田中パート"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当の元シフト</label>
                            <input type="text" value={d.replacementOriginalShift ?? ''}
                              onChange={e => updateDetail(i, { replacementOriginalShift: e.target.value })}
                              placeholder="例：休み"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
                          </div>
                        </div>
                        {d.replacementName?.trim() ? (
                          <>
                            <CalendarTargetField
                              label="変更後担当のカレンダーに反映"
                              employeeName={d.replacementName}
                              value={d.replacementCalendarTarget}
                              candidates={calendarCandidates}
                              suggest={d.suggestReplacementTarget}
                              onChange={target => updateDetail(i, target ? { replacementCalendarTarget: target } : CLEAR_REPLACEMENT_TARGET)}
                            />
                            {d.replacementCalendarTarget && (
                              <CalendarTimeFields
                                startTime={d.replacementStartTime}
                                endTime={d.replacementEndTime}
                                onChange={(replacementStartTime, replacementEndTime) => updateDetail(i, { replacementStartTime, replacementEndTime })}
                              />
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-gray-500">名前を入れると、変更後担当のカレンダーにも「代替出勤」として反映できます</p>
                        )}
                      </div>
                    ) : (
                      <button type="button" onClick={() => updateDetail(i, { showReplacement: true })}
                        className="mb-2.5 text-xs text-teal-700 underline hover:text-teal-900">
                        ＋ 変更後担当を入力（1人のヘルプで完結）
                      </button>
                    )}
                    {/* 応援が連鎖する場合だけ使う。連鎖しない複数人の変更は下の「対象者を追加」で入力する */}
                    {d.chainPosition == null && chain.length === 0 && details.length < MAX_TARGETS && (
                      <div className="mb-2.5">
                        <button type="button" onClick={() => startChain(i)}
                          className="block text-left text-xs text-indigo-700 underline hover:text-indigo-900">
                          ＋ 3人以上の変更はこちら（応援チェーン）
                        </button>
                        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                          応援が連鎖する場合に使用します。例：Aさん欠勤 → Bさんが応援 → CさんがBさんの代わりに勤務
                        </p>
                      </div>
                    )}
                    {d.chainPosition != null && d.chainPosition >= 2 ? (
                      <div className="pt-2 border-t border-gray-200">
                        <label className="block text-xs font-medium text-gray-700 mb-1">応援元施設（この人がもともと入る施設） <span className="text-red-500">*</span></label>
                        <select value={d.supportFromFacilityId}
                          onChange={e => updateDetail(i, { supportFromFacilityId: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                          <option value="">選択してください</option>
                          {activeFacilities.filter(f => f.id !== chainWork[i] || f.id === d.supportFromFacilityId).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                    ) : (
                    <div className="pt-2 border-t border-gray-200">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={d.isExternalSupport}
                          onChange={e => updateDetail(i, {
                            isExternalSupport: e.target.checked,
                            supportFromFacilityId: e.target.checked ? d.supportFromFacilityId : '',
                          })}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className="text-xs font-medium text-gray-700">他施設からの調整</span>
                      </label>
                      {d.isExternalSupport && (
                        <div className="mt-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">調整元施設 <span className="text-red-500">*</span></label>
                          <select value={d.supportFromFacilityId}
                            onChange={e => updateDetail(i, { supportFromFacilityId: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">選択してください</option>
                            {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                ))}
                {details.length < MAX_TARGETS && (
                  <button type="button" onClick={() => setDetails(prev => [...prev, { ...EMPTY_DETAIL }])}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus size={14} />対象者を追加（{details.length}/{MAX_TARGETS}名）
                  </button>
                )}
              </div>
              <div className="border-t pt-3 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">理由 <span className="text-red-500">*</span></label>
                  <input type="text" value={form.reason} onChange={e => setField('reason', e.target.value)}
                    placeholder="例：体調不良、電車遅延"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">メモ <span className="text-gray-400 font-normal">（任意）</span></label>
                  <textarea value={form.memo} onChange={e => setField('memo', e.target.value)} rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>
              </div>

              {/* ── 関連する振休 ── */}
              {editing && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                    <Link2 size={13} />関連する振休
                  </p>
                  {loadingRelated ? (
                    <p className="text-xs text-gray-400">読み込み中…</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                        <p className="font-semibold text-gray-700 mb-1.5">{formatDateJP(editing.targetDate)}（この記録）</p>
                        {editing.details.map(d => {
                          const isUnset = d.compensatoryLeaveStatus === 'unset' && !locallyLinkedIds.has(d.id)
                          return (
                            <div key={d.id} className="flex items-center gap-2 flex-wrap text-xs text-gray-600 mb-1">
                              <span>{d.employeeName}　{d.changeType}</span>
                              {isUnset && (
                                <>
                                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">振休未設定</span>
                                  <button type="button"
                                    onClick={() => {
                                      setLinkingDetailId(d.id)
                                      setLinkForm({ date: '', changeDetail: '振休', replacementName: '' })
                                      setLinkError(null)
                                    }}
                                    className="text-purple-600 underline hover:text-purple-800">
                                    振休日を設定
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {relatedRecords.length > 0 && (
                        <>
                          <p className="text-center text-xs text-purple-600">↓ 振休</p>
                          {relatedRecords.map(r => (
                            <div key={r.id} className="px-3 py-2 bg-purple-50 rounded-lg border border-purple-200 text-sm">
                              <p className="font-semibold text-purple-800 mb-1.5">{formatDateJP(r.targetDate)}</p>
                              {r.details.map(d => (
                                <p key={d.id} className="text-xs text-purple-700">{d.employeeName}　{d.changeType}</p>
                              ))}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {linkingDetailId && (
                    <div className="mt-3 p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
                      <p className="text-xs font-semibold text-purple-800">振休日を設定</p>
                      <CompensatoryCalendarNote />
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日 <span className="text-red-500">*</span></label>
                        <input type="date" value={linkForm.date}
                          onChange={e => setLinkForm(f => ({ ...f, date: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更内容</label>
                        <input type="text" value={linkForm.changeDetail}
                          onChange={e => setLinkForm(f => ({ ...f, changeDetail: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          振休日の代替出勤者 <span className="text-gray-400 font-normal">（任意）</span>
                        </label>
                        <input type="text" value={linkForm.replacementName}
                          onChange={e => setLinkForm(f => ({ ...f, replacementName: e.target.value }))}
                          placeholder="例：鈴木パート"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      {linkError && <p className="text-xs text-red-600">{linkError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => setLinkingDetailId(null)} disabled={linking}
                          className="px-3 py-1.5 rounded-lg text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                          キャンセル
                        </button>
                        <button type="button" onClick={handleLinkCompensatoryLeave} disabled={linking}
                          className="px-3 py-1.5 rounded-lg text-xs bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60">
                          {linking ? '設定中…' : '設定する'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════════ 期間 / 複数日選択 ════════ */}
          {isMultiDay && (
            <>
              {/* 期間：開始日・終了日 */}
              {dateMode === 'range' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">期間 <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-2">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <span className="text-sm text-gray-500 flex-shrink-0">～</span>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {datesCount > 0 && datesCount <= 31 && <p className="mt-1 text-xs text-blue-600">{datesCount}日間</p>}
                  {datesCount > 31 && <p className="mt-1 text-xs text-red-500">期間が長すぎます（最大31日）</p>}
                </div>
              )}

              {/* 複数日選択：日付追加 */}
              {dateMode === 'multi' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">対象日 <span className="text-red-500">*</span></label>
                  <div className="flex gap-2 mb-2">
                    <input type="date" value={newDateInput} onChange={e => setNewDateInput(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={addSelectedDate}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 flex-shrink-0">
                      <Plus size={14} />追加
                    </button>
                  </div>
                  {selectedDates.length === 0 ? (
                    <p className="text-xs text-gray-400">日付を追加してください</p>
                  ) : (
                    <div>
                      <p className="text-xs text-blue-600 mb-1.5">{selectedDates.length}日選択済み</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedDates.map(date => (
                          <span key={date} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                            {formatDateJP(date)}
                            <button type="button" onClick={() => removeSelectedDate(date)}
                              className="text-blue-500 hover:text-blue-800 ml-0.5">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 共通：施設 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">施設 <span className="text-red-500">*</span></label>
                <select value={periodForm.facilityId} onChange={e => changePeriodFacility(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">選択してください</option>
                  {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              {/* 共通：入力者 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">入力者 <span className="text-red-500">*</span></label>
                <input type="text" value={periodForm.handledBy} onChange={e => setPeriodField('handledBy', e.target.value)}
                  placeholder="例：福田"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* 共通：対象者（最大MAX_TARGETS名） */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">対象者（最大{MAX_TARGETS}名） <span className="text-red-500">*</span></label>
                <div className="space-y-2">
                  {periodEmployeeNames.map((name, i) => (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input type="text" value={name}
                          onChange={e => updatePersonName(i, e.target.value)}
                          placeholder="例：山田パート"
                          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        {periodEmployeeNames.length > 1 && (
                          <button type="button" onClick={() => removePersonName(i)}
                            className="flex-shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 border border-red-200">
                            <Minus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-indigo-800">カレンダーへの反映先と時刻は、下の「日別入力」で日ごと・対象者ごとに選べます</p>
                </div>
                {periodEmployeeNames.length < MAX_TARGETS && (
                  <button type="button" onClick={addPersonName}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus size={12} />対象者を追加（{periodEmployeeNames.length}/{MAX_TARGETS}名）
                  </button>
                )}
              </div>

              {/* 共通：理由 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">理由 <span className="text-red-500">*</span></label>
                <input type="text" value={periodForm.reason} onChange={e => setPeriodField('reason', e.target.value)}
                  placeholder="例：体調不良、有休、研修"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* 共通：メモ */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メモ <span className="text-gray-400 font-normal">（任意）</span></label>
                <textarea value={periodForm.memo} onChange={e => setPeriodField('memo', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* 日別入力 */}
              {datesCount > 0 && (dateMode === 'multi' || datesCount <= 31) && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-3">日別入力</p>

                  {/* 一括入力 */}
                  <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                    <p className="text-xs font-semibold text-blue-700 mb-2.5">一括入力（全員・全日に適用）</p>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {SHIFT_CHANGE_TYPES.map(t => (
                        <button key={t} type="button" onClick={() => setBulk(p => ({ ...p, changeType: t }))}
                          className={cn(
                            'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                            bulk.changeType === t
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                          )}>{t}</button>
                      ))}
                    </div>
                    <div className="mb-2">
                      <ShiftBeforeAfterFields
                        draft={{ ...bulk, changeDetail: '', detailAuto: true }}
                        onChange={patch => setBulk(p => ({ ...p, ...patch }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当</label>
                        <input type="text" value={bulk.replacementName}
                          onChange={e => setBulk(p => ({ ...p, replacementName: e.target.value }))}
                          placeholder="例：田中パート"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当の元シフト</label>
                        <input type="text" value={bulk.replacementOriginalShift}
                          onChange={e => setBulk(p => ({ ...p, replacementOriginalShift: e.target.value }))}
                          placeholder="例：休み、未定"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                    <p className="mb-2.5 text-xs text-gray-500">
                      変更内容は「{generatedDetail({ ...bulk, changeDetail: '', detailAuto: true }, dayPlace(bulk)) || '（シフトを入れると作成）'}」で全日に入り、適用後に日ごとに書き換えられます
                    </p>
                    <div className="mb-2.5 pt-2 border-t border-blue-200">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={bulk.isExternalSupport}
                          onChange={e => setBulk(p => ({ ...p, isExternalSupport: e.target.checked, supportFromFacilityId: e.target.checked ? p.supportFromFacilityId : '' }))}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className="text-xs font-medium text-gray-700">他施設からの応援</span>
                      </label>
                      {bulk.isExternalSupport && (
                        <select value={bulk.supportFromFacilityId}
                          onChange={e => setBulk(p => ({ ...p, supportFromFacilityId: e.target.value }))}
                          className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="">応援元施設を選択</option>
                          {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      )}
                    </div>
                    {dayDrafts.some(d => d.persons.some(p => p.calendarTarget)) && (
                      <div className="mb-2.5">
                        <CalendarTimeFields
                          startTime={bulk.startTime}
                          endTime={bulk.endTime}
                          onChange={(startTime, endTime) => setBulk(p => ({ ...p, startTime, endTime }))}
                        />
                        <p className="mt-1 text-xs text-gray-500">時刻を空のまま適用すると、日ごとに入れた時刻はそのまま残ります</p>
                      </div>
                    )}
                    <button type="button" onClick={applyBulk}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors">
                      <CheckSquare size={14} />全日に適用
                    </button>
                  </div>

                  {/* 日別 */}
                  {dayDrafts.map((d, dayIdx) => (
                    <div key={d.date} className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-2">{formatDateJP(d.date)}</p>

                      {d.persons.map((p, personIdx) => (
                        <div key={personIdx} className={cn(personIdx > 0 && 'mt-3 pt-3 border-t border-gray-200')}>
                          <p className="text-xs font-semibold text-gray-500 mb-2">
                            {periodEmployeeNames[personIdx]?.trim() || `対象者${personIdx + 1}`}
                          </p>

                          {/* カレンダーへの反映先と時刻（日付ごとに選ぶ。本人確認は単日と同じ） */}
                          <div className="mb-2.5 space-y-2">
                            <CalendarTargetField
                              employeeName={periodEmployeeNames[personIdx] ?? ''}
                              value={p.calendarTarget}
                              candidates={calendarCandidates}
                              onChange={target => updateDayPersonTarget(dayIdx, personIdx, target)}
                            />
                            {p.calendarTarget && (
                              <CalendarTimeFields
                                startTime={p.startTime}
                                endTime={p.endTime}
                                onChange={(startTime, endTime) => updateDayPerson(dayIdx, personIdx, { startTime, endTime })}
                              />
                            )}
                            {p.calendarTarget && dayDrafts.length > 1
                              && dayDrafts.some(other => targetKey(other.persons[personIdx]?.calendarTarget) !== targetKey(p.calendarTarget)) && (
                              <button type="button" onClick={() => copyTargetToAllDays(personIdx, p.calendarTarget!)}
                                className="text-xs text-indigo-700 underline hover:text-indigo-900">
                                全日の反映先を「{targetName(p.calendarTarget)}」にする
                              </button>
                            )}
                          </div>

                          {/* 変更種別 */}
                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                            {SHIFT_CHANGE_TYPES.map(t => (
                              <button key={t} type="button" onClick={() => updateDayPerson(dayIdx, personIdx, { changeType: t })}
                                className={cn(
                                  'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                                  p.changeType === t
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                                )}>{t}</button>
                            ))}
                          </div>

                          {/* 変更前・変更後シフト */}
                          <div className="mb-2">
                            <ShiftBeforeAfterFields draft={p} onChange={patch => updateDayPerson(dayIdx, personIdx, patch)} />
                          </div>

                          {/* 変更後担当・その元シフト */}
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当</label>
                              <input type="text" value={p.replacementName}
                                onChange={e => updateDayReplacementName(dayIdx, personIdx, e.target.value)}
                                placeholder="例：田中パート"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当の元シフト</label>
                              <input type="text" value={p.replacementOriginalShift}
                                onChange={e => updateDayPerson(dayIdx, personIdx, { replacementOriginalShift: e.target.value })}
                                placeholder="例：休み、未定"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                          </div>

                          {/* 変更内容（自動作成・書き換え可） */}
                          <div className="mb-2">
                            <ChangeDetailTextField draft={p} place={dayPlace(p)} onChange={patch => updateDayPerson(dayIdx, personIdx, patch)} />
                          </div>

                          {/* 変更後担当のカレンダー反映（日付ごと。元の対象者とは別に設定する） */}
                          {p.replacementName.trim() !== '' && (
                            <div className="mb-2.5 p-2.5 rounded-lg border border-teal-200 bg-teal-50/50 space-y-2">
                              <CalendarTargetField
                                label="変更後担当のカレンダーに反映"
                                employeeName={p.replacementName}
                                value={p.replacementCalendarTarget}
                                candidates={calendarCandidates}
                                onChange={target => updateDayReplacementTarget(dayIdx, personIdx, target)}
                              />
                              {p.replacementCalendarTarget && (
                                <CalendarTimeFields
                                  startTime={p.replacementStartTime}
                                  endTime={p.replacementEndTime}
                                  onChange={(replacementStartTime, replacementEndTime) => updateDayPerson(dayIdx, personIdx, { replacementStartTime, replacementEndTime })}
                                />
                              )}
                              {p.replacementCalendarTarget && dayDrafts.some((other, oi) => oi !== dayIdx
                                && typedNameKey(other.persons[personIdx]?.replacementName) === typedNameKey(p.replacementName)
                                && targetKey(other.persons[personIdx]?.replacementCalendarTarget) !== targetKey(p.replacementCalendarTarget)) && (
                                <button type="button" onClick={() => copyReplacementTargetToSameNameDays(personIdx, p.replacementName, p.replacementCalendarTarget!)}
                                  className="text-xs text-teal-700 underline hover:text-teal-900">
                                  変更後担当が「{p.replacementName.trim()}」の日の反映先を、すべて「{targetName(p.replacementCalendarTarget)}」にする
                                </button>
                              )}
                            </div>
                          )}

                          {/* 振休 */}
                          {p.replacementName.trim() !== '' && (
                            <div className="mb-2 pt-2 border-t border-gray-200">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={p.wantsCompensatoryLeave}
                                  onChange={e => updateDayPerson(dayIdx, personIdx, {
                                    wantsCompensatoryLeave: e.target.checked,
                                    compensatoryLeaveTiming: e.target.checked ? p.compensatoryLeaveTiming : 'later',
                                  })}
                                  className="w-4 h-4 rounded accent-purple-600" />
                                <span className="text-xs font-medium text-gray-700">振休を設定する（{p.replacementName}）</span>
                              </label>
                              {p.wantsCompensatoryLeave && (
                                <div className="mt-2 pl-1 space-y-2">
                                  <div className="flex gap-4">
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <input type="radio" checked={p.compensatoryLeaveTiming === 'now'}
                                        onChange={() => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveTiming: 'now' })}
                                        className="w-3.5 h-3.5 accent-purple-600" />
                                      <span className="text-xs text-gray-700">振休日を同時に設定</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <input type="radio" checked={p.compensatoryLeaveTiming === 'later'}
                                        onChange={() => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveTiming: 'later' })}
                                        className="w-3.5 h-3.5 accent-purple-600" />
                                      <span className="text-xs text-gray-700">振休日は後で設定</span>
                                    </label>
                                  </div>
                                  {p.compensatoryLeaveTiming === 'now' && (
                                    <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-200 space-y-2">
                                      <CompensatoryCalendarNote />
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日 <span className="text-red-500">*</span></label>
                                        <input type="date" value={p.compensatoryLeaveDate}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveDate: e.target.value })}
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日の変更内容</label>
                                        <input type="text" value={p.compensatoryLeaveDetail}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveDetail: e.target.value })}
                                          placeholder="振休"
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                          振休日の代替出勤者 <span className="text-gray-400 font-normal">（任意）</span>
                                        </label>
                                        <input type="text" value={p.compensatoryLeaveReplacementName}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveReplacementName: e.target.value })}
                                          placeholder="例：鈴木パート"
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 他施設応援 */}
                          <div className="pt-2 border-t border-gray-200">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input type="checkbox" checked={p.isExternalSupport}
                                onChange={e => updateDayPerson(dayIdx, personIdx, {
                                  isExternalSupport: e.target.checked,
                                  supportFromFacilityId: e.target.checked ? p.supportFromFacilityId : '',
                                })}
                                className="w-4 h-4 rounded accent-blue-600" />
                              <span className="text-xs font-medium text-gray-700">他施設からの応援</span>
                            </label>
                            {p.isExternalSupport && (
                              <select value={p.supportFromFacilityId}
                                onChange={e => updateDayPerson(dayIdx, personIdx, { supportFromFacilityId: e.target.value })}
                                className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">応援元施設を選択</option>
                                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {emailWarning && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{emailWarning}</p>
          )}
          {emailSuccess && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{emailSuccess}</p>
          )}
        </div>

        {/* ── フッター ── */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t flex-shrink-0">
          {editing && onDelete ? (
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-60">
              <Trash2 size={14} />削除
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
              {emailWarning || emailSuccess ? '閉じる' : 'キャンセル'}
            </button>
            {!emailWarning && !emailSuccess && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />{saveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
