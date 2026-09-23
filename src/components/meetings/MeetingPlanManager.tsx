'use client'

import { useState, useMemo } from 'react'
import { X, ChevronLeft, ChevronRight, CalendarRange, Settings2, AlertTriangle, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MEETING_TYPE_ORDER, MONTHS_IN_YEAR, MEETING_CELL_STATUS_LABELS,
  buildMeetingLookup, buildTargetMonth, meetingLookupKey, getMeetingCellStatus,
  type MeetingCellStatus,
} from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import type {
  Facility, GroupManager, Meeting, MeetingFrequency, MeetingType, MeetingMinute,
  MeetingFrequencyInput, ConfirmMeetingScheduleInput, RescheduleMeetingInput,
} from '@/lib/types'
import { MeetingCellModal } from './MeetingCellModal'
import { MeetingFrequencyPanel } from './MeetingFrequencyPanel'
import { MeetingMinutesHistoryPanel } from './MeetingMinutesHistoryPanel'
import { MeetingDashboard } from './MeetingDashboard'
import { HelpButton } from '@/components/help/HelpButton'
import { HelpModal } from '@/components/help/HelpModal'
import { HELP_CONTENT } from '@/constants/helpContent'

interface MeetingPlanManagerProps {
  isOpen: boolean
  year: number
  onYearChange: (year: number) => void
  facilities: Facility[]
  activeManagers: GroupManager[]
  managerFacilities: Record<string, string[]>
  meetings: Meeting[]
  frequencies: MeetingFrequency[]
  loading: boolean
  error: string | null
  onClose: () => void
  onAddManual: (input: { facilityId: string; meetingType: MeetingType; targetMonth: string; memo?: string }) => Promise<void>
  onConfirmSchedule: (meetingId: string, input: ConfirmMeetingScheduleInput) => Promise<void>
  onReschedule: (meetingId: string, input: RescheduleMeetingInput) => Promise<void>
  onCancelSchedule: (meetingId: string) => Promise<void>
  onMarkDone: (meetingId: string, executedDate?: string) => Promise<void>
  onSaveFrequency: (existingId: string | undefined, input: MeetingFrequencyInput) => Promise<void>
  onToggleFrequencyActive: (id: string) => Promise<void>
  onUploadMinute: (meeting: Meeting, file: File) => Promise<MeetingMinute>
  onDeleteMinute: (minute: MeetingMinute) => Promise<void>
}

type Tab = 'plan' | 'frequencies' | 'minutes'

