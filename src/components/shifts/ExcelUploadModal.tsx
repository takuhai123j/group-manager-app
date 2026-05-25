'use client'

import { useState } from 'react'
import { X, Upload, FileText } from 'lucide-react'
import { SHIFT_FILE_TYPE_LABELS, type ShiftFileType, type CreateShiftFileInput, type Facility } from '@/lib/types'

interface PdfUploadModalProps {
  facilities: Facility[]
  onClose: () => void
  onUpload: (file: File, input: CreateShiftFileInput) => Promise<void>
}

type UploadForm = {
  fileType: ShiftFileType
  facilityId: string
  targetMonth: string
  memo: string
}

const defaultForm: UploadForm = {
  fileType: 'shift',
  facilityId: '',
  targetMonth: '',
  memo: '',
}

export function PdfUploadModal({ facilities, onClose, onUpload }: PdfUploadModalProps) {
  const [form, setForm] = useState<UploadForm>(defaultForm)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const setF = <K extends keyof UploadForm>(k: K, v: UploadForm[K]) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setError('')
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file && file.type !== 'application/pdf') {
      setError('PDFファイルを選択してください')
      return
    }
    setSelectedFile(file)
    setError('')
  }

  const handleSubmit = async () => {
    if (!selectedFile) { setError('PDFファイルを選択してください'); return }
    if (!form.targetMonth) { setError('対象年月を選択してください'); return }
    setUploading(true)
    try {
      await onUpload(selectedFile, {
        fileType: form.fileType,
        facilityId: form.facilityId || null,
        targetMonth: form.targetMonth,
        memo: form.memo,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md">

        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-red-500" />
            <h3 className="text-base font-semibold text-gray-800">PDFをアップロード</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* ファイル選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              PDFファイル <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-red-50 file:text-red-700 file:text-sm file:font-medium hover:file:bg-red-100"
            />
            {selectedFile && (
              <p className="text-xs text-gray-500 mt-1 truncate">選択中: {selectedFile.name}</p>
            )}
          </div>

          {/* 種別 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              種別 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.fileType}
              onChange={e => setF('fileType', e.target.value as ShiftFileType)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(Object.keys(SHIFT_FILE_TYPE_LABELS) as ShiftFileType[]).map(k => (
                <option key={k} value={k}>{SHIFT_FILE_TYPE_LABELS[k]}</option>
              ))}
            </select>
          </div>

          {/* 施設名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">施設名</label>
            <select
              value={form.facilityId}
              onChange={e => setF('facilityId', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">（未選択）</option>
              {facilities.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* 対象年月 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              対象年月 <span className="text-red-500">*</span>
            </label>
            <input
              type="month"
              value={form.targetMonth}
              onChange={e => setF('targetMonth', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* メモ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
            <textarea
              value={form.memo}
              onChange={e => setF('memo', e.target.value)}
              rows={2}
              placeholder="備考など"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              <Upload size={16} />
              {uploading ? 'アップロード中…' : 'アップロード'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
