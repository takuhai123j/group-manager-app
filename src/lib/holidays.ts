import HolidayJP from '@holiday-jp/holiday_jp'
import { format } from 'date-fns'

// holidays オブジェクトを動的文字列キーでアクセスできるようにキャスト
const holidayRecord = HolidayJP.holidays as unknown as Record<
  string,
  { name: string; name_en: string } | undefined
>

/** Date → YYYY-MM-DD（toDateString と同一フォーマット・ローカルタイムゾーン） */
function fmt(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/**
 * 指定期間内の日本の祝日を Map<YYYY-MM-DD, 祝日名> で返す。
 * 月表示・週表示などで一括取得するときに使用する。
 */
export function getJapaneseHolidays(startDate: Date, endDate: Date): Map<string, string> {
  const s = fmt(startDate)
  const e = fmt(endDate)
  const map = new Map<string, string>()
  for (const [k, v] of Object.entries(holidayRecord)) {
    if (v && k >= s && k <= e) map.set(k, v.name)
  }
  return map
}

/**
 * 指定日が日本の祝日かどうかを返す。
 */
export function isJapaneseHoliday(date: Date): boolean {
  return holidayRecord[fmt(date)] !== undefined
}

/**
 * 指定日の祝日名を返す。祝日でない場合は null。
 */
export function getHolidayName(date: Date): string | null {
  return holidayRecord[fmt(date)]?.name ?? null
}
