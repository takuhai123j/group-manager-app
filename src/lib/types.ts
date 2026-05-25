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
