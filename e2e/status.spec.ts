// End-to-end: real Worker (workerd via Vite), real probes against e2e/mock-server.mjs, local D1.
// Cron rounds are fired through /cdn-cgi/local/scheduled with explicit minutes, so detection,
// grace period, notifications and recovery run exactly as in production.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const MOCK = 'http://127.0.0.1:5199'
const TOKEN = 'e2e-admin-token-0123456789'
const AUTH = { authorization: `Bearer ${TOKEN}` }
const SHOTS = 'e2e/screenshots'
mkdirSync(SHOTS, { recursive: true })

let minute = Math.floor(Date.now() / 60000) * 60 // simulated clock (UNIX seconds), one round per minute

async function round(request: APIRequestContext) {
  minute += 60
  const res = await request.get(`/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time=${minute * 1000}&format=json`)
  expect(res.ok(), await res.text()).toBeTruthy()
}

async function setDown(request: APIRequestContext, ids: string[]) {
  await request.post(`${MOCK}/control`, { data: { down: ids } })
}

interface Hook {
  name: string
  body: any
}
async function hooks(request: APIRequestContext, name?: string): Promise<Hook[]> {
  const all = (await (await request.get(`${MOCK}/hooks`)).json()) as Hook[]
  return name ? all.filter((h) => h.name === name) : all
}
const clearHooks = (request: APIRequestContext) => request.delete(`${MOCK}/hooks`)

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

// The team webhook is a plain URL, so it receives the generic JSON payload.
const title = (h: Hook) => h.body?.title as string
const text = (h: Hook) => h.body?.text as string

