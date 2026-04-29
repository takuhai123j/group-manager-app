import { createClient } from '@/lib/supabase/client'
import type { Facility } from '@/lib/types'

type FacilityRow = {
  id: string
  name: string
  area: string
  memo: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

function toFacility(row: FacilityRow): Facility {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    memo: row.memo,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const facilityService = {
  // activeを含む全施設を取得（無効化された施設も含む）
  async getAll(): Promise<Facility[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('facilities')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(f => toFacility(f as FacilityRow))
  },

  async add(name: string): Promise<Facility> {
    const supabase = createClient()
    const { data: top } = await supabase
      .from('facilities')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
    const maxOrder = top && top.length > 0 ? top[0].sort_order : -1

    const { data, error } = await supabase
      .from('facilities')
      .insert({
        name: name.trim(),
        area: '',
        memo: '',
        active: true,
        sort_order: maxOrder + 1,
      })
      .select('*')
      .single()
    if (error || !data) throw error ?? new Error('施設の追加に失敗しました')
    return toFacility(data as FacilityRow)
  },

  // 物理削除ではなく active=false にする
  async deactivate(id: string): Promise<void> {
    const supabase = createClient()
    const { error } = await supabase
      .from('facilities')
      .update({ active: false })
      .eq('id', id)
    if (error) throw error
  },
}
