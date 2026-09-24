import { createClient } from '@/lib/supabase/client'
import type { MeetingType } from '@/lib/types'

// meeting-minutes バケット（private）に対する低レベルのStorage操作のみを扱う。
// meeting_minutes テーブルのメタデータ操作は meetingMinutesService 側で行う。

const BUCKET = 'meeting-minutes'

export const MAX_MEETING_MINUTE_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// PDFのみ許可。ブラウザが返す File.type は必ずしも正確ではないため、
// 拡張子チェックを主とし、MIME種別は明らかに異なる場合のみ拒否する
// （＝可能な範囲でのチェックに留め、空/不明なMIMEで誤って弾かないようにする）
export function validatePdfFile(file: File): string | null {
  const nameLower = file.name.toLowerCase()
  if (!nameLower.endsWith('.pdf')) {
    return 'PDFファイル（.pdf）のみアップロードできます'
  }
  if (file.type && file.type !== 'application/pdf') {
    return 'PDFファイル（.pdf）のみアップロードできます'
  }
  if (file.size > MAX_MEETING_MINUTE_FILE_SIZE) {
    return `ファイルサイズが上限（10MB）を超えています（${(file.size / 1024 / 1024).toFixed(1)}MB）`
  }
  return null
}

// facility_id/meeting_type/YYYY-MM/meeting_id/UUID.pdf
// 元のファイル名はStorageパスに使わず衝突を避ける（元ファイル名は meeting_minutes.file_name にのみ保存する）
export function buildMeetingMinuteStoragePath(
  facilityId: string,
  meetingType: MeetingType,
  targetMonth: string,
  meetingId: string
): string {
  const yyyymm = targetMonth.slice(0, 7)
  return `${facilityId}/${meetingType}/${yyyymm}/${meetingId}/${crypto.randomUUID()}.pdf`
}

export const meetingMinutesStorageService = {
  async upload(path: string, file: File): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: 'application/pdf' })
    if (error) throw error
  },

  async remove(path: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) throw error
  },
}
