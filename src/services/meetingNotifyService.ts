// MTメール通知APIの呼び出し（クライアント側）。
// 通知は本体の保存処理とは分離しており、ここでは例外を投げず結果だけを返す。
// 通知管理列（schedule_notified_at 等）はサーバー（/api/meeting-notify/*）側だけが更新する。

export type MeetingNotifyStatus = 'sent' | 'skipped' | 'failed'

// 保存操作の結果に付随する通知結果（通知対象外の操作では notification なし）
export type MeetingNotifyResult = { notification?: MeetingNotifyStatus }

async function post(url: string, body: Record<string, string>): Promise<MeetingNotifyStatus> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return 'failed'
    const json = await res.json().catch(() => null)
    return json?.status === 'skipped' ? 'skipped' : 'sent'
  } catch {
    return 'failed'
  }
}

export const meetingNotifyService = {
  // MT予定確定通知（日程未定→初めて日付・時間を確定した操作の後にだけ呼ぶ）
  notifyScheduleConfirmed(meetingId: string): Promise<MeetingNotifyStatus> {
    return post('/api/meeting-notify/schedule', { meetingId })
  },

  // 議事録保存通知（議事録PDFのStorage保存・DB登録が両方成功した後に呼ぶ）
  notifyMinuteSaved(minuteId: string): Promise<MeetingNotifyStatus> {
    return post('/api/meeting-notify/minute', { minuteId })
  },
}
