'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { groupManagerService } from '@/services/groupManagerService'
import type { GroupManager } from '@/lib/types'

type ManagerInput = { name: string; color: string; memo: string }

export function useGroupManagers() {
  const [managers, setManagers] = useState<GroupManager[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await groupManagerService.getAll()
      setManagers(data)
    } catch {
      setError('G長データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const activeManagers = useMemo(
    () => managers.filter(m => m.active),
    [managers]
  )

  const addManager = useCallback(async (input: ManagerInput): Promise<boolean> => {
    const trimmed = input.name.trim()
    if (!trimmed) return false
    if (managers.some(m => m.name === trimmed)) return false
    try {
      const created = await groupManagerService.add(input)
      setManagers(prev => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder))
      return true
    } catch {
      return false
    }
  }, [managers])

  const updateManager = useCallback(async (id: string, input: ManagerInput): Promise<void> => {
    try {
      const updated = await groupManagerService.update(id, input)
      setManagers(prev => prev.map(m => m.id === id ? updated : m))
    } catch {
      setError('G長の更新に失敗しました')
    }
  }, [])

  const toggleActive = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await groupManagerService.toggleActive(id)
      setManagers(prev => prev.map(m => m.id === id ? updated : m))
    } catch {
      setError('G長の状態変更に失敗しました')
    }
  }, [])

  const moveUp = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await groupManagerService.moveUp(id)
      setManagers(updated)
    } catch {
      setError('G長の並び替えに失敗しました')
    }
  }, [])

  const moveDown = useCallback(async (id: string): Promise<void> => {
    try {
      const updated = await groupManagerService.moveDown(id)
      setManagers(updated)
    } catch {
      setError('G長の並び替えに失敗しました')
    }
  }, [])

  const getManager = useCallback(
    (id: string): GroupManager | null => managers.find(m => m.id === id) ?? null,
    [managers]
  )

  return {
    managers,
    activeManagers,
    loading,
    error,
    addManager,
    updateManager,
    toggleActive,
    moveUp,
    moveDown,
    getManager,
    reload: load,
  }
}
