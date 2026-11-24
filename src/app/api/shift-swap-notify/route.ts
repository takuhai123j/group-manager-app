import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { getMailConfig, UUID_RE, type MailConfig } from '@/lib/server/notifyMail'
import { createSwapNotifyServerClient } from '@/lib/server/swapNotifyServerClient'
import {
  buildShiftSwapMailSubject, buildShiftSwapMailText, parseShiftSwapMailContent, type ShiftSwapMailAction,
} from '@/lib/shiftSwapMail'

// 勤務・休日振替（振替出勤・振替休日）の本部向け通知（登録・変更・取消。操作ごとに1通）。
//
// 画面からは操作IDだけを受け取る（文面・宛先・送信結果は受け取らない）。送信状態を変える DB の関数は service_role だけが実行でき、
// ここからサーバー専用キー（SUPABASE_SECRET_KEY）で呼ぶ。キーが未設定なら何もせずに止める（通知は未送信のまま残る）。
// 「要確認」の片付け（届いていた／送り直す）はこの API では扱わない（本部管理者が Dashboard で行う）。
//文面は DB の操作の記録（保存・取消と同じトランザクションで
// 作られた内容）からここで作る。送信状態は DB の関数でだけ変える:
//   1) shift_change_swap_notify_claim  … 送信の確保（送信済み・送信中・要確認なら確保できず、その状態を返す）
//   2) Resend へ送信（Idempotency-Key = 'shift-swap-op/<操作ID>/<版>'。同じキー・同じ内容の再送は Resend が送らない。キーの保持は24時間）
//   3) shift_change_swap_notify_finish … 結果の記録（sent / failed（明確に受け付けられなかった）/ unknown（送れたか分からない））
// 結果不明のまま 23 時間を過ぎた通知は DB 側で要確認（needs_check）になり、自動では送り直さない。
// 宛先・送信元・APIキーは既存のシフト変更通知と同じ環境変数（RESEND_API_KEY / SHIFT_CHANGE_NOTIFY_EMAILS / SHIFT_CHANGE_NOTIFY_FROM）。
// 既存のシフト変更通知・MT通知の処理は使い回さない（変更しない）

const LOG_TAG = 'shift-swap-notify'

type ClaimResult =
  | { status: 'sent' | 'sending' | 'needs_check' }
  | {
      status: 'claimed'
      claim_token: string
      idempotency_key: string
      action: ShiftSwapMailAction
      content: unknown
      before: unknown
    }

type Outcome = { outcome: 'sent' | 'failed' | 'unknown'; messageId: string | null; error: string | null }

// ── 開発環境だけの送信の模擬（本番では無効） ──────────────────────────────
//   SHIFT_SWAP_NOTIFY_DRY_RUN=ok|fail|unknown（既定の結果）。リクエストヘッダー x-swap-notify-dry-run で1回だけ上書きできる。
//   Resend の重複防止（同じキー・同じ内容なら送らない）もメモリ上で真似る。実際のメールは送らない
type DryRunMode = 'ok' | 'fail' | 'unknown'
const dryRunSent = new Map<string, string>() // 重複防止キー → 内容のハッシュ（「送った」とみなした分）
function getSwapDryRun(req: NextRequest): DryRunMode | null {
  if (process.env.NODE_ENV === 'production') return null
  const base = process.env.SHIFT_SWAP_NOTIFY_DRY_RUN
  if (base !== 'ok' && base !== 'fail' && base !== 'unknown') return null
  const once = req.headers.get('x-swap-notify-dry-run')
  return once === 'ok' || once === 'fail' || once === 'unknown' ? once : base
}
function dryRunSend(mode: DryRunMode, key: string, mail: { subject: string; text: string }): Outcome {
  const hash = createHash('sha256').update(`${mail.subject}\n${mail.text}`).digest('hex')
  const prev = dryRunSent.get(key)
  if (prev !== undefined) {
    if (prev !== hash) {
      console.log(`[${LOG_TAG}] DRY RUN 409 invalid_idempotent_request`, JSON.stringify({ key }))
      return { outcome: 'unknown', messageId: null, error: 'invalid_idempotent_request' }
    }
    // 同じキー・同じ内容: Resend は送らずに前回と同じ応答を返す
    console.log(`[${LOG_TAG}] DRY RUN DEDUPLICATED (not sent again)`, JSON.stringify({ key }))
    return { outcome: mode === 'fail' ? 'failed' : 'sent', messageId: `dry-run-${key}`, error: null }
  }
  if (mode === 'fail') {
    console.log(`[${LOG_TAG}] DRY RUN FAIL (not sent)`, JSON.stringify({ key }))
    return { outcome: 'failed', messageId: null, error: 'dry-run: validation_error' }
  }
  dryRunSent.set(key, hash)
  console.log(`[${LOG_TAG}] DRY RUN SENT`, JSON.stringify({ key, subject: mail.subject, text: mail.text }))
  // unknown: 送ったが応答が届かなかった（通信切れ）ことを模擬する
  return mode === 'unknown'
    ? { outcome: 'unknown', messageId: null, error: 'dry-run: network error after send' }
    : { outcome: 'sent', messageId: `dry-run-${key}`, error: null }
}

