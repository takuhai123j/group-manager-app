'use client'

import { cn } from '@/lib/utils'
import type { GroupManager } from '@/lib/types'

export const ALL_LEADER_ID = 'all'

interface GroupLeaderTabsProps {
  selected: string  // ALL_LEADER_ID or a GroupManager.id
  activeManagers: GroupManager[]
  onChange: (id: string) => void
}

export function GroupLeaderTabs({ selected, activeManagers, onChange }: GroupLeaderTabsProps) {
  return (
    <div className="bg-blue-900 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
      <div className="flex gap-1 px-3 py-2 min-w-max">
        {/* 全員 tab */}
        <button
          onClick={() => onChange(ALL_LEADER_ID)}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors whitespace-nowrap',
            selected === ALL_LEADER_ID
              ? 'bg-white text-blue-900'
              : 'text-blue-200 hover:text-white hover:bg-blue-800'
          )}
        >
          全員
        </button>

        {activeManagers.map(m => {
          const isActive = selected === m.id
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold transition-colors whitespace-nowrap',
                isActive ? 'bg-white' : 'text-blue-200 hover:text-white hover:bg-blue-800'
              )}
              style={isActive ? { color: m.color } : undefined}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: m.color, opacity: isActive ? 1 : 0.6 }}
              />
              {m.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
