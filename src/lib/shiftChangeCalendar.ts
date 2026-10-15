import { STAFF_ROLE_LABELS } from '@/lib/types'
import type { GroupManager, StaffMember, StaffRole, MeetingAssigneeRef } from '@/lib/types'

// シフト変更 → 個人カレンダー自動反映の共通ヘルパー。
// 反映先は必ず画面で本人を確認して ID で指定する（名前は候補の提案に使うだけで、自動では紐付けない）。

export type CalendarCandidate = MeetingAssigneeRef & {
  name: string
  groupLabel: string // 'G長・主任' / 'リーダー' / 'ラウンダー' / '現場社員'
  active: boolean
}

const ROLE_ORDER: StaffRole[] = ['leader', 'rounder', 'field_employee']

// 反映先の候補（G長・主任 → リーダー → ラウンダー → 現場社員。各マスタの並び順のまま）。
// 無効化済みの人は、編集中の明細で既に指定されている場合だけ残す（keep に渡す）
export function buildCalendarCandidates(
  managers: GroupManager[],
  staffMembers: StaffMember[],
  keep: (MeetingAssigneeRef | null | undefined)[] = [],
): CalendarCandidate[] {
  const kept = (type: MeetingAssigneeRef['type'], id: string) => keep.some(k => k?.type === type && k.id === id)
  const gm = managers
    .filter(m => m.active || kept('group_manager', m.id))
    .map(m => ({ type: 'group_manager' as const, id: m.id, name: m.name, groupLabel: 'G長・主任', active: m.active }))
  const staff = ROLE_ORDER.flatMap(role => staffMembers
    .filter(s => s.role === role && (s.active || kept('staff_member', s.id)))
    .map(s => ({ type: 'staff_member' as const, id: s.id, name: s.name, groupLabel: STAFF_ROLE_LABELS[role], active: s.active })))
  return [...gm, ...staff]
}

// 名前の比較用: 全角半角・空白・敬称・役職名の違いを無視する（「東本G長」「東本 さん」「東本」を同じとみなす）
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/(さん|様|G長|主任|リーダー|ラウンダー|現場社員|社員)+$/i, '')
}

// 敬称・空白だけを除いた比較用の名前（役職名は残す）
function fullNameKey(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').replace(/(さん|様)+$/, '')
}

// 対象者名に一致する候補がちょうど1人のときだけ提案する（同名が複数なら提案しない）。
// まず役職名まで含めた完全一致で探し、無ければ役職名を除いた名前で探す
// （「井上G長」と「井上リーダー」がいる場合に「井上G長」と入力したら G長 を提案する）
export function suggestCalendarTarget(employeeName: string, candidates: CalendarCandidate[]): CalendarCandidate | null {
  const active = candidates.filter(c => c.active)
  const full = fullNameKey(employeeName)
  if (!full) return null
  const exact = active.filter(c => fullNameKey(c.name) === full)
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null
  const key = normalizePersonName(employeeName)
  if (!key) return null
  const hits = active.filter(c => normalizePersonName(c.name) === key)
  return hits.length === 1 ? hits[0] : null
}

export function sameTarget(a: MeetingAssigneeRef | null | undefined, b: MeetingAssigneeRef | null | undefined): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id
}

export function targetKey(ref: MeetingAssigneeRef | null | undefined): string {
  return ref ? `${ref.type}:${ref.id}` : ''
}

export function parseTargetKey(key: string): MeetingAssigneeRef | null {
  const idx = key.indexOf(':')
  if (idx < 0) return null
  const type = key.slice(0, idx)
  const id = key.slice(idx + 1)
  if ((type !== 'group_manager' && type !== 'staff_member') || !id) return null
  return { type, id }
}

// 時刻（任意）の検証。両方空なら終日、両方入っていれば開始 < 終了。エラーがなければ null
export function validateCalendarTime(startTime: string, endTime: string): string | null {
  if (!startTime && !endTime) return null
  if (!startTime || !endTime) return '時刻は開始・終了の両方を入力してください（終日なら両方とも空にします）'
  if (startTime >= endTime) return '終了時刻は開始時刻より後にしてください'
  return null
}

// 自動登録した予定のタイトル「施設名／変更種別」から変更種別を取り出す（カレンダーの表示用）
export function shiftChangeTypeFromTitle(title: string): string {
  const idx = title.lastIndexOf('／')
  return idx >= 0 ? title.slice(idx + 1) : title
}

export function formatCalendarTime(startTime: string | null | undefined, endTime: string | null | undefined): string {
  return startTime && endTime ? `${startTime}〜${endTime}` : '終日'
}
