'use client'

import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onClick: () => void
  variant?: 'light' | 'dark'
  className?: string
}

export function HelpButton({ onClick, variant = 'light', className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="この画面の使い方"
      title="この画面の使い方"
      className={cn(
        'p-1.5 sm:p-2 rounded-lg transition-colors flex-shrink-0',
        variant === 'dark'
          ? 'text-blue-200 hover:text-white hover:bg-blue-600'
          : 'text-gray-500 hover:bg-gray-100',
        className
      )}
    >
      <HelpCircle size={18} />
    </button>
  )
}
