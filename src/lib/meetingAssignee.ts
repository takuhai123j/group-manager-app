import type {
  GroupManager, StaffMember, MeetingAssignee, MeetingAssigneeRef, MeetingAssigneeType,
} from '@/lib/types'

// MT担当者（G長・主任 / リーダー）の共通ヘルパー。
// G長とリーダーは別マスタのため、IDだけでは区別できない。
// 画面の select などでは `${type}:${id}` のキーで一意に扱う。

export function assigneeKey(ref: MeetingAssigneeRef): string {
  return `${ref.type}:${ref.id}`
}

export function parseAssigneeKey(key: string): MeetingAssigneeRef | null {
  const idx = key.indexOf(':')
  if (idx < 0) return null
  const type = key.slice(0, idx) as MeetingAssigneeType
  const id = key.slice(idx + 1)
  if ((type !== 'group_manager' && type !== 'staff_member') || !id) return null
  return { type, id }
}

export function isSameAssignee(a: MeetingAssigneeRef | null | undefined, b: MeetingAssigneeRef | null | undefined): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id
}

// 施設の担当者候補を、画面が既に持っているマスタ・担当施設データから組み立てる。
//   G長・主任: group_manager_facilities で施設を担当している有効な group_managers
//   リーダー  : staff_member_facilities で施設を担当している有効な role='leader' の staff_members
// 並び順は G長・主任 → リーダー（各マスタの並び順を維持）
export function buildAssigneeCandidates(
  facilityId: string,
  activeManagers: GroupManager[],
  managerFacilities: Record<string, string[]>,
  activeLeaders: StaffMember[],
  leaderFacilities: Record<string, string[]>,
): MeetingAssignee[] {
  const managers = activeManagers
    .filter(m => m.active && (managerFacilities[m.id] ?? []).includes(facilityId))
    .map(m => ({ type: 'group_manager' as const, id: m.id, name: m.name, color: m.color }))
  const leaders = activeLeaders
    .filter(l => l.active && l.role === 'leader' && (leaderFacilities[l.id] ?? []).includes(facilityId))
    .map(l => ({ type: 'staff_member' as const, id: l.id, name: l.name, color: l.color }))
  return [...managers, ...leaders]
}
