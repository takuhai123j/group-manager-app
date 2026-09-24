'use client'

import { useState, useEffect, useCallback } from 'react'
import { staffMemberFacilityService } from '@/services/staffMemberFacilityService'

// スタッフ（当面はリーダー）の担当施設。G長の useManagerFacilities と同じ形で扱う。
export function useStaffMemberFacilities() {
  const [memberFacilities, setMemberFacilities] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await staffMemberFacilityService.getAll()
      setMemberFacilities(data)
    } catch {
      setError('担当施設データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setFacilities = useCallback(async (staffMemberId: string, facilityIds: string[]): Promise<void> => {
    await staffMemberFacilityService.setForMember(staffMemberId, facilityIds)
    setMemberFacilities(prev => ({ ...prev, [staffMemberId]: facilityIds }))
  }, [])

  return {
    memberFacilities,
    loading,
    error,
    setFacilities,
    reload: load,
  }
}
