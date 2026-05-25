'use client'

import { useState, useMemo } from 'react'
import { X, Upload, ExternalLink, Trash2, FileText, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SHIFT_FILE_TYPE_LABELS,
  type ShiftFile, type ShiftFileType, type CreateShiftFileInput, type Facility,
} from '@/lib/types'
import { shiftFileService } from '@/services/shiftFileService'
import { PdfUploadModal } from './ExcelUploadModal'

interface ShiftFileManagerProps {
  isOpen: boolean
  files: ShiftFile[]
  loading: boolean
  facilities: Facility[]
  onClose: () => void
  onUpload: (file: File, input: CreateShiftFileInput) => Promise<void>
  onDelete: (id: string, filePath: string) => Promise<void>
}

type Filters = {
  fileType: string
  facilityId: string
  targetMonth: string
}

const EMPTY_FILTERS: Filters = { fileType: '', facilityId: '', targetMonth: '' }

function formatMonth(m: string): string {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return `${y}年${parseInt(mo)}月`
}

function FileTypeBadge({ type }: { type: ShiftFileType }) {
  const colors: Record<ShiftFileType, string> = {
    shift: 'bg-blue-100 text-blue-700',
    g_leader: 'bg-purple-100 text-purple-700',
    other: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap', colors[type])}>
      {SHIFT_FILE_TYPE_LABELS[type]}
    </span>
  )
}

export function ShiftFileManager({
  isOpen, files, loading, facilities, onClose, onUpload, onDelete,
}: ShiftFileManagerProps) {
  const [showUpload, setShowUpload] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [deleting, setDeleting] = useState<string | null>(null)

  const activeFacilities = useMemo(() => facilities.filter(f => f.active), [facilities])

  const filteredFiles = useMemo(() => files.filter(f => {
    if (filters.fileType && f.fileType !== filters.fileType) return false
    if (filters.facilityId && f.facilityId !== filters.facilityId) return false
    if (filters.targetMonth && f.targetMonth !== filters.targetMonth) return false
    return true
  }), [files, filters])

  const hasFilters = Boolean(filters.fileType || filters.facilityId || filters.targetMonth)

  const handleDelete = async (file: ShiftFile) => {
    if (!confirm(`「${file.fileName}」を削除しますか？`)) return
    setDeleting(file.id)
    try {
      await onDelete(file.id, file.filePath)
    } finally {
      setDeleting(null)
    }
  }

  const handleOpen = (file: ShiftFile) => {
    const url = shiftFileService.getPublicUrl(file.filePath)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:max-w-4xl shadow-xl flex flex-col overflow-hidden">

          {/* ヘッダー */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white z-10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <FileText size={20} className="text-red-500" />
              <h2 className="text-base font-semibold text-gray-800">PDF資料</h2>
              {!loading && (
                <span className="text-xs text-gray-400">
                  （{filteredFiles.length}{hasFilters ? `/${files.length}` : ''}件）
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                <Upload size={15} />
                <span className="hidden sm:inline">PDFを追加</span>
                <span className="sm:hidden">追加</span>
              </button>
              <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* フィルター */}
          <div className="px-4 py-3 border-b bg-gray-50 flex-shrink-0">
            <div className="flex flex-wrap gap-2 items-center">
              <Filter size={14} className="text-gray-400 flex-shrink-0" />

              <select
                value={filters.fileType}
                onChange={e => setFilters(prev => ({ ...prev, fileType: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">種別：すべて</option>
                {(Object.keys(SHIFT_FILE_TYPE_LABELS) as ShiftFileType[]).map(k => (
                  <option key={k} value={k}>{SHIFT_FILE_TYPE_LABELS[k]}</option>
                ))}
              </select>

              <select
                value={filters.facilityId}
                onChange={e => setFilters(prev => ({ ...prev, facilityId: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">施設：すべて</option>
                {activeFacilities.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>

              <input
                type="month"
                value={filters.targetMonth}
                onChange={e => setFilters(prev => ({ ...prev, targetMonth: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {hasFilters && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  クリア
                </button>
              )}
            </div>
          </div>

          {/* コンテンツ */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <FileText size={40} className="mb-3 opacity-30" />
                <p className="text-sm">
                  {hasFilters ? '条件に一致するPDFがありません' : 'PDFがありません'}
                </p>
                {!hasFilters && (
                  <button
                    onClick={() => setShowUpload(true)}
                    className="mt-3 text-sm text-red-600 hover:text-red-800 underline"
                  >
                    最初のPDFをアップロード
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* デスクトップ：テーブル */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b text-xs text-gray-500">
                        <th className="px-4 py-3 text-left font-medium">種別</th>
                        <th className="px-4 py-3 text-left font-medium">施設名</th>
                        <th className="px-4 py-3 text-left font-medium">対象年月</th>
                        <th className="px-4 py-3 text-left font-medium">ファイル名</th>
                        <th className="px-4 py-3 text-left font-medium">アップロード日</th>
                        <th className="px-4 py-3 text-left font-medium">メモ</th>
                        <th className="px-4 py-3 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredFiles.map(file => (
                        <tr key={file.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <FileTypeBadge type={file.fileType} />
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {file.facilityName ?? <span className="text-gray-400">―</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                            {formatMonth(file.targetMonth)}
                          </td>
                          <td className="px-4 py-3 max-w-[240px]">
                            <div className="flex items-center gap-1.5">
                              <FileText size={13} className="text-red-400 flex-shrink-0" />
                              <span className="text-gray-800 truncate block" title={file.fileName}>
                                {file.fileName}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                            {new Date(file.createdAt).toLocaleDateString('ja-JP')}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs max-w-[140px]">
                            <span className="truncate block" title={file.memo}>
                              {file.memo || <span className="text-gray-300">―</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleOpen(file)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                                title="新しいタブで開く"
                              >
                                <ExternalLink size={13} />開く
                              </button>
                              <button
                                onClick={() => handleDelete(file)}
                                disabled={deleting === file.id}
                                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                title="削除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* モバイル：カード */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {filteredFiles.map(file => (
                    <div key={file.id} className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        {/* PDFアイコン */}
                        <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                          <FileText size={20} className="text-red-500" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate leading-snug">
                                {file.fileName}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <FileTypeBadge type={file.fileType} />
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                  {formatMonth(file.targetMonth)}
                                </span>
                                {file.facilityName && (
                                  <span className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                                    {file.facilityName}
                                  </span>
                                )}
                              </div>
                              {file.memo && (
                                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{file.memo}</p>
                              )}
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(file.createdAt).toLocaleDateString('ja-JP')}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDelete(file)}
                              disabled={deleting === file.id}
                              className="p-2 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                          <button
                            onClick={() => handleOpen(file)}
                            className="mt-2.5 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
                          >
                            <ExternalLink size={16} />PDFを開く
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showUpload && (
        <PdfUploadModal
          facilities={activeFacilities}
          onClose={() => setShowUpload(false)}
          onUpload={onUpload}
        />
      )}
    </>
  )
}