test.describe.serial('Stratus', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('init')) {
        localStorage.setItem('lang', 'en')
        localStorage.removeItem('expandedZones')
        sessionStorage.setItem('init', '1')
      }
    })
  })

  test('first round: every page up, page shows fully operational', async ({ page, request }) => {
    await setDown(request, [])
    await clearHooks(request)
    await round(request)

    const summary = await (await request.get('/api/summary')).json()
    expect(summary.zones.map((z: any) => z.id)).toEqual(['e2e-a', 'e2e-b'])
    for (const z of summary.zones) for (const m of z.monitors) expect(m.status, `${z.id}/${m.id}`).toBe('up')
    expect(summary.days).toHaveLength(90)

    await page.goto('/')
    const banner = page.getByTestId('status-banner')
    await expect(banner).toHaveAttribute('data-severity', 'up')
    await expect(banner).toContainText('We’re fully operational')
    await expect(page.getByTestId('zone')).toHaveCount(2)
    await expect(page.locator('[data-zone="e2e-a"] [data-testid="zone-uptime"]')).toContainText('% uptime')
    expect(await hooks(request)).toHaveLength(0) // no outage, nothing sent
    await shot(page, '01-home-operational')
  })

  test('zone expands to its pages; day bar tooltip and minute detail', async ({ page }) => {
    await page.goto('/')
    const zone = page.locator('[data-zone="e2e-a"]')
    await zone.getByTestId('zone-toggle').click()
    await expect(zone.getByTestId('monitor-row')).toHaveCount(2)
    await expect(zone).toContainText('Alpha')
    await expect(zone).toContainText('Beta')

    // Beta failed 5 days ago (seed): hover that bar.
    const beta = zone.locator('[data-monitor="beta"]')
    const failedBar = beta.locator('rect[data-severity="major"], rect[data-severity="partial"]').last()
    await failedBar.hover()
    const tip = page.getByTestId('bar-tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Detected automatically')
    await expect(tip).toContainText('down')
    await shot(page, '02-zone-expanded-tooltip', false)

    // Clicking the page name opens its detail page; clicking a bar there opens the minute view.
    await beta.getByRole('link', { name: 'Beta' }).click()
    await expect(page).toHaveURL(/\/monitors\/e2e-a\/beta$/)
    await expect(page.getByTestId('range-uptime')).toContainText('% uptime')
    await expect(page.getByTestId('latency-chart').locator('svg')).toBeVisible()
    // Timeouts of failed checks are not response times: the max stays far below 10 s.
    await expect(page.getByText(/Min \/ avg \/ max/)).not.toContainText('10.00 s')
    await shot(page, '03-monitor-detail')

    await page.locator('rect[data-severity="major"], rect[data-severity="partial"]').last().click()
    const dialog = page.getByTestId('day-detail')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('minute-grid')).toBeVisible()
    // 201 failed minutes of 1440 → 86.04% (floored to 2 decimals).
    await expect(dialog.getByTestId('day-uptime')).toHaveText('86.04%')
    await shot(page, '04-day-detail', false)
  })

  test('outage: detected, announced to the team after the grace period, then recovery', async ({ page, request }) => {
    await clearHooks(request)
    await setDown(request, ['beta'])

    await round(request) // minute 0: outage opens, still inside the 2-minute grace period
    let summary = await (await request.get('/api/summary')).json()
    expect(summary.ongoingOutages).toHaveLength(1)
    expect(summary.ongoingOutages[0]).toMatchObject({ zone: 'e2e-a', monitor: 'beta', error: 'HTTP 503' })
    expect(await hooks(request, 'team')).toHaveLength(0)

    await round(request) // minute 1: still quiet
    expect(await hooks(request, 'team')).toHaveLength(0)

    await round(request) // minute 2: grace period reached → one message
    const down = await hooks(request, 'team')
    expect(down).toHaveLength(1)
    expect(title(down[0])).toBe('Acme Status: 1 page down')
    expect(text(down[0])).toContain('Zone A · Beta')
    expect(text(down[0])).toContain('HTTP 503')
    expect(down[0].body.notice.items[0]).toMatchObject({ kind: 'down', zone: 'e2e-a' })

    await page.goto('/')
    const banner = page.getByTestId('status-banner')
    await expect(banner).toHaveAttribute('data-severity', 'partial') // 1 of 3 pages down
    await expect(page.getByTestId('ongoing-outage')).toContainText('Zone A · Beta')
    await expect(page.locator('[data-zone="e2e-a"]')).toHaveAttribute('data-severity', 'major') // 1 of 2 pages in the zone
    await expect(page.locator('[data-zone="e2e-b"]')).toHaveAttribute('data-severity', 'up')
    await shot(page, '05-outage-banner')

    await round(request) // minute 3: no repeat while it stays down with the same error
    expect(await hooks(request, 'team')).toHaveLength(1)

    await setDown(request, [])
    await round(request) // recovery
    const all = await hooks(request, 'team')
    expect(all).toHaveLength(2)
    expect(title(all[1])).toBe('Acme Status: pages recovered')
    expect(text(all[1])).toContain('Zone A · Beta recovered after')
    summary = await (await request.get('/api/summary')).json()
    expect(summary.ongoingOutages).toHaveLength(0)

    await page.reload()
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-severity', 'up')
  })

  test('a blip shorter than the grace period sends nothing', async ({ request }) => {
    await clearHooks(request)
    await setDown(request, ['gamma'])
    await round(request)
    await setDown(request, [])
    await round(request)
    expect(await hooks(request, 'team')).toHaveLength(0)
  })

  test('public subscription with a webhook, filtered by zone', async ({ page, request }) => {
    await clearHooks(request)
    await page.goto('/')
    await page.getByTestId('subscribe-button').click()
    const dialog = page.getByTestId('subscribe-dialog')
    await expect(dialog).toBeVisible()
    await shot(page, '06-subscribe-dialog', false)
    await dialog.getByTestId('subscribe-webhook-tab').click()
    await dialog.getByTestId('subscribe-target').fill(`${MOCK}/hook/subscriber`)
    await dialog.getByRole('button', { name: 'Zone A' }).click()
    await dialog.getByTestId('subscribe-submit').click()
    await expect(page.getByTestId('subscribe-done')).toContainText('Subscribed')

    // Subscribing sends a test message straight away.
    const test1 = await hooks(request, 'subscriber')
    expect(test1).toHaveLength(1)
    expect(test1[0].body.notice.type).toBe('test')

    // An invalid URL is rejected with a readable error.
    await page.getByRole('button', { name: 'OK' }).click()
    await page.getByTestId('subscribe-button').click()
    await dialog.getByTestId('subscribe-webhook-tab').click()
    await dialog.getByTestId('subscribe-target').fill('http://example.com/hook')
    await dialog.getByTestId('subscribe-submit').click()
    await expect(page.getByTestId('subscribe-error')).toContainText('https')

    // Outage in zone B: the zone-A subscriber hears nothing.
    await clearHooks(request)
    await setDown(request, ['gamma'])
    for (let i = 0; i < 3; i++) await round(request)
    expect(await hooks(request, 'team')).toHaveLength(1)
    expect(await hooks(request, 'subscriber')).toHaveLength(0)
    await setDown(request, [])
    await round(request)

    // Outage in zone A: the subscriber gets it from the outbox in the same round.
    await clearHooks(request)
    await setDown(request, ['alpha'])
    for (let i = 0; i < 3; i++) await round(request)
    const sub = await hooks(request, 'subscriber')
    expect(sub).toHaveLength(1)
    expect(sub[0].body.notice.type).toBe('outages')
    expect(sub[0].body.notice.items[0]).toMatchObject({ kind: 'down', zone: 'e2e-a' })
    expect(sub[0].body.text).toContain('Alpha')
    await setDown(request, [])
    await round(request)
    expect(await hooks(request, 'subscriber')).toHaveLength(2) // recovery
  })

  test('admin: publish an incident, post updates, resolve', async ({ page, request }) => {
    await clearHooks(request)
    // Without the link's p the console does not open; with it, p leaves the address bar.
    await page.goto('/admin')
    await expect(page.getByTestId('admin-denied')).toContainText('/admin?p=')
    await page.goto(`/admin?p=${TOKEN}`)
    await expect(page).toHaveURL(/\/admin$/)

    const form = page.getByTestId('event-form')
    await expect(form).toBeVisible()
    await form.getByTestId('event-title').fill('Slow sign-in in Zone A')
    await form.getByTestId('event-impact').selectOption('degraded')
    await form.getByTestId('zone-check-e2e-a').check()
    await form.getByTestId('event-body').fill('Some users wait more than 10 seconds to sign in. We are investigating.')
    await shot(page, '07-admin-publish')
    await form.getByTestId('event-submit').click()
    await expect(page.getByTestId('admin-flash')).toContainText('Published')
    await expect(page.getByTestId('admin-event')).toHaveCount(1)

    // The team webhook and the zone-A subscriber both got it.
    const f = await hooks(request, 'team')
    expect(f).toHaveLength(1)
    expect(title(f[0])).toBe('[Incident · Investigating] Slow sign-in in Zone A')
    expect(f[0].body.url).toMatch(/\/incidents\/\d+$/)
    const s = await hooks(request, 'subscriber')
    expect(s).toHaveLength(1)
    expect(s[0].body.notice.event.title).toBe('Slow sign-in in Zone A')

    // Public page shows it.
    await page.goto('/')
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-severity', 'degraded')
    await expect(page.getByTestId('active-issues')).toContainText('Slow sign-in in Zone A')
    await shot(page, '08-home-with-incident')

    await page.getByTestId('active-issues').getByRole('link', { name: /Slow sign-in/ }).click()
    await expect(page.getByTestId('incident')).toHaveAttribute('data-status', 'investigating')

    // Post "identified", then "resolved".
    await page.goto('/admin')
    for (const [status, body] of [
      ['identified', 'The sign-in service ran out of database connections. We are adding capacity.'],
      ['resolved', 'Capacity was added and sign-in is back to normal.'],
    ]) {
      await page.getByTestId('event-update').click()
      const u = page.getByTestId('update-form')
      await u.getByTestId('update-status').selectOption(status)
      await u.getByTestId('update-body').fill(body)
      await u.getByTestId('update-submit').click()
      await expect(page.getByTestId('admin-flash')).toContainText('Updated')
    }
    expect((await hooks(request, 'team')).map(title)).toEqual([
      '[Incident · Investigating] Slow sign-in in Zone A',
      '[Incident · Identified] Slow sign-in in Zone A',
      '[Incident · Resolved] Slow sign-in in Zone A',
    ])

    const id = (await (await request.get('/api/summary')).json()).events[0].id
    await page.goto(`/incidents/${id}`)
    await expect(page.getByTestId('incident')).toHaveAttribute('data-status', 'resolved')
    await expect(page.getByTestId('incident-update')).toHaveCount(3)
    await shot(page, '09-incident-page')

    await page.goto('/')
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-severity', 'up')
  })

  test('maintenance: failed checks during the window count as maintenance, not outage', async ({ page, request }) => {
    await clearHooks(request)
    const res = await request.post('/api/admin/events', {
      headers: AUTH,
      data: {
        kind: 'maintenance',
        title: 'Database upgrade in Zone B',
        impact: 'maintenance',
        status: 'scheduled',
        body: 'Gamma may be briefly unavailable during the upgrade.',
        components: [{ zone: 'e2e-b' }],
        // The simulated clock runs ahead of wall time: the window must cover both.
        startsAt: Math.floor(Date.now() / 1000) - 600,
        endsAt: minute + 3600 * 3,
        notify: true,
      },
    })
    expect(res.status()).toBe(201)
    expect((await res.json()).status).toBe('in_progress')
    expect(title((await hooks(request, 'team'))[0])).toBe('[Maintenance · In progress] Database upgrade in Zone B')

    await setDown(request, ['gamma'])
    for (let i = 0; i < 3; i++) await round(request)
    const summary = await (await request.get('/api/summary')).json()
    expect(summary.ongoingOutages).toHaveLength(0)
    expect(summary.zones[1].monitors[0].status).toBe('maintenance')
    expect((await hooks(request, 'team')).filter((h) => title(h).includes('down'))).toHaveLength(0)

    await page.goto('/')
    await expect(page.getByTestId('status-banner')).toHaveAttribute('data-severity', 'maintenance')
    await expect(page.locator('[data-zone="e2e-b"]')).toHaveAttribute('data-severity', 'maintenance')
    await shot(page, '10-maintenance')
    await setDown(request, [])
    await round(request)
  })

  test('history lists published events and announced outages by month', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('view-history').click()
    await expect(page).toHaveURL(/\/history$/)
    await expect(page.getByTestId('history-month').first()).toBeVisible()
    await expect(page.getByTestId('history-item').filter({ hasText: 'Slow sign-in in Zone A' })).toHaveCount(1)
    await expect(page.getByTestId('history-item').filter({ hasText: 'Zone A · Beta' }).first()).toBeVisible()
    await shot(page, '11-history')
  })

  test('second language, dark mode and phone layout', async ({ page, browser }) => {
    await page.goto('/')
    // The maintenance of the previous test is still running.
    await expect(page.getByTestId('status-banner')).toContainText('Scheduled maintenance in progress')
    await page.getByTestId('lang-toggle').click()
    await expect(page.getByTestId('system-status')).toContainText('系统状态')
    await page.getByTestId('lang-toggle').click()
    await expect(page.getByTestId('system-status')).toContainText('System status')
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.locator('[data-zone="e2e-a"] [data-testid="zone-toggle"]').click()
    await shot(page, '12-dark')

    // A browser in an unsupported language gets the site's default language (English).
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'fr-FR' })
    await phone.goto('/')
    await expect(phone.getByTestId('system-status')).toContainText('System status')
    await expect(phone.getByTestId('zone')).toHaveCount(2)
    await shot(phone, '13-mobile')
    await phone.close()
  })

  test('settings: add a zone in the console, check it, save, and it is monitored', async ({ page, request }) => {
    await page.goto(`/admin?p=${TOKEN}`)
    await page.getByTestId('admin-tab-settings').click()
    const settings = page.getByTestId('settings')
    await expect(settings.getByTestId('settings-zone')).toHaveCount(2)
    // Secrets never come back to the browser: the webhook field only shows a masked hint.
    await expect(settings.getByTestId('secret-notify.webhookUrl')).toHaveValue('')
    await expect(settings.getByTestId('secret-notify.webhookUrl')).toHaveAttribute('placeholder', /127\.0\.0\.1:5199\/…/)
    await shot(page, '14-settings')

    await settings.getByTestId('add-zone').click()
    const zone = settings.getByTestId('settings-zone').last()
    await zone.getByTestId('zone-domain').fill('e2e-c.test')
    await zone.getByTestId('zone-domain').blur()
    await zone.getByTestId('zone-name-en').fill('Zone C')
    await zone.getByTestId('add-page').click()
    await zone.locator('input[placeholder="English name"]').fill('Delta')
    await zone.locator('input[placeholder="English name"]').blur()
    await zone.getByTestId('extra-url').fill('http://127.0.0.1:5199/page/delta')
    await expect(zone).toContainText('e2e-c')

    // "Check now" runs the unsaved zone right away.
    await zone.getByTestId('probe-zone').click()
    await expect(zone.getByTestId('probe-results').locator('[data-ok="true"]')).toHaveCount(1)
    await shot(page, '15-settings-new-zone')

    await page.getByTestId('save-settings').click()
    await expect(page.getByTestId('settings-message')).toContainText('Saved')

    // Invalid input is refused with a readable message.
    await zone.getByTestId('zone-domain').fill('not a domain')
    await page.getByTestId('save-settings').click()
    await expect(page.getByTestId('settings-message')).toContainText('not a valid domain')

    // The next round monitors the new zone; the status page shows it.
    await round(request)
    const summary = await (await request.get('/api/summary')).json()
    expect(summary.zones.map((z: any) => z.id)).toEqual(['e2e-a', 'e2e-b', 'e2e-c'])
    expect(summary.zones[2].monitors[0]).toMatchObject({ id: 'delta', status: 'up' })
    await page.goto('/')
    await expect(page.locator('[data-zone="e2e-c"]')).toContainText('Zone C')
  })

  test('settings: grace period and team webhook are taken from the saved settings', async ({ request }) => {
    const get = await request.get('/api/admin/settings', { headers: AUTH })
    const { settings } = await get.json()
    const put = await request.put('/api/admin/settings', {
      headers: AUTH,
      // webhookUrl null = keep the stored secret; grace period 0 = notify at once.
      data: { ...settings, notify: { ...settings.notify, webhookUrl: null, webhookSecret: null, graceMinutes: 0 }, email: { ...settings.email, resendApiKey: null } },
    })
    expect(put.ok(), await put.text()).toBeTruthy()
    await clearHooks(request)
    await setDown(request, ['delta'])
    await round(request)
    const f = await hooks(request, 'team')
    expect(f).toHaveLength(1) // announced in the first round, still to the stored webhook URL
    expect(text(f[0])).toContain('Zone C · Delta')
    await setDown(request, [])
    await round(request)
  })

  test('a Feishu/Lark bot URL gets a signed interactive card', async ({ request }) => {
    // The mock answers on 127.0.0.1, so point a Lark-looking host at it through the test endpoint
    // with an explicit secret: the card shape and signature are what matter here.
    const res = await request.post('/api/admin/test-notification', {
      headers: AUTH,
      data: { url: `${MOCK}/hook/lark`, flavor: 'feishu', secret: 'test-secret' },
    })
    expect((await res.json()).ok).toBe(true)
    const [card] = await hooks(request, 'lark')
    expect(card.body.msg_type).toBe('interactive')
    expect(card.body.card.header.title.content).toBe('Acme Status: test notification')
    expect(card.body.timestamp).toMatch(/^\d+$/)
    expect(card.body.sign).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  test('README screenshots', async ({ browser }) => {
    mkdirSync('docs/screenshots', { recursive: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'en-US' })
    await page.addInitScript(() => {
      localStorage.setItem('lang', 'en')
      localStorage.setItem('theme', 'light')
      localStorage.removeItem('expandedZones')
    })
    await page.goto('/')
    await expect(page.getByTestId('zone')).toHaveCount(3)
    await page.screenshot({ path: 'docs/screenshots/home.png' })
    await page.locator('[data-zone="e2e-a"] [data-testid="zone-toggle"]').click()
    await page.locator('[data-zone="e2e-a"] [data-monitor="beta"] rect[data-severity="major"], [data-zone="e2e-a"] [data-monitor="beta"] rect[data-severity="partial"]').last().hover()
    await expect(page.getByTestId('bar-tooltip')).toBeVisible()
    await page.screenshot({ path: 'docs/screenshots/zone-expanded.png' })
    await page.goto(`/admin?p=${TOKEN}#settings`)
    await page.locator('[data-zone="e2e-c"] [data-testid="settings-zone-toggle"]').click()
    await expect(page.locator('[data-zone="e2e-c"] [data-testid="zone-domain"]')).toBeVisible()
    await page.screenshot({ path: 'docs/screenshots/admin-settings.png' })
    await page.close()
  })

  test('admin API rejects bad input', async ({ request }) => {
    const bad = await request.post('/api/admin/events', {
      headers: AUTH,
      data: { kind: 'incident', title: '', body: 'x', impact: 'major', status: 'investigating', components: [] },
    })
    expect(bad.status()).toBe(400)
    expect((await bad.json()).error).toContain('title')
  })

  test('30 wrong tokens from one IP lock it out, even with the right token', async ({ page, request }) => {
    const ip = { 'cf-connecting-ip': '203.0.113.7' }
    for (let i = 1; i < 30; i++) {
      const r = await request.get('/api/admin/overview', { headers: { ...ip, authorization: `Bearer guess-${i}` } })
      expect(r.status(), `attempt ${i}`).toBe(401)
    }
    const thirtieth = await request.get('/api/admin/overview', { headers: { ...ip, authorization: 'Bearer guess-30' } })
    expect(thirtieth.status()).toBe(429)
    expect(Number(thirtieth.headers()['retry-after'])).toBeGreaterThan(3000)
    const right = await request.get('/api/admin/overview', { headers: { ...ip, ...AUTH } })
    expect(right.status()).toBe(429)
    // Other IPs are not affected.
    expect((await request.get('/api/admin/overview', { headers: { 'cf-connecting-ip': '198.51.100.9', ...AUTH } })).status()).toBe(200)

    // A successful login resets the count of an IP below the limit.
    const other = { 'cf-connecting-ip': '198.51.100.10' }
    for (let i = 0; i < 20; i++) await request.get('/api/admin/overview', { headers: { ...other, authorization: 'Bearer nope' } })
    expect((await request.get('/api/admin/overview', { headers: { ...other, ...AUTH } })).status()).toBe(200)
    for (let i = 0; i < 20; i++) {
      expect((await request.get('/api/admin/overview', { headers: { ...other, authorization: 'Bearer nope' } })).status()).toBe(401)
    }

    // The locked-out page explains itself.
    await page.route('**/api/admin/**', (route) => route.continue({ headers: { ...route.request().headers(), ...ip } }))
    await page.goto(`/admin?p=${TOKEN}`)
    await expect(page.getByTestId('admin-denied')).toContainText('Too many failed attempts')
    await shot(page, '16-admin-locked', false)
  })
})
