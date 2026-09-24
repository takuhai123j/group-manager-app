import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type {
  Meeting, MeetingAssignee, MeetingType, CreateManualMeetingInput, UpdateMeetingInput,
} from '@/lib/types'
import { parseTargetMonth, buildTargetMonth } from '@/lib/meetingPlan'

// JOIN を含む SELECT フィールド定義
// meeting_minutes(count) は行を取得せず件数のみ取得する PostgREST の集計構文
// schedules(...) は日程確定済みの場合の実施予定日・時間・担当者（G長・主任 or リーダー）を
// 年間計画UI/ダッシュボードに表示し、「予定を保存」フォームの初期値に使うためのJOIN
const SELECT_WITH_JOINS = `
  id,
  facility_id,
  meeting_type,
  target_month,
  frequency_id,
  schedule_id,
  status,
  executed_date,
  memo,
  created_at,
  updated_at,
  facilities ( name ),
  meeting_minutes ( count ),
  schedules (
    date, start_time, end_time, is_all_day,
    group_manager_id, group_managers ( name, color ),
    staff_member_id, staff_members ( name, color )
  )
` as const

type MeetingRow = {
  id: string
  facility_id: string
  meeting_type: 'facility' | 'kitchen'
  target_month: string
  frequency_id: string | null
  schedule_id: string | null
  status: 'scheduled' | 'done'
  executed_date: string | null
  memo: string
  created_at: string
  updated_at: string
  facilities: { name: string } | null
  meeting_minutes: { count: number }[] | null
  schedules: {
    date: string
    start_time: string
    end_time: string
    is_all_day: boolean
    group_manager_id: string | null
    group_managers: { name: string; color: string } | null
    staff_member_id: string | null
    staff_members: { name: string; color: string } | null
  } | null
}

// schedules の担当者列（どちらか一方だけが設定される）から共通の担当者を組み立てる
function toScheduleAssignee(schedule: MeetingRow['schedules']): MeetingAssignee | null {
  if (!schedule) return null
  if (schedule.staff_member_id) {
    return {
      type: 'staff_member',
      id: schedule.staff_member_id,
      name: schedule.staff_members?.name ?? '',
      color: schedule.staff_members?.color ?? '#6B7280',
    }
  }
  if (schedule.group_manager_id) {
    return {
      type: 'group_manager',
      id: schedule.group_manager_id,
      name: schedule.group_managers?.name ?? '',
      color: schedule.group_managers?.color ?? '#6B7280',
    }
  }
  return null
}

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facilities?.name ?? '',
    meetingType: row.meeting_type,
    targetMonth: row.target_month,
    frequencyId: row.frequency_id,
    scheduleId: row.schedule_id,
    scheduleDate: row.schedules?.date ?? null,
    scheduleStartTime: row.schedules?.start_time ?? null,
    scheduleEndTime: row.schedules?.end_time ?? null,
    scheduleIsAllDay: row.schedules?.is_all_day ?? null,
    scheduleGroupManagerId: row.schedules?.group_manager_id ?? null,
    scheduleGroupManagerName: row.schedules?.group_managers?.name ?? null,
    scheduleAssignee: toScheduleAssignee(row.schedules),
    status: row.status,
    executedDate: row.executed_date,
    minutesCount: row.meeting_minutes?.[0]?.count ?? 0,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// target_month は常に月初(YYYY-MM-01)で保存する（DB側 CHECK 制約と揃える）
function normalizeTargetMonth(targetMonth: string): string {
  const ym = targetMonth.slice(0, 7) // 'YYYY-MM'
  return `${ym}-01`
}

