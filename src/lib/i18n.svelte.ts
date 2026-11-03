import type { Localized } from '$shared/types'
import type { Lang } from '$shared/labels'

export type { Lang }

const messages = {
  en: {
    subscribe: 'Subscribe to updates',
    home: 'Status',
    operational: 'We’re fully operational',
    operationalBody: 'We’re not aware of any issues affecting our systems.',
    degraded: 'Some services are slow',
    partialOutage: 'Partial outage',
    majorOutage: 'Major outage',
    maintenance: 'Scheduled maintenance in progress',
    nodata: 'No status yet',
    nodataBody: 'No check results yet. Status appears here after the first round of checks.',
    issuesBody: 'These pages are failing their checks and we are working on it:',
    systemStatus: 'System status',
    pages: 'pages',
    page: 'page',
    uptime: 'uptime',
    viewHistory: 'View history',
    noIncidents: 'No incidents',
    noData: 'No data available',
    operationalShort: 'Operational',
    degradedShort: 'Slow',
    downShort: 'Outage',
    maintenanceShort: 'Maintenance',
    nodataShort: 'No data',
    detected: 'Detected automatically',
    down: 'down',
    since: 'since',
    lasted: 'lasted',
    ongoing: 'Ongoing',
    history: 'History',
    noIncidentsReported: 'No incidents reported',
    affected: 'Affected components',
    allZones: 'All zones',
    allPages: 'All pages',
    updates: 'Updates',
    backToStatus: 'Back to status page',
    lastChecked: 'Last checked',
    probedFrom: 'Probed from',
    responseTime: 'Response time',
    latestResponse: 'Latest response',
    avgResponse: 'Average response',
    perMinute: 'Per-minute status',
    dayDetail: 'Day detail',
    minAvgMax: 'Min / avg / max',
    openPage: 'Open page',
    upcomingMaintenance: 'Scheduled maintenance',
    activeIncidents: 'Active incidents',
    scheduledFor: 'Scheduled for',
    viewAllUpdates: 'View all updates',
    poweredBy: 'Probes run on Cloudflare Workers every minute',
    footnote: 'Availability is computed from per-minute page checks made from Cloudflare locations. Individual experience may vary with your network.',
    notFound: 'Page not found',
    loadFailed: 'Failed to load',
    retry: 'Retry',
    language: '中文',
    light: 'Light',
    dark: 'Dark',
    subscribeTitle: 'Subscribe to status updates',
    subscribeDesc: 'Get notified about outages and scheduled maintenance.',
    email: 'Email',
    webhook: 'Webhook',
    emailPlaceholder: 'you@example.com',
    webhookPlaceholder: 'https://hooks.slack.com/…',
    webhookHint: 'Slack, Discord, Feishu/Lark, DingTalk and WeCom bots, or any HTTPS endpoint accepting JSON. A test message is sent when you subscribe.',
    zonesToFollow: 'Zones to follow',
    includeAuto: 'Also notify automatically detected outages (not yet confirmed)',
    confirmSent: 'Check your inbox and click the link to confirm.',
    webhookOk: 'Subscribed. A test message was sent to your bot.',
    emailDisabled: 'Email subscriptions are not available yet, please use a webhook.',
    submit: 'Subscribe',
    cancel: 'Cancel',
  },
  zh: {
    subscribe: '订阅更新',
    home: '状态',
    operational: '所有服务运行正常',
    operationalBody: '目前没有发现任何问题。',
    degraded: '部分服务响应缓慢',
    partialOutage: '部分服务中断',
    majorOutage: '服务大面积中断',
    maintenance: '正在进行计划维护',
    nodata: '暂无状态数据',
    nodataBody: '还没有收到探测结果，第一轮检测完成后这里会显示状态。',
    issuesBody: '我们检测到以下页面无法正常访问，正在处理：',
    systemStatus: '系统状态',
    pages: '个页面',
    page: '个页面',
    uptime: '可用率',
    viewHistory: '查看历史',
    noIncidents: '无事件',
    noData: '暂无数据',
    operationalShort: '正常',
    degradedShort: '缓慢',
    downShort: '中断',
    maintenanceShort: '维护',
    nodataShort: '无数据',
    detected: '自动检测',
    down: '不可用',
    since: '自',
    lasted: '持续',
    ongoing: '进行中',
    history: '历史',
    noIncidentsReported: '没有事件记录',
    affected: '受影响范围',
    allZones: '全部可用区',
    allPages: '全部页面',
    updates: '更新记录',
    backToStatus: '返回状态页',
    lastChecked: '最近检测',
    probedFrom: '探测节点',
    responseTime: '响应时间',
    latestResponse: '最新响应',
    avgResponse: '平均响应',
    perMinute: '每分钟状态',
    dayDetail: '当日详情',
    minAvgMax: '最低 / 平均 / 最高',
    openPage: '打开页面',
    upcomingMaintenance: '计划维护',
    activeIncidents: '进行中的事件',
    scheduledFor: '计划时间',
    viewAllUpdates: '查看全部更新',
    poweredBy: '探测运行在 Cloudflare Workers，每分钟检测一次',
    footnote: '可用率按每分钟一次的页面检测计算，包含从全球多个 Cloudflare 节点发起的探测。个别用户的实际体验可能因网络环境而不同。',
    notFound: '找不到这个页面',
    loadFailed: '加载失败',
    retry: '重试',
    language: 'English',
    light: '浅色',
    dark: '深色',
    // Subscribe dialog
    subscribeTitle: '订阅状态更新',
    subscribeDesc: '有故障或计划维护时第一时间通知你。',
    email: '邮件',
    webhook: 'Webhook',
    emailPlaceholder: 'you@example.com',
    webhookPlaceholder: 'https://hooks.slack.com/services/…',
    webhookHint: '支持 Slack、Discord、飞书、钉钉、企业微信机器人，或任意接收 JSON 的 HTTPS 地址。提交时会发送一条测试消息。',
    zonesToFollow: '关注的可用区',
    includeAuto: '同时接收自动检测到的故障（未人工确认）',
    confirmSent: '确认邮件已发送，请到邮箱点击链接完成订阅。',
    webhookOk: '订阅成功，测试消息已发送到你的机器人。',
    emailDisabled: '邮件订阅暂未开放，请使用 Webhook。',
    submit: '订阅',
    cancel: '取消',
  },
} satisfies Record<Lang, Record<string, string>>

