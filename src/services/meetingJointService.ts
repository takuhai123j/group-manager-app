import { createClient } from '@/lib/supabase/client'
import { toMeetingJointError } from '@/lib/meetingJoint'
import { meetingService } from '@/services/meetingService'
import { meetingScheduleService } from '@/services/meetingScheduleService'
import type {
  Meeting, JoinMeetingsOptions, CreateJointMeetingsInput, CreateJointMeetingsResult,
} from '@/lib/types'

// MT同時開催（施設MT＋厨房内MT）の結合・新規登録・解除。
// 複数行にまたがる更新はすべてDBのRPC（mt_*）で1トランザクションとして行い、
// 検証（同一施設・別種別・未結合・予定/実施日の選択など）もDB側に集約している。
// 共通予定の確定は担当者の解決が必要なため meetingScheduleService.confirmSchedule が扱い、
// 実施済み登録は meetingService.markDone がグループ単位に切り替える。

export const meetingJointService = {
  getJoinCandidates(meeting: Meeting): Promise<Meeting[]> {
    return meetingService.getJoinCandidates(meeting)
  },

  // 既存MT同士を同時開催にする。戻り値は結合後のMT（呼び出し元の meeting 側）
  async join(meetingId: string, partnerId: string, options: JoinMeetingsOptions = {}): Promise<Meeting> {
    const supabase = createClient()
    const { error } = await supabase.rpc('mt_join_meetings', {
      p_meeting_id: meetingId,
      p_partner_id: partnerId,
      p_keep_schedule_id: options.keepScheduleId ?? null,
      p_delete_schedule_id: options.deleteScheduleId ?? null,
      p_executed_date: options.executedDate ?? null,
    })
    if (error) throw toMeetingJointError(error)
    return meetingService.getById(meetingId)
  },

  // 新規登録と同時に同時開催にする（相手は既存MT or 新規作成。日時ありなら共通予定も確定）
  async createJoint(input: CreateJointMeetingsInput): Promise<CreateJointMeetingsResult> {
    const supabase = createClient()

    let assigneeColumns: { p_group_manager_id: string | null; p_staff_member_id: string | null } = {
      p_group_manager_id: null, p_staff_member_id: null,
    }
    if (input.schedule) {
      const assignee = await meetingScheduleService.resolveAssignee(input.facilityId, input.schedule.assignee)
      assigneeColumns = assignee.type === 'staff_member'
        ? { p_group_manager_id: null, p_staff_member_id: assignee.id }
        : { p_group_manager_id: assignee.id, p_staff_member_id: null }
    }

    const { data, error } = await supabase.rpc('mt_create_joint_meetings', {
      p_facility_id: input.facilityId,
      p_meeting_type: input.meetingType,
      p_target_month: `${input.targetMonth.slice(0, 7)}-01`,
      p_memo: input.memo?.trim() ?? '',
      p_partner_id: input.partnerId ?? null,
      p_partner_target_month: input.partnerTargetMonth ? `${input.partnerTargetMonth.slice(0, 7)}-01` : null,
      p_schedule_date: input.schedule?.date ?? null,
      p_start_time: input.schedule?.startTime ?? '10:00',
      p_end_time: input.schedule?.endTime ?? '11:00',
      p_is_all_day: input.schedule?.isAllDay ?? false,
      ...assigneeColumns,
    })
    if (error || !data) throw toMeetingJointError(error)
    return {
      meetingId: data.meeting_id,
      partnerId: data.partner_id,
      groupId: data.group_id,
      scheduleId: data.schedule_id,
      scheduleCreated: data.schedule_created,
    }
  },

  // 同時開催を解除する。keepMeetingId 側が元の予定を引き継ぎ、もう一方には予定を複製する。
  // 議事録は両方に残り、実施状況・実施日・計画月は変わらない
  async leave(meeting: Meeting, keepMeetingId: string = meeting.id): Promise<Meeting> {
    if (!meeting.jointGroupId) throw new Error('このMTは同時開催に設定されていません')
    const supabase = createClient()
    const { error } = await supabase.rpc('mt_leave_joint', {
      p_group_id: meeting.jointGroupId,
      p_keep_meeting_id: keepMeetingId,
    })
    if (error) throw toMeetingJointError(error)
    return meetingService.getById(meeting.id)
  },
}
