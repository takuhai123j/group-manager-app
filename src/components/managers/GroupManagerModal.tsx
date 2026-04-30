'use client'

import { useState, useCallback, useEffect } from 'react'
import { X, ChevronLeft, ChevronUp, ChevronDown, Pencil, Users, Check } from 'lucide-react'
import { cn, PRESET_COLORS } from '@/lib/utils'
import type { Facility, GroupManager } from '@/lib/types'

type ManagerInput = { name: string; color: string; memo: string }
type Panel = 'list' | 'form'

interface GroupManagerModalProps {
  isOpen: boolean
  managers: GroupManager[]
  allFacilities: Facility[]
  managerFacilities: Record<string, string[]>
  onClose: () => void
  onAdd: (input: ManagerInput) => Promise<string | false>
  onUpdate: (id: string, input: ManagerInput) => Promise<void>
  onToggleActive: (id: string) => Promise<void>
  onMoveUp: (id: string) => Promise<void>
  onMoveDown: (id: string) => Promise<void>
  onSetFacilities: (managerId: string, facilityIds: string[]) => Promise<void>
}

const EMPTY_FORM: ManagerInput = { name: '', color: PRESET_COLORS[0], memo: '' }

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={cn(
              'w-7 h-7 rounded-full border-2 transition-all',
              value === c ? 'border-gray-800 scale-110 shadow-md' : 'border-transparent hover:scale-105'
            )}
            style={{ backgroundColor: c }}
            aria-label={c}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-gray-300"
          title="カスタムカラー"
        />
        <span className="text-xs text-gray-500">カスタムカラー</span>
        <code className="text-xs font-mono text-gray-400 ml-1">{value}</code>
      </div>
    </div>
  )
}