function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` }
}

export const meetingService = {
  async getById(id: string): Promise<Meeting> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meetings')
      .select(SELECT_WITH_JOINS)
      .eq('id', id)
      .single()
    if (error || !data) throw error ?? new Error('MTが見つかりません')
    return toMeeting(data as unknown as MeetingRow)
  },

  // 年指定でMT一覧取得（暦年 1〜12月）
  async getByYear(year: number): Promise<Meeting[]> {
    const supabase = createClient()
    const { from, to } = yearRange(year)
    const { data, error } = await supabase
      .from('meetings')
      .select(SELECT_WITH_JOINS)
      .gte('target_month', from)
      .lt('target_month', to)
      .order('target_month', { ascending: true })
    if (error) throw error
    return (data ?? []).map(row => toMeeting(row as unknown as MeetingRow))
  },

  async getByFacility(facilityId: string, year?: number): Promise<Meeting[]> {
    const supabase = createClient()
    let query = supabase
      .from('meetings')
      .select(SELECT_WITH_JOINS)
      .eq('facility_id', facilityId)
      .order('target_month', { ascending: true })
    if (year !== undefined) {
      const { from, to } = yearRange(year)
      query = query.gte('target_month', from).lt('target_month', to)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(row => toMeeting(row as unknown as MeetingRow))
  },

  async getByType(meetingType: MeetingType, year?: number): Promise<Meeting[]> {
    const supabase = createClient()
    let query = supabase
      .from('meetings')
      .select(SELECT_WITH_JOINS)
      .eq('meeting_type', meetingType)
      .order('target_month', { ascending: true })
    if (year !== undefined) {
      const { from, to } = yearRange(year)
      query = query.gte('target_month', from).lt('target_month', to)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).map(row => toMeeting(row as unknown as MeetingRow))
  },

  // 手動追加（frequency_id は常に null = 年間計画の自動再生成の対象外）
  async addManual(input: CreateManualMeetingInput): Promise<Meeting> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        facility_id: input.facilityId,
        meeting_type: input.meetingType,
        target_month: normalizeTargetMonth(input.targetMonth),
        frequency_id: null,
        status: 'scheduled',
        memo: input.memo?.trim() ?? '',
      })
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('MTの追加に失敗しました')
    return toMeeting(data as unknown as MeetingRow)
  },

  async update(id: string, input: UpdateMeetingInput): Promise<Meeting> {
    const supabase = createClient()
    const patch: Database['public']['Tables']['meetings']['Update'] = {}
    if (input.targetMonth !== undefined) patch.target_month = normalizeTargetMonth(input.targetMonth)
    if (input.memo !== undefined)        patch.memo         = input.memo.trim()

    const { data, error } = await supabase
      .from('meetings')
      .update(patch)
      .eq('id', id)
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('MTの更新に失敗しました')
    return toMeeting(data as unknown as MeetingRow)
  },

  // 実施済登録（議事録登録済かどうかは meeting_minutes の有無から画面側で導出する）
  //
  // executed_date の決定方針:
  //   - schedule_id が設定済み かつ executedDate 未指定 → schedules.date を実施日とする
  //   - schedule_id が未設定（日程未確定） → executedDate の明示指定を必須とする
  // 「今日の日付」を勝手に補完すると実施日の記録として不正確になるため行わない
  async markDone(id: string, executedDate?: string): Promise<Meeting> {
    const supabase = createClient()

    let resolvedExecutedDate = executedDate
    if (!resolvedExecutedDate) {
      const meeting = await meetingService.getById(id)
      if (!meeting.scheduleId) {
        throw new Error('日程が未確定のMTは実施日(executedDate)を指定してください')
      }
      const { data: schedule, error: scheduleError } = await supabase
        .from('schedules')
        .select('date')
        .eq('id', meeting.scheduleId)
        .single()
      if (scheduleError || !schedule) throw scheduleError ?? new Error('連携先の予定が見つかりません')
      resolvedExecutedDate = schedule.date
    }

    const { data, error } = await supabase
      .from('meetings')
      .update({
        status: 'done',
        executed_date: resolvedExecutedDate,
      })
      .eq('id', id)
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('MTの実施済登録に失敗しました')
    return toMeeting(data as unknown as MeetingRow)
  },

  // 具体的な日程が決まった schedules 行と連携する
  // WHERE id = ? AND schedule_id IS NULL 相当の条件付き更新にすることで、
  // 同一MTに対する confirmSchedule の同時実行があっても二重に紐付かないようにする。
  // 条件不一致（0件更新）の場合は呼び出し元（confirmSchedule）が
  // 直前に作成した schedule をrollbackできるよう、必ずエラーを投げる。
  async setScheduleId(id: string, scheduleId: string): Promise<Meeting> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meetings')
      .update({ schedule_id: scheduleId })
      .eq('id', id)
      .is('schedule_id', null)
      .select(SELECT_WITH_JOINS)
      .maybeSingle()
    if (error) throw error
    if (!data) {
      throw new Error(
        'schedule_idの設定に失敗しました（同時にほかの日程確定処理が行われたか、MTが存在しません）'
      )
    }
    return toMeeting(data as unknown as MeetingRow)
  },

  // 日程未定に戻す（schedules 側の予定が削除された場合など）
  async clearScheduleId(id: string): Promise<Meeting> {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('meetings')
      .update({ schedule_id: null })
      .eq('id', id)
      .select(SELECT_WITH_JOINS)
      .single()
    if (error || !data) throw error ?? new Error('schedule_idの解除に失敗しました')
    return toMeeting(data as unknown as MeetingRow)
  },

  // ---------------------------------------------------------
  // 年間計画再生成
  //
  // 指定した meeting_frequencies（施設×MT種別の頻度設定）に基づき、
  // 指定した暦年(1〜12月)の target_month 一覧を計算し、
  //   - 新しい対象月のうち、まだ行が存在しない月だけ INSERT する
  //   - 既存の自動生成行のうち、以下を「すべて」満たすものだけ
  //     新しい対象月に含まれていなければ DELETE する
  //       ・frequency_id が対象ルールと一致（自動生成行）
  //       ・schedule_id が NULL（日程未確定）
  //       ・status が 'scheduled'（未実施）
  //       ・meeting_minutes が存在しない（議事録なし）
  //   - 上記条件を満たさない行（日程確定済・実施済・議事録あり・
  //     手動追加行）は対象月から外れていても一切変更・削除しない
  // ---------------------------------------------------------
  async regenerateYear(
    frequencyId: string,
    year: number
  ): Promise<{ insertedMonths: string[]; deletedMonths: string[] }> {
    const supabase = createClient()

    const { data: frequency, error: freqError } = await supabase
      .from('meeting_frequencies')
      .select('id, facility_id, meeting_type, interval_months, start_month, active')
      .eq('id', frequencyId)
      .single()
    if (freqError || !frequency) throw freqError ?? new Error('MT頻度設定が見つかりません')

    // 無効化された頻度設定は「新しい対象月なし」として扱う。
    // これにより、未確定・未実施・議事録なしの自動生成プレースホルダーは
    // 下の削除ロジックで整理され、確定済み・実施済み等は保護されたまま残る。
    const targetMonthNumbers: number[] = []
    if (frequency.active) {
      for (let m = frequency.start_month; m <= 12; m += frequency.interval_months) {
        targetMonthNumbers.push(m)
      }
    }
    const newTargetMonths = targetMonthNumbers.map(
      m => `${year}-${String(m).padStart(2, '0')}-01`
    )
    const newTargetMonthSet = new Set(newTargetMonths)

    const { from, to } = yearRange(year)
    const { data: existingRows, error: existingError } = await supabase
      .from('meetings')
      .select(SELECT_WITH_JOINS)
      .eq('facility_id', frequency.facility_id)
      .eq('meeting_type', frequency.meeting_type)
      .gte('target_month', from)
      .lt('target_month', to)
    if (existingError) throw existingError

    const existing = (existingRows ?? []).map(row => toMeeting(row as unknown as MeetingRow))
    const existingMonthSet = new Set(existing.map(m => m.targetMonth))

    // 削除可能: 自動生成行 かつ 日程未確定 かつ 未実施 かつ 議事録なし かつ 新パターン外
    const deletableIds = existing
      .filter(m =>
        m.frequencyId === frequencyId &&
        m.scheduleId === null &&
        m.status === 'scheduled' &&
        m.minutesCount === 0 &&
        !newTargetMonthSet.has(m.targetMonth)
      )
      .map(m => m.id)

    let deletedMonths: string[] = []
    if (deletableIds.length > 0) {
      const deletedTargets = existing
        .filter(m => deletableIds.includes(m.id))
        .map(m => m.targetMonth)
      const { error: deleteError } = await supabase
        .from('meetings')
        .delete()
        .in('id', deletableIds)
      if (deleteError) throw deleteError
      deletedMonths = deletedTargets
    }

    // 追加: まだ行が存在しない対象月のみ
    const monthsToInsert = newTargetMonths.filter(m => !existingMonthSet.has(m))
    let insertedMonths: string[] = []
    if (monthsToInsert.length > 0) {
      const rows = monthsToInsert.map(targetMonth => ({
        facility_id: frequency.facility_id,
        meeting_type: frequency.meeting_type,
        target_month: targetMonth,
        frequency_id: frequencyId,
        status: 'scheduled' as const,
      }))
      // UNIQUE(facility_id, meeting_type, target_month) により重複作成は防止される
      const { error: insertError } = await supabase
        .from('meetings')
        .insert(rows)
      if (insertError) throw insertError
      insertedMonths = monthsToInsert
    }

    return { insertedMonths, deletedMonths }
  },

  // ---------------------------------------------------------
  // 年間計画の手動調整（cycle_anchor_yearのような恒久的な周期変更は行わない。
  // meeting_frequencies（start_month/interval_months）には一切触れず、
  // 既存 meetings 行の target_month を直接動かすだけのシンプルな機能）
  // ---------------------------------------------------------

  // 同一施設・同一MT種別・同一target_monthの既存行があるか確認する
  // （UNIQUE制約に当たる前にUI側で分かりやすいエラーを出すための事前チェック）
  async hasTargetMonthConflict(
    facilityId: string,
    meetingType: MeetingType,
    targetMonth: string,
    excludeId?: string
  ): Promise<boolean> {
    const supabase = createClient()
    let query = supabase
      .from('meetings')
      .select('id')
      .eq('facility_id', facilityId)
      .eq('meeting_type', meetingType)
      .eq('target_month', normalizeTargetMonth(targetMonth))
    if (excludeId) query = query.neq('id', excludeId)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []).length > 0
  },

  // 計画月を移動する（このMTだけ）。schedules側には一切触れない。
  async moveTargetMonth(id: string, newTargetMonth: string): Promise<Meeting> {
    const meeting = await meetingService.getById(id)
    const normalized = normalizeTargetMonth(newTargetMonth)
    if (normalized === meeting.targetMonth) return meeting

    const conflict = await meetingService.hasTargetMonthConflict(
      meeting.facilityId, meeting.meetingType, normalized, id
    )
    if (conflict) {
      throw new Error('移動先の月には既にMTの計画があります')
    }
    return meetingService.update(id, { targetMonth: normalized })
  },

  // 計画月を移動し、「今回以降」の未確定・自動生成MTも同じ月数だけまとめて移動する。
  // meeting_frequencies（start_month/interval_months）は変更しない。
  //
  // 移動対象の条件（すべて満たすものだけ）:
  //   ・同一 facility_id / meeting_type / frequency_id（自動生成行）
  //   ・target_month が今回のMTより後
  //   ・schedule_id が NULL（日程未確定）
  //   ・status が 'scheduled'（未実施）
  //   ・meeting_minutes が存在しない（議事録なし）
  // 上記を満たさない行（日程確定済・実施済・議事録あり・手動追加・今回より前）は
  // 対象から除外し、絶対に変更しない。
  //
  // 移動前に全移動先の重複チェックを行い、1件でも衝突があれば
  // 何も更新せずエラーにする（部分的な更新を避ける）。
  async moveTargetMonthCascade(
    id: string,
    newTargetMonth: string
  ): Promise<{ moved: Meeting; shifted: Meeting[] }> {
    const supabase = createClient()
    const meeting = await meetingService.getById(id)
    const normalizedNew = normalizeTargetMonth(newTargetMonth)
    if (normalizedNew === meeting.targetMonth) {
      return { moved: meeting, shifted: [] }
    }

    const { year: oldYear, month: oldMonth } = parseTargetMonth(meeting.targetMonth)
    const { year: newYear, month: newMonth } = parseTargetMonth(normalizedNew)
    const deltaMonths = (newYear * 12 + newMonth) - (oldYear * 12 + oldMonth)

    // 移動候補（同じ自動生成シリーズのうち、今回より後で未着手のもの）
    let candidates: Meeting[] = []
    if (meeting.frequencyId) {
      const { data: candidateRows, error: candErr } = await supabase
        .from('meetings')
        .select(SELECT_WITH_JOINS)
        .eq('facility_id', meeting.facilityId)
        .eq('meeting_type', meeting.meetingType)
        .eq('frequency_id', meeting.frequencyId)
        .gt('target_month', meeting.targetMonth)
      if (candErr) throw candErr
      candidates = (candidateRows ?? [])
        .map(row => toMeeting(row as unknown as MeetingRow))
        .filter(m => m.scheduleId === null && m.status === 'scheduled' && m.minutesCount === 0)
    }

    // 移動先を計算
    const moves: Array<{ id: string; to: string }> = [{ id: meeting.id, to: normalizedNew }]
    for (const c of candidates) {
      const { year, month } = parseTargetMonth(c.targetMonth)
      const absIndex = year * 12 + month + deltaMonths
      const toYear = Math.floor((absIndex - 1) / 12)
      const toMonth = ((absIndex - 1) % 12) + 1
      moves.push({ id: c.id, to: buildTargetMonth(toYear, toMonth) })
    }

    // 移動先同士の重複チェック
    const destinations = new Set<string>()
    for (const mv of moves) {
      if (destinations.has(mv.to)) {
        throw new Error(`移動先の月が重複しています（${mv.to}）`)
      }
      destinations.add(mv.to)
    }

    // 移動対象外の既存行との衝突チェック（更新前にすべて確認する）
    const movingIds = new Set(moves.map(m => m.id))
    const { data: existingAtDestinations, error: existErr } = await supabase
      .from('meetings')
      .select('id, target_month')
      .eq('facility_id', meeting.facilityId)
      .eq('meeting_type', meeting.meetingType)
      .in('target_month', Array.from(destinations))
    if (existErr) throw existErr
    const conflictRow = (existingAtDestinations ?? []).find(row => !movingIds.has(row.id))
    if (conflictRow) {
      throw new Error(`移動先の月（${conflictRow.target_month}）には既に別のMTの計画があります`)
    }

    // 事前チェックがすべて通ってから更新する
    const updated: Meeting[] = []
    for (const mv of moves) {
      updated.push(await meetingService.update(mv.id, { targetMonth: mv.to }))
    }

    const moved = updated.find(m => m.id === meeting.id)!
    const shifted = updated.filter(m => m.id !== meeting.id)
    return { moved, shifted }
  },

  // この月の予定（meeting 1件）を削除する。meeting_frequenciesは変更しない。
  // 削除できるのは 日程未確定・未実施・議事録なし の場合のみ。
  async deleteIfSafe(id: string): Promise<void> {
    const supabase = createClient()
    const meeting = await meetingService.getById(id)
    if (meeting.scheduleId !== null) {
      throw new Error('日程確定済みのMTは削除できません。先に日程を取り消してください')
    }
    if (meeting.status !== 'scheduled') {
      throw new Error('実施済みのMTは削除できません')
    }
    if (meeting.minutesCount > 0) {
      throw new Error('議事録が登録されているMTは削除できません')
    }
    const { error } = await supabase.from('meetings').delete().eq('id', id)
    if (error) throw error
  },
}
