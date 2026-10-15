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
    originalShift: row.original_shift ?? null,
    replacementName: row.replacement_name ?? null,
    replacementOriginalShift: row.replacement_original_shift ?? null,
    compensatoryLeaveStatus: (row.compensatory_leave_status as ShiftChangeDetail['compensatoryLeaveStatus']) ?? null,
    calendarTarget: row.calendar_group_manager_id
      ? { type: 'group_manager', id: row.calendar_group_manager_id }
      : row.calendar_staff_member_id
        ? { type: 'staff_member', id: row.calendar_staff_member_id }
        : null,
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
  }
}

// RPC（shift_change_save_batch）に渡す1件分。反映先がない明細は時刻も送らない（時刻はカレンダー用のため）
function toRpcRecord(id: string, mode: 'create' | 'update', input: CreateShiftChangeInput) {
  return {
    id,
    mode,
    facility_id: input.facilityId,
    target_date: input.targetDate,
    reason: input.reason,
    handled_by: input.handledBy,
    memo: input.memo || '',
    related_change_group_id: input.relatedChangeGroupId ?? null,
    details: input.details.map(d => {
      const target = d.calendarTarget ?? null
      const timed = !!target && !!d.startTime && !!d.endTime
      return {
        employee_name: d.employeeName,
        change_type: d.changeType,
        change_detail: d.changeDetail,
        is_external_support: d.isExternalSupport,
        support_from_facility_id: d.isExternalSupport && d.supportFromFacilityId ? d.supportFromFacilityId : null,
        original_shift: d.originalShift ?? null,
        replacement_name: d.replacementName ?? null,
        replacement_original_shift: d.replacementOriginalShift ?? null,
        compensatory_leave_status: d.compensatoryLeaveStatus ?? null,
        calendar_group_manager_id: target?.type === 'group_manager' ? target.id : null,
        calendar_staff_member_id: target?.type === 'staff_member' ? target.id : null,
        start_time: timed ? d.startTime : null,
        end_time: timed ? d.endTime : null,
      }
    }),
  }
}

// RPCのエラー（'SCC_<コード>: メッセージ'）は日本語メッセージだけを画面に出す
export function shiftChangeErrorMessage(e: unknown, fallback: string): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const m = msg.match(/SCC_[A-Z_]+:\s*(.+)$/)
  return m ? m[1] : fallback
}

export type ShiftChangeSaveItem = { id: string; mode: 'create' | 'update'; input: CreateShiftChangeInput }

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
    relatedChangeGroupId: row.related_change_group_id ?? null,
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

  // 同じ振休対応グループ（related_change_group_id）に属するレコード一覧（対象日順）
  async getByGroupId(groupId: string): Promise<ShiftChangeRecord[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shift_change_records')
      .select('*, facilities(name), shift_change_details(*)')
      .eq('related_change_group_id', groupId)
      .order('target_date', { ascending: true })
    if (error) throw error
    return (data ?? []).map(row => toRecord(row as ParentRow))
  },

  // 代替出勤者の対象者明細に「振休日を設定済み」を反映する（振休レコードを後から作成した際に呼ぶ）
  async setDetailCompensatoryLeaveLinked(detailId: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase
      .from('shift_change_details')
      .update({ compensatory_leave_status: 'linked' })
      .eq('id', detailId)
    if (error) throw error
  },

  // 保存（新規・編集・期間/複数日の一括）。シフト変更本体・明細・自動生成予定を1トランザクションで保存する。
  // 新規のIDは画面側で発行して渡すため、応答が失われて再試行しても二重登録にならない
  async saveBatch(items: ShiftChangeSaveItem[]): Promise<ShiftChangeRecord[]> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('shift_change_save_batch', {
      p_records: items.map(it => toRpcRecord(it.id, it.mode, it.input)),
    })
    if (error) throw error
    const ids = (data as string[] | null) ?? items.map(it => it.id)

    const { data: rows, error: fetchError } = await supabase
      .from('shift_change_records')
      .select('*, facilities(name), shift_change_details(*)')
      .in('id', ids)
    if (fetchError) throw fetchError
    const byId = new Map((rows ?? []).map(row => [row.id, toRecord(row as ParentRow)]))
    return ids.map(id => byId.get(id)).filter((r): r is ShiftChangeRecord => !!r)
  },

  async create(input: CreateShiftChangeInput): Promise<ShiftChangeRecord> {
    const [saved] = await this.saveBatch([{ id: input.id ?? crypto.randomUUID(), mode: 'create', input }])
    if (!saved) throw new Error('保存したシフト変更を読み込めませんでした')
    return saved
  },

  async update(id: string, input: CreateShiftChangeInput): Promise<ShiftChangeRecord> {
    const [saved] = await this.saveBatch([{ id, mode: 'update', input }])
    if (!saved) throw new Error('保存したシフト変更を読み込めませんでした')
    return saved
  },

  async delete(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase.from('shift_change_records').delete().eq('id', id)
    if (error) throw error
  },
}
