import { NextRequest, NextResponse } from 'next/server'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import {
  getMailConfig, getDryRunMode, sendMail, createServerSupabase, claimStaleBeforeIso, UUID_RE,
  formatDateJpFull, formatYearMonth, type MailAttachment,
} from '@/lib/server/notifyMail'

// MT議事録保存通知（議事録PDF 1件につき1回）。
// 同時開催で共有しているPDFも1件につき1通（notified_at は meeting_minutes 側にあるため、
// 両方のMTに表示されていても1回だけ送る。後から結合しても再通知しない）。
//
// 呼び出し元はクライアントの議事録アップロード成功後（Storage保存・meeting_minutes登録の両方が成功した後）。
// サーバー側でも notified_at が NULL の議事録だけを対象にし、条件付きUPDATEで送信権
// （notify_claimed_at）を確保してから送信することで二重送信を防ぐ。
//
// PDFは private バケットからサーバー側で取得してメールに添付する。取得・添付の準備ができなかった
// 場合に限り、7日間有効な署名付きURLを本文に載せて添付なしで送る。
// Resend 自体の送信失敗は通知失敗として扱い、notified_at は NULL のまま残す（再試行可能）。
//
// 通知管理列（notified_at / notify_claimed_at）の更新はこのRoute内だけで行う。

const LOG_TAG = 'meeting-notify/minute'
const BUCKET = 'meeting-minutes'
const FALLBACK_SIGNED_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60 // 7日

type MinuteForMail = {
  id: string
  file_name: string
  file_path: string
  meetings: {
    meeting_type: 'facility' | 'kitchen'
    target_month: string
    executed_date: string | null
    facilities: { name: string } | null
    schedules: {
      group_managers: { name: string } | null
      staff_members: { name: string } | null
    } | null
  } | null
}

type SharedMeeting = { meeting_type: 'facility' | 'kitchen'; target_month: string }
const SHARED_TYPE_ORDER: Record<'facility' | 'kitchen', number> = { facility: 0, kitchen: 1 }

