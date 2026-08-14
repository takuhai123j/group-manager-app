'use client'

import { useState, useEffect } from 'react'
import { X, Save, Trash2, Plus, Minus, CheckSquare, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHIFT_CHANGE_TYPES } from '@/lib/types'
import type {
  ShiftChangeRecord, CreateShiftChangeInput, Facility, ShiftChangeType,
  CompensatoryLeaveStatus,
} from '@/lib/types'

interface Props {
  isOpen: boolean
  editing: ShiftChangeRecord | null
  facilities: Facility[]
  onClose: () => void
  onSave: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onDelete?: (id: string) => Promise<void>
  onLoadRelatedGroup: (groupId: string) => Promise<ShiftChangeRecord[]>
  onCreateLinkedRecord: (input: CreateShiftChangeInput) => Promise<ShiftChangeRecord>
  onLinkCompensatoryLeave: (detailId: string) => Promise<void>
}

const MAX_TARGETS = 5

type DateMode = 'single' | 'range' | 'multi'

type DetailDraft = {
  employeeName: string
  changeType: ShiftChangeType
  changeDetail: string
  isExternalSupport: boolean
  supportFromFacilityId: string
  // 単日編集フォームでは変更UIを出さないが、複数日入力で設定された値を編集保存時に消さないよう保持する非表示フィールド
  originalShift: string | null
  replacementName: string | null
  replacementOriginalShift: string | null
  compensatoryLeaveStatus: CompensatoryLeaveStatus | null
}

type CompensatoryLeaveTiming = 'now' | 'later'

type DayPersonDraft = {
  changeType: ShiftChangeType
  originalShift: string
  replacementName: string
  replacementOriginalShift: string
  isExternalSupport: boolean
  supportFromFacilityId: string
  // 振休
  wantsCompensatoryLeave: boolean
  compensatoryLeaveTiming: CompensatoryLeaveTiming
  compensatoryLeaveDate: string
  compensatoryLeaveDetail: string
  compensatoryLeaveReplacementName: string
}

type DayDraft = {
  date: string
  persons: DayPersonDraft[]
}

const EMPTY_DETAIL: DetailDraft = {
  employeeName: '',
  changeType: '欠勤',
  changeDetail: '',
  isExternalSupport: false,
  supportFromFacilityId: '',
  originalShift: null,
  replacementName: null,
  replacementOriginalShift: null,
  compensatoryLeaveStatus: null,
}

const EMPTY_PERSON_DRAFT_FIELDS: DayPersonDraft = {
  changeType: '欠勤',
  originalShift: '',
  replacementName: '',
  replacementOriginalShift: '',
  isExternalSupport: false,
  supportFromFacilityId: '',
  wantsCompensatoryLeave: false,
  compensatoryLeaveTiming: 'later',
  compensatoryLeaveDate: '',
  compensatoryLeaveDetail: '',
  compensatoryLeaveReplacementName: '',
}

const EMPTY_FORM = { facilityId: '', targetDate: '', reason: '', handledBy: '', memo: '' }

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function getDatesInRange(start: string, end: string): string[] {
  if (!start || !end || end < start) return []
  const dates: string[] = []
  let cur = start
  while (cur <= end) {
    dates.push(cur)
    cur = addOneDay(cur)
  }
  return dates
}

function formatDateJP(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  const weeks = ['日', '月', '火', '水', '木', '金', '土']
  return `${m}/${d}（${weeks[day]}）`
}

