'use client'

import { useState, useEffect } from 'react'
import { X, Plus, Filter, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHIFT_CHANGE_TYPES } from '@/lib/types'
import { ShiftChangeFormModal } from './ShiftChangeFormModal'
import { HelpButton } from '@/components/help/HelpButton'
import { HelpModal } from '@/components/help/HelpModal'
import { HELP_CONTENT } from '@/constants/helpContent'
import type { ShiftChangeRecord, CreateShiftChangeInput, Facility, ShiftChangeFilters } from '@/lib/types'

interface Props {
  isOpen: boolean
  records: ShiftChangeRecord[]
  loading: boolean
  facilities: Facility[]
  onClose: () => void
  onAdd: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onUpdate: (id: string, input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onDelete: (id: string) => Promise<void>
  onReload: (filters?: Partial<ShiftChangeFilters>) => Promise<void>
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  欠勤: 'bg-red-100 text-red-700',
  遅刻: 'bg-orange-100 text-orange-700',
  早退: 'bg-yellow-100 text-yellow-700',
  時間変更: 'bg-purple-100 text-purple-700',
  交代出勤: 'bg-blue-100 text-blue-700',
  その他: 'bg-gray-100 text-gray-700',
  // 旧データ互換
  交代: 'bg-blue-100 text-blue-700',
  追加出勤: 'bg-green-100 text-green-700',
  休み変更: 'bg-teal-100 text-teal-700',
}

function formatDateFull(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${y}年${parseInt(m)}月${parseInt(d)}日`
}

export function ShiftChangeManager({
  isOpen, records, loading, facilities,
  onClose, onAdd, onUpdate, onDelete, onReload,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftChangeRecord | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const [fFacilityId, setFFacilityId] = useState('')
  const [fDate, setFDate] = useState('')
  const [fReason, setFReason] = useState('')
  const [fHandledBy, setFHandledBy] = useState('')
  const [fEmployee, setFEmployee] = useState('')
  const [fChangeType, setFChangeType] = useState('')
  const [fExternalOnly, setFExternalOnly] = useState(false)
  const [fSupportFacilityId, setFSupportFacilityId] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (isOpen) onReload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  if (!isOpen) return null

  const hasFilter = fFacilityId || fDate || fReason || fHandledBy || fEmployee || fChangeType || fExternalOnly || fSupportFacilityId

  const buildFilters = (): Partial<ShiftChangeFilters> => ({
    facilityId: fFacilityId || undefined,
    targetDate: fDate || undefined,
    reason: fReason || undefined,
    handledBy: fHandledBy || undefined,
    employeeName: fEmployee || undefined,
    changeType: fChangeType || undefined,
    isExternalSupport: fExternalOnly ? 'true' : undefined,
    supportFacilityId: fSupportFacilityId || undefined,
  })

  const handleSearch = () => onReload(buildFilters())
  const handleClear = () => {
    setFFacilityId(''); setFDate(''); setFReason('')
    setFHandledBy(''); setFEmployee(''); setFChangeType('')
    setFExternalOnly(false); setFSupportFacilityId('')
    onReload()
  }

  const openAdd = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (r: ShiftChangeRecord) => { setEditing(r); setFormOpen(true) }
  const handleSave = async (input: CreateShiftChangeInput): Promise<ShiftChangeRecord> => {
    if (editing) return await onUpdate(editing.id, input)
    else return await onAdd(input)
  }

  // facilities の id→name マップ
  const facilityMap = new Map(facilities.map(f => [f.id, f.name]))

  return (
    <>
      <div className="fixed inset-0 z-40 flex flex-col bg-white">

        {/* ヘッダー */}
        <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold">シフト変更記録</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterOpen(p => !p)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                filterOpen || hasFilter
                  ? 'bg-white text-blue-700 border-white'
                  : 'border-blue-500 text-blue-100 hover:bg-blue-600'
              )}>
              <Filter size={14} />
              <span className="hidden sm:inline">絞り込み</span>
              {hasFilter && <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />}
              {filterOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-blue-700 text-sm font-medium hover:bg-blue-50">
              <Plus size={15} />
              <span className="hidden sm:inline">新規登録</span>
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} variant="dark" />
            <button onClick={onClose} className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-blue-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 絞り込みパネル */}
        {filterOpen && (
          <div className="border-b bg-gray-50 px-4 py-3 space-y-3 flex-shrink-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">施設</label>
                <select value={fFacilityId} onChange={e => setFFacilityId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">すべて</option>
                  {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対象日</label>
                <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">理由</label>
                <input type="text" value={fReason} onChange={e => setFReason(e.target.value)}
                  placeholder="キーワード" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対応者</label>
                <input type="text" value={fHandledBy} onChange={e => setFHandledBy(e.target.value)}
                  placeholder="名前で検索" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対象者名</label>
                <input type="text" value={fEmployee} onChange={e => setFEmployee(e.target.value)}
                  placeholder="名前で検索" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">変更種別</label>
                <select value={fChangeType} onChange={e => setFChangeType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">すべて</option>
                  {SHIFT_CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">他施設応援</label>
                <div className="flex gap-3 items-center flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={fExternalOnly}
                      onChange={e => { setFExternalOnly(e.target.checked); if (!e.target.checked) setFSupportFacilityId('') }}
                      className="w-4 h-4 accent-blue-600" />
                    <span className="text-xs text-gray-700">他施設応援ありのみ</span>
                  </label>
                  {fExternalOnly && (
                    <select value={fSupportFacilityId} onChange={e => setFSupportFacilityId(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                      <option value="">調整元：すべて</option>
                      {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSearch}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                <Search size={14} />検索
              </button>
              {hasFilter && (
                <button onClick={handleClear}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">
                  クリア
                </button>
              )}
            </div>
          </div>
        )}

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <p className="text-sm">記録がありません</p>
              <button onClick={openAdd}
                className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                <Plus size={14} />新規登録
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {records.map(r => (
                <button key={r.id} onClick={() => openEdit(r)}
                  className="w-full text-left px-4 py-4 hover:bg-blue-50 transition-colors">

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-800">{formatDateFull(r.targetDate)}</span>
                    <span className="text-sm text-gray-600">{r.facilityName}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                    <span>理由：{r.reason}</span>
                    <span>対応者：{r.handledBy}</span>
                  </div>

                  <div className="space-y-1.5">
                    {r.details.map((d, i) => {
                      const supportName = d.supportFromFacilityId ? facilityMap.get(d.supportFromFacilityId) : null
                      return (
                        <div key={d.id} className="flex items-start gap-2 text-sm flex-wrap">
                          <span className="flex-shrink-0 text-gray-400 w-4">{i + 1}.</span>
                          <span className="text-gray-700 font-medium flex-shrink-0">{d.employeeName}</span>
                          <span className={cn(
                            'flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium',
                            CHANGE_TYPE_COLORS[d.changeType] ?? 'bg-gray-100 text-gray-700'
                          )}>
                            {d.changeType}
                          </span>
                          <span className="text-gray-600 text-xs leading-relaxed">{d.changeDetail}</span>
                          {d.isExternalSupport && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                              他施設応援{supportName ? `：${supportName}` : ''}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {r.memo && (
                    <p className="mt-1.5 text-xs text-gray-400 line-clamp-1">メモ：{r.memo}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2 flex-shrink-0 bg-gray-50">
          <p className="text-xs text-gray-500">{records.length}件</p>
        </div>
      </div>

      <ShiftChangeFormModal
        isOpen={formOpen}
        editing={editing}
        facilities={facilities}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        onDelete={onDelete}
      />

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT.shiftChange}
      />
    </>
  )
}
