import { createClient } from '@/lib/supabase/client'

export const groupManagerFacilityService = {
  async getAll(): Promise<Record<string, string[]>> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('group_manager_facilities')
      .select('group_manager_id, facility_id')
    if (error) throw error

    const result: Record<string, string[]> = {}
    for (const row of data ?? []) {
      if (!result[row.group_manager_id]) result[row.group_manager_id] = []
      result[row.group_manager_id].push(row.facility_id)
    }
    return result
  },

  async setForManager(managerId: string, facilityIds: string[]): Promise<void> {
    const supabase = createClient()
    const { error: deleteError } = await supabase
      .from('group_manager_facilities')
      .delete()
      .eq('group_manager_id', managerId)
    if (deleteError) throw deleteError

    if (facilityIds.length > 0) {
      const rows = facilityIds.map(facilityId => ({
        group_manager_id: managerId,
        facility_id: facilityId,
      }))
      const { error: insertError } = await supabase
        .from('group_manager_facilities')
        .insert(rows)
      if (insertError) throw insertError
    }
  },
}
