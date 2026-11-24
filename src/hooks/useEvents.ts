'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { scheduleService } from '@/services/scheduleService'
import { shiftSwapService, type HiddenScheduleRule } from '@/services/shiftSwapService'
import type { ScheduleEvent, CreateEventInput, UpdateEventInput } from '@/lib/types'

export function useEvents() {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 勤務・休日振替で非表示にした公休（予定は消さず、カレンダーの表示だけ外す）
  const [hiddenRules, setHiddenRules] = useState<HiddenScheduleRule[]>([])

  // silent: true の場合は loading を立てずに再取得する
  // （ページ全体がローディング画面に切り替わり、開いているモーダルが閉じてしまうのを防ぐため。
  //   MT年間計画など他画面からschedulesを操作した後の再同期で使用）
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [data, rules] = await Promise.all([
        scheduleService.getAll(),
        // 非表示の情報が読めなくても、カレンダーは表示する（公休がそのまま表示されるだけ）
        shiftSwapService.getHiddenScheduleRules().catch(() => [] as HiddenScheduleRule[]),
      ])
      setEvents(data)
      setHiddenRules(rules)
    } catch {
      setError('スケジュールの読み込みに失敗しました')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addEvent = useCallback(async (input: CreateEventInput): Promise<ScheduleEvent> => {
    const created = await scheduleService.create(input)
    setEvents(prev => [...prev, created])
    return created
  }, [])

  const addEvents = useCallback(async (inputs: CreateEventInput[]): Promise<ScheduleEvent[]> => {
    const created = await scheduleService.createBulk(inputs)
    setEvents(prev => [...prev, ...created])
    return created
  }, [])

  const updateEvent = useCallback(async (id: string, input: UpdateEventInput): Promise<ScheduleEvent> => {
    const updated = await scheduleService.update(id, input)
    setEvents(prev => prev.map(e => e.id === id ? updated : e))
    return updated
  }, [])

  const deleteEvent = useCallback(async (id: string): Promise<void> => {
    await scheduleService.delete(id)
    setEvents(prev => prev.filter(e => e.id !== id))
  }, [])

  const getEventsForDate = useCallback((dateStr: string): ScheduleEvent[] => {
    return events
      .filter(e => e.date === dateStr)
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  }, [events])

  const getEventsForDateRange = useCallback((startDate: string, endDate: string): ScheduleEvent[] => {
    return events
      .filter(e => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.startTime ?? '').localeCompare(b.startTime ?? ''))
  }, [events])

  // 非表示にする予定のID。紐付けた後に公休が別の日・別の人へ変えられた場合は隠さない
  const hiddenScheduleIds = useMemo(() => {
    const byId = new Map(events.map(e => [e.id, e]))
    const ids = new Set<string>()
    for (const r of hiddenRules) {
      const e = byId.get(r.scheduleId)
      if (e && e.type === 'kyukyu' && !e.shiftChangeRecordId && e.date === r.workDate && (e.staffMemberId ?? e.groupLeaderId) === r.personKey) ids.add(e.id)
    }
    return ids
  }, [events, hiddenRules])

  return {
    events,
    hiddenScheduleIds,
    loading,
    error,
    addEvent,
    addEvents,
    updateEvent,
    deleteEvent,
    getEventsForDate,
    getEventsForDateRange,
    reload: load,
  }
}
