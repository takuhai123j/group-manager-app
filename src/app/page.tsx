'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { formatJa } from '@/lib/utils'
import { useEvents } from '@/hooks/useEvents'
import { useCalendar } from '@/hooks/useCalendar'
import { useFacilities } from '@/hooks/useFacilities'
import { useGroupManagers } from '@/hooks/useGroupManagers'
import { useManagerFacilities } from '@/hooks/useManagerFacilities'
import { useAnnouncements } from '@/hooks/useAnnouncements'
import { useShiftFiles } from '@/hooks/useShiftFiles'
import { useMeetingPlan } from '@/hooks/useMeetingPlan'
import { StaffTabs, type RoleTab, ALL_PERSON_ID } from '@/components/StaffTabs'
import { CalendarHeader } from '@/components/calendar/CalendarHeader'
import { FilterBar } from '@/components/calendar/FilterBar'
import { MonthView } from '@/components/calendar/MonthView'
import { WeekView } from '@/components/calendar/WeekView'
import { DayView } from '@/components/calendar/DayView'
import { EventModal } from '@/components/events/EventModal'
import { FacilityManager } from '@/components/facilities/FacilityManager'
import { GroupManagerModal } from '@/components/managers/GroupManagerModal'
import { AnnouncementBanner } from '@/components/announcements/AnnouncementBanner'
import { AnnouncementAdmin } from '@/components/announcements/AnnouncementAdmin'
import { ShiftFileManager } from '@/components/shifts/ShiftFileManager'
import { MeetingPlanManager } from '@/components/meetings/MeetingPlanManager'
import { StaffMemberModal } from '@/components/staff/StaffMemberModal'
import { useStaffMembers } from '@/hooks/useStaffMembers'
import { useStaffMemberFacilities } from '@/hooks/useStaffMemberFacilities'
import { ShiftChangeManager } from '@/components/shiftChanges/ShiftChangeManager'
import { useShiftChanges } from '@/hooks/useShiftChanges'
import { HelpModal } from '@/components/help/HelpModal'
import { HELP_CONTENT } from '@/constants/helpContent'
import {
  hasLocalStorageData,
  migrateToSupabase,
  dismissMigration,
  type MigrationResult,
} from '@/services/migrationService'
import type { ColorMode, EventFilters, ScheduleEvent, CreateEventInput, CreateShiftChangeInput } from '@/lib/types'

// ブラウザConsoleにエラー詳細を出力するヘルパー
function logError(context: string, error: unknown) {
  if (typeof window !== 'undefined') {
    console.error(`[${context}]`, error)
  }
}

const EMPTY_FILTERS: EventFilters = { types: [], facilities: [] }

