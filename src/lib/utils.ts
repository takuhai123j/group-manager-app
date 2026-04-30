import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addDays,
  isSameDay,
  isSameMonth,
  parseISO,
} from 'date-fns'
import { ja } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatJa(date: Date, formatStr: string): string {
  return format(date, formatStr, { locale: ja })
}

export function toDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function fromDateString(dateStr: string): Date {
  return parseISO(dateStr)
}

export function isTodayDate(date: Date): boolean {
  return isSameDay(date, new Date())
}

export function isSameMonthDate(date: Date, baseDate: Date): boolean {
  return isSameMonth(date, baseDate)
}

// Get week days starting from Monday (Japanese business week)
export function getWeekDays(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end })
}

// Generate 30-minute time slots HH:MM from startHour to endHour (inclusive)
export function generateTimeSlots(startHour = 6, endHour = 22): string[] {
  const slots: string[] = []
  for (let hour = startHour; hour <= endHour; hour++) {
    slots.push(`${String(hour).padStart(2, '0')}:00`)
    if (hour < endHour) {
      slots.push(`${String(hour).padStart(2, '0')}:30`)
    }
  }
  return slots
}

export function timeToMinutes(time: string | null | undefined): number {
  if (!time || !time.includes(':')) return 0
  const parts = time.split(':')
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Returns CSS top and height values (in pixels) for positioning events in time grid
export const SLOT_HEIGHT = 40 // px per 30-min slot
export const GRID_START_HOUR = 6

export function getEventPosition(startTime: string | null | undefined, endTime: string | null | undefined) {
  const startMin = Math.max(0, timeToMinutes(startTime) - GRID_START_HOUR * 60)
  const endMin = Math.max(0, timeToMinutes(endTime) - GRID_START_HOUR * 60)
  const top = (startMin / 30) * SLOT_HEIGHT
  const rawHeight = ((endMin - startMin) / 30) * SLOT_HEIGHT
  const height = Math.max(rawHeight > 0 ? rawHeight : SLOT_HEIGHT / 2, SLOT_HEIGHT / 2)
  return { top, height }
}

export const DAY_NAMES_JA = ['月', '火', '水', '木', '金', '土', '日']
export const DAY_NAMES_FULL_JA = ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日']

export function getDayName(date: Date): string {
  // getDay() returns 0=Sun,1=Mon,...,6=Sat
  // We want Mon=0,...,Sat=5,Sun=6
  const day = (date.getDay() + 6) % 7
  return DAY_NAMES_JA[day]
}

export function isWeekend(date: Date): boolean {
  const d = date.getDay()
  return d === 0 || d === 6
}

export function isSaturday(date: Date): boolean {
  return date.getDay() === 6
}

export function isSunday(date: Date): boolean {
  return date.getDay() === 0
}

export function addDaysToDate(date: Date, days: number): Date {
  return addDays(date, days)
}

// ── Dynamic color utilities for GroupManager ────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(cleaned.substring(0, 2), 16) || 0
  const g = parseInt(cleaned.substring(2, 4), 16) || 0
  const b = parseInt(cleaned.substring(4, 6), 16) || 0
  return [r, g, b]
}

// Returns inline styles for event cards colored by manager
export function getManagerColorStyle(color: string): {
  backgroundColor: string
  borderColor: string
  color: string
} {
  const [r, g, b] = hexToRgb(color)
  // Dark text computed from the hue so it's always readable on the light tint
  const dr = Math.min(Math.floor(r * 0.38), 80)
  const dg = Math.min(Math.floor(g * 0.38), 80)
  const db = Math.min(Math.floor(b * 0.38), 80)
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.13)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.45)`,
    color: `rgb(${dr}, ${dg}, ${db})`,
  }
}

export const PRESET_COLORS = [
  '#4F46E5', '#7C3AED', '#2563EB', '#0891B2',
  '#0D9488', '#059669', '#65A30D', '#CA8A04',
  '#D97706', '#EA580C', '#DC2626', '#E11D48',
] as const