const CELL_STYLES: Record<MeetingCellStatus, string> = {
  none: 'text-gray-300',
  unscheduled: 'bg-gray-100 text-gray-500',
  confirmed: 'bg-blue-100 text-blue-700 font-semibold',
  done: 'bg-emerald-100 text-emerald-700 font-semibold',
  minutes_registered: 'bg-indigo-100 text-indigo-700 font-semibold',
  overdue: 'bg-red-100 text-red-700 font-semibold',
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function cellLabel(status: MeetingCellStatus, meeting: Meeting | undefined): string {
  if (status === 'confirmed' && meeting?.scheduleDate) return formatShortDate(meeting.scheduleDate)
  if (status === 'none') return ''
  return MEETING_CELL_STATUS_LABELS[status]
}

interface SelectedCell {
  facility: Facility
  meetingType: MeetingType
  targetMonth: string
  meeting: Meeting | null
}

export function MeetingPlanManager({
  isOpen, year, onYearChange,
  facilities, activeManagers, managerFacilities,
  meetings, frequencies, loading, error,
  onClose, onAddManual, onConfirmSchedule, onReschedule, onCancelSchedule, onMarkDone,
  onSaveFrequency, onToggleFrequencyActive, onUploadMinute, onDeleteMinute,
}: MeetingPlanManagerProps) {
  const [tab, setTab] = useState<Tab>('plan')
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState('')

  const lookup = useMemo(() => buildMeetingLookup(meetings), [meetings])

  // G長別絞り込み（全施設 or 選択中G長の担当施設のみ）。
  // group_manager_facilities（既存構造）はそのまま、表示側でのみ絞り込む
  const visibleFacilityIds = selectedManagerId
    ? new Set(managerFacilities[selectedManagerId] ?? [])
    : null
  const visibleFacilities = visibleFacilityIds
    ? facilities.filter(f => visibleFacilityIds.has(f.id))
    : facilities
  const visibleMeetings = visibleFacilityIds
    ? meetings.filter(m => visibleFacilityIds.has(m.facilityId))
    : meetings

  // 開いているセルのmeetingは常に最新の meetings 配列から再算出する
  // （議事録アップロード/削除後もモーダルを閉じずに続けて操作できるよう、
  //  スナップショットではなく都度参照にする）
  const activeCellMeeting = selectedCell
    ? lookup.get(meetingLookupKey(selectedCell.facility.id, selectedCell.meetingType, selectedCell.targetMonth)) ?? null
    : null

  if (!isOpen) return null

  const openCell = (facility: Facility, meetingType: MeetingType, month: number) => {
    const targetMonth = buildTargetMonth(year, month)
    const meeting = lookup.get(meetingLookupKey(facility.id, meetingType, targetMonth)) ?? null
    setSelectedCell({ facility, meetingType, targetMonth, meeting })
  }

  // ダッシュボードのカード一覧から直接開く（施設・種別・計画月はmeeting自身から復元する）
  const openMeetingDirectly = (meeting: Meeting) => {
    const facility = facilities.find(f => f.id === meeting.facilityId)
    if (!facility) return
    setSelectedCell({ facility, meetingType: meeting.meetingType, targetMonth: meeting.targetMonth, meeting })
  }

  const candidateManagersFor = (facilityId: string): GroupManager[] =>
    activeManagers.filter(m => (managerFacilities[m.id] ?? []).includes(facilityId))

  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white w-full h-full sm:h-auto sm:max-h-[92vh] sm:rounded-xl sm:max-w-6xl shadow-xl flex flex-col overflow-hidden">

          {/* ヘッダー */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white z-10 flex-shrink-0">
            <div className="flex items-center gap-2">
              <CalendarRange size={20} className="text-blue-600" />
              <h2 className="text-base font-semibold text-gray-800">MT年間計画</h2>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => onYearChange(year - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="前年">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium text-gray-700 w-16 text-center">{year}年</span>
              <button onClick={() => onYearChange(year + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="翌年">
                <ChevronRight size={18} />
              </button>
              <HelpButton onClick={() => setHelpOpen(true)} />
              <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* タブ */}
          <div className="flex border-b bg-gray-50 flex-shrink-0">
            <button
              onClick={() => setTab('plan')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === 'plan' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              年間計画
            </button>
            <button
              onClick={() => setTab('frequencies')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                tab === 'frequencies' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Settings2 size={14} />頻度設定
            </button>
            <button
              onClick={() => setTab('minutes')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                tab === 'minutes' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <History size={14} />議事録
            </button>
          </div>

          {/* コンテンツ */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 m-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            ) : tab === 'frequencies' ? (
              <MeetingFrequencyPanel
                facilities={facilities}
                frequencies={frequencies}
                onSave={onSaveFrequency}
                onToggleActive={onToggleFrequencyActive}
              />
            ) : tab === 'minutes' ? (
              <MeetingMinutesHistoryPanel facilities={visibleFacilities} year={year} />
            ) : (
              <div className="p-3">
                {/* G長別絞り込み */}
                <div className="flex items-center gap-2 mb-3">
                  <label className="text-xs text-gray-500 flex-shrink-0">表示対象</label>
                  <select
                    value={selectedManagerId}
                    onChange={e => setSelectedManagerId(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全施設</option>
                    {activeManagers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}（担当施設のみ）</option>
                    ))}
                  </select>
                </div>

                <MeetingDashboard
                  meetings={visibleMeetings}
                  facilities={visibleFacilities}
                  onOpenMeeting={openMeetingDirectly}
                />

                {visibleFacilities.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-12">
                    {selectedManagerId ? 'このG長の担当施設が設定されていません' : '有効な施設がありません'}
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-xl">
                    <table className="border-collapse text-sm min-w-full">
                      <thead>
                        <tr className="bg-gray-50 text-xs text-gray-500">
                          <th className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left w-28">施設</th>
                          <th className="sticky left-28 z-20 bg-gray-50 border-b border-r px-3 py-2 text-left w-20">種別</th>
                          {MONTHS_IN_YEAR.map(m => (
                            <th key={m} className="border-b px-1 py-2 text-center w-16 font-medium">{m}月</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleFacilities.map(facility => (
                          MEETING_TYPE_ORDER.map((meetingType, typeIdx) => (
                            <tr key={`${facility.id}-${meetingType}`} className="hover:bg-gray-50/60">
                              {typeIdx === 0 && (
                                <td
                                  rowSpan={MEETING_TYPE_ORDER.length}
                                  className="sticky left-0 z-10 bg-white border-r border-b px-3 py-2 align-top font-medium text-gray-700 whitespace-nowrap"
                                >
                                  {facility.name}
                                </td>
                              )}
                              <td className="sticky left-28 z-10 bg-white border-r border-b px-3 py-2 text-gray-500 whitespace-nowrap">
                                {MEETING_TYPE_LABELS[meetingType]}
                              </td>
                              {MONTHS_IN_YEAR.map(month => {
                                const targetMonth = buildTargetMonth(year, month)
                                const meeting = lookup.get(meetingLookupKey(facility.id, meetingType, targetMonth))
                                const status = getMeetingCellStatus(meeting)
                                return (
                                  <td key={month} className="border-b p-1 text-center">
                                    <button
                                      onClick={() => openCell(facility, meetingType, month)}
                                      className={cn(
                                        'w-full h-9 rounded-md text-xs flex items-center justify-center transition-colors hover:opacity-80',
                                        CELL_STYLES[status]
                                      )}
                                      title={`${facility.name} ${MEETING_TYPE_LABELS[meetingType]} ${month}月 - ${MEETING_CELL_STATUS_LABELS[status]}`}
                                    >
                                      {cellLabel(status, meeting) || '－'}
                                    </button>
                                  </td>
                                )
                              })}
                            </tr>
                          ))
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 凡例 */}
                <div className="flex flex-wrap gap-3 mt-3 px-1 text-xs text-gray-500">
                  {(Object.keys(MEETING_CELL_STATUS_LABELS) as MeetingCellStatus[])
                    .filter(s => s !== 'none')
                    .map(s => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span className={cn('w-3 h-3 rounded-sm inline-block', CELL_STYLES[s])} />
                        {MEETING_CELL_STATUS_LABELS[s]}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <MeetingCellModal
        isOpen={selectedCell !== null}
        meeting={activeCellMeeting}
        facilityName={selectedCell?.facility.name ?? ''}
        meetingType={selectedCell?.meetingType ?? 'facility'}
        targetMonth={selectedCell?.targetMonth ?? ''}
        candidateManagers={selectedCell ? candidateManagersFor(selectedCell.facility.id) : []}
        onClose={() => setSelectedCell(null)}
        onAddManual={async memo => {
          if (!selectedCell) return
          await onAddManual({
            facilityId: selectedCell.facility.id,
            meetingType: selectedCell.meetingType,
            targetMonth: selectedCell.targetMonth,
            memo,
          })
        }}
        onConfirmSchedule={async input => {
          if (!selectedCell?.meeting) return
          await onConfirmSchedule(selectedCell.meeting.id, input)
        }}
        onReschedule={async input => {
          if (!selectedCell?.meeting) return
          await onReschedule(selectedCell.meeting.id, input)
        }}
        onCancelSchedule={async () => {
          if (!selectedCell?.meeting) return
          await onCancelSchedule(selectedCell.meeting.id)
        }}
        onMarkDone={async executedDate => {
          if (!selectedCell?.meeting) return
          await onMarkDone(selectedCell.meeting.id, executedDate)
        }}
        onUploadMinute={onUploadMinute}
        onDeleteMinute={onDeleteMinute}
      />

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT.meetingPlan}
      />
    </>
  )
}
