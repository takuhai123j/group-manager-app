export type EventType =
  | 'patrol'        // 巡回
  | 'meeting'       // 会議
  | 'interview'     // 面談
  | 'job_interview' // 面接
  | 'mt'            // MT（ミーティング）
  | 'vacancy'       // 欠員対応
  | 'office'        // 事務作業
  | 'trouble'       // トラブル対応
  | 'kyukyu'        // 公休（全日）
  | 'yukyu'         // 有休（全日）
  | 'hankyuu'       // 半休（時間指定・4時間）
  | 'han_yukyu'     // 半有休（時間指定・4時間）
  | 'other'         // その他

export type CalendarView = 'month' | 'week' | 'day'

export type ColorMode = 'leader' | 'type'

export interface GroupManager {
  id: string
  name: string
  color: string
  memo: string
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface Facility {
  id: string
  name: string
  area: string
  memo: string
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface ScheduleEvent {
  id: string
  title: string
  date: string           // YYYY-MM-DD
  startTime: string      // HH:MM（全日予定は '00:00'）
  endTime: string        // HH:MM（全日予定は '00:00'）
  facilityId: string | null   // FK to facilities（null = 未設定）
  facilityName: string        // JOIN で取得した表示用名称
  type: EventType
  isAllDay: boolean           // 全日予定フラグ（公休・有休など）
  memo: string
  groupLeaderId: string
  groupLeaderName: string     // JOIN で取得した表示用名称
  createdAt: string
  updatedAt: string
}

export type CreateEventInput = {
  title: string
  date: string
  startTime: string
  endTime: string
  facilityId: string | null   // null = 施設未設定
  type: EventType
  isAllDay: boolean
  memo: string
  groupLeaderId: string
}

export type UpdateEventInput = Partial<CreateEventInput>

export interface EventFilters {
  types: EventType[]
  facilities: string[]   // 施設名でフィルタ（facilityName と照合）
}

export interface Announcement {
  id: string
  title: string
  content: string
  isImportant: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export type CreateAnnouncementInput = {
  title: string
  content: string
  isImportant: boolean
  active: boolean
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>

export type ShiftFileType = 'shift' | 'g_leader' | 'other'

export const SHIFT_FILE_TYPE_LABELS: Record<ShiftFileType, string> = {
  shift: '現場シフト',
  g_leader: 'G長シフト',
  other: 'その他資料',
}

export interface ShiftFile {
  id: string
  fileType: ShiftFileType
  facilityId: string | null
  facilityName: string | null
  targetMonth: string      // YYYY-MM
  fileName: string
  filePath: string
  memo: string
  createdAt: string
}

export type CreateShiftFileInput = {
  fileType: ShiftFileType
  facilityId: string | null
  targetMonth: string
  memo: string
}

export type StaffRole = 'leader' | 'rounder' | 'field_employee'

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  leader: 'リーダー',
  rounder: 'ラウンダー',
  field_employee: '現場社員',
}

export interface StaffMember {
  id: string
  name: string
  role: StaffRole
  color: string
  memo: string
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type StaffMemberInput = {
  name: string
  color: string
  memo: string
}

export const SHIFT_CHANGE_TYPES = [
  '欠勤', '遅刻', '早退', '時間変更', '交代出勤', 'その他',
] as const

export type ShiftChangeType = typeof SHIFT_CHANGE_TYPES[number]

export interface ShiftChangeDetail {
  id: string
  recordId: string
  employeeName: string
  changeType: ShiftChangeType | string  // 旧データ互換のため string も許容
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityId: string | null
  sortOrder: number
  createdAt: string
  originalShift: string | null
  replacementName: string | null
  replacementOriginalShift: string | null
}

export interface ShiftChangeRecord {
  id: string
  facilityId: string
  facilityName: string
  targetDate: string   // YYYY-MM-DD
  reason: string
  handledBy: string
  memo: string
  details: ShiftChangeDetail[]
  createdAt: string
  updatedAt: string
}

export type CreateShiftChangeDetailInput = {
  employeeName: string
  changeType: ShiftChangeType
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityId: string | null
  originalShift?: string | null
  replacementName?: string | null
  replacementOriginalShift?: string | null
}

export type CreateShiftChangeInput = {
  facilityId: string
  targetDate: string
  reason: string
  handledBy: string
  memo: string
  details: CreateShiftChangeDetailInput[]
}

export interface ShiftChangeFilters {
  facilityId: string
  targetDate: string
  reason: string
  handledBy: string
  employeeName: string
  changeType: string
  isExternalSupport: string   // 'true' | ''
  supportFacilityId: string
}
