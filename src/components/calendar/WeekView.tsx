'use client'

import { useState, useEffect } from 'react'
import {
  cn, formatJa, toDateString, getWeekDays, generateTimeSlots,
  getEventPosition, isTodayDate, isSaturday, isSunday,
  getManagerColorStyle, SLOT_HEIGHT, GRID_START_HOUR,
  computeEventColumns,
} from '@/lib/utils'
import { getJapaneseHolidays } from '@/lib/holidays'
import { getEventTypeConfig, isHalfDayType } from '@/constants/eventTypes'
import { formatEventDisplay } from '@/lib/eventDisplay'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface WeekViewProps {
  currentDate: Date
  events: ScheduleEvent[]
  managers: GroupManager[]
  managerFacilities: Record<string, string[]>
  colorMode: ColorMode
  onSlotClick: (date: Date, time: string) => void
  onEventClick: (event: ScheduleEvent) => void
}

const TIME_LABELS = generateTimeSlots(GRID_START_HOUR, 22)
const NOW_TOP_MAX = TIME_LABELS.length * SLOT_HEIGHT

function getNowTop(): number {
  const now = new Date()
  return (now.getHours() * 60 + now.getMinutes() - GRID_START_HOUR * 60) / 30 * SLOT_HEIGHT
}

export function WeekView({ currentDate, events, managers, managerFacilities, colorMode, onSlotClick, onEventClick }: WeekViewProps) {
  const weekDays = getWeekDays(currentDate)
  const holidayMap = getJapaneseHolidays(weekDays[0], weekDays[weekDays.length - 1])

  const getTimedEvents = (date: Date) =>
    events.filter(e => e.date === toDateString(date) && !e.isAllDay)

  const getAllDayEvents = (date: Date) =>
    events.filter(e => e.date === toDateString(date) && e.isAllDay)

  const hasAnyAllDay = weekDays.some(d => getAllDayEvents(d).length > 0)

  // 現在時刻ライン: 1分ごとに更新
  const [nowTop, setNowTop] = useState(() => getNowTop())
  useEffect(() => {
    const id = setInterval(() => setNowTop(getNowTop()), 60_000)
    return () => clearInterval(id)
  }, [])

  const showNowLine = nowTop >= 0 && nowTop <= NOW_TOP_MAX

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="flex flex-col min-w-[1036px]">

          {/* 曜日ヘッダー: sticky固定 */}
          <div className="sticky top-0 z-20 flex border-b bg-gray-50 flex-shrink-0">
            <div className="w-14 sm:w-16 flex-shrink-0" />
            {weekDays.map(day => {
              const isToday = isTodayDate(day)
              const isSat = isSaturday(day)
              const isSun = isSunday(day)
              const holidayName = holidayMap.get(toDateString(day)) ?? null
              const isRedDay = isSun || !!holidayName
              return (
                <div
                  key={toDateString(day)}
                  className={cn('flex-1 min-w-0 py-2 text-center border-l', isToday && 'bg-blue-50')}
                >
                  <div className={cn('text-xs font-medium',
                    isRedDay ? 'text-red-500' : isSat ? 'text-blue-600' : 'text-gray-500'
                  )}>{formatJa(day, 'EEE')}</div>
                  <div className={cn(
                    'mx-auto mt-0.5 w-8 h-8 flex items-center justify-center text-sm font-semibold rounded-full',
                    isToday ? 'bg-blue-600 text-white'
                      : isRedDay ? 'text-red-500'
                      : isSat ? 'text-blue-600'
                      : 'text-gray-800'
                  )}>{day.getDate()}</div>
                  {holidayName && (
                    <p className="text-xs text-red-500 leading-tight mt-0.5 truncate px-1 font-medium">
                      {holidayName}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {/* 終日イベント行 */}
          {hasAnyAllDay && (
            <div className="flex border-b bg-white flex-shrink-0">
              <div className="w-14 sm:w-16 flex-shrink-0 flex items-center justify-center py-1">
                <span className="text-xs text-gray-400 leading-tight">終日</span>
              </div>
              {weekDays.map(day => {
                const isToday = isTodayDate(day)
                const allDayEvents = getAllDayEvents(day)
                return (
                  <div
                    key={toDateString(day)}
                    className={cn('flex-1 min-w-0 border-l px-0.5 py-0.5 space-y-0.5', isToday && 'bg-blue-50')}
                  >
                    {allDayEvents.map(event => {
                      const typeConfig = getEventTypeConfig(event.type)
                      const manager = managers.find(m => m.id === event.groupLeaderId)
                      const cardStyle = colorMode === 'leader'
                        ? { ...getManagerColorStyle(manager?.color ?? '#6B7280'), borderWidth: 1, borderStyle: 'solid' as const }
                        : undefined
                      const cardClass = colorMode === 'type'
                        ? cn(typeConfig.bgColor, typeConfig.textColor, typeConfig.borderColor, 'border')
                        : undefined

                      return (
                        <button
                          key={event.id}
                          onClick={e => { e.stopPropagation(); onEventClick(event) }}
                          style={cardStyle}
                          className={cn(
                            'w-full text-left rounded px-1 py-0.5 text-xs truncate hover:brightness-95 transition-all',
                            cardClass
                          )}
                        >
                          {formatEventDisplay(event, 'week')}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {/* タイムグリッド */}
          <div className="flex pt-3">
            {/* 時間ラベル列 */}
            <div className="w-14 sm:w-16 flex-shrink-0 relative">
              {TIME_LABELS.map(t => (
                <div key={t} style={{ height: SLOT_HEIGHT }} className="border-b border-gray-100 relative">
                  {t.endsWith(':00') && (
                    <span className="absolute -top-2.5 right-2 text-xs text-gray-400 whitespace-nowrap">{t}</span>
                  )}
                </div>
              ))}
            </div>

            {/* 曜日列 */}
            {weekDays.map(day => {
              const isToday = isTodayDate(day)
              const positionedEvents = computeEventColumns(getTimedEvents(day))
              return (
                <div
                  key={toDateString(day)}
                  className={cn('flex-1 min-w-0 relative border-l', isToday && 'bg-blue-50')}
                >
                  {TIME_LABELS.map(slot => (
                    <div
                      key={slot}
                      style={{ height: SLOT_HEIGHT }}
                      onClick={() => onSlotClick(day, slot)}
                      className={cn(
                        'border-b cursor-pointer hover:bg-blue-100/50 transition-colors',
                        slot.endsWith(':00') ? 'border-gray-200' : 'border-gray-100 border-dashed'
                      )}
                    />
                  ))}

                  {positionedEvents.map(event => {
                    const { top, height } = getEventPosition(event.startTime, event.endTime)
                    const typeConfig = getEventTypeConfig(event.type)
                    const manager = managers.find(m => m.id === event.groupLeaderId)

                    const colW = 100 / event.columnCount
                    const colL = event.columnIndex * colW

                    const cardStyle = colorMode === 'leader'
                      ? {
                          ...getManagerColorStyle(manager?.color ?? '#6B7280'),
                          borderWidth: 1,
                          borderStyle: 'solid' as const,
                        }
                      : undefined
                    const cardClass = colorMode === 'type'
                      ? cn(typeConfig.bgColor, typeConfig.textColor, typeConfig.borderColor)
                      : undefined

                    const defaultIds = managerFacilities[event.groupLeaderId] ?? []
                    const isOutside = !!event.facilityId && defaultIds.length > 0 && !defaultIds.includes(event.facilityId)

                    return (
                      <button
                        key={event.id}
                        onClick={e => { e.stopPropagation(); onEventClick(event) }}
                        style={{
                          top,
                          height,
                          left: `calc(${colL}% + 1px)`,
                          width: `calc(${colW}% - 2px)`,
                          ...(cardStyle ?? {}),
                        }}
                        className={cn(
                          'absolute rounded border overflow-hidden text-left px-1 py-0.5',
                          'hover:brightness-95 transition-all z-10',
                          cardClass
                        )}
                      >
                        <p className="text-xs font-semibold truncate leading-tight">
                          【{typeConfig.label}】
                        </p>
                        <p className="text-xs opacity-70 truncate leading-tight">
                          {event.startTime}〜{event.endTime}
                        </p>
                        {height >= 44 && (
                          <p className="text-xs opacity-70 leading-tight">
                            {isHalfDayType(event.type) ? event.groupLeaderName : (event.facilityName || '施設未設定')}
                            {isOutside && !isHalfDayType(event.type) && (
                              <span className="ml-1 text-[9px] px-0.5 py-px rounded bg-amber-200 text-amber-800 border border-amber-300 font-bold">担当外</span>
                            )}
                          </p>
                        )}
                        {height >= 60 && (
                          <p className="text-xs opacity-70 leading-tight">{event.title}</p>
                        )}
                        {height >= 76 && (
                          <p className="text-xs opacity-50 truncate leading-tight">{event.groupLeaderName}</p>
                        )}
                      </button>
                    )
                  })}

                  {/* 現在時刻ライン（今日の列のみ） */}
                  {isToday && showNowLine && (
                    <>
                      <div
                        className="absolute left-0 right-0 h-px bg-red-500 z-20 pointer-events-none"
                        style={{ top: nowTop }}
                      />
                      <div
                        className="absolute w-2.5 h-2.5 rounded-full bg-red-500 z-20 pointer-events-none"
                        style={{ top: nowTop - 5, left: -5 }}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>

        </div>
      </div>
    </div>
  )
}
