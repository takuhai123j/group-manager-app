'use client'

import { ChevronLeft, ChevronRight, Plus, Building2, Users } from 'lucide-react'
import { cn, formatJa } from '@/lib/utils'
import type { CalendarView } from '@/lib/types'

interface CalendarHeaderProps {
  currentDate: Date
  view: CalendarView
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onChangeView: (view: CalendarView) => void
  onAddEvent: () => void
  onOpenGroupManager: () => void
  onOpenFacilityManager: () => void
}

const VIEW_LABELS: Record<CalendarView, string> = { month: '月', week: '週', day: '日' }

function getTitle(date: Date, view: CalendarView): string {
  if (view === 'month') return formatJa(date, 'yyyy年 M月')
  if (view === 'week') return formatJa(date, 'yyyy年 M月')
  return formatJa(date, 'yyyy年 M月d日（EEE）')
}

export function CalendarHeader({
  currentDate, view,
  onPrev, onNext, onToday, onChangeView, onAddEvent,
  onOpenGroupManager, onOpenFacilityManager,
}: CalendarHeaderProps) {
  return (
    <header className="bg-white border-b px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: nav + title */}
      <div className="flex items-center gap-1.5">
        <button onClick={onToday}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 whitespace-nowrap">
          今日
        </button>
        <button onClick={onPrev} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="前へ">
          <ChevronLeft size={20} />
        </button>
        <button onClick={onNext} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="次へ">
          <ChevronRight size={20} />
        </button>
        <h1 className="text-lg font-semibold text-gray-800 ml-1 whitespace-nowrap">
          {getTitle(currentDate, view)}
        </h1>
      </div>

      {/* Right: master buttons + view switcher + add */}
      <div className="flex items-center gap-1.5">
        {/* G長管理 */}
        <button
          onClick={onOpenGroupManager}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          title="G長マスタ管理"
        >
          <Users size={15} />
          <span className="hidden sm:inline">G長管理</span>
        </button>

        {/* 施設管理 */}
        <button
          onClick={onOpenFacilityManager}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
          title="施設マスタ管理"
        >
          <Building2 size={15} />
          <span className="hidden sm:inline">施設管理</span>
        </button>

        {/* View switcher */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map(v => (
            <button
              key={v}
              onClick={() => onChangeView(v)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium transition-colors',
                view === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Add event */}
        <button
          onClick={onAddEvent}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">予定を追加</span>
          <span className="sm:hidden">追加</span>
        </button>
      </div>
    </header>
  )
}
