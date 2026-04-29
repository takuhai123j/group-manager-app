export type EventType =
  | 'patrol'    // 巡回
  | 'meeting'   // 会議
  | 'interview' // 面談
  | 'vacancy'   // 欠員対応
  | 'office'    // 事務作業
  | 'trouble'   // トラブル対応
  | 'other'     // その他

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
  startTime: string      // HH:MM
  endTime: string        // HH:MM
  facilityId: string | null   // FK to facilities（null = 未設定）
  facilityName: string        // JOIN で取得した表示用名称
  type: EventType
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
  memo: string
  groupLeaderId: string
}

export type UpdateEventInput = Partial<CreateEventInput>

export interface EventFilters {
  types: EventType[]
  facilities: string[]   // 施設名でフィルタ（facilityName と照合）
}
