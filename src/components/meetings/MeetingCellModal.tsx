'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  X, CalendarClock, CalendarCheck, CalendarX, CheckCircle2, Plus,
  FileText, Upload, ExternalLink, Trash2, ArrowRightLeft,
} from 'lucide-react'
import { cn, generateTimeSlots } from '@/lib/utils'
import { parseTargetMonth, getMeetingCellStatus, MEETING_CELL_STATUS_LABELS } from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import { assigneeKey, parseAssigneeKey } from '@/lib/meetingAssignee'
import { meetingMinutesService } from '@/services/meetingMinutesService'
import { validatePdfFile } from '@/services/meetingMinutesStorageService'
import type {
  Meeting, MeetingType, MeetingAssignee, MeetingMinute,
  ConfirmMeetingScheduleInput, RescheduleMeetingInput, CreateManualMeetingScheduleInput,
} from '@/lib/types'

interface MeetingCellModalProps {
  isOpen: boolean
  meeting: Meeting | null
  facilityName: string
  meetingType: MeetingType
  targetMonth: string
  candidateAssignees: MeetingAssignee[]  // 当該施設の有効な担当者候補（G長・主任 → リーダーの順）
  onClose: () => void
  onAddManual: (input: { memo: string; schedule?: CreateManualMeetingScheduleInput }) => Promise<void>
  onConfirmSchedule: (input: ConfirmMeetingScheduleInput) => Promise<void>
  onReschedule: (input: RescheduleMeetingInput) => Promise<void>
  onCancelSchedule: () => Promise<void>
  onMarkDone: (executedDate?: string) => Promise<void>
  onUploadMinute: (meeting: Meeting, file: File) => Promise<{ minute: MeetingMinute; notification?: 'sent' | 'skipped' | 'failed' }>
  onDeleteMinute: (minute: MeetingMinute) => Promise<void>
  onMoveTargetMonth: (newTargetMonth: string) => Promise<void>
  onMoveTargetMonthCascade: (newTargetMonth: string) => Promise<void>
  onDeleteMeeting: () => Promise<void>
}

// 'confirm'/'reschedule' は 'schedule' に統合（保存操作の1本化。
// schedule_idの有無はhandleSaveSchedule内部で判定してconfirmSchedule/rescheduleMeetingを出し分ける）
type Mode = 'view' | 'add' | 'schedule' | 'markDone' | 'moveMonth'

const TIME_SLOTS = generateTimeSlots(8, 20)

// schedule未作成（新規・日程未定）のMTにだけ使う時間の初期値
// （meetingScheduleService.confirmSchedule の未指定時デフォルトと揃えている）
const DEFAULT_START_TIME = '10:00'
const DEFAULT_END_TIME = '11:00'

// DBの時刻（'HH:MM' または 'HH:MM:SS'）をセレクトの値（'HH:MM'）に揃える
const toTimeValue = (t: string) => t.slice(0, 5)

// 既存scheduleの時刻が選択肢（08:00〜20:00の30分刻み）に無い場合も、現在値として選択肢に含める
const withCurrentSlot = (current: string) =>
  TIME_SLOTS.includes(current) ? TIME_SLOTS : [...TIME_SLOTS, current].sort()

