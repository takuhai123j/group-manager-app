'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { staffMemberService } from '@/services/staffMemberService'
import type { StaffMember, StaffMemberInput, StaffRole } from '@/lib/types'

export function useStaffMembers(role: StaffRole) {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await staffMemberService.getByRole(role)
      setMembers(data)
    } catch {
      setError('スタッフデータの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => { load() }, [load])

  const activeMembers = useMemo(
    () => members.filter(m => m.active),
    [members]
  )

  const addMember = useCallback(async (input: StaffMemberInput): Promise<string | false> => {
    const trimmed = input.name.trim()
    if (!trimmed) return false
    if (members.some(m => m.name === trimmed)) return false
    try {
      const created = await staffMemberService.add(role, input)
      setMembers(prev => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder))
      return created.id
    } catch {
      return false
    }
  }, [members, role])

  const updateMember = useCallback(async (id: string, input: StaffMemberInput): Promise<void> => {
    try {
      const updated = await staffMemberService.update(id, input)
      setMembers(prev => prev.map(m => m.id === id ? updated : m))
    } catch {
      setError('スタッフの更新に失敗しました')
    }
  }, [])

  const toggleActive = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await staffMemberService.toggleActive(id)
      setMembers(prev => prev.map(m => m.id === id ? updated : m))
    } catch {
      setError('スタッフの状態変更に失敗しました')
    }
  }, [])

  const moveUp = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await staffMemberService.moveUp(id, role)
      setMembers(updated)
    } catch {
      setError('スタッフの並び替えに失敗しました')
    }
  }, [role])

  const moveDown = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await staffMemberService.moveDown(id, role)
      setMembers(updated)
    } catch {
      setError('スタッフの並び替えに失敗しました')
    }
  }, [role])

  return {
    members,
    activeMembers,
    loading,
    error,
    addMember,
    updateMember,
    toggleActive,
    moveUp,
    moveDown,
    reload: load,
  }
}
