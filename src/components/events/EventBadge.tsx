'use client'

import { cn, getManagerColorStyle } from '@/lib/utils'
import { getEventTypeConfig } from '@/constants/eventTypes'
import type { ColorMode, GroupManager, ScheduleEvent } from '@/lib/types'

interface EventBadgeProps {
  event: ScheduleEvent
  managers: GroupManager[]
  managerFacilities?: Record<string, string[]>
  onClick?: () => void
  compact?: boolean
  colorMode?: ColorMode
}

function isOutsideFacility(
  managerId: string,
  facilityId: string | null,
  managerFacilities: Record<string, string[]> | undefined,
): boolean {
  if (!facilityId || !managerFacilities) return false
  const defaults = managerFacilities[managerId]
  if (!defaults || defaults.length === 0) return false
  return !defaults.includes(facilityId)
}

export function EventBadge({
  event,
  managers,
  managerFacilities,
  onClick,
  compact = false,
  colorMode = 'type',
}: EventBadgeProps) {
  const config = getEventTypeConfig(event.type)
  const manager = managers.find(m => m.id === event.groupLeaderId)
  const isOutside = isOutsideFacility(event.groupLeaderId, event.facilityId, managerFacilities)

  if (colorMode === 'leader') {
    const style = getManagerColorStyle(manager?.color ?? '#6B7280')
    return (
      <button
        onClick={onClick}
        style={{ ...style, borderWidth: 1, borderStyle: 'solid' }}
        className={cn(
          'w-full text-left rounded transition-opacity hover:opacity-80 overflow-hidden',
          compact ? 'text-xs px-1 py-0.5' : 'text-xs px-1.5 py-1'
        )}
      >
        <span className="flex items-center gap-1 min-w-0">
          {isOutside && (
            <span className="shrink-0 text-[9px] px-0.5 py-px rounded bg-amber-200 text-amber-800 font-bold leading-none border border-amber-300">
              外
            </span>
          )}
          <span className="truncate min-w-0">
            {!event.isAllDay && <span className="font-medium">{event.startTime} </span>}
            <span>{event.title}</span>
          </span>
        </span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left rounded border transition-opacity hover:opacity-80 overflow-hidden',
        config.bgColor, config.textColor, config.borderColor,
        compact ? 'text-xs px-1 py-0.5' : 'text-xs px-1.5 py-1'
      )}
    >
      <span className="flex items-center gap-1 min-w-0">
        {isOutside && (
          <span className="shrink-0 text-[9px] px-0.5 py-px rounded bg-amber-200 text-amber-800 font-bold leading-none border border-amber-300">
            外
          </span>
        )}
        <span className="truncate min-w-0">
          {!event.isAllDay && <span className="font-medium">{event.startTime} </span>}
          <span>{event.title}</span>
        </span>
      </span>
    </button>
  )
}
