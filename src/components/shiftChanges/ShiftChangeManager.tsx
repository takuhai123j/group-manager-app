'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Filter, ChevronDown, ChevronUp, Search, CalendarCheck, Link2, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHIFT_CHANGE_TYPES, SHIFT_SWAP_TYPES } from '@/lib/types'
import { ShiftChangeFormModal } from './ShiftChangeFormModal'
import { ShiftSwapFormModal } from './ShiftSwapFormModal'
import { formatMonthDayWeek } from '@/lib/shiftSwapMail'
import { shiftSwapService } from '@/services/shiftSwapService'
import type { ShiftSwapNotifyStatus, ShiftSwapOperation } from '@/lib/types'

// 勤務・休日振替の本部への通知の状態（一覧の表示用）
const NOTIFY_LABELS: Record<ShiftSwapNotifyStatus, { label: string; cls: string }> = {
  pending: { label: '通知：未送信', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  sending: { label: '通知：送信中', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  sent: { label: '通知：送信済み', cls: 'bg-gray-50 text-gray-600 border-gray-300' },
  failed: { label: '通知：送信失敗', cls: 'bg-red-100 text-red-800 border-red-300' },
  unknown: { label: '通知：結果不明', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  needs_check: { label: '通知：要確認', cls: 'bg-red-100 text-red-800 border-red-300' },
}
const ACTION_LABELS: Record<ShiftSwapOperation['action'], string> = { create: '登録', update: '変更', cancel: '取消' }
import { HelpButton } from '@/components/help/HelpButton'
import { HelpModal } from '@/components/help/HelpModal'
import { HELP_CONTENT } from '@/constants/helpContent'
import { formatCalendarTime, targetKey } from '@/lib/shiftChangeCalendar'
import { chainSteps, chainSummary } from '@/lib/shiftChangeChain'
import type {
  ShiftChangeRecord, CreateShiftChangeInput, Facility, ShiftChangeFilters, GroupManager, StaffMember, ScheduleEvent,
} from '@/lib/types'

interface Props {
  isOpen: boolean
  records: ShiftChangeRecord[]
  loading: boolean
  facilities: Facility[]
  // カレンダー反映先の候補（無効化済みも含めて渡す。候補に出すのは有効な人と、既に指定済みの人だけ）
  managers: GroupManager[]
  staffMembers: StaffMember[]
  onClose: () => void
  onAdd: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onAddBatch: (inputs: (CreateShiftChangeInput & { id: string })[]) => Promise<ShiftChangeRecord[]>
  onUpdate: (id: string, input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onDelete: (id: string) => Promise<void>
  onReload: (filters?: Partial<ShiftChangeFilters>) => Promise<void>
  onLoadRelatedGroup: (groupId: string) => Promise<ShiftChangeRecord[]>
  onLinkCompensatoryLeave: (detailId: string) => Promise<void>
  // カレンダーの自動登録予定から開くシフト変更（開いたら onOpenRecordHandled で解除する）
  openRecordId?: string | null
  onLoadRecord?: (id: string) => Promise<ShiftChangeRecord>
  onOpenRecordHandled?: () => void
  // 勤務・休日振替の画面で使うカレンダーの全予定（公休・MT・予定の重なりの確認）と、保存・取消後の再読み込み
  events: ScheduleEvent[]
  onSwapChanged: () => Promise<void> | void
}

const CHANGE_TYPE_COLORS: Record<string, string> = {
  欠勤: 'bg-red-100 text-red-700',
  遅刻: 'bg-orange-100 text-orange-700',
  早退: 'bg-lime-100 text-lime-800',
  時間変更: 'bg-purple-100 text-purple-700',
  交代出勤: 'bg-blue-100 text-blue-700',
  休日出勤: 'bg-amber-100 text-amber-800',
  振休: 'bg-indigo-100 text-indigo-700',
  その他: 'bg-gray-100 text-gray-700',
  // 勤務・休日振替（休日出勤・振休とは別の区分・別の色）
  振替出勤: 'bg-green-100 text-green-800',
  振替休日: 'bg-pink-100 text-pink-800',
  // 旧データ互換
  交代: 'bg-blue-100 text-blue-700',
  追加出勤: 'bg-green-100 text-green-700',
  休み変更: 'bg-teal-100 text-teal-700',
}

function formatDateFull(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${y}年${parseInt(m)}月${parseInt(d)}日`
}

export function ShiftChangeManager({
  isOpen, records, loading, facilities, managers, staffMembers,
  onClose, onAdd, onAddBatch, onUpdate, onDelete, onReload,
  onLoadRelatedGroup, onLinkCompensatoryLeave,
  openRecordId, onLoadRecord, onOpenRecordHandled, events, onSwapChanged,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftChangeRecord | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const [fFacilityId, setFFacilityId] = useState('')
  const [fDate, setFDate] = useState('')
  const [fReason, setFReason] = useState('')
  const [fHandledBy, setFHandledBy] = useState('')
  const [fEmployee, setFEmployee] = useState('')
  const [fChangeType, setFChangeType] = useState('')
  const [fExternalOnly, setFExternalOnly] = useState(false)
  const [fSupportFacilityId, setFSupportFacilityId] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  // 勤務・休日振替の画面（新規は swapEditingId = null）
  const [swapFormOpen, setSwapFormOpen] = useState(false)
  const [swapEditingId, setSwapEditingId] = useState<string | null>(null)
  // 本部への通知が済んでいない振替の操作（取消済みの振替の分も含む）と、振替ごとの最新の操作
  const [unsentOps, setUnsentOps] = useState<ShiftSwapOperation[]>([])
  const [latestOps, setLatestOps] = useState<Map<string, ShiftSwapOperation>>(new Map())
  const [notifyBusy, setNotifyBusy] = useState<string | null>(null)
  const [notifyError, setNotifyError] = useState<string | null>(null)
  const swapIdsKey = Array.from(new Set(records.filter(r => r.swapId).map(r => r.swapId as string))).sort().join(',')
  const loadOps = useCallback(async () => {
    try {
      const [unsent, latest] = await Promise.all([
        shiftSwapService.getUnsentOperations(),
        shiftSwapService.getLatestOperations(swapIdsKey ? swapIdsKey.split(',') : []),
      ])
      setUnsentOps(unsent); setLatestOps(latest)
    } catch {
      // 通知の状態が読めなくても一覧は表示する
      setUnsentOps([]); setLatestOps(new Map())
    }
  }, [swapIdsKey])
  useEffect(() => { if (isOpen) loadOps() }, [isOpen, loadOps])
  const handleRetryNotify = async (op: ShiftSwapOperation) => {
    setNotifyBusy(op.id); setNotifyError(null)
    const st = await shiftSwapService.notify(op.id)
    if (st === 'error') setNotifyError('通知を送れませんでした。時間をおいてもう一度お試しください')
    await loadOps()
    setNotifyBusy(null)
  }

  useEffect(() => {
    if (isOpen) onReload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // カレンダーから指定されたシフト変更を編集画面で開く（一覧の絞り込みに無い場合もあるため1件取得する）
  const [openError, setOpenError] = useState<string | null>(null)
  useEffect(() => {
    if (!isOpen || !openRecordId) return
    let cancelled = false
    setOpenError(null)
    const found = records.find(r => r.id === openRecordId)
    const load = found ? Promise.resolve(found) : onLoadRecord?.(openRecordId) ?? Promise.reject(new Error('no loader'))
    load
      .then(r => {
        if (cancelled) return
        // 勤務・休日振替の記録は、振替の画面で2日分まとめて開く
        if (r.swapId) { setSwapEditingId(r.swapId); setSwapFormOpen(true) }
        else { setEditing(r); setFormOpen(true) }
      })
      .catch(() => { if (!cancelled) setOpenError('シフト変更の記録を開けませんでした（削除された可能性があります）') })
      .finally(() => { if (!cancelled) onOpenRecordHandled?.() })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, openRecordId])

  if (!isOpen) return null

  const hasFilter = fFacilityId || fDate || fReason || fHandledBy || fEmployee || fChangeType || fExternalOnly || fSupportFacilityId

  const buildFilters = (): Partial<ShiftChangeFilters> => ({
    facilityId: fFacilityId || undefined,
    targetDate: fDate || undefined,
    reason: fReason || undefined,
    handledBy: fHandledBy || undefined,
    employeeName: fEmployee || undefined,
    changeType: fChangeType || undefined,
    isExternalSupport: fExternalOnly ? 'true' : undefined,
    supportFacilityId: fSupportFacilityId || undefined,
  })

  const handleSearch = () => onReload(buildFilters())
  const handleClear = () => {
    setFFacilityId(''); setFDate(''); setFReason('')
    setFHandledBy(''); setFEmployee(''); setFChangeType('')
    setFExternalOnly(false); setFSupportFacilityId('')
    onReload()
  }

  const openAdd = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (r: ShiftChangeRecord) => {
    if (r.swapId) { setSwapEditingId(r.swapId); setSwapFormOpen(true); return }
    setEditing(r); setFormOpen(true)
  }
  const openAddSwap = () => { setSwapEditingId(null); setSwapFormOpen(true) }
  const handleSwapChanged = async () => {
    await loadOps()
    await onSwapChanged()
    await onReload(hasFilter ? buildFilters() : undefined)
  }
  const handleSave = async (input: CreateShiftChangeInput): Promise<ShiftChangeRecord> => {
    if (editing) return await onUpdate(editing.id, input)
    else return await onAdd(input)
  }

  // facilities の id→name マップ
  const facilityMap = new Map(facilities.map(f => [f.id, f.name]))
  // カレンダー反映先の表示名
  const personNameMap = new Map<string, string>([
    ...managers.map(m => [targetKey({ type: 'group_manager', id: m.id }), m.name] as const),
    ...staffMembers.map(s => [targetKey({ type: 'staff_member', id: s.id }), s.name] as const),
  ])

  return (
    <>
      <div className="fixed inset-0 z-40 flex flex-col bg-white">

        {/* ヘッダー */}
        <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between gap-2 flex-shrink-0">
          <h2 className="min-w-0 truncate whitespace-nowrap text-sm sm:text-base font-semibold">シフト変更記録</h2>
          <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setFilterOpen(p => !p)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                filterOpen || hasFilter
                  ? 'bg-white text-blue-700 border-white'
                  : 'border-blue-500 text-blue-100 hover:bg-blue-600'
              )}>
              <Filter size={14} />
              <span className="hidden sm:inline">絞り込み</span>
              {hasFilter && <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />}
              {filterOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button onClick={openAddSwap} data-testid="open-swap-form"
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg border border-white/70 text-white text-sm font-medium whitespace-nowrap hover:bg-blue-600"
              title="勤務・休日振替（振替出勤・振替休日）を登録">
              <ArrowLeftRight size={15} />
              <span>振替</span>
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-blue-700 text-sm font-medium hover:bg-blue-50">
              <Plus size={15} />
              <span className="hidden sm:inline">新規登録</span>
            </button>
            <HelpButton onClick={() => setHelpOpen(true)} variant="dark" />
            <button onClick={onClose} className="p-1.5 rounded-lg text-blue-200 hover:text-white hover:bg-blue-600">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 絞り込みパネル */}
        {filterOpen && (
          <div className="border-b bg-gray-50 px-4 py-3 space-y-3 flex-shrink-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">施設</label>
                <select value={fFacilityId} onChange={e => setFFacilityId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">すべて</option>
                  {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対象日</label>
                <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">理由</label>
                <input type="text" value={fReason} onChange={e => setFReason(e.target.value)}
                  placeholder="キーワード" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対応者</label>
                <input type="text" value={fHandledBy} onChange={e => setFHandledBy(e.target.value)}
                  placeholder="名前で検索" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">対象者名</label>
                <input type="text" value={fEmployee} onChange={e => setFEmployee(e.target.value)}
                  placeholder="名前で検索" className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">変更種別</label>
                <select value={fChangeType} onChange={e => setFChangeType(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">すべて</option>
                  {SHIFT_CHANGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  <optgroup label="勤務・休日振替">
                    {SHIFT_SWAP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">他施設応援</label>
                <div className="flex gap-3 items-center flex-wrap">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={fExternalOnly}
                      onChange={e => { setFExternalOnly(e.target.checked); if (!e.target.checked) setFSupportFacilityId('') }}
                      className="w-4 h-4 accent-blue-600" />
                    <span className="text-xs text-gray-700">他施設応援ありのみ</span>
                  </label>
                  {fExternalOnly && (
                    <select value={fSupportFacilityId} onChange={e => setFSupportFacilityId(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                      <option value="">調整元：すべて</option>
                      {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSearch}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                <Search size={14} />検索
              </button>
              {hasFilter && (
                <button onClick={handleClear}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm hover:bg-gray-50">
                  クリア
                </button>
              )}
            </div>
          </div>
        )}

        {/* 本部への通知が済んでいない勤務・休日振替（画面を閉じても・再読み込みしても、ここから確認・再送できる） */}
        {unsentOps.length > 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-2" data-testid="swap-unsent-notify">
            <p className="text-sm font-semibold text-amber-900">本部への通知（勤務・休日振替）：未完了 {unsentOps.length}件</p>
            {unsentOps.map(op => {
              const meta = NOTIFY_LABELS[op.notifyStatus]
              const stale = op.notifyStatus === 'sending' && (!op.notifyClaimedAt || Date.now() - Date.parse(op.notifyClaimedAt) > 5 * 60 * 1000)
              const canRetry = op.notifyStatus === 'pending' || op.notifyStatus === 'failed' || op.notifyStatus === 'unknown' || stale
              return (
                <div key={op.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900" data-testid="swap-unsent-item">
                  <span className={cn('px-1.5 py-0.5 rounded-md border font-medium', meta.cls)}>{meta.label}</span>
                  <span className="font-medium">{ACTION_LABELS[op.action]}</span>
                  <span>{op.personName} 振替出勤 {formatMonthDayWeek(op.workDate)}・振替休日 {formatMonthDayWeek(op.offDate)}</span>
                  {op.notifyLastError && <span className="text-amber-700">（{op.notifyLastError}）</span>}
                  {canRetry && (
                    <button onClick={() => handleRetryNotify(op)} disabled={notifyBusy === op.id} data-testid="swap-retry-notify"
                      className="px-2 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60">
                      {notifyBusy === op.id ? '送信中…' : '通知を送る'}
                    </button>
                  )}
                  {op.notifyStatus === 'needs_check' && (
                    <span className="w-full text-red-700" data-testid="swap-needs-check-note">
                      送れたかどうか分からないまま時間が経ったため、自動では送り直しません。本部管理者が受信を確認して処理します（この画面からは変更できません）。
                    </span>
                  )}
                </div>
              )
            })}
            {notifyError && <p className="text-xs text-red-700" role="alert">{notifyError}</p>}
          </div>
        )}

        {openError && (
          <p role="alert" className="mx-4 mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{openError}</p>
        )}

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <p className="text-sm">記録がありません</p>
              <button onClick={openAdd}
                className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700">
                <Plus size={14} />新規登録
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {records.map(r => {
                if (r.swapId) {
                  // 勤務・休日振替は2日分で1件。最初に出てきた日のところに1枚だけ表示する
                  if (records.find(x => x.swapId === r.swapId)?.id !== r.id) return null
                  const pair = records.filter(x => x.swapId === r.swapId)
                  const work = pair.find(x => x.swapRole === 'work')
                  const off = pair.find(x => x.swapRole === 'off')
                  const name = (work ?? off)?.details[0]?.employeeName ?? ''
                  const dayLine = (x: ShiftChangeRecord | undefined, label: string, cls: string) => x && (
                    <div className="flex items-start gap-2 text-sm flex-wrap">
                      <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium', cls)}>{label}</span>
                      <span className="text-gray-800 font-medium flex-shrink-0">{formatMonthDayWeek(x.targetDate)}</span>
                      <span className="text-gray-600 text-xs leading-relaxed">{x.details[0]?.changeDetail}</span>
                      <span className="text-gray-500 text-xs flex-shrink-0">施設：{x.facilityName || 'なし'}</span>
                    </div>
                  )
                  return (
                    <button key={`swap-${r.swapId}`} onClick={() => openEdit(r)} data-testid="swap-card"
                      className="w-full text-left px-4 py-4 hover:bg-green-50 transition-colors">
                      <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold bg-green-50 text-green-900 border border-green-600">
                          <ArrowLeftRight size={11} />勤務・休日振替
                        </span>
                        <span className="text-sm font-semibold text-gray-800">{name}</span>
                        {latestOps.get(r.swapId) && (() => {
                          const op = latestOps.get(r.swapId as string) as ShiftSwapOperation
                          const meta = NOTIFY_LABELS[op.notifyStatus]
                          return (
                            <span className={cn('px-1.5 py-0.5 rounded-md border text-xs', meta.cls)} data-testid="swap-card-notify">
                              {ACTION_LABELS[op.action]}の{meta.label}
                            </span>
                          )
                        })()}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                        <span>理由：{r.reason}</span>
                        <span>対応者：{r.handledBy}</span>
                      </div>
                      <div className="space-y-1.5">
                        {dayLine(work, '振替出勤', CHANGE_TYPE_COLORS['振替出勤'])}
                        {dayLine(off, '振替休日', CHANGE_TYPE_COLORS['振替休日'])}
                      </div>
                      {r.memo && <p className="mt-1.5 text-xs text-gray-400 line-clamp-1">メモ：{r.memo}</p>}
                    </button>
                  )
                }
                return (
                <button key={r.id} onClick={() => openEdit(r)}
                  className="w-full text-left px-4 py-4 hover:bg-blue-50 transition-colors">

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-800">{formatDateFull(r.targetDate)}</span>
                    <span className="text-sm text-gray-600">{r.facilityName}</span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
                    <span>理由：{r.reason}</span>
                    <span>対応者：{r.handledBy}</span>
                  </div>

                  {chainSteps(r.details).length > 0 && (
                    <p className="mb-1.5 inline-flex flex-wrap items-center gap-1 text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1">
                      <Link2 size={11} />応援の流れ：{chainSummary(r.details, id => facilityMap.get(id))}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {r.details.map((d, i) => {
                      const supportName = d.supportFromFacilityId ? facilityMap.get(d.supportFromFacilityId) : null
                      return (
                        <div key={d.id} className="flex items-start gap-2 text-sm flex-wrap">
                          <span className="flex-shrink-0 text-gray-400 w-4">{i + 1}.</span>
                          <span className="text-gray-700 font-medium flex-shrink-0">{d.employeeName}</span>
                          <span className={cn(
                            'flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium',
                            CHANGE_TYPE_COLORS[d.changeType] ?? 'bg-gray-100 text-gray-700'
                          )}>
                            {d.changeType}
                          </span>
                          <span className="text-gray-600 text-xs leading-relaxed">{d.changeDetail}</span>
                          {d.isExternalSupport && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                              他施設応援{supportName ? `：${supportName}` : ''}
                            </span>
                          )}
                          {d.workFacilityId && d.workFacilityId !== r.facilityId && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium bg-white text-indigo-800 border border-indigo-300">
                              勤務先：{facilityMap.get(d.workFacilityId) ?? '（不明）'}
                            </span>
                          )}
                          {d.calendarTarget && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-800 border border-indigo-300">
                              <CalendarCheck size={11} />
                              {personNameMap.get(targetKey(d.calendarTarget)) ?? '（不明）'}・{formatCalendarTime(d.startTime, d.endTime)}
                            </span>
                          )}
                          {d.replacementCalendarTarget && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-800 border border-teal-300">
                              <CalendarCheck size={11} />
                              代替出勤：{personNameMap.get(targetKey(d.replacementCalendarTarget)) ?? '（不明）'}・{formatCalendarTime(d.replacementStartTime, d.replacementEndTime)}
                            </span>
                          )}
                          {d.compensatoryLeaveStatus === 'unset' && (
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                              振休未設定
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {r.memo && (
                    <p className="mt-1.5 text-xs text-gray-400 line-clamp-1">メモ：{r.memo}</p>
                  )}
                </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2 flex-shrink-0 bg-gray-50">
          {/* 勤務・休日振替は2日分で1件と数える */}
          <p className="text-xs text-gray-500">{records.filter(r => !r.swapId).length + new Set(records.filter(r => r.swapId).map(r => r.swapId)).size}件</p>
        </div>
      </div>

      <ShiftChangeFormModal
        isOpen={formOpen}
        editing={editing}
        facilities={facilities}
        managers={managers}
        staffMembers={staffMembers}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        onSaveBatch={onAddBatch}
        onDelete={onDelete}
        onLoadRelatedGroup={onLoadRelatedGroup}
        onCreateLinkedRecord={onAdd}
        onLinkCompensatoryLeave={onLinkCompensatoryLeave}
      />

      <ShiftSwapFormModal
        isOpen={swapFormOpen}
        swapId={swapEditingId}
        facilities={facilities}
        managers={managers}
        staffMembers={staffMembers}
        events={events}
        onClose={() => setSwapFormOpen(false)}
        onChanged={handleSwapChanged}
      />

      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        content={HELP_CONTENT.shiftChange}
      />
    </>
  )
}
