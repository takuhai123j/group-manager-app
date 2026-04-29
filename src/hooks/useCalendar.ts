'use client'

import { useState, useCallback } from 'react'
import { addMonths, addWeeks, addDays, subMonths, subWeeks, subDays } from 'date-fns'
import type { CalendarView } from '@/lib/types'

export function useCalendar() {
  const [currentDate, setCurrentDate] = useState<Date>(new Date())
  const [view, setView] = useState<CalendarView>('month')

  const goToToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  const navigateNext = useCallback(() => {
    setCurrentDate(prev => {
      if (view === 'month') return addMonths(prev, 1)
      if (view === 'week') return addWeeks(prev, 1)
      return addDays(prev, 1)
    })
  }, [view])

  const navigatePrev = useCallback(() => {
    setCurrentDate(prev => {
      if (view === 'month') return subMonths(prev, 1)
      if (view === 'week') return subWeeks(prev, 1)
      return subDays(prev, 1)
    })
  }, [view])

  const changeView = useCallback((newView: CalendarView) => {
    setView(newView)
  }, [])

  const setDate = useCallback((date: Date) => {
    setCurrentDate(date)
  }, [])

  return {
    currentDate,
    view,
    goToToday,
    navigateNext,
    navigatePrev,
    changeView,
    setDate,
  }
}
