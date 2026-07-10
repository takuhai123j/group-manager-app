'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Trash2, Save, Building2, CalendarDays, Plus, ChevronLeft } from 'lucide-react'
import { cn, generateTimeSlots, toDateString, formatJa } from '@/lib/utils'
import { EVENT_TYPES, isAllDayType, isHalfDayType, computeHalfDayEndTime, buildAutoTitle } from '@/constants/eventTypes'
import { HelpButton } from '@/components/help/HelpButton'
import { HelpModal } from '@/components/help/HelpModal'
import { HELP_CONTENT } from '@/constants/helpContent'
import type { ScheduleEvent, CreateEventInput, EventType, GroupManager, Facility } from '@/lib/types'

interface EventModalProps {
  isOpen: boolean
  initialDate?: Date
  editingEvent?: ScheduleEvent | null
  facilities: Facility[]
  allFacilities: Facility[]
  activeManagers: GroupManager[]
  allManagers: GroupManager[]
  managerFacilities: Record<string, string[]>
  preselectedLeaderId?: string
  onClose: () => void
  onSave: (input: CreateEventInput) => Promise<void>
  onSaveBulk?: (inputs: CreateEventInput[]) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onOpenFacilityManager?: () => void
}

type BulkMode = 'single' | 'multiple' | 'range'

interface FormState {
  title: string
  date: string
  startTime: string
  endTime: string
  facilityId: string
  type: EventType
  memo: string
  groupLeaderId: string
}

const TIME_SLOTS = generateTimeSlots(6, 22)
const HALF_DAY_TIME_SLOTS = generateTimeSlots(6, 20)

const defaultForm = (date?: Date, leaderId?: string): FormState => ({
  title: '',
  date: date ? toDateString(date) : toDateString(new Date()),
  startTime: '09:00',
  endTime: '10:00',
  facilityId: '',
  type: 'patrol',
  memo: '',
  groupLeaderId: leaderId ?? '',
})

function generateDateRange(startDate: string, endDate: string, maxDays = 62): string[] {
  if (!startDate || !endDate || startDate > endDate) return []
  const dates: string[] = []
  const cur = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  let count = 0
  while (cur <= end && count < maxDays) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
    count++
  }
  return dates
}

function formatDateJa(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return formatJa(new Date(dateStr + 'T00:00:00'), 'yyyy/MM/dd（EEE）')
  } catch {
    return dateStr
  }
}

