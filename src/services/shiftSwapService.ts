import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type {
  ShiftSwap, ShiftSwapDay, ShiftSwapInput, ShiftSwapNotifyResult, ShiftSwapNotifyStatus, ShiftSwapOperation,
} from '@/lib/types'

// 勤務・休日振替（振替出勤・振替休日）の読み込み・保存・取消。
// 保存・取消は DB の関数（shift_change_swap_save / shift_change_swap_delete）だけで行い、2日分・自動予定・公休の非表示をまとめて処理する。
// updated_at は DB の値（マイクロ秒まで）を文字列のまま持ち、編集・取消のときにそのまま送り返す（Date に変換すると一致しなくなる）
// 登録・変更・取消は1回ごとに操作IDを付ける（画面が発行。応答が失われて送り直すときは同じ操作IDを使う）。
// 本部への通知は操作IDだけを通知 API に渡し、文面はサーバーが DB の操作の記録から作る

type SwapRow = Database['public']['Tables']['shift_change_swaps']['Row']
type DetailRow = Database['public']['Tables']['shift_change_details']['Row']
type RecordRow = Database['public']['Tables']['shift_change_records']['Row'] & {
  facilities: { name: string } | null
  shift_change_details: DetailRow[] | null
}

// 保存・取消のエラーを画面用の日本語にする（'SCC_<コード>: メッセージ' は日本語部分、同時登録の競合は制約名から）
export function shiftSwapErrorMessage(e: unknown, fallback: string): string {
  const msg = (e as { message?: string } | null)?.message ?? ''
  const m = msg.match(/SCC_[A-Z_]+:\s*(.+)$/)
  if (m) return m[1]
  if (msg.includes('shift_change_records_swap_person_date_excl')) return '同じ人の同じ日付に、別の勤務・休日振替が登録されています'
  return fallback
}

// エラーのコード（'SCC_NOT_FOUND' など）。DB の関数が返したエラーでなければ null（通信が切れた・応答が失われた等）
export function shiftSwapErrorCode(e: unknown): string | null {
  const msg = (e as { message?: string } | null)?.message ?? ''
  return msg.match(/(SCC_[A-Z_]+):/)?.[1] ?? null
}

function toDay(row: RecordRow | undefined): ShiftSwapDay {
  const d = row?.shift_change_details?.[0]
  return {
    recordId: row?.id ?? '',
    date: row?.target_date ?? '',
    facilityId: row?.facility_id ?? null,
    facilityName: row?.facilities?.name ?? '',
    originalShift: d?.original_shift ?? '',
    changeDetail: d?.change_detail ?? '',
  }
}

function toSwap(swap: SwapRow, records: RecordRow[], hiddenIds: string[]): ShiftSwap {
  const work = records.find(r => r.swap_role === 'work')
  const off = records.find(r => r.swap_role === 'off')
  const base = work ?? off
  return {
    id: swap.id,
    person: swap.person_group_manager_id
      ? { type: 'group_manager', id: swap.person_group_manager_id }
      : { type: 'staff_member', id: swap.person_staff_member_id ?? swap.person_key },
    personName: base?.shift_change_details?.[0]?.employee_name ?? '',
    showOnCalendar: swap.show_on_calendar,
    workContent: swap.work_content ?? '',
    reason: base?.reason ?? '',
    handledBy: base?.handled_by ?? '',
    memo: base?.memo ?? '',
    work: toDay(work),
    off: toDay(off),
    hiddenScheduleIds: [...hiddenIds].sort(),
    createdAt: swap.created_at,
    updatedAt: swap.updated_at,
  }
}

type OperationRow = Database['public']['Tables']['shift_change_swap_operations']['Row']
// 操作の記録で読める列（内容・確保の印は読めない）
const OPERATION_COLUMNS = 'id, swap_id, action, person_name, work_date, off_date, created_at, notify_status, notify_attempts, notify_claimed_at, notify_sent_at, notify_last_error, notify_manually_confirmed'

function toOperation(r: OperationRow): ShiftSwapOperation {
  return {
    id: r.id, swapId: r.swap_id, action: r.action, personName: r.person_name, workDate: r.work_date, offDate: r.off_date,
    createdAt: r.created_at, notifyStatus: r.notify_status, notifyAttempts: r.notify_attempts,
    notifyClaimedAt: r.notify_claimed_at, notifySentAt: r.notify_sent_at, notifyLastError: r.notify_last_error,
    notifyManuallyConfirmed: r.notify_manually_confirmed,
  }
}

const NOTIFY_STATUSES: ShiftSwapNotifyStatus[] = ['pending', 'sending', 'sent', 'failed', 'unknown', 'needs_check']

function toRpcInput(input: ShiftSwapInput) {
  const day = (d: ShiftSwapInput['work']) => ({
    date: d.date,
    facility_id: d.facilityId || null,
    original_shift: d.originalShift,
    change_detail: d.changeDetail,
  })
  return {
    id: input.id,
    mode: input.mode,
    expected_updated_at: input.mode === 'update' ? input.expectedUpdatedAt ?? null : null,
    person: { type: input.person.type, id: input.person.id },
    show_on_calendar: input.showOnCalendar,
    work_content: input.workContent,
    reason: input.reason,
    handled_by: input.handledBy,
    memo: input.memo,
    work: day(input.work),
    off: day(input.off),
    hidden_schedule_ids: input.hiddenScheduleIds,
  }
}

// カレンダーで公休を隠すための情報（どの予定を・誰の・どの日付なら隠すか）
export type HiddenScheduleRule = { scheduleId: string; personKey: string; workDate: string }

