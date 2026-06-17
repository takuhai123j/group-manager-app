import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type {
  ShiftChangeRecord, ShiftChangeDetail,
  CreateShiftChangeInput, ShiftChangeFilters,
} from '@/lib/types'

type DetailRow = Database['public']['Tables']['shift_change_details']['Row']
type ParentRow = Database['public']['Tables']['shift_change_records']['Row'] & {
  facilities: { name: string } | null
  shift_change_details: DetailRow[] | null
}

function toDetail(row: DetailRow): ShiftChangeDetail {
  return {
    id: row.id,
    recordId: row.record_id,
    employeeName: row.employee_name,
    changeType: row.change_type as ShiftChangeDetail['changeType'],
    changeDetail: row.change_detail,
    isExternalSupport: row.is_external_support ?? false,
    supportFromFacilityId: row.support_from_facility_id ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function toRecord(row: ParentRow): ShiftChangeRecord {
  const details = (row.shift_change_details ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toDetail)
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facilities?.name ?? '',
    targetDate: row.target_date,
    reason: row.reason,
    handledBy: row.handled_by,
    memo: row.memo ?? '',
    details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const shiftChangeService = {
  async getAll(filters?: Partial<ShiftChangeFilters>): Promise<ShiftChangeRecord[]> {
    const supabase = createClient()
    let query = supabase
      .from('shift_change_records')
      .select('*, facilities(name), shift_change_details(*)')
      .order('target_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filters?.facilityId) query = query.eq('facility_id', filters.facilityId)
    if (filters?.targetDate)  query = query.eq('target_date', filters.targetDate)
    if (filters?.reason)      query = query.ilike('reason', `%${filters.reason}%`)
    if (filters?.handledBy)   query = query.ilike('handled_by', `%${filters.handledBy}%`)

    const { data, error } = await query
    if (error) throw error

    let records = (data ?? []).map(row => toRecord(row as ParentRow))

    // 明細側絞り込み（client-side）
    if (filters?.employeeName) {
      const kw = filters.employeeName.toLowerCase()
      records = records.filter(r => r.details.some(d => d.employeeName.toLowerCase().includes(kw)))
    }
    if (filters?.changeType) {
      records = records.filter(r => r.details.some(d => d.changeType === filters.changeType))
    }
    if (filters?.isExternalSupport === 'true') {
      records = records.filter(r => r.details.some(d => d.isExternalSupport))
    }
    if (filters?.supportFacilityId) {
      records = records.filter(r => r.details.some(d => d.supportFromFacilityId === filters.supportFacilityId))
    }

    return records
  },

  async getById(id: string): Promise<ShiftChangeRecord> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shift_change_records')
      .select('*, facilities(name), shift_change_details(*)')
      .eq('id', id)
      .single()
    if (error || !data) throw error ?? new Error('レコードが見つかりません')
    return toRecord(data as ParentRow)
  },

  async create(input: CreateShiftChangeInput): Promise<ShiftChangeRecord> {
    const supabase = createClient()

    const { data: parent, error: parentError } = await supabase
      .from('shift_change_records')
      .insert({
        facility_id: input.facilityId,
        target_date: input.targetDate,
        reason: input.reason,
        handled_by: input.handledBy,
        memo: input.memo || null,
      })
      .select('id')
      .single()
    if (parentError || !parent) throw parentError ?? new Error('親レコードの作成に失敗しました')

    const detailRows = input.details.map((d, i) => ({
      record_id: parent.id,
      employee_name: d.employeeName,
      change_type: d.changeType,
      change_detail: d.changeDetail,
      is_external_support: d.isExternalSupport,
      support_from_facility_id: d.isExternalSupport && d.supportFromFacilityId ? d.supportFromFacilityId : null,
      sort_order: i,
    }))
    const { error: detailError } = await supabase.from('shift_change_details').insert(detailRows)
    if (detailError) throw detailError

    return this.getById(parent.id)
  },

  async update(id: string, input: CreateShiftChangeInput): Promise<ShiftChangeRecord> {
    const supabase = createClient()

    const patch: Database['public']['Tables']['shift_change_records']['Update'] = {
      facility_id: input.facilityId,
      target_date: input.targetDate,
      reason: input.reason,
      handled_by: input.handledBy,
      memo: input.memo || null,
    }
    const { error: updateError } = await supabase
      .from('shift_change_records').update(patch).eq('id', id)
    if (updateError) throw updateError

    const { error: deleteError } = await supabase
      .from('shift_change_details').delete().eq('record_id', id)
    if (deleteError) throw deleteError

    const detailRows = input.details.map((d, i) => ({
      record_id: id,
      employee_name: d.employeeName,
      change_type: d.changeType,
      change_detail: d.changeDetail,
      is_external_support: d.isExternalSupport,
      support_from_facility_id: d.isExternalSupport && d.supportFromFacilityId ? d.supportFromFacilityId : null,
      sort_order: i,
    }))
    const { error: insertError } = await supabase.from('shift_change_details').insert(detailRows)
    if (insertError) throw insertError

    return this.getById(id)
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('shift_change_records').delete().eq('id', id)
    if (error) throw error
  },
}
