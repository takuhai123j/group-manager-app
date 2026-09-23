'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MEETING_TYPE_ORDER } from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import type { Facility, MeetingFrequency, MeetingFrequencyInput, MeetingType } from '@/lib/types'

interface MeetingFrequencyPanelProps {
  facilities: Facility[]
  frequencies: MeetingFrequency[]
  onSave: (existingId: string | undefined, input: MeetingFrequencyInput) => Promise<void>
  onToggleActive: (id: string) => Promise<void>
}

type RowForm = { intervalMonths: number; startMonth: number }

function rowKey(facilityId: string, meetingType: MeetingType): string {
  return `${facilityId}|${meetingType}`
}

export function MeetingFrequencyPanel({
  facilities, frequencies, onSave, onToggleActive,
}: MeetingFrequencyPanelProps) {
  const [forms, setForms] = useState<Record<string, RowForm>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const findFrequency = (facilityId: string, meetingType: MeetingType) =>
    frequencies.find(f => f.facilityId === facilityId && f.meetingType === meetingType)

  const getForm = (facilityId: string, meetingType: MeetingType): RowForm => {
    const key = rowKey(facilityId, meetingType)
    if (forms[key]) return forms[key]
    const existing = findFrequency(facilityId, meetingType)
    return { intervalMonths: existing?.intervalMonths ?? 3, startMonth: existing?.startMonth ?? 1 }
  }

  const setForm = (facilityId: string, meetingType: MeetingType, patch: Partial<RowForm>) => {
    const key = rowKey(facilityId, meetingType)
    setForms(prev => ({ ...prev, [key]: { ...getForm(facilityId, meetingType), ...patch } }))
  }

  const handleSave = async (facilityId: string, meetingType: MeetingType) => {
    const key = rowKey(facilityId, meetingType)
    const form = getForm(facilityId, meetingType)
    const existing = findFrequency(facilityId, meetingType)
    setSavingKey(key)
    setErrorKey(null)
    try {
      await onSave(existing?.id, {
        facilityId,
        meetingType,
        intervalMonths: form.intervalMonths,
        startMonth: form.startMonth,
        memo: existing?.memo ?? '',
      })
    } catch {
      setErrorKey(key)
    } finally {
      setSavingKey(null)
    }
  }

  const handleToggle = async (id: string) => {
    setSavingKey(id)
    try {
      await onToggleActive(id)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="p-4">
      <p className="text-xs text-gray-500 mb-3">
        施設・MT種別ごとに開催頻度を設定します。保存すると、選択中の年の年間計画が再生成されます
        （日程確定済・実施済・議事録あり・手動追加のMTは保護され、変更されません）。
      </p>
      <div className="space-y-2">
        {facilities.map(facility => (
          <div key={facility.id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-sm font-semibold text-gray-700">{facility.name}</div>
            <div className="divide-y divide-gray-100">
              {MEETING_TYPE_ORDER.map(meetingType => {
                const existing = findFrequency(facility.id, meetingType)
                const form = getForm(facility.id, meetingType)
                const key = rowKey(facility.id, meetingType)
                const saving = savingKey === key || savingKey === existing?.id

                return (
                  <div key={meetingType} className="px-3 py-2.5 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-600 w-20 flex-shrink-0">
                      {MEETING_TYPE_LABELS[meetingType]}
                    </span>

                    {!existing ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">未設定</span>
                    ) : existing.active ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">有効</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">無効</span>
                    )}

                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={form.intervalMonths}
                        onChange={e => setForm(facility.id, meetingType, { intervalMonths: Number(e.target.value) || 1 })}
                        className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span>か月ごと</span>
                    </div>

                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <select
                        value={form.startMonth}
                        onChange={e => setForm(facility.id, meetingType, { startMonth: Number(e.target.value) })}
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                          <option key={m} value={m}>{m}月</option>
                        ))}
                      </select>
                      <span>開始</span>
                    </div>

                    <button
                      onClick={() => handleSave(facility.id, meetingType)}
                      disabled={saving}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Check size={13} />
                      {saving ? '保存中…' : '保存'}
                    </button>

                    {existing && (
                      <button
                        onClick={() => handleToggle(existing.id)}
                        disabled={saving}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg border text-xs font-medium disabled:opacity-50',
                          existing.active
                            ? 'border-gray-300 text-gray-500 hover:bg-gray-50'
                            : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        )}
                      >
                        {existing.active ? '無効化' : '有効化'}
                      </button>
                    )}

                    {errorKey === key && (
                      <span className="text-xs text-red-500 w-full">保存に失敗しました</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {facilities.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">有効な施設がありません</p>
        )}
      </div>
    </div>
  )
}
