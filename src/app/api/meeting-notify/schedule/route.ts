import { NextRequest, NextResponse } from 'next/server'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import {
  getMailConfig, sendMail, createServerSupabase, claimStaleBeforeIso, UUID_RE,
  formatDateJpFull, formatMonthDay, formatYearMonth, toTimeHm,
} from '@/lib/server/notifyMail'

// MT予定確定通知（1MTにつき原則1回）。
//
// 呼び出し元はクライアントの「日付・時間を初めて確定した操作」のみ
//   （MT新規登録で日付あり / 日程未定MTへの予定保存）。日程変更・取消などからは呼ばない。
// サーバー側でも「schedule_id あり かつ schedule_notified_at が NULL」のMTだけを対象にし、
// 条件付きUPDATEで送信権（schedule_notify_claimed_at）を確保してから送信することで、
// 同一MTへの並行リクエストや再送による二重送信を防ぐ。
//
// 通知管理列（schedule_notified_at / schedule_notify_claimed_at）の更新はこのRoute内だけで行う。

const LOG_TAG = 'meeting-notify/schedule'

type MeetingForMail = {
  id: string
  meeting_type: 'facility' | 'kitchen'
  target_month: string
  memo: string
  facilities: { name: string } | null
  schedules: {
    date: string
    start_time: string
    end_time: string
    is_all_day: boolean
    group_managers: { name: string } | null
    staff_members: { name: string } | null
  } | null
}

export async function POST(request: NextRequest) {
  let meetingId = ''
  try {
    const body = await request.json().catch(() => ({}))
    meetingId = typeof body?.meetingId === 'string' ? body.meetingId : ''
  } catch {
    // noop
  }
  if (!UUID_RE.test(meetingId)) {
    return NextResponse.json({ status: 'error', error: 'meetingId が不正です' }, { status: 400 })
  }

  const cfg = getMailConfig()
  if ('error' in cfg) {
    console.error(`[${LOG_TAG}] ${cfg.error}`)
    return NextResponse.json({ status: 'error', error: cfg.error }, { status: 500 })
  }

  const supabase = createServerSupabase()

  // 1) 送信権の確保（1回のUPDATEで判定と確保を同時に行う。並行リクエストでは片方だけが成功する）
  const { data: claimed, error: claimError } = await supabase
    .from('meetings')
    .update({ schedule_notify_claimed_at: new Date().toISOString() })
    .eq('id', meetingId)
    .not('schedule_id', 'is', null)
    .is('schedule_notified_at', null)
    .or(`schedule_notify_claimed_at.is.null,schedule_notify_claimed_at.lt.${claimStaleBeforeIso()}`)
    .select('id')
  if (claimError) {
    console.error(`[${LOG_TAG}] claim error:`, claimError)
    return NextResponse.json({ status: 'error', error: '通知状態の確認に失敗しました' }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    // 通知済み / 処理中 / 日程未確定 のいずれか。重複送信しない（エラー扱いにはしない）
    return NextResponse.json({ status: 'skipped' })
  }

  let completed = false
  try {
    // 2) メール内容をDBの最新状態から組み立てる（クライアントから文面は受け取らない）
    const { data, error } = await supabase
      .from('meetings')
      .select(`
        id, meeting_type, target_month, memo,
        facilities ( name ),
        schedules ( date, start_time, end_time, is_all_day, group_managers ( name ), staff_members ( name ) )
      `)
      .eq('id', meetingId)
      .single()
    if (error || !data) throw error ?? new Error('MTが見つかりません')
    const m = data as unknown as MeetingForMail
    if (!m.schedules) throw new Error('MTの予定が見つかりません')

    const s = m.schedules
    const facilityName = m.facilities?.name ?? '（施設不明）'
    const typeLabel = MEETING_TYPE_LABELS[m.meeting_type]
    const assignee = s.group_managers?.name ?? s.staff_members?.name ?? '未設定'
    const timeText = s.is_all_day ? '終日' : `${toTimeHm(s.start_time)}〜${toTimeHm(s.end_time)}`

    const subject = `【MT予定登録】${facilityName}／${typeLabel}／${formatMonthDay(s.date)}`
    const text = [
      'MTの予定が登録されました。',
      '',
      `施設：${facilityName}`,
      `MT種別：${typeLabel}`,
      `担当者：${assignee}`,
      `実施予定日：${formatDateJpFull(s.date)}`,
      `時間：${timeText}`,
      `計画月：${formatYearMonth(m.target_month)}`,
      `メモ：${m.memo?.trim() || '（なし）'}`,
    ].join('\n')

    // 3) 送信
    const result = await sendMail(cfg.config, { subject, text }, LOG_TAG)
    if (!result.ok) {
      return NextResponse.json({ status: 'error', error: 'メール送信に失敗しました' }, { status: 502 })
    }

    // 4) 成功時のみ通知済みにする
    const { error: markError } = await supabase
      .from('meetings')
      .update({ schedule_notified_at: new Date().toISOString(), schedule_notify_claimed_at: null })
      .eq('id', meetingId)
    if (markError) {
      // メールは送信済み。目印は残る（期限切れまで再送されない）ため、ログのみ残して成功扱いにする
      console.error(`[${LOG_TAG}] mark notified error (mail was sent):`, markError)
    }
    completed = true
    return NextResponse.json({ status: 'sent' })
  } catch (err) {
    console.error(`[${LOG_TAG}] unexpected error:`, err)
    return NextResponse.json({ status: 'error', error: '通知処理中にエラーが発生しました' }, { status: 500 })
  } finally {
    if (!completed) {
      // 送信失敗・途中エラー時は処理中の目印だけを外し、schedule_notified_at は NULL のまま（再試行可能）
      const { error } = await supabase
        .from('meetings')
        .update({ schedule_notify_claimed_at: null })
        .eq('id', meetingId)
        .is('schedule_notified_at', null)
      if (error) console.error(`[${LOG_TAG}] release claim error:`, error)
    }
  }
}
