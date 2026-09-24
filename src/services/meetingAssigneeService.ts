import { createClient } from '@/lib/supabase/client'
import type { MeetingAssignee } from '@/lib/types'

// MT担当者候補（G長・主任 + リーダー）をDBから取得する。
// 画面表示用の候補は lib/meetingAssignee.ts の buildAssigneeCandidates で組み立てるが、
// 保存時の検証・自動決定は必ずこちら（DBの最新状態）で行う。

type GroupManagerLink = {
  group_managers: { id: string; name: string; color: string; active: boolean } | null
}

type StaffMemberLink = {
  staff_members: { id: string; name: string; color: string; role: string; active: boolean } | null
}

export const meetingAssigneeService = {
  async getCandidates(facilityId: string): Promise<MeetingAssignee[]> {
    const supabase = createClient()
    const [gmResult, staffResult] = await Promise.all([
      supabase
        .from('group_manager_facilities')
        .select('group_managers ( id, name, color, active )')
        .eq('facility_id', facilityId),
      supabase
        .from('staff_member_facilities')
        .select('staff_members ( id, name, color, role, active )')
        .eq('facility_id', facilityId),
    ])
    if (gmResult.error) throw gmResult.error
    if (staffResult.error) throw staffResult.error

    const managers: MeetingAssignee[] = ((gmResult.data ?? []) as unknown as GroupManagerLink[])
      .map(link => link.group_managers)
      .filter((g): g is NonNullable<GroupManagerLink['group_managers']> => g !== null && g.active)
      .map(g => ({ type: 'group_manager', id: g.id, name: g.name, color: g.color }))

    const leaders: MeetingAssignee[] = ((staffResult.data ?? []) as unknown as StaffMemberLink[])
      .map(link => link.staff_members)
      .filter((s): s is NonNullable<StaffMemberLink['staff_members']> =>
        s !== null && s.active && s.role === 'leader')
      .map(s => ({ type: 'staff_member', id: s.id, name: s.name, color: s.color }))

    return [...managers, ...leaders]
  },
}
