import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type { MeetingFrequency, MeetingFrequencyInput } from '@/lib/types'

type FrequencyRow = Database['public']['Tables']['meeting_frequencies']['Row']

function toMeetingFrequency(row: FrequencyRow): MeetingFrequency {
  return {
    id: row.id,
    facilityId: row.facility_id,
    meetingType: row.meeting_type,
    intervalMonths: row.interval_months,
    startMonth: row.start_month,
    active: row.active,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const meetingFrequencyService = {
  // active=false の無効化済み設定も含めて全件取得
  async getAll(): Promise<MeetingFrequency[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_frequencies')
      .select('*')
      .order('facility_id', { ascending: true })
      .order('meeting_type', { ascending: true })
    if (error) throw error
    return (data ?? []).map(row => toMeetingFrequency(row as FrequencyRow))
  },

  async getByFacility(facilityId: string): Promise<MeetingFrequency[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_frequencies')
      .select('*')
      .eq('facility_id', facilityId)
      .order('meeting_type', { ascending: true })
    if (error) throw error
    return (data ?? []).map(row => toMeetingFrequency(row as FrequencyRow))
  },

  async create(input: MeetingFrequencyInput): Promise<MeetingFrequency> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meeting_frequencies')
      .insert({
        facility_id: input.facilityId,
        meeting_type: input.meetingType,
        interval_months: input.intervalMonths,
        start_month: input.startMonth,
        memo: input.memo.trim(),
        active: true,
      })
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('MT頻度設定の作成に失敗しました')
    return toMeetingFrequency(data as FrequencyRow)
  },

  async update(id: string, input: Partial<MeetingFrequencyInput>): Promise<MeetingFrequency> {
    const supabase = createClient()
    const patch: Database['public']['Tables']['meeting_frequencies']['Update'] = {}
    if (input.intervalMonths !== undefined) patch.interval_months = input.intervalMonths
    if (input.startMonth !== undefined)     patch.start_month     = input.startMonth
    if (input.memo !== undefined)           patch.memo            = input.memo.trim()

    const { data, error } = await supabase
      .from('meeting_frequencies')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('MT頻度設定の更新に失敗しました')
    return toMeetingFrequency(data as FrequencyRow)
  },

  // 物理削除ではなく active の反転で無効化/再有効化する
  async toggleActive(id: string): Promise<MeetingFrequency> {
    const supabase = createClient()
    const { data: current, error: fetchError } = await supabase
      .from('meeting_frequencies')
      .select('active')
      .eq('id', id)
      .single()
    if (fetchError || !current) throw fetchError ?? new Error('MT頻度設定が見つかりません')

    const { data, error } = await supabase
      .from('meeting_frequencies')
      .update({ active: !current.active })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('MT頻度設定の状態変更に失敗しました')
    return toMeetingFrequency(data as FrequencyRow)
  },
}