export function GroupManagerModal({
  isOpen,
  managers,
  allFacilities,
  managerFacilities,
  onClose,
  onAdd,
  onUpdate,
  onToggleActive,
  onMoveUp,
  onMoveDown,
  onSetFacilities,
}: GroupManagerModalProps) {
  // ── すべての Hook を if (!isOpen) return より前に宣言 ─────────────
  const [panel, setPanel] = useState<Panel>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ManagerInput>(EMPTY_FORM)
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setPanel('list')
      setError('')
      setSelectedFacilityIds([])
    }
  }, [isOpen])

  const backToList = useCallback(() => {
    setPanel('list')
    setError('')
  }, [])

  const handleToggleActive = useCallback(async (id: string) => {
    await onToggleActive(id)
    backToList()
  }, [onToggleActive, backToList])

  // ── 早期リターン（全 Hook 宣言後に置く） ────────────────────────
  if (!isOpen) return null

  // ── 以降は Hook を呼ばない通常の処理 ────────────────────────────
  const activeManagers = managers.filter(m => m.active)
  const inactiveManagers = managers.filter(m => !m.active)
  const activeFacilities = allFacilities.filter(f => f.active)

  const openAdd = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setSelectedFacilityIds([])
    setError('')
    setPanel('form')
  }

  const openEdit = (m: GroupManager) => {
    setEditingId(m.id)
    setForm({ name: m.name, color: m.color, memo: m.memo })
    setSelectedFacilityIds(managerFacilities[m.id] ?? [])
    setError('')
    setPanel('form')
  }

  const handleSave = async () => {
    if (!form.name.trim()) { setError('名前を入力してください'); return }
    const isDuplicate = managers.some(m =>
      m.name === form.name.trim() && m.id !== editingId
    )
    if (isDuplicate) { setError('同じ名前のG長が既に存在します'); return }

    setSaving(true)
    try {
      if (editingId) {
        await onUpdate(editingId, form)
        await onSetFacilities(editingId, selectedFacilityIds)
      } else {
        const newId = await onAdd(form)
        if (!newId) { setError('追加に失敗しました'); return }
        await onSetFacilities(newId, selectedFacilityIds)
      }
      backToList()
    } finally {
      setSaving(false)
    }
  }

  const set = (key: keyof ManagerInput, val: string) => {
    setForm(prev => ({ ...prev, [key]: val }))
    setError('')
  }

  const toggleFacility = (facilityId: string, checked: boolean) => {
    setSelectedFacilityIds(prev =>
      checked ? [...prev, facilityId] : prev.filter(id => id !== facilityId)
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b flex-shrink-0">
          {panel === 'form' && (
            <button onClick={backToList} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 mr-1">
              <ChevronLeft size={20} />
            </button>
          )}
          <Users size={18} className="text-blue-600 flex-shrink-0" />
          <h2 className="text-base font-semibold text-gray-800 flex-1">
            {panel === 'list'
              ? 'G長マスタ管理'
              : editingId ? 'G長を編集' : 'G長を追加'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* ── LIST PANEL ─────────────────────────────────────────── */}
        {panel === 'list' && (
          <div className="flex-1 overflow-y-auto">
            {activeManagers.length > 0 && (
              <div className="p-3 space-y-1.5">
                {activeManagers.map((m, idx) => {
                  const defaultCount = (managerFacilities[m.id] ?? []).length
                  return (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-xl">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{m.name}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {defaultCount > 0
                            ? `基本担当 ${defaultCount}施設`
                            : m.memo || '基本担当施設 未設定'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => onMoveUp(m.id)}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 disabled:opacity-25"
                          aria-label="上へ"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => onMoveDown(m.id)}
                          disabled={idx === activeManagers.length - 1}
                          className="p-1 rounded hover:bg-gray-200 text-gray-400 disabled:opacity-25"
                          aria-label="下へ"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                      <button
                        onClick={() => openEdit(m)}
                        className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 flex-shrink-0"
                        aria-label="編集"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => onToggleActive(m.id)}
                        className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100 flex-shrink-0 whitespace-nowrap"
                      >
                        無効化
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {inactiveManagers.length > 0 && (
              <div className="px-3 pb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
                  無効（退職・異動）
                </p>
                <div className="space-y-1.5">
                  {inactiveManagers.map(m => (
                    <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 bg-gray-50/60 rounded-xl opacity-60">
                      <span className="w-3 h-3 rounded-full flex-shrink-0 bg-gray-300" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-500 truncate">{m.name}</p>
                        {m.memo && <p className="text-xs text-gray-400 truncate">{m.memo}</p>}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 flex-shrink-0">
                        無効
                      </span>
                      <button
                        onClick={() => openEdit(m)}
                        className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 flex-shrink-0"
                        aria-label="編集"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => onToggleActive(m.id)}
                        className="px-2.5 py-1 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 flex-shrink-0 whitespace-nowrap"
                      >
                        有効化
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {managers.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">G長が登録されていません</p>
            )}
          </div>
        )}

        {/* ── FORM PANEL ─────────────────────────────────────────── */}
        {panel === 'form' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                名前 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="例：鈴木G長"
                className={cn(
                  'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  error && !form.name.trim() ? 'border-red-400' : 'border-gray-300'
                )}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">カラー</label>
              <ColorPicker value={form.color} onChange={c => set('color', c)} />
              <div
                className="mt-3 px-3 py-2 rounded-lg border text-sm font-medium"
                style={{
                  backgroundColor: `${form.color}20`,
                  borderColor: `${form.color}70`,
                  color: '#1e293b',
                }}
              >
                <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ backgroundColor: form.color }} />
                {form.name || '（プレビュー）'}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
              <input
                type="text"
                value={form.memo}
                onChange={e => set('memo', e.target.value)}
                placeholder="担当エリア・備考など"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* 基本担当施設 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                基本担当施設
                {selectedFacilityIds.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-blue-600">
                    {selectedFacilityIds.length}施設選択中
                  </span>
                )}
              </label>
              {activeFacilities.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">施設が登録されていません</p>
              ) : (
                <div className="border border-gray-200 rounded-lg p-2 max-h-44 overflow-y-auto space-y-1">
                  {activeFacilities.map(f => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFacilityIds.includes(f.id)}
                        onChange={e => toggleFacility(f.id, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{f.name}</span>
                      {f.area && (
                        <span className="text-xs text-gray-400 ml-auto">{f.area}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-gray-400">
                選択した施設が予定登録時に「基本担当施設」として優先表示されます
              </p>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {editingId && (
              <div className="pt-2 border-t">
                {managers.find(m => m.id === editingId)?.active ? (
                  <button
                    onClick={() => handleToggleActive(editingId)}
                    className="w-full px-4 py-2.5 rounded-lg border border-amber-300 text-amber-700 text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    このG長を無効化（退職・異動）
                  </button>
                ) : (
                  <button
                    onClick={() => handleToggleActive(editingId)}
                    className="w-full px-4 py-2.5 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition-colors"
                  >
                    このG長を有効化に戻す
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {panel === 'list' && (
          <div className="border-t px-4 py-3 flex-shrink-0">
            <button
              onClick={openAdd}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <span className="text-lg leading-none">+</span>
              G長を追加
            </button>
            <p className="text-xs text-gray-400 text-center mt-2">
              ※ 無効化してもデータは保持されます（物理削除しません）
            </p>
          </div>
        )}

        {panel === 'form' && (
          <div className="border-t px-4 py-3 flex gap-2 flex-shrink-0">
            <button
              onClick={backToList}
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Check size={16} />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
