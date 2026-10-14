import type { JoinRequirements, Meeting, MeetingJointErrorCode } from '@/lib/types'

// MT同時開催まわりの純粋関数（DBアクセスなし）。
// RPC（mt_*）のエラー解釈と、結合前に利用者へ確認すべき項目の判定を扱う。

// RPCのエラーは 'MTJ_<コード>: <日本語メッセージ>' 形式。
// 画面には日本語メッセージだけを出し、コードは分岐（入力画面へ戻す等）に使う
export class MeetingJointError extends Error {
  readonly code: MeetingJointErrorCode
  constructor(code: MeetingJointErrorCode, message: string) {
    super(message)
    this.name = 'MeetingJointError'
    this.code = code
  }
}

const MTJ_ERROR_RE = /(MTJ_[A-Z_]+):\s*([\s\S]*)$/

// supabase-js のエラー（PostgrestError）を MeetingJointError に変換する。
// MTJ形式でないエラー（通信エラー・権限エラー等）はそのまま返す
export function toMeetingJointError(error: { message?: string } | null | undefined): Error {
  const message = error?.message ?? ''
  const match = message.match(MTJ_ERROR_RE)
  if (match) return new MeetingJointError(match[1] as MeetingJointErrorCode, match[2].trim())
  return error instanceof Error ? error : new Error(message || '処理に失敗しました')
}

export function isMeetingJointError(e: unknown, code?: MeetingJointErrorCode): e is MeetingJointError {
  return e instanceof MeetingJointError && (code === undefined || e.code === code)
}

// 既存MT同士を結合する前に、利用者に選んでもらう必要がある項目を判定する
// （DB側 mt_join_meetings の検証と同じ条件。画面の段階式フォームはこれに従って質問を出す）
export function getJoinRequirements(meeting: Meeting, partner: Meeting): JoinRequirements {
  const scheduleChoice =
    meeting.scheduleId && partner.scheduleId && meeting.scheduleId !== partner.scheduleId
      ? { scheduleIds: [meeting.scheduleId, partner.scheduleId] as [string, string] }
      : null

  const doneDates = [meeting, partner]
    .filter(m => m.status === 'done' && m.executedDate)
    .map(m => m.executedDate as string)
  const uniqueDates = Array.from(new Set(doneDates)).sort()
  const executedDateChoice = uniqueDates.length > 0 ? { dates: uniqueDates } : null

  const partnerWillBeMarkedDone = (meeting.status === 'done') !== (partner.status === 'done')

  return { scheduleChoice, executedDateChoice, partnerWillBeMarkedDone }
}

// 同時開催に設定されているMTかどうか（画面・保護処理の分岐用）
export function isJointMeeting(meeting: Pick<Meeting, 'jointGroupId'>): boolean {
  return meeting.jointGroupId !== null
}
