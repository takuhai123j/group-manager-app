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
