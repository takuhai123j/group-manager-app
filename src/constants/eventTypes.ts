import { EventType } from '@/lib/types'

export interface EventTypeConfig {
  value: EventType
  label: string
  bgColor: string
  textColor: string
  borderColor: string
  dotColor: string
  solidBg: string
}

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
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
    borderColor: 'border-purple-300',
    dotColor: 'bg-purple-500',
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
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-800',
    borderColor: 'border-amber-300',
    dotColor: 'bg-amber-500',
    solidBg: '#D97706',
  },
  {
    value: 'mt',
    label: 'MT',
    bgColor: 'bg-sky-100',
    textColor: 'text-sky-800',
    borderColor: 'border-sky-300',
    dotColor: 'bg-sky-500',
    solidBg: '#0EA5E9',
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
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-300',
    dotColor: 'bg-gray-500',
    solidBg: '#6B7280',
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
    value: 'other',
    label: 'その他',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-300',
    dotColor: 'bg-yellow-500',
    solidBg: '#F59E0B',
  },
]

export const getEventTypeConfig = (type: EventType): EventTypeConfig => {
  return EVENT_TYPES.find(t => t.value === type) ?? EVENT_TYPES[EVENT_TYPES.length - 1]
}

/** 全日予定として扱う種別の一覧。将来「研修」などを追加する場合はここに加える */
export const ALL_DAY_EVENT_TYPES: EventType[] = ['kyukyu', 'yukyu']

/** 指定種別が全日予定かどうかを返す */
export function isAllDayType(type: EventType): boolean {
  return ALL_DAY_EVENT_TYPES.includes(type)
}
