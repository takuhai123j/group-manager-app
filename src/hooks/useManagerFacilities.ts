'use client'

import { useState, useEffect, useCallback } from 'react'
import { groupManagerFacilityService } from '@/services/groupManagerFacilityService'

export function useManagerFacilities() {
  const [managerFacilities, setManagerFacilities] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await groupManagerFacilityService.getAll()
      setManagerFacilities(data)
    } catch {
      setError('基本担当施設データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setDefaultFacilities = useCallback(async (managerId: string, facilityIds: string[]): Promise<void> => {
    await groupManagerFacilityService.setForManager(managerId, facilityIds)
    setManagerFacilities(prev => ({ ...prev, [managerId]: facilityIds }))
  }, [])

  return {
    managerFacilities,
    loading,
    error,
    setDefaultFacilities,
    reload: load,
  }
}
