// Built-in defaults. Zones, pages, notifications and check parameters are edited in the admin
// console (/admin → Settings) and stored in D1; these values apply until the first save there.
import type { Settings } from './shared/settings'

export const DEFAULT_SETTINGS: Settings = {
  site: {
    title: { en: 'Sealos Status', zh: 'Sealos 服务状态' },
    url: '',
    timezone: 'UTC',
    language: 'en',
  },
  // Every zone serves these on `<app>.<zone domain>`. Paths point at the final page: the roots of
  // App Launchpad and Database answer 404, their real pages are /apps and /dbs.
  apps: [
    { id: 'console', name: { en: 'Console', zh: '控制台' }, url: 'https://{domain}/' },
    { id: 'applaunchpad', name: { en: 'App Launchpad', zh: '应用管理' }, url: 'https://applaunchpad.{domain}/apps' },
    { id: 'dbprovider', name: { en: 'Database', zh: '数据库' }, url: 'https://dbprovider.{domain}/dbs' },
    { id: 'devbox', name: { en: 'DevBox', zh: 'DevBox' }, url: 'https://devbox.{domain}/en' },
    { id: 'template', name: { en: 'App Store', zh: '应用商店' }, url: 'https://template.{domain}/' },
    { id: 'objectstorage', name: { en: 'Object Storage', zh: '对象存储' }, url: 'https://objectstorage.{domain}/' },
    { id: 'costcenter', name: { en: 'Cost Center', zh: '费用中心' }, url: 'https://costcenter.{domain}/' },
    { id: 'cronjob', name: { en: 'Cron Jobs', zh: '定时任务' }, url: 'https://cronjob.{domain}/jobs' },
    { id: 'terminal', name: { en: 'Terminal', zh: '终端' }, url: 'https://terminal.{domain}/' },
    { id: 'aiproxy', name: { en: 'AI Proxy', zh: 'AI Proxy' }, url: 'https://aiproxy-web.{domain}/zh/home' },
  ],
  zones: [
    {
      id: 'bja',
      domain: 'bja.sealos.run',
      name: { en: 'Beijing A', zh: '北京 A' },
      location: { en: 'Beijing, China', zh: '中国 · 北京' },
      country: 'CN',
      probe: 'apac',
      exclude: [],
      extra: [],
    },
    {
      id: 'hzh',
      domain: 'hzh.sealos.run',
      name: { en: 'Hangzhou', zh: '杭州' },
      location: { en: 'Hangzhou, China', zh: '中国 · 杭州' },
      country: 'CN',
      probe: 'apac',
      exclude: [],
      extra: [],
    },
    {
      id: 'gzg',
      domain: 'gzg.sealos.run',
      name: { en: 'Guangzhou', zh: '广州' },
      location: { en: 'Guangzhou, China', zh: '中国 · 广州' },
      country: 'CN',
      probe: 'apac',
      exclude: [],
      extra: [],
    },
    {
      id: 'cloud',
      domain: 'cloud.sealos.io',
      name: { en: 'Singapore', zh: '新加坡' },
      location: { en: 'Singapore', zh: '新加坡' },
      country: 'SG',
      probe: 'apac',
      // Singapore has no AI Proxy.
      exclude: ['aiproxy'],
      extra: [],
    },
    {
      id: 'usw-1',
      domain: 'usw-1.sealos.io',
      name: { en: 'US West 1', zh: '美西 1' },
      location: { en: 'Los Angeles, US', zh: '美国 · 洛杉矶' },
      country: 'US',
      probe: 'wnam',
      exclude: [],
      extra: [{ id: 'brain', name: { en: 'Brain', zh: 'Brain' }, url: 'https://brain.usw-1.sealos.io/', keyword: '' }],
    },
  ],
  notify: { webhookUrl: '', webhookSecret: '', graceMinutes: 3 },
  email: { resendApiKey: '', from: '' },
  probe: { timeoutMs: 10_000, degradedMs: 5_000 },
}

// Fixed parameters (changing them would reshape stored history).

export const HISTORY_DAYS = 90
/** A page without a check for this long is shown as "no data". */
export const STALE_SECONDS = 10 * 60
export const USER_AGENT = 'Stratus/1.0 (+https://github.com/sealos-tech/stratus)'
/** Subscriber notifications delivered per minute. */
export const OUTBOX_BATCH = 30
export const LIMITS = { zones: 30, pagesPerZone: 50 }

export const retention = {
  // Per-minute detail (day view) is kept this many days, daily totals this many.
  minuteDays: 90,
  dailyDays: 400,
}
