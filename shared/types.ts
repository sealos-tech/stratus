// Types shared by the Worker and the browser app.

/** Text shown in the UI: one string for every language, or one per language. */
export type Localized = string | { en: string; zh: string }

export interface MonitorConfig {
  /** Unique inside its zone; history is keyed by `<zone id>/<monitor id>`. */
  id: string
  name: Localized
  description?: Localized
  /** Page to load. Redirects are followed; the final response must be 2xx. */
  url: string
  /** Optional text the response body must contain. */
  keyword?: string
}

export interface ZoneConfig {
  id: string
  domain: string
  name: Localized
  location: Localized
  country: string
  probe: DurableObjectLocationHint
  monitors: MonitorConfig[]
}

export interface SiteConfig {
  title: Localized
  timezone: string
  historyDays: number
  /** Default language for visitors whose browser language is not supported. */
  language: 'en' | 'zh'
}

export type DurableObjectLocationHint = 'wnam' | 'enam' | 'sam' | 'weur' | 'eeur' | 'apac' | 'oc' | 'afr' | 'me'

/** One character per minute in `daily.minutes`. */
export type SampleCode = 'u' | 'd' | 'x' | 'm'

export type Status = 'up' | 'degraded' | 'down' | 'maintenance' | 'nodata'

export const CODE_STATUS: Record<SampleCode, Status> = {
  u: 'up',
  d: 'degraded',
  x: 'down',
  m: 'maintenance',
}

/** [up, degraded, down, maintenance, average latency ms] minutes for one day. */
export type DayCounts = [number, number, number, number, number]

// ---- Published events (written in the admin console) ----

export type EventKind = 'incident' | 'maintenance'
export type Impact = 'degraded' | 'partial' | 'major' | 'maintenance'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed'
export type EventStatus = IncidentStatus | MaintenanceStatus

export const INCIDENT_STATUSES: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved']
export const MAINTENANCE_STATUSES: MaintenanceStatus[] = ['scheduled', 'in_progress', 'completed']
export const INCIDENT_IMPACTS: Impact[] = ['degraded', 'partial', 'major']

/** A zone, or one page of a zone. */
export interface ComponentRef {
  zone: string
  monitor?: string
}

export interface ApiEventUpdate {
  id: number
  status: EventStatus
  body: string
  createdAt: number
}

export interface ApiEvent {
  id: number
  kind: EventKind
  title: string
  impact: Impact
  /** For maintenance this is derived from the window unless completed early. */
  status: EventStatus
  /** Empty = every zone. */
  components: ComponentRef[]
  startsAt: number
  /** Resolution time (incident) or planned end (maintenance). */
  endsAt: number | null
  createdAt: number
  updatedAt: number
  /** Newest first. */
  updates: ApiEventUpdate[]
}

// ---- Automatic detections ----

/** A period in which a page failed its checks. */
export interface ApiOutage {
  id: number
  zone: string
  monitor: string
  start: number
  end: number | null
  error: string
  /** Every change of the error message: [UNIX seconds, error]. */
  errors: [number, string][]
}

export interface ApiMonitor {
  id: string
  name: Localized
  description?: Localized
  url: string
  status: Status
  lastTs: number | null
  latency: number | null
  code: number | null
  error: string | null
  colo: string | null
  /** Oldest first, one entry per day of `ApiSummary.days`. */
  days: DayCounts[]
}

export interface ApiZone {
  id: string
  domain: string
  name: Localized
  location: Localized
  country: string
  colo: string | null
  monitors: ApiMonitor[]
}

export interface ApiSummary {
  site: SiteConfig
  generatedAt: number
  /** Day keys (YYYY-MM-DD in site timezone), oldest first, ending today. */
  days: string[]
  zones: ApiZone[]
  ongoingOutages: ApiOutage[]
  /** Ongoing, upcoming and those overlapping the history window. */
  events: ApiEvent[]
  subscribe: { email: boolean; webhook: boolean }
}

export interface ApiDayStats {
  day: string
  up: number
  degraded: number
  down: number
  maintenance: number
  avg: number
  min: number
  max: number
}

export interface ApiMonitorDetail {
  zone: ApiZone
  monitor: ApiMonitor
  days: string[]
  history: ApiDayStats[]
  outages: ApiOutage[]
  events: ApiEvent[]
  timezone: string
}

export interface ApiMonitorDay {
  day: string
  /** UNIX seconds of minute 0 of the day. */
  dayStart: number
  /** 1440 chars: '.' no data, otherwise a SampleCode. */
  minutes: string
  /** 1440 latencies in ms, 0 = none. */
  latencies: number[]
  outages: ApiOutage[]
}

export interface ZoneIndex {
  id: string
  name: Localized
  domain: string
  monitors: { id: string; name: Localized }[]
}

export interface ApiHistory {
  from: number
  to: number
  timezone: string
  zones: ZoneIndex[]
  events: ApiEvent[]
  /** Outages that lasted past the notification grace period, or are still ongoing. */
  outages: ApiOutage[]
}

export interface ApiEventDetail {
  event: ApiEvent
  zones: ZoneIndex[]
  timezone: string
}

// ---- Subscriptions ----

export type SubscriberKind = 'email' | 'webhook'

export interface SubscribeRequest {
  kind: SubscriberKind
  target: string
  /** null = every zone. */
  zones: string[] | null
  /** Also notify automatic outage detections, not only published events. */
  auto: boolean
  lang: 'zh' | 'en'
}

export interface ApiSubscriber {
  id: number
  kind: SubscriberKind
  target: string
  zones: string[] | null
  auto: boolean
  lang: 'zh' | 'en'
  verified: boolean
  createdAt: number
  lastError: string | null
}

export interface ApiAdminOverview {
  events: ApiEvent[]
  outages: ApiOutage[]
  subscribers: ApiSubscriber[]
  outbox: { pending: number; failed: number; sent24h: number }
  config: { team: boolean; email: boolean; siteUrl: string | null; graceMinutes: number }
  zones: ZoneIndex[]
  timezone: string
}

/** Result of checking one page from the admin console. */
export interface ApiProbeResult {
  zone: string
  id: string
  url: string
  ok: boolean
  latency: number
  code: number | null
  error: string | null
}

export interface EventInput {
  kind: EventKind
  title: string
  impact: Impact
  status: EventStatus
  body: string
  components: ComponentRef[]
  startsAt?: number
  endsAt?: number | null
  notify: boolean
}
