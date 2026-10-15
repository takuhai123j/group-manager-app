export type EventType =
  | 'patrol'        // 巡回
  | 'meeting'       // 会議
  | 'interview'     // 面談
  | 'job_interview' // 面接
  | 'mt'            // MT（ミーティング）
  | 'vacancy'       // 欠員対応
  | 'office'        // 事務作業
  | 'trouble'       // トラブル対応
  | 'holiday_work'  // 休日出勤
  | 'kyukyu'        // 公休（全日）
  | 'yukyu'         // 有休（全日）
  | 'hankyuu'       // 半休（時間指定・4時間）
  | 'han_yukyu'     // 半有休（時間指定・4時間）
  | 'other'         // その他
  | 'shift_change'  // シフト変更（シフト変更記録からの自動登録専用。手動では選べない）

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
  groupLeaderId: string       // G長・主任の担当ID（スタッフ担当の予定では ''）
  groupLeaderName: string     // 表示用の担当者名（G長・主任、なければリーダーの名前）
  staffMemberId: string | null     // スタッフ（リーダー・ラウンダー・現場社員）担当の予定のみ。G長・主任の予定では null
  staffMemberColor: string | null  // スタッフ担当の予定の表示色（JOINで取得）
  shiftChangeRecordId: string | null  // シフト変更から自動登録した予定のみ（元のシフト変更のID）。手動の予定は null
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
  // スタッフ（リーダー・ラウンダー・現場社員）担当にする場合のみ指定。指定時は group_manager_id を NULL にする
  staffMemberId?: string | null
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
  '欠勤', '遅刻', '早退', '時間変更', '交代出勤', '休日出勤', '振休', 'その他',
] as const

export type ShiftChangeType = typeof SHIFT_CHANGE_TYPES[number]

// 代替出勤者の振休対応状況（対象者明細単位）
// 'unset'  = 代替出勤は確定したが振休取得日はまだ未定
// 'linked' = 振休取得日の記録と紐付け済み（または、その振休取得日自体の明細）
export const COMPENSATORY_LEAVE_STATUSES = ['unset', 'linked'] as const
export type CompensatoryLeaveStatus = typeof COMPENSATORY_LEAVE_STATUSES[number]

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
  compensatoryLeaveStatus: CompensatoryLeaveStatus | null
  // 個人カレンダーへの反映先（G長・主任 or スタッフ。null は反映しない）と時刻（null は終日）
  calendarTarget: MeetingAssigneeRef | null
  startTime: string | null
  endTime: string | null
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
  relatedChangeGroupId: string | null
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
  compensatoryLeaveStatus?: CompensatoryLeaveStatus | null
  calendarTarget?: MeetingAssigneeRef | null
  startTime?: string | null
  endTime?: string | null
}

export type CreateShiftChangeInput = {
  // 新規登録で画面側が発行するID（再試行で二重登録しないため）。省略時はサービス側で発行する
  id?: string
  facilityId: string
  targetDate: string
  reason: string
  handledBy: string
  memo: string
  details: CreateShiftChangeDetailInput[]
  relatedChangeGroupId?: string | null
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

export type MeetingType = 'facility' | 'kitchen'

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  facility: '施設MT',
  kitchen: '厨房MT',
}

// DB保存値。'議事録登録済' は保存せず meeting_minutes の有無から導出する
export type MeetingStatus = 'scheduled' | 'done'

// 画面表示用の3段階ステータス（保存はしない、都度導出する値）
export type MeetingDisplayStatus = 'scheduled' | 'done' | 'minutes_registered'

export const MEETING_DISPLAY_STATUS_LABELS: Record<MeetingDisplayStatus, string> = {
  scheduled: '予定',
  done: '実施済',
  minutes_registered: '議事録登録済',
}

// scheduled → 予定 / done+議事録なし → 実施済 / done+議事録あり → 議事録登録済
export function getMeetingDisplayStatus(meeting: Pick<Meeting, 'status' | 'minutesCount'>): MeetingDisplayStatus {
  if (meeting.status === 'scheduled') return 'scheduled'
  return meeting.minutesCount > 0 ? 'minutes_registered' : 'done'
}

