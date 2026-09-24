'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { ExternalLink, FileText, Filter, History } from 'lucide-react'
import { meetingMinutesService } from '@/services/meetingMinutesService'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import { parseTargetMonth } from '@/lib/meetingPlan'
import type { Facility, MeetingMinuteHistoryItem } from '@/lib/types'

interface MeetingMinutesHistoryPanelProps {
  facilities: Facility[]
  year: number
}

const ALL_YEARS = '__all__'

function formatMonthLabel(targetMonth: string): string {
  if (!targetMonth) return '－'
  const { year, month } = parseTargetMonth(targetMonth)
  return `${year}年${month}月`
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 施設ごとの議事録履歴（施設・MT種別・年で絞り込み）。
// アップロード/削除は MeetingCellModal 側で行うため、ここは閲覧専用。
export function MeetingMinutesHistoryPanel({ facilities, year }: MeetingMinutesHistoryPanelProps) {
  const [facilityId, setFacilityId] = useState('')
  const [meetingType, setMeetingType] = useState('')
  const [yearFilter, setYearFilter] = useState<string>(String(year))
  const [items, setItems] = useState<MeetingMinuteHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 現在選択中の年を初期値にしつつ、過去分も選べるようにする
  const yearOptions = useMemo(() => {
    const years: number[] = []
    for (let y = year + 1; y >= year - 5; y--) years.push(y)
    return years
  }, [year])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await meetingMinutesService.getHistory({
        facilityId: facilityId || undefined,
        meetingType: meetingType === 'facility' || meetingType === 'kitchen' ? meetingType : undefined,
        year: yearFilter === ALL_YEARS ? undefined : Number(yearFilter),
      })
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '議事録履歴の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [facilityId, meetingType, yearFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <Filter size={14} className="text-gray-400 flex-shrink-0" />
        <select
          value={facilityId}
          onChange={e => setFacilityId(e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">施設：すべて</option>
          {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select
          value={meetingType}
          onChange={e => setMeetingType(e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">種別：すべて</option>
          <option value="facility">{MEETING_TYPE_LABELS.facility}</option>
          <option value="kitchen">{MEETING_TYPE_LABELS.kitchen}</option>
        </select>
        <select
          value={yearFilter}
          onChange={e => setYearFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value={ALL_YEARS}>すべての年</option>
          {yearOptions.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <History size={32} className="mb-2 opacity-30" />
          <p className="text-sm">議事録が見つかりません</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-xs text-gray-500">
                <th className="px-3 py-2 text-left font-medium">施設</th>
                <th className="px-3 py-2 text-left font-medium">種別</th>
                <th className="px-3 py-2 text-left font-medium">計画月</th>
                <th className="px-3 py-2 text-left font-medium">実施日</th>
                <th className="px-3 py-2 text-left font-medium">ファイル名</th>
                <th className="px-3 py-2 text-left font-medium">登録日時</th>
                <th className="px-3 py-2 text-center font-medium">閲覧</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(item => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{item.facilityName}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{MEETING_TYPE_LABELS[item.meetingType]}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatMonthLabel(item.targetMonth)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{item.executedDate ?? '－'}</td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <div className="flex items-center gap-1.5">
                      <FileText size={13} className="text-red-400 flex-shrink-0" />
                      <span className="truncate" title={item.fileName}>{item.fileName}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{formatDateTime(item.uploadedAt)}</td>
                  <td className="px-3 py-2 text-center">
                    <a
                      href={meetingMinutesService.getOpenUrl(item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 mx-auto whitespace-nowrap"
                    >
                      <ExternalLink size={12} />開く
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
