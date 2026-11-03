import type { Prober } from './prober'

export interface Env {
  DB: D1Database
  PROBER: DurableObjectNamespace<Prober>
  ASSETS: Fetcher
  /**
   * Secret. Password of the admin console (/admin); unset = admin disabled. Everything else
   * (zones, pages, Feishu, email, check parameters) is configured in the console.
   */
  ADMIN_TOKEN?: string
  /** Edge cache lifetime of public API responses in seconds (default 30, 0 disables). */
  API_CACHE_SECONDS?: string
}
