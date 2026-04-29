import { createClient } from '@/lib/supabase/client'
import type { EventType } from '@/lib/types'

const LS_EVENTS_KEY    = 'group_leader_schedule_events'
const LS_MANAGERS_KEY  = 'group_leader_schedule_managers'
const LS_FACILITIES_KEY = 'group_leader_schedule_facilities'
const LS_MIGRATED_KEY  = 'group_leader_schedule_migrated_v2'

// 旧 localStorage のイベント型（移行元）
interface OldEvent {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  facilityName: string
  type: string
  memo: string
  groupLeaderId: string   // 旧シードID: 'fukuda' / 'higashimoto' / 'inoue' / 'yamamoto' or UUID
  groupLeaderName: string
}

// 旧シードID → G長名のマッピング
const OLD_ID_TO_NAME: Record<string, string> = {
  fukuda:      '福田G長',
  higashimoto: '東本G長',
  inoue:       '井上G長',
  yamamoto:    '山本G長',
}

// localStorage に未移行データが存在するか確認
export function hasLocalStorageData(): boolean {
  if (typeof window === 'undefined') return false
  if (localStorage.getItem(LS_MIGRATED_KEY)) return false

  try {
    const raw = localStorage.getItem(LS_EVENTS_KEY)
    if (!raw) return false
    const events = JSON.parse(raw) as OldEvent[]
    return events.length > 0
  } catch {
    return false
  }
}

export type MigrationResult = {
  migratedCount: number
  skippedCount: number
  errors: string[]
}

// localStorage のデータを Supabase へ移行する
export async function migrateToSupabase(): Promise<MigrationResult> {
  const supabase = createClient()
  const errors: string[] = []
  let migratedCount = 0
  let skippedCount = 0

  // ── 移行元データを読み込む ──────────────────────────────────────
  let oldEvents: OldEvent[] = []
  try {
    const raw = localStorage.getItem(LS_EVENTS_KEY)
    if (!raw) return { migratedCount: 0, skippedCount: 0, errors: [] }
    oldEvents = JSON.parse(raw) as OldEvent[]
  } catch {
    return { migratedCount: 0, skippedCount: 0, errors: ['localStorageの読み込みに失敗しました'] }
  }

  if (oldEvents.length === 0) return { migratedCount: 0, skippedCount: 0, errors: [] }

  // ── Supabase の G長一覧を取得してIDマッピングを作成 ─────────────
  const { data: managers } = await supabase
    .from('group_managers')
    .select('id, name')
  const managerMap = new Map<string, string>() // 旧ID / 旧名 → 新UUID
  if (managers) {
    for (const m of managers) {
      managerMap.set(m.id, m.id)    // すでにUUIDなら同一
      managerMap.set(m.name, m.id)  // 名前からも引けるように
    }
    // 旧ハードコードIDを名前経由でマッピング
    for (const [oldId, name] of Object.entries(OLD_ID_TO_NAME)) {
      const found = managers.find(m => m.name === name)
      if (found) managerMap.set(oldId, found.id)
    }
  }

  // ── Supabase の施設一覧を取得して名前→IDマッピングを作成 ────────
  const { data: facilities } = await supabase
    .from('facilities')
    .select('id, name')
  const facilityMap = new Map<string, string>() // 施設名 → UUID
  if (facilities) {
    for (const f of facilities) facilityMap.set(f.name, f.id)
  }

  // ── イベントを1件ずつ移行 ────────────────────────────────────────
  for (const event of oldEvents) {
    const managerId = managerMap.get(event.groupLeaderId)
      ?? managerMap.get(event.groupLeaderName)
    if (!managerId) {
      errors.push(`G長「${event.groupLeaderName}」が見つかりません（予定: ${event.title}）`)
      skippedCount++
      continue
    }

    const facilityId = event.facilityName
      ? (facilityMap.get(event.facilityName) ?? null)
      : null

    const { error } = await supabase.from('schedules').insert({
      group_manager_id: managerId,
      facility_id: facilityId,
      title: event.title || '（タイトルなし）',
      date: event.date,
      start_time: event.startTime || '09:00',
      end_time: event.endTime || '10:00',
      type: (event.type || 'other') as EventType,
      memo: event.memo ?? '',
    })

    if (error) {
      errors.push(`予定「${event.title}」の移行に失敗: ${error.message}`)
      skippedCount++
    } else {
      migratedCount++
    }
  }

  // ── 完了フラグを立ててlocalStorageを削除 ─────────────────────────
  localStorage.setItem(LS_MIGRATED_KEY, 'true')
  if (errors.length === 0) {
    localStorage.removeItem(LS_EVENTS_KEY)
    localStorage.removeItem(LS_MANAGERS_KEY)
    localStorage.removeItem(LS_FACILITIES_KEY)
  }

  return { migratedCount, skippedCount, errors }
}

// 移行バナーを非表示にするだけ（データは移行しない）
export function dismissMigration(): void {
  localStorage.setItem(LS_MIGRATED_KEY, 'true')
}
