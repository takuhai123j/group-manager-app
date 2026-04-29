'use client'

import { cn, getManagerColorStyle } from '@/lib/utils'
import { getEventTypeConfig } from '@/constants/eventTypes'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface EventBadgeProps {
  event: ScheduleEvent
  managers: GroupManager[]
  onClick?: () => void
  compact?: boolean
  colorMode?: ColorMode
}

export function EventBadge({ event, managers, onClick, compact = false, colorMode = 'type' }: EventBadgeProps) {
  if (colorMode === 'leader') {
    const manager = managers.find(m => m.id === event.groupLeaderId)
    const style = getManagerColorStyle(manager?.color ?? '#6B7280')
    return (
      <button
        onClick={onClick}
        style={{ ...style, borderWidth: 1, borderStyle: 'solid' }}
        className={cn(
          'w-full text-left rounded truncate transition-opacity hover:opacity-80',
          compact ? 'text-xs px-1 py-0.5' : 'text-xs px-1.5 py-1'
        )}
      >
        <span className="font-medium">{event.startTime}</span>
        {' '}
        <span>{event.title}</span>
      </button>
    )
  }

  const config = getEventTypeConfig(event.type)
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded border truncate transition-opacity hover:opacity-80',
        config.bgColor, config.textColor, config.borderColor,
        compact ? 'text-xs px-1 py-0.5' : 'text-xs px-1.5 py-1'
      )}
    >
      <span className="font-medium">{event.startTime}</span>
      {' '}
      <span>{event.title}</span>
    </button>
  )
}
