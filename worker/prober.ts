// Page checks. Each zone is probed from a Durable Object created with that zone's location hint,
// so a page is loaded from a Cloudflare region near its users, and every zone gets its own
// subrequest budget.
import { DurableObject } from 'cloudflare:workers'
import { USER_AGENT } from '../status.config'
import type { MonitorConfig } from '../shared/types'
import type { Env } from './env'

export interface CheckResult {
  id: string
  ok: boolean
  latency: number
  code: number | null
  error: string | null
}

export interface ZoneProbe {
  colo: string | null
  results: CheckResult[]
}

// Workers allow 6 simultaneous outgoing connections; one stays free for the colo lookup.
const CONCURRENCY = 5
const RETRY_DELAY_MS = 2000

/**
 * Stable error text: the runtime reports refused connections and TLS failures as
 * "internal error; reference = <random id>", and a new id on every check would look like a new
 * error each minute.
 */
export function describeFetchError(err: Error): string {
  const message = err.message.replace(/;?\s*reference\s*=\s*\S+/i, '').trim()
  if (/^internal error$/i.test(message)) return 'Connection failed (network or TLS error)'
  return `${err.name}: ${message}`
}

export async function checkPage(monitor: MonitorConfig, timeoutMs: number): Promise<CheckResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(monitor.url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      signal: controller.signal,
      cf: { cacheTtlByStatus: { '100-599': -1 } },
    })
    // Read the whole page: the latency covers the full download and a broken body fails the check.
    const body = await res.text()
    const latency = Date.now() - start
    if (!res.ok) return { id: monitor.id, ok: false, latency, code: res.status, error: `HTTP ${res.status}` }
    if (monitor.keyword && !body.includes(monitor.keyword)) {
      return { id: monitor.id, ok: false, latency, code: res.status, error: `Keyword "${monitor.keyword}" not found` }
    }
    return { id: monitor.id, ok: true, latency, code: res.status, error: null }
  } catch (e) {
    const err = e as Error
    if (controller.signal.aborted) {
      return { id: monitor.id, ok: false, latency: timeoutMs, code: null, error: `Timeout after ${timeoutMs}ms` }
    }
    return { id: monitor.id, ok: false, latency: Date.now() - start, code: null, error: describeFetchError(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

let coloCache: string | null = null

async function getColo(): Promise<string | null> {
  if (coloCache) return coloCache
  try {
    const res = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(3000) })
    coloCache = /^colo=(.+)$/m.exec(await res.text())?.[1] ?? null
  } catch {
    // Unknown colo only affects the label.
  }
  return coloCache
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Checks every page. A failed page is retried once so a single dropped connection is not an
 * outage. A page slower than `degradedMs` is measured again and the faster result is kept: a
 * request that stalls on a long path says nothing about the page, and a page that is really slow
 * stays slow.
 */
export async function probeZone(monitors: MonitorConfig[], timeoutMs: number, degradedMs: number): Promise<ZoneProbe> {
  const check = (m: MonitorConfig) => checkPage(m, timeoutMs)
  const [colo, results] = await Promise.all([getColo(), pool(monitors, CONCURRENCY, check)])

  const failed = monitors.filter((_, i) => !results[i].ok)
  if (failed.length > 0) {
    await delay(RETRY_DELAY_MS)
    const retried = await pool(failed, CONCURRENCY, check)
    for (const r of retried) results[monitors.findIndex((m) => m.id === r.id)] = r
  }

  const slow = new Set(results.filter((r) => r.ok && r.latency > degradedMs).map((r) => r.id))
  if (slow.size > 0) {
    await delay(RETRY_DELAY_MS)
    const retried = await pool(monitors.filter((m) => slow.has(m.id)), CONCURRENCY, check)
    for (const r of retried) {
      // The page answered once already, so a failed re-check is noise, not an outage.
      if (!r.ok) continue
      const i = results.findIndex((x) => x.id === r.id)
      if (r.latency < results[i].latency) results[i] = r
    }
  }
  return { colo, results }
}

export class Prober extends DurableObject<Env> {
  async probe(monitors: MonitorConfig[], timeoutMs: number, degradedMs: number): Promise<ZoneProbe> {
    return probeZone(monitors, timeoutMs, degradedMs)
  }
}