export interface MeetingFrequency {
  id: string
  facilityId: string
  meetingType: MeetingType
  intervalMonths: number
  startMonth: number
  active: boolean
  memo: string
  createdAt: string
  updatedAt: string
}

export type MeetingFrequencyInput = {
  facilityId: string
  meetingType: MeetingType
  intervalMonths: number
  startMonth: number
  memo: string
}

export interface Meeting {
  id: string
  facilityId: string
  facilityName: string
  meetingType: MeetingType
  targetMonth: string        // YYYY-MM-01 固定
  frequencyId: string | null // null = 手動追加（年間計画の自動再生成の対象外）
  scheduleId: string | null  // 日程確定後に紐づく schedules.id
  scheduleDate: string | null // schedules.date（日程確定済みの場合のみ。正はschedules側）
  scheduleStartTime: string | null // schedules.start_time（日程確定済みの場合のみ）
  scheduleEndTime: string | null   // schedules.end_time（日程確定済みの場合のみ）
  scheduleIsAllDay: boolean | null // schedules.is_all_day（日程確定済みの場合のみ）
  scheduleGroupManagerId: string | null   // 日程確定済みの場合の担当G長ID
  scheduleGroupManagerName: string | null // 日程確定済みの場合の担当G長名（表示用）
  scheduleAssignee: MeetingAssignee | null // 日程確定済みの場合の担当者（G長・主任 or リーダー）
  status: MeetingStatus
  executedDate: string | null
  minutesCount: number       // このMTに紐付く議事録の件数（共有PDFを含む。表示ステータス導出用）
  memo: string
  createdAt: string
  updatedAt: string
  jointGroupId: string | null          // 同時開催グループ（null = 単独開催）
  jointPartner: MeetingJointPartner | null // 同時開催の相手MT（jointGroupId がある場合のみ）
}

// 同時開催の相手MTの概要（相手のMTは計画月・年が異なる場合がある）
export type MeetingJointPartner = {
  id: string
  meetingType: MeetingType
  targetMonth: string
  status: MeetingStatus
}

// MTの担当者。G長・主任（group_managers）とリーダー（staff_members）を
// 画面上は同じ「担当者」として扱い、内部では type で区別する
export type MeetingAssigneeType = 'group_manager' | 'staff_member'

export type MeetingAssigneeRef = {
  type: MeetingAssigneeType
  id: string
}

export type MeetingAssignee = MeetingAssigneeRef & {
  name: string
  color: string
}

// 手動追加（frequency_id は常に null）
export type CreateManualMeetingInput = {
  facilityId: string
  meetingType: MeetingType
  targetMonth: string
  memo?: string
}

// 手動追加と同時に実施予定日を入力した場合に使うschedule情報
// （meetingScheduleService.confirmSchedule() へそのまま渡す）
export type CreateManualMeetingScheduleInput = {
  date: string
  startTime: string
  endTime: string
  isAllDay: boolean
  assignee?: MeetingAssigneeRef
}

// 手動追加フォームの入力全体。schedule未指定 = 日付未定のままmeetingだけ登録する
export type CreateManualMeetingWithScheduleInput = CreateManualMeetingInput & {
  schedule?: CreateManualMeetingScheduleInput
}

export type UpdateMeetingInput = {
  targetMonth?: string
  memo?: string
}

export interface MeetingMinute {
  id: string
  meetingId: string          // アップロード元（所有者）のMT
  fileName: string
  filePath: string
  uploadedAt: string
  memo: string | null
  isShared: boolean          // 同時開催などで2件以上のMTに紐付いている（削除すると全てのMTから消える）
}

export type CreateMeetingMinuteInput = {
  meetingId: string
  fileName: string
  filePath: string
  memo?: string | null
}

