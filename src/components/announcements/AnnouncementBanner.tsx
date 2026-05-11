'use client'

import { useState } from 'react'
import { Bell, ChevronDown, ChevronUp, AlertCircle, Info } from 'lucide-react'
import { cn, formatJa } from '@/lib/utils'
import type { Announcement } from '@/lib/types'

interface AnnouncementBannerProps {
  announcements: Announcement[]
  onOpenAdmin?: () => void
}

export function AnnouncementBanner({ announcements, onOpenAdmin }: AnnouncementBannerProps) {
  const [expanded, setExpanded] = useState(true)

  if (announcements.length === 0) return null

  const hasImportant = announcements.some(a => a.isImportant)

  return (
    <div className={cn(
      'border-b flex-shrink-0',
      hasImportant ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
    )}>
      {/* ヘッダー行 */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Bell size={13} className={hasImportant ? 'text-red-500' : 'text-blue-500'} />
          <span className={cn('text-xs font-semibold', hasImportant ? 'text-red-700' : 'text-blue-700')}>
            本部からのお知らせ
          </span>
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded-full font-medium leading-none',
            hasImportant ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
          )}>
            {announcements.length}件
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAdmin && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onOpenAdmin() }}
              className="text-xs text-gray-400 hover:text-gray-600 px-1"
            >
              管理
            </button>
          )}
          {expanded
            ? <ChevronUp size={14} className="text-gray-400" />
            : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {/* コンテンツ */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {announcements.map(a => (
            <AnnouncementItem key={a.id} announcement={a} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnnouncementItem({ announcement: a }: { announcement: Announcement }) {
  const [showFull, setShowFull] = useState(false)

  const dateStr = a.createdAt
    ? formatJa(new Date(a.createdAt), 'yyyy/MM/dd')
    : ''

  const lines = a.content.split('\n')
  const isLong = lines.length > 3 || a.content.length > 120
  const displayContent = !isLong || showFull
    ? a.content
    : lines.slice(0, 3).join('\n') + '…'

  return (
    <div className={cn(
      'rounded-lg px-3 py-2.5 text-xs',
      a.isImportant
        ? 'bg-red-100 border border-red-200'
        : 'bg-white border border-blue-100'
    )}>
      <div className="flex items-start gap-2">
        {a.isImportant
          ? <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          : <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
            <span className={cn(
              'font-semibold text-xs',
              a.isImportant ? 'text-red-800' : 'text-gray-800'
            )}>
              {a.isImportant && '【重要】'}{a.title}
            </span>
            <span className="text-gray-400 text-xs flex-shrink-0">{dateStr}</span>
          </div>
          <p className={cn(
            'whitespace-pre-wrap leading-relaxed',
            a.isImportant ? 'text-red-700' : 'text-gray-600'
          )}>
            {displayContent}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setShowFull(v => !v)}
              className={cn(
                'mt-1 font-medium',
                a.isImportant ? 'text-red-600' : 'text-blue-600'
              )}
            >
              {showFull ? '閉じる' : '続きを読む'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