// ── ローカルストレージ移行バナー ───────────────────────────────────────
function MigrationBanner({
  onMigrate,
  onDismiss,
}: {
  onMigrate: () => Promise<MigrationResult>
  onDismiss: () => void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  const handleMigrate = async () => {
    setRunning(true)
    const res = await onMigrate()
    setResult(res)
    setRunning(false)
  }

  if (result) {
    return (
      <div className={`flex items-start gap-3 px-4 py-3 text-sm ${result.errors.length > 0 ? 'bg-amber-50 border-b border-amber-200' : 'bg-green-50 border-b border-green-200'}`}>
        <CheckCircle2 size={16} className={`flex-shrink-0 mt-0.5 ${result.errors.length > 0 ? 'text-amber-600' : 'text-green-600'}`} />
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${result.errors.length > 0 ? 'text-amber-800' : 'text-green-800'}`}>
            {result.migratedCount}件を移行しました
            {result.skippedCount > 0 && `（${result.skippedCount}件スキップ）`}
          </p>
          {result.errors.length > 0 && (
            <p className="text-xs text-amber-700 mt-0.5 truncate">{result.errors[0]}</p>
          )}
        </div>
        <button onClick={onDismiss} className="p-1 rounded text-gray-400 hover:text-gray-600 flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 text-sm">
      <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-800">以前のデータが見つかりました</p>
        <p className="text-xs text-amber-700 mt-0.5">
          localStorageに保存された予定をSupabaseへ移行できます。
        </p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={onDismiss}
          className="px-2.5 py-1 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-100"
        >
          スキップ
        </button>
        <button
          onClick={handleMigrate}
          disabled={running}
          className="px-2.5 py-1 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {running ? '移行中…' : '移行する'}
        </button>
      </div>
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────────────────
export default function HomePage() {
  const { currentDate, view, goToToday, navigateNext, navigatePrev, changeView, setDate } = useCalendar()
  const {
    events, loading: eventsLoading, error: eventsError,
    addEvent, addEvents, updateEvent, deleteEvent, reload: reloadEvents,
  } = useEvents()
  const {
    facilities, allFacilities, facilityNames,
    loading: facilitiesLoading, error: facilitiesError,
    addFacility, deactivateFacility,
  } = useFacilities()
  const {
    managers, activeManagers,
    loading: managersLoading, error: managersError,
    addManager, updateManager, toggleActive, moveUp, moveDown,
  } = useGroupManagers()

  const {
    managerFacilities,
    loading: managerFacilitiesLoading,
    setDefaultFacilities,
  } = useManagerFacilities()

  const {
    announcements,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
  } = useAnnouncements()

  const {
    files: shiftFiles,
    loading: shiftFilesLoading,
    upload: uploadShiftFile,
    remove: removeShiftFile,
  } = useShiftFiles()

  const [meetingPlanYear, setMeetingPlanYear] = useState(() => new Date().getFullYear())
  const {
    meetings, frequencies: meetingFrequencies,
    loading: meetingPlanLoading, error: meetingPlanError,
    reload: reloadMeetingPlan,
    addManual: addMeetingManual,
    confirmSchedule: confirmMeetingSchedule,
    rescheduleMeeting,
    cancelSchedule: cancelMeetingSchedule,
    markDone: markMeetingDone,
    saveFrequency: saveMeetingFrequency,
    toggleFrequencyActive: toggleMeetingFrequencyActive,
    uploadMinute: uploadMeetingMinute,
    deleteMinute: deleteMeetingMinute,
    moveTargetMonth: moveMeetingTargetMonth,
    moveTargetMonthCascade: moveMeetingTargetMonthCascade,
    deleteMeeting: deleteMeetingRecord,
  } = useMeetingPlan(meetingPlanYear)

  const {
    records: shiftChangeRecords,
    loading: shiftChangesLoading,
    reload: reloadShiftChanges,
    addRecord: addShiftChange,
    updateRecord: updateShiftChange,
    deleteRecord: deleteShiftChange,
    loadGroup: loadShiftChangeGroup,
    linkCompensatoryLeave: linkShiftChangeCompensatoryLeave,
  } = useShiftChanges()

  const {
    members: leaderMembers,
    activeMembers: activeLeaders,
    addMember: addLeader,
    updateMember: updateLeader,
    toggleActive: toggleLeaderActive,
    moveUp: moveLeaderUp,
    moveDown: moveLeaderDown,
  } = useStaffMembers('leader')

  // リーダーの担当施設（staff_member_facilities）。G長の useManagerFacilities とは独立
  const {
    memberFacilities: leaderFacilities,
    setFacilities: setLeaderFacilities,
  } = useStaffMemberFacilities()

  const {
    members: rounderMembers,
    activeMembers: activeRounders,
    addMember: addRounder,
    updateMember: updateRounder,
    toggleActive: toggleRounderActive,
    moveUp: moveRounderUp,
    moveDown: moveRounderDown,
  } = useStaffMembers('rounder')

  const {
    members: fieldEmployeeMembers,
    activeMembers: activeFieldEmployees,
    addMember: addFieldEmployee,
    updateMember: updateFieldEmployee,
    toggleActive: toggleFieldEmployeeActive,
    moveUp: moveFieldEmployeeUp,
    moveDown: moveFieldEmployeeDown,
  } = useStaffMembers('field_employee')

  const loading = eventsLoading || facilitiesLoading || managersLoading || managerFacilitiesLoading
  const loadError = eventsError ?? facilitiesError ?? managersError

  // エラー内容をコンソールに出力（ブラウザDevToolsで確認可能）
  useEffect(() => {
    if (loadError) logError('DataLoadError', loadError)
  }, [loadError])

  // ── localStorage 移行バナー ──────────────────────────────────────
  const [showMigration, setShowMigration] = useState(false)
  const [migrationDone, setMigrationDone] = useState(false)
  useEffect(() => {
    if (!loading) setShowMigration(hasLocalStorageData())
  }, [loading])


  const handleMigrate = async (): Promise<MigrationResult> => {
    const result = await migrateToSupabase()
    await reloadEvents()
    setMigrationDone(true)
    return result
  }

  // ── MT年間計画からのschedule操作後、カレンダー側の予定一覧も再同期する ──
  // useMeetingPlan 側は meetings を再取得するだけなので、schedules を作成・更新・削除する
  // 操作の成功後はカレンダー（useEvents）も既存の reload で再取得する
  const handleAddMeetingManual: typeof addMeetingManual = async input => {
    const result = await addMeetingManual(input)
    if (input.schedule) await reloadEvents({ silent: true })
    return result
  }

  const handleConfirmMeetingSchedule: typeof confirmMeetingSchedule = async (meetingId, input) => {
    const result = await confirmMeetingSchedule(meetingId, input)
    await reloadEvents({ silent: true })
    return result
  }

  const handleRescheduleMeeting: typeof rescheduleMeeting = async (meetingId, input) => {
    await rescheduleMeeting(meetingId, input)
    await reloadEvents({ silent: true })
  }

  const handleCancelMeetingSchedule: typeof cancelMeetingSchedule = async meetingId => {
    await cancelMeetingSchedule(meetingId)
    await reloadEvents({ silent: true })
  }

  const handleDismissMigration = () => {
    dismissMigration()
    setShowMigration(false)
  }

  // ── 表示切替タブ ─────────────────────────────────────────────────
  const [selectedRole, setSelectedRole] = useState<RoleTab>('all')
  const [selectedPersonId, setSelectedPersonId] = useState<string>(ALL_PERSON_ID)

  const handleRoleChange = useCallback((role: RoleTab) => {
    setSelectedRole(role)
    setSelectedPersonId(ALL_PERSON_ID)
  }, [])

  const colorMode: ColorMode =
    selectedRole === 'all' ||
    (selectedRole === 'group_manager' && selectedPersonId === ALL_PERSON_ID)
      ? 'leader'
      : 'type'

  // ── モーダル状態 ─────────────────────────────────────────────────
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | undefined>()
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null)
  const [facilityManagerOpen, setFacilityManagerOpen] = useState(false)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [announcementAdminOpen, setAnnouncementAdminOpen] = useState(false)
  const [shiftManagerOpen, setShiftManagerOpen] = useState(false)
  const [shiftChangeManagerOpen, setShiftChangeManagerOpen] = useState(false)
  const [meetingPlanOpen, setMeetingPlanOpen] = useState(false)
  const [leaderManagerOpen, setLeaderManagerOpen] = useState(false)
  const [rounderManagerOpen, setRounderManagerOpen] = useState(false)
  const [fieldEmployeeManagerOpen, setFieldEmployeeManagerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // ── フィルタ ─────────────────────────────────────────────────────
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS)
  // スマホ（sm未満）では絞り込みバーを常時表示せず、「⋯ → 絞り込み」から開く
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const isFilterActive = filters.types.length > 0 || filters.facilities.length > 0

  // 職種タブ・人の絞り込み。
  //   G長タブ    : G長・主任担当の予定のみ（リーダー担当のMTは含めない）
  //   リーダータブ: リーダー担当の予定（当面MTのみ）を staff_member_id で照合
  //   ラウンダー・現場社員: 予定データ未連携のため非表示
  const matchesPerson = useCallback((event: ScheduleEvent): boolean => {
    if (selectedRole === 'all') return true
    if (selectedRole === 'group_manager') {
      if (!event.groupLeaderId) return false
      return selectedPersonId === ALL_PERSON_ID || event.groupLeaderId === selectedPersonId
    }
    if (selectedRole === 'leader') {
      if (!event.staffMemberId) return false
      return selectedPersonId === ALL_PERSON_ID || event.staffMemberId === selectedPersonId
    }
    return false
  }, [selectedRole, selectedPersonId])

  const filteredEvents = useMemo(() => events.filter(event => {
    const personMatch = matchesPerson(event)
    const typeMatch = filters.types.length === 0 || filters.types.includes(event.type)
    const facilityMatch = filters.facilities.length === 0 || filters.facilities.includes(event.facilityName)
    return personMatch && typeMatch && facilityMatch
  }), [events, matchesPerson, filters])

  const leaderBaseCount = useMemo(
    () => events.filter(matchesPerson).length,
    [events, matchesPerson]
  )

  // ── モーダルヘルパー ─────────────────────────────────────────────
  const openAdd = useCallback((date?: Date) => {
    setEditingEvent(null)
    setModalDate(date ?? currentDate)
    setEventModalOpen(true)
  }, [currentDate])

  const openEdit = useCallback((event: ScheduleEvent) => {
    setEditingEvent(event)
    setModalDate(undefined)
    setEventModalOpen(true)
  }, [])

  const closeEventModal = useCallback(() => {
    setEventModalOpen(false)
    setEditingEvent(null)
    setModalDate(undefined)
  }, [])

  // カレンダー側でMTの予定を更新・削除した場合は、MT年間計画側（meetings のJOIN結果）も
  // 読み直す（古い日付・時間・担当者のまま「予定を保存」フォームに表示されないように）
  const handleSave = useCallback(async (input: CreateEventInput) => {
    if (editingEvent) await updateEvent(editingEvent.id, input)
    else await addEvent(input)
    if (editingEvent?.type === 'mt' || input.type === 'mt') await reloadMeetingPlan({ silent: true })
  }, [editingEvent, addEvent, updateEvent, reloadMeetingPlan])

  const handleSaveBulk = useCallback(async (inputs: CreateEventInput[]) => {
    await addEvents(inputs)
  }, [addEvents])

  const handleDelete = useCallback(async (id: string) => {
    const wasMt = events.find(e => e.id === id)?.type === 'mt'
    await deleteEvent(id)
    if (wasMt) await reloadMeetingPlan({ silent: true })
  }, [events, deleteEvent, reloadMeetingPlan])

  const handleDayClick = useCallback((date: Date) => {
    setDate(date); changeView('day')
  }, [setDate, changeView])

  const handleSlotClick = useCallback((date: Date) => {
    setModalDate(date); setEditingEvent(null); setEventModalOpen(true)
  }, [])

  const openFacilityManager = useCallback(() => {
    setEventModalOpen(false); setFacilityManagerOpen(true)
  }, [])

  const openGroupManager = useCallback(() => {
    setEventModalOpen(false); setGroupManagerOpen(true)
  }, [])

  const preselectedLeaderId =
    selectedRole === 'group_manager' && selectedPersonId !== ALL_PERSON_ID
      ? selectedPersonId
      : undefined

  // ── ローディング画面 ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">読み込み中…</p>
        </div>
      </div>
    )
  }

  // ── エラーバナー（エラー時もカレンダー画面は表示する） ──────────
  const ErrorBanner = loadError ? (
    <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border-b border-red-200 text-sm flex-shrink-0">
      <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-red-800">データの読み込みに失敗しました</p>
        <p className="text-xs text-red-600 mt-0.5 truncate">{loadError}</p>
      </div>
    </div>
  ) : null

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* エラー・移行バナーは常に表示 */}
      {ErrorBanner}
      {showMigration && !migrationDone && (
        <MigrationBanner
          onMigrate={handleMigrate}
          onDismiss={handleDismissMigration}
        />
      )}
      {showMigration && migrationDone && (
        <MigrationBanner
          onMigrate={handleMigrate}
          onDismiss={() => setShowMigration(false)}
        />
      )}

      {/* App bar */}
      <div className="bg-blue-700 text-white px-3 py-1.5 sm:px-4 sm:py-2 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-sm sm:text-base font-bold leading-tight">イートハピネス総合スケジュール管理アプリ</h1>
          <p className="text-xs text-blue-200 leading-tight hidden sm:block">
            {formatJa(new Date(), 'yyyy年M月d日（EEE）')}
          </p>
        </div>
        <div className="text-xs text-blue-200 text-right">
          <p>全{events.length}件</p>
          {(selectedRole !== 'all' || selectedPersonId !== ALL_PERSON_ID || filters.types.length > 0 || filters.facilities.length > 0) && (
            <p className="text-blue-300">表示{filteredEvents.length}件</p>
          )}
        </div>
      </div>

      {/* お知らせバナー */}
      <AnnouncementBanner
        announcements={announcements}
        onOpenAdmin={() => setAnnouncementAdminOpen(true)}
      />

      {/* 職種タブ + 個人タブ */}
      <StaffTabs
        selectedRole={selectedRole}
        selectedPersonId={selectedPersonId}
        activeManagers={activeManagers}
        activeLeaders={activeLeaders}
        activeRounders={activeRounders}
        activeFieldEmployees={activeFieldEmployees}
        onRoleChange={handleRoleChange}
        onPersonChange={setSelectedPersonId}
      />

      {/* Calendar header */}
      <CalendarHeader
        currentDate={currentDate}
        view={view}
        onPrev={navigatePrev}
        onNext={navigateNext}
        onToday={goToToday}
        onChangeView={changeView}
        onAddEvent={() => openAdd()}
        onOpenGroupManager={openGroupManager}
        onOpenFacilityManager={openFacilityManager}
        onOpenShiftManager={() => setShiftManagerOpen(true)}
        onOpenShiftChangeManager={() => setShiftChangeManagerOpen(true)}
        onOpenMeetingPlan={() => setMeetingPlanOpen(true)}
        onOpenLeaderManager={() => setLeaderManagerOpen(true)}
        onOpenRounderManager={() => setRounderManagerOpen(true)}
        onOpenFieldEmployeeManager={() => setFieldEmployeeManagerOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenFilter={() => setMobileFilterOpen(true)}
      />

      {/* Filter bar - PC（常時表示） */}
      <div className="hidden sm:block flex-shrink-0">
        <FilterBar
          filters={filters}
          facilityNames={facilityNames}
          totalCount={leaderBaseCount}
          filteredCount={filteredEvents.length}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
        />
      </div>

      {/* Filter bar - スマホ（「⋯ → 絞り込み」で開く。絞り込み中はクリアできるよう表示を続ける） */}
      {(mobileFilterOpen || isFilterActive) && (
        <div className="sm:hidden flex-shrink-0 max-h-[50dvh] overflow-y-auto">
          <FilterBar
            key={mobileFilterOpen ? 'mobile-open' : 'mobile-active'}
            filters={filters}
            facilityNames={facilityNames}
            totalCount={leaderBaseCount}
            filteredCount={filteredEvents.length}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
            initiallyExpanded={mobileFilterOpen}
            onClose={() => setMobileFilterOpen(false)}
          />
        </div>
      )}

      {/* Calendar body */}
      <main className="flex-1 bg-white overflow-y-auto min-h-0">
        {view === 'month' && (
          <MonthView
            currentDate={currentDate}
            events={filteredEvents}
            managers={managers}
            managerFacilities={managerFacilities}
            colorMode={colorMode}
            onDayClick={handleDayClick}
            onEventClick={openEdit}
          />
        )}
        {view === 'week' && (
          <WeekView
            currentDate={currentDate}
            events={filteredEvents}
            managers={managers}
            managerFacilities={managerFacilities}
            colorMode={colorMode}
            onSlotClick={handleSlotClick}
            onEventClick={openEdit}
          />
        )}
        {view === 'day' && (
          <DayView
            currentDate={currentDate}
            events={filteredEvents}
            managers={managers}
            managerFacilities={managerFacilities}
            colorMode={colorMode}
            onSlotClick={handleSlotClick}
            onEventClick={openEdit}
          />
        )}
      </main>

      {/* Event modal */}
      <EventModal
        isOpen={eventModalOpen}
        initialDate={modalDate}
        editingEvent={editingEvent}
        facilities={facilities}
        allFacilities={allFacilities}
        activeManagers={activeManagers}
        allManagers={managers}
        managerFacilities={managerFacilities}
        preselectedLeaderId={preselectedLeaderId}
        onClose={closeEventModal}
        onSave={handleSave}
        onSaveBulk={handleSaveBulk}
        onDelete={handleDelete}
        onOpenFacilityManager={openFacilityManager}
      />

      {/* Facility manager */}
      <FacilityManager
        isOpen={facilityManagerOpen}
        facilities={facilities}
        onClose={() => setFacilityManagerOpen(false)}
        onAdd={addFacility}
        onDeactivate={deactivateFacility}
      />

      {/* お知らせ管理モーダル */}
      <AnnouncementAdmin
        isOpen={announcementAdminOpen}
        announcements={announcements}
        onClose={() => setAnnouncementAdminOpen(false)}
        onAdd={addAnnouncement}
        onUpdate={updateAnnouncement}
        onDelete={deleteAnnouncement}
      />

      {/* シフト変更記録 */}
      <ShiftChangeManager
        isOpen={shiftChangeManagerOpen}
        records={shiftChangeRecords}
        loading={shiftChangesLoading}
        facilities={allFacilities}
        onClose={() => setShiftChangeManagerOpen(false)}
        onAdd={addShiftChange}
        onUpdate={updateShiftChange}
        onDelete={deleteShiftChange}
        onReload={reloadShiftChanges}
        onLoadRelatedGroup={loadShiftChangeGroup}
        onLinkCompensatoryLeave={linkShiftChangeCompensatoryLeave}
      />

      {/* シフト表管理 */}
      <ShiftFileManager
        isOpen={shiftManagerOpen}
        files={shiftFiles}
        loading={shiftFilesLoading}
        facilities={allFacilities}
        onClose={() => setShiftManagerOpen(false)}
        onUpload={uploadShiftFile}
        onDelete={removeShiftFile}
      />

      {/* MT年間計画 */}
      <MeetingPlanManager
        isOpen={meetingPlanOpen}
        year={meetingPlanYear}
        onYearChange={setMeetingPlanYear}
        facilities={facilities}
        activeManagers={activeManagers}
        managerFacilities={managerFacilities}
        activeLeaders={activeLeaders}
        leaderFacilities={leaderFacilities}
        meetings={meetings}
        frequencies={meetingFrequencies}
        loading={meetingPlanLoading}
        error={meetingPlanError}
        onClose={() => setMeetingPlanOpen(false)}
        onAddManual={handleAddMeetingManual}
        onConfirmSchedule={handleConfirmMeetingSchedule}
        onReschedule={handleRescheduleMeeting}
        onCancelSchedule={handleCancelMeetingSchedule}
        onMarkDone={markMeetingDone}
        onSaveFrequency={saveMeetingFrequency}
        onToggleFrequencyActive={toggleMeetingFrequencyActive}
        onUploadMinute={uploadMeetingMinute}
        onDeleteMinute={deleteMeetingMinute}
        onMoveTargetMonth={moveMeetingTargetMonth}
        onMoveTargetMonthCascade={moveMeetingTargetMonthCascade}
        onDeleteMeeting={deleteMeetingRecord}
      />

      {/* リーダー管理モーダル */}
      <StaffMemberModal
        isOpen={leaderManagerOpen}
        role="leader"
        members={leaderMembers}
        onClose={() => setLeaderManagerOpen(false)}
        onAdd={addLeader}
        onUpdate={updateLeader}
        onToggleActive={toggleLeaderActive}
        onMoveUp={moveLeaderUp}
        onMoveDown={moveLeaderDown}
        allFacilities={allFacilities}
        memberFacilities={leaderFacilities}
        onSetFacilities={setLeaderFacilities}
      />

      {/* ラウンダー管理モーダル */}
      <StaffMemberModal
        isOpen={rounderManagerOpen}
        role="rounder"
        members={rounderMembers}
        onClose={() => setRounderManagerOpen(false)}
        onAdd={addRounder}
        onUpdate={updateRounder}
        onToggleActive={toggleRounderActive}
        onMoveUp={moveRounderUp}
        onMoveDown={moveRounderDown}
      />

      {/* 現場社員管理モーダル */}
      <StaffMemberModal
        isOpen={fieldEmployeeManagerOpen}
        role="field_employee"
        members={fieldEmployeeMembers}
        onClose={() => setFieldEmployeeManagerOpen(false)}
        onAdd={addFieldEmployee}
        onUpdate={updateFieldEmployee}
        onToggleActive={toggleFieldEmployeeActive}
        onMoveUp={moveFieldEmployeeUp}
        onMoveDown={moveFieldEmployeeDown}
      />

      {/* Group manager modal */}
      <GroupManagerModal
        isOpen={groupManagerOpen}
        managers={managers}
        allFacilities={allFacilities}
        managerFacilities={managerFacilities}
        onClose={() => setGroupManagerOpen(false)}
        onAdd={addManager}
        onUpdate={updateManager}
        onToggleActive={toggleActive}
        onMoveUp={moveUp}
        onMoveDown={moveDown}
        onSetFacilities={setDefaultFacilities}
      />

      {/* ヘルプ（月/週/日表示） */}
      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT[view === 'month' ? 'monthView' : view === 'week' ? 'weekView' : 'dayView']}
      />
    </div>
  )
}
