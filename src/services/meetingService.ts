import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/types/database'
import type {
  Meeting, MeetingType, CreateManualMeetingInput, UpdateMeetingInput,
} from '@/lib/types'

// JOIN を含む SELECT フィールド定義
// meeting_minutes(count) は行を取得せず件数のみ取得する PostgREST の集計構文
// schedules(date, group_managers(name)) は日程確定済みの場合の実施予定日・担当G長を
// 年間計画UI/ダッシュボードに表示するためのJOIN
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
  schedules ( date, group_managers ( name ) )
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
  schedules: { date: string; group_managers: { name: string } | null } | null
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
    scheduleGroupManagerName: row.schedules?.group_managers?.name ?? null,
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
}
