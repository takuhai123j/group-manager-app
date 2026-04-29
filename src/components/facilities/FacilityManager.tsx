'use client'

import { useState } from 'react'
import { X, Plus, Building2, MinusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Facility } from '@/lib/types'

interface FacilityManagerProps {
  isOpen: boolean
  facilities: Facility[]                          // active のみ
  onClose: () => void
  onAdd: (name: string) => Promise<boolean>
  onDeactivate: (id: string) => Promise<void>    // 物理削除ではなく無効化
}

export function FacilityManager({
  isOpen,
  facilities,
  onClose,
  onAdd,
  onDeactivate,
}: FacilityManagerProps) {
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)

  if (!isOpen) return null

  const handleAdd = async () => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setError('施設名を入力してください')
      return
    }
    setAdding(true)
    const ok = await onAdd(trimmed)
    setAdding(false)
    if (!ok) {
      setError('同じ名前の施設が既に登録されています')
      return
    }
    setNewName('')
    setError('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAdd()
  }

  const handleDeactivate = async (facility: Facility) => {
    if (!confirm(`「${facility.name}」を無効化しますか？\n既存の予定への表示には影響しません。`)) return
    setDeactivatingId(facility.id)
    await onDeactivate(facility.id)
    setDeactivatingId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-blue-600" />
            <h2 className="text-base font-semibold text-gray-800">施設マスタ管理</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Facility list */}
        <div className="flex-1 overflow-y-auto p-4">
          {facilities.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">施設が登録されていません</p>
          ) : (
            <ul className="space-y-1">
              {facilities.map((facility, i) => (
                <li
                  key={facility.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {facility.name}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeactivate(facility)}
                    disabled={deactivatingId === facility.id}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors flex-shrink-0 text-xs disabled:opacity-50"
                    aria-label={`${facility.name}を無効化`}
                  >
                    <MinusCircle size={14} />
                    {deactivatingId === facility.id ? '処理中' : '無効化'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add new facility */}
        <div className="border-t px-4 py-3 flex-shrink-0">
          <p className="text-xs font-medium text-gray-600 mb-2">施設を追加</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={newName}
                onChange={e => { setNewName(e.target.value); setError('') }}
                onKeyDown={handleKeyDown}
                placeholder="例：東大阪"
                className={cn(
                  'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  error ? 'border-red-400' : 'border-gray-300'
                )}
              />
              {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
            </div>
            <button
              onClick={handleAdd}
              disabled={adding}
              className="flex items-center gap-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors flex-shrink-0 disabled:opacity-50"
            >
              <Plus size={16} />
              {adding ? '追加中' : '追加'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            ※ 無効化しても既存予定の履歴は保持されます
          </p>
        </div>
      </div>
    </div>
  )
}
