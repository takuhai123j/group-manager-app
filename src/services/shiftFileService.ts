import { createClient } from '@/lib/supabase/client'
import type { ShiftFile, CreateShiftFileInput, ShiftFileType } from '@/lib/types'

const BUCKET = 'shift-files'

type ShiftFileRow = {
  id: string
  file_type: string
  facility_id: string | null
  target_month: string
  file_name: string
  file_path: string
  memo: string | null
  created_at: string
  facilities: { name: string } | null
}

function toShiftFile(row: ShiftFileRow): ShiftFile {
  return {
    id: row.id,
    fileType: row.file_type as ShiftFileType,
    facilityId: row.facility_id,
    facilityName: row.facilities?.name ?? null,
    targetMonth: row.target_month,
    fileName: row.file_name,
    filePath: row.file_path,
    memo: row.memo ?? '',
    createdAt: row.created_at,
  }
}

export const shiftFileService = {
  async getAll(): Promise<ShiftFile[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shift_files')
      .select('*, facilities(name)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(r => toShiftFile(r as ShiftFileRow))
  },

  async upload(file: File, input: CreateShiftFileInput): Promise<ShiftFile> {
    const supabase = createClient()
    const filePath = `${input.targetMonth}/${Date.now()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { upsert: false })
    if (uploadError) throw uploadError

    const { data, error } = await supabase
      .from('shift_files')
      .insert({
        file_type: input.fileType,
        facility_id: input.facilityId,
        target_month: input.targetMonth,
        file_name: file.name,
        file_path: filePath,
        memo: input.memo,
      })
      .select('*, facilities(name)')
      .single()

    if (error || !data) {
      await supabase.storage.from(BUCKET).remove([filePath])
      throw error ?? new Error('ファイル情報の保存に失敗しました')
    }
    return toShiftFile(data as ShiftFileRow)
  },

  getPublicUrl(filePath: string): string {
    const supabase = createClient()
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath)
    return data.publicUrl
  },

  async download(filePath: string, fileName: string): Promise<void> {
    const supabase = createClient()
    const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
    if (error) throw error
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  async delete(id: string, filePath: string): Promise<void> {
    const supabase = createClient()
    await supabase.storage.from(BUCKET).remove([filePath])
    const { error } = await supabase.from('shift_files').delete().eq('id', id)
    if (error) throw error
  },
}
