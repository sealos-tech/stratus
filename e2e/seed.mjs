// Prepares the E2E database: fresh state dir, migrations, and 89 days of history for the test
// zones (a few days with failed minutes, so bars, tooltips and uptime have something to show).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const STATE = 'e2e/.state'
const CONFIG = 'e2e/wrangler.jsonc'
const TZ = 'UTC'

rmSync(STATE, { recursive: true, force: true })
mkdirSync(STATE, { recursive: true })
const wrangler = (...args) => execFileSync('npx', ['wrangler', 'd1', ...args, '--local', '--config', CONFIG, '--persist-to', STATE], { stdio: 'inherit' })
wrangler('migrations', 'apply', 'DB')

// Admin settings, as if saved in the console: two test zones whose pages are served by
// e2e/mock-server.mjs, the team webhook pointing at the mock, a 2-minute grace period.
const page = (id, name) => ({ id, name: { en: name, zh: name }, url: `http://127.0.0.1:5199/page/${id}`, keyword: '' })
const settings = {
  site: { title: { en: 'Acme Status', zh: 'Acme 状态' }, url: 'http://localhost:5174', timezone: TZ, language: 'en' },
  apps: [],
  zones: [
    { id: 'e2e-a', domain: 'e2e-a.test', name: { en: 'Zone A', zh: 'A 区' }, location: { en: 'Tokyo', zh: '东京' }, country: 'JP', probe: 'apac', exclude: [], extra: [page('alpha', 'Alpha'), page('beta', 'Beta')] },
    { id: 'e2e-b', domain: 'e2e-b.test', name: { en: 'Zone B', zh: 'B 区' }, location: { en: 'Oregon', zh: '俄勒冈' }, country: 'US', probe: 'wnam', exclude: [], extra: [page('gamma', 'Gamma')] },
  ],
  notify: { webhookUrl: 'http://127.0.0.1:5199/hook/team', webhookSecret: '', graceMinutes: 2 },
  email: { resendApiKey: '', from: '' },
  probe: { timeoutMs: 10000, degradedMs: 5000 },
}

const dayKey = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts))
// Deterministic pseudo-random numbers so every run renders the same history.
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

// Failed-minute ranges per page: [days ago, first minute, last minute].
const FAILURES = {
  'e2e-a/alpha': [[12, 600, 640]],
  'e2e-a/beta': [[40, 120, 150], [5, 900, 1100]],
  'e2e-b/gamma': [[25, 300, 330], [3, 60, 66]],
}
const SLOW = { 'e2e-b/gamma': [[60, 700, 760]] }

const rows = []
for (const page of ['e2e-a/alpha', 'e2e-a/beta', 'e2e-b/gamma']) {
  const [zone, monitor] = page.split('/')
  for (let ago = 89; ago >= 1; ago--) {
    const day = dayKey(Date.now() - ago * 86400_000)
    let minutes = ''
    let latencies = ''
    const c = { u: 0, d: 0, x: 0 }
    let sum = 0
    let count = 0
    let min = Infinity
    let max = 0
    for (let i = 0; i < 1440; i++) {
      const failed = (FAILURES[page] ?? []).some(([a, f, l]) => a === ago && i >= f && i <= l)
      const slow = (SLOW[page] ?? []).some(([a, f, l]) => a === ago && i >= f && i <= l)
      const code = failed ? 'x' : slow ? 'd' : 'u'
      const lat = failed ? 10000 : slow ? 6000 + Math.round(rand() * 800) : 160 + Math.round(rand() * 140 + (monitor === 'gamma' ? 600 : 0))
      minutes += code
      latencies += lat.toString(16).padStart(4, '0')
      c[code]++
      if (!failed) {
        sum += lat
        count++
        min = Math.min(min, lat)
        max = Math.max(max, lat)
      }
    }
    rows.push(
      `INSERT INTO daily VALUES ('${zone}','${monitor}','${day}',${c.u},${c.d},${c.x},0,${sum},${count},${min},${max},'${minutes}','${latencies}');`
    )
  }
}

// Matching outage records for the failure ranges (announced, so they appear in history).
const dayStartMs = (ago) => {
  const key = dayKey(Date.now() - ago * 86400_000)
  const utc = Date.parse(`${key}T00:00:00Z`)
  return utc // TZ is UTC
}
for (const [page, ranges] of Object.entries(FAILURES)) {
  const [zone, monitor] = page.split('/')
  for (const [ago, f, l] of ranges) {
    const start = Math.floor(dayStartMs(ago) / 1000) + f * 60
    const end = Math.floor(dayStartMs(ago) / 1000) + (l + 1) * 60
    const errors = JSON.stringify([[start, 'HTTP 503']])
    rows.push(`INSERT INTO outages (zone, monitor, start_ts, end_ts, error, errors, notified) VALUES ('${zone}','${monitor}',${start},${end},'HTTP 503','${errors}',1);`)
  }
}

rows.push(`INSERT INTO kv (key, value) VALUES ('settings', '${JSON.stringify(settings).replaceAll("'", "''")}');`)

writeFileSync(`${STATE}/seed.sql`, rows.join('\n'))
wrangler('execute', 'DB', '--file', `${STATE}/seed.sql`)
console.log(`seeded ${rows.length} rows`)