function formatDateSlash(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${y}/${m}/${d}`
}

function buildChangeDetail(d: DayPersonDraft): string {
  const parts: string[] = []
  if (d.originalShift) parts.push(`元シフト：${d.originalShift}`)
  if (d.replacementName) {
    let rep = `→ ${d.replacementName}`
    if (d.replacementOriginalShift) rep += `（元：${d.replacementOriginalShift}）`
    parts.push(rep)
  }
  return parts.join(' ') || '（未入力）'
}

const MODE_LABELS: Record<DateMode, string> = {
  single: '単日',
  range: '期間',
  multi: '複数日選択',
}

export function ShiftChangeFormModal({
  isOpen, editing, facilities, onClose, onSave, onDelete,
  onLoadRelatedGroup, onCreateLinkedRecord, onLinkCompensatoryLeave,
}: Props) {
  // ── 単日モード ──
  const [form, setForm] = useState(EMPTY_FORM)
  const [details, setDetails] = useState<DetailDraft[]>([{ ...EMPTY_DETAIL }])

  // ── モード ──
  const [dateMode, setDateMode] = useState<DateMode>('single')

  // ── 期間モード ──
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // ── 複数日選択モード ──
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [newDateInput, setNewDateInput] = useState('')

  // ── 期間・複数日共通 ──
  const [periodForm, setPeriodForm] = useState({ facilityId: '', handledBy: '', reason: '', memo: '' })
  const [periodEmployeeNames, setPeriodEmployeeNames] = useState<string[]>([''])
  const [dayDrafts, setDayDrafts] = useState<DayDraft[]>([])

  // 一括入力
  const [bulk, setBulk] = useState({
    changeType: '欠勤' as ShiftChangeType,
    originalShift: '',
    replacementName: '',
    replacementOriginalShift: '',
    isExternalSupport: false,
    supportFromFacilityId: '',
  })

  // ── 確認ダイアログ ──
  const [showConfirm, setShowConfirm] = useState(false)
  const [pendingInputs, setPendingInputs] = useState<CreateShiftChangeInput[]>([])

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailWarning, setEmailWarning] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)

  // ── 関連する振休グループ ──
  const [relatedRecords, setRelatedRecords] = useState<ShiftChangeRecord[]>([])
  const [loadingRelated, setLoadingRelated] = useState(false)

  // ── 振休日を後から設定するサブフォーム ──
  const [linkingDetailId, setLinkingDetailId] = useState<string | null>(null)
  const [linkForm, setLinkForm] = useState({ date: '', changeDetail: '振休', replacementName: '' })
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [locallyLinkedIds, setLocallyLinkedIds] = useState<Set<string>>(new Set())

  const activeFacilities = facilities.filter(f => f.active)

  // リセット
  useEffect(() => {
    if (!isOpen) return
    setError(null); setEmailSuccess(null); setEmailWarning(null)
    setShowConfirm(false); setPendingInputs([])
    setRelatedRecords([]); setLinkingDetailId(null); setLinkError(null)
    setLocallyLinkedIds(new Set())

    if (editing) {
      setDateMode('single')
      setForm({
        facilityId: editing.facilityId,
        targetDate: editing.targetDate,
        reason: editing.reason,
        handledBy: editing.handledBy,
        memo: editing.memo,
      })
      setDetails(
        editing.details.length > 0
          ? editing.details.map(d => ({
              employeeName: d.employeeName,
              changeType: (SHIFT_CHANGE_TYPES as readonly string[]).includes(d.changeType)
                ? d.changeType as ShiftChangeType : 'その他',
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityId: d.supportFromFacilityId ?? '',
              // 複数日入力で設定された値は編集UIで表示・変更しないが、保存時に消えないよう保持する
              originalShift: d.originalShift,
              replacementName: d.replacementName,
              replacementOriginalShift: d.replacementOriginalShift,
              compensatoryLeaveStatus: d.compensatoryLeaveStatus,
            }))
          : [{ ...EMPTY_DETAIL }]
      )
    } else {
      const today = new Date().toISOString().slice(0, 10)
      setDateMode('single')
      setForm({ ...EMPTY_FORM, targetDate: today })
      setDetails([{ ...EMPTY_DETAIL }])
      setStartDate(today)
      setEndDate(today)
      setSelectedDates([])
      setNewDateInput(today)
      setPeriodForm({ facilityId: '', handledBy: '', reason: '', memo: '' })
      setPeriodEmployeeNames([''])
      setDayDrafts([])
      setBulk({ changeType: '欠勤', originalShift: '', replacementName: '', replacementOriginalShift: '', isExternalSupport: false, supportFromFacilityId: '' })
    }
  }, [isOpen, editing])

  // 関連する振休グループの取得（編集対象がグループに属する場合）
  useEffect(() => {
    if (!isOpen || !editing?.relatedChangeGroupId) { setRelatedRecords([]); return }
    const groupId = editing.relatedChangeGroupId
    setLoadingRelated(true)
    onLoadRelatedGroup(groupId)
      .then(recs => setRelatedRecords(recs.filter(r => r.id !== editing.id)))
      .catch(() => setRelatedRecords([]))
      .finally(() => setLoadingRelated(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing?.id, editing?.relatedChangeGroupId])

  // 期間モード → dayDrafts
  useEffect(() => {
    if (dateMode !== 'range') return
    const dates = getDatesInRange(startDate, endDate)
    setDayDrafts(prev => {
      const prevMap = new Map(prev.map(d => [d.date, d]))
      return dates.map(date => {
        const existing = prevMap.get(date)
        const persons = periodEmployeeNames.map((_, i) => existing?.persons[i] ?? { ...EMPTY_PERSON_DRAFT_FIELDS })
        return { date, persons }
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, dateMode, periodEmployeeNames.length])

  // 複数日選択モード → dayDrafts
  useEffect(() => {
    if (dateMode !== 'multi') return
    const sorted = [...selectedDates].sort()
    setDayDrafts(prev => {
      const prevMap = new Map(prev.map(d => [d.date, d]))
      return sorted.map(date => {
        const existing = prevMap.get(date)
        const persons = periodEmployeeNames.map((_, i) => existing?.persons[i] ?? { ...EMPTY_PERSON_DRAFT_FIELDS })
        return { date, persons }
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDates, dateMode, periodEmployeeNames.length])

  if (!isOpen) return null

  const setField = <K extends keyof typeof EMPTY_FORM>(key: K, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const setPeriodField = <K extends keyof typeof periodForm>(key: K, val: string) =>
    setPeriodForm(prev => ({ ...prev, [key]: val }))

  const updateDetail = (i: number, patch: Partial<DetailDraft>) =>
    setDetails(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  const updateDayPerson = (dayIdx: number, personIdx: number, patch: Partial<DayPersonDraft>) =>
    setDayDrafts(prev => prev.map((d, di) => di !== dayIdx ? d : {
      ...d,
      persons: d.persons.map((p, pi) => pi === personIdx ? { ...p, ...patch } : p),
    }))

  const addPersonName = () => {
    if (periodEmployeeNames.length >= MAX_TARGETS) return
    setPeriodEmployeeNames(prev => [...prev, ''])
  }
  const removePersonName = (i: number) =>
    setPeriodEmployeeNames(prev => prev.filter((_, idx) => idx !== i))
  const updatePersonName = (i: number, val: string) =>
    setPeriodEmployeeNames(prev => prev.map((n, idx) => idx === i ? val : n))

  const applyBulk = () => {
    setDayDrafts(prev => prev.map(d => ({
      ...d,
      persons: d.persons.map(existing => ({
        ...existing,
        changeType: bulk.changeType,
        originalShift: bulk.originalShift,
        replacementName: bulk.replacementName,
        replacementOriginalShift: bulk.replacementOriginalShift,
        isExternalSupport: bulk.isExternalSupport,
        supportFromFacilityId: bulk.isExternalSupport ? bulk.supportFromFacilityId : '',
      })),
    })))
  }

  const addSelectedDate = () => {
    if (!newDateInput || selectedDates.includes(newDateInput)) return
    setSelectedDates(prev => [...prev, newDateInput].sort())
  }

  const removeSelectedDate = (date: string) => setSelectedDates(prev => prev.filter(d => d !== date))

  const datesCount = dayDrafts.length
  const facilityName = activeFacilities.find(f => f.id === periodForm.facilityId)?.name ?? ''
  const isMultiDay = !editing && (dateMode === 'range' || dateMode === 'multi')

  // ── 単日保存 ──
  const handleSaveSingle = async () => {
    if (!form.facilityId)       { setError('施設を選択してください'); return }
    if (!form.targetDate)       { setError('対象日を入力してください'); return }
    if (!form.handledBy.trim()) { setError('入力者を入力してください'); return }
    if (!form.reason.trim())    { setError('理由を入力してください'); return }
    for (let i = 0; i < details.length; i++) {
      if (!details[i].employeeName.trim()) { setError(`対象者${i + 1}の名前を入力してください`); return }
      if (!details[i].changeDetail.trim()) { setError(`対象者${i + 1}の変更内容を入力してください`); return }
      if (details[i].isExternalSupport && !details[i].supportFromFacilityId) {
        setError(`対象者${i + 1}の調整元施設を選択してください`); return
      }
    }
    setSaving(true); setError(null); setEmailWarning(null); setEmailSuccess(null)
    try {
      const saved = await onSave({
        facilityId: form.facilityId,
        targetDate: form.targetDate,
        reason: form.reason,
        handledBy: form.handledBy,
        memo: form.memo,
        details: details.map(d => ({
          employeeName: d.employeeName,
          changeType: d.changeType,
          changeDetail: d.changeDetail,
          isExternalSupport: d.isExternalSupport,
          supportFromFacilityId: d.isExternalSupport ? d.supportFromFacilityId || null : null,
          // 複数日入力由来の値は編集UIにないため、既存値をそのまま引き継ぐ
          originalShift: d.originalShift,
          replacementName: d.replacementName,
          replacementOriginalShift: d.replacementOriginalShift,
          compensatoryLeaveStatus: d.compensatoryLeaveStatus,
        })),
        relatedChangeGroupId: editing?.relatedChangeGroupId ?? null,
      })
      if (!editing) {
        try {
          const payload = {
            facilityName: saved.facilityName,
            targetDate: saved.targetDate,
            reason: saved.reason,
            handledBy: saved.handledBy,
            memo: saved.memo,
            details: saved.details.map(d => ({
              employeeName: d.employeeName,
              changeType: d.changeType,
              changeDetail: d.changeDetail,
              isExternalSupport: d.isExternalSupport,
              supportFromFacilityName: d.supportFromFacilityId
                ? facilities.find(f => f.id === d.supportFromFacilityId)?.name : undefined,
            })),
          }
          const res = await fetch('/api/shift-change-notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) { setEmailWarning('記録は保存しましたが、メール通知に失敗しました'); return }
          setEmailSuccess('記録を保存し、通知メールを送信しました'); return
        } catch {
          setEmailWarning('記録は保存しましたが、メール通知に失敗しました'); return
        }
      }
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  // ── 複数日（期間 or 複数日選択）→ 確認へ ──
  const handleSaveMultiDay = () => {
    if (!periodForm.facilityId)       { setError('施設を選択してください'); return }
    if (dateMode === 'range') {
      if (!startDate)               { setError('開始日を入力してください'); return }
      if (!endDate)                 { setError('終了日を入力してください'); return }
      if (endDate < startDate)      { setError('終了日は開始日以降を指定してください'); return }
      if (datesCount > 31)          { setError('期間は31日以内に設定してください'); return }
    }
    if (dateMode === 'multi' && selectedDates.length === 0) {
      setError('対象日を1日以上選択してください'); return
    }
    if (datesCount === 0)             { setError('対象日を設定してください'); return }
    if (!periodForm.handledBy.trim()) { setError('入力者を入力してください'); return }
    if (!periodForm.reason.trim())    { setError('理由を入力してください'); return }
    for (let i = 0; i < periodEmployeeNames.length; i++) {
      if (!periodEmployeeNames[i].trim()) { setError(`対象者${i + 1}の名前を入力してください`); return }
    }
    for (const d of dayDrafts) {
      for (const p of d.persons) {
        if (p.replacementName.trim() && p.wantsCompensatoryLeave && p.compensatoryLeaveTiming === 'now' && !p.compensatoryLeaveDate) {
          setError(`${formatDateJP(d.date)}の振休日を入力してください`); return
        }
      }
    }

    const trimmedNames = periodEmployeeNames.map(n => n.trim())

    // 振休を設定する対象者がいる日には、代替出勤日と振休日を紐付けるグループIDを発行する
    const dayGroupIds = new Map<number, string>()
    const inputs: CreateShiftChangeInput[] = dayDrafts.map((d, dayIdx) => {
      const detailInputs = d.persons.map((p, idx) => {
        const wantsLeave = p.replacementName.trim() !== '' && p.wantsCompensatoryLeave
        if (wantsLeave && !dayGroupIds.has(dayIdx)) dayGroupIds.set(dayIdx, crypto.randomUUID())
        return {
          employeeName: trimmedNames[idx],
          changeType: p.changeType,
          changeDetail: buildChangeDetail(p),
          isExternalSupport: p.isExternalSupport,
          supportFromFacilityId: p.isExternalSupport ? p.supportFromFacilityId || null : null,
          originalShift: p.originalShift || null,
          replacementName: p.replacementName || null,
          replacementOriginalShift: p.replacementOriginalShift || null,
          compensatoryLeaveStatus: wantsLeave
            ? (p.compensatoryLeaveTiming === 'now' ? 'linked' as const : 'unset' as const)
            : null,
        }
      })
      return {
        facilityId: periodForm.facilityId,
        targetDate: d.date,
        reason: periodForm.reason,
        handledBy: periodForm.handledBy,
        memo: periodForm.memo,
        details: detailInputs,
        relatedChangeGroupId: dayGroupIds.get(dayIdx) ?? null,
      }
    })

    // 振休日を同時に設定した分の追加レコードを生成
    const compensatoryInputs: CreateShiftChangeInput[] = []
    dayDrafts.forEach((d, dayIdx) => {
      d.persons.forEach(p => {
        if (!p.replacementName.trim() || !p.wantsCompensatoryLeave) return
        if (p.compensatoryLeaveTiming !== 'now' || !p.compensatoryLeaveDate) return
        const leaveDetails: CreateShiftChangeInput['details'] = [{
          employeeName: p.replacementName.trim(),
          changeType: '振休',
          changeDetail: p.compensatoryLeaveDetail.trim() || '振休',
          isExternalSupport: false,
          supportFromFacilityId: null,
        }]
        if (p.compensatoryLeaveReplacementName.trim()) {
          leaveDetails.push({
            employeeName: p.compensatoryLeaveReplacementName.trim(),
            changeType: '交代出勤',
            changeDetail: `${p.replacementName.trim()}の振休対応で代替出勤`,
            isExternalSupport: false,
            supportFromFacilityId: null,
          })
        }
        compensatoryInputs.push({
          facilityId: periodForm.facilityId,
          targetDate: p.compensatoryLeaveDate,
          reason: periodForm.reason,
          handledBy: periodForm.handledBy,
          memo: periodForm.memo,
          details: leaveDetails,
          relatedChangeGroupId: dayGroupIds.get(dayIdx) ?? null,
        })
      })
    })

    setPendingInputs([...inputs, ...compensatoryInputs])
    setError(null)
    setShowConfirm(true)
  }

  // ── 確定保存 ──
  const handleConfirmSave = async () => {
    setShowConfirm(false)
    setSaving(true); setError(null); setEmailWarning(null); setEmailSuccess(null)
    try {
      const savedList: ShiftChangeRecord[] = []
      for (const input of pendingInputs) {
        const saved = await onSave(input)
        savedList.push(saved)
      }
      try {
        const facilityMap = new Map(facilities.map(f => [f.id, f.name]))
        const dayDetails = savedList.map(saved => ({
          date: saved.targetDate,
          persons: saved.details.map(det => ({
            employeeName: det.employeeName,
            changeType: det.changeType,
            originalShift: det.originalShift ?? undefined,
            replacementName: det.replacementName ?? undefined,
            replacementOriginalShift: det.replacementOriginalShift ?? undefined,
            isExternalSupport: det.isExternalSupport,
            supportFromFacilityName: det.supportFromFacilityId
              ? facilityMap.get(det.supportFromFacilityId) : undefined,
          })),
        }))

        const base = {
          facilityName: savedList[0].facilityName,
          reason: periodForm.reason,
          handledBy: periodForm.handledBy,
          memo: periodForm.memo,
          dayDetails,
        }
        const payload = dateMode === 'range'
          ? { ...base, isPeriod: true, startDate, endDate, count: savedList.length }
          : { ...base, isMulti: true, targetDates: [...selectedDates].sort(), count: savedList.length }

        const res = await fetch('/api/shift-change-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          setEmailWarning(`${savedList.length}件の記録は保存しましたが、メール通知に失敗しました`); return
        }
        setEmailSuccess(`${savedList.length}件の記録を保存し、通知メールを送信しました`); return
      } catch {
        setEmailWarning(`${savedList.length}件の記録は保存しましたが、メール通知に失敗しました`); return
      }
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = () => {
    if (dateMode === 'single' || editing) handleSaveSingle()
    else handleSaveMultiDay()
  }

  // ── 振休日を後から設定 ──
  const handleLinkCompensatoryLeave = async () => {
    if (!editing || !linkingDetailId) return
    const targetDetail = editing.details.find(d => d.id === linkingDetailId)
    if (!targetDetail) return
    if (!linkForm.date) { setLinkError('振休日を入力してください'); return }

    setLinking(true); setLinkError(null)
    try {
      // 代替出勤日の登録時に発行済みのグループIDを引き継ぐ（通常は必ず存在する）
      const groupId = editing.relatedChangeGroupId ?? crypto.randomUUID()

      const leaveDetails: CreateShiftChangeInput['details'] = [{
        employeeName: targetDetail.employeeName,
        changeType: '振休',
        changeDetail: linkForm.changeDetail.trim() || '振休',
        isExternalSupport: false,
        supportFromFacilityId: null,
      }]
      if (linkForm.replacementName.trim()) {
        leaveDetails.push({
          employeeName: linkForm.replacementName.trim(),
          changeType: '交代出勤',
          changeDetail: `${targetDetail.employeeName}の振休対応で代替出勤`,
          isExternalSupport: false,
          supportFromFacilityId: null,
        })
      }

      const saved = await onCreateLinkedRecord({
        facilityId: editing.facilityId,
        targetDate: linkForm.date,
        reason: editing.reason,
        handledBy: editing.handledBy,
        memo: '',
        details: leaveDetails,
        relatedChangeGroupId: groupId,
      })
      await onLinkCompensatoryLeave(linkingDetailId)
      setLocallyLinkedIds(prev => new Set(prev).add(linkingDetailId))
      setRelatedRecords(prev => [...prev, saved])
      setLinkingDetailId(null)

      // 通知メール送信（失敗しても記録の保存には影響しない）
      try {
        await fetch('/api/shift-change-notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isCompensatoryLeaveUpdate: true,
            facilityName: saved.facilityName,
            originalDate: editing.targetDate,
            compensatoryDate: saved.targetDate,
            employeeName: targetDetail.employeeName,
            replacementName: linkForm.replacementName.trim() || undefined,
            reason: editing.reason,
            handledBy: editing.handledBy,
          }),
        })
      } catch {
        // 通知失敗はここでは無視する（記録自体は保存済みのため）
      }
    } catch {
      setLinkError('振休日の設定に失敗しました')
    } finally {
      setLinking(false)
    }
  }

  const handleDelete = async () => {
    if (!editing || !onDelete) return
    if (!confirm('この記録を削除しますか？')) return
    setDeleting(true)
    try { await onDelete(editing.id); onClose() }
    catch { setError('削除に失敗しました') }
    finally { setDeleting(false) }
  }

  const saveLabel = saving ? '保存中…'
    : isMultiDay ? `確認（${datesCount}件）`
    : '保存'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="relative bg-white w-full sm:max-w-xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col">

        {/* ── 確認ダイアログ ── */}
        {showConfirm && (
          <div className="absolute inset-0 z-10 bg-white sm:rounded-2xl rounded-t-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-800">登録内容の確認</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                以下の内容で<span className="font-semibold text-blue-700">{pendingInputs.length}件</span>登録します。
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 space-y-1.5">
                {dateMode === 'range' ? (
                  <div><span className="font-medium text-gray-500">期間：</span>{formatDateSlash(startDate)} ～ {formatDateSlash(endDate)}</div>
                ) : (
                  <div>
                    <span className="font-medium text-gray-500">対象日：</span>
                    <span>{pendingInputs.map(i => formatDateSlash(i.targetDate)).join('、')}</span>
                  </div>
                )}
                <div><span className="font-medium text-gray-500">登録件数：</span>{pendingInputs.length}件</div>
                <div><span className="font-medium text-gray-500">施設：</span>{facilityName}</div>
                <div><span className="font-medium text-gray-500">入力者：</span>{periodForm.handledBy}</div>
                <div><span className="font-medium text-gray-500">理由：</span>{periodForm.reason}</div>
                {periodForm.memo && <div><span className="font-medium text-gray-500">メモ：</span>{periodForm.memo}</div>}
              </div>
              <div className="space-y-1.5">
                {pendingInputs.map((inp, inpIdx) => (
                  <div key={`${inp.targetDate}-${inpIdx}`} className="px-3 py-2 bg-blue-50 rounded-lg text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-blue-800 w-20 flex-shrink-0">{formatDateJP(inp.targetDate)}</span>
                      <span className="text-blue-600 text-xs">{inp.details.length}名</span>
                      {inp.details.some(d => d.changeType === '振休') && (
                        <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">振休</span>
                      )}
                    </div>
                    {inp.details.map((det, i) => (
                      <div key={i} className="flex items-center gap-2 pl-1 flex-wrap">
                        <span className="text-blue-700 text-xs flex-shrink-0">{det.employeeName}</span>
                        <span className="text-blue-700 text-xs flex-shrink-0">{det.changeType}</span>
                        <span className="text-blue-600 text-xs truncate">{det.changeDetail}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowConfirm(false)} disabled={saving}
                className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                キャンセル
              </button>
              <button onClick={handleConfirmSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />{saving ? '保存中…' : '登録する'}
              </button>
            </div>
          </div>
        )}

        {/* ── ヘッダー ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {editing ? 'シフト変更記録を編集' : 'シフト変更を記録'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* ── ボディ ── */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4">

          {/* モード切替 */}
          {!editing && (
            <div className="flex gap-5">
              {(['single', 'range', 'multi'] as DateMode[]).map(mode => (
                <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="radio" name="dateMode" checked={dateMode === mode}
                    onChange={() => { setDateMode(mode); setError(null) }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm font-medium text-gray-700">{MODE_LABELS[mode]}</span>
                </label>
              ))}
            </div>
          )}

          {/* ════════ 単日モード ════════ */}
          {(editing || dateMode === 'single') && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">施設 <span className="text-red-500">*</span></label>
                <select value={form.facilityId} onChange={e => setField('facilityId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">選択してください</option>
                  {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">対象日 <span className="text-red-500">*</span></label>
                  <input type="date" value={form.targetDate} onChange={e => setField('targetDate', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">入力者 <span className="text-red-500">*</span></label>
                  <input type="text" value={form.handledBy} onChange={e => setField('handledBy', e.target.value)}
                    placeholder="例：福田"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">理由 <span className="text-red-500">*</span></label>
                <input type="text" value={form.reason} onChange={e => setField('reason', e.target.value)}
                  placeholder="例：体調不良、電車遅延"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メモ <span className="text-gray-400 font-normal">（任意）</span></label>
                <textarea value={form.memo} onChange={e => setField('memo', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-gray-600 mb-3">対象者明細（最大{MAX_TARGETS}名）</p>
                {details.map((d, i) => (
                  <div key={i} className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs font-semibold text-gray-500">{i + 1}人目</span>
                      {details.length > 1 && (
                        <button type="button" onClick={() => setDetails(prev => prev.filter((_, idx) => idx !== i))}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-red-500 hover:bg-red-50 border border-red-200">
                          <Minus size={11} />削除
                        </button>
                      )}
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1">対象者 <span className="text-red-500">*</span></label>
                      <input type="text" value={d.employeeName}
                        onChange={e => updateDetail(i, { employeeName: e.target.value })}
                        placeholder="例：山田パート"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">変更種別 <span className="text-red-500">*</span></label>
                      <div className="flex flex-wrap gap-1.5">
                        {SHIFT_CHANGE_TYPES.map(t => (
                          <button key={t} type="button" onClick={() => updateDetail(i, { changeType: t })}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                              d.changeType === t
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                            )}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1">変更内容 <span className="text-red-500">*</span></label>
                      <textarea value={d.changeDetail}
                        onChange={e => updateDetail(i, { changeDetail: e.target.value })}
                        rows={2} placeholder="例：9:00-13:00 → 14:00-19:00"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                    </div>
                    <div className="pt-2 border-t border-gray-200">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={d.isExternalSupport}
                          onChange={e => updateDetail(i, {
                            isExternalSupport: e.target.checked,
                            supportFromFacilityId: e.target.checked ? d.supportFromFacilityId : '',
                          })}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className="text-xs font-medium text-gray-700">他施設からの調整</span>
                      </label>
                      {d.isExternalSupport && (
                        <div className="mt-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">調整元施設 <span className="text-red-500">*</span></label>
                          <select value={d.supportFromFacilityId}
                            onChange={e => updateDetail(i, { supportFromFacilityId: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">選択してください</option>
                            {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {details.length < MAX_TARGETS && (
                  <button type="button" onClick={() => setDetails(prev => [...prev, { ...EMPTY_DETAIL }])}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus size={14} />対象者を追加（{details.length}/{MAX_TARGETS}名）
                  </button>
                )}
              </div>

              {/* ── 関連する振休 ── */}
              {editing && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                    <Link2 size={13} />関連する振休
                  </p>
                  {loadingRelated ? (
                    <p className="text-xs text-gray-400">読み込み中…</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                        <p className="font-semibold text-gray-700 mb-1.5">{formatDateJP(editing.targetDate)}（この記録）</p>
                        {editing.details.map(d => {
                          const isUnset = d.compensatoryLeaveStatus === 'unset' && !locallyLinkedIds.has(d.id)
                          return (
                            <div key={d.id} className="flex items-center gap-2 flex-wrap text-xs text-gray-600 mb-1">
                              <span>{d.employeeName}　{d.changeType}</span>
                              {isUnset && (
                                <>
                                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">振休未設定</span>
                                  <button type="button"
                                    onClick={() => {
                                      setLinkingDetailId(d.id)
                                      setLinkForm({ date: '', changeDetail: '振休', replacementName: '' })
                                      setLinkError(null)
                                    }}
                                    className="text-purple-600 underline hover:text-purple-800">
                                    振休日を設定
                                  </button>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {relatedRecords.length > 0 && (
                        <>
                          <p className="text-center text-xs text-purple-600">↓ 振休</p>
                          {relatedRecords.map(r => (
                            <div key={r.id} className="px-3 py-2 bg-purple-50 rounded-lg border border-purple-200 text-sm">
                              <p className="font-semibold text-purple-800 mb-1.5">{formatDateJP(r.targetDate)}</p>
                              {r.details.map(d => (
                                <p key={d.id} className="text-xs text-purple-700">{d.employeeName}　{d.changeType}</p>
                              ))}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {linkingDetailId && (
                    <div className="mt-3 p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
                      <p className="text-xs font-semibold text-purple-800">振休日を設定</p>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日 <span className="text-red-500">*</span></label>
                        <input type="date" value={linkForm.date}
                          onChange={e => setLinkForm(f => ({ ...f, date: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更内容</label>
                        <input type="text" value={linkForm.changeDetail}
                          onChange={e => setLinkForm(f => ({ ...f, changeDetail: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          振休日の代替出勤者 <span className="text-gray-400 font-normal">（任意）</span>
                        </label>
                        <input type="text" value={linkForm.replacementName}
                          onChange={e => setLinkForm(f => ({ ...f, replacementName: e.target.value }))}
                          placeholder="例：鈴木パート"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                      </div>
                      {linkError && <p className="text-xs text-red-600">{linkError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => setLinkingDetailId(null)} disabled={linking}
                          className="px-3 py-1.5 rounded-lg text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                          キャンセル
                        </button>
                        <button type="button" onClick={handleLinkCompensatoryLeave} disabled={linking}
                          className="px-3 py-1.5 rounded-lg text-xs bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60">
                          {linking ? '設定中…' : '設定する'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════════ 期間 / 複数日選択 ════════ */}
          {isMultiDay && (
            <>
              {/* 期間：開始日・終了日 */}
              {dateMode === 'range' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">期間 <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-2">
                    <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <span className="text-sm text-gray-500 flex-shrink-0">～</span>
                    <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {datesCount > 0 && datesCount <= 31 && <p className="mt-1 text-xs text-blue-600">{datesCount}日間</p>}
                  {datesCount > 31 && <p className="mt-1 text-xs text-red-500">期間が長すぎます（最大31日）</p>}
                </div>
              )}

              {/* 複数日選択：日付追加 */}
              {dateMode === 'multi' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">対象日 <span className="text-red-500">*</span></label>
                  <div className="flex gap-2 mb-2">
                    <input type="date" value={newDateInput} onChange={e => setNewDateInput(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={addSelectedDate}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 flex-shrink-0">
                      <Plus size={14} />追加
                    </button>
                  </div>
                  {selectedDates.length === 0 ? (
                    <p className="text-xs text-gray-400">日付を追加してください</p>
                  ) : (
                    <div>
                      <p className="text-xs text-blue-600 mb-1.5">{selectedDates.length}日選択済み</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedDates.map(date => (
                          <span key={date} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                            {formatDateJP(date)}
                            <button type="button" onClick={() => removeSelectedDate(date)}
                              className="text-blue-500 hover:text-blue-800 ml-0.5">
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 共通：施設 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">施設 <span className="text-red-500">*</span></label>
                <select value={periodForm.facilityId} onChange={e => setPeriodField('facilityId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">選択してください</option>
                  {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>

              {/* 共通：入力者 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">入力者 <span className="text-red-500">*</span></label>
                <input type="text" value={periodForm.handledBy} onChange={e => setPeriodField('handledBy', e.target.value)}
                  placeholder="例：福田"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* 共通：対象者（最大MAX_TARGETS名） */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">対象者（最大{MAX_TARGETS}名） <span className="text-red-500">*</span></label>
                <div className="space-y-2">
                  {periodEmployeeNames.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" value={name}
                        onChange={e => updatePersonName(i, e.target.value)}
                        placeholder="例：山田パート"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {periodEmployeeNames.length > 1 && (
                        <button type="button" onClick={() => removePersonName(i)}
                          className="flex-shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50 border border-red-200">
                          <Minus size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {periodEmployeeNames.length < MAX_TARGETS && (
                  <button type="button" onClick={addPersonName}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus size={12} />対象者を追加（{periodEmployeeNames.length}/{MAX_TARGETS}名）
                  </button>
                )}
              </div>

              {/* 共通：理由 */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">理由 <span className="text-red-500">*</span></label>
                <input type="text" value={periodForm.reason} onChange={e => setPeriodField('reason', e.target.value)}
                  placeholder="例：体調不良、有休、研修"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* 共通：メモ */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メモ <span className="text-gray-400 font-normal">（任意）</span></label>
                <textarea value={periodForm.memo} onChange={e => setPeriodField('memo', e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* 日別入力 */}
              {datesCount > 0 && (dateMode === 'multi' || datesCount <= 31) && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-3">日別入力</p>

                  {/* 一括入力 */}
                  <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                    <p className="text-xs font-semibold text-blue-700 mb-2.5">一括入力（全員・全日に適用）</p>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {SHIFT_CHANGE_TYPES.map(t => (
                        <button key={t} type="button" onClick={() => setBulk(p => ({ ...p, changeType: t }))}
                          className={cn(
                            'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                            bulk.changeType === t
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                          )}>{t}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更元シフト</label>
                        <input type="text" value={bulk.originalShift}
                          onChange={e => setBulk(p => ({ ...p, originalShift: e.target.value }))}
                          placeholder="例：09:00～18:00"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当</label>
                        <input type="text" value={bulk.replacementName}
                          onChange={e => setBulk(p => ({ ...p, replacementName: e.target.value }))}
                          placeholder="例：田中パート"
                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                    <div className="mb-2.5">
                      <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当の元シフト</label>
                      <input type="text" value={bulk.replacementOriginalShift}
                        onChange={e => setBulk(p => ({ ...p, replacementOriginalShift: e.target.value }))}
                        placeholder="例：休み、09:00～13:00、未定"
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="mb-2.5 pt-2 border-t border-blue-200">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={bulk.isExternalSupport}
                          onChange={e => setBulk(p => ({ ...p, isExternalSupport: e.target.checked, supportFromFacilityId: e.target.checked ? p.supportFromFacilityId : '' }))}
                          className="w-4 h-4 rounded accent-blue-600" />
                        <span className="text-xs font-medium text-gray-700">他施設からの応援</span>
                      </label>
                      {bulk.isExternalSupport && (
                        <select value={bulk.supportFromFacilityId}
                          onChange={e => setBulk(p => ({ ...p, supportFromFacilityId: e.target.value }))}
                          className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="">応援元施設を選択</option>
                          {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      )}
                    </div>
                    <button type="button" onClick={applyBulk}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors">
                      <CheckSquare size={14} />全日に適用
                    </button>
                  </div>

                  {/* 日別 */}
                  {dayDrafts.map((d, dayIdx) => (
                    <div key={d.date} className="mb-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-xs font-semibold text-gray-700 mb-2">{formatDateJP(d.date)}</p>

                      {d.persons.map((p, personIdx) => (
                        <div key={personIdx} className={cn(personIdx > 0 && 'mt-3 pt-3 border-t border-gray-200')}>
                          <p className="text-xs font-semibold text-gray-500 mb-2">
                            {periodEmployeeNames[personIdx]?.trim() || `対象者${personIdx + 1}`}
                          </p>

                          {/* 変更種別 */}
                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                            {SHIFT_CHANGE_TYPES.map(t => (
                              <button key={t} type="button" onClick={() => updateDayPerson(dayIdx, personIdx, { changeType: t })}
                                className={cn(
                                  'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                                  p.changeType === t
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                                )}>{t}</button>
                            ))}
                          </div>

                          {/* 変更元シフト・変更後担当 */}
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">変更元シフト</label>
                              <input type="text" value={p.originalShift}
                                onChange={e => updateDayPerson(dayIdx, personIdx, { originalShift: e.target.value })}
                                placeholder="例：09:00～18:00"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当</label>
                              <input type="text" value={p.replacementName}
                                onChange={e => updateDayPerson(dayIdx, personIdx, { replacementName: e.target.value })}
                                placeholder="例：田中パート"
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            </div>
                          </div>

                          {/* 変更後担当の元シフト */}
                          <div className="mb-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">変更後担当の元シフト</label>
                            <input type="text" value={p.replacementOriginalShift}
                              onChange={e => updateDayPerson(dayIdx, personIdx, { replacementOriginalShift: e.target.value })}
                              placeholder="例：休み、09:00～13:00、未定"
                              className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                          </div>

                          {/* 振休 */}
                          {p.replacementName.trim() !== '' && (
                            <div className="mb-2 pt-2 border-t border-gray-200">
                              <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={p.wantsCompensatoryLeave}
                                  onChange={e => updateDayPerson(dayIdx, personIdx, {
                                    wantsCompensatoryLeave: e.target.checked,
                                    compensatoryLeaveTiming: e.target.checked ? p.compensatoryLeaveTiming : 'later',
                                  })}
                                  className="w-4 h-4 rounded accent-purple-600" />
                                <span className="text-xs font-medium text-gray-700">振休を設定する（{p.replacementName}）</span>
                              </label>
                              {p.wantsCompensatoryLeave && (
                                <div className="mt-2 pl-1 space-y-2">
                                  <div className="flex gap-4">
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <input type="radio" checked={p.compensatoryLeaveTiming === 'now'}
                                        onChange={() => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveTiming: 'now' })}
                                        className="w-3.5 h-3.5 accent-purple-600" />
                                      <span className="text-xs text-gray-700">振休日を同時に設定</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                      <input type="radio" checked={p.compensatoryLeaveTiming === 'later'}
                                        onChange={() => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveTiming: 'later' })}
                                        className="w-3.5 h-3.5 accent-purple-600" />
                                      <span className="text-xs text-gray-700">振休日は後で設定</span>
                                    </label>
                                  </div>
                                  {p.compensatoryLeaveTiming === 'now' && (
                                    <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-200 space-y-2">
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日 <span className="text-red-500">*</span></label>
                                        <input type="date" value={p.compensatoryLeaveDate}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveDate: e.target.value })}
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">振休日の変更内容</label>
                                        <input type="text" value={p.compensatoryLeaveDetail}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveDetail: e.target.value })}
                                          placeholder="振休"
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                          振休日の代替出勤者 <span className="text-gray-400 font-normal">（任意）</span>
                                        </label>
                                        <input type="text" value={p.compensatoryLeaveReplacementName}
                                          onChange={e => updateDayPerson(dayIdx, personIdx, { compensatoryLeaveReplacementName: e.target.value })}
                                          placeholder="例：鈴木パート"
                                          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 他施設応援 */}
                          <div className="pt-2 border-t border-gray-200">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input type="checkbox" checked={p.isExternalSupport}
                                onChange={e => updateDayPerson(dayIdx, personIdx, {
                                  isExternalSupport: e.target.checked,
                                  supportFromFacilityId: e.target.checked ? p.supportFromFacilityId : '',
                                })}
                                className="w-4 h-4 rounded accent-blue-600" />
                              <span className="text-xs font-medium text-gray-700">他施設からの応援</span>
                            </label>
                            {p.isExternalSupport && (
                              <select value={p.supportFromFacilityId}
                                onChange={e => updateDayPerson(dayIdx, personIdx, { supportFromFacilityId: e.target.value })}
                                className="mt-2 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">応援元施設を選択</option>
                                {activeFacilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </select>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          {emailWarning && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{emailWarning}</p>
          )}
          {emailSuccess && (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{emailSuccess}</p>
          )}
        </div>

        {/* ── フッター ── */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t flex-shrink-0">
          {editing && onDelete ? (
            <button onClick={handleDelete} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 border border-red-200 disabled:opacity-60">
              <Trash2 size={14} />削除
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">
              {emailWarning || emailSuccess ? '閉じる' : 'キャンセル'}
            </button>
            {!emailWarning && !emailSuccess && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
                <Save size={14} />{saveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
