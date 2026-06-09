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
import { GroupLeaderTabs, ALL_LEADER_ID } from '@/components/GroupLeaderTabs'
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
import { StaffMemberModal } from '@/components/staff/StaffMemberModal'
import { useStaffMembers } from '@/hooks/useStaffMembers'
import {
  hasLocalStorageData,
  migrateToSupabase,
  dismissMigration,
  type MigrationResult,
} from '@/services/migrationService'
import type { ColorMode, EventFilters, ScheduleEvent, CreateEventInput } from '@/lib/types'

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

  const {
    members: leaderMembers,
    addMember: addLeader,
    updateMember: updateLeader,
    toggleActive: toggleLeaderActive,
    moveUp: moveLeaderUp,
    moveDown: moveLeaderDown,
  } = useStaffMembers('leader')

  const {
    members: rounderMembers,
    addMember: addRounder,
    updateMember: updateRounder,
    toggleActive: toggleRounderActive,
    moveUp: moveRounderUp,
    moveDown: moveRounderDown,
  } = useStaffMembers('rounder')

  const {
    members: fieldEmployeeMembers,
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

  const handleDismissMigration = () => {
    dismissMigration()
    setShowMigration(false)
  }

  // ── 選択中のG長タブ ──────────────────────────────────────────────
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>(ALL_LEADER_ID)
  const colorMode: ColorMode = selectedLeaderId === ALL_LEADER_ID ? 'leader' : 'type'

  // ── モーダル状態 ─────────────────────────────────────────────────
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [modalDate, setModalDate] = useState<Date | undefined>()
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null)
  const [facilityManagerOpen, setFacilityManagerOpen] = useState(false)
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [announcementAdminOpen, setAnnouncementAdminOpen] = useState(false)
  const [shiftManagerOpen, setShiftManagerOpen] = useState(false)
  const [leaderManagerOpen, setLeaderManagerOpen] = useState(false)
  const [rounderManagerOpen, setRounderManagerOpen] = useState(false)
  const [fieldEmployeeManagerOpen, setFieldEmployeeManagerOpen] = useState(false)

  // ── フィルタ ─────────────────────────────────────────────────────
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS)

  const filteredEvents = useMemo(() => events.filter(event => {
    const leaderMatch = selectedLeaderId === ALL_LEADER_ID || event.groupLeaderId === selectedLeaderId
    const typeMatch = filters.types.length === 0 || filters.types.includes(event.type)
    const facilityMatch = filters.facilities.length === 0 || filters.facilities.includes(event.facilityName)
    return leaderMatch && typeMatch && facilityMatch
  }), [events, selectedLeaderId, filters])

  const leaderBaseCount = useMemo(() =>
    events.filter(e => selectedLeaderId === ALL_LEADER_ID || e.groupLeaderId === selectedLeaderId).length,
    [events, selectedLeaderId]
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

  const handleSave = useCallback(async (input: CreateEventInput) => {
    if (editingEvent) await updateEvent(editingEvent.id, input)
    else await addEvent(input)
  }, [editingEvent, addEvent, updateEvent])

  const handleSaveBulk = useCallback(async (inputs: CreateEventInput[]) => {
    await addEvents(inputs)
  }, [addEvents])

  const handleDelete = useCallback(async (id: string) => {
    await deleteEvent(id)
  }, [deleteEvent])

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

  const preselectedLeaderId = selectedLeaderId !== ALL_LEADER_ID ? selectedLeaderId : undefined

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
    <div className="flex flex-col min-h-screen md:h-screen bg-gray-50">
      {/* App bar */}
      <div className="bg-blue-700 text-white px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-base font-bold leading-tight">イートハピネス総合スケジュール管理アプリ</h1>
          <p className="text-xs text-blue-200 leading-tight">
            {formatJa(new Date(), 'yyyy年M月d日（EEE）')}
          </p>
        </div>
        <div className="text-xs text-blue-200 text-right">
          <p>全{events.length}件</p>
          {(selectedLeaderId !== ALL_LEADER_ID || filters.types.length > 0 || filters.facilities.length > 0) && (
            <p className="text-blue-300">表示{filteredEvents.length}件</p>
          )}
        </div>
      </div>

      {/* エラーバナー（データ取得失敗時も空カレンダーを表示） */}
      {ErrorBanner}

      {/* localStorage 移行バナー */}
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

      {/* お知らせバナー */}
      <AnnouncementBanner
        announcements={announcements}
        onOpenAdmin={() => setAnnouncementAdminOpen(true)}
      />

      {/* Group leader tabs */}
      <GroupLeaderTabs
        selected={selectedLeaderId}
        activeManagers={activeManagers}
        onChange={setSelectedLeaderId}
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
        onOpenLeaderManager={() => setLeaderManagerOpen(true)}
        onOpenRounderManager={() => setRounderManagerOpen(true)}
        onOpenFieldEmployeeManager={() => setFieldEmployeeManagerOpen(true)}
      />

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        facilityNames={facilityNames}
        totalCount={leaderBaseCount}
        filteredCount={filteredEvents.length}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      {/* Calendar body */}
      <main className="flex-1 bg-white md:overflow-y-auto md:min-h-0">
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
    </div>
  )
}
