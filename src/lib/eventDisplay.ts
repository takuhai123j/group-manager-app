import type { CalendarView, ScheduleEvent } from '@/lib/types'
import { getEventTypeConfig, isHalfDayType } from '@/constants/eventTypes'
import { shiftChangeTypeFromTitle } from '@/lib/shiftChangeCalendar'

/**
 * カレンダー表示用のイベントテキストを生成する共通関数
 *
 * month: "9:00【面接】高槻南"
 * week/day: "9:00【面接】高槻南｜調理員面接"
 * 全日: "【公休】福田G長"
 */
export function formatEventDisplay(event: ScheduleEvent, viewType: CalendarView): string {
  // シフト変更からの自動登録は、種別の代わりに変更種別（欠勤・時間変更など）を見出しにし、
  // 担当者別の色表示でも手動の予定と見分けられるよう「⇆」を付ける
  const isShiftChange = event.type === 'shift_change'
  const typeLabel = isShiftChange
    ? shiftChangeTypeFromTitle(event.title)
    : getEventTypeConfig(event.type).label
  const typeTag = `${isShiftChange ? '⇆' : ''}【${typeLabel}】`

  if (event.isAllDay) {
    return `${typeTag}${event.groupLeaderName}`
  }

  if (isHalfDayType(event.type)) {
    const timePrefix = event.startTime ?? ''
    if (viewType === 'month') {
      return `${timePrefix} ${typeLabel}｜${event.groupLeaderName}`
    }
    return `${timePrefix}${typeTag}${event.groupLeaderName}`
  }

  const timePrefix = event.startTime ?? ''
  const facilityPart = event.facilityName || '施設未設定'

  if (viewType === 'month') {
    return `${timePrefix}${typeTag}${facilityPart}`
  }

  return `${timePrefix}${typeTag}${facilityPart}｜${event.title}`
}
