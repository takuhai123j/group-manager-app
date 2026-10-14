import { NextRequest, NextResponse } from 'next/server'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import {
  getMailConfig, sendMail, createServerSupabase, claimStaleBeforeIso, UUID_RE, type MailConfig,
  formatDateJpFull, formatMonthDay, formatYearMonth, toTimeHm,
} from '@/lib/server/notifyMail'

// MT予定確定通知（1MTにつき原則1回。同時開催中のMTは同時開催1組につき1回 → notifyJointGroup）。
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

  // 同時開催中のMTは、同時開催1組につき1通にまとめる（どちらのMTのIDで呼ばれても同じ1通）
  const { data: target, error: targetError } = await supabase
    .from('meetings')
    .select('joint_group_id')
    .eq('id', meetingId)
    .maybeSingle()
  if (targetError) {
    console.error(`[${LOG_TAG}] load error:`, targetError)
    return NextResponse.json({ status: 'error', error: '通知状態の確認に失敗しました' }, { status: 500 })
  }
  if (target?.joint_group_id) {
    return notifyJointGroup(supabase, cfg.config, target.joint_group_id)
  }

  // ── 単独MT（従来どおり） ──
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

// ── 同時開催（施設MT＋厨房MT）の予定確定通知：同時開催1組につき1通 ──
//
// 同時開催の2件は同じ schedules 行を共有し、通知済み状態（schedule_notified_at）も
// 結合・解除のRPCが2件で揃えている（結合時は2件の最新値、解除時は複製先へ引き継ぎ）。
// そのため「2件とも未通知」の場合だけ送り、1件でも通知済みなら送らない
// （後から結合・解除・相手の変更をしても、送信済みの予定を再通知しない）。
// 送信権は2件を1回のUPDATEで確保し、2件とも確保できた場合だけ送る（並行リクエストでは片方だけが送る）。

type JointMemberForMail = MeetingForMail & { schedule_id: string | null }

const JOINT_TYPE_ORDER: Record<'facility' | 'kitchen', number> = { facility: 0, kitchen: 1 }

async function notifyJointGroup(
  supabase: ReturnType<typeof createServerSupabase>,
  config: MailConfig,
  groupId: string,
): Promise<NextResponse> {
  // 1) 送信権の確保（同時開催の2件をまとめて確保する）
  const { data: claimed, error: claimError } = await supabase
    .from('meetings')
    .update({ schedule_notify_claimed_at: new Date().toISOString() })
    .eq('joint_group_id', groupId)
    .not('schedule_id', 'is', null)
    .is('schedule_notified_at', null)
    .or(`schedule_notify_claimed_at.is.null,schedule_notify_claimed_at.lt.${claimStaleBeforeIso()}`)
    .select('id')
  if (claimError) {
    console.error(`[${LOG_TAG}] joint claim error:`, claimError)
    return NextResponse.json({ status: 'error', error: '通知状態の確認に失敗しました' }, { status: 500 })
  }
  const claimedIds = (claimed ?? []).map(r => r.id)
  if (claimedIds.length !== 2) {
    // 通知済み / 処理中 / 日程未確定 のいずれか（1件だけ確保できた場合も、もう一方が通知済み・処理中なので送らない）
    if (claimedIds.length > 0) await releaseClaims(supabase, claimedIds)
    return NextResponse.json({ status: 'skipped' })
  }

  let completed = false
  try {
    // 2) メール内容をDBの最新状態から組み立てる
    const { data, error } = await supabase
      .from('meetings')
      .select(`
        id, meeting_type, target_month, memo, schedule_id,
        facilities ( name ),
        schedules ( date, start_time, end_time, is_all_day, group_managers ( name ), staff_members ( name ) )
      `)
      .in('id', claimedIds)
    if (error || !data) throw error ?? new Error('MTが見つかりません')
    const members = (data as unknown as JointMemberForMail[])
      .sort((a, b) => JOINT_TYPE_ORDER[a.meeting_type] - JOINT_TYPE_ORDER[b.meeting_type])
    if (members.length !== 2 || members[0].schedule_id !== members[1].schedule_id || !members[0].schedules) {
      throw new Error('同時開催の予定が一致しません')
    }

    const { subject, text } = buildJointScheduleMail(members)

    // 3) 送信
    const result = await sendMail(config, { subject, text }, LOG_TAG)
    if (!result.ok) {
      return NextResponse.json({ status: 'error', error: 'メール送信に失敗しました' }, { status: 502 })
    }

    // 4) 成功時のみ2件とも通知済みにする
    const { error: markError } = await supabase
      .from('meetings')
      .update({ schedule_notified_at: new Date().toISOString(), schedule_notify_claimed_at: null })
      .in('id', claimedIds)
    if (markError) console.error(`[${LOG_TAG}] joint mark notified error (mail was sent):`, markError)
    completed = true
    return NextResponse.json({ status: 'sent' })
  } catch (err) {
    console.error(`[${LOG_TAG}] joint unexpected error:`, err)
    return NextResponse.json({ status: 'error', error: '通知処理中にエラーが発生しました' }, { status: 500 })
  } finally {
    if (!completed) await releaseClaims(supabase, claimedIds)
  }
}

