'use client'

import { useState, useEffect, useCallback } from 'react'
import { scheduleService } from '@/services/scheduleService'
import type { ScheduleEvent, CreateEventInput, UpdateEventInput } from '@/lib/types'

export function useEvents() {
  const [events, setEvents] = useState<ScheduleEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await scheduleService.getAll()
      setEvents(data)
    } catch {
      setError('スケジュールの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addEvent = useCallback(async (input: CreateEventInput): Promise<ScheduleEvent> => {
    const created = await scheduleService.create(input)
    setEvents(prev => [...prev, created])
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
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [events])

  const getEventsForDateRange = useCallback((startDate: string, endDate: string): ScheduleEvent[] => {
    return events
      .filter(e => e.date >= startDate && e.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
  }, [events])

  return {
    events,
    loading,
    error,
    addEvent,
    updateEvent,
    deleteEvent,
    getEventsForDate,
    getEventsForDateRange,
    reload: load,
  }
}