// 施設ごとの議事録履歴一覧（議事録PDF 1件 = 1行。親meetingは所有者MTの情報を展開したもの）
export interface MeetingMinuteHistoryItem {
  id: string
  meetingId: string
  facilityId: string
  facilityName: string
  meetingType: MeetingType
  targetMonth: string
  executedDate: string | null
  fileName: string
  filePath: string
  uploadedAt: string
  // 紐付いているMTの種別（同時開催で共有している場合は施設MT・厨房内MTの両方）
  meetingTypes: MeetingType[]
  isShared: boolean
}

export type MeetingMinuteHistoryFilters = {
  facilityId?: string
  meetingType?: MeetingType
  year?: number
}

// ── MT同時開催 ───────────────────────────────────────────────
// DBのRPC（mt_*）が返すエラーコード（'MTJ_<コード>: <メッセージ>' の <コード> 部分）
export type MeetingJointErrorCode =
  | 'MTJ_INVALID_INPUT'
  | 'MTJ_NOT_FOUND'
  | 'MTJ_FACILITY_MISMATCH'
  | 'MTJ_SAME_TYPE'
  | 'MTJ_ALREADY_JOINED'
  | 'MTJ_YEAR_RANGE'
  | 'MTJ_SCHEDULE_CHOICE_REQUIRED'
  | 'MTJ_SCHEDULE_DELETE_DENIED'
  | 'MTJ_EXECUTED_DATE_REQUIRED'
  | 'MTJ_EXECUTED_DATE_INVALID'
  | 'MTJ_ALREADY_SCHEDULED'
  | 'MTJ_MONTH_TAKEN'
  | 'MTJ_INCOMPLETE_GROUP'
  | 'MTJ_GROUP_INCONSISTENT'

// 既存MT同士の結合時に利用者が選ぶ内容
//   keepScheduleId / deleteScheduleId: 2件とも予定がある場合のみ必須（削除への同意）
//   executedDate: どちらかが実施済みの場合のみ必須（実施済み側の実施日から選ぶ）
export type JoinMeetingsOptions = {
  keepScheduleId?: string
  deleteScheduleId?: string
  executedDate?: string
}

// 結合前に、利用者に選んでもらう必要がある項目（画面の段階式フォーム用）
export type JoinRequirements = {
  scheduleChoice: { scheduleIds: [string, string] } | null // 2件とも別の予定がある
  executedDateChoice: { dates: string[] } | null           // 実施済みの日付候補（1件なら確認のみ）
  partnerWillBeMarkedDone: boolean                         // 片方だけ実施済み → 両方実施済みになる
}

// 新規登録と同時に同時開催にする（相手は既存MT or 新規作成）
export type CreateJointMeetingsInput = {
  facilityId: string
  meetingType: MeetingType
  targetMonth: string
  memo?: string
  partnerId?: string            // 既存MTを相手にする場合
  partnerTargetMonth?: string   // 相手を新規作成する場合の計画月（省略時は同じ月）
  schedule?: CreateManualMeetingScheduleInput // 日時未定なら省略
}

export type CreateJointMeetingsResult = {
  meetingId: string
  partnerId: string
  groupId: string
  scheduleId: string | null
  scheduleCreated: boolean      // true の場合だけ予定確定通知の対象
}

// MTの日程確定（meetings.schedule_id が未設定の場合のみ使用可）
export type ConfirmMeetingScheduleInput = {
  date: string
  startTime?: string   // 未指定時 '10:00'
  endTime?: string     // 未指定時 '11:00'
  isAllDay?: boolean   // 未指定時 false
  assignee?: MeetingAssigneeRef  // 施設の担当者候補が複数いる場合は指定必須
  memo?: string
}

// MTの日程変更（meetings.schedule_id が設定済みの場合のみ使用可。target_monthは変更しない）
export type RescheduleMeetingInput = {
  date?: string
  startTime?: string
  endTime?: string
  isAllDay?: boolean
  assignee?: MeetingAssigneeRef  // 担当者を変更する場合のみ指定
}