function formatMonthLabel(targetMonth: string): string {
  const { year, month } = parseTargetMonth(targetMonth)
  return `${year}年${month}月`
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatFullDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}/${m}/${day}`
}

export function MeetingCellModal({
  isOpen, meeting, facilityName, meetingType, targetMonth,
  candidateAssignees,
  onClose, onAddManual, onConfirmSchedule, onReschedule, onCancelSchedule, onMarkDone,
  onUploadMinute, onDeleteMinute,
  onMoveTargetMonth, onMoveTargetMonthCascade, onDeleteMeeting,
}: MeetingCellModalProps) {
  const [mode, setMode] = useState<Mode>('view')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [addMemo, setAddMemo] = useState('')
  // 実施予定日は「未入力」を許容するため、今日の日付を勝手に初期値にしない
  const [date, setDate] = useState('')
  const [isAllDay, setIsAllDay] = useState(false)
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME)
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME)
  // 選択中の担当者。G長・主任とリーダーを区別するため "type:id" のキーで持つ（'' = 未選択 / 変更しない）
  const [selectedAssigneeKey, setSelectedAssigneeKey] = useState('')
  const [executedDate, setExecutedDate] = useState('')
  const [moveMonth, setMoveMonth] = useState('')
  const [moveCascade, setMoveCascade] = useState(false)

  const [minutes, setMinutes] = useState<MeetingMinute[]>([])
  const [minutesLoading, setMinutesLoading] = useState(false)
  const [minutesError, setMinutesError] = useState('')
  // 議事録通知メールの結果（アップロード自体は完了している前提）
  const [minutesNotice, setMinutesNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null)
  // 議事録通知の結果は、モーダルを開き直した・別のMTに切り替えた時だけ消す
  // （保存後の再読込で meeting が更新されても、直前の通知結果は表示し続ける）
  useEffect(() => { setMinutesNotice(null) }, [isOpen, meeting?.id])
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setMode(meeting ? 'view' : 'add')
    setError('')
    setAddMemo('')
    setDate(meeting?.scheduleDate ?? '')
    if (meeting?.scheduleId) {
      // 既存scheduleがある場合は、現在登録されている値を初期値にする
      // （デフォルト値で上書き保存してしまわないように）。
      // 終日予定の時刻は '00:00' のため、終日を外したときはデフォルト時間を出す
      const allDay = meeting.scheduleIsAllDay ?? false
      setIsAllDay(allDay)
      setStartTime(!allDay && meeting.scheduleStartTime ? toTimeValue(meeting.scheduleStartTime) : DEFAULT_START_TIME)
      setEndTime(!allDay && meeting.scheduleEndTime ? toTimeValue(meeting.scheduleEndTime) : DEFAULT_END_TIME)
      setSelectedAssigneeKey(meeting.scheduleAssignee ? assigneeKey(meeting.scheduleAssignee) : '')
    } else {
      setIsAllDay(false)
      setStartTime(DEFAULT_START_TIME)
      setEndTime(DEFAULT_END_TIME)
      setSelectedAssigneeKey(candidateAssignees.length === 1 ? assigneeKey(candidateAssignees[0]) : '')
    }
    // 実施日は「今日」を勝手に初期値にしない。
    // schedule_idがあり予定日が取得できる場合のみ、その予定日を初期値にする
    setExecutedDate(meeting?.scheduleId && meeting?.scheduleDate ? meeting.scheduleDate : '')
    setMoveMonth(meeting ? meeting.targetMonth.slice(0, 7) : '')
    setMoveCascade(false)
    setMinutesError('')
  }, [isOpen, meeting, candidateAssignees])

  useEffect(() => {
    if (!isOpen || !meeting || meeting.status !== 'done') { setMinutes([]); return }
    let cancelled = false
    setMinutesLoading(true)
    meetingMinutesService.getByMeetingId(meeting.id)
      .then(data => { if (!cancelled) setMinutes(data) })
      .catch(() => { if (!cancelled) setMinutesError('議事録一覧の取得に失敗しました') })
      .finally(() => { if (!cancelled) setMinutesLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, meeting])

  const cellStatus = useMemo(() => getMeetingCellStatus(meeting ?? undefined), [meeting])

  if (!isOpen) return null

  // 担当者候補（G長・主任 + リーダー）が合計1名なら自動選択、それ以外は選択必須
  const needsManagerChoice = candidateAssignees.length !== 1
  const managerLabel = candidateAssignees.length === 1
    ? candidateAssignees[0].name
    : candidateAssignees.length === 0
      ? 'この施設に有効な担当者が割り当てられていません'
      : undefined
  const selectedAssignee = parseAssigneeKey(selectedAssigneeKey) ?? undefined
  const currentAssigneeOutsideCandidates = !!meeting?.scheduleAssignee &&
    !candidateAssignees.some(a => a.type === meeting.scheduleAssignee?.type && a.id === meeting.scheduleAssignee?.id)

  // 担当者の選択肢。G長・主任とリーダーが両方いる場合はグループ分けして表示する
  const renderAssigneeOptions = (list: MeetingAssignee[]) => {
    const managers = list.filter(a => a.type === 'group_manager')
    const leaders = list.filter(a => a.type === 'staff_member')
    const toOption = (a: MeetingAssignee) => (
      <option key={assigneeKey(a)} value={assigneeKey(a)}>{a.name}</option>
    )
    if (managers.length === 0 || leaders.length === 0) return list.map(toOption)
    return (
      <>
        <optgroup label="G長・主任">{managers.map(toOption)}</optgroup>
        <optgroup label="リーダー">{leaders.map(toOption)}</optgroup>
      </>
    )
  }

  // 'schedule'モードに入った時点でschedule_idが未設定だったかどうか
  // （confirmSchedule / rescheduleMeeting の出し分けと、担当者の必須/任意の判定に使う）
  const wasUnscheduled = !meeting?.scheduleId

  const runAction = async (fn: () => Promise<void>) => {
    setSaving(true)
    setError('')
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // 手動追加（統合フォーム）:
  //   実施予定日が空 → meetingだけ登録（日付未定）
  //   実施予定日あり → meeting作成と同時にschedule確定まで1回の操作で行う
  const handleAddUnified = () => {
    if (!date) {
      runAction(() => onAddManual({ memo: addMemo.trim() }))
      return
    }
    if (!isAllDay && startTime >= endTime) { setError('終了時間は開始時間より後にしてください'); return }
    if (needsManagerChoice && !selectedAssignee) { setError('担当者を選択してください'); return }
    runAction(() => onAddManual({
      memo: addMemo.trim(),
      schedule: { date, startTime, endTime, isAllDay, assignee: selectedAssignee },
    }))
  }

  // 予定を保存（統合フォーム）:
  //   schedule_idなし → confirmSchedule()（新規作成）
  //   schedule_idあり → rescheduleMeeting()（既存UPDATE、二重作成しない）
  const handleSaveSchedule = () => {
    if (!meeting) return
    if (!date) { setError('実施予定日を入力してください'); return }
    if (!isAllDay && startTime >= endTime) { setError('終了時間は開始時間より後にしてください'); return }
    if (wasUnscheduled && needsManagerChoice && !selectedAssignee) { setError('担当者を選択してください'); return }

    // 日程変更時の担当者は、現在の担当から変更された場合のみ送る
    // （未変更なら既存scheduleの担当をそのまま維持する。種別（G長・主任/リーダー）も含めて比較）
    const currentKey = meeting.scheduleAssignee ? assigneeKey(meeting.scheduleAssignee) : ''
    const changedAssignee = selectedAssignee && selectedAssigneeKey !== currentKey ? selectedAssignee : undefined

    runAction(() =>
      wasUnscheduled
        ? onConfirmSchedule({ date, startTime, endTime, isAllDay, assignee: selectedAssignee })
        : onReschedule({ date, startTime, endTime, isAllDay, assignee: changedAssignee })
    )
  }

  const handleCancel = () => {
    if (!confirm('この日程を取り消しますか？（カレンダーの予定も削除されます）')) return
    runAction(() => onCancelSchedule())
  }

  const handleMarkDone = () => {
    if (!executedDate) { setError('実施日を入力してください'); return }
    runAction(() => onMarkDone(executedDate))
  }

  const handleMoveMonth = () => {
    if (!meeting) return
    if (!moveMonth) { setError('新しい計画月を選択してください'); return }
    const newTargetMonth = `${moveMonth}-01`
    if (newTargetMonth === meeting.targetMonth) { setError('現在の計画月と同じです'); return }
    runAction(() =>
      moveCascade && meeting.frequencyId
        ? onMoveTargetMonthCascade(newTargetMonth)
        : onMoveTargetMonth(newTargetMonth)
    )
  }

  const handleDeleteMeeting = () => {
    if (!meeting) return
    const { month } = parseTargetMonth(meeting.targetMonth)
    if (!confirm(`${facilityName} ${month}月の${MEETING_TYPE_LABELS[meetingType]}予定を削除しますか？`)) return
    runAction(() => onDeleteMeeting())
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !meeting) return
    const clientError = validatePdfFile(file)
    if (clientError) { setMinutesError(clientError); return }

    setUploading(true)
    setMinutesError('')
    setMinutesNotice(null)
    try {
      const { minute: created, notification } = await onUploadMinute(meeting, file)
      setMinutes(prev => [created, ...prev])
      if (notification === 'failed') {
        setMinutesNotice({ kind: 'warning', message: '議事録の保存は完了しましたが、通知メールの送信に失敗しました' })
      } else if (notification === 'sent') {
        setMinutesNotice({ kind: 'success', message: '議事録を保存し、通知メールを送信しました' })
      }
    } catch (err) {
      setMinutesError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteMinute = async (minute: MeetingMinute) => {
    if (!confirm(`「${minute.fileName}」を削除しますか？`)) return
    setDeletingId(minute.id)
    setMinutesError('')
    try {
      await onDeleteMinute(minute)
      setMinutes(prev => prev.filter(m => m.id !== minute.id))
    } catch (err) {
      setMinutesError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setDeletingId(null)
    }
  }

  const timeFields = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
        <select
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {withCurrentSlot(startTime).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
        <select
          value={endTime}
          onChange={e => setEndTime(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {withCurrentSlot(endTime).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  )

  const allDayToggle = (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={isAllDay}
        onChange={e => setIsAllDay(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      終日
    </label>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* 見出し / 本文（スクロール） / ボタン（下部固定）の3段構造。
          スマホのブラウザUI（アドレスバー等）で隠れないよう高さは dvh で指定する */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-white flex-shrink-0 rounded-t-2xl sm:rounded-t-xl">
          <h2 className="text-base font-semibold text-gray-800">
            {facilityName} / {MEETING_TYPE_LABELS[meetingType]}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* 本文（ここだけスクロール） */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-500">
            計画月：<span className="font-medium text-gray-700">{formatMonthLabel(targetMonth)}</span>
          </div>

          {/* 追加モード（meetingがまだ存在しない。実施予定日を入れれば登録と同時にG長スケジュールにも反映する） */}
          {mode === 'add' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                この月にはまだMTの計画がありません。手動で追加できます。
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">実施予定日</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => { setDate(e.target.value); setError('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  未定のまま登録することもできます（後からMT詳細画面で入力できます）
                </p>
              </div>

              {date && (
                <>
                  {allDayToggle}
                  {!isAllDay && timeFields}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      担当者 {needsManagerChoice && <span className="text-red-500">*</span>}
                    </label>
                    {candidateAssignees.length <= 1 ? (
                      <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        {managerLabel}
                      </p>
                    ) : (
                      <select
                        value={selectedAssigneeKey}
                        onChange={e => setSelectedAssigneeKey(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">選択してください</option>
                        {renderAssigneeOptions(candidateAssignees)}
                      </select>
                    )}
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
                <input
                  type="text"
                  value={addMemo}
                  onChange={e => setAddMemo(e.target.value)}
                  placeholder="任意"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* 詳細表示モード */}
          {mode === 'view' && meeting && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium',
                  cellStatus === 'overdue' && 'bg-red-100 text-red-700',
                  cellStatus === 'confirmed' && 'bg-blue-100 text-blue-700',
                  cellStatus === 'unscheduled' && 'bg-gray-100 text-gray-600',
                  cellStatus === 'done' && 'bg-emerald-100 text-emerald-700',
                  cellStatus === 'minutes_registered' && 'bg-indigo-100 text-indigo-700',
                )}>
                  {MEETING_CELL_STATUS_LABELS[cellStatus]}
                </span>
                {meeting.status !== 'done' && meeting.scheduleDate && (
                  <span className="text-sm text-gray-600">
                    実施予定日：{formatDateLabel(meeting.scheduleDate)}
                  </span>
                )}
              </div>
              {meeting.status === 'done' && meeting.executedDate && (
                <p className="text-sm font-medium text-gray-700">
                  実施日：{formatFullDateLabel(meeting.executedDate)}
                </p>
              )}
              {meeting.memo && (
                <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{meeting.memo}</p>
              )}

              <div className="pt-2 border-t space-y-2">
                {meeting.status === 'scheduled' && (
                  <button
                    onClick={() => setMode('schedule')}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  >
                    <CalendarClock size={16} />予定を保存
                  </button>
                )}
                {meeting.scheduleId && meeting.status === 'scheduled' && (
                  <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    <CalendarX size={16} />日程を取り消す
                  </button>
                )}
                {meeting.status === 'scheduled' && (
                  <button
                    onClick={() => setMode('markDone')}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50"
                  >
                    <CheckCircle2 size={16} />実施済にする
                  </button>
                )}
                <button
                  onClick={() => setMode('moveMonth')}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
                >
                  <ArrowRightLeft size={16} />計画月を変更
                </button>
                {!meeting.scheduleId && meeting.status === 'scheduled' && meeting.minutesCount === 0 && (
                  <button
                    onClick={handleDeleteMeeting}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} />この月の予定を削除
                  </button>
                )}
              </div>

              {/* 議事録セクション（実施済のMTのみ操作可能） */}
              {meeting.status === 'done' && (
                <div className="pt-3 border-t space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">議事録</h3>
                    <label className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors',
                      uploading ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                    )}>
                      <input
                        type="file"
                        accept="application/pdf,.pdf"
                        className="hidden"
                        disabled={uploading}
                        onChange={handleFileSelected}
                      />
                      <Upload size={13} />
                      {uploading ? 'アップロード中…' : 'PDFを追加'}
                    </label>
                  </div>

                  {minutesError && <p className="text-xs text-red-500">{minutesError}</p>}
                  {minutesNotice && (
                    <p className={cn('text-xs', minutesNotice.kind === 'warning' ? 'text-amber-700' : 'text-emerald-700')}>
                      {minutesNotice.message}
                    </p>
                  )}

                  {minutesLoading ? (
                    <div className="flex justify-center py-3">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : minutes.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">まだ議事録が登録されていません</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {minutes.map(minute => (
                        <li key={minute.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                          <FileText size={14} className="text-red-400 flex-shrink-0" />
                          <span className="flex-1 min-w-0 text-sm text-gray-700 truncate" title={minute.fileName}>
                            {minute.fileName}
                          </span>
                          <a
                            href={meetingMinutesService.getOpenUrl(minute.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 flex-shrink-0 whitespace-nowrap"
                          >
                            <ExternalLink size={12} />開く
                          </a>
                          <button
                            onClick={() => handleDeleteMinute(minute)}
                            disabled={deletingId === minute.id}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                            aria-label="削除"
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 予定を保存（日程確定・日程変更の統合フォーム。schedule_id有無で内部的に出し分ける） */}
          {mode === 'schedule' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">予定を保存</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  保存すると、この内容でG長のスケジュールにも登録されます。
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  実施予定日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => { setDate(e.target.value); setError('') }}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    error && !date ? 'border-red-400' : 'border-gray-300'
                  )}
                />
              </div>

              {allDayToggle}
              {!isAllDay && timeFields}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  担当者 {wasUnscheduled && needsManagerChoice && <span className="text-red-500">*</span>}
                </label>
                {wasUnscheduled ? (
                  candidateAssignees.length <= 1 ? (
                    <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      {managerLabel}
                    </p>
                  ) : (
                    <select
                      value={selectedAssigneeKey}
                      onChange={e => setSelectedAssigneeKey(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">選択してください</option>
                      {renderAssigneeOptions(candidateAssignees)}
                    </select>
                  )
                ) : (
                  <select
                    value={selectedAssigneeKey}
                    onChange={e => setSelectedAssigneeKey(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">変更しない</option>
                    {/* 現在の担当者が候補外（施設の担当変更・無効化など）でも現在値として表示する */}
                    {currentAssigneeOutsideCandidates && meeting?.scheduleAssignee && (
                      <option value={assigneeKey(meeting.scheduleAssignee)}>
                        {meeting.scheduleAssignee.name || '現在の担当'}（現在）
                      </option>
                    )}
                    {renderAssigneeOptions(candidateAssignees)}
                  </select>
                )}
              </div>
            </div>
          )}

          {/* 実施済登録フォーム（誤操作防止のため、実施日を確認してから確定する） */}
          {mode === 'markDone' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">MTを実施済みにする</h3>
                <p className="text-xs text-gray-500 mt-0.5">このMTを実施した記録として登録します。</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  実施日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={executedDate}
                  onChange={e => { setExecutedDate(e.target.value); setError('') }}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    error ? 'border-red-400' : 'border-gray-300'
                  )}
                />
              </div>
            </div>
          )}

          {/* 計画月の変更フォーム（target_monthの手動調整。schedules/meeting_frequenciesには触れない） */}
          {mode === 'moveMonth' && meeting && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">計画月を変更</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  年間計画上の予定月を移動します（日程確定済みの予定日は変更されません）。
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  新しい計画月 <span className="text-red-500">*</span>
                </label>
                <input
                  type="month"
                  value={moveMonth}
                  onChange={e => { setMoveMonth(e.target.value); setError('') }}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    error ? 'border-red-400' : 'border-gray-300'
                  )}
                />
              </div>

              {meeting.frequencyId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">移動範囲</label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setMoveCascade(false)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                        !moveCascade
                          ? 'border-blue-500 bg-blue-50 text-blue-800 font-medium'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      このMTだけ移動
                    </button>
                    <button
                      type="button"
                      onClick={() => setMoveCascade(true)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors',
                        moveCascade
                          ? 'border-blue-500 bg-blue-50 text-blue-800 font-medium'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      今回以降の未確定予定も同じ月数だけ移動
                    </button>
                    {moveCascade && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        このMTを新しい基準として、今後の未確定MTの予定月も変更します
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        </div>

        {/* Footer（常に表示） */}
        <div className="flex gap-2 px-4 py-3 border-t bg-white flex-shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {mode === 'view' ? (
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
              閉じる
            </button>
          ) : (
            <>
              <button
                onClick={() => meeting ? setMode('view') : onClose()}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={
                  mode === 'add' ? handleAddUnified :
                  mode === 'schedule' ? handleSaveSchedule :
                  mode === 'moveMonth' ? handleMoveMonth :
                  handleMarkDone
                }
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {mode === 'add' && <Plus size={16} />}
                {mode === 'schedule' && <CalendarCheck size={16} />}
                {mode === 'markDone' && <CheckCircle2 size={16} />}
                {mode === 'moveMonth' && <ArrowRightLeft size={16} />}
                {saving
                  ? '保存中…'
                  : mode === 'add' ? '登録する'
                  : mode === 'schedule' ? '予定を保存'
                  : mode === 'markDone' ? '実施済みにする'
                  : mode === 'moveMonth' ? '移動する'
                  : '保存'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
