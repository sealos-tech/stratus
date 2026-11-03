// Labels used both in the UI and in notifications.
import type { EventStatus, Impact } from './types'

export type Lang = 'en' | 'zh'

export const STATUS_LABEL: Record<EventStatus, Record<Lang, string>> = {
  investigating: { en: 'Investigating', zh: '调查中' },
  identified: { en: 'Identified', zh: '已定位' },
  monitoring: { en: 'Monitoring', zh: '观察中' },
  resolved: { en: 'Resolved', zh: '已解决' },
  scheduled: { en: 'Scheduled', zh: '计划中' },
  in_progress: { en: 'In progress', zh: '进行中' },
  completed: { en: 'Completed', zh: '已完成' },
}

export const IMPACT_LABEL: Record<Impact, Record<Lang, string>> = {
  degraded: { en: 'Degraded performance', zh: '性能下降' },
  partial: { en: 'Partial outage', zh: '部分中断' },
  major: { en: 'Full outage', zh: '全面中断' },
  maintenance: { en: 'Maintenance', zh: '计划维护' },
}

/** Hex colors of the status palette. */
export const COLORS = {
  up: '#24c19a',
  degraded: '#fbbf24',
  partial: '#f5785c',
  major: '#f87171',
  maintenance: '#3b82f6',
  nodata: '#f7f7f8',
}
