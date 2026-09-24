'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Building2, Users, FileText, ChevronDown, ArrowLeftRight, CalendarRange, MoreHorizontal, SlidersHorizontal, HelpCircle } from 'lucide-react'
import { cn, formatJa } from '@/lib/utils'
import { HelpButton } from '@/components/help/HelpButton'
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
  onOpenMeetingPlan: () => void
  onOpenHelp: () => void
  // スマホ（sm未満）の「⋯ → 絞り込み」用。PCでは絞り込みバーを常時表示している
  onOpenFilter: () => void
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

// スマホ幅（375px）でも年月が消えないよう短い表記にする
function getMobileTitle(date: Date, view: CalendarView): string {
  if (view === 'day') return formatJa(date, 'M/d(EEE)')
  return formatJa(date, 'yyyy/M')
}

export function CalendarHeader({
  currentDate, view,
  onPrev, onNext, onToday, onChangeView, onAddEvent,
  onOpenGroupManager, onOpenFacilityManager, onOpenShiftManager,
  onOpenLeaderManager, onOpenRounderManager, onOpenFieldEmployeeManager,
  onOpenShiftChangeManager,
  onOpenMeetingPlan,
  onOpenHelp,
  onOpenFilter,
}: CalendarHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // スマホ用「⋯」メニュー
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  // メニューが画面下にはみ出さないよう、開いた時点のボタン下端〜画面下端の高さを上限にする
  const [mobileMenuMaxH, setMobileMenuMaxH] = useState<number | undefined>(undefined)
  const toggleMobileMenu = () => {
    if (!mobileMenuOpen && mobileMenuRef.current) {
      const bottom = mobileMenuRef.current.getBoundingClientRect().bottom
      setMobileMenuMaxH(Math.max(160, window.innerHeight - bottom - 12))
    }
    setMobileMenuOpen(prev => !prev)
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    if (menuOpen || mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [menuOpen, mobileMenuOpen])

  const closeMenu = () => { setMenuOpen(false); setMobileMenuOpen(false) }

  const menuItems: Array<{ label: string; icon: React.ReactNode; onClick: () => void } | null> = [
    { label: 'G長・主任管理', icon: <Users size={14} />,     onClick: () => { onOpenGroupManager(); closeMenu() } },
    { label: 'リーダー管理',   icon: <Users size={14} />,     onClick: () => { onOpenLeaderManager(); closeMenu() } },
    { label: 'ラウンダー管理',  icon: <Users size={14} />,     onClick: () => { onOpenRounderManager(); closeMenu() } },
    { label: '現場社員管理',   icon: <Users size={14} />,     onClick: () => { onOpenFieldEmployeeManager(); closeMenu() } },
    null,
    { label: '施設管理',    icon: <Building2 size={14} />, onClick: () => { onOpenFacilityManager(); closeMenu() } },
  ]

  // スマホ（sm未満）の「⋯」メニュー。PCではヘッダーに並んでいる操作をここへまとめる。
  // MT年間計画は利用頻度が高いため先頭に置く
  const mobileMenuItems: Array<{ label: string; icon: React.ReactNode; onClick: () => void } | null> = [
    { label: 'MT年間計画', icon: <CalendarRange size={14} />,     onClick: () => { onOpenMeetingPlan(); closeMenu() } },
    { label: 'シフト変更', icon: <ArrowLeftRight size={14} />,    onClick: () => { onOpenShiftChangeManager(); closeMenu() } },
    { label: 'PDF資料',    icon: <FileText size={14} />,          onClick: () => { onOpenShiftManager(); closeMenu() } },
    { label: '絞り込み',   icon: <SlidersHorizontal size={14} />, onClick: () => { onOpenFilter(); closeMenu() } },
    { label: 'ヘルプ',     icon: <HelpCircle size={14} />,        onClick: () => { onOpenHelp(); closeMenu() } },
  ]

  return (
    <header className="bg-white border-b px-2 py-1.5 sm:px-3 sm:py-2.5 flex items-center gap-1 sm:gap-2 sm:justify-between">
      {/* Left: nav + title (flex-1 on mobile to center title between arrows) */}
      <div className="flex items-center gap-0.5 sm:gap-1 flex-1 min-w-0">
        <button onClick={onToday}
          className="px-1.5 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 whitespace-nowrap flex-shrink-0">
          今日
        </button>
        <button
          onClick={onPrev}
          className="flex items-center justify-center gap-0.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-2 sm:py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0"
          aria-label={NAV_LABELS[view].prev}
        >
          <ChevronLeft size={16} className="sm:hidden" />
          <ChevronLeft size={18} className="hidden sm:block" />
          <span className="hidden sm:inline text-sm font-medium">{NAV_LABELS[view].prev}</span>
        </button>
        <h1 className="text-sm sm:text-lg font-semibold text-gray-800 flex-1 min-w-[3.25rem] truncate text-center sm:text-left sm:flex-none sm:min-w-0 sm:whitespace-nowrap">
          <span className="sm:hidden">{getMobileTitle(currentDate, view)}</span>
          <span className="hidden sm:inline">{getTitle(currentDate, view)}</span>
        </h1>
        <button
          onClick={onNext}
          className="flex items-center justify-center gap-0.5 w-8 h-8 sm:w-auto sm:h-auto sm:px-2 sm:py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 flex-shrink-0"
          aria-label={NAV_LABELS[view].next}
        >
          <span className="hidden sm:inline text-sm font-medium">{NAV_LABELS[view].next}</span>
          <ChevronRight size={16} className="sm:hidden" />
          <ChevronRight size={18} className="hidden sm:block" />
        </button>
      </div>

      {/* Right: PCは各ボタンを並べる。スマホは表示切替・予定追加・「⋯」メニューのみ */}
      <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
        {/* シフト変更記録（スマホは「⋯」メニュー内） */}
        <button
          onClick={onOpenShiftChangeManager}
          className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 sm:px-3 rounded-lg border border-orange-200 text-orange-600 text-sm hover:bg-orange-50 transition-colors"
          title="シフト変更記録"
        >
          <ArrowLeftRight size={15} />
          <span className="hidden sm:inline">シフト変更</span>
        </button>

        {/* PDF資料（スマホは「⋯」メニュー内） */}
        <button
          onClick={onOpenShiftManager}
          className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 sm:px-3 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
          title="PDF資料"
        >
          <FileText size={15} />
          <span className="hidden sm:inline">PDF資料</span>
        </button>

        {/* MT年間計画（スマホは「⋯」メニューの先頭） */}
        <button
          onClick={onOpenMeetingPlan}
          className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 sm:px-3 rounded-lg border border-indigo-200 text-indigo-600 text-sm hover:bg-indigo-50 transition-colors"
          title="MT年間計画"
          aria-label="MT年間計画"
        >
          <CalendarRange size={15} />
          <span className="hidden sm:inline">MT年間計画</span>
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
                'px-2 py-1 sm:px-4 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors',
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
          className="flex items-center gap-1 px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          aria-label="予定を追加"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">予定を追加</span>
        </button>

        {/* ヘルプ（スマホは「⋯」メニュー内） */}
        <div className="hidden sm:block">
          <HelpButton onClick={onOpenHelp} />
        </div>

        {/* スマホ用「⋯」メニュー：MT年間計画 / シフト変更 / PDF資料 / 絞り込み / ヘルプ / 管理 */}
        <div className="sm:hidden relative" ref={mobileMenuRef}>
          <button
            onClick={toggleMobileMenu}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-lg border border-gray-300 text-gray-600',
              mobileMenuOpen && 'bg-gray-100'
            )}
            aria-label="その他のメニュー"
            aria-expanded={mobileMenuOpen}
          >
            <MoreHorizontal size={16} />
          </button>

          {mobileMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-52 max-h-[70dvh] overflow-y-auto overscroll-contain bg-white rounded-xl shadow-lg border border-gray-200 z-50 py-1"
              style={mobileMenuMaxH ? { maxHeight: mobileMenuMaxH } : undefined}
            >
              {mobileMenuItems.map((item, i) =>
                item === null ? (
                  <div key={`m-divider-${i}`} className="my-1 border-t border-gray-100" />
                ) : (
                  <button
                    key={item.label}
                    onClick={item.onClick}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 text-left"
                  >
                    <span className="text-gray-400 flex-shrink-0">{item.icon}</span>
                    {item.label}
                  </button>
                )
              )}
              <div className="my-1 border-t border-gray-100" />
              <p className="px-3.5 pt-1 pb-0.5 text-xs font-semibold text-gray-400">管理</p>
              {menuItems.map((item, i) =>
                item === null ? (
                  <div key={`mm-divider-${i}`} className="my-1 border-t border-gray-100" />
                ) : (
                  <button
                    key={`m-${item.label}`}
                    onClick={item.onClick}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 text-left"
                  >
                    <span className="text-gray-400 flex-shrink-0">{item.icon}</span>
                    {item.label}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
