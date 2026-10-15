import { EventType, MeetingType } from '@/lib/types'

export interface EventTypeConfig {
  value: EventType
  label: string
  bgColor: string
  textColor: string
  borderColor: string
  dotColor: string
  solidBg: string
  /** タイトル自動生成時に使うラベル（未指定時は label を使用） */
  autoTitleLabel?: string
  /** タイトル自動生成時に施設名との間に入れる区切り（未指定時は区切りなし） */
  autoTitleSeparator?: string
}

// 色は色相環で隣り合わないように割り当てている（背景が薄い色のため、隣の色相だと見分けにくい）。
// 休みの種別は「公休・半休＝slate」「有休・半有休＝teal」で揃え、半日の種別は薄い背景＋点線の枠で見分ける。
export const EVENT_TYPES: EventTypeConfig[] = [
  {
    value: 'patrol',
    label: '巡回',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-300',
    dotColor: 'bg-blue-500',
    solidBg: '#3B82F6',
  },
  {
    value: 'meeting',
    label: '会議',
    bgColor: 'bg-violet-100',
    textColor: 'text-violet-800',
    borderColor: 'border-violet-300',
    dotColor: 'bg-violet-500',
    solidBg: '#8B5CF6',
  },
  {
    value: 'interview',
    label: '面談',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-800',
    borderColor: 'border-emerald-300',
    dotColor: 'bg-emerald-500',
    solidBg: '#10B981',
  },
  {
    value: 'job_interview',
    label: '面接',
    bgColor: 'bg-lime-100',
    textColor: 'text-lime-800',
    borderColor: 'border-lime-400',
    dotColor: 'bg-lime-500',
    solidBg: '#84CC16',
  },
  {
    value: 'mt',
    label: 'MT',
    bgColor: 'bg-fuchsia-100',
    textColor: 'text-fuchsia-800',
    borderColor: 'border-fuchsia-300',
    dotColor: 'bg-fuchsia-500',
    solidBg: '#D946EF',
    autoTitleLabel: 'ミーティング',
  },
  {
    value: 'vacancy',
    label: '欠員対応',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-300',
    dotColor: 'bg-red-500',
    solidBg: '#EF4444',
  },
  {
    value: 'office',
    label: '事務作業',
    bgColor: 'bg-cyan-100',
    textColor: 'text-cyan-800',
    borderColor: 'border-cyan-300',
    dotColor: 'bg-cyan-500',
    solidBg: '#06B6D4',
  },
  {
    value: 'trouble',
    label: 'トラブル対応',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
    borderColor: 'border-orange-300',
    dotColor: 'bg-orange-500',
    solidBg: '#F97316',
  },
  {
    value: 'holiday_work',
    label: '休日出勤',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-400',
    dotColor: 'bg-amber-500',
    solidBg: '#F59E0B',
    autoTitleSeparator: '／',
  },
  {
    value: 'kyukyu',
    label: '公休',
    bgColor: 'bg-slate-100',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-300',
    dotColor: 'bg-slate-500',
    solidBg: '#64748B',
  },
  {
    value: 'yukyu',
    label: '有休',
    bgColor: 'bg-teal-100',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-300',
    dotColor: 'bg-teal-500',
    solidBg: '#14B8A6',
  },
  {
    value: 'hankyuu',
    label: '半休',
    bgColor: 'bg-slate-50',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-400 border-dashed',
    dotColor: 'bg-slate-300',
    solidBg: '#94A3B8',
  },
  {
    value: 'han_yukyu',
    label: '半有休',
    bgColor: 'bg-teal-50',
    textColor: 'text-teal-800',
    borderColor: 'border-teal-400 border-dashed',
    dotColor: 'bg-teal-300',
    solidBg: '#5EEAD4',
  },
  // シフト変更記録からの自動登録専用（手動の予定では選べない。MANUAL_EVENT_TYPES から除外）。
  // 編集・削除はシフト変更画面からだけ行う。濃い枠で手動の予定と見分けやすくする
  {
    value: 'shift_change',
    label: 'シフト変更',
    bgColor: 'bg-indigo-50',
    textColor: 'text-indigo-900',
    borderColor: 'border-indigo-500',
    dotColor: 'bg-indigo-500',
    solidBg: '#6366F1',
  },
  {
    value: 'other',
    label: 'その他',
    bgColor: 'bg-white',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-400',
    dotColor: 'bg-gray-400',
    solidBg: '#9CA3AF',
  },
]

/** 予定の登録・編集画面で選べる種別（自動登録専用の種別を除く） */
export const MANUAL_EVENT_TYPES: EventTypeConfig[] = EVENT_TYPES.filter(t => t.value !== 'shift_change')

export const getEventTypeConfig = (type: EventType): EventTypeConfig => {
  return EVENT_TYPES.find(t => t.value === type) ?? EVENT_TYPES[EVENT_TYPES.length - 1]
}

/** 全日予定として扱う種別の一覧。将来「研修」などを追加する場合はここに加える */
export const ALL_DAY_EVENT_TYPES: EventType[] = ['kyukyu', 'yukyu']

/** 指定種別が全日予定かどうかを返す */
export function isAllDayType(type: EventType): boolean {
  return ALL_DAY_EVENT_TYPES.includes(type)
}

/** 半休として扱う種別の一覧（時間指定・開始時間+4時間） */
export const HALF_DAY_EVENT_TYPES: EventType[] = ['hankyuu', 'han_yukyu']

/** 指定種別が半休かどうかを返す */
export function isHalfDayType(type: EventType): boolean {
  return HALF_DAY_EVENT_TYPES.includes(type)
}

/** 半休の終了時間を開始時間+4時間で返す */
export function computeHalfDayEndTime(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number)
  const endH = h + 4
  return `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 施設名と種別からタイトルを自動生成する（例：「〇〇」＋「巡回」→「〇〇巡回」、「〇〇」＋「休日出勤」→「〇〇／休日出勤」） */
export function buildAutoTitle(type: EventType, facilityName: string): string {
  const config = getEventTypeConfig(type)
  const separator = facilityName ? (config.autoTitleSeparator ?? '') : ''
  return `${facilityName}${separator}${config.autoTitleLabel ?? config.label}`
}

/** MTの日程確定時にschedules.titleへ設定するタイトルを自動生成する（type='mt'固定） */
export function buildMeetingScheduleTitle(meetingType: MeetingType, facilityName: string): string {
  const label = meetingType === 'kitchen' ? '厨房内MT' : '施設MT'
  return `${facilityName}${label}`
}
