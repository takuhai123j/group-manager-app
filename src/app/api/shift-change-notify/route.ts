import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

interface NotifyDetail {
  employeeName: string
  changeType: string
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityName?: string
}

interface DayPersonNotify {
  employeeName: string
  changeType: string
  originalShift?: string
  replacementName?: string
  replacementOriginalShift?: string
  isExternalSupport: boolean
  supportFromFacilityName?: string
}

interface DayNotifyDetail {
  date: string
  persons: DayPersonNotify[]
}

interface NotifyPayload {
  facilityName: string
  // 単日
  targetDate?: string
  details?: NotifyDetail[]
  // 期間
  isPeriod?: boolean
  startDate?: string
  endDate?: string
  count?: number
  // 複数日選択
  isMulti?: boolean
  targetDates?: string[]
  // 期間・複数日共通
  dayDetails?: DayNotifyDetail[]
  reason: string
  handledBy: string
  memo: string
}

function formatDate(s: string): string {
  const [, m, d] = s.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}

function formatDateFull(s: string): string {
  const parts = s.split('-')
  return `${parts[0]}/${parts[1]}/${parts[2]}`
}

function formatDateJP(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  const weeks = ['日', '月', '火', '水', '木', '金', '土']
  return `${m}/${d}（${weeks[day]}）`
}

function buildText(p: NotifyPayload): string {
  let t = `施設：${p.facilityName}\n`

  if (p.isPeriod) {
    t += `期間：${formatDateFull(p.startDate!)} ～ ${formatDateFull(p.endDate!)}\n`
    t += `登録件数：${p.count}件\n`
  } else if (p.isMulti) {
    t += `対象日：${p.targetDates!.map(formatDateFull).join('、')}\n`
    t += `登録件数：${p.count}件\n`
  } else {
    t += `対象日：${formatDateFull(p.targetDate!)}\n`
  }

  t += `理由：${p.reason}\n`
  t += `対応者：${p.handledBy}\n`
  if (p.memo) t += `メモ：${p.memo}\n`

  // 単日：明細をそのまま表示
  if (!p.isPeriod && !p.isMulti && p.details) {
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

  // 期間・複数日：日別詳細
  if (p.dayDetails && p.dayDetails.length > 0) {
    t += '\n【日別詳細】\n'
    p.dayDetails.forEach(day => {
      t += `\n▶ ${formatDateJP(day.date)}\n`
      day.persons.forEach((person, i) => {
        t += `   ${i + 1}. ${person.employeeName}（${person.changeType}）\n`
        if (person.originalShift) t += `      元シフト：${person.originalShift}\n`
        if (person.replacementName) {
          t += `      変更後担当：${person.replacementName}\n`
          if (person.replacementOriginalShift) t += `      変更後担当の元シフト：${person.replacementOriginalShift}\n`
        }
        if (person.isExternalSupport) t += `      他施設応援：${person.supportFromFacilityName ?? 'あり'}\n`
      })
    })
  }

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

    const from = process.env.SHIFT_CHANGE_NOTIFY_FROM
    if (!from) {
      console.error('[shift-change-notify] SHIFT_CHANGE_NOTIFY_FROM が未設定です')
      return NextResponse.json({ error: 'SHIFT_CHANGE_NOTIFY_FROM が設定されていません' }, { status: 500 })
    }

    const subject = payload.isPeriod
      ? `【シフト変更】${payload.facilityName} ${formatDate(payload.startDate!)}～${formatDate(payload.endDate!)} ${payload.count}件`
      : payload.isMulti
      ? `【シフト変更】${payload.facilityName} 複数日（${payload.count}件）`
      : `【シフト変更】${payload.facilityName} ${formatDateFull(payload.targetDate!)}`

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
