import { createClient } from '@/lib/supabase/client'

// スタッフ（staff_members）の担当施設（staff_member_facilities）を扱う。
// 当面UIから使うのは role = 'leader' のみ。G長の group_manager_facilities とは独立。
export const staffMemberFacilityService = {
  // staffMemberId → facilityIds
  async getAll(): Promise<Record<string, string[]>> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('staff_member_facilities')
      .select('staff_member_id, facility_id')
    if (error) throw error

    const result: Record<string, string[]> = {}
    for (const row of data ?? []) {
      if (!result[row.staff_member_id]) result[row.staff_member_id] = []
      result[row.staff_member_id].push(row.facility_id)
    }
    return result
  },

  async getByMember(staffMemberId: string): Promise<string[]> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('staff_member_facilities')
      .select('facility_id')
      .eq('staff_member_id', staffMemberId)
    if (error) throw error
    return (data ?? []).map(row => row.facility_id)
  },

  // 指定施設を担当に追加する（既に登録済みの組み合わせは UNIQUE 制約に任せて無視する）
  async addFacilities(staffMemberId: string, facilityIds: string[]): Promise<void> {
    if (facilityIds.length === 0) return
    const supabase = createClient()
    const { error } = await supabase
      .from('staff_member_facilities')
      .upsert(
        facilityIds.map(facilityId => ({ staff_member_id: staffMemberId, facility_id: facilityId })),
        { onConflict: 'staff_member_id,facility_id', ignoreDuplicates: true }
      )
    if (error) throw error
  },

  // 指定施設だけ担当から解除する
  async removeFacilities(staffMemberId: string, facilityIds: string[]): Promise<void> {
    if (facilityIds.length === 0) return
    const supabase = createClient()
    const { error } = await supabase
      .from('staff_member_facilities')
      .delete()
      .eq('staff_member_id', staffMemberId)
      .in('facility_id', facilityIds)
    if (error) throw error
  },

  // 担当施設を facilityIds の状態に揃える。
  // 全件削除→再登録ではなく、現在値との差分（追加分INSERT・解除分DELETE）だけを反映するため、
  // 途中で失敗しても既存の担当が一度に消えることはない。
  async setForMember(staffMemberId: string, facilityIds: string[]): Promise<void> {
    const current = await staffMemberFacilityService.getByMember(staffMemberId)
    const next = new Set(facilityIds)
    const currentSet = new Set(current)

    const toAdd = [...next].filter(id => !currentSet.has(id))
    const toRemove = current.filter(id => !next.has(id))

    await staffMemberFacilityService.addFacilities(staffMemberId, toAdd)
    await staffMemberFacilityService.removeFacilities(staffMemberId, toRemove)
  },
}
