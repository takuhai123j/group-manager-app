import { createClient } from '@/lib/supabase/client'
import type { StaffMember, StaffMemberInput, StaffRole } from '@/lib/types'

type StaffMemberRow = {
  id: string
  name: string
  role: string
  color: string
  memo: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

function toStaffMember(row: StaffMemberRow): StaffMember {
  return {
    id: row.id,
    name: row.name,
    role: row.role as StaffRole,
    color: row.color,
    memo: row.memo,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const staffMemberService = {
  async getByRole(role: StaffRole): Promise<StaffMember[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .eq('role', role)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toStaffMember)
  },

  async add(role: StaffRole, input: StaffMemberInput): Promise<StaffMember> {
    const supabase = createClient()
    const { data: top } = await supabase
      .from('staff_members')
      .select('sort_order')
      .eq('role', role)
      .order('sort_order', { ascending: false })
      .limit(1)
    const maxOrder = top && top.length > 0 ? top[0].sort_order : -1

    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        name: input.name.trim(),
        role,
        color: input.color,
        memo: input.memo.trim(),
        active: true,
        sort_order: maxOrder + 1,
      })
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('スタッフの追加に失敗しました')
    return toStaffMember(data as StaffMemberRow)
  },

  async update(id: string, input: StaffMemberInput): Promise<StaffMember> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('staff_members')
      .update({
        name: input.name.trim(),
        color: input.color,
        memo: input.memo.trim(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('スタッフの更新に失敗しました')
    return toStaffMember(data as StaffMemberRow)
  },

  async toggleActive(id: string): Promise<StaffMember> {
    const supabase = createClient()
    const { data: current, error: fetchErr } = await supabase
      .from('staff_members')
      .select('active')
      .eq('id', id)
      .single()
    if (fetchErr || !current) throw fetchErr ?? new Error('スタッフが見つかりません')

    const { data, error } = await supabase
      .from('staff_members')
      .update({ active: !current.active })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('スタッフの状態変更に失敗しました')
    return toStaffMember(data as StaffMemberRow)
  },

  async moveUp(id: string, role: StaffRole): Promise<StaffMember[]> {
    const supabase = createClient()
    const { data: all } = await supabase
      .from('staff_members')
      .select('*')
      .eq('role', role)
      .order('sort_order', { ascending: true })
    if (!all) return []

    const active = all.filter(m => m.active)
    const idx = active.findIndex(m => m.id === id)
    if (idx <= 0) return all.map(m => toStaffMember(m as StaffMemberRow))

    const prev = active[idx - 1]
    const curr = active[idx]
    await supabase.from('staff_members').update({ sort_order: curr.sort_order }).eq('id', prev.id)
    await supabase.from('staff_members').update({ sort_order: prev.sort_order }).eq('id', curr.id)

    return staffMemberService.getByRole(role)
  },

  async moveDown(id: string, role: StaffRole): Promise<StaffMember[]> {
    const supabase = createClient()
    const { data: all } = await supabase
      .from('staff_members')
      .select('*')
      .eq('role', role)
      .order('sort_order', { ascending: true })
    if (!all) return []

    const active = all.filter(m => m.active)
    const idx = active.findIndex(m => m.id === id)
    if (idx < 0 || idx >= active.length - 1) return all.map(m => toStaffMember(m as StaffMemberRow))

    const curr = active[idx]
    const next = active[idx + 1]
    await supabase.from('staff_members').update({ sort_order: next.sort_order }).eq('id', curr.id)
    await supabase.from('staff_members').update({ sort_order: curr.sort_order }).eq('id', next.id)

    return staffMemberService.getByRole(role)
  },
}
