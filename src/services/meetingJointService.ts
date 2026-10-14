import { createClient } from '@/lib/supabase/client'
import { toMeetingJointError, getJoinRequirements } from '@/lib/meetingJoint'
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
  getJoinCandidates(meeting: Pick<Meeting, 'facilityId' | 'meetingType' | 'targetMonth'>): Promise<Meeting[]> {
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

  // 同時開催の相手を変更する（解除 → 新しい相手と結合）。
  // meeting 側が予定を引き継いで解除するため、結合前の確認内容（JoinRequirements）は
  // 「meeting の現在の予定・実施状況」と新しい相手から判定したものがそのまま使える。
  //
  // 解除と結合は別トランザクションのため、途中で失敗しても中途半端な状態を残さないよう
  //   1) 解除する前に、最新の状態で結合できることを確認する（できなければ何も変更しない）
  //   2) 解除後に結合が失敗したら、元の相手と結合し直して元の状態に戻す
  //   3) 結合の応答だけが失われた場合（実際には結合済み）は成功として扱う
  async changePartner(meeting: Meeting, newPartnerId: string, options: JoinMeetingsOptions = {}): Promise<Meeting> {
    // 1) 事前確認（画面を開いてから他の端末で変更された場合も、解除前に止める）
    const [current, partner] = await Promise.all([
      meetingService.getById(meeting.id),
      meetingService.getById(newPartnerId),
    ])
    const oldPartnerId = current.jointPartner?.id
    if (!current.jointGroupId || !oldPartnerId) {
      throw new Error('このMTの同時開催はすでに解除されています。画面を閉じて開き直してください')
    }
    const problem = findJoinProblem(current, partner, options)
    if (problem) throw new Error(`${problem}。相手の変更は行っていません`)

    // 2) 解除（current 側が予定を引き継ぐ）
    await meetingJointService.leave(current, current.id)

    // 3) 新しい相手と結合
    try {
      return await meetingJointService.join(current.id, newPartnerId, options)
    } catch (joinErr) {
      const reason = joinErr instanceof Error ? joinErr.message : '処理に失敗しました'

      // 応答だけが失われた場合: 実際に新しい相手と結合できていれば成功とする
      const after = await meetingService.getById(current.id).catch(() => null)
      if (after?.jointPartner?.id === newPartnerId) return after

      // 4) 元の相手と結合し直す
      const restored = await rejoinOriginalPartner(current.id, oldPartnerId).catch(() => false)
      if (restored) {
        throw new Error(`新しい相手との結合に失敗したため、元の同時開催に戻しました（${reason}）`)
      }
      throw new Error(
        `新しい相手との結合に失敗し、元の同時開催にも戻せませんでした（${reason}）。` +
        '現在は同時開催が解除された状態です。画面を開き直して状態を確認し、「同時開催にする」から設定し直してください'
      )
    }
  },
}

// 結合できない理由（DB側 mt_join_meetings と同じ条件）を、解除前に画面側の最新データで確認する。
// meeting は同時開催中（解除前）の状態でよい（解除しても予定・実施状況は変わらないため）
function findJoinProblem(meeting: Meeting, partner: Meeting, options: JoinMeetingsOptions): string | null {
  if (partner.jointGroupId) return '選択したMTはすでに別の同時開催に設定されています'
  if (partner.facilityId !== meeting.facilityId) return '同じ施設のMT同士だけ結合できます'
  if (partner.meetingType === meeting.meetingType) return '施設MTと厨房MTの組み合わせだけ結合できます'
  const yearDiff = Math.abs(Number(partner.targetMonth.slice(0, 4)) - Number(meeting.targetMonth.slice(0, 4)))
  if (yearDiff > 1) return '結合できるのは前年・当年・翌年のMTです'

  const req = getJoinRequirements(meeting, partner)
  const [a, b] = req.scheduleChoice?.scheduleIds ?? []
  const scheduleOk = req.scheduleChoice
    ? !!options.keepScheduleId && !!options.deleteScheduleId && options.keepScheduleId !== options.deleteScheduleId &&
      [a, b].includes(options.keepScheduleId) && [a, b].includes(options.deleteScheduleId)
    : !options.deleteScheduleId
  const dateOk = req.executedDateChoice
    ? !!options.executedDate && req.executedDateChoice.dates.includes(options.executedDate)
    : !options.executedDate
  if (!scheduleOk || !dateOk) return 'MTの予定または実施状況が変更されています。内容を確認し直してください'
  return null
}

// 相手の変更に失敗した時に、元の相手と結合し直す。
// 解除で元の相手には予定の複製が作られているため、元の予定（meeting 側）を残して複製を削除する。
// 実施状況・実施日は解除前に共通だったため、meeting 側の実施日をそのまま使う
async function rejoinOriginalPartner(meetingId: string, oldPartnerId: string): Promise<boolean> {
  const [me, old] = await Promise.all([meetingService.getById(meetingId), meetingService.getById(oldPartnerId)])
  if (me.jointGroupId || old.jointGroupId) return false
  const req = getJoinRequirements(me, old)
  const options: JoinMeetingsOptions = {}
  if (req.scheduleChoice) {
    if (!me.scheduleId || !old.scheduleId) return false
    options.keepScheduleId = me.scheduleId
    options.deleteScheduleId = old.scheduleId
  }
  if (req.executedDateChoice) {
    options.executedDate = me.executedDate ?? req.executedDateChoice.dates[0]
  }
  await meetingJointService.join(me.id, old.id, options)
  return true
}
