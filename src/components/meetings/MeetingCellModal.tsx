'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  X, CalendarClock, CalendarCheck, CalendarX, CheckCircle2, Plus,
  FileText, Upload, ExternalLink, Trash2, ArrowRightLeft,
} from 'lucide-react'
import { cn, generateTimeSlots, toDateString } from '@/lib/utils'
import { parseTargetMonth, getMeetingCellStatus, MEETING_CELL_STATUS_LABELS } from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import { meetingMinutesService } from '@/services/meetingMinutesService'
import { validatePdfFile } from '@/services/meetingMinutesStorageService'
import type {
  Meeting, MeetingType, GroupManager, MeetingMinute,
  ConfirmMeetingScheduleInput, RescheduleMeetingInput,
} from '@/lib/types'

interface MeetingCellModalProps {
  isOpen: boolean
  meeting: Meeting | null
  facilityName: string
  meetingType: MeetingType
  targetMonth: string
  candidateManagers: GroupManager[]  // 当該施設に紐づく有効なG長
  onClose: () => void
  onAddManual: (memo: string) => Promise<void>
  onConfirmSchedule: (input: ConfirmMeetingScheduleInput) => Promise<void>
  onReschedule: (input: RescheduleMeetingInput) => Promise<void>
  onCancelSchedule: () => Promise<void>
  onMarkDone: (executedDate?: string) => Promise<void>
  onUploadMinute: (meeting: Meeting, file: File) => Promise<MeetingMinute>
  onDeleteMinute: (minute: MeetingMinute) => Promise<void>
  onMoveTargetMonth: (newTargetMonth: string) => Promise<void>
  onMoveTargetMonthCascade: (newTargetMonth: string) => Promise<void>
  onDeleteMeeting: () => Promise<void>
}

type Mode = 'view' | 'confirm' | 'reschedule' | 'markDone' | 'add' | 'moveMonth'

