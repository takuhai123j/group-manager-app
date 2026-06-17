'use client'

import { useState, useEffect } from 'react'
import { X, Save, Trash2, Plus, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHIFT_CHANGE_TYPES } from '@/lib/types'
import type { ShiftChangeRecord, CreateShiftChangeInput, Facility, ShiftChangeType } from '@/lib/types'

interface Props {
  isOpen: boolean
  editing: ShiftChangeRecord | null
  facilities: Facility[]
  onClose: () => void
  onSave: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onDelete?: (id: string) => Promise<void>
}

const MAX_DETAILS = 3

type DetailDraft = {
  employeeName: string
  changeType: ShiftChangeType
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityId: string
}

const EMPTY_DETAIL: DetailDraft = {
  employeeName: '',
  changeType: '欠勤',
  changeDetail: '',
  isExternalSupport: false,
  supportFromFacilityId: '',
}

const EMPTY_FORM = { facilityId: '', targetDate: '', reason: '', handledBy: '', memo: '' }

export function ShiftChangeFormModal({ isOpen, editing, facilities, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [details, setDetails] = useState<DetailDraft[]>([{ ...EMPTY_DETAIL }])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailWarning, setEmailWarning] = useState<string | null>(null)

  const activeFacilities = facilities.filter(f => f.active)

  useEffect(() => {
    if (!isOpen) return
    if (editing) {
      setForm({
        facilityId: editing.facilityId,
        targetDate: editing.targetDate,
        reason: editing.reason,
        handledBy: editing.handledBy,
        memo: editing.memo,
      })
      setDetails(
        editing.details.length > 0
          ? editing.details.map(d => ({
              employeeName: d.employeeName,
              changeType: (SHIFT_CHANGE_TYPES as readonly string[]).includes(d.changeType)
                ? d.changeType as ShiftChangeType
                : 'その他',
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityId: d.supportFromFacilityId ?? '',
            }))
          : [{ ...EMPTY_DETAIL }]
      )
    } else {
      const today = new Date().toISOString().slice(0, 10)
      setForm({ ...EMPTY_FORM, targetDate: today })
      setDetails([{ ...EMPTY_DETAIL }])
    }
    setError(null)
  }, [isOpen, editing])

  if (!isOpen) return null

  const setField = <K extends keyof typeof EMPTY_FORM>(key: K, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const updateDetail = (i: number, patch: Partial<DetailDraft>) =>
    setDetails(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  const addDetail = () => {
    if (details.length < MAX_DETAILS) setDetails(prev => [...prev, { ...EMPTY_DETAIL }])
  }

  const removeDetail = (i: number) => {
    if (details.length > 1) setDetails(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSave = async () => {
    if (!form.facilityId)       { setError('施設を選択してください'); return }
    if (!form.targetDate)       { setError('対象日を入力してください'); return }
    if (!form.handledBy.trim()) { setError('対応者を入力してください'); return }
    if (!form.reason.trim())    { setError('理由を入力してください'); return }
    for (let i = 0; i < details.length; i++) {
      if (!details[i].employeeName.trim()) { setError(`対象者${i + 1}の名前を入力してください`); return }
      if (!details[i].changeDetail.trim()) { setError(`対象者${i + 1}の変更内容を入力してください`); return }
      if (details[i].isExternalSupport && !details[i].supportFromFacilityId) {
        setError(`対象者${i + 1}の調整元施設を選択してください`); return
      }
    }
    setSaving(true); setError(null); setEmailWarning(null)
    try {
      const saved = await onSave({
        facilityId: form.facilityId,
        targetDate: form.targetDate,
        reason: form.reason,
        handledBy: form.handledBy,
        memo: form.memo,
        details: details.map(d => ({
          employeeName: d.employeeName,
          changeType: d.changeType,
          changeDetail: d.changeDetail,
          isExternalSupport: d.isExternalSupport,
          supportFromFacilityId: d.isExternalSupport ? d.supportFromFacilityId || null : null,
        })),
      })

      // 新規登録時のみメール通知
      if (!editing) {
        try {
          const payload = {
            facilityName: saved.facilityName,
            targetDate: saved.targetDate,
            reason: saved.reason,
            handledBy: saved.handledBy,
            memo: saved.memo,
            details: saved.details.map(d => ({
              employeeName: d.employeeName,
              changeType: d.changeType,
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityName: d.supportFromFacilityId
                ? facilities.find(f => f.id === d.supportFromFacilityId)?.name
                : undefined,
            })),
          }
          const res = await fetch('/api/shift-change-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            setEmailWarning('記録は保存しましたが、メール通知に失敗しました')
            return
          }
        } catch {
          setEmailWarning('記録は保存しましたが、メール通知に失敗しました')
          return
        }
      }

      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editing || !onDelete) return
    if (!confirm('この記録を削除しますか？')) return
    setDeleting(true)
    try { await onDelete(editing.id); onClose() }
    catch { setError('削除に失敗しました') }
    finally { setDeleting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {editing ? 'シフト変更記録を編集' : 'シフト変更を記録'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* 施設 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">施設 <span className="text-red-500">*</span></label>
            <select value={form.facilityId} onChange={e => setField('facilityId', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">選択してください</option>
              {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>

          {/* 対象日 + 対応者 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">対象日 <span className="text-red-500">*</span></label>
              <input type="date" value={form.targetDate} onChange={e => setField('targetDate', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">対応者 <span className="text-red-500">*</span></label>
              <input type="text" value={form.handledBy} onChange={e => setField('handledBy', e.target.value)}
                placeholder="例：福田" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* 理由 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">理由 <span className="text-red-500">*</span></label>
            <input type="text" value={form.reason} onChange={e => setField('reason', e.target.value)}
              placeholder="例：体調不良、急なシフト変更"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">メモ <span className="text-gray-400 font-normal">（任意）</span></label>
            <textarea value={form.memo} onChange={e => setField('memo', e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {/* 対象者明細 */}
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-600 mb-3">対象者明細（最大{MAX_DETAILS}名）</p>

            {details.map((d, i) => (
              <div key={i} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-gray-500">{i + 1}人目</span>
                  {details.length > 1 && (
                    <button type="button" onClick={() => removeDetail(i)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-500 hover:bg-red-50 border border-red-200">
                      <Minus size={11} />削除
                    </button>
                  )}
                </div>

                {/* 対象者名 */}
                <div className="mb-2.5">
                  <label className="block text-xs font-medium text-gray-700 mb-1">対象者 <span className="text-red-500">*</span></label>
                  <input type="text" value={d.employeeName}
                    onChange={e => updateDetail(i, { employeeName: e.target.value })}
                    placeholder="例：山田 太郎"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* 変更種別 */}
                <div className="mb-2.5">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">変更種別 <span className="text-red-500">*</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {SHIFT_CHANGE_TYPES.map(t => (
                      <button key={t} type="button" onClick={() => updateDetail(i, { changeType: t })}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                          d.changeType === t
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                        )}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 変更内容 */}
                <div className="mb-2.5">
                  <label className="block text-xs font-medium text-gray-700 mb-1">変更内容 <span className="text-red-500">*</span></label>
                  <textarea value={d.changeDetail}
                    onChange={e => updateDetail(i, { changeDetail: e.target.value })}
                    rows={2} placeholder="例：9:00-13:00 → 14:00-19:00"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                </div>

                {/* 他施設からの調整 */}
                <div className="pt-2 border-t border-gray-200">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={d.isExternalSupport}
                      onChange={e => updateDetail(i, {
                        isExternalSupport: e.target.checked,
                        supportFromFacilityId: e.target.checked ? d.supportFromFacilityId : '',
                      })}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                    <span className="text-xs font-medium text-gray-700">他施設からの調整</span>
                  </label>

                  {d.isExternalSupport && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">調整元施設 <span className="text-red-500">*</span></label>
                      <select value={d.supportFromFacilityId}
                        onChange={e => updateDetail(i, { supportFromFacilityId: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">選択してください</option>
                        {activeFacilities.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {details.length < MAX_DETAILS && (
              <button type="button" onClick={addDetail}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                <Plus size={14} />
                対象者を追加（{details.length}/{MAX_DETAILS}名）
              </button>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {emailWarning && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{emailWarning}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t flex-shrink-0">
          {editing && onDelete ? (
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-60">
              <Trash2 size={14} />削除
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
              {emailWarning ? '閉じる' : 'キャンセル'}
            </button>
            {!emailWarning && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />
                {saving ? '保存中…' : '保存'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
