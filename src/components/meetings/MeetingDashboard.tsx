'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, FileWarning, CheckCircle2, CalendarDays, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  buildMeetingDashboardSummary, buildFacilityMeetingProgress, elapsedDaysSince,
  parseTargetMonth, getMeetingCellStatus, MEETING_CELL_STATUS_LABELS,
} from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import type { Meeting, Facility } from '@/lib/types'

interface MeetingDashboardProps {
  meetings: Meeting[]
  facilities: Facility[]
  onOpenMeeting: (meeting: Meeting) => void
}

type CardKey = 'thisMonth' | 'overdue' | 'doneUnregistered' | 'minutesRegistered'

function formatMonthLabel(targetMonth: string): string {
  const { year, month } = parseTargetMonth(targetMonth)
  return `${year}年${month}月`
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const CARD_TONE = {
  neutral: 'border-gray-200 bg-white',
  danger: 'border-red-300 bg-red-50',
  warning: 'border-amber-300 bg-amber-50',
  success: 'border-emerald-200 bg-emerald-50',
} as const

const CARD_TEXT_TONE = {
  neutral: 'text-gray-700',
  danger: 'text-red-700',
  warning: 'text-amber-700',
  success: 'text-emerald-700',
} as const

function SummaryCard({
  icon, label, count, tone, active, onClick,
}: {
  icon: React.ReactNode
  label: string
  count: number
  tone: keyof typeof CARD_TONE
  active: boolean
  onClick: () => void
}) {
  // 期限超過・議事録未登録は件数が0件でない限り目立たせる（見逃し防止）
  const emphasize = (tone === 'danger' || tone === 'warning') && count > 0
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 min-w-[140px] text-left px-3 py-2.5 rounded-xl border-2 transition-all',
        CARD_TONE[tone],
        active ? 'ring-2 ring-offset-1 ring-blue-500' : 'hover:opacity-80',
        emphasize && 'shadow-sm'
      )}
    >
      <div className={cn('flex items-center gap-1.5 text-xs font-medium mb-1', CARD_TEXT_TONE[tone])}>
        {icon}
        {label}
      </div>
      <div className={cn('text-2xl font-bold', CARD_TEXT_TONE[tone])}>
        {count}
        <span className="text-xs font-normal ml-0.5">件</span>
      </div>
    </button>
  )
}

export function MeetingDashboard({ meetings, facilities, onOpenMeeting }: MeetingDashboardProps) {
  const [activeCard, setActiveCard] = useState<CardKey | null>(null)

  const today = useMemo(() => new Date(), [])
  const summary = useMemo(() => buildMeetingDashboardSummary(meetings, today), [meetings, today])
  const facilityProgress = useMemo(
    () => buildFacilityMeetingProgress(meetings, facilities),
    [meetings, facilities]
  )

  const toggleCard = (key: CardKey) => setActiveCard(prev => prev === key ? null : key)

  const activeList: Meeting[] =
    activeCard === 'thisMonth' ? summary.thisMonth :
    activeCard === 'overdue' ? summary.overdue :
    activeCard === 'doneUnregistered' ? summary.doneUnregistered :
    activeCard === 'minutesRegistered' ? summary.minutesRegistered :
    []

  const currentMonth = today.getMonth() + 1

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        <SummaryCard
          icon={<CalendarDays size={13} />}
          label={`今月のMT（${currentMonth}月）`}
          count={summary.thisMonth.length}
          tone="neutral"
          active={activeCard === 'thisMonth'}
          onClick={() => toggleCard('thisMonth')}
        />
        <SummaryCard
          icon={<AlertTriangle size={13} />}
          label="期限超過"
          count={summary.overdue.length}
          tone="danger"
          active={activeCard === 'overdue'}
          onClick={() => toggleCard('overdue')}
        />
        <SummaryCard
          icon={<FileWarning size={13} />}
          label="議事録未登録"
          count={summary.doneUnregistered.length}
          tone="warning"
          active={activeCard === 'doneUnregistered'}
          onClick={() => toggleCard('doneUnregistered')}
        />
        <SummaryCard
          icon={<CheckCircle2 size={13} />}
          label="議事録登録済"
          count={summary.minutesRegistered.length}
          tone="success"
          active={activeCard === 'minutesRegistered'}
          onClick={() => toggleCard('minutesRegistered')}
        />
      </div>

      {/* カードクリック時の対象一覧 */}
      {activeCard && (
        <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
          {activeList.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">該当するMTはありません</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-xs text-gray-500">
                    <th className="px-3 py-2 text-left font-medium">施設</th>
                    <th className="px-3 py-2 text-left font-medium">種別</th>
                    <th className="px-3 py-2 text-left font-medium">計画月</th>
                    {activeCard === 'doneUnregistered' ? (
                      <>
                        <th className="px-3 py-2 text-left font-medium">実施日</th>
                        <th className="px-3 py-2 text-left font-medium">経過日数</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 text-left font-medium">予定日</th>
                        <th className="px-3 py-2 text-left font-medium">担当G長</th>
                        <th className="px-3 py-2 text-left font-medium">状態</th>
                      </>
                    )}
                    <th className="px-3 py-2 text-center font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activeList.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{m.facilityName}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{MEETING_TYPE_LABELS[m.meetingType]}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatMonthLabel(m.targetMonth)}</td>
                      {activeCard === 'doneUnregistered' ? (
                        <>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                            {m.executedDate ? formatShortDate(m.executedDate) : '未定'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="text-amber-700 font-medium">
                              {m.executedDate ? `${elapsedDaysSince(m.executedDate, today)}日` : '－'}
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                            {m.scheduleId && m.scheduleDate ? formatShortDate(m.scheduleDate) : '未定'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                            {m.scheduleId && m.scheduleGroupManagerName ? m.scheduleGroupManagerName : '未定'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium',
                              getMeetingCellStatus(m, today) === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                            )}>
                              {MEETING_CELL_STATUS_LABELS[getMeetingCellStatus(m, today)]}
                            </span>
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => onOpenMeeting(m)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 mx-auto"
                        >
                          <ExternalLink size={12} />開く
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 施設別進捗 */}
      {facilityProgress.length > 0 && (
        <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-3 py-1.5 bg-gray-50 border-b text-xs font-semibold text-gray-500">施設別進捗（計画 / 実施 / 議事録）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="px-3 py-1.5 text-left font-medium">施設</th>
                  <th className="px-3 py-1.5 text-center font-medium w-20">計画</th>
                  <th className="px-3 py-1.5 text-center font-medium w-20">実施</th>
                  <th className="px-3 py-1.5 text-center font-medium w-20">議事録</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {facilityProgress.map(f => (
                  <tr key={f.facilityId}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{f.facilityName}</td>
                    <td className="px-3 py-1.5 text-center text-gray-600">{f.plannedCount}</td>
                    <td className="px-3 py-1.5 text-center text-gray-600">{f.doneCount}</td>
                    <td className="px-3 py-1.5 text-center text-gray-600">{f.minutesCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
