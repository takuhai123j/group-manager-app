'use client'

import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth,
} from 'date-fns'
import { cn, toDateString, isTodayDate, isSaturday, isSunday } from '@/lib/utils'
import { getJapaneseHolidays } from '@/lib/holidays'
import { EventBadge } from '@/components/events/EventBadge'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface MonthViewProps {
  currentDate: Date
  events: ScheduleEvent[]
  managers: GroupManager[]
  colorMode: ColorMode
  onDayClick: (date: Date) => void
  onEventClick: (event: ScheduleEvent) => void
}

const DAY_HEADERS = ['月', '火', '水', '木', '金', '土', '日']

export function MonthView({ currentDate, events, managers, colorMode, onDayClick, onEventClick }: MonthViewProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }),
  })

  const holidayMap = getJapaneseHolidays(days[0], days[days.length - 1])

  const getEventsForDay = (date: Date) =>
    events.filter(e => e.date === toDateString(date))
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-7 border-b bg-gray-50">
        {DAY_HEADERS.map((day, i) => (
          <div key={day} className={cn(
            'py-2 text-center text-xs font-semibold',
            i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-gray-500'
          )}>{day}</div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 grid-rows-6 border-l">
        {days.map(day => {
          const dayEvents = getEventsForDay(day)
          const isToday = isTodayDate(day)
          const isSat = isSaturday(day)
          const isSun = isSunday(day)
          const isCurrent = isSameMonth(day, currentDate)
          const holidayName = holidayMap.get(toDateString(day)) ?? null
          const isRedDay = isSun || !!holidayName

          return (
            <div
              key={toDateString(day)}
              onClick={() => onDayClick(day)}
              className={cn(
                'border-r border-b min-h-[80px] sm:min-h-[100px] p-1 cursor-pointer hover:bg-blue-50/30 transition-colors',
                !isCurrent && 'bg-gray-50'
              )}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className={cn(
                  'inline-flex items-center justify-center w-7 h-7 text-sm rounded-full font-medium',
                  isToday ? 'bg-blue-600 text-white'
                    : isRedDay ? (isCurrent ? 'text-red-500' : 'text-red-300')
                    : isSat ? (isCurrent ? 'text-blue-600' : 'text-blue-300')
                    : isCurrent ? 'text-gray-800'
                    : 'text-gray-400'
                )}>
                  {day.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className="text-xs text-gray-400 pr-0.5">{dayEvents.length}件</span>
                )}
              </div>
              {holidayName && (
                <p className="text-xs text-red-500 font-medium truncate leading-tight mb-0.5 px-0.5">
                  {holidayName}
                </p>
              )}
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map(event => (
                  <EventBadge
                    key={event.id}
                    event={event}
                    managers={managers}
                    compact
                    colorMode={colorMode}
                    onClick={() => onEventClick(event)}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <p className="text-xs text-gray-400 pl-1">他{dayEvents.length - 3}件</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