export type MessageKey = keyof (typeof messages)['en']

/** Default for visitors whose browser language is not supported; set from the site settings. */
let siteLanguage: Lang = 'en'

function initialLang(): Lang {
  const stored = localStorage.getItem('lang')
  if (stored === 'zh' || stored === 'en') return stored
  return detectLang()
}

function detectLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const tag = l.toLowerCase()
    if (tag.startsWith('en')) return 'en'
    if (tag.startsWith('zh')) return 'zh'
  }
  return siteLanguage
}

/** Applies the site's default language unless the visitor picked one or their browser matches. */
export function setSiteLanguage(lang: Lang) {
  siteLanguage = lang
  if (!localStorage.getItem('lang')) i18n.lang = detectLang()
}

export const i18n = $state({ lang: initialLang() })

export function setLang(lang: Lang) {
  i18n.lang = lang
  localStorage.setItem('lang', lang)
}

export const t = (key: MessageKey): string => messages[i18n.lang][key]

export function loc(text: Localized | undefined): string {
  if (text === undefined) return ''
  return typeof text === 'string' ? text : text[i18n.lang]
}

const locale = () => (i18n.lang === 'en' ? 'en-US' : 'zh-CN')

export function fmtDay(day: string, withWeekday = true): string {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: 'UTC',
    ...(withWeekday ? { weekday: 'short' } : {}),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${day}T00:00:00Z`))
}

export function fmtDateTime(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(), {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts * 1000))
}

export function fmtTime(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000))
}

export function fmtMonth(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat(locale(), { timeZone, year: 'numeric', month: 'long' }).format(new Date(ts * 1000))
}

export function fmtMonthShort(day: string): string {
  return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', year: 'numeric', month: 'short' }).format(new Date(`${day}T00:00:00Z`))
}

export function fmtDuration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  const en = i18n.lang === 'en'
  if (m < 60) return en ? `${m} min` : `${m} 分钟`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h < 48) return en ? (r ? `${h} h ${r} min` : `${h} h`) : r ? `${h} 小时 ${r} 分钟` : `${h} 小时`
  const d = Math.floor(h / 24)
  return en ? `${d} d ${h % 24} h` : `${d} 天 ${h % 24} 小时`
}

export function relative(ts: number, now: number): string {
  const d = now - ts
  const en = i18n.lang === 'en'
  if (d < 60) return en ? 'just now' : '刚刚'
  return en ? `${fmtDuration(d)} ago` : `${fmtDuration(d)}前`
}
