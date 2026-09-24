import { createClient } from '@/lib/supabase/client'
import { scheduleService } from '@/services/scheduleService'
import { meetingService } from '@/services/meetingService'
import { buildMeetingScheduleTitle } from '@/constants/eventTypes'
import type {
  Meeting, ConfirmMeetingScheduleInput, RescheduleMeetingInput,
  CreateManualMeetingWithScheduleInput,
} from '@/lib/types'

// meetings と schedules の連携（日程確定・変更・取消）のみを扱う。
// meetings.target_month は「予定月」を表すだけで、具体的な日付の正は
// 常に schedules.date とする（このファイルでは target_month を一切書き換えない）。

type GroupManagerLink = {
  group_manager_id: string
  group_managers: { id: string; name: string; active: boolean } | null
}

// facility_id に紐づく「有効な」G長を group_manager_facilities から解決する。
//   - explicitGroupManagerId 指定あり → その施設に紐づく有効なG長か検証してから使用
//   - 指定なし かつ 有効なG長が1名のみ → 自動的に採用
//   - 指定なし かつ 0名・複数名 → 安全に決定できないためエラー
async function resolveResponsibleGroupManagerId(
  facilityId: string,
  explicitGroupManagerId?: string
): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('group_manager_facilities')
    .select('group_manager_id, group_managers ( id, name, active )')
    .eq('facility_id', facilityId)
  if (error) throw error

  const candidates = ((data ?? []) as unknown as GroupManagerLink[])
    .map(link => link.group_managers)
    .filter((g): g is { id: string; name: string; active: boolean } => g !== null && g.active)

  if (explicitGroupManagerId) {
    const isValid = candidates.some(c => c.id === explicitGroupManagerId)
    if (!isValid) {
      throw new Error('指定された担当者はこの施設に割り当てられていないか、無効化されています')
    }
    return explicitGroupManagerId
  }

  if (candidates.length === 1) return candidates[0].id
  if (candidates.length === 0) {
    throw new Error('この施設に有効なG長が割り当てられていません。担当者を指定してください')
  }
  throw new Error('この施設には複数の有効なG長が割り当てられています。担当者を指定してください')
}

export const meetingScheduleService = {
  resolveResponsibleGroupManagerId,

  // 日程確定: schedules に新規作成し、meetings.schedule_id に紐付ける
  // meeting.schedule_id が既に存在する場合は二重作成を防ぐため必ずエラーにする
  // （日程変更は rescheduleMeeting を使用する）
  async confirmSchedule(meetingId: string, input: ConfirmMeetingScheduleInput): Promise<Meeting> {
    const meeting = await meetingService.getById(meetingId)
    if (meeting.scheduleId) {
      throw new Error('このMTは既に日程が確定しています。日程変更は rescheduleMeeting を使用してください')
    }

    const groupManagerId = await resolveResponsibleGroupManagerId(meeting.facilityId, input.groupManagerId)
    const isAllDay = input.isAllDay ?? false
    const title = buildMeetingScheduleTitle(meeting.meetingType, meeting.facilityName)

    const schedule = await scheduleService.create({
      title,
      date: input.date,
      startTime: isAllDay ? '00:00' : (input.startTime ?? '10:00'),
      endTime: isAllDay ? '00:00' : (input.endTime ?? '11:00'),
      facilityId: meeting.facilityId,
      type: 'mt',
      isAllDay,
      memo: input.memo ?? '',
      groupLeaderId: groupManagerId,
    })

    try {
      return await meetingService.setScheduleId(meetingId, schedule.id)
    } catch (updateError) {
      // meetings.schedule_id の更新に失敗した場合、直前に作成した schedule が
      // 孤児として残らないよう rollback する（DB関数/RPCによるtransactionは未導入のため）
      await scheduleService.delete(schedule.id).catch(() => {
        // rollback自体の失敗はここでは握りつぶさず、元のエラーを優先して呼び出し元に伝える
      })
      throw updateError
    }
  },

  // 日程変更: 既存 schedules をUPDATEするのみ。meetings.target_month は変更しない
  async rescheduleMeeting(meetingId: string, input: RescheduleMeetingInput): Promise<Meeting> {
    const meeting = await meetingService.getById(meetingId)
    if (!meeting.scheduleId) {
      throw new Error('このMTはまだ日程が確定していません。confirmSchedule を使用してください')
    }

    const groupManagerId = input.groupManagerId !== undefined
      ? await resolveResponsibleGroupManagerId(meeting.facilityId, input.groupManagerId)
      : undefined

    await scheduleService.update(meeting.scheduleId, {
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      isAllDay: input.isAllDay,
      groupLeaderId: groupManagerId,
    })

    // schedule_id 自体は変わらないため meetings 側の更新は不要。最新状態を返す。
    return meetingService.getById(meetingId)
  },

  // 日程取消: schedules 行をDELETEする（meetings.schedule_id は ON DELETE SET NULL により
  // DB側で自動的にNULLへ戻る。schedule_id=NULLへの更新だけでは孤児scheduleが
  // カレンダー上に残ってしまうため、必ずschedules側から削除する）
  async cancelSchedule(meetingId: string): Promise<Meeting> {
    const meeting = await meetingService.getById(meetingId)
    if (!meeting.scheduleId) {
      return meeting // 既に日程未確定のため何もしない（冪等に扱う）
    }

    await scheduleService.delete(meeting.scheduleId)
    return meetingService.getById(meetingId)
  },

  // MT手動追加 + （実施予定日を入力した場合のみ）schedule確定までを1回の操作で行う。
  // meetingService.addManual() と 既存 confirmSchedule() をそのまま再利用するだけで、
  // schedule登録ロジックの新規実装は行わない。
  //
  // schedule未指定（日付未定のまま登録）の場合は meeting だけ作成して終了する。
  //
  // schedule指定ありで confirmSchedule() が失敗した場合、
  // 「meetingだけ登録されたのにG長予定まで登録されたと誤解される」状態を避けるため、
  // 今回この呼び出しの中で新規作成した meeting のみ best-effort で rollback（削除）する。
  // 既存meetingの日程変更（confirmSchedule/rescheduleMeeting）の失敗時にmeeting自体を
  // 削除することは絶対にない（それらの関数はここから作られたmeetingにしか適用されない）。
  async createManualMeeting(input: CreateManualMeetingWithScheduleInput): Promise<Meeting> {
    const created = await meetingService.addManual({
      facilityId: input.facilityId,
      meetingType: input.meetingType,
      targetMonth: input.targetMonth,
      memo: input.memo,
    })

    if (!input.schedule) return created

    try {
      return await meetingScheduleService.confirmSchedule(created.id, {
        date: input.schedule.date,
        startTime: input.schedule.startTime,
        endTime: input.schedule.endTime,
        isAllDay: input.schedule.isAllDay,
        groupManagerId: input.schedule.groupManagerId,
      })
    } catch (err) {
      await meetingService.deleteIfSafe(created.id).catch(() => {
        // rollback自体の失敗はここでは握りつぶし、元のエラーを呼び出し元に伝える
      })
      throw err
    }
  },
}
