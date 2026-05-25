'use client'

import { useState, useCallback, useEffect } from 'react'
import { shiftFileService } from '@/services/shiftFileService'
import type { ShiftFile, CreateShiftFileInput } from '@/lib/types'

export function useShiftFiles() {
  const [files, setFiles] = useState<ShiftFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await shiftFileService.getAll()
      setFiles(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ファイルの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const upload = useCallback(async (file: File, input: CreateShiftFileInput): Promise<void> => {
    const newFile = await shiftFileService.upload(file, input)
    setFiles(prev => [newFile, ...prev])
  }, [])

  const remove = useCallback(async (id: string, filePath: string): Promise<void> => {
    await shiftFileService.delete(id, filePath)
    setFiles(prev => prev.filter(f => f.id !== id))
  }, [])

  return { files, loading, error, reload: load, upload, remove }
}
