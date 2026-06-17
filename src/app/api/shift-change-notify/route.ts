import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

interface NotifyDetail {
  employeeName: string
  changeType: string
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityName?: string
}

interface NotifyPayload {
  facilityName: string
  targetDate: string
  reason: string
  handledBy: string
  memo: string
  details: NotifyDetail[]
}

function formatDate(s: string): string {
  const parts = s.split('-')
  return `${parts[0]}/${parts[1]}/${parts[2]}`
}

function buildText(p: NotifyPayload): string {
  const d = formatDate(p.targetDate)
  let t = `施設：${p.facilityName}\n`
  t += `対象日：${d}\n`
  t += `理由：${p.reason}\n`
  t += `対応者：${p.handledBy}\n`
  if (p.memo) t += `メモ：${p.memo}\n`
  t += '\n【対象者】\n'
  p.details.forEach((det, i) => {
    t += `\n${i + 1}. ${det.employeeName}\n`
    t += `   種別：${det.changeType}\n`
    t += `   内容：${det.changeDetail}\n`
    if (det.isExternalSupport) {
      t += `   他施設応援：${det.supportFromFacilityName ?? 'あり'}\n`
    }
  })
  return t
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as NotifyPayload

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      console.error('[shift-change-notify] RESEND_API_KEY が未設定です')
      return NextResponse.json({ error: 'RESEND_API_KEY が設定されていません' }, { status: 500 })
    }

    const toRaw = process.env.SHIFT_CHANGE_NOTIFY_EMAILS ?? ''
    const to = toRaw.split(',').map(e => e.trim()).filter(Boolean)
    if (to.length === 0) {
      console.error('[shift-change-notify] SHIFT_CHANGE_NOTIFY_EMAILS が未設定です')
      return NextResponse.json({ error: 'SHIFT_CHANGE_NOTIFY_EMAILS が設定されていません' }, { status: 500 })
    }

    const from = process.env.SHIFT_CHANGE_NOTIFY_FROM ?? 'onboarding@resend.dev'
    const date = formatDate(payload.targetDate)
    const subject = `【シフト変更】${payload.facilityName} ${date}`
    const text = buildText(payload)

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from, to, subject, text })

    if (error) {
      console.error('[shift-change-notify] Resend error:', error)
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[shift-change-notify] unexpected error:', err)
    return NextResponse.json({ error: 'メール送信中にエラーが発生しました' }, { status: 500 })
  }
}
