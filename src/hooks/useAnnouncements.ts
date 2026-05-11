'use client'

import { useState, useEffect, useCallback } from 'react'
import { announcementService } from '@/services/announcementService'
import type { Announcement, CreateAnnouncementInput, UpdateAnnouncementInput } from '@/lib/types'

export function useAnnouncements(adminMode = false) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = adminMode
        ? await announcementService.getAll()
        : await announcementService.getActive()
      setAnnouncements(data)
    } catch {
      setError('お知らせの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [adminMode])

  useEffect(() => { load() }, [load])

  const addAnnouncement = useCallback(async (input: CreateAnnouncementInput): Promise<Announcement> => {
    const created = await announcementService.create(input)
    setAnnouncements(prev => [created, ...prev])
    return created
  }, [])

  const updateAnnouncement = useCallback(async (id: string, input: UpdateAnnouncementInput): Promise<Announcement> => {
    const updated = await announcementService.update(id, input)
    setAnnouncements(prev => prev.map(a => a.id === id ? updated : a))
    return updated
  }, [])

  const deleteAnnouncement = useCallback(async (id: string): Promise<void> => {
    await announcementService.delete(id)
    setAnnouncements(prev => prev.filter(a => a.id !== id))
  }, [])

  return {
    announcements,
    loading,
    error,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    reload: load,
  }
}
