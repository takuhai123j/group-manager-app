'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { facilityService } from '@/services/facilityService'
import type { Facility } from '@/lib/types'

export function useFacilities() {
  const [allFacilities, setAllFacilities] = useState<Facility[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await facilityService.getAll()
      setAllFacilities(data)
    } catch {
      setError('施設データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // active=true のみ（新規予定の選択肢に使用）
  const facilities = useMemo(
    () => allFacilities.filter(f => f.active),
    [allFacilities]
  )

  // FilterBar 用の名称リスト（active のみ）
  const facilityNames = useMemo(
    () => facilities.map(f => f.name),
    [facilities]
  )

  const addFacility = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim()
    if (!trimmed) return false
    if (allFacilities.some(f => f.name === trimmed && f.active)) return false
    try {
      const created = await facilityService.add(trimmed)
      setAllFacilities(prev => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder))
      return true
    } catch {
      return false
    }
  }, [allFacilities])

  // 物理削除ではなく active=false に変更
  const deactivateFacility = useCallback(async (id: string): Promise<void> => {
    try {
      await facilityService.deactivate(id)
      setAllFacilities(prev =>
        prev.map(f => f.id === id ? { ...f, active: false } : f)
      )
    } catch {
      setError('施設の無効化に失敗しました')
    }
  }, [])

  return {
    facilities,       // active のみ
    allFacilities,    // 無効化済みを含む全施設
    facilityNames,    // active 施設の名称一覧
    loading,
    error,
    addFacility,
    deactivateFacility,
    reload: load,
  }
}
