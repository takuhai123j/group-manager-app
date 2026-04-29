import { createClient } from '@/lib/supabase/client'
import type { GroupManager } from '@/lib/types'

type ManagerInput = { name: string; color: string; memo: string }

type ManagerRow = {
  id: string
  name: string
  color: string
  memo: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

function toGroupManager(row: ManagerRow): GroupManager {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    memo: row.memo,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const groupManagerService = {
  async getAll(): Promise<GroupManager[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('group_managers')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toGroupManager)
  },

  async add(input: ManagerInput): Promise<GroupManager> {
    const supabase = createClient()
    const { data: top } = await supabase
      .from('group_managers')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
    const maxOrder = top && top.length > 0 ? top[0].sort_order : -1

    const { data, error } = await supabase
      .from('group_managers')
      .insert({
        name: input.name.trim(),
        color: input.color,
        memo: input.memo.trim(),
        active: true,
        sort_order: maxOrder + 1,
      })
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('G長の追加に失敗しました')
    return toGroupManager(data as ManagerRow)
  },

  async update(id: string, input: ManagerInput): Promise<GroupManager> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('group_managers')
      .update({
        name: input.name.trim(),
        color: input.color,
        memo: input.memo.trim(),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('G長の更新に失敗しました')
    return toGroupManager(data as ManagerRow)
  },

  async toggleActive(id: string): Promise<GroupManager> {
    const supabase = createClient()
    const { data: current, error: fetchErr } = await supabase
      .from('group_managers')
      .select('active')
      .eq('id', id)
      .single()
    if (fetchErr || !current) throw fetchErr ?? new Error('G長が見つかりません')

    const { data, error } = await supabase
      .from('group_managers')
      .update({ active: !current.active })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('G長の状態変更に失敗しました')
    return toGroupManager(data as ManagerRow)
  },

  async moveUp(id: string): Promise<GroupManager[]> {
    const supabase = createClient()
    const { data: all } = await supabase
      .from('group_managers')
      .select('*')
      .order('sort_order', { ascending: true })
    if (!all) return []

    const active = all.filter(m => m.active)
    const idx = active.findIndex(m => m.id === id)
    if (idx <= 0) return all.map(m => toGroupManager(m as ManagerRow))

    const prev = active[idx - 1]
    const curr = active[idx]
    await supabase.from('group_managers').update({ sort_order: curr.sort_order }).eq('id', prev.id)
    await supabase.from('group_managers').update({ sort_order: prev.sort_order }).eq('id', curr.id)

    return groupManagerService.getAll()
  },

  async moveDown(id: string): Promise<GroupManager[]> {
    const supabase = createClient()
    const { data: all } = await supabase
      .from('group_managers')
      .select('*')
      .order('sort_order', { ascending: true })
    if (!all) return []

    const active = all.filter(m => m.active)
    const idx = active.findIndex(m => m.id === id)
    if (idx < 0 || idx >= active.length - 1) return all.map(m => toGroupManager(m as ManagerRow))

    const curr = active[idx]
    const next = active[idx + 1]
    await supabase.from('group_managers').update({ sort_order: next.sort_order }).eq('id', curr.id)
    await supabase.from('group_managers').update({ sort_order: curr.sort_order }).eq('id', next.id)

    return groupManagerService.getAll()
  },
}
