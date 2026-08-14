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

  // 振休対応グループ（related_change_group_id）に属するレコード一覧を取得
  const loadGroup = useCallback(async (groupId: string): Promise<ShiftChangeRecord[]> => {
    return shiftChangeService.getByGroupId(groupId)
  }, [])

  // 代替出勤者の明細に「振休日を設定済み」を反映する
  const linkCompensatoryLeave = useCallback(async (detailId: string): Promise<void> => {
    await shiftChangeService.setDetailCompensatoryLeaveLinked(detailId)
    setRecords(prev => prev.map(r => ({
      ...r,
      details: r.details.map(d => d.id === detailId ? { ...d, compensatoryLeaveStatus: 'linked' as const } : d),
    })))
  }, [])

  return {
    records,
    loading,
    error,
    reload: load,
    addRecord,
    updateRecord,
    deleteRecord,
    loadGroup,
    linkCompensatoryLeave,
  }
}
