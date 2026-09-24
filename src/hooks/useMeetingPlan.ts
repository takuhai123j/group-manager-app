'use client'

import { useState, useCallback, useEffect } from 'react'
import { meetingService } from '@/services/meetingService'
import { meetingFrequencyService } from '@/services/meetingFrequencyService'
import { meetingScheduleService } from '@/services/meetingScheduleService'
import { meetingMinutesService } from '@/services/meetingMinutesService'
import { meetingNotifyService, type MeetingNotifyResult, type MeetingNotifyStatus } from '@/services/meetingNotifyService'
import type {
  Meeting, MeetingFrequency, MeetingFrequencyInput, MeetingMinute,
  CreateManualMeetingWithScheduleInput, ConfirmMeetingScheduleInput, RescheduleMeetingInput,
} from '@/lib/types'

// MT年間計画画面向けのデータ取得・操作をまとめたフック。
// ローカル側での差分更新はせず、変更のたびに該当データを再取得する
// （meetings/schedules/meeting_frequencies にまたがる状態のため、
//  部分的なローカル更新は不整合の温床になりやすい）。
export function useMeetingPlan(year: number) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [frequencies, setFrequencies] = useState<MeetingFrequency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // silent: true の場合は loading を立てずに再取得する。
  // 保存・変更後の再読込で一覧がローディング表示に置き換わると、年間計画の表が
  // remount されてスクロール位置が先頭に戻ってしまうため、操作後は silent で読み直す
  // （初回表示・年の切替は従来どおりローディング表示あり）
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [meetingsData, frequenciesData] = await Promise.all([
        meetingService.getByYear(year),
        meetingFrequencyService.getAll(),
      ])
      setMeetings(meetingsData)
      setFrequencies(frequenciesData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MT年間計画の読み込みに失敗しました')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [year])

  useEffect(() => { load() }, [load])

  const reloadSilently = useCallback(() => load({ silent: true }), [load])

  // ── MTメール通知 ──────────────────────────────────────────────
  // 通知は本体の保存が完了した後に呼び、失敗しても保存結果は取り消さない（結果だけ呼び出し元へ返す）。
  // MT予定確定通知は「日程未定→初めて日付・時間を確定した操作」（addManual の日付あり / confirmSchedule）
  // からだけ呼ぶ。日程変更・取消・実施済みなどからは呼ばない（サーバー側でも1MT1回に制限している）。

  // 実施予定日を入力した場合は、meeting作成と同時にconfirmSchedule()まで
  // 1回の操作で行う（createManualMeeting側で既存関数を再利用して実装済み）
  const addManual = useCallback(async (input: CreateManualMeetingWithScheduleInput): Promise<MeetingNotifyResult> => {
    const created = await meetingScheduleService.createManualMeeting(input)
    await reloadSilently()
    if (!input.schedule || !created.scheduleId) return {}
    const notification: MeetingNotifyStatus = await meetingNotifyService.notifyScheduleConfirmed(created.id)
    return { notification }
  }, [reloadSilently])

  const confirmSchedule = useCallback(async (meetingId: string, input: ConfirmMeetingScheduleInput): Promise<MeetingNotifyResult> => {
    await meetingScheduleService.confirmSchedule(meetingId, input)
    await reloadSilently()
    const notification = await meetingNotifyService.notifyScheduleConfirmed(meetingId)
    return { notification }
  }, [reloadSilently])

  const rescheduleMeeting = useCallback(async (meetingId: string, input: RescheduleMeetingInput): Promise<void> => {
    await meetingScheduleService.rescheduleMeeting(meetingId, input)
    await reloadSilently()
  }, [reloadSilently])

  const cancelSchedule = useCallback(async (meetingId: string): Promise<void> => {
    await meetingScheduleService.cancelSchedule(meetingId)
    await reloadSilently()
  }, [reloadSilently])

  const markDone = useCallback(async (meetingId: string, executedDate?: string): Promise<void> => {
    await meetingService.markDone(meetingId, executedDate)
    await reloadSilently()
  }, [reloadSilently])

  // 頻度設定の作成・更新（既存行があれば更新、なければ新規作成）。
  // 保存後は選択中の年の年間計画を再生成する。
  const saveFrequency = useCallback(async (
    existingId: string | undefined,
    input: MeetingFrequencyInput
  ): Promise<void> => {
    const saved = existingId
      ? await meetingFrequencyService.update(existingId, input)
      : await meetingFrequencyService.create(input)
    await meetingService.regenerateYear(saved.id, year)
    await reloadSilently()
  }, [year, reloadSilently])

  // 有効/無効の切替も「頻度変更」として扱い、選択中の年を再生成する
  const toggleFrequencyActive = useCallback(async (id: string): Promise<void> => {
    await meetingFrequencyService.toggleActive(id)
    await meetingService.regenerateYear(id, year)
    await reloadSilently()
  }, [year, reloadSilently])

  // 議事録PDFのアップロード/削除後は、年間計画マトリクスの
  // 表示ステータス（minutesCount由来）を最新化するため再取得する
  // 議事録通知は Storage保存・meeting_minutes登録の両方が成功した後（upload 完了後）に、そのPDF1件について呼ぶ
  const uploadMinute = useCallback(async (meeting: Meeting, file: File): Promise<{ minute: MeetingMinute } & MeetingNotifyResult> => {
    const minute = await meetingMinutesService.upload(meeting, file)
    await reloadSilently()
    const notification = await meetingNotifyService.notifyMinuteSaved(minute.id)
    return { minute, notification }
  }, [reloadSilently])

  const deleteMinute = useCallback(async (minute: MeetingMinute): Promise<void> => {
    await meetingMinutesService.remove(minute)
    await reloadSilently()
  }, [reloadSilently])

  // 計画月の手動調整（年間計画そのものの直接編集。schedules/meeting_frequenciesには触れない）
  const moveTargetMonth = useCallback(async (meetingId: string, newTargetMonth: string): Promise<void> => {
    await meetingService.moveTargetMonth(meetingId, newTargetMonth)
    await reloadSilently()
  }, [reloadSilently])

  const moveTargetMonthCascade = useCallback(async (meetingId: string, newTargetMonth: string): Promise<void> => {
    await meetingService.moveTargetMonthCascade(meetingId, newTargetMonth)
    await reloadSilently()
  }, [reloadSilently])

  const deleteMeeting = useCallback(async (meetingId: string): Promise<void> => {
    await meetingService.deleteIfSafe(meetingId)
    await reloadSilently()
  }, [reloadSilently])

  return {
    meetings,
    frequencies,
    loading,
    error,
    reload: load,
    addManual,
    confirmSchedule,
    rescheduleMeeting,
    cancelSchedule,
    markDone,
    saveFrequency,
    toggleFrequencyActive,
    uploadMinute,
    deleteMinute,
    moveTargetMonth,
    moveTargetMonthCascade,
    deleteMeeting,
  }
}