export function EventModal({
  isOpen,
  initialDate,
  editingEvent,
  facilities,
  allFacilities,
  activeManagers,
  allManagers,
  managerFacilities,
  preselectedLeaderId,
  onClose,
  onSave,
  onSaveBulk,
  onDelete,
  onOpenFacilityManager,
}: EventModalProps) {
  const [form, setForm] = useState<FormState>(defaultForm(initialDate, preselectedLeaderId))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  // 一括登録用ステート（全日予定の新規追加時のみ有効）
  const [bulkMode, setBulkMode] = useState<BulkMode>('single')
  const [multiDateList, setMultiDateList] = useState<string[]>([])
  const [rangeEndDate, setRangeEndDate] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const isAllDay = isAllDayType(form.type)
  const isHalfDay = isHalfDayType(form.type)
  const showBulkMode = isAllDay && !editingEvent

  useEffect(() => {
    if (!isOpen) return
    if (editingEvent) {
      setForm({
        title: editingEvent.title,
        date: editingEvent.date,
        startTime: editingEvent.startTime,
        endTime: editingEvent.endTime,
        facilityId: editingEvent.facilityId ?? '',
        type: editingEvent.type,
        memo: editingEvent.memo,
        groupLeaderId: editingEvent.groupLeaderId,
      })
    } else {
      setForm(defaultForm(initialDate, preselectedLeaderId))
    }
    setErrors({})
    setBulkMode('single')
    setMultiDateList([])
    setRangeEndDate('')
    setBulkError('')
    setShowBulkConfirm(false)
  }, [isOpen, editingEvent, initialDate, preselectedLeaderId])

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (bulkMode === 'single' && !form.date) e.date = '日付を選択してください'
    if (!isAllDay && !isHalfDay) {
      if (!form.date) e.date = '日付を選択してください'
      if (!form.startTime) e.startTime = '開始時間を選択してください'
      if (!form.endTime) e.endTime = '終了時間を選択してください'
      if (form.startTime >= form.endTime) e.endTime = '終了時間は開始時間より後にしてください'
    }
    if (isHalfDay && !form.startTime) e.startTime = '開始時間を選択してください'
    if (!form.groupLeaderId) e.groupLeaderId = '担当G長を選択してください'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const getDatesForBulk = (): string[] => {
    if (!showBulkMode) return [form.date].filter(Boolean)
    if (bulkMode === 'single') return [form.date].filter(Boolean)
    if (bulkMode === 'multiple') {
      return [...new Set(multiDateList.filter(Boolean))].sort()
    }
    return generateDateRange(form.date, rangeEndDate)
  }

  const handleBulkModeChange = (mode: BulkMode) => {
    setBulkMode(mode)
    setBulkError('')
    if (mode === 'multiple') {
      setMultiDateList([form.date].filter(Boolean))
    }
  }

  const resolveFacilityName = (): string => {
    if (isAllDay || isHalfDay || !form.facilityId) return ''
    return allFacilities.find(f => f.id === form.facilityId)?.name ?? ''
  }

  const resolveTitle = (): string => {
    const trimmed = form.title.trim()
    return trimmed || buildAutoTitle(form.type, resolveFacilityName())
  }

  const handleSave = useCallback(async () => {
    if (!validate()) return
    setBulkError('')

    if (showBulkMode) {
      if (bulkMode === 'range') {
        if (!rangeEndDate) { setBulkError('終了日を選択してください'); return }
        if (form.date > rangeEndDate) { setBulkError('終了日は開始日以降を選択してください'); return }
      }
      if (bulkMode === 'multiple') {
        const valid = multiDateList.filter(Boolean)
        if (valid.length === 0) { setBulkError('日付を1つ以上選択してください'); return }
      }
      const dates = getDatesForBulk()
      if (dates.length > 1) {
        setShowBulkConfirm(true)
        return
      }
    }

    // 単日保存（通常予定 or 全日1件）
    setSaving(true)
    try {
      const date = showBulkMode ? (getDatesForBulk()[0] ?? form.date) : form.date
      await onSave({
        title: resolveTitle(),
        date,
        startTime: isAllDay ? '00:00' : form.startTime,
        endTime: isAllDay ? '00:00' : form.endTime,
        facilityId: (isAllDay || isHalfDay) ? null : (form.facilityId || null),
        type: form.type,
        isAllDay,
        memo: form.memo.trim(),
        groupLeaderId: form.groupLeaderId,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isAllDay, isHalfDay, showBulkMode, bulkMode, rangeEndDate, multiDateList, allFacilities, onSave, onClose])

  const handleBulkConfirm = useCallback(async () => {
    const dates = getDatesForBulk()
    const bulkTitle = resolveTitle()
    const inputs: CreateEventInput[] = dates.map(date => ({
      title: bulkTitle,
      date,
      startTime: '00:00',
      endTime: '00:00',
      facilityId: null,
      type: form.type,
      isAllDay: true,
      memo: form.memo.trim(),
      groupLeaderId: form.groupLeaderId,
    }))
    setBulkSaving(true)
    try {
      if (onSaveBulk) {
        await onSaveBulk(inputs)
      } else {
        for (const input of inputs) await onSave(input)
      }
      onClose()
    } finally {
      setBulkSaving(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, bulkMode, multiDateList, rangeEndDate, onSaveBulk, onSave, onClose])

  const handleDelete = useCallback(async () => {
    if (!editingEvent || !onDelete) return
    if (!confirm('この予定を削除しますか？')) return
    setDeleting(true)
    try { await onDelete(editingEvent.id); onClose() }
    finally { setDeleting(false) }
  }, [editingEvent, onDelete, onClose])

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: val }))
    setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const handleTypeChange = (type: EventType) => {
    const newConfig = EVENT_TYPES.find(t => t.value === type)
    const autoTitleLabels = EVENT_TYPES.filter(t => isAllDayType(t.value) || isHalfDayType(t.value)).map(t => t.label)
    const shouldAutoFill = (isAllDayType(type) || isHalfDayType(type)) &&
      (form.title === '' || autoTitleLabels.includes(form.title))
    setForm(prev => {
      let startTime = prev.startTime
      let endTime = prev.endTime
      if (isHalfDayType(type)) {
        const [h, m] = startTime.split(':').map(Number)
        const clampedH = Math.min(h, 20)
        startTime = `${String(clampedH).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        endTime = computeHalfDayEndTime(startTime)
      }
      return {
        ...prev,
        type,
        startTime,
        endTime,
        title: shouldAutoFill ? (newConfig?.label ?? prev.title) : prev.title,
      }
    })
    setErrors(prev => ({ ...prev, type: undefined, title: undefined }))
    if (!isAllDayType(type)) {
      setBulkMode('single')
      setShowBulkConfirm(false)
    }
  }

  const handleHalfDayStartChange = (startTime: string) => {
    const endTime = computeHalfDayEndTime(startTime)
    setForm(prev => ({ ...prev, startTime, endTime }))
    setErrors(prev => ({ ...prev, startTime: undefined }))
  }

  if (!isOpen) return null

  const extraFacility = editingEvent?.facilityId
    ? allFacilities.find(f => f.id === editingEvent.facilityId && !f.active)
    : null

  const extraManager = editingEvent
    ? allManagers.find(m => m.id === editingEvent.groupLeaderId && !m.active)
    : null
  const selectableManagers = extraManager
    ? [...activeManagers, extraManager]
    : activeManagers

  const defaultFacilityIds = form.groupLeaderId
    ? (managerFacilities[form.groupLeaderId] ?? [])
    : []
  const defaultFacilities = facilities.filter(f => defaultFacilityIds.includes(f.id))
  const otherFacilities = facilities.filter(f => !defaultFacilityIds.includes(f.id))
  const isOutsideSelected = !!form.facilityId
    && defaultFacilityIds.length > 0
    && !defaultFacilityIds.includes(form.facilityId)

  const typeLabel = EVENT_TYPES.find(t => t.value === form.type)?.label ?? ''
  const managerName = selectableManagers.find(m => m.id === form.groupLeaderId)?.name ?? ''

  // ── 一括登録確認画面 ────────────────────────────────────────────
  if (showBulkConfirm) {
    const dates = getDatesForBulk()
    const displayDates = dates.slice(0, 10)
    const remaining = dates.length - displayDates.length
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10">
            <h2 className="text-base font-semibold text-gray-800">登録確認</h2>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
          <div className="p-4">
            <p className="text-base font-semibold text-gray-800 mb-1">
              {dates.length}日分の{typeLabel}を登録しますか？
            </p>
            <p className="text-sm text-gray-500 mb-4">担当：{managerName}</p>
            <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-100 mb-1">
              {displayDates.map(d => (
                <div key={d} className="px-3 py-2 text-sm text-gray-700">{formatDateJa(d)}</div>
              ))}
              {remaining > 0 && (
                <div className="px-3 py-2 text-sm text-gray-400">他 {remaining}件</div>
              )}
            </div>
          </div>
          <div className="flex gap-3 px-4 py-3 border-t sticky bottom-0 bg-white">
            <button
              onClick={() => setShowBulkConfirm(false)}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              <ChevronLeft size={16} />戻る
            </button>
            <button
              onClick={handleBulkConfirm}
              disabled={bulkSaving}
              className="flex-1 flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={16} />
              {bulkSaving ? '登録中…' : '登録する'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── 通常フォーム ────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white z-10">
          <h2 className="text-base font-semibold text-gray-800">
            {editingEvent ? '予定を編集' : '予定を追加'}
          </h2>
          <div className="flex items-center gap-1">
            <HelpButton onClick={() => setHelpOpen(true)} />
            <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Group leader */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              担当G長 <span className="text-red-500">*</span>
            </label>
            {selectableManagers.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                有効なG長がいません。G長マスタ管理から追加してください。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {selectableManagers.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => set('groupLeaderId', m.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors text-left',
                      form.groupLeaderId === m.id
                        ? 'border-2'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                      !m.active && 'opacity-60'
                    )}
                    style={form.groupLeaderId === m.id ? {
                      backgroundColor: `${m.color}20`,
                      borderColor: m.color,
                      color: '#1e293b',
                    } : undefined}
                  >
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="truncate">{m.name}</span>
                    {!m.active && <span className="text-xs text-gray-400 ml-auto">(無効)</span>}
                  </button>
                ))}
              </div>
            )}
            {errors.groupLeaderId && (
              <p className="mt-1 text-xs text-red-500">{errors.groupLeaderId}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              タイトル
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="未入力の場合は施設名と種別から自動入力されます"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              種別 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {EVENT_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeChange(t.value)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border transition-colors text-left',
                    form.type === t.value
                      ? cn(t.bgColor, t.textColor, t.borderColor, 'font-semibold')
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                >
                  <span className={cn('inline-block w-2 h-2 rounded-full mr-2', t.dotColor)} />
                  {t.label}
                  {isAllDayType(t.value) && (
                    <span className="ml-1 text-xs opacity-60">（全日）</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 日付登録モード（全日 新規のみ） */}
          {showBulkMode && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">日付登録モード</label>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                {(['single', 'multiple', 'range'] as const).map((mode, idx) => {
                  const labels: Record<BulkMode, string> = { single: '単日', multiple: '複数日', range: '期間指定' }
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleBulkModeChange(mode)}
                      className={cn(
                        'flex-1 py-2 font-medium transition-colors',
                        idx > 0 && 'border-l border-gray-300',
                        bulkMode === mode
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {labels[mode]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 日付エリア */}
          {showBulkMode ? (
            <>
              {/* 単日モード */}
              {bulkMode === 'single' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    日付 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => set('date', e.target.value)}
                    className={cn(
                      'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                      errors.date ? 'border-red-400' : 'border-gray-300'
                    )}
                  />
                  {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date}</p>}
                </div>
              )}

              {/* 複数日モード */}
              {bulkMode === 'multiple' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    日付（複数選択可） <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-2">
                    {multiDateList.map((d, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="date"
                          value={d}
                          onChange={e => {
                            const next = [...multiDateList]
                            next[i] = e.target.value
                            setMultiDateList(next)
                            setBulkError('')
                          }}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {multiDateList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMultiDateList(prev => prev.filter((_, j) => j !== i))}
                            className="p-2.5 rounded-lg border border-gray-300 text-gray-400 hover:text-red-500 hover:border-red-300"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMultiDateList(prev => [...prev, ''])}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-blue-300 text-blue-600 text-sm hover:bg-blue-50"
                    >
                      <Plus size={14} />日付を追加
                    </button>
                  </div>
                </div>
              )}

              {/* 期間指定モード */}
              {bulkMode === 'range' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      開始日 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={e => { set('date', e.target.value); setBulkError('') }}
                      className={cn(
                        'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                        errors.date ? 'border-red-400' : 'border-gray-300'
                      )}
                    />
                    {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      終了日 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={rangeEndDate}
                      min={form.date || undefined}
                      onChange={e => { setRangeEndDate(e.target.value); setBulkError('') }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {form.date && rangeEndDate && form.date <= rangeEndDate && (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                      {generateDateRange(form.date, rangeEndDate).length}日間
                      （{formatDateJa(form.date)} 〜 {formatDateJa(rangeEndDate)}）
                    </p>
                  )}
                </div>
              )}

              {bulkError && <p className="text-xs text-red-500">{bulkError}</p>}
            </>
          ) : (
            /* 通常の日付入力（非全日 or 編集） */
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                日付 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={e => set('date', e.target.value)}
                className={cn(
                  'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  errors.date ? 'border-red-400' : 'border-gray-300'
                )}
              />
              {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date}</p>}
            </div>
          )}

          {/* Time (timed events only) / All-day indicator */}
          {isAllDay ? (
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
              <CalendarDays size={16} className="flex-shrink-0 text-slate-400" />
              <span className="font-medium">全日予定（時間指定なし）</span>
            </div>
          ) : isHalfDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始時間 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.startTime}
                  onChange={e => handleHalfDayStartChange(e.target.value)}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white',
                    errors.startTime ? 'border-red-400' : 'border-gray-300'
                  )}
                >
                  {HALF_DAY_TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.startTime && <p className="mt-1 text-xs text-red-500">{errors.startTime}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
                <div className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-gray-50 text-gray-500 flex items-center justify-between">
                  <span className="font-medium text-gray-700">{form.endTime}</span>
                  <span className="text-xs text-indigo-500 ml-1">（自動）</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始時間 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.startTime}
                  onChange={e => set('startTime', e.target.value)}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white',
                    errors.startTime ? 'border-red-400' : 'border-gray-300'
                  )}
                >
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.startTime && <p className="mt-1 text-xs text-red-500">{errors.startTime}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  終了時間 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.endTime}
                  onChange={e => set('endTime', e.target.value)}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white',
                    errors.endTime ? 'border-red-400' : 'border-gray-300'
                  )}
                >
                  {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.endTime && <p className="mt-1 text-xs text-red-500">{errors.endTime}</p>}
              </div>
            </div>
          )}

          {/* Facility (timed events only, not for half-day) */}
          {!isAllDay && !isHalfDay && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">施設名</label>
                {onOpenFacilityManager && (
                  <button type="button" onClick={onOpenFacilityManager}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                    <Building2 size={12} />施設を管理
                  </button>
                )}
              </div>
              <select
                value={form.facilityId}
                onChange={e => set('facilityId', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">（未設定）</option>
                {defaultFacilities.length > 0 ? (
                  <>
                    <optgroup label="── 基本担当施設">
                      {defaultFacilities.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </optgroup>
                    {(otherFacilities.length > 0 || extraFacility) && (
                      <optgroup label="── その他の施設">
                        {otherFacilities.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                        {extraFacility && (
                          <option value={extraFacility.id}>
                            {extraFacility.name}（無効化済み）
                          </option>
                        )}
                      </optgroup>
                    )}
                  </>
                ) : (
                  <>
                    {facilities.map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                    {extraFacility && (
                      <option value={extraFacility.id}>
                        {extraFacility.name}（無効化済み）
                      </option>
                    )}
                  </>
                )}
              </select>
              {isOutsideSelected && (
                <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  基本担当外の施設です（応援・イレギュラー対応）
                </p>
              )}
            </div>
          )}

          {/* Memo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
            <textarea
              value={form.memo}
              onChange={e => set('memo', e.target.value)}
              placeholder="備考・持ち物・事前確認事項など"
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t sticky bottom-0 bg-white">
          {editingEvent && onDelete ? (
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50">
              <Trash2 size={16} />{deleting ? '削除中…' : '削除'}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">
              キャンセル
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Save size={16} />
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT[isAllDay || isHalfDay ? 'leaveForm' : 'eventForm']}
      />
    </div>
  )
}
