import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// 勤務・休日振替の本部通知（/api/shift-swap-notify）専用の、サーバー専用キーで接続する Supabase クライアント。
// ブラウザ側からは import しないこと（サーバー専用キーを扱うため）。
//
// 使うキー（サーバーの環境変数だけ。NEXT_PUBLIC_ を付けない。値はログ・画面・Git に出さない）
//   SUPABASE_SECRET_KEY       … 新しい Secret key（sb_secret_...）。優先して使う
//   SUPABASE_SERVICE_ROLE_KEY … 旧 service_role キー（Secret key を設定していない場合だけ使う。2026年末までに廃止予定）
// どちらも Postgres の service_role として動く（通知の確保・結果の記録の関数を実行できるのは service_role だけ）。
// 未設定・誤った種類のキーなら接続せずに止める（通知は「未送信」のまま残り、設定後に送り直せる）。
// 既存の createServerSupabase（anon キー。MT 通知などで使用）は変更しない

export type SwapNotifyServerClient =
  | { client: SupabaseClient<Database>; keyKind: 'secret' | 'legacy_service_role' }
  | { error: string }

export function createSwapNotifyServerClient(): SwapNotifyServerClient {
  if (typeof window !== 'undefined') {
    // ブラウザで読み込まれた場合は、キーを読む前に止める
    throw new Error('swapNotifyServerClient はサーバー専用です')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || ''
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const key = secret || legacy
  if (!url || !key) {
    return { error: '通知用のサーバー専用キー（SUPABASE_SECRET_KEY）が設定されていません' }
  }
  // 公開用のキーを誤って設定した場合は使わない（値そのものはメッセージに出さない）
  if (key.startsWith('sb_publishable_') || key === (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()) {
    return { error: '通知用のサーバー専用キーに、公開用のキー（publishable / anon）が設定されています' }
  }
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { client, keyKind: secret ? 'secret' : 'legacy_service_role' }
}