export async function POST(request: NextRequest) {
  let minuteId = ''
  try {
    const body = await request.json().catch(() => ({}))
    minuteId = typeof body?.minuteId === 'string' ? body.minuteId : ''
  } catch {
    // noop
  }
  if (!UUID_RE.test(minuteId)) {
    return NextResponse.json({ status: 'error', error: 'minuteId が不正です' }, { status: 400 })
  }

  const cfg = getMailConfig()
  if ('error' in cfg) {
    console.error(`[${LOG_TAG}] ${cfg.error}`)
    return NextResponse.json({ status: 'error', error: cfg.error }, { status: 500 })
  }

  const supabase = createServerSupabase()

  // 1) 送信権の確保（1回のUPDATEで判定と確保を同時に行う）
  const { data: claimed, error: claimError } = await supabase
    .from('meeting_minutes')
    .update({ notify_claimed_at: new Date().toISOString() })
    .eq('id', minuteId)
    .is('notified_at', null)
    .or(`notify_claimed_at.is.null,notify_claimed_at.lt.${claimStaleBeforeIso()}`)
    .select('id')
  if (claimError) {
    console.error(`[${LOG_TAG}] claim error:`, claimError)
    return NextResponse.json({ status: 'error', error: '通知状態の確認に失敗しました' }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ status: 'skipped' })
  }

  let completed = false
  try {
    // 2) メール内容をDBの最新状態から組み立てる
    //    meetings は所有者FK（meeting_minutes.meeting_id）経由と明示する（他の経路が増えても曖昧にしない）
    const { data, error } = await supabase
      .from('meeting_minutes')
      .select(`
        id, file_name, file_path,
        meetings!meeting_minutes_meeting_id_fkey (
          meeting_type, target_month, executed_date,
          facilities ( name ),
          schedules ( group_managers ( name ), staff_members ( name ) )
        )
      `)
      .eq('id', minuteId)
      .single()
    if (error || !data) throw error ?? new Error('議事録が見つかりません')
    const row = data as unknown as MinuteForMail
    const m = row.meetings
    if (!m) throw new Error('議事録のMTが見つかりません')

    const facilityName = m.facilities?.name ?? '（施設不明）'
    const typeLabel = MEETING_TYPE_LABELS[m.meeting_type]
    const assignee = m.schedules?.group_managers?.name ?? m.schedules?.staff_members?.name ?? '未設定'

    // 同時開催で共有しているPDF（2件以上のMTに紐付く）は、PDF 1件につき1通のまま、
    // 紐付いている全てのMT種別を件名・本文に載せる。単独のPDFは従来どおりの文面
    const { data: linkRows, error: linkError } = await supabase
      .from('meeting_minute_links')
      .select('meetings ( meeting_type, target_month )')
      .eq('minute_id', minuteId)
    if (linkError) throw linkError
    const linked = ((linkRows ?? []) as unknown as { meetings: SharedMeeting | null }[])
      .map(r => r.meetings)
      .filter((x): x is SharedMeeting => x !== null)
      .sort((a, b) => SHARED_TYPE_ORDER[a.meeting_type] - SHARED_TYPE_ORDER[b.meeting_type])
    const shared = linked.length > 1

    // 3) PDFを取得して添付を準備。できなかった場合のみ7日間の署名付きURLにフォールバック
    let attachments: MailAttachment[] | undefined
    let fallbackNote: string | null = null
    try {
      if (getDryRunMode() === 'attach-fail') throw new Error('dry-run: simulated download failure')
      const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(row.file_path)
      if (dlError || !blob) throw dlError ?? new Error('PDFを取得できませんでした')
      attachments = [{ filename: row.file_name, content: Buffer.from(await blob.arrayBuffer()) }]
    } catch (attachErr) {
      console.error(`[${LOG_TAG}] attachment unavailable, falling back to signed URL:`, attachErr)
      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.file_path, FALLBACK_SIGNED_URL_EXPIRES_IN_SECONDS)
      fallbackNote = signed?.signedUrl
        ? `PDFを添付できなかったため、以下のリンクから確認してください（7日間有効）\n${signed.signedUrl}`
        : 'PDFを添付できず、確認用リンクも作成できませんでした。アプリのMT年間計画から議事録を確認してください。'
      if (signError) console.error(`[${LOG_TAG}] signed URL error:`, signError)
    }

    const sharedTypes = linked.map(x => MEETING_TYPE_LABELS[x.meeting_type]).join('・')
    const sharedMonths = linked.map(x => formatYearMonth(x.target_month))
    const sharedMonthText = sharedMonths.every(v => v === sharedMonths[0])
      ? sharedMonths[0]
      : linked.map((x, i) => `${MEETING_TYPE_LABELS[x.meeting_type]} ${sharedMonths[i]}`).join('／')

    const subject = shared
      ? `【MT議事録登録】${facilityName}／${sharedTypes}（同時開催）／${formatYearMonth(m.target_month)}`
      : `【MT議事録登録】${facilityName}／${typeLabel}／${formatYearMonth(m.target_month)}`
    const lines = [
      shared ? 'MTの議事録が登録されました（施設MTと厨房MTの同時開催で共有している議事録です）。' : 'MTの議事録が登録されました。',
      '',
      `施設：${facilityName}`,
      shared ? `MT種別：${sharedTypes}（同時開催）` : `MT種別：${typeLabel}`,
      `計画月：${shared ? sharedMonthText : formatYearMonth(m.target_month)}`,
      `実施日：${m.executed_date ? formatDateJpFull(m.executed_date) : '未設定'}`,
      `担当者：${assignee}`,
      `PDFファイル名：${row.file_name}`,
    ]
    if (fallbackNote) lines.push('', fallbackNote)

    // 4) 送信（Resend自体の失敗は通知失敗）
    const result = await sendMail(cfg.config, { subject, text: lines.join('\n'), attachments }, LOG_TAG)
    if (!result.ok) {
      return NextResponse.json({ status: 'error', error: 'メール送信に失敗しました' }, { status: 502 })
    }

    // 5) 成功時のみ通知済みにする
    const { error: markError } = await supabase
      .from('meeting_minutes')
      .update({ notified_at: new Date().toISOString(), notify_claimed_at: null })
      .eq('id', minuteId)
    if (markError) console.error(`[${LOG_TAG}] mark notified error (mail was sent):`, markError)
    completed = true
    return NextResponse.json({ status: 'sent', attached: !!attachments })
  } catch (err) {
    console.error(`[${LOG_TAG}] unexpected error:`, err)
    return NextResponse.json({ status: 'error', error: '通知処理中にエラーが発生しました' }, { status: 500 })
  } finally {
    if (!completed) {
      const { error } = await supabase
        .from('meeting_minutes')
        .update({ notify_claimed_at: null })
        .eq('id', minuteId)
        .is('notified_at', null)
      if (error) console.error(`[${LOG_TAG}] release claim error:`, error)
    }
  }
}
