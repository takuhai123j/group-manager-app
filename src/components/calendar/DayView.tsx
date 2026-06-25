'use client'

import { useState, useEffect } from 'react'
import {
  cn, formatJa, toDateString, generateTimeSlots, getEventPosition,
  isTodayDate, isSaturday, isSunday, getManagerColorStyle, SLOT_HEIGHT, GRID_START_HOUR,
  computeEventColumns,
} from '@/lib/utils'
import { getHolidayName } from '@/lib/holidays'
import { getEventTypeConfig, isHalfDayType } from '@/constants/eventTypes'
import { formatEventDisplay } from '@/lib/eventDisplay'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface DayViewProps {
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

export function DayView({ currentDate, events, managers, managerFacilities, colorMode, onSlotClick, onEventClick }: DayViewProps) {
  const allEvents = events.filter(e => e.date === toDateString(currentDate))
  const allDayEvents = allEvents.filter(e => e.isAllDay)
  const positionedEvents = computeEventColumns(allEvents.filter(e => !e.isAllDay))
  // モバイルリスト表示用（時刻順ソート済み）
  const timedEventsSorted = allEvents
    .filter(e => !e.isAllDay)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  const isToday = isTodayDate(currentDate)
  const isSat = isSaturday(currentDate)
  const isSun = isSunday(currentDate)
  const holidayName = getHolidayName(currentDate)
  const isRedDay = isSun || !!holidayName

  // 現在時刻ライン: 1分ごとに更新
  const [nowTop, setNowTop] = useState(() => getNowTop())
  useEffect(() => {
    const id = setInterval(() => setNowTop(getNowTop()), 60_000)
    return () => clearInterval(id)
  }, [])
  const showNowLine = isToday && nowTop >= 0 && nowTop <= NOW_TOP_MAX

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Day header - compact on mobile */}
      <div className="flex-shrink-0 border-b bg-gray-50 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={cn(
            'w-9 h-9 sm:w-12 sm:h-12 flex items-center justify-center rounded-full text-base sm:text-xl font-bold flex-shrink-0',
            isToday ? 'bg-blue-600 text-white'
              : isRedDay ? 'bg-red-50 border-2 border-red-200 text-red-600'
              : isSat ? 'bg-blue-50 border-2 border-blue-200 text-blue-600'
              : 'bg-white border-2 border-gray-200 text-gray-800'
          )}>{currentDate.getDate()}</div>
          <div className="min-w-0">
            <p className="text-sm sm:text-lg font-semibold text-gray-800 truncate">{formatJa(currentDate, 'yyyy年M月d日')}</p>
            <p className="text-xs sm:text-sm text-gray-500 flex items-center gap-1 flex-wrap">
              {formatJa(currentDate, 'EEEE')}
              {isToday && <span className="text-blue-600 font-medium">今日</span>}
              {holidayName && <span className="text-red-500 font-medium">{holidayName}</span>}
            </p>
          </div>
          <div className="ml-auto text-xs sm:text-sm text-gray-500 whitespace-nowrap">{allEvents.length}件</div>
        </div>
      </div>

      {/* ===== スマホ専用: リスト表示 ===== */}
      <div className="sm:hidden flex-1 overflow-y-auto min-h-0 bg-white">
        {/* 全日予定 */}
        {allDayEvents.length > 0 && (
          <div className="px-4 pt-3 pb-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-400 font-medium mb-2">終日</p>
            <div className="space-y-2">
              {allDayEvents.map(event => {
                const typeConfig = getEventTypeConfig(event.type)
                const manager = managers.find(m => m.id === event.groupLeaderId)
                const barColor = manager?.color ?? '#6B7280'
                return (
                  <button
                    key={event.id}
                    onClick={e => { e.stopPropagation(); onEventClick(event) }}
                    className="w-full text-left flex items-center gap-3 py-1.5 hover:opacity-75 active:opacity-60 transition-opacity"
                  >
                    <div className="w-1.5 self-stretch rounded-full flex-shrink-0 min-h-[20px]" style={{ backgroundColor: barColor }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        <span className={cn('font-bold', typeConfig.textColor)}>{typeConfig.label}</span>
                        {event.groupLeaderName && <span className="text-gray-600">｜{event.groupLeaderName}</span>}
                      </p>
                      {event.title && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{event.title}</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 時間指定予定 */}
        {timedEventsSorted.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {timedEventsSorted.map(event => {
              const typeConfig = getEventTypeConfig(event.type)
              const manager = managers.find(m => m.id === event.groupLeaderId)
              const barColor = manager?.color ?? '#6B7280'
              const defaultIds = managerFacilities[event.groupLeaderId] ?? []
              const isOutside = !!event.facilityId && defaultIds.length > 0 && !defaultIds.includes(event.facilityId)
              return (
                <button
                  key={event.id}
                  onClick={e => { e.stopPropagation(); onEventClick(event) }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-1.5 self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: barColor }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 leading-tight">
                        {event.startTime}〜{event.endTime}
                        <span className={cn('ml-2 font-semibold', typeConfig.textColor)}>{typeConfig.label}</span>
                      </p>
                      <p className="text-sm font-medium text-gray-800 mt-1 leading-tight flex items-center gap-1 flex-wrap">
                        <span className="truncate">
                          {isHalfDayType(event.type)
                            ? event.groupLeaderName
                            : event.facilityName || '施設未設定'
                          }
                        </span>
                        {isOutside && !isHalfDayType(event.type) && (
                          <span className="text-[10px] px-1 py-px rounded bg-amber-200 text-amber-800 border border-amber-300 font-bold flex-shrink-0">担当外</span>
                        )}
                      </p>
                      {event.title && (
                        <p className="text-sm text-gray-500 truncate mt-0.5">{event.title}</p>
                      )}
                      {!isHalfDayType(event.type) && event.groupLeaderName && (
                        <div className="flex items-center gap-1 mt-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
                          <p className="text-xs text-gray-400">{event.groupLeaderName}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : allDayEvents.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">予定はありません</div>
        ) : null}
      </div>

      {/* ===== PC専用: 全日予定セクション ===== */}
      {allDayEvents.length > 0 && (
        <div className="hidden sm:block flex-shrink-0 border-b bg-white px-4 py-2 space-y-1.5">
          <p className="text-xs text-gray-400 font-medium mb-1">終日</p>
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
                  'w-full text-left rounded-lg px-3 py-2 text-sm font-medium hover:brightness-95 transition-all',
                  cardClass
                )}
              >
                {formatEventDisplay(event, 'day')}
              </button>
            )
          })}
        </div>
      )}

      {/* ===== PC専用: タイムグリッド ===== */}
      <div className="hidden sm:block flex-1 overflow-y-auto min-h-0">
        <div className="flex">
          {/* Time labels */}
          <div className="w-16 flex-shrink-0">
            {TIME_LABELS.map(t => (
              <div key={t} style={{ height: SLOT_HEIGHT }} className="border-b border-gray-100 relative">
                {t.endsWith(':00') && (
                  <span className="absolute -top-2.5 right-2 text-xs text-gray-400">{t}</span>
                )}
              </div>
            ))}
          </div>

          {/* Main column */}
          <div className={cn('flex-1 relative border-l', isToday && 'bg-blue-50')}>
            {TIME_LABELS.map(slot => (
              <div
                key={slot}
                style={{ height: SLOT_HEIGHT }}
                onClick={() => onSlotClick(currentDate, slot)}
                className={cn(
                  'border-b cursor-pointer hover:bg-blue-50/50 transition-colors',
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
                ? { ...getManagerColorStyle(manager?.color ?? '#6B7280'), borderWidth: 1, borderStyle: 'solid' as const }
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
                    'absolute rounded-lg border overflow-hidden text-left px-2 py-1',
                    'hover:brightness-95 transition-all z-10 shadow-sm',
                    cardClass
                  )}
                >
                  <p className="text-sm font-bold truncate leading-tight">【{typeConfig.label}】</p>
                  <p className="text-xs opacity-80 mt-0.5">{event.startTime}〜{event.endTime}</p>
                  {height >= 44 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <p className="text-xs opacity-70 truncate">
                        {isHalfDayType(event.type) ? `👤 ${event.groupLeaderName}` : `📍 ${event.facilityName || '施設未設定'}`}
                      </p>
                      {isOutside && !isHalfDayType(event.type) && (
                        <span className="shrink-0 text-[10px] px-1 py-px rounded bg-amber-200 text-amber-800 border border-amber-300 font-bold leading-none">担当外</span>
                      )}
                    </div>
                  )}
                  {height >= 60 && (
                    <p className="text-xs font-medium truncate mt-0.5">{event.title}</p>
                  )}
                  {height >= 76 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: manager?.color ?? '#6B7280' }} />
                      <p className="text-xs opacity-70 truncate">{event.groupLeaderName}</p>
                    </div>
                  )}
                  {height >= 100 && event.memo && (
                    <p className="text-xs opacity-55 mt-0.5 truncate">📝 {event.memo}</p>
                  )}
                </button>
              )
            })}

            {/* 現在時刻ライン */}
            {showNowLine && (
              <>
                <div className="absolute left-0 right-0 h-px bg-red-500 z-20 pointer-events-none" style={{ top: nowTop }} />
                <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500 z-20 pointer-events-none" style={{ top: nowTop - 5, left: -5 }} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* PC専用: 予定なし */}
      {allEvents.length === 0 && (
        <div className="hidden sm:block flex-shrink-0 text-center py-6 text-gray-400 text-sm">
          この日の予定はありません
        </div>
      )}
    </div>
  )
}
