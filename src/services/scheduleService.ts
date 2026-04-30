import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type { ScheduleEvent, CreateEventInput, UpdateEventInput, EventType } from '@/lib/types'

// JOIN を含む SELECT フィールド定義
const SELECT_WITH_JOINS = `
  id,
  group_manager_id,
  facility_id,
  title,
  date,
  start_time,
  end_time,
  type,
  is_all_day,
  memo,
  created_at,
  updated_at,
  group_managers ( name ),
  facilities ( name )
` as const

// Supabase の JOIN レスポンス型
type ScheduleRow = {
  id: string
  group_manager_id: string
  facility_id: string | null
  title: string
  date: string
  start_time: string
  end_time: string
  type: string
  is_all_day: boolean
  memo: string
  created_at: string
  updated_at: string
  group_managers: { name: string } | null
  facilities: { name: string } | null
}

function toScheduleEvent(row: ScheduleRow): ScheduleEvent {
  return {
    id: row.id ?? '',
    title: row.title ?? '',
    date: row.date ?? '',
    startTime: row.start_time ?? '00:00',
    endTime: row.end_time ?? '00:00',
    facilityId: row.facility_id ?? null,
    facilityName: row.facilities?.name ?? '',
    type: (row.type as EventType) ?? 'other',
    isAllDay: row.is_all_day ?? false,
    memo: row.memo ?? '',
    groupLeaderId: row.group_manager_id ?? '',
    groupLeaderName: row.group_managers?.name ?? '',
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

export const scheduleService = {
  async getAll(): Promise<ScheduleEvent[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('schedules')
      .select(SELECT_WITH_JOINS)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
    if (error) throw error
    return (data ?? []).map(row => toScheduleEvent(row as unknown as ScheduleRow))
  },

  async create(input: CreateEventInput): Promise<ScheduleEvent> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('schedules')
      .insert({
        group_manager_id: input.groupLeaderId,
        facility_id: input.isAllDay ? null : input.facilityId,
        title: input.title,
        date: input.date,
        start_time: input.isAllDay ? '00:00' : input.startTime,
        end_time: input.isAllDay ? '00:00' : input.endTime,
        type: input.type,
        is_all_day: input.isAllDay,
        memo: input.memo,
      })
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('予定の作成に失敗しました')
    return toScheduleEvent(data as unknown as ScheduleRow)
  },

  async update(id: string, input: UpdateEventInput): Promise<ScheduleEvent> {
    const supabase = createClient()
    const patch: Database['public']['Tables']['schedules']['Update'] = {}
    const allDay = input.isAllDay ?? false
    if (input.title !== undefined)        patch.title            = input.title
    if (input.date !== undefined)         patch.date             = input.date
    if (input.startTime !== undefined)    patch.start_time       = allDay ? '00:00' : input.startTime
    if (input.endTime !== undefined)      patch.end_time         = allDay ? '00:00' : input.endTime
    if (input.facilityId !== undefined)   patch.facility_id      = allDay ? null : input.facilityId
    if (input.type !== undefined)         patch.type             = input.type
    if (input.isAllDay !== undefined)     patch.is_all_day       = input.isAllDay
    if (input.memo !== undefined)         patch.memo             = input.memo
    if (input.groupLeaderId !== undefined) patch.group_manager_id = input.groupLeaderId

    const { data, error } = await supabase
      .from('schedules')
      .update(patch)
      .eq('id', id)
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('予定の更新に失敗しました')
    return toScheduleEvent(data as unknown as ScheduleRow)
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase
      .from('schedules')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
