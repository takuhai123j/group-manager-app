'use client'

import {
  cn, formatJa, toDateString, generateTimeSlots, getEventPosition,
  isTodayDate, isSaturday, isSunday, getManagerColorStyle, SLOT_HEIGHT, GRID_START_HOUR,
} from '@/lib/utils'
import { getHolidayName } from '@/lib/holidays'
import { getEventTypeConfig } from '@/constants/eventTypes'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface DayViewProps {
  currentDate: Date
  events: ScheduleEvent[]
  managers: GroupManager[]
  colorMode: ColorMode
  onSlotClick: (date: Date, time: string) => void
  onEventClick: (event: ScheduleEvent) => void
}

const TIME_LABELS = generateTimeSlots(GRID_START_HOUR, 22)

export function DayView({ currentDate, events, managers, colorMode, onSlotClick, onEventClick }: DayViewProps) {
  const allEvents = events.filter(e => e.date === toDateString(currentDate))
  const allDayEvents = allEvents.filter(e => e.isAllDay)
  const timedEvents = allEvents
    .filter(e => !e.isAllDay)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  const isToday = isTodayDate(currentDate)
  const isSat = isSaturday(currentDate)
  const isSun = isSunday(currentDate)
  const holidayName = getHolidayName(currentDate)
  const isRedDay = isSun || !!holidayName

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Day header */}
      <div className="flex-shrink-0 border-b bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-12 h-12 flex items-center justify-center rounded-full text-xl font-bold flex-shrink-0',
            isToday ? 'bg-blue-600 text-white'
              : isRedDay ? 'bg-red-50 border-2 border-red-200 text-red-600'
              : isSat ? 'bg-blue-50 border-2 border-blue-200 text-blue-600'
              : 'bg-white border-2 border-gray-200 text-gray-800'
          )}>{currentDate.getDate()}</div>
          <div>
            <p className="text-lg font-semibold text-gray-800">{formatJa(currentDate, 'yyyy年M月d日')}</p>
            <p className="text-sm text-gray-500">
              {formatJa(currentDate, 'EEEE')}
              {isToday && <span className="ml-2 text-blue-600 font-medium">今日</span>}
              {holidayName && <span className="ml-2 text-red-500 font-medium">{holidayName}</span>}
            </p>
          </div>
          <div className="ml-auto text-sm text-gray-500">{allEvents.length}件の予定</div>
        </div>
      </div>

      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <div className="flex-shrink-0 border-b bg-white px-4 py-2 space-y-1.5">
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
                {typeConfig.label}｜{event.groupLeaderName}
              </button>
            )
          })}
        </div>
      )}

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
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
          <div className="flex-1 relative border-l">
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

            {timedEvents.map(event => {
              const { top, height } = getEventPosition(event.startTime, event.endTime)
              const typeConfig = getEventTypeConfig(event.type)
              const manager = managers.find(m => m.id === event.groupLeaderId)

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

              return (
                <button
                  key={event.id}
                  onClick={e => { e.stopPropagation(); onEventClick(event) }}
                  style={{ top, height, ...(cardStyle ?? {}) }}
                  className={cn(
                    'absolute left-1 right-1 rounded-lg border overflow-hidden text-left px-3 py-1.5',
                    'hover:brightness-95 transition-all z-10 shadow-sm',
                    cardClass
                  )}
                >
                  {/* Title + type badge */}
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-sm font-semibold truncate leading-snug">{event.title}</p>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 border',
                      typeConfig.bgColor, typeConfig.textColor, typeConfig.borderColor
                    )}>{typeConfig.label}</span>
                  </div>
                  {/* Time */}
                  <p className="text-xs opacity-80 mt-0.5">{event.startTime} 〜 {event.endTime}</p>
                  {/* Facility */}
                  {height >= 60 && event.facilityName && (
                    <p className="text-xs opacity-70 mt-0.5">📍 {event.facilityName}</p>
                  )}
                  {/* Group leader */}
                  {height >= 76 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: manager?.color ?? '#6B7280' }}
                      />
                      <p className="text-xs opacity-70">{event.groupLeaderName}</p>
                    </div>
                  )}
                  {/* Memo */}
                  {height >= 100 && event.memo && (
                    <p className="text-xs opacity-55 mt-0.5 truncate">📝 {event.memo}</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {allEvents.length === 0 && (
        <div className="flex-shrink-0 text-center py-6 text-gray-400 text-sm">
          この日の予定はありません
        </div>
      )}
    </div>
  )
}
