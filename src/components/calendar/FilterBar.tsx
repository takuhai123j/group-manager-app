'use client'

import { useState } from 'react'
import { SlidersHorizontal, X, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EVENT_TYPES } from '@/constants/eventTypes'
import type { EventFilters, EventType } from '@/lib/types'

interface FilterBarProps {
  filters: EventFilters
  facilityNames: string[]
  totalCount: number
  filteredCount: number
  onChange: (filters: EventFilters) => void
  onClear: () => void
}

export function FilterBar({
  filters,
  facilityNames,
  totalCount,
  filteredCount,
  onChange,
  onClear,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false)

  const activeCount = filters.types.length + filters.facilities.length
  const isFiltered = activeCount > 0

  const toggleType = (type: EventType) => {
    const next = filters.types.includes(type)
      ? filters.types.filter(t => t !== type)
      : [...filters.types, type]
    onChange({ ...filters, types: next })
  }

  const toggleFacility = (name: string) => {
    const next = filters.facilities.includes(name)
      ? filters.facilities.filter(f => f !== name)
      : [...filters.facilities, name]
    onChange({ ...filters, facilities: next })
  }

  return (
    <div className="bg-white border-b">
      {/* Summary row */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
            isFiltered
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          )}
        >
          <SlidersHorizontal size={14} />
          絞り込み
          {isFiltered && (
            <span className="bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none font-bold">
              {activeCount}
            </span>
          )}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Active filter chips */}
        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
          {filters.types.map(type => {
            const config = EVENT_TYPES.find(t => t.value === type)!
            return (
              <span
                key={type}
                className={cn(
                  'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border',
                  config.bgColor, config.textColor, config.borderColor
                )}
              >
                {config.label}
                <button onClick={() => toggleType(type)} className="hover:opacity-70">
                  <X size={11} />
                </button>
              </span>
            )
          })}
          {filters.facilities.map(name => (
            <span
              key={name}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border bg-teal-50 text-teal-700 border-teal-300"
            >
              {name}
              <button onClick={() => toggleFacility(name)} className="hover:opacity-70">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>

        {/* Stats + clear */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFiltered && (
            <>
              <span className="text-xs text-gray-500">
                {filteredCount}/{totalCount}件
              </span>
              <button
                onClick={onClear}
                className="text-xs text-gray-500 hover:text-red-500 underline transition-colors whitespace-nowrap"
              >
                クリア
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded filter panel */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t pt-3 bg-gray-50">
          {/* Type filters */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">種別</p>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map(t => {
                const active = filters.types.includes(t.value)
                return (
                  <button
                    key={t.value}
                    onClick={() => toggleType(t.value)}
                    className={cn(
                      'flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
                      active
                        ? cn(t.bgColor, t.textColor, t.borderColor)
                        : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', t.dotColor)} />
                    {t.label}
                    {active && <X size={11} className="ml-0.5" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Facility filters */}
          {facilityNames.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-1.5">施設</p>
              <div className="flex flex-wrap gap-1.5">
                {facilityNames.map(name => {
                  const active = filters.facilities.includes(name)
                  return (
                    <button
                      key={name}
                      onClick={() => toggleFacility(name)}
                      className={cn(
                        'flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors',
                        active
                          ? 'bg-teal-100 text-teal-800 border-teal-400'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                      )}
                    >
                      {name}
                      {active && <X size={11} className="ml-0.5" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Clear button */}
          {isFiltered && (
            <div className="pt-1">
              <button
                onClick={() => { onClear(); setExpanded(false) }}
                className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
              >
                すべてクリア
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
