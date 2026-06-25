'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Building2, Users, FileText, ChevronDown, ArrowLeftRight } from 'lucide-react'
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
  onOpenShiftManager: () => void
  onOpenLeaderManager: () => void
  onOpenRounderManager: () => void
  onOpenFieldEmployeeManager: () => void
  onOpenShiftChangeManager: () => void
}

const VIEW_LABELS: Record<CalendarView, string> = { month: '月', week: '週', day: '日' }

const NAV_LABELS: Record<CalendarView, { prev: string; next: string }> = {
  month: { prev: '前月', next: '次月' },
  week:  { prev: '前週', next: '次週' },
  day:   { prev: '昨日', next: '明日' },
}

function getTitle(date: Date, view: CalendarView): string {
  if (view === 'month') return formatJa(date, 'yyyy年 M月')
  if (view === 'week') return formatJa(date, 'yyyy年 M月')
  return formatJa(date, 'yyyy年 M月d日（EEE）')
}

export function CalendarHeader({
  currentDate, view,
  onPrev, onNext, onToday, onChangeView, onAddEvent,
  onOpenGroupManager, onOpenFacilityManager, onOpenShiftManager,
  onOpenLeaderManager, onOpenRounderManager, onOpenFieldEmployeeManager,
  onOpenShiftChangeManager,
}: CalendarHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  const menuItems: Array<{ label: string; icon: React.ReactNode; onClick: () => void } | null> = [
    { label: 'G長管理',    icon: <Users size={14} />,     onClick: () => { onOpenGroupManager(); closeMenu() } },
    { label: 'リーダー管理',   icon: <Users size={14} />,     onClick: () => { onOpenLeaderManager(); closeMenu() } },
    { label: 'ラウンダー管理',  icon: <Users size={14} />,     onClick: () => { onOpenRounderManager(); closeMenu() } },
    { label: '現場社員管理',   icon: <Users size={14} />,     onClick: () => { onOpenFieldEmployeeManager(); closeMenu() } },
    null,
    { label: '施設管理',    icon: <Building2 size={14} />, onClick: () => { onOpenFacilityManager(); closeMenu() } },
  ]

  return (
    <header className="bg-white border-b px-2 py-1.5 sm:px-3 sm:py-2.5 flex items-center gap-1 sm:gap-2 sm:justify-between">
      {/* Left: nav + title (flex-1 on mobile to center title between arrows) */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <button onClick={onToday}
          className="px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 whitespace-nowrap flex-shrink-0">
          今日
        </button>
        <button
          onClick={onPrev}
          className="flex items-center gap-0.5 p-1.5 sm:px-2 sm:py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0"
          aria-label={NAV_LABELS[view].prev}
        >
          <ChevronLeft size={16} className="sm:hidden" />
          <ChevronLeft size={18} className="hidden sm:block" />
          <span className="hidden sm:inline text-sm font-medium">{NAV_LABELS[view].prev}</span>
        </button>
        <h1 className="text-sm sm:text-lg font-semibold text-gray-800 flex-1 truncate text-center sm:text-left sm:flex-none sm:whitespace-nowrap">
          {getTitle(currentDate, view)}
        </h1>
        <button
          onClick={onNext}
          className="flex items-center gap-0.5 p-1.5 sm:px-2 sm:py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0"
          aria-label={NAV_LABELS[view].next}
        >
          <span className="hidden sm:inline text-sm font-medium">{NAV_LABELS[view].next}</span>
          <ChevronRight size={16} className="sm:hidden" />
          <ChevronRight size={18} className="hidden sm:block" />
        </button>
      </div>

      {/* Right: management buttons (hidden on mobile) + view switcher + add */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* シフト変更記録 - PC only */}
        <button
          onClick={onOpenShiftChangeManager}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-200 text-orange-600 text-sm hover:bg-orange-50 transition-colors"
          title="シフト変更記録"
        >
          <ArrowLeftRight size={15} />
          <span>シフト変更</span>
        </button>

        {/* PDF資料 - PC only */}
        <button
          onClick={onOpenShiftManager}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
          title="PDF資料"
        >
          <FileText size={15} />
          <span>PDF資料</span>
        </button>

        {/* 管理ドロップダウン - PC only */}
        <div className="hidden sm:block relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
            title="マスタ管理"
          >
            <Users size={15} />
            <span>管理</span>
            <ChevronDown
              size={14}
              className={cn('transition-transform duration-150', menuOpen && 'rotate-180')}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-1 overflow-hidden">
              {menuItems.map((item, i) =>
                item === null ? (
                  <div key={`divider-${i}`} className="my-1 border-t border-gray-100" />
                ) : (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className="text-gray-400 flex-shrink-0">{item.icon}</span>
                    {item.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* View switcher */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map(v => (
            <button
              key={v}
              onClick={() => onChangeView(v)}
              className={cn(
                'px-2.5 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors',
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
          className="flex items-center gap-1 px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">予定を追加</span>
        </button>
      </div>
    </header>
  )
}
