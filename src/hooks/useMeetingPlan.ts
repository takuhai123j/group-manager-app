'use client'

import { useState, useCallback, useEffect } from 'react'
import { meetingService } from '@/services/meetingService'
import { meetingFrequencyService } from '@/services/meetingFrequencyService'
import { meetingScheduleService } from '@/services/meetingScheduleService'
import { meetingMinutesService } from '@/services/meetingMinutesService'
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

  const load = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [year])

  useEffect(() => { load() }, [load])

  // 実施予定日を入力した場合は、meeting作成と同時にconfirmSchedule()まで
  // 1回の操作で行う（createManualMeeting側で既存関数を再利用して実装済み）
  const addManual = useCallback(async (input: CreateManualMeetingWithScheduleInput): Promise<void> => {
    await meetingScheduleService.createManualMeeting(input)
    await load()
  }, [load])

  const confirmSchedule = useCallback(async (meetingId: string, input: ConfirmMeetingScheduleInput): Promise<void> => {
    await meetingScheduleService.confirmSchedule(meetingId, input)
    await load()
  }, [load])

  const rescheduleMeeting = useCallback(async (meetingId: string, input: RescheduleMeetingInput): Promise<void> => {
    await meetingScheduleService.rescheduleMeeting(meetingId, input)
    await load()
  }, [load])

  const cancelSchedule = useCallback(async (meetingId: string): Promise<void> => {
    await meetingScheduleService.cancelSchedule(meetingId)
    await load()
  }, [load])

  const markDone = useCallback(async (meetingId: string, executedDate?: string): Promise<void> => {
    await meetingService.markDone(meetingId, executedDate)
    await load()
  }, [load])

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
    await load()
  }, [year, load])

  // 有効/無効の切替も「頻度変更」として扱い、選択中の年を再生成する
  const toggleFrequencyActive = useCallback(async (id: string): Promise<void> => {
    await meetingFrequencyService.toggleActive(id)
    await meetingService.regenerateYear(id, year)
    await load()
  }, [year, load])

  // 議事録PDFのアップロード/削除後は、年間計画マトリクスの
  // 表示ステータス（minutesCount由来）を最新化するため再取得する
  const uploadMinute = useCallback(async (meeting: Meeting, file: File): Promise<MeetingMinute> => {
    const minute = await meetingMinutesService.upload(meeting, file)
    await load()
    return minute
  }, [load])

  const deleteMinute = useCallback(async (minute: MeetingMinute): Promise<void> => {
    await meetingMinutesService.remove(minute)
    await load()
  }, [load])

  // 計画月の手動調整（年間計画そのものの直接編集。schedules/meeting_frequenciesには触れない）
  const moveTargetMonth = useCallback(async (meetingId: string, newTargetMonth: string): Promise<void> => {
    await meetingService.moveTargetMonth(meetingId, newTargetMonth)
    await load()
  }, [load])

  const moveTargetMonthCascade = useCallback(async (meetingId: string, newTargetMonth: string): Promise<void> => {
    await meetingService.moveTargetMonthCascade(meetingId, newTargetMonth)
    await load()
  }, [load])

  const deleteMeeting = useCallback(async (meetingId: string): Promise<void> => {
    await meetingService.deleteIfSafe(meetingId)
    await load()
  }, [load])

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
