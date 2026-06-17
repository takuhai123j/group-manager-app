'use client'

import { useState, useEffect, useCallback } from 'react'
import { shiftChangeService } from '@/services/shiftChangeService'
import type { ShiftChangeRecord, CreateShiftChangeInput, ShiftChangeFilters } from '@/lib/types'

export function useShiftChanges() {
  const [records, setRecords] = useState<ShiftChangeRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (filters?: Partial<ShiftChangeFilters>) => {
    setLoading(true)
    setError(null)
    try {
      const data = await shiftChangeService.getAll(filters)
      setRecords(data)
    } catch {
      setError('シフト変更記録の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addRecord = useCallback(async (input: CreateShiftChangeInput): Promise<ShiftChangeRecord> => {
    const created = await shiftChangeService.create(input)
    setRecords(prev => [created, ...prev])
    return created
  }, [])

  const updateRecord = useCallback(async (id: string, input: CreateShiftChangeInput): Promise<ShiftChangeRecord> => {
    const updated = await shiftChangeService.update(id, input)
    setRecords(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }, [])

  const deleteRecord = useCallback(async (id: string): Promise<void> => {
    await shiftChangeService.delete(id)
    setRecords(prev => prev.filter(r => r.id !== id))
  }, [])

  return {
    records,
    loading,
    error,
    reload: load,
    addRecord,
    updateRecord,
    deleteRecord,
  }
}