const TIME_SLOTS = generateTimeSlots(8, 20)

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
  candidateManagers,
  onClose, onAddManual, onConfirmSchedule, onReschedule, onCancelSchedule, onMarkDone,
  onUploadMinute, onDeleteMinute,
  onMoveTargetMonth, onMoveTargetMonthCascade, onDeleteMeeting,
}: MeetingCellModalProps) {
  const [mode, setMode] = useState<Mode>('view')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [addMemo, setAddMemo] = useState('')
  const [date, setDate] = useState(toDateString(new Date()))
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')
  const [groupManagerId, setGroupManagerId] = useState('')
  const [executedDate, setExecutedDate] = useState(toDateString(new Date()))
  const [moveMonth, setMoveMonth] = useState('')
  const [moveCascade, setMoveCascade] = useState(false)

  const [minutes, setMinutes] = useState<MeetingMinute[]>([])
  const [minutesLoading, setMinutesLoading] = useState(false)
  const [minutesError, setMinutesError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setMode(meeting ? 'view' : 'add')
    setError('')
    setAddMemo('')
    setDate(meeting?.scheduleDate ?? toDateString(new Date()))
    setStartTime('10:00')
    setEndTime('11:00')
    setGroupManagerId(candidateManagers.length === 1 ? candidateManagers[0].id : '')
    // 実施日は「今日」を勝手に初期値にしない。
    // schedule_idがあり予定日が取得できる場合のみ、その予定日を初期値にする
    setExecutedDate(meeting?.scheduleId && meeting?.scheduleDate ? meeting.scheduleDate : '')
    setMoveMonth(meeting ? meeting.targetMonth.slice(0, 7) : '')
    setMoveCascade(false)
    setMinutesError('')
  }, [isOpen, meeting, candidateManagers])

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

  const needsManagerChoice = candidateManagers.length !== 1
  const managerLabel = candidateManagers.length === 1
    ? candidateManagers[0].name
    : candidateManagers.length === 0
      ? 'この施設に有効なG長が割り当てられていません'
      : undefined

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

  const handleAdd = () => runAction(() => onAddManual(addMemo.trim()))

  const handleConfirm = () => {
    if (needsManagerChoice && !groupManagerId) { setError('担当G長を選択してください'); return }
    if (startTime >= endTime) { setError('終了時間は開始時間より後にしてください'); return }
    runAction(() => onConfirmSchedule({
      date, startTime, endTime,
      groupManagerId: groupManagerId || undefined,
    }))
  }

  const handleReschedule = () => {
    if (needsManagerChoice && groupManagerId && startTime >= endTime) { setError('終了時間は開始時間より後にしてください'); return }
    runAction(() => onReschedule({
      date, startTime, endTime,
      groupManagerId: groupManagerId || undefined,
    }))
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
    try {
      const created = await onUploadMinute(meeting, file)
      setMinutes(prev => [created, ...prev])
    } catch (err) {
      setMinutesError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const handleOpenMinute = async (minute: MeetingMinute) => {
    setOpeningId(minute.id)
    setMinutesError('')
    try {
      const url = await meetingMinutesService.getSignedUrl(minute.filePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setMinutesError(err instanceof Error ? err.message : 'PDFの表示に失敗しました')
    } finally {
      setOpeningId(null)
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

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-800">
            {facilityName} / {MEETING_TYPE_LABELS[meetingType]}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-500">
            計画月：<span className="font-medium text-gray-700">{formatMonthLabel(targetMonth)}</span>
          </div>

          {/* 追加モード（meetingがまだ存在しない） */}
          {mode === 'add' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                この月にはまだMTの計画がありません。手動で追加できます。
              </p>
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
                {!meeting.scheduleId && meeting.status === 'scheduled' && (
                  <button
                    onClick={() => setMode('confirm')}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  >
                    <CalendarClock size={16} />日程を確定する
                  </button>
                )}
                {meeting.scheduleId && meeting.status === 'scheduled' && (
                  <>
                    <button
                      onClick={() => setMode('reschedule')}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-blue-300 text-blue-700 text-sm font-medium hover:bg-blue-50"
                    >
                      <CalendarClock size={16} />日程を変更する
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={saving}
                      className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      <CalendarX size={16} />日程を取り消す
                    </button>
                  </>
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
                          <button
                            onClick={() => handleOpenMinute(minute)}
                            disabled={openingId === minute.id}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 flex-shrink-0"
                          >
                            <ExternalLink size={12} />開く
                          </button>
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

          {/* 日程確定 / 変更フォーム */}
          {(mode === 'confirm' || mode === 'reschedule') && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日付 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                  <select
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
                  <select
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {mode === 'confirm' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    担当G長 {needsManagerChoice && <span className="text-red-500">*</span>}
                  </label>
                  {candidateManagers.length <= 1 ? (
                    <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      {managerLabel}
                    </p>
                  ) : (
                    <select
                      value={groupManagerId}
                      onChange={e => setGroupManagerId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">選択してください</option>
                      {candidateManagers.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {mode === 'reschedule' && candidateManagers.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">担当G長（変更する場合のみ）</label>
                  <select
                    value={groupManagerId}
                    onChange={e => setGroupManagerId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">変更しない</option>
                    {candidateManagers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              )}
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

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t sticky bottom-0 bg-white">
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
                  mode === 'add' ? handleAdd :
                  mode === 'confirm' ? handleConfirm :
                  mode === 'reschedule' ? handleReschedule :
                  mode === 'moveMonth' ? handleMoveMonth :
                  handleMarkDone
                }
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {mode === 'add' && <Plus size={16} />}
                {mode === 'confirm' && <CalendarCheck size={16} />}
                {mode === 'markDone' && <CheckCircle2 size={16} />}
                {mode === 'moveMonth' && <ArrowRightLeft size={16} />}
                {saving
                  ? '保存中…'
                  : mode === 'add' ? '追加する'
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
