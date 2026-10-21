// シフト変更の「変更内容」の文章を、変更種別と変更前／変更後シフトから組み立てる（入力補助）。
// 組み立てた文章は画面で自由に書き換えられる。保存されるのは文章（change_detail）と変更前シフト（original_shift）だけで、
// 変更後シフトは文章を作るための画面上の入力。

export type ChangeDetailSource = {
  changeType: string
  beforeShift?: string | null
  afterShift?: string | null
  replacementName?: string | null
  replacementOriginalShift?: string | null
  // 変更前の勤務元・変更後の勤務先の施設名（わかるときだけ。時刻の入ったシフトの前に付ける）
  beforeFacility?: string | null
  afterFacility?: string | null
  // 変更後担当を文章に入れない（応援チェーン：次の応援者は自分の明細に書くので重ねない）
  omitReplacement?: boolean
}

// 変更後シフトの入力欄を出す種別（欠勤・振休は「休み」になるだけなので出さない）
export function usesAfterShift(changeType: string): boolean {
  return changeType !== '欠勤' && changeType !== '振休'
}

// 時刻の入ったシフトか（「休み」「公休」などには施設名を付けない）
const hasTime = (shift: string) => /[0-9０-９]/.test(shift)

// 「変更前 → 変更後」の部分。どちらか片方だけでも読める形にする
function shiftChange(before: string, after: string): string {
  if (before && after) return `${before} → ${after}`
  if (after) return `${after} に変更`
  if (before) return `${before} から変更`
  return ''
}

export function buildChangeDetailText(src: ChangeDetailSource): string {
  const rawBefore = (src.beforeShift ?? '').trim()
  const rawAfter = (src.afterShift ?? '').trim()
  const beforeFac = (src.beforeFacility ?? '').trim()
  const afterFac = (src.afterFacility ?? '').trim()
  // 変更前には勤務元の施設名を付ける。変更後には勤務先の施設名を付けるが、変更前に同じ施設名を付けたときは繰り返さない
  const beforePlaced = !!beforeFac && hasTime(rawBefore)
  const before = beforePlaced ? `${beforeFac} ${rawBefore}` : rawBefore
  const after = afterFac && hasTime(rawAfter) && !(beforePlaced && beforeFac === afterFac) ? `${afterFac} ${rawAfter}` : rawAfter
  const type = src.changeType

  let main: string
  switch (type) {
    case '欠勤':
    case '振休':
      main = before ? `${before} → ${type}` : type
      break
    case '遅刻':
    case '早退':
    case '交代出勤':
      main = before && after ? `${before} → ${after}（${type}）` : after ? `${after}（${type}）` : before ? `${before}（${type}）` : type
      break
    case '休日出勤':
      main = after ? `${before || '休み'} → ${after}（休日出勤）` : before ? `${before}（休日出勤）` : '休日出勤'
      break
    case '時間変更':
      main = shiftChange(before, after) || '時間変更'
      break
    default:
      // その他：決まった言い方がないので、シフトの変化だけ書く（なければ空。自由入力してもらう）
      main = shiftChange(before, after)
  }

  const rep = src.omitReplacement ? '' : (src.replacementName ?? '').trim()
  if (!rep) return main
  const repShift = (src.replacementOriginalShift ?? '').trim()
  const repText = `変更後担当：${rep}${repShift ? `（元：${repShift}）` : ''}`
  return main ? `${main}／${repText}` : repText
}
