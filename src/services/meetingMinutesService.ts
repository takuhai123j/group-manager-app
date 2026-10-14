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

// 紐付け数（meeting_minute_links の件数）が2以上なら同時開催などで共有中のPDF
function toMeetingMinute(row: MinuteRow, linkCount = 1): MeetingMinute {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    fileName: row.file_name,
    filePath: row.file_path,
    uploadedAt: row.uploaded_at,
    memo: row.memo,
    isShared: linkCount > 1,
  }
}

type LinkedMinuteRow = MinuteRow & { meeting_minute_links: { count: number }[] | null }

type HistoryMeeting = {
  id: string
  facility_id: string
  meeting_type: 'facility' | 'kitchen'
  target_month: string
  executed_date: string | null
  facilities: { name: string } | null
}

type HistoryLinkRow = {
  minute_id: string
  meetings: HistoryMeeting | null
  meeting_minutes: { id: string; meeting_id: string; file_name: string; file_path: string; uploaded_at: string } | null
}

const MEETING_TYPE_SORT: Record<'facility' | 'kitchen', number> = { facility: 0, kitchen: 1 }

// PDF 1件分のリンク行（紐付いている全MT）から履歴の1行を組み立てる。
// 施設・計画月・実施日は所有者（アップロード元）MTを基準にする
function toHistoryItem(links: HistoryLinkRow[]): MeetingMinuteHistoryItem {
  const minute = links[0].meeting_minutes!
  const meetings = links.map(l => l.meetings).filter((m): m is HistoryMeeting => m !== null)
  const owner = meetings.find(m => m.id === minute.meeting_id) ?? meetings[0]
  const meetingTypes = Array.from(new Set(meetings.map(m => m.meeting_type)))
    .sort((a, b) => MEETING_TYPE_SORT[a] - MEETING_TYPE_SORT[b])
  return {
    id: minute.id,
    meetingId: minute.meeting_id,
    facilityId: owner?.facility_id ?? '',
    facilityName: owner?.facilities?.name ?? '',
    meetingType: owner?.meeting_type ?? 'facility',
    targetMonth: owner?.target_month ?? '',
    executedDate: owner?.executed_date ?? null,
    fileName: minute.file_name,
    filePath: minute.file_path,
    uploadedAt: minute.uploaded_at,
    meetingTypes,
    isShared: meetings.length > 1,
  }
}

export const meetingMinutesService = {
  // このMTに紐付く議事録（同時開催で共有しているPDFを含む）。新しい順
  async getByMeetingId(meetingId: string): Promise<MeetingMinute[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_minute_links')
      .select(`meeting_minutes!inner ( ${MINUTE_COLUMNS}, meeting_minute_links ( count ) )`)
      .eq('meeting_id', meetingId)
    if (error) throw error
    return (data ?? [])
      .map(row => (row as unknown as { meeting_minutes: LinkedMinuteRow }).meeting_minutes)
      .map(m => toMeetingMinute(m, m.meeting_minute_links?.[0]?.count ?? 1))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
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
      const created = await meetingMinutesService.create({
        meetingId: meeting.id,
        fileName: file.name,
        filePath: path,
      })
      // 同時開催中は、DBトリガーが相手のMTにも自動でリンクする（1つのPDFを共有する）
      return { ...created, isShared: meeting.jointGroupId !== null }
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
  // 共有中のPDF（minute.isShared）は、紐付いている全てのMTから消える（リンクはCASCADEで削除）。
  // 画面側で「両方のMTから削除されます」と確認してから呼ぶこと
  async remove(minute: MeetingMinute): Promise<void> {
    await meetingMinutesStorageService.remove(minute.filePath)
    await meetingMinutesService.delete(minute.id)
  },

  // 閲覧用URL。署名付きURLはサーバー側（/api/meeting-minutes/[id]/open）で発行してリダイレクトする。
  // スマホでもポップアップブロックされないよう、クライアントは await を挟まず通常リンクで開くこと
  getOpenUrl(minuteId: string): string {
    return `/api/meeting-minutes/${encodeURIComponent(minuteId)}/open`
  },

  // 施設ごとの議事録履歴一覧（施設・MT種別・年で絞り込み可能。PDF 1件 = 1行、新しい順）
  // 絞り込みは紐付いているMTのどれか1件が条件に合えば対象にする
  // （同時開催の共有PDFは、施設MT・厨房内MTのどちらで絞り込んでも表示される）
  async getHistory(filters?: MeetingMinuteHistoryFilters): Promise<MeetingMinuteHistoryItem[]> {
    const supabase = createClient()

    // 1) 条件に合うMTに紐付いている議事録IDを集める
    let matchQuery = supabase
      .from('meeting_minute_links')
      .select('minute_id, meetings!inner ( facility_id, meeting_type, target_month )')
    if (filters?.facilityId) matchQuery = matchQuery.eq('meetings.facility_id', filters.facilityId)
    if (filters?.meetingType) matchQuery = matchQuery.eq('meetings.meeting_type', filters.meetingType)
    if (filters?.year !== undefined) {
      matchQuery = matchQuery
        .gte('meetings.target_month', `${filters.year}-01-01`)
        .lt('meetings.target_month', `${filters.year + 1}-01-01`)
    }
    const { data: matched, error: matchError } = await matchQuery
    if (matchError) throw matchError
    const minuteIds = Array.from(new Set((matched ?? []).map(r => r.minute_id)))
    if (minuteIds.length === 0) return []

    // 2) それらの議事録に紐付く全MTを取得し、PDFごとにまとめる（共有先の種別も表示するため）
    const { data, error } = await supabase
      .from('meeting_minute_links')
      .select(`
        minute_id,
        meetings!inner ( id, facility_id, meeting_type, target_month, executed_date, facilities ( name ) ),
        meeting_minutes!inner ( id, meeting_id, file_name, file_path, uploaded_at )
      `)
      .in('minute_id', minuteIds)
    if (error) throw error

    const byMinute = new Map<string, HistoryLinkRow[]>()
    for (const row of (data ?? []) as unknown as HistoryLinkRow[]) {
      const list = byMinute.get(row.minute_id) ?? []
      list.push(row)
      byMinute.set(row.minute_id, list)
    }
    return Array.from(byMinute.values())
      .map(toHistoryItem)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  },
}
