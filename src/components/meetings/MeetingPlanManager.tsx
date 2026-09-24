'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { X, ChevronLeft, ChevronRight, CalendarRange, Settings2, AlertTriangle, History, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MEETING_TYPE_ORDER, MONTHS_IN_YEAR, MEETING_CELL_STATUS_LABELS,
  buildMeetingLookup, buildTargetMonth, meetingLookupKey, getMeetingCellStatus,
  type MeetingCellStatus,
} from '@/lib/meetingPlan'
import { MEETING_TYPE_LABELS } from '@/lib/types'
import { buildAssigneeCandidates } from '@/lib/meetingAssignee'
import type { MeetingNotifyResult } from '@/services/meetingNotifyService'
import type {
  Facility, GroupManager, StaffMember, MeetingAssignee, Meeting, MeetingFrequency, MeetingType, MeetingMinute,
  MeetingFrequencyInput, ConfirmMeetingScheduleInput, RescheduleMeetingInput,
  CreateManualMeetingScheduleInput,
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
  // MT担当者候補としてのリーダー（staff_members.role='leader'）と担当施設
  activeLeaders: StaffMember[]
  leaderFacilities: Record<string, string[]>
  meetings: Meeting[]
  frequencies: MeetingFrequency[]
  loading: boolean
  error: string | null
  onClose: () => void
  onAddManual: (input: {
    facilityId: string
    meetingType: MeetingType
    targetMonth: string
    memo?: string
    schedule?: CreateManualMeetingScheduleInput
  }) => Promise<MeetingNotifyResult>
  onConfirmSchedule: (meetingId: string, input: ConfirmMeetingScheduleInput) => Promise<MeetingNotifyResult>
  onReschedule: (meetingId: string, input: RescheduleMeetingInput) => Promise<void>
  onCancelSchedule: (meetingId: string) => Promise<void>
  onMarkDone: (meetingId: string, executedDate?: string) => Promise<void>
  onSaveFrequency: (existingId: string | undefined, input: MeetingFrequencyInput) => Promise<void>
  onToggleFrequencyActive: (id: string) => Promise<void>
  onUploadMinute: (meeting: Meeting, file: File) => Promise<{ minute: MeetingMinute } & MeetingNotifyResult>
  onDeleteMinute: (minute: MeetingMinute) => Promise<void>
  onMoveTargetMonth: (meetingId: string, newTargetMonth: string) => Promise<void>
  onMoveTargetMonthCascade: (meetingId: string, newTargetMonth: string) => Promise<void>
  onDeleteMeeting: (meetingId: string) => Promise<void>
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
  facilities, activeManagers, managerFacilities, activeLeaders, leaderFacilities,
  meetings, frequencies, loading, error,
  onClose, onAddManual, onConfirmSchedule, onReschedule, onCancelSchedule, onMarkDone,
  onSaveFrequency, onToggleFrequencyActive, onUploadMinute, onDeleteMinute,
  onMoveTargetMonth, onMoveTargetMonthCascade, onDeleteMeeting,
}: MeetingPlanManagerProps) {
  const [tab, setTab] = useState<Tab>('plan')
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState('')
  // スマホ（sm未満）ではダッシュボードを初期状態で折りたたみ、年間計画表をすぐ見せる。PCは常に表示
  const [mobileDashboardOpen, setMobileDashboardOpen] = useState(false)
  // MT予定確定通知の結果表示（保存自体は完了している前提。通知だけの成否を伝える）
  const [notifyNotice, setNotifyNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null)
  const showNotifyResult = (result: MeetingNotifyResult) => {
    if (result.notification === 'failed') {
      setNotifyNotice({ kind: 'warning', message: '保存は完了しましたが、通知メールの送信に失敗しました' })
    } else if (result.notification === 'sent') {
      setNotifyNotice({ kind: 'success', message: '保存し、通知メールを送信しました' })
    } else {
      // 通知対象外・送信済みでスキップ：前回の表示を残して誤解させないよう消す
      setNotifyNotice(null)
    }
  }

  // ── スクロール位置の維持 ──────────────────────────────────────
  // 年間計画は「モーダル本文（ダッシュボード込み）の縦スクロール」と
  // 「計画表そのもの（縦横）のスクロール」の2つのスクロール枠を持つ。
  // 操作のたびに最新位置を記録しておき、保存後の再読込・再描画で位置が変わっていたら元に戻す
  // （操作していたセル付近がそのまま見えている状態を保つ）
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef({ contentTop: 0, tableTop: 0, tableLeft: 0 })

  const rememberScroll = () => {
    savedScroll.current = {
      contentTop: contentScrollRef.current?.scrollTop ?? 0,
      tableTop: tableScrollRef.current?.scrollTop ?? 0,
      tableLeft: tableScrollRef.current?.scrollLeft ?? 0,
    }
  }

  useLayoutEffect(() => {
    const { contentTop, tableTop, tableLeft } = savedScroll.current
    const content = contentScrollRef.current
    const table = tableScrollRef.current
    if (content && content.scrollTop !== contentTop) content.scrollTop = contentTop
    if (table && table.scrollTop !== tableTop) table.scrollTop = tableTop
    if (table && table.scrollLeft !== tableLeft) table.scrollLeft = tableLeft
  }, [meetings, frequencies])

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

  // 選択中セルの施設のMT担当者候補（G長・主任 + リーダー）。
  // MeetingCellModal はこの配列の変化でフォームを初期化するため、入力が変わった時だけ作り直す
  // （毎レンダーで新しい配列を渡すと、親の再描画のたびにモーダルの入力・表示がリセットされる）
  const selectedFacilityId = selectedCell?.facility.id
  const selectedCandidateAssignees = useMemo<MeetingAssignee[]>(
    () => selectedFacilityId
      ? buildAssigneeCandidates(selectedFacilityId, activeManagers, managerFacilities, activeLeaders, leaderFacilities)
      : [],
    [selectedFacilityId, activeManagers, managerFacilities, activeLeaders, leaderFacilities]
  )

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


  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative bg-white w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:rounded-xl sm:max-w-6xl shadow-xl flex flex-col overflow-hidden">

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

          {/* 通知メールの結果（MT予定確定） */}
          {notifyNotice && (
            <div
              className={cn(
                'flex items-start gap-2 px-4 py-2 text-sm border-b flex-shrink-0',
                notifyNotice.kind === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              )}
              role="status"
            >
              <span className="flex-1">{notifyNotice.message}</span>
              <button
                onClick={() => setNotifyNotice(null)}
                className="p-0.5 rounded hover:bg-black/5"
                aria-label="お知らせを閉じる"
              >
                <X size={14} />
              </button>
            </div>
          )}

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
          <div
            ref={contentScrollRef}
            onScroll={tab === 'plan' ? rememberScroll : undefined}
            className="flex-1 overflow-y-auto"
          >
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

                {/* スマホのみ：ダッシュボードの開閉ボタン */}
                <button
                  onClick={() => setMobileDashboardOpen(v => !v)}
                  className="sm:hidden w-full flex items-center justify-between px-3 py-2 mb-3 rounded-lg border border-gray-200 bg-gray-50 text-sm font-medium text-gray-700"
                  aria-expanded={mobileDashboardOpen}
                >
                  <span>
                    進捗を見る
                    <span className="ml-1.5 text-xs font-normal text-gray-500">今月・期限超過・議事録</span>
                  </span>
                  <ChevronDown size={16} className={cn('transition-transform', mobileDashboardOpen && 'rotate-180')} />
                </button>
                <div className={cn(mobileDashboardOpen ? 'block' : 'hidden', 'sm:block')}>
                  <MeetingDashboard
                    meetings={visibleMeetings}
                    facilities={visibleFacilities}
                    onOpenMeeting={openMeetingDirectly}
                  />
                </div>

                {visibleFacilities.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-12">
                    {selectedManagerId ? 'このG長の担当施設が設定されていません' : '有効な施設がありません'}
                  </p>
                ) : (
                  // 計画表は縦横ともこの枠内でスクロールする（月ヘッダーを sticky top で固定するため、
                  // 横スクロール枠と縦スクロール枠を同じ要素にしている）。
                  // z-index: 本文セル(0) < 施設・種別列(10) < 月ヘッダー(30) < 左上の施設・種別見出し(40)
                  // 施設列の幅は種別列の sticky オフセットと一致させる（PC: 112px / left-28、スマホ: 80px / left-20）。
                  // スマホは各月を56px以上にして縮ませず、月部分だけを横スクロールさせる
                  // （狭い画面で施設列が縮むと、2列の隙間から横スクロール中の月セルが透けるため）
                  // border-separate にしているのは、border-collapse だと sticky セルの罫線が
                  // スクロール時に消えるため（border-spacing-0 で見た目は従来と同じ）
                  <div
                    ref={tableScrollRef}
                    onScroll={rememberScroll}
                    className="overflow-auto max-h-[70dvh] border border-gray-200 rounded-xl"
                  >
                    <table className="border-separate border-spacing-0 text-sm min-w-full">
                      <thead>
                        <tr className="text-xs text-gray-500">
                          <th className="sticky top-0 left-0 z-40 bg-gray-50 border-b border-r px-2 sm:px-3 py-2 text-left w-20 min-w-20 max-w-20 sm:w-28 sm:min-w-28 sm:max-w-28">施設</th>
                          <th className="sticky top-0 left-20 sm:left-28 z-40 bg-gray-50 border-b border-r px-2 sm:px-3 py-2 text-left w-14 min-w-14 max-w-14 sm:w-20 sm:min-w-20 sm:max-w-none">種別</th>
                          {MONTHS_IN_YEAR.map(m => (
                            <th key={m} className="sticky top-0 z-30 bg-gray-50 border-b px-1 py-2 text-center w-16 min-w-14 sm:min-w-0 font-medium whitespace-nowrap">{m}月</th>
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
                                  className="sticky left-0 z-10 bg-white border-r border-b px-2 sm:px-3 py-2 align-top font-medium text-xs sm:text-sm text-gray-700 whitespace-nowrap w-20 min-w-20 max-w-20 sm:w-28 sm:min-w-28 sm:max-w-28 truncate"
                                  title={facility.name}
                                >
                                  {facility.name}
                                </td>
                              )}
                              <td className="sticky left-20 sm:left-28 z-10 bg-white border-r border-b px-2 sm:px-3 py-2 text-xs sm:text-sm text-gray-500 whitespace-nowrap w-14 min-w-14 max-w-14 sm:w-auto sm:min-w-20 sm:max-w-none">
                                {MEETING_TYPE_LABELS[meetingType]}
                              </td>
                              {MONTHS_IN_YEAR.map(month => {
                                const targetMonth = buildTargetMonth(year, month)
                                const meeting = lookup.get(meetingLookupKey(facility.id, meetingType, targetMonth))
                                const status = getMeetingCellStatus(meeting)
                                return (
                                  <td key={month} className="border-b p-1 text-center min-w-14 sm:min-w-0">
                                    <button
                                      onClick={() => { rememberScroll(); openCell(facility, meetingType, month) }}
                                      className={cn(
                                        'w-full h-9 rounded-md text-xs leading-tight flex items-center justify-center transition-colors hover:opacity-80',
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
        candidateAssignees={selectedCandidateAssignees}
        onClose={() => setSelectedCell(null)}
        onAddManual={async input => {
          if (!selectedCell) return
          const result = await onAddManual({
            facilityId: selectedCell.facility.id,
            meetingType: selectedCell.meetingType,
            targetMonth: selectedCell.targetMonth,
            memo: input.memo,
            schedule: input.schedule,
          })
          showNotifyResult(result)
        }}
        onConfirmSchedule={async input => {
          if (!selectedCell?.meeting) return
          const result = await onConfirmSchedule(selectedCell.meeting.id, input)
          showNotifyResult(result)
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
        onMoveTargetMonth={async newTargetMonth => {
          if (!selectedCell?.meeting) return
          await onMoveTargetMonth(selectedCell.meeting.id, newTargetMonth)
        }}
        onMoveTargetMonthCascade={async newTargetMonth => {
          if (!selectedCell?.meeting) return
          await onMoveTargetMonthCascade(selectedCell.meeting.id, newTargetMonth)
        }}
        onDeleteMeeting={async () => {
          if (!selectedCell?.meeting) return
          await onDeleteMeeting(selectedCell.meeting.id)
        }}
      />

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT.meetingPlan}
      />
    </>
  )
}
