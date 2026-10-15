'use client'

import { X, Lock, ArrowLeftRight } from 'lucide-react'
import { getEventTypeConfig } from '@/constants/eventTypes'
import { shiftChangeTypeFromTitle, formatCalendarTime } from '@/lib/shiftChangeCalendar'
import { cn } from '@/lib/utils'
import type { ScheduleEvent } from '@/lib/types'

// シフト変更から自動登録した予定の表示専用画面。
// 自動登録の予定はシフト変更の記録と連動させるため、カレンダー側では編集・削除させない
interface Props {
  event: ScheduleEvent | null
  onClose: () => void
  onOpenShiftChange: (recordId: string) => void
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()]
  return `${y}年${m}月${d}日（${w}）`
}

export function ShiftChangeEventInfo({ event, onClose, onOpenShiftChange }: Props) {
  if (!event || !event.shiftChangeRecordId) return null
  const config = getEventTypeConfig('shift_change')
  const recordId = event.shiftChangeRecordId

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">シフト変更の予定</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-3 text-sm">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold', config.bgColor, config.textColor, config.borderColor)}>
            <span className={cn('w-2 h-2 rounded-full', config.dotColor)} />
            {config.label}：{shiftChangeTypeFromTitle(event.title)}
          </span>
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 text-gray-700">
            <dt className="text-gray-500">担当</dt><dd>{event.groupLeaderName}</dd>
            <dt className="text-gray-500">日付</dt><dd>{formatDate(event.date)}</dd>
            <dt className="text-gray-500">時間</dt><dd>{event.isAllDay ? '終日' : formatCalendarTime(event.startTime, event.endTime)}</dd>
            <dt className="text-gray-500">施設</dt><dd>{event.facilityName || '—'}</dd>
          </dl>
          {event.memo && (
            <p className="whitespace-pre-wrap break-words text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">{event.memo}</p>
          )}
          <p className="flex items-start gap-1.5 text-xs text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
            <Lock size={13} className="flex-shrink-0 mt-0.5" />
            シフト変更の記録から自動で登録された予定です。変更・削除はシフト変更の記録から行ってください（ここでは編集できません）。
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
            閉じる
          </button>
          <button
            onClick={() => onOpenShiftChange(recordId)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <ArrowLeftRight size={14} />シフト変更の記録を開く
          </button>
        </div>
      </div>
    </div>
  )
}
