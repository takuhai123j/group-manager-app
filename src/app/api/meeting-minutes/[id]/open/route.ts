import { NextResponse } from 'next/server'
import { createServerSupabase, UUID_RE } from '@/lib/server/notifyMail'

// MT議事録PDFを開く（GET /api/meeting-minutes/{minuteId}/open）。
//
// クライアントは「開く」を <a target="_blank"> の通常リンクにし、このRouteへ直接遷移する。
// スマホブラウザはクリック後の await を挟んだ window.open をポップアップとしてブロックするため、
// 署名付きURLの発行はクライアントではなくサーバー側で行い、そのURLへリダイレクトする。
//
// - meeting-minutes バケットは private のまま。file_path はURLから受け取らず、minuteId からDBで引く
// - 署名付きURLは閲覧の都度発行し、有効期限は短く（60秒）する
// - リダイレクト先（署名付きURL）がブラウザ・CDNにキャッシュされないよう no-store を付ける
// - Next.js 14 はGET Route内の fetch（supabase-js の署名URL発行POSTを含む）をData Cacheに保存するため、
//   fetchCache = 'force-no-store' で無効化する（無いと期限切れの署名URLが使い回される）

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const BUCKET = 'meeting-minutes'
const SIGNED_URL_EXPIRES_IN_SECONDS = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// 別タブで開かれるため、エラーは利用者が読める短い文言で返す
function errorResponse(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = params.id
  if (!UUID_RE.test(id)) return errorResponse(400, '議事録の指定が正しくありません')

  const supabase = createServerSupabase()

  const { data: row, error: selectError } = await supabase
    .from('meeting_minutes')
    .select('file_path')
    .eq('id', id)
    .maybeSingle()
  if (selectError) {
    console.error('[meeting-minutes/open] select failed', selectError.message)
    return errorResponse(500, '議事録の取得に失敗しました')
  }
  if (!row) return errorResponse(404, '議事録が見つかりません（削除された可能性があります）')

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.file_path, SIGNED_URL_EXPIRES_IN_SECONDS)
  if (signError || !signed?.signedUrl) {
    console.error('[meeting-minutes/open] createSignedUrl failed', signError?.message)
    return errorResponse(502, 'PDFの表示に失敗しました。時間をおいて再度お試しください')
  }

  const res = NextResponse.redirect(signed.signedUrl, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
