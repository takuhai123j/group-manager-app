'use client'

import { cn } from '@/lib/utils'
import type { GroupManager, StaffMember } from '@/lib/types'

export type RoleTab = 'all' | 'group_manager' | 'leader' | 'rounder' | 'field_employee'
export const ALL_PERSON_ID = 'all'

const ROLE_LABELS: Record<RoleTab, string> = {
  all: '全員',
  group_manager: 'G長',
  leader: 'リーダー',
  rounder: 'ラウンダー',
  field_employee: '現場社員',
}

const ALL_PERSON_LABELS: Record<Exclude<RoleTab, 'all'>, string> = {
  group_manager: '全G長',
  leader: '全リーダー',
  rounder: '全ラウンダー',
  field_employee: '全現場社員',
}

interface StaffTabsProps {
  selectedRole: RoleTab
  selectedPersonId: string
  activeManagers: GroupManager[]
  activeLeaders: StaffMember[]
  activeRounders: StaffMember[]
  activeFieldEmployees: StaffMember[]
  onRoleChange: (role: RoleTab) => void
  onPersonChange: (id: string) => void
}

const ROLES: RoleTab[] = ['all', 'group_manager', 'leader', 'rounder', 'field_employee']

export function StaffTabs({
  selectedRole,
  selectedPersonId,
  activeManagers,
  activeLeaders,
  activeRounders,
  activeFieldEmployees,
  onRoleChange,
  onPersonChange,
}: StaffTabsProps) {
  type PersonItem = { id: string; name: string; color: string }

  let persons: PersonItem[] = []
  if (selectedRole === 'group_manager') {
    persons = activeManagers.map(m => ({ id: m.id, name: m.name, color: m.color }))
  } else if (selectedRole === 'leader') {
    persons = activeLeaders.map(m => ({ id: m.id, name: m.name, color: m.color }))
  } else if (selectedRole === 'rounder') {
    persons = activeRounders.map(m => ({ id: m.id, name: m.name, color: m.color }))
  } else if (selectedRole === 'field_employee') {
    persons = activeFieldEmployees.map(m => ({ id: m.id, name: m.name, color: m.color }))
  }

  const showPersonRow = selectedRole !== 'all'

  return (
    <div className="flex-shrink-0">
      {/* Row 1: 職種タブ */}
      <div className="bg-blue-900 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex gap-1 px-3 py-2 min-w-max">
          {ROLES.map(role => (
            <button
              key={role}
              onClick={() => onRoleChange(role)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-semibold transition-colors whitespace-nowrap',
                selectedRole === role
                  ? 'bg-white text-blue-900'
                  : 'text-blue-200 hover:text-white hover:bg-blue-800'
              )}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: 個人タブ（職種タブが「全員」以外のとき表示） */}
      {showPersonRow && (
        <div className="bg-blue-800 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-1 px-3 py-1.5 min-w-max">
            {/* 全〇〇 ボタン */}
            <button
              onClick={() => onPersonChange(ALL_PERSON_ID)}
              className={cn(
                'px-3.5 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap',
                selectedPersonId === ALL_PERSON_ID
                  ? 'bg-white text-blue-900'
                  : 'text-blue-200 hover:text-white hover:bg-blue-700'
              )}
            >
              {ALL_PERSON_LABELS[selectedRole as Exclude<RoleTab, 'all'>]}
            </button>

            {persons.map(p => {
              const isSelected = selectedPersonId === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => onPersonChange(p.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold transition-colors whitespace-nowrap',
                    isSelected ? 'bg-white' : 'text-blue-200 hover:text-white hover:bg-blue-700'
                  )}
                  style={isSelected ? { color: p.color } : undefined}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: p.color, opacity: isSelected ? 1 : 0.65 }}
                  />
                  {p.name}
                </button>
              )
            })}

            {persons.length === 0 && (
              <span className="text-xs text-blue-400/70 px-2 py-1 italic">登録なし</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