export const shiftSwapService = {
  async getById(id: string): Promise<ShiftSwap> {
    const supabase = createClient()
    const [swapRes, recRes, hidRes] = await Promise.all([
      supabase.from('shift_change_swaps').select('*').eq('id', id).maybeSingle(),
      supabase.from('shift_change_records').select('*, facilities(name), shift_change_details(*)').eq('swap_id', id),
      supabase.from('shift_change_swap_hidden_schedules').select('schedule_id').eq('swap_id', id),
    ])
    if (swapRes.error) throw swapRes.error
    if (recRes.error) throw recRes.error
    if (hidRes.error) throw hidRes.error
    if (!swapRes.data) throw new Error('振替が見つかりません（他の端末で取り消された可能性があります）')
    return toSwap(
      swapRes.data as SwapRow,
      (recRes.data ?? []) as unknown as RecordRow[],
      (hidRes.data ?? []).map(h => (h as { schedule_id: string }).schedule_id),
    )
  },

  // 保存（新規・編集）。operationId は1回の操作ごとに画面が発行し、送り直すときは同じものを使う。
  // 保存後は保存した内容を読み直して返す
  async save(input: ShiftSwapInput, operationId: string): Promise<{ swap: ShiftSwap; operationId: string }> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('shift_change_swap_save', { p_swap: { ...toRpcInput(input), operation_id: operationId } })
    if (error) throw error
    const id = (data as { id?: string } | null)?.id ?? input.id
    return { swap: await this.getById(id), operationId: (data as { operation_id?: string } | null)?.operation_id ?? operationId }
  },

  // 取消（2日分まとめて）。operationId は1回の取消ごとに画面が発行し、送り直すときは同じものを使う
  async remove(id: string, expectedUpdatedAt: string, operationId: string): Promise<{ operationId: string }> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('shift_change_swap_delete', {
      p_swap_id: id, p_expected_updated_at: expectedUpdatedAt, p_operation_id: operationId,
    })
    if (error) throw error
    return { operationId: (data as { operation_id?: string } | null)?.operation_id ?? operationId }
  },

  // 本部への通知を送る（操作IDだけを渡す。送信済みなら送らない）。通信できなかった場合は 'error'
  async notify(operationId: string): Promise<ShiftSwapNotifyResult> {
    try {
      const res = await fetch('/api/shift-swap-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operationId }),
      })
      const body = await res.json().catch(() => null) as { status?: string } | null
      const st = body?.status as ShiftSwapNotifyStatus | undefined
      return st && NOTIFY_STATUSES.includes(st) ? st : 'error'
    } catch {
      return 'error'
    }
  },

  // 「要確認」の片付け（届いていた／送り直す）は、本部で受信を確認する管理操作のため画面からは行わない
  // （本部管理者が Supabase Dashboard で supabase/admin/shift_swap_notify_resolve.sql の手順で行う）

  // 本部への通知が済んでいない操作（送信済み以外。取消済みの振替の分も含む。古い順）
  async getUnsentOperations(): Promise<ShiftSwapOperation[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('shift_change_swap_operations')
      .select(OPERATION_COLUMNS)
      .neq('notify_status', 'sent')
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) throw error
    return ((data ?? []) as unknown as OperationRow[]).map(toOperation)
  },

  // 指定の振替の、最新の操作（一覧のカードに通知の状態を出す）
  async getLatestOperations(swapIds: string[]): Promise<Map<string, ShiftSwapOperation>> {
    const out = new Map<string, ShiftSwapOperation>()
    if (swapIds.length === 0) return out
    const supabase = createClient()
    for (let i = 0; i < swapIds.length; i += 100) {
      const { data, error } = await supabase
        .from('shift_change_swap_operations')
        .select(OPERATION_COLUMNS)
        .in('swap_id', swapIds.slice(i, i + 100))
        .order('created_at', { ascending: false })
      if (error) throw error
      for (const r of (data ?? []) as unknown as OperationRow[]) if (!out.has(r.swap_id)) out.set(r.swap_id, toOperation(r))
    }
    return out
  },

  // カレンダーで隠す公休（振替出勤日・本人・紐付け済みのものだけ）。
  // 予定側が後から別の日・別の人に変えられた場合は隠さない（判定は呼び出し側で予定の日付・担当と比べる）
  async getHiddenScheduleRules(): Promise<HiddenScheduleRule[]> {
    const supabase = createClient()
    const { data: links, error } = await supabase.from('shift_change_swap_hidden_schedules').select('schedule_id, swap_id')
    if (error) throw error
    const rows = (links ?? []) as { schedule_id: string; swap_id: string }[]
    if (rows.length === 0) return []
    const swapIds = Array.from(new Set(rows.map(r => r.swap_id)))
    const rules: HiddenScheduleRule[] = []
    for (let i = 0; i < swapIds.length; i += 100) {
      const chunk = swapIds.slice(i, i + 100)
      const [swapRes, recRes] = await Promise.all([
        supabase.from('shift_change_swaps').select('id, person_key, show_on_calendar').in('id', chunk),
        supabase.from('shift_change_records').select('swap_id, target_date').eq('swap_role', 'work').in('swap_id', chunk),
      ])
      if (swapRes.error) throw swapRes.error
      if (recRes.error) throw recRes.error
      const person = new Map(((swapRes.data ?? []) as { id: string; person_key: string; show_on_calendar: boolean }[])
        .filter(s => s.show_on_calendar).map(s => [s.id, s.person_key]))
      const workDate = new Map(((recRes.data ?? []) as { swap_id: string; target_date: string }[]).map(r => [r.swap_id, r.target_date]))
      for (const r of rows.filter(x => chunk.includes(x.swap_id))) {
        const p = person.get(r.swap_id), d = workDate.get(r.swap_id)
        if (p && d) rules.push({ scheduleId: r.schedule_id, personKey: p, workDate: d })
      }
    }
    return rules
  },
}
