// 勤務・休日振替（振替出勤・振替休日）の本部向け通知メールの件名・本文を作る（画面・サーバーの両方から使う純粋な関数）。
// 曜日は日付から計算する（タイムゾーンの影響を受けないよう UTC で計算）。割増賃金の要否などには触れない

export type ShiftSwapMailAction = 'create' | 'update' | 'cancel'

export type ShiftSwapMailDay = {
  date: string            // YYYY-MM-DD
  facilityName: string    // '' = 施設勤務なし
  originalShift: string
  changeDetail: string
}

export type ShiftSwapMailContent = {
  personName: string
  workContent: string
  reason: string
  handledBy: string
  memo: string
  work: ShiftSwapMailDay
  off: ShiftSwapMailDay
}

export type ShiftSwapMailPayload = {
  action: ShiftSwapMailAction
  content: ShiftSwapMailContent       // 登録・変更は保存後の内容、取消は取り消した内容
  before?: ShiftSwapMailContent       // 変更のときだけ（変更前の内容）
}

const ACTION_LABELS: Record<ShiftSwapMailAction, string> = { create: '登録', update: '変更', cancel: '取消' }
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

export function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ''
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// 11/24（火）
export function formatMonthDayWeek(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}（${weekdayOf(ymd)}）`
}

// 2026/11/24（火）
export function formatFullDateWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${y}/${m}/${d}（${weekdayOf(ymd)}）`
}

export function buildShiftSwapMailSubject(p: ShiftSwapMailPayload): string {
  const c = p.content
  return `【振替出勤・振替休日】${ACTION_LABELS[p.action]} ${c.personName} 振替出勤 ${formatMonthDayWeek(c.work.date)}・振替休日 ${formatMonthDayWeek(c.off.date)}`
}

function dayBlock(title: string, d: ShiftSwapMailDay, extra?: string): string {
  let t = `【${title}】${formatFullDateWeek(d.date)}\n`
  t += `  元の状態：${d.originalShift || '（未入力）'}\n`
  t += `  変更内容：${d.changeDetail}\n`
  if (extra) t += `  ${extra}\n`
  t += `  施設：${d.facilityName || 'なし（施設勤務なし）'}\n`
  return t
}

function contentBlock(c: ShiftSwapMailContent): string {
  let t = `対象者：${c.personName}\n`
  t += `理由：${c.reason}\n`
  t += `入力者：${c.handledBy}\n`
  if (c.memo) t += `メモ：${c.memo}\n`
  t += '\n'
  t += dayBlock('振替出勤日', c.work, c.workContent ? `勤務内容：${c.workContent}` : undefined)
  t += dayBlock('振替休日', c.off)
  return t
}

export function buildShiftSwapMailText(p: ShiftSwapMailPayload): string {
  const lead = {
    create: '勤務・休日振替（振替出勤・振替休日）が登録されました。',
    update: '勤務・休日振替（振替出勤・振替休日）が変更されました。',
    cancel: '勤務・休日振替（振替出勤・振替休日）が取り消されました。以下は取消前の内容です。',
  }[p.action]
  let t = `${lead}\n\n`
  t += contentBlock(p.content)
  if (p.action === 'update' && p.before) {
    t += '\n――― 変更前の内容 ―――\n'
    t += contentBlock(p.before)
  }
  t += '\n※振替出勤・振替休日は、休日出勤・振休とは別の区分です。\n'
  return t
}

// DB の操作の記録に保存した内容（通知の元）の確認。形がおかしければ null（文面は画面から受け取らない）
export function parseShiftSwapMailContent(v: unknown): ShiftSwapMailContent | null {
  const isStr = (x: unknown): x is string => typeof x === 'string'
  const isDate = (x: unknown) => isStr(x) && /^\d{4}-\d{2}-\d{2}$/.test(x)
  const day = (x: unknown): ShiftSwapMailDay | null => {
    const o = x as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !isDate(o.date) || !isStr(o.changeDetail)) return null
    return {
      date: o.date as string,
      facilityName: isStr(o.facilityName) ? o.facilityName : '',
      originalShift: isStr(o.originalShift) ? o.originalShift : '',
      changeDetail: o.changeDetail as string,
    }
  }
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !isStr(o.personName) || !o.personName) return null
  const work = day(o.work), off = day(o.off)
  if (!work || !off) return null
  return {
    personName: o.personName,
    workContent: isStr(o.workContent) ? o.workContent : '',
    reason: isStr(o.reason) ? o.reason : '',
    handledBy: isStr(o.handledBy) ? o.handledBy : '',
    memo: isStr(o.memo) ? o.memo : '',
    work, off,
  }
}
