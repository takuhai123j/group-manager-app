// 応援チェーン（1件のシフト変更の中で、A 欠勤 → B が他施設から応援 → C が B の元施設へ応援 … 最大5人）の計算。
// 勤務先の決まりは保存RPC（20261018120000）と同じ:
//   1番目＝記録の施設、2番目＝1番目と同じ、3番目以降＝1つ前の人の元施設（応援元施設）。
//   2番目以降は他施設からの応援（応援元施設あり・勤務先と別の施設）

export const MAX_CHAIN = 5

export type ChainStepLike = {
  chainPosition: number | null
  employeeName: string
  changeType: string
  supportFromFacilityId: string | null
}

// チェーンの明細を順番に並べる（index は元の配列での位置）
export function chainSteps<T extends ChainStepLike>(details: T[]): { index: number; step: T }[] {
  return details
    .map((step, index) => ({ index, step }))
    .filter(x => x.step.chainPosition != null)
    .sort((a, b) => (a.step.chainPosition ?? 0) - (b.step.chainPosition ?? 0))
}

// 明細ごとの勤務先（チェーン外は null）。順番どおり 1,2,3… に並んでいる前提で、順番の位置から決める
export function chainWorkFacilities<T extends ChainStepLike>(details: T[], recordFacilityId: string): (string | null)[] {
  const result: (string | null)[] = details.map(() => null)
  const steps = chainSteps(details)
  steps.forEach(({ index }, k) => {
    result[index] = k <= 1 ? recordFacilityId || null : steps[k - 1].step.supportFromFacilityId || null
  })
  return result
}

const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '')

// 保存前の確認（RPC と同じ決まり＋同じ人の重複）。問題がなければ null
export function validateChain<T extends ChainStepLike>(details: T[], recordFacilityId: string): string | null {
  const steps = chainSteps(details)
  if (steps.length === 0) return null
  if (steps.length < 2) return '応援チェーンは2人以上でつないでください'
  if (steps.length > MAX_CHAIN) return `応援チェーンは${MAX_CHAIN}人までです`
  if (steps.some((s, k) => s.step.chainPosition !== k + 1)) return '応援チェーンの順番が正しくありません'
  const work = chainWorkFacilities(details, recordFacilityId)
  for (const [k, { index, step }] of steps.entries()) {
    if (k === 0) continue
    const label = `応援チェーン${k + 1}人目（${step.employeeName.trim() || '名前未入力'}）`
    if (!step.supportFromFacilityId) return `${label}：応援元施設を選んでください`
    if (step.supportFromFacilityId === work[index]) return `${label}：応援元施設が勤務先と同じです`
  }
  const names = steps.map(s => nameKey(s.step.employeeName)).filter(Boolean)
  if (new Set(names).size !== names.length) return '応援チェーンに同じ人が2回入っています（1人1回にしてください）'
  return null
}

// 一覧・メール用の流れの文（例：山田（欠勤）← 田中（大塚から）← 佐藤（豊中北から））
export function chainSummary<T extends ChainStepLike>(details: T[], facilityName: (id: string) => string | undefined): string {
  return chainSteps(details).map(({ step }, k) => {
    const name = step.employeeName.trim() || '（名前未入力）'
    if (k === 0) return `${name}（${step.changeType}）`
    const from = step.supportFromFacilityId ? facilityName(step.supportFromFacilityId) : undefined
    return `${name}（${from ? `${from}から` : '応援元未選択'}）`
  }).join(' ← ')
}
