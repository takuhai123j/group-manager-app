import { toDateString } from '@/lib/utils'
import { getMeetingDisplayStatus, type Meeting, type MeetingType } from '@/lib/types'

export type MeetingCellStatus =
  | 'none'               // 計画なし
  | 'unscheduled'        // 計画あり・日程未定
  | 'confirmed'          // 日程確定済
  | 'done'               // 実施済
  | 'minutes_registered' // 議事録登録済
  | 'overdue'            // 期限超過

export const MEETING_CELL_STATUS_LABELS: Record<MeetingCellStatus, string> = {
  none: '計画なし',
  unscheduled: '日程未定',
  confirmed: '日程確定済',
  done: '実施済',
  minutes_registered: '議事録登録済',
  overdue: '期限超過',
}

// target_month（YYYY-MM-01）から年・月を取り出す
export function parseTargetMonth(targetMonth: string): { year: number; month: number } {
  const [y, m] = targetMonth.split('-').map(Number)
  return { year: y, month: m }
}

export function buildTargetMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

// 期限超過判定（DBには保存せず表示時に都度算出する）
//   - status = 'done' のものは対象外
//   - schedule_id あり → schedules.date < 今日
//   - schedule_id なし → target_month の月末 < 今日
export function isMeetingOverdue(meeting: Meeting, today: Date = new Date()): boolean {
  if (meeting.status !== 'scheduled') return false
  const todayStr = toDateString(today)

  if (meeting.scheduleId) {
    return !!meeting.scheduleDate && meeting.scheduleDate < todayStr
  }

  const { year, month } = parseTargetMonth(meeting.targetMonth)
  const lastDayOfMonth = new Date(year, month, 0) // month は1始まりのため day=0 で前月末＝対象月末になる
  return toDateString(lastDayOfMonth) < todayStr
}

export function getMeetingCellStatus(meeting: Meeting | undefined, today: Date = new Date()): MeetingCellStatus {
  if (!meeting) return 'none'

  const displayStatus = getMeetingDisplayStatus(meeting)
  if (displayStatus === 'done') return 'done'
  if (displayStatus === 'minutes_registered') return 'minutes_registered'

  if (isMeetingOverdue(meeting, today)) return 'overdue'
  return meeting.scheduleId ? 'confirmed' : 'unscheduled'
}

export const MEETING_TYPE_ORDER: MeetingType[] = ['facility', 'kitchen']

export const MONTHS_IN_YEAR = Array.from({ length: 12 }, (_, i) => i + 1)

// facilityId + meetingType + targetMonth をキーにした一覧参照用マップを作る
export function buildMeetingLookup(meetings: Meeting[]): Map<string, Meeting> {
  const map = new Map<string, Meeting>()
  for (const m of meetings) {
    map.set(`${m.facilityId}|${m.meetingType}|${m.targetMonth}`, m)
  }
  return map
}

export function meetingLookupKey(facilityId: string, meetingType: MeetingType, targetMonth: string): string {
  return `${facilityId}|${meetingType}|${targetMonth}`
}

// ---------------------------------------------------------
// ダッシュボード集計
// getMeetingCellStatus() / isMeetingOverdue() の判定結果をそのまま利用し、
// 別ロジックとして重複実装しない。
// ---------------------------------------------------------

// 「今月」は実際のカレンダー年月（today基準）で判定する。
// 判定に使う日付は effectiveDate = scheduleDate ?? targetMonth
// （日程確定済みなら実際の予定日、未確定なら計画月）とし、年・月の両方を比較する
// （月番号だけの比較だと、計画月と確定日が別の年にまたがるケースで誤判定するため）。
// parseTargetMonth は 'YYYY-MM-...' 形式の先頭2要素を読むだけなので、
// targetMonth（YYYY-MM-01）・scheduleDate（YYYY-MM-DD）のどちらにも使える。
export function getThisMonthMeetings(meetings: Meeting[], today: Date = new Date()): Meeting[] {
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  return meetings.filter(m => {
    const effectiveDate = m.scheduleDate ?? m.targetMonth
    const { year, month } = parseTargetMonth(effectiveDate)
    return year === currentYear && month === currentMonth
  })
}

export function getOverdueMeetings(meetings: Meeting[], today: Date = new Date()): Meeting[] {
  return meetings.filter(m => getMeetingCellStatus(m, today) === 'overdue')
}

// 実施済だが議事録が1件も登録されていないもの
export function getDoneUnregisteredMeetings(meetings: Meeting[], today: Date = new Date()): Meeting[] {
  return meetings.filter(m => getMeetingCellStatus(m, today) === 'done')
}

export function getMinutesRegisteredMeetings(meetings: Meeting[], today: Date = new Date()): Meeting[] {
  return meetings.filter(m => getMeetingCellStatus(m, today) === 'minutes_registered')
}

export interface MeetingDashboardSummary {
  thisMonth: Meeting[]
  overdue: Meeting[]
  doneUnregistered: Meeting[]
  minutesRegistered: Meeting[]
}

export function buildMeetingDashboardSummary(meetings: Meeting[], today: Date = new Date()): MeetingDashboardSummary {
  return {
    thisMonth: getThisMonthMeetings(meetings, today),
    overdue: getOverdueMeetings(meetings, today),
    doneUnregistered: getDoneUnregisteredMeetings(meetings, today),
    minutesRegistered: getMinutesRegisteredMeetings(meetings, today),
  }
}

// 実施日からの経過日数（議事録未登録一覧で使用）
export function elapsedDaysSince(dateStr: string, today: Date = new Date()): number {
  const todayStr = toDateString(today)
  const start = new Date(dateStr + 'T00:00:00')
  const end = new Date(todayStr + 'T00:00:00')
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
}

// 施設ごとのMT進捗（予定件数 / 実施件数 / 議事録登録件数。facility種別+kitchen種別を合算）
export interface FacilityMeetingProgress {
  facilityId: string
  facilityName: string
  plannedCount: number
  doneCount: number
  minutesCount: number
}

export function buildFacilityMeetingProgress(
  meetings: Meeting[],
  facilities: Array<{ id: string; name: string }>
): FacilityMeetingProgress[] {
  return facilities.map(f => {
    const forFacility = meetings.filter(m => m.facilityId === f.id)
    return {
      facilityId: f.id,
      facilityName: f.name,
      plannedCount: forFacility.length,
      doneCount: forFacility.filter(m => m.status === 'done').length,
      minutesCount: forFacility.filter(m => m.minutesCount > 0).length,
    }
  })
}