// 送信失敗・途中エラー時は処理中の目印だけを外す（schedule_notified_at は NULL のまま＝再試行可能）
async function releaseClaims(supabase: ReturnType<typeof createServerSupabase>, ids: string[]) {
  const { error } = await supabase
    .from('meetings')
    .update({ schedule_notify_claimed_at: null })
    .in('id', ids)
    .is('schedule_notified_at', null)
  if (error) console.error(`[${LOG_TAG}] release claim error:`, error)
}

// 同時開催の予定確定メール。施設MT・厨房MTの両方の種別を件名・本文に載せる。
// 計画月・メモは2件で異なる場合があるため、異なる場合だけ種別ごとに分けて表示する
function buildJointScheduleMail(members: JointMemberForMail[]): { subject: string; text: string } {
  const s = members[0].schedules!
  const facilityName = members[0].facilities?.name ?? '（施設不明）'
  const typeLabels = members.map(m => MEETING_TYPE_LABELS[m.meeting_type]).join('・')
  const assignee = s.group_managers?.name ?? s.staff_members?.name ?? '未設定'
  const timeText = s.is_all_day ? '終日' : `${toTimeHm(s.start_time)}〜${toTimeHm(s.end_time)}`

  const months = members.map(m => formatYearMonth(m.target_month))
  const monthText = months[0] === months[1]
    ? months[0]
    : members.map((m, i) => `${MEETING_TYPE_LABELS[m.meeting_type]} ${months[i]}`).join('／')

  // メモ：両方なし →「（なし）」、同じ内容 → 1行、片方だけ →「メモ（施設MT）：…」、
  // 両方あり・内容が違う → 種別ごとに1行ずつ（長いメモでも読みやすいよう「／」でつながない）
  const memos = members.map(m => m.memo?.trim() ?? '')
  const withMemo = members.map((m, i) => ({ label: MEETING_TYPE_LABELS[m.meeting_type], memo: memos[i] })).filter(x => x.memo)
  const memoLines = withMemo.length === 0
    ? ['メモ：（なし）']
    : withMemo.length === 1
      ? [`メモ（${withMemo[0].label}）：${withMemo[0].memo}`]
      : memos[0] === memos[1]
        ? [`メモ：${memos[0]}`]
        : ['メモ：', ...withMemo.map(x => `　${x.label}：${x.memo}`)]

  const subject = `【MT予定登録】${facilityName}／${typeLabels}（同時開催）／${formatMonthDay(s.date)}`
  const text = [
    'MTの予定が登録されました（施設MTと厨房MTの同時開催です）。',
    '',
    `施設：${facilityName}`,
    `MT種別：${typeLabels}（同時開催）`,
    `担当者：${assignee}`,
    `実施予定日：${formatDateJpFull(s.date)}`,
    `時間：${timeText}`,
    `計画月：${monthText}`,
    ...memoLines,
  ].join('\n')
  return { subject, text }
}
