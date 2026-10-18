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

// 記録の取得クエリ（select の後に条件・並び順を足していく）の型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordsQuery = any

// 1回の取得上限（Supabase の max-rows。既定1000）を超えても取りこぼさないよう、空のページが返るまで続けて読む。
// 上限が1000より小さく設定されていても、返ってきた件数だけ進めるので取りこぼさない
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    if (error) throw error
    const page = data ?? []
    if (page.length === 0) break
    all.push(...page)
    from += page.length
  }
  return all
}

// 一覧の並び順（対象日の新しい順 → 登録の新しい順 → id）
function compareRecordRows(a: ParentRow, b: ParentRow): number {
  if (a.target_date !== b.target_date) return a.target_date < b.target_date ? 1 : -1
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
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
    replacementCalendarTarget: row.replacement_calendar_group_manager_id
      ? { type: 'group_manager', id: row.replacement_calendar_group_manager_id }
      : row.replacement_calendar_staff_member_id
        ? { type: 'staff_member', id: row.replacement_calendar_staff_member_id }
        : null,
    replacementStartTime: row.replacement_start_time ?? null,
    replacementEndTime: row.replacement_end_time ?? null,
    chainPosition: row.chain_position ?? null,
    workFacilityId: row.work_facility_id ?? null,
  }
}

// RPC（shift_change_save_batch）に渡す1件分。反映先がない明細は時刻も送らない（時刻はカレンダー用のため）。
// 変更後担当の反映先は、変更後担当の名前がある明細だけ送る
function toRpcRecord(id: string, mode: 'create' | 'update', input: CreateShiftChangeInput) {
  return {
    id,
    mode,
    // 応援チェーン・変更後担当のカレンダー反映を扱える画面であることの印。
    // これがない古い画面（開いたままのタブ）は、それらを持つ記録を上書きできない（RPC が SCC_STALE_CLIENT で止める）
    chain_aware: true,
    facility_id: input.facilityId,
    target_date: input.targetDate,
    reason: input.reason,
    handled_by: input.handledBy,
    memo: input.memo || '',
    related_change_group_id: input.relatedChangeGroupId ?? null,
    details: input.details.map(d => {
      const target = d.calendarTarget ?? null
      const timed = !!target && !!d.startTime && !!d.endTime
      const repTarget = d.replacementName?.trim() ? d.replacementCalendarTarget ?? null : null
      const repTimed = !!repTarget && !!d.replacementStartTime && !!d.replacementEndTime
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
        replacement_calendar_group_manager_id: repTarget?.type === 'group_manager' ? repTarget.id : null,
        replacement_calendar_staff_member_id: repTarget?.type === 'staff_member' ? repTarget.id : null,
        replacement_start_time: repTimed ? d.replacementStartTime : null,
        replacement_end_time: repTimed ? d.replacementEndTime : null,
        // 応援チェーン（チェーン外は送らない＝null）。勤務先はチェーンの明細だけ
        chain_position: d.chainPosition ?? null,
        work_facility_id: d.chainPosition != null ? d.workFacilityId ?? null : null,
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
    // 記録の取得（施設以外のサーバー側の条件と並び順をそろえる）。
    // 1回の取得には上限（Supabase は既定で1000行）があるので、fetchAllPages で全ページ読む
    const records = (from: number, to: number, narrow: (q: RecordsQuery) => RecordsQuery) => {
      let q: RecordsQuery = supabase
        .from('shift_change_records')
        .select('*, facilities(name), shift_change_details(*)')
      q = narrow(q)
      if (filters?.targetDate) q = q.eq('target_date', filters.targetDate)
      if (filters?.reason)     q = q.ilike('reason', `%${filters.reason}%`)
      if (filters?.handledBy)  q = q.ilike('handled_by', `%${filters.handledBy}%`)
      // ページをまたいでも順番がぶれないよう、最後に id でも並べる
      return q.order('target_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
    }

    let rows: ParentRow[]
    if (filters?.facilityId) {
      // 施設: 記録の施設がその施設の記録 ＋ 応援チェーンの勤務先がその施設の記録。
      // 勤務先は明細側にあるので、該当する記録IDを明細から引き、記録の施設で取った分に無いものだけ ID で取り足す
      // （ID の数が多くても URL が長くなりすぎないよう、100件ずつに分ける）
      const fid = filters.facilityId
      const own = await fetchAllPages<ParentRow>((from, to) => records(from, to, q => q.eq('facility_id', fid)))
      const chainRows = await fetchAllPages<{ record_id: string }>((from, to) =>
        supabase.from('shift_change_details').select('record_id').eq('work_facility_id', fid).order('id', { ascending: true }).range(from, to))
      const ownIds = new Set(own.map(r => r.id))
      const extraIds = Array.from(new Set(chainRows.map(r => r.record_id))).filter(id => !ownIds.has(id))
      const extra: ParentRow[] = []
      for (let i = 0; i < extraIds.length; i += 100) {
        const chunk = extraIds.slice(i, i + 100)
        extra.push(...await fetchAllPages<ParentRow>((from, to) => records(from, to, q => q.in('id', chunk))))
      }
      rows = [...own, ...extra].sort(compareRecordRows)
    } else {
      rows = await fetchAllPages<ParentRow>((from, to) => records(from, to, q => q))
    }

    let list = rows.map(row => toRecord(row))

    // 明細側絞り込み（client-side）
    if (filters?.employeeName) {
      const kw = filters.employeeName.toLowerCase()
      list = list.filter(r => r.details.some(d => d.employeeName.toLowerCase().includes(kw)))
    }
    if (filters?.changeType) {
      list = list.filter(r => r.details.some(d => d.changeType === filters.changeType))
    }
    if (filters?.isExternalSupport === 'true') {
      list = list.filter(r => r.details.some(d => d.isExternalSupport))
    }
    if (filters?.supportFacilityId) {
      list = list.filter(r => r.details.some(d => d.supportFromFacilityId === filters.supportFacilityId))
    }

    return list
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
