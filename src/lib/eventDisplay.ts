import type { CalendarView, ScheduleEvent } from '@/lib/types'
import { getEventTypeConfig } from '@/constants/eventTypes'

/**
 * カレンダー表示用のイベントテキストを生成する共通関数
 *
 * month: "9:00【面接】高槻南"
 * week/day: "9:00【面接】高槻南｜調理員面接"
 * 全日: "【公休】福田G長"
 */
export function formatEventDisplay(event: ScheduleEvent, viewType: CalendarView): string {
  const typeLabel = getEventTypeConfig(event.type).label
  const typeTag = `【${typeLabel}】`

  if (event.isAllDay) {
    return `${typeTag}${event.groupLeaderName}`
  }

  const timePrefix = event.startTime ?? ''
  const facilityPart = event.facilityName || '施設未設定'

  if (viewType === 'month') {
    return `${timePrefix}${typeTag}${facilityPart}`
  }

  return `${timePrefix}${typeTag}${facilityPart}｜${event.title}`
}
