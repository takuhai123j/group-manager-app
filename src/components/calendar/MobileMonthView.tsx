'use client'

import { useState, useEffect } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth,
} from 'date-fns'
import { cn, toDateString, isTodayDate, isSaturday, isSunday } from '@/lib/utils'
import { getJapaneseHolidays } from '@/lib/holidays'
import { getEventTypeConfig } from '@/constants/eventTypes'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface MobileMonthViewProps {
  currentDate: Date
  events: ScheduleEvent[]
  managers: GroupManager[]
  managerFacilities: Record<string, string[]>
  colorMode: ColorMode
  onDayClick: (date: Date) => void
  onEventClick: (event: ScheduleEvent) => void
}

const DAY_HEADERS = ['月', '火', '水', '木', '金', '土', '日']
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

function formatSheetDate(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_JA[date.getDay()]}）`
}

export function MobileMonthView({
  currentDate,
  events,
  managers,
  managerFacilities,
  colorMode,
  onDayClick,
  onEventClick,
}: MobileMonthViewProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }),
  })

  const holidayMap = getJapaneseHolidays(days[0], days[days.length - 1])

  const getEventsForDay = (date: Date) => {
    const dateStr = toDateString(date)
    const all = events.filter(e => e.date === dateStr)
    const allDay = all.filter(e => e.isAllDay)
    const timed = all
      .filter(e => !e.isAllDay)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
    return { allDay, timed, total: all.length }
  }

  // 月が変わったら選択解除
  useEffect(() => { setSelectedDate(null) }, [currentDate])

  const selectedDayData = selectedDate ? getEventsForDay(selectedDate) : null

  return (
    <>
      <div className="flex flex-col">
        {/* 曜日ヘッダー */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {DAY_HEADERS.map((day, i) => (
            <div
              key={day}
              className={cn(
                'py-2 text-center text-xs font-semibold',
                i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-gray-500'
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* カレンダーグリッド */}
        <div className="grid grid-cols-7 border-l">
          {days.map(day => {
            const { allDay, timed, total } = getEventsForDay(day)
            const isToday = isTodayDate(day)
            const isSat = isSaturday(day)
            const isSun = isSunday(day)
            const isCurrent = isSameMonth(day, currentDate)
            const holidayName = holidayMap.get(toDateString(day)) ?? null
            const isRedDay = isSun || !!holidayName
            const isSelected = selectedDate
              ? toDateString(selectedDate) === toDateString(day)
              : false
            const hasRest = allDay.length > 0

            // 種別ドット（最大4つ、重複排除）
            const dots: { key: string; color: string }[] = []
            if (colorMode === 'leader') {
              const seen = new Set<string>()
              for (const e of timed) {
                if (!seen.has(e.groupLeaderId)) {
                  seen.add(e.groupLeaderId)
                  const mgr = managers.find(m => m.id === e.groupLeaderId)
                  dots.push({ key: e.groupLeaderId, color: mgr?.color ?? '#6B7280' })
                  if (dots.length >= 4) break
                }
              }
            } else {
              const seen = new Set<string>()
              for (const e of timed) {
                if (!seen.has(e.type)) {
                  seen.add(e.type)
                  dots.push({ key: e.type, color: getEventTypeConfig(e.type).solidBg })
                  if (dots.length >= 4) break
                }
              }
            }

            return (
              <div
                key={toDateString(day)}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  'border-r border-b cursor-pointer transition-colors select-none',
                  'min-h-[58px] p-1',
                  !isCurrent && 'bg-gray-50',
                  isSelected
                    ? 'bg-blue-50 ring-1 ring-inset ring-blue-300'
                    : 'active:bg-blue-50/50'
                )}
              >
                {/* 日付 */}
                <div className="flex justify-center mb-0.5">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-6 h-6 text-xs rounded-full font-medium',
                      isToday
                        ? 'bg-blue-600 text-white'
                        : isRedDay
                          ? isCurrent ? 'text-red-500' : 'text-red-300'
                          : isSat
                            ? isCurrent ? 'text-blue-600' : 'text-blue-300'
                            : isCurrent ? 'text-gray-800' : 'text-gray-400'
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {/* 件数 */}
                {total > 0 && (
                  <div className="text-center text-[10px] text-gray-400 leading-none mb-0.5">
                    {total}件
                  </div>
                )}

                {/* 休バッジ + ドット */}
                <div className="flex flex-wrap justify-center items-center gap-0.5 min-h-[10px]">
                  {hasRest && (
                    <span className="text-[9px] bg-slate-200 text-slate-700 rounded px-0.5 py-px leading-none font-medium">
                      休
                    </span>
                  )}
                  {dots.map(d => (
                    <span
                      key={d.key}
                      style={{ backgroundColor: d.color }}
                      className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 下部シート */}
      {selectedDate && (
        <>
          {/* オーバーレイ */}
          <div
            className="fixed inset-0 bg-black/25 z-40"
            onClick={() => setSelectedDate(null)}
          />

          {/* シート本体 */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[72vh] flex flex-col">
            {/* ハンドル */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>

            {/* ヘッダー */}
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <h2 className="text-base font-semibold text-gray-800">
                {formatSheetDate(selectedDate)}の予定
              </h2>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-gray-400 hover:text-gray-600 p-1 -mr-1 rounded-lg"
                aria-label="閉じる"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 予定一覧 */}
            <div className="flex-1 overflow-y-auto">
              {!selectedDayData || selectedDayData.total === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">予定はありません</p>
              ) : (
                <div className="px-4 py-3 space-y-3 pb-10">

                  {/* 全日予定（公休・有休） */}
                  {selectedDayData.allDay.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-gray-400 mb-1.5">全日</div>
                      <div className="space-y-2">
                        {selectedDayData.allDay.map(event => {
                          const cfg = getEventTypeConfig(event.type)
                          return (
                            <button
                              key={event.id}
                              onClick={() => {
                                onEventClick(event)
                                setSelectedDate(null)
                              }}
                              className={cn(
                                'w-full text-left rounded-xl border px-4 py-3 active:opacity-70 transition-opacity',
                                cfg.bgColor, cfg.textColor, cfg.borderColor
                              )}
                            >
                              <span className="text-sm font-semibold">{cfg.label}</span>
                              <span className="text-sm">　{event.groupLeaderName}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 時間指定予定 */}
                  {selectedDayData.timed.length > 0 && (
                    <div>
                      {selectedDayData.allDay.length > 0 && (
                        <div className="text-xs font-medium text-gray-400 mb-1.5">時間指定</div>
                      )}
                      <div className="space-y-2">
                        {selectedDayData.timed.map(event => {
                          const cfg = getEventTypeConfig(event.type)
                          return (
                            <button
                              key={event.id}
                              onClick={() => {
                                onEventClick(event)
                                setSelectedDate(null)
                              }}
                              className={cn(
                                'w-full text-left rounded-xl border px-4 py-3 active:opacity-70 transition-opacity',
                                cfg.bgColor, cfg.textColor, cfg.borderColor
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <span className="text-xs font-mono text-gray-500 shrink-0 mt-0.5 w-11 tabular-nums">
                                  {event.startTime?.slice(0, 5)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-semibold">
                                    {cfg.label}
                                    {event.facilityName && (
                                      <span className="font-normal">　{event.facilityName}</span>
                                    )}
                                  </div>
                                  {event.title && (
                                    <div className="text-sm mt-0.5">{event.title}</div>
                                  )}
                                  <div className="text-xs text-gray-500 mt-1">
                                    {event.groupLeaderName}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
