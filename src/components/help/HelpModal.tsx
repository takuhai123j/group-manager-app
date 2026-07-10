'use client'

import { X } from 'lucide-react'
import type { HelpContent } from '@/constants/helpContent'

interface Props {
  isOpen: boolean
  onClose: () => void
  content: HelpContent
}

export function HelpModal({ isOpen, onClose, content }: Props) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">この画面の使い方</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">
          {content.items.map((item, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-gray-800 mb-0.5">{item.title}</p>
              <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>
              {item.caution && (
                <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  {item.caution}
                </p>
              )}
            </div>
          ))}

          {content.commonMistake && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-red-600 mb-1.5">よくある間違い</p>
              <p className="text-sm font-medium text-gray-800 mb-0.5">{content.commonMistake.title}</p>
              <p className="text-sm text-gray-600 leading-relaxed">{content.commonMistake.description}</p>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex-shrink-0">
          <button onClick={onClose}
            className="w-full px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
