import { Resend } from 'resend'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// MT通知（/api/meeting-notify/*）のサーバー専用ヘルパー。
// ブラウザ側からは import しないこと（Resend APIキーを扱うため）。
//
// 送信元・通知先・APIキーは既存のシフト変更通知と同じ環境変数を流用する
//   RESEND_API_KEY / SHIFT_CHANGE_NOTIFY_EMAILS / SHIFT_CHANGE_NOTIFY_FROM

export type MailAttachment = { filename: string; content: Buffer }

export type MailConfig = { apiKey: string; to: string[]; from: string }

// 開発環境での動作確認用（本番では無効）。
//   ok          : Resendへ送らず成功として扱う（内容はサーバーログに出力）
//   fail        : Resend送信失敗として扱う
//   attach-fail : 議事録PDFの取得失敗として扱い（signed URLフォールバックの確認用）、送信は ok と同じ
export type DryRunMode = 'ok' | 'fail' | 'attach-fail'

export function getDryRunMode(): DryRunMode | null {
  if (process.env.NODE_ENV === 'production') return null
  const v = process.env.MEETING_NOTIFY_DRY_RUN
  return v === 'ok' || v === 'fail' || v === 'attach-fail' ? v : null
}

export function getMailConfig(): { config: MailConfig } | { error: string } {
  if (getDryRunMode()) {
    return { config: { apiKey: 'dry-run', to: ['dry-run@example.invalid'], from: 'dry-run@example.invalid' } }
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { error: 'RESEND_API_KEY が設定されていません' }
  const to = (process.env.SHIFT_CHANGE_NOTIFY_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
  if (to.length === 0) return { error: 'SHIFT_CHANGE_NOTIFY_EMAILS が設定されていません' }
  const from = process.env.SHIFT_CHANGE_NOTIFY_FROM
  if (!from) return { error: 'SHIFT_CHANGE_NOTIFY_FROM が設定されていません' }
  return { config: { apiKey, to, from } }
}

// Resend で送信する。成功/失敗のみ返し、例外は投げない
export async function sendMail(
  config: MailConfig,
  mail: { subject: string; text: string; attachments?: MailAttachment[] },
  logTag: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const dryRun = getDryRunMode()
  if (dryRun) {
    console.log(`[${logTag}] DRY RUN (${dryRun})`, JSON.stringify({
      subject: mail.subject,
      text: mail.text,
      attachments: (mail.attachments ?? []).map(a => ({ filename: a.filename, bytes: a.content.length })),
    }))
    return dryRun === 'fail' ? { ok: false, error: 'dry-run: simulated send failure' } : { ok: true }
  }
  try {
    const resend = new Resend(config.apiKey)
    const { error } = await resend.emails.send({
      from: config.from,
      to: config.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments,
    })
    if (error) {
      console.error(`[${logTag}] Resend error:`, error)
      return { ok: false, error: String(error.message ?? error) }
    }
    return { ok: true }
  } catch (err) {
    console.error(`[${logTag}] Resend unexpected error:`, err)
    return { ok: false, error: 'メール送信中にエラーが発生しました' }
  }
}

// サーバー側のSupabaseクライアント（Phase 1: anonキー、Cookie不要）。
// meeting-minutes バケットは private のまま、anon向けのバケット限定ポリシーで取得・署名URL発行を行う
export function createServerSupabase() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// 通知処理中の目印（*_notify_claimed_at）の有効期限。
// 送信処理が途中で落ちた場合でも、この時間を過ぎれば再試行できる
export const NOTIFY_CLAIM_TTL_MS = 5 * 60 * 1000

export function claimStaleBeforeIso(): string {
  return new Date(Date.now() - NOTIFY_CLAIM_TTL_MS).toISOString()
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// '2026-10-15' → '2026年10月15日（木）'
export function formatDateJpFull(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${y}年${m}月${d}日（${w}）`
}

// '2026-10-15' → '10月15日'
export function formatMonthDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}月${d}日`
}

// '2026-10-01' → '2026年10月'
export function formatYearMonth(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${y}年${m}月`
}

export function toTimeHm(t: string): string {
  return t.slice(0, 5)
}
