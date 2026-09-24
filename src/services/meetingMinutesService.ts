import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type {
  Meeting, MeetingMinute, CreateMeetingMinuteInput,
  MeetingMinuteHistoryItem, MeetingMinuteHistoryFilters,
} from '@/lib/types'
import {
  meetingMinutesStorageService, validatePdfFile, buildMeetingMinuteStoragePath,
} from '@/services/meetingMinutesStorageService'

// 通知管理列（notified_at / notify_claimed_at）は通知API Route専用のため、クライアントでは取得しない
const MINUTE_COLUMNS = 'id, meeting_id, file_name, file_path, uploaded_at, memo' as const
type MinuteRow = Pick<
  Database['public']['Tables']['meeting_minutes']['Row'],
  'id' | 'meeting_id' | 'file_name' | 'file_path' | 'uploaded_at' | 'memo'
>

function toMeetingMinute(row: MinuteRow): MeetingMinute {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    fileName: row.file_name,
    filePath: row.file_path,
    uploadedAt: row.uploaded_at,
    memo: row.memo,
  }
}

type HistoryRow = {
  id: string
  meeting_id: string
  file_name: string
  file_path: string
  uploaded_at: string
  meetings: {
    facility_id: string
    meeting_type: 'facility' | 'kitchen'
    target_month: string
    executed_date: string | null
    facilities: { name: string } | null
  } | null
}

function toHistoryItem(row: HistoryRow): MeetingMinuteHistoryItem {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    facilityId: row.meetings?.facility_id ?? '',
    facilityName: row.meetings?.facilities?.name ?? '',
    meetingType: row.meetings?.meeting_type ?? 'facility',
    targetMonth: row.meetings?.target_month ?? '',
    executedDate: row.meetings?.executed_date ?? null,
    fileName: row.file_name,
    filePath: row.file_path,
    uploadedAt: row.uploaded_at,
  }
}

export const meetingMinutesService = {
  async getByMeetingId(meetingId: string): Promise<MeetingMinute[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_minutes')
      .select(MINUTE_COLUMNS)
      .eq('meeting_id', meetingId)
      .order('uploaded_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(row => toMeetingMinute(row as MinuteRow))
  },

  async create(input: CreateMeetingMinuteInput): Promise<MeetingMinute> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_minutes')
      .insert({
        meeting_id: input.meetingId,
        file_name: input.fileName,
        file_path: input.filePath,
        memo: input.memo ?? null,
      })
      .select(MINUTE_COLUMNS)
      .single()
    if (error || !data) throw error ?? new Error('議事録の登録に失敗しました')
    return toMeetingMinute(data as MinuteRow)
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase
      .from('meeting_minutes')
      .delete()
      .eq('id', id)
    if (error) throw error
  },

  // 議事録PDFのアップロード（Storage → メタデータ登録の順で実行し、
  // メタデータ登録が失敗した場合は直前にアップロードしたStorageファイルを
  // best-effortでrollbackする）
  //
  // 実施済(status='done')のMTのみ登録可能。ここではstatusを変更しない
  // （PDFアップロードを理由に自動でdoneへ遷移させない）
  async upload(meeting: Meeting, file: File): Promise<MeetingMinute> {
    if (meeting.status !== 'done') {
      throw new Error('先にMTを実施済みにしてください')
    }

    const validationError = validatePdfFile(file)
    if (validationError) throw new Error(validationError)

    const path = buildMeetingMinuteStoragePath(
      meeting.facilityId, meeting.meetingType, meeting.targetMonth, meeting.id
    )
    await meetingMinutesStorageService.upload(path, file)

    try {
      return await meetingMinutesService.create({
        meetingId: meeting.id,
        fileName: file.name,
        filePath: path,
      })
    } catch (err) {
      await meetingMinutesStorageService.remove(path).catch(() => {
        // rollback自体の失敗はここでは握りつぶし、元のエラーを呼び出し元に伝える
      })
      throw err
    }
  },

  // 議事録PDFの削除。Storage実ファイルを先に削除し、成功した場合のみ
  // メタデータ行を削除する（逆順にすると、DB行だけ消えてStorage上に
  // 追跡不能な孤児ファイルが残ってしまうため）。
  // Storage削除が失敗した場合はメタデータ行を残したまま例外を投げ、
  // 再削除できる状態を維持する。
  async remove(minute: MeetingMinute): Promise<void> {
    await meetingMinutesStorageService.remove(minute.filePath)
    await meetingMinutesService.delete(minute.id)
  },

  // 閲覧用URL。署名付きURLはサーバー側（/api/meeting-minutes/[id]/open）で発行してリダイレクトする。
  // スマホでもポップアップブロックされないよう、クライアントは await を挟まず通常リンクで開くこと
  getOpenUrl(minuteId: string): string {
    return `/api/meeting-minutes/${encodeURIComponent(minuteId)}/open`
  },

  // 施設ごとの議事録履歴一覧（施設・MT種別・年で絞り込み可能）
  async getHistory(filters?: MeetingMinuteHistoryFilters): Promise<MeetingMinuteHistoryItem[]> {
    const supabase = createClient()
    let query = supabase
      .from('meeting_minutes')
      .select(`
        id,
        meeting_id,
        file_name,
        file_path,
        uploaded_at,
        meetings!inner (
          facility_id,
          meeting_type,
          target_month,
          executed_date,
          facilities ( name )
        )
      `)
      .order('uploaded_at', { ascending: false })

    if (filters?.facilityId) query = query.eq('meetings.facility_id', filters.facilityId)
    if (filters?.meetingType) query = query.eq('meetings.meeting_type', filters.meetingType)
    if (filters?.year !== undefined) {
      query = query
        .gte('meetings.target_month', `${filters.year}-01-01`)
        .lt('meetings.target_month', `${filters.year + 1}-01-01`)
    }

    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(row => toHistoryItem(row as unknown as HistoryRow))
  },
}
