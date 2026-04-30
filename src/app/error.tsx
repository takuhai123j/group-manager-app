'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AppError]', error)
  }, [error])

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-sm">
        <AlertTriangle size={36} className="text-amber-400 mx-auto mb-4" />
        <h2 className="text-base font-semibold text-gray-800 mb-2">
          表示中にエラーが発生しました
        </h2>
        <p className="text-xs text-gray-500 mb-1">
          {error?.message ?? 'クライアントエラーが発生しました'}
        </p>
        {error?.digest && (
          <p className="text-xs text-gray-400 mb-4">診断ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <RefreshCw size={14} />
          再読み込み
        </button>
        <p className="mt-4 text-xs text-gray-400">
          解決しない場合はSupabaseの接続設定を確認してください。
        </p>
      </div>
    </div>
  )
}
