import type { ApiEvent } from '$shared/types'

export const isActiveEvent = (e: ApiEvent) => (e.kind === 'incident' ? e.status !== 'resolved' : e.status === 'in_progress')
export const isUpcoming = (e: ApiEvent) => e.kind === 'maintenance' && e.status === 'scheduled'