// ── Resend へ送信（重複防止キー付き） ──────────────────────────────────
async function resendSend(config: MailConfig, key: string, mail: { subject: string; text: string }): Promise<Outcome> {
  try {
    const resend = new Resend(config.apiKey)
    const { data, error } = await resend.emails.send(
      { from: config.from, to: config.to, subject: mail.subject, text: mail.text },
      { idempotencyKey: key },
    )
    if (data?.id) return { outcome: 'sent', messageId: data.id, error: null }
    if (error) {
      const code = error.statusCode ?? null
      // 明確に受け付けられなかった（送られていない）: 4xx のうち、重複防止の衝突（409）以外
      const definite = code !== null && code >= 400 && code < 500 && code !== 409
      console.error(`[${LOG_TAG}] Resend error:`, JSON.stringify({ name: error.name, statusCode: code }))
      return { outcome: definite ? 'failed' : 'unknown', messageId: null, error: `${error.name}${code ? ` (${code})` : ''}` }
    }
    return { outcome: 'unknown', messageId: null, error: 'Resend から結果が返りませんでした' }
  } catch (err) {
    console.error(`[${LOG_TAG}] Resend unexpected error:`, err)
    return { outcome: 'unknown', messageId: null, error: '送信中に通信エラーが発生しました' }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { operationId?: unknown } | null
  const operationId = typeof body?.operationId === 'string' ? body.operationId : ''
  // 操作ID以外（文面・宛先など）は受け取らない
  if (!UUID_RE.test(operationId)) {
    return NextResponse.json({ status: 'error', error: '操作IDが正しくありません' }, { status: 400 })
  }

  const dryRun = getSwapDryRun(request)
  let config: MailConfig | null = null
  if (!dryRun) {
    const cfg = getMailConfig()
    if ('error' in cfg) {
      console.error(`[${LOG_TAG}] ${cfg.error}`)
      return NextResponse.json({ status: 'error', error: cfg.error }, { status: 500 })
    }
    config = cfg.config
  }

  const server = createSwapNotifyServerClient()
  if ('error' in server) {
    // キーの値は出さない（メッセージは設定の有無・種類だけ）
    console.error(`[${LOG_TAG}] ${server.error}`)
    return NextResponse.json({ status: 'error', error: '通知の設定が完了していないため送れません（管理者に連絡してください）' }, { status: 503 })
  }
  const supabase = server.client

  // 1) 送信の確保（送信済み・送信中・要確認なら、その状態を返して送らない）
  const { data: claimData, error: claimError } = await supabase.rpc('shift_change_swap_notify_claim', { p_operation_id: operationId })
  if (claimError) {
    console.error(`[${LOG_TAG}] claim error:`, claimError.message)
    const notFound = (claimError.message ?? '').includes('SCC_NOT_FOUND')
    return NextResponse.json({ status: 'error', error: notFound ? '通知する操作が見つかりません' : '通知の状態を確認できませんでした' }, { status: notFound ? 404 : 500 })
  }
  const claim = claimData as ClaimResult
  if (claim.status !== 'claimed') return NextResponse.json({ status: claim.status })

  // 2) 文面は DB の内容から作る
  const content = parseShiftSwapMailContent(claim.content)
  const before = claim.action === 'update' ? parseShiftSwapMailContent(claim.before) : null
  let result: Outcome
  if (!content || (claim.action === 'update' && !before)) {
    console.error(`[${LOG_TAG}] invalid stored content`, JSON.stringify({ operationId }))
    result = { outcome: 'failed', messageId: null, error: '通知の内容（DB）が正しくありません' }
  } else {
    const payload = { action: claim.action, content, before: before ?? undefined }
    const mail = { subject: buildShiftSwapMailSubject(payload), text: buildShiftSwapMailText(payload) }
    result = dryRun
      ? dryRunSend(dryRun, claim.idempotency_key, mail)
      : await resendSend(config as MailConfig, claim.idempotency_key, mail)
  }

  // 3) 結果を記録する。記録に失敗しても、確保は5分で切れ、同じキーで送り直す（届いていれば Resend が送らない）
  const { error: finishError } = await supabase.rpc('shift_change_swap_notify_finish', {
    p_operation_id: operationId, p_claim_token: claim.claim_token,
    p_outcome: result.outcome, p_message_id: result.messageId, p_error: result.error,
  })
  if (finishError) {
    console.error(`[${LOG_TAG}] finish error (outcome=${result.outcome}):`, finishError.message)
    return NextResponse.json({ status: result.outcome === 'sent' ? 'sending' : 'unknown' })
  }
  return NextResponse.json({ status: result.outcome })
}
