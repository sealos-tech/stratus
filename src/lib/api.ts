import type { AdminSettings, SettingsInput } from '$shared/settings'
import type {
  ApiAdminOverview,
  ApiProbeResult,
  ApiEvent,
  ApiEventDetail,
  ApiHistory,
  ApiMonitorDay,
  ApiMonitorDetail,
  ApiSummary,
  EventInput,
  SubscribeRequest,
} from '$shared/types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Seconds, from the Retry-After header of a 429. */
    public retryAfter?: number
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `${res.status} ${res.statusText}`, Number(res.headers.get('retry-after')) || undefined)
  return data
}

const enc = encodeURIComponent

export const fetchSummary = () => request<ApiSummary>('/api/summary')
export const fetchHistory = (from: number, to: number) => request<ApiHistory>(`/api/history?from=${from}&to=${to}`)
export const fetchEvent = (id: number) => request<ApiEventDetail>(`/api/events/${id}`)
export const fetchMonitor = (zone: string, monitor: string) => request<ApiMonitorDetail>(`/api/monitors/${enc(zone)}/${enc(monitor)}`)
export const fetchMonitorDay = (zone: string, monitor: string, day: string) =>
  request<ApiMonitorDay>(`/api/monitors/${enc(zone)}/${enc(monitor)}/days/${day}`)
export const subscribe = (body: SubscribeRequest) =>
  request<{ ok: boolean; verified: boolean; flavor: string | null }>('/api/subscribe', { method: 'POST', body: JSON.stringify(body) })

// ---- Admin ----

// The console is opened as /admin?p=<ADMIN_TOKEN>. The token is kept for this tab only and
// removed from the address bar, so it does not stay in browser history or get copied with the URL.
const TOKEN_KEY = 'adminToken'
export const adminToken = {
  get: () => sessionStorage.getItem(TOKEN_KEY) ?? '',
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
  /** Moves `?p=` from the URL into session storage. */
  takeFromUrl: () => {
    const url = new URL(location.href)
    const p = url.searchParams.get('p')
    if (p === null) return
    sessionStorage.setItem(TOKEN_KEY, p.trim())
    url.searchParams.delete('p')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  },
}

function admin<T>(path: string, init: RequestInit = {}) {
  return request<T>(`/api/admin/${path}`, { ...init, headers: { authorization: `Bearer ${adminToken.get()}` } })
}

export const adminApi = {
  overview: () => admin<ApiAdminOverview>('overview'),
  createEvent: (input: EventInput) => admin<ApiEvent>('events', { method: 'POST', body: JSON.stringify(input) }),
  addUpdate: (id: number, body: { status: string; body: string; notify: boolean; endsAt?: number | null }) =>
    admin<ApiEvent>(`events/${id}/updates`, { method: 'POST', body: JSON.stringify(body) }),
  editEvent: (id: number, body: Partial<EventInput>) => admin<ApiEvent>(`events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteEvent: (id: number) => admin<{ ok: true }>(`events/${id}`, { method: 'DELETE' }),
  addSubscriber: (body: SubscribeRequest) => admin<{ ok: true }>('subscribers', { method: 'POST', body: JSON.stringify(body) }),
  deleteSubscriber: (id: number) => admin<{ ok: true }>(`subscribers/${id}`, { method: 'DELETE' }),
  testNotification: (url?: string) =>
    admin<{ ok: boolean; error: string | null }>('test-notification', { method: 'POST', body: JSON.stringify(url ? { url } : {}) }),
  retryOutbox: () => admin<{ ok: true }>('outbox/retry', { method: 'POST', body: '{}' }),
  getSettings: () => admin<AdminSettings>('settings'),
  saveSettings: (input: SettingsInput) => admin<AdminSettings>('settings', { method: 'PUT', body: JSON.stringify(input) }),
  probe: (input: SettingsInput, zone: string) =>
    admin<ApiProbeResult[]>(`probe?zone=${encodeURIComponent(zone)}`, { method: 'POST', body: JSON.stringify(input) }),
}
