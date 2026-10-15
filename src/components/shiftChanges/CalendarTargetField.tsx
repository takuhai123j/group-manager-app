'use client'

import { useState } from 'react'
import { CalendarCheck, AlertTriangle } from 'lucide-react'
import {
  normalizePersonName, suggestCalendarTarget, targetKey, parseTargetKey, sameTarget,
  type CalendarCandidate,
} from '@/lib/shiftChangeCalendar'
import type { MeetingAssigneeRef } from '@/lib/types'

// シフト変更の対象者を、個人カレンダーへ反映するかどうか（反映先の本人）を選ぶ欄。
// 対象者名に一致する人が1人だけいれば提案するが、反映先は必ず「本人なので反映する」か一覧から選んで決める
interface Props {
  employeeName: string
  value: MeetingAssigneeRef | null
  candidates: CalendarCandidate[]
  onChange: (value: MeetingAssigneeRef | null) => void
}

const GROUP_ORDER = ['G長・主任', 'リーダー', 'ラウンダー', '現場社員']

export function CalendarTargetField({ employeeName, value, candidates, onChange }: Props) {
  // 「違う」を押した名前には、同じ名前のあいだ提案を出さない
  const [dismissedName, setDismissedName] = useState<string | null>(null)

  const nameKey = normalizePersonName(employeeName)
  const suggestion = !value ? suggestCalendarTarget(employeeName, candidates) : null
  const showSuggestion = !!suggestion && dismissedName !== nameKey
  const selected = value ? candidates.find(c => sameTarget(c, value)) ?? null : null
  const nameMismatch = !!selected && !!nameKey && normalizePersonName(selected.name) !== nameKey

  const groups = GROUP_ORDER
    .map(label => ({ label, people: candidates.filter(c => c.groupLabel === label) }))
    .filter(g => g.people.length > 0)

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 space-y-1.5">
      <label className="flex items-center gap-1 text-xs font-medium text-indigo-900">
        <CalendarCheck size={13} />カレンダーに反映 <span className="text-gray-400 font-normal">（任意）</span>
      </label>
      <select
        value={targetKey(value)}
        onChange={e => onChange(parseTargetKey(e.target.value))}
        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">反映しない</option>
        {groups.map(g => (
          <optgroup key={g.label} label={g.label}>
            {g.people.map(c => (
              <option key={targetKey(c)} value={targetKey(c)}>{c.name}{c.active ? '' : '（無効化済み）'}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {showSuggestion && suggestion && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-indigo-900">
          <span className="min-w-0">「{employeeName.trim()}」は <strong>{suggestion.name}</strong>（{suggestion.groupLabel}）本人ですか？</span>
          <span className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ type: suggestion.type, id: suggestion.id })}
              className="px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              本人なので反映する
            </button>
            <button
              type="button"
              onClick={() => setDismissedName(nameKey)}
              className="px-2 py-1 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            >
              違う
            </button>
          </span>
        </div>
      )}

      {nameMismatch && selected && (
        <p className="flex items-start gap-1 text-xs text-amber-800">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          対象者名と反映先（{selected.name}）が違います。本人か確認してください
        </p>
      )}
    </div>
  )
}

// 反映先がある場合の時刻欄（任意。両方空なら終日）
export function CalendarTimeFields({
  startTime, endTime, onChange,
}: {
  startTime: string
  endTime: string
  onChange: (startTime: string, endTime: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        カレンダーの時刻 <span className="text-gray-400 font-normal">（任意・未入力なら終日）</span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="time" step={300} value={startTime} aria-label="開始時刻"
          onChange={e => onChange(e.target.value, endTime)}
          className="min-w-0 flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-sm text-gray-500 flex-shrink-0">〜</span>
        <input
          type="time" step={300} value={endTime} aria-label="終了時刻"
          onChange={e => onChange(startTime, e.target.value)}
          className="min-w-0 flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {(startTime || endTime) && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="flex-shrink-0 px-2 py-1.5 rounded-lg text-xs border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            終日にする
          </button>
        )}
      </div>
    </div>
  )
}
