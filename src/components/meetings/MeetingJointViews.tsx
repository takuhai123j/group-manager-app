'use client'

import { Link2, AlertTriangle, CalendarDays, CheckCircle2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseTargetMonth, getMeetingCellStatus, MEETING_CELL_STATUS_LABELS } from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import type { Meeting, JoinRequirements } from '@/lib/types'

// MT同時開催（施設MT＋厨房内MT）の画面部品。
// 状態は持たず、選択値と変更ハンドラを親（MeetingCellModal）から受け取る

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function formatJointMonthLabel(targetMonth: string): string {
  const { year, month } = parseTargetMonth(targetMonth)
  return `${year}年${month}月`
}

export function formatJointDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`
}

// 予定の要約（日付・時間・担当者）。予定が無ければ null
export function formatMeetingSchedule(meeting: Meeting): string | null {
  if (!meeting.scheduleId || !meeting.scheduleDate) return null
  const time = meeting.scheduleIsAllDay
    ? '終日'
    : meeting.scheduleStartTime && meeting.scheduleEndTime
      ? `${meeting.scheduleStartTime.slice(0, 5)}〜${meeting.scheduleEndTime.slice(0, 5)}`
      : ''
  const assignee = meeting.scheduleAssignee?.name ? ` ／ ${meeting.scheduleAssignee.name}` : ''
  return `${formatJointDate(meeting.scheduleDate)} ${time}${assignee}`
}

// 同時開催の目印（年間計画のマス・ダッシュボード・履歴で共通）
export function JointBadge({ label = '同時開催', className }: { label?: string; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-medium whitespace-nowrap',
      className
    )}>
      <Link2 size={10} />{label}
    </span>
  )
}

// 1件のMTの状態（計画月・予定・実施）を2〜3行で表示する
function MeetingStateLines({ meeting }: { meeting: Meeting }) {
  const schedule = formatMeetingSchedule(meeting)
  return (
    <div className="space-y-0.5 text-xs text-gray-600">
      <div>計画月：{formatJointMonthLabel(meeting.targetMonth)}</div>
      <div className="flex items-start gap-1">
        <CalendarDays size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
        <span>{schedule ?? '予定：未定'}</span>
      </div>
      <div className="flex items-start gap-1">
        <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
        <span>
          {meeting.status === 'done' && meeting.executedDate
            ? `実施済（${formatJointDate(meeting.executedDate)}）`
            : '未実施'}
        </span>
      </div>
      {meeting.minutesCount > 0 && (
        <div className="flex items-start gap-1">
          <FileText size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <span>議事録 {meeting.minutesCount}件</span>
        </div>
      )}
    </div>
  )
}

// ── 結合相手の候補一覧 ─────────────────────────────────────────
interface JointCandidateListProps {
  candidates: Meeting[]
  selectedId: string
  onSelect: (id: string) => void
  baseTargetMonth: string  // 同じ月の候補に「同じ月」と表示するため
  loading: boolean
  error: string
}

export function JointCandidateList({
  candidates, selectedId, onSelect, baseTargetMonth, loading, error,
}: JointCandidateListProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (error) return <p className="text-xs text-red-500">{error}</p>
  if (candidates.length === 0) {
    return (
      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        結合できるMTがありません（同じ施設・前年〜翌年の、同時開催になっていないMTが対象です）
      </p>
    )
  }
  return (
    <ul className="space-y-1.5" role="radiogroup">
      {candidates.map(c => {
        const status = getMeetingCellStatus(c)
        const selected = c.id === selectedId
        return (
          <li key={c.id}>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(c.id)}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                selected ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 hover:bg-gray-50'
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-800">
                  {MEETING_TYPE_LABELS[c.meetingType]}
                  {c.targetMonth === baseTargetMonth && (
                    <span className="ml-1.5 text-[10px] font-normal text-violet-700">同じ月</span>
                  )}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                  {MEETING_CELL_STATUS_LABELS[status]}
                </span>
              </div>
              <MeetingStateLines meeting={c} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ── 結合前の確認画面（予定・実施日の確認と選択） ──────────────────
interface JoinConfirmViewProps {
  meeting: Meeting
  partner: Meeting
  requirements: JoinRequirements
  keepScheduleId: string
  onKeepScheduleChange: (id: string) => void
  executedDate: string
  onExecutedDateChange: (date: string) => void
  isChangingPartner: boolean  // 相手の変更（現在の同時開催を解除してから結合する）
  currentPartnerLabel?: string
}

export function JoinConfirmView({
  meeting, partner, requirements,
  keepScheduleId, onKeepScheduleChange,
  executedDate, onExecutedDateChange,
  isChangingPartner, currentPartnerLabel,
}: JoinConfirmViewProps) {
  const { scheduleChoice, executedDateChoice, partnerWillBeMarkedDone } = requirements

  // 結合後の共通予定（2件とも予定がある場合は選択中の方）
  const scheduleOwner: Meeting | null = scheduleChoice
    ? (keepScheduleId === meeting.scheduleId ? meeting : keepScheduleId === partner.scheduleId ? partner : null)
    : meeting.scheduleId ? meeting : partner.scheduleId ? partner : null
  const deletedOwner: Meeting | null = scheduleChoice && scheduleOwner
    ? (scheduleOwner.id === meeting.id ? partner : meeting)
    : null
  const resultSchedule = scheduleOwner ? formatMeetingSchedule(scheduleOwner) : null
  const notDone = [meeting, partner].find(m => m.status !== 'done')
  const hasMinutes = meeting.minutesCount > 0 || partner.minutesCount > 0

  const scheduleOption = (m: Meeting) => {
    const selected = keepScheduleId === m.scheduleId
    return (
      <button
        key={m.id}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onKeepScheduleChange(m.scheduleId ?? '')}
        className={cn(
          'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors',
          selected ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 hover:bg-gray-50'
        )}
      >
        <span className="block text-xs text-gray-500">{MEETING_TYPE_LABELS[m.meetingType]}の予定</span>
        <span className="block text-gray-800">{formatMeetingSchedule(m)}</span>
      </button>
    )
  }

  return (
    <div className="space-y-3">
      {isChangingPartner && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          現在の同時開催{currentPartnerLabel ? `（${currentPartnerLabel}）` : ''}を解除してから、新しい相手と同時開催にします。
          元の相手のMTには同じ日時の予定が残ります。
        </p>
      )}

      {/* 結合前の2件の状態 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {[meeting, partner].map((m, i) => (
          <div key={m.id} className="border border-gray-200 rounded-lg px-3 py-2">
            <div className="text-xs font-semibold text-gray-700 mb-1">
              {MEETING_TYPE_LABELS[m.meetingType]}
              <span className="ml-1 font-normal text-gray-400">{i === 0 ? '（このMT）' : '（相手）'}</span>
            </div>
            <MeetingStateLines meeting={m} />
          </div>
        ))}
      </div>

      {/* 2件とも別の予定がある：残す予定を選ぶ */}
      {scheduleChoice && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            残す予定 <span className="text-red-500">*</span>
          </label>
          <div className="space-y-1.5" role="radiogroup">
            {[meeting, partner].map(scheduleOption)}
          </div>
          {deletedOwner && (
            <p className="mt-1.5 flex items-start gap-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              {MEETING_TYPE_LABELS[deletedOwner.meetingType]}の予定（{formatMeetingSchedule(deletedOwner)}）はカレンダーから削除されます
            </p>
          )}
        </div>
      )}

      {/* 実施済みを含む：共通の実施日を選ぶ（候補が1件なら確認のみ） */}
      {executedDateChoice && executedDateChoice.dates.length > 1 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            共通の実施日 <span className="text-red-500">*</span>
          </label>
          <div className="space-y-1.5" role="radiogroup">
            {executedDateChoice.dates.map(d => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={executedDate === d}
                onClick={() => onExecutedDateChange(d)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors',
                  executedDate === d ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                {formatJointDate(d)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 結合後の内容 */}
      <div className="border border-violet-200 bg-violet-50/60 rounded-lg px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-violet-800">
          <Link2 size={14} />同時開催にした後
        </div>
        <ul className="text-xs text-gray-700 space-y-0.5 list-disc pl-4">
          <li>
            共通の予定：{resultSchedule ?? (
              scheduleChoice ? '（残す予定を選択してください）'
                // 実施済みになる場合は「予定を保存」が使えないため、後から決められる旨は出さない
                : executedDateChoice ? 'なし'
                : '未定（後から「予定を保存」で決められます）'
            )}
          </li>
          <li>
            実施：{executedDateChoice
              ? (executedDate ? `実施済（${formatJointDate(executedDate)}）` : '（実施日を選択してください）')
              : '未実施'}
          </li>
          {/* 件数は以前の同時開催で共有済みのPDFを重複して数える場合があるため表示しない */}
          <li>議事録：{hasMinutes ? '登録済みの議事録は両方のMTで共有されます' : '登録すると両方のMTで共有されます'}</li>
          <li>計画月はそれぞれのまま変わりません</li>
        </ul>
      </div>

      {partnerWillBeMarkedDone && notDone && (
        <p className="flex items-start gap-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          未実施の{MEETING_TYPE_LABELS[notDone.meetingType]}も、同じ実施日で実施済みになります
        </p>
      )}
    </div>
  )
}
