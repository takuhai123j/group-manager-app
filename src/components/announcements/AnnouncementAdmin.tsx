'use client'

import { useState } from 'react'
import { X, Plus, Trash2, Save, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Announcement, CreateAnnouncementInput, UpdateAnnouncementInput } from '@/lib/types'

interface AnnouncementAdminProps {
  isOpen: boolean
  announcements: Announcement[]
  onClose: () => void
  onAdd: (input: CreateAnnouncementInput) => Promise<Announcement>
  onUpdate: (id: string, input: UpdateAnnouncementInput) => Promise<Announcement>
  onDelete: (id: string) => Promise<void>
}

type ViewMode = 'list' | 'add' | 'edit'

const defaultForm: CreateAnnouncementInput = {
  title: '',
  content: '',
  isImportant: false,
  active: true,
}

export function AnnouncementAdmin({
  isOpen, announcements, onClose, onAdd, onUpdate, onDelete,
}: AnnouncementAdminProps) {
  const [mode, setMode] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CreateAnnouncementInput>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [formError, setFormError] = useState('')

  // ── フック呼び出しより後に early return しないためすべてここで定義 ──

  const openAdd = () => {
    setForm(defaultForm)
    setEditingId(null)
    setFormError('')
    setMode('add')
  }

  const openEdit = (a: Announcement) => {
    setForm({
      title: a.title,
      content: a.content,
      isImportant: a.isImportant,
      active: a.active,
    })
    setEditingId(a.id)
    setFormError('')
    setMode('edit')
  }

  const handleSave = async () => {
    if (!form.title.trim()) { setFormError('タイトルを入力してください'); return }
    if (!form.content.trim()) { setFormError('内容を入力してください'); return }
    setSaving(true)
    try {
      if (mode === 'edit' && editingId) {
        await onUpdate(editingId, form)
      } else {
        await onAdd(form)
      }
      setMode('list')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このお知らせを削除しますか？')) return
    setDeleting(id)
    try { await onDelete(id) }
    finally { setDeleting(null) }
  }

  const handleToggleActive = async (a: Announcement) => {
    await onUpdate(a.id, { active: !a.active })
  }

  if (!isOpen) return null

  const setF = <K extends keyof CreateAnnouncementInput>(k: K, v: CreateAnnouncementInput[K]) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setFormError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === 'list' ? 'お知らせ管理' : mode === 'add' ? 'お知らせを追加' : 'お知らせを編集'}
          </h2>
          <button
            onClick={mode !== 'list' ? () => setMode('list') : onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* 一覧 */}
        {mode === 'list' && (
          <div className="p-4">
            <button
              onClick={openAdd}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-blue-300 text-blue-600 text-sm font-medium hover:bg-blue-50 mb-4"
            >
              <Plus size={16} />お知らせを追加
            </button>

            {announcements.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-8">お知らせはありません</p>
            ) : (
              <div className="space-y-2">
                {announcements.map(a => (
                  <div
                    key={a.id}
                    className={cn(
                      'rounded-lg border p-3 transition-opacity',
                      a.isImportant ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white',
                      !a.active && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {a.isImportant && <AlertCircle size={12} className="text-red-500 flex-shrink-0" />}
                          <span className="text-sm font-medium text-gray-800 truncate">{a.title}</span>
                          {!a.active && <span className="text-xs text-gray-400 ml-1 flex-shrink-0">(非表示)</span>}
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">{a.content}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleToggleActive(a)}
                          className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                          title={a.active ? '非表示にする' : '表示する'}
                        >
                          {a.active ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button
                          onClick={() => openEdit(a)}
                          className="px-2 py-1 rounded text-xs font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDelete(a.id)}
                          disabled={deleting === a.id}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 追加・編集フォーム */}
        {(mode === 'add' || mode === 'edit') && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={e => setF('title', e.target.value)}
                placeholder="例：衛生監査提出期限について"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                内容 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={form.content}
                onChange={e => setF('content', e.target.value)}
                placeholder="お知らせの内容を入力してください（改行可）"
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isImportant}
                  onChange={e => setF('isImportant', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-red-500"
                />
                <span className="text-sm text-gray-700">重要なお知らせ</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setF('active', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-blue-500"
                />
                <span className="text-sm text-gray-700">表示する</span>
              </label>
            </div>

            {formError && <p className="text-xs text-red-500">{formError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setMode('list')}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <Save size={16} />
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
