<script lang="ts">
  // Admin console: publish incidents and maintenances, post updates, manage subscribers and notifications.
  import { ApiError, adminApi, adminToken } from '$lib/api'
  import StatusIcon from '$lib/components/StatusIcon.svelte'
  import AdminSettings from './AdminSettings.svelte'
  import { fmtDateTime, fmtDuration, i18n, loc } from '$lib/i18n.svelte'
  import { link, monitorHref } from '$lib/router.svelte'
  import { IMPACT_LABEL, STATUS_LABEL } from '$shared/labels'
  import {
    INCIDENT_IMPACTS,
    INCIDENT_STATUSES,
    MAINTENANCE_STATUSES,
    type ApiAdminOverview,
    type ApiEvent,
    type ComponentRef,
    type EventKind,
    type EventStatus,
    type Impact,
  } from '$shared/types'

  let { now }: { now: number } = $props()
  const L = (en: string, zh: string) => (i18n.lang === 'en' ? en : zh)

  adminToken.takeFromUrl()
  let token = $state(adminToken.get())
  let data = $state<ApiAdminOverview | null>(null)
  let error = $state<{ status: number; text: string; retryMinutes?: number } | null>(null)
  let flash = $state<{ ok: boolean; text: string } | null>(null)
  let tab = $state<'events' | 'subscribers' | 'settings'>(location.hash === '#settings' ? 'settings' : 'events')
  let busy = $state(false)

  async function load() {
    try {
      data = await adminApi.overview()
      error = null
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0
      if (status === 401) {
        adminToken.clear()
        token = ''
      }
      error = { status, text: (e as Error).message, retryMinutes: e instanceof ApiError && e.retryAfter ? Math.ceil(e.retryAfter / 60) : undefined }
    }
  }
  $effect(() => {
    if (token) load()
  })

  function setTab(next: typeof tab) {
    tab = next
    history.replaceState(null, '', next === 'settings' ? '#settings' : location.pathname)
  }

  async function run(action: () => Promise<unknown>, ok: string) {
    busy = true
    flash = null
    try {
      await action()
      flash = { ok: true, text: ok }
      await load()
      return true
    } catch (e) {
      flash = { ok: false, text: (e as Error).message }
      return false
    } finally {
      busy = false
    }
  }

  // ---- New event form ----
  const toLocalInput = (ts: number) => {
    const d = new Date(ts * 1000)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }
  const fromLocalInput = (v: string) => (v ? Math.floor(new Date(v).getTime() / 1000) : undefined)

  let form = $state(blankForm('incident'))
  function blankForm(kind: EventKind) {
    return {
      kind,
      title: '',
      impact: (kind === 'incident' ? 'partial' : 'maintenance') as Impact,
      status: (kind === 'incident' ? 'investigating' : 'scheduled') as EventStatus,
      body: '',
      components: [] as ComponentRef[],
      startsAt: toLocalInput(Math.floor(Date.now() / 1000) + (kind === 'maintenance' ? 86400 : 0)),
      endsAt: kind === 'maintenance' ? toLocalInput(Math.floor(Date.now() / 1000) + 86400 + 7200) : '',
      notify: true,
    }
  }

  const hasZone = (zone: string) => form.components.some((c) => c.zone === zone && !c.monitor)
  const hasPage = (zone: string, monitor: string) => form.components.some((c) => c.zone === zone && c.monitor === monitor)
  function toggleZone(zone: string) {
    form.components = hasZone(zone) ? form.components.filter((c) => c.zone !== zone) : [...form.components.filter((c) => c.zone !== zone), { zone }]
  }
  function togglePage(zone: string, monitor: string) {
    form.components = hasPage(zone, monitor)
      ? form.components.filter((c) => !(c.zone === zone && c.monitor === monitor))
      : [...form.components.filter((c) => !(c.zone === zone && !c.monitor)), { zone, monitor }]
  }
  let expandedZone = $state<string | null>(null)

  async function submitEvent(e: SubmitEvent) {
    e.preventDefault()
    const ok = await run(
      () =>
        adminApi.createEvent({
          kind: form.kind,
          title: form.title,
          impact: form.impact,
          status: form.status,
          body: form.body,
          components: form.components,
          startsAt: fromLocalInput(form.startsAt),
          endsAt: form.kind === 'maintenance' ? (fromLocalInput(form.endsAt) ?? null) : undefined,
          notify: form.notify,
        }),
      L('Published', '已发布')
    )
    if (ok) form = blankForm(form.kind)
  }

  // ---- Update form per event ----
  let updating = $state<{ id: number; status: EventStatus; body: string; notify: boolean } | null>(null)
  function startUpdate(e: ApiEvent) {
    const list = e.kind === 'incident' ? INCIDENT_STATUSES : MAINTENANCE_STATUSES
    const next = list[Math.min(list.indexOf(e.status as never) + 1, list.length - 1)]
    updating = { id: e.id, status: next, body: '', notify: true }
  }
  async function submitUpdate(e: SubmitEvent) {
    e.preventDefault()
    if (!updating) return
    const u = updating
    if (await run(() => adminApi.addUpdate(u.id, { status: u.status, body: u.body, notify: u.notify }), L('Updated', '已更新'))) updating = null
  }

  // ---- Subscribers ----
  let sub = $state({ kind: 'webhook' as 'webhook' | 'email', target: '', zones: [] as string[], auto: true, lang: 'en' as 'en' | 'zh' })
  let testUrl = $state('')

  const componentLabel = (c: ComponentRef[]) => {
    if (!data || c.length === 0) return L('All zones', '全部可用区')
    return c
      .map((x) => {
        const z = data!.zones.find((zz) => zz.id === x.zone)
        const m = z?.monitors.find((mm) => mm.id === x.monitor)
        return m ? `${loc(z?.name)} · ${loc(m.name)}` : loc(z?.name) || x.zone
      })
      .join('、')
  }
  const nameOf = (zone: string, monitor: string) => {
    const z = data?.zones.find((x) => x.id === zone)
    return `${loc(z?.name) || zone} · ${loc(z?.monitors.find((m) => m.id === monitor)?.name) || monitor}`
  }
  const severityOf = (e: ApiEvent) => (e.status === 'resolved' || e.status === 'completed' ? 'up' : e.impact === 'maintenance' ? 'maintenance' : e.impact)

  const input = 'border-input focus:border-foreground/40 h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none'
  const btn = 'h-9 rounded-md px-3 text-sm font-medium transition disabled:opacity-50'
  const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`
  const secondary = `${btn} border border-[#cacace] dark:border-input hover:bg-secondary`
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-secondary'}`
</script>

{#if !token || (error && !data)}
  <!-- No form to guess at: the console only opens from its link. -->
  <div class="status-card mx-auto mt-10 max-w-sm" data-testid="admin-denied">
    <div class="status-card-body flex flex-col gap-2 p-5">
      <h1 class="text-base font-medium">{L('Admin console', '管理后台')}</h1>
      <p class="text-muted-foreground text-sm">
        {#if error?.status === 429}{L(`Too many failed attempts from this IP. Try again in ${error.retryMinutes} minutes.`, `失败次数太多，这个 IP 已被限制 ${error.retryMinutes} 分钟。`)}
        {:else if error?.status === 503}{error.text}
        {:else if error && error.status !== 401}{L('Failed to load: ', '加载失败：')}{error.text}
        {:else}{L('Invalid link. Open the console with its full link (/admin?p=…).', '链接无效或已过期，请使用完整的后台链接（/admin?p=…）打开。')}{/if}
      </p>
    </div>
  </div>
{:else if !data}
  <p class="text-muted-foreground py-10 text-sm">{L('Loading…', '加载中…')}</p>
{:else}
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="bg-secondary flex gap-1 rounded-md p-1 text-sm">
      {#each [['events', L('Incidents', '事件与维护')], ['subscribers', `${L('Subscribers', '订阅者')} (${data.subscribers.length})`], ['settings', L('Settings', '设置')]] as [key, label] (key)}
        <button type="button" class="rounded-[5px] px-3 py-1.5 font-medium {tab === key ? 'bg-card shadow-sm' : 'text-muted-foreground'}" onclick={() => setTab(key as typeof tab)} data-testid="admin-tab-{key}">{label}</button>
      {/each}
    </div>
    <button type="button" class="text-muted-foreground hover:text-foreground text-sm" onclick={() => { adminToken.clear(); token = ''; error = null }}>{L('Sign out', '退出')}</button>
  </div>

  {#if flash}
    <p class="mt-4 rounded-md px-3 py-2 text-sm {flash.ok ? 'bg-up-soft' : 'bg-down-soft'}" data-testid="admin-flash">{flash.text}</p>
  {/if}

  {#if tab === 'events'}
    <!-- Publish -->
    <form class="status-card mt-6" onsubmit={submitEvent} data-testid="event-form">
      <div class="status-card-body">
        <div class="border-border-soft flex items-center justify-between gap-3 border-b px-4 py-3.5">
          <h2 class="text-base font-medium">{L('Publish', '发布')}</h2>
          <div class="bg-secondary flex gap-1 rounded-md p-1 text-sm">
            <button type="button" class="rounded-[5px] px-2.5 py-1 font-medium {form.kind === 'incident' ? 'bg-card shadow-sm' : 'text-muted-foreground'}" onclick={() => (form = blankForm('incident'))}>{L('Incident', '事件')}</button>
            <button type="button" class="rounded-[5px] px-2.5 py-1 font-medium {form.kind === 'maintenance' ? 'bg-card shadow-sm' : 'text-muted-foreground'}" onclick={() => (form = blankForm('maintenance'))} data-testid="kind-maintenance">{L('Maintenance', '计划维护')}</button>
          </div>
        </div>
        <div class="flex flex-col gap-4 p-4">
          <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Title', '标题')}</span>
            <input class={input} bind:value={form.title} required placeholder={form.kind === 'incident' ? L('e.g. App Launchpad unavailable in Hangzhou', '例如：杭州可用区应用管理无法访问') : L('e.g. Database upgrade in Guangzhou', '例如：广州可用区数据库升级')} data-testid="event-title" />
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            {#if form.kind === 'incident'}
              <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Impact', '影响程度')}</span>
                <select class={input} bind:value={form.impact} data-testid="event-impact">
                  {#each INCIDENT_IMPACTS as i (i)}<option value={i}>{IMPACT_LABEL[i][i18n.lang]}</option>{/each}
                </select>
              </label>
              <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Status', '状态')}</span>
                <select class={input} bind:value={form.status}>
                  {#each INCIDENT_STATUSES as s (s)}<option value={s}>{STATUS_LABEL[s][i18n.lang]}</option>{/each}
                </select>
              </label>
            {:else}
              <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Starts', '开始')}</span><input type="datetime-local" class={input} bind:value={form.startsAt} required /></label>
              <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Ends', '结束')}</span><input type="datetime-local" class={input} bind:value={form.endsAt} /></label>
            {/if}
          </div>
          <div class="flex flex-col gap-2 text-sm">
            <span class="font-medium">{L('Affected', '影响范围')} <span class="text-subtle font-normal">· {L('none = every zone; expand to pick pages', '不选 = 全部可用区；点开可只选具体页面')}</span></span>
            <div class="flex flex-col gap-2">
              {#each data.zones as z (z.id)}
                <div class="rounded-md border">
                  <div class="flex items-center gap-2 px-3 py-2">
                    <label class="flex flex-1 items-center gap-2"><input type="checkbox" class="accent-foreground" checked={hasZone(z.id)} onchange={() => toggleZone(z.id)} data-testid="zone-check-{z.id}" />{loc(z.name)} <span class="text-subtle text-xs">{z.domain}</span></label>
                    {#if form.components.some((c) => c.zone === z.id && c.monitor)}<span class="text-xs">{form.components.filter((c) => c.zone === z.id && c.monitor).length} {L('pages', '个页面')}</span>{/if}
                    <button type="button" class="text-muted-foreground text-xs" onclick={() => (expandedZone = expandedZone === z.id ? null : z.id)}>{expandedZone === z.id ? L('Hide', '收起') : L('Pages', '选页面')}</button>
                  </div>
                  {#if expandedZone === z.id}
                    <div class="flex flex-wrap gap-1.5 border-t px-3 py-2">
                      {#each z.monitors as m (m.id)}<button type="button" class={chip(hasPage(z.id, m.id))} onclick={() => togglePage(z.id, m.id)}>{loc(m.name)}</button>{/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
          <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium">{L('Message', '说明')}</span>
            <textarea class="{input} h-28 py-2" bind:value={form.body} required placeholder={L('What is happening and who is affected. You can post updates later.', '对用户说明现状和影响，之后可以继续追加更新。')} data-testid="event-body"></textarea>
          </label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <label class="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" class="accent-foreground" bind:checked={form.notify} />{L('Notify the team and subscribers', '通知团队和订阅者')}</label>
            <button class={primary} disabled={busy} data-testid="event-submit">{L('Publish', '发布')}</button>
          </div>
        </div>
      </div>
    </form>

    <!-- Events list -->
    <section class="status-card mt-6" data-testid="admin-events">
      <div class="status-card-body">
        <h2 class="border-border-soft border-b px-4 py-3.5 text-base font-medium">{L('Last 30 days', '近 30 天')}</h2>
        {#if data.events.length === 0}<p class="text-muted-foreground p-4 text-sm">{L('Nothing published yet.', '还没有发布过事件。')}</p>{/if}
        {#each data.events as e (e.id)}
          <div class="border-border-soft border-b px-4 py-3 last:border-b-0" data-testid="admin-event">
            <div class="flex items-start gap-2">
              <StatusIcon severity={severityOf(e)} class="mt-0.5" />
              <div class="min-w-0 flex-1 text-sm">
                <a href="/incidents/{e.id}" onclick={link} class="font-medium hover:underline">{e.title}</a>
                <p class="text-muted-foreground">{STATUS_LABEL[e.status][i18n.lang]} · {IMPACT_LABEL[e.impact][i18n.lang]} · {componentLabel(e.components)} · {fmtDateTime(e.startsAt, data.timezone)}</p>
              </div>
              <div class="flex shrink-0 gap-2">
                {#if e.status !== 'resolved' && e.status !== 'completed'}<button type="button" class={secondary} onclick={() => startUpdate(e)} data-testid="event-update">{L('Update', '更新')}</button>{/if}
                <button type="button" class="{secondary} text-down" onclick={() => confirm(L('Delete this event?', '删除这条记录？')) && run(() => adminApi.deleteEvent(e.id), L('Deleted', '已删除'))}>{L('Delete', '删除')}</button>
              </div>
            </div>
            {#if updating?.id === e.id}
              <form class="mt-3 flex flex-col gap-3 rounded-md border p-3" onsubmit={submitUpdate} data-testid="update-form">
                <select class={input} bind:value={updating.status} data-testid="update-status">
                  {#each e.kind === 'incident' ? INCIDENT_STATUSES : MAINTENANCE_STATUSES as s (s)}<option value={s}>{STATUS_LABEL[s][i18n.lang]}</option>{/each}
                </select>
                <textarea class="{input} h-20 py-2" bind:value={updating.body} required placeholder={L('Update message', '更新内容')} data-testid="update-body"></textarea>
                <div class="flex items-center justify-between gap-3">
                  <label class="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" class="accent-foreground" bind:checked={updating.notify} />{L('Notify', '通知')}</label>
                  <div class="flex gap-2">
                    <button type="button" class={secondary} onclick={() => (updating = null)}>{L('Cancel', '取消')}</button>
                    <button class={primary} disabled={busy} data-testid="update-submit">{L('Post update', '发布更新')}</button>
                  </div>
                </div>
              </form>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Automatic detections -->
    <section class="status-card mt-6">
      <div class="status-card-body">
        <h2 class="border-border-soft border-b px-4 py-3.5 text-base font-medium">{L('Detected outages (7 days)', '自动检测到的故障（近 7 天）')}</h2>
        {#if data.outages.length === 0}<p class="text-muted-foreground p-4 text-sm">{L('None.', '没有。')}</p>{/if}
        {#each data.outages as o (o.id)}
          <div class="border-border-soft flex items-start gap-2 border-b px-4 py-3 text-sm last:border-b-0">
            <StatusIcon severity={o.end ? 'up' : 'major'} class="mt-0.5" />
            <div class="min-w-0 flex-1">
              <a href={monitorHref(o.zone, o.monitor)} onclick={link} class="font-medium hover:underline">{nameOf(o.zone, o.monitor)}</a>
              <p class="text-muted-foreground">{fmtDateTime(o.start, data.timezone)} · {o.end ? fmtDuration(o.end - o.start) : `${L('ongoing', '进行中')} ${fmtDuration(now - o.start)}`} · <span class="break-all">{o.error}</span></p>
            </div>
            {#if !o.end}
              <button
                type="button"
                class={secondary}
                onclick={() => {
                  form = { ...blankForm('incident'), title: L(`${nameOf(o.zone, o.monitor)} unavailable`, `${nameOf(o.zone, o.monitor)} 无法访问`), components: [{ zone: o.zone, monitor: o.monitor }], body: L('We are investigating failures of this page.', '我们发现该页面无法访问，正在排查。') }
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}>{L('Declare', '转为事件')}</button
              >
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {:else if tab === 'subscribers'}
    <form
      class="status-card mt-6"
      onsubmit={async (e) => {
        e.preventDefault()
        if (await run(() => adminApi.addSubscriber({ ...sub, zones: sub.zones.length ? sub.zones : null }), L('Added', '已添加'))) sub.target = ''
      }}
    >
      <div class="status-card-body flex flex-col gap-3 p-4">
        <h2 class="text-base font-medium">{L('Add subscriber (no confirmation)', '添加订阅（免确认）')}</h2>
        <div class="flex flex-col gap-2 sm:flex-row">
          <select class="{input} sm:w-32" bind:value={sub.kind}><option value="webhook">Webhook</option><option value="email">{L('Email', '邮件')}</option></select>
          <input class={input} bind:value={sub.target} required placeholder={sub.kind === 'webhook' ? 'https://hooks.slack.com/services/…' : 'ops@example.com'} />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class={chip(sub.zones.length === 0)} onclick={() => (sub.zones = [])}>{L('All zones', '全部可用区')}</button>
          {#each data.zones as z (z.id)}<button type="button" class={chip(sub.zones.includes(z.id))} onclick={() => (sub.zones = sub.zones.includes(z.id) ? sub.zones.filter((x) => x !== z.id) : [...sub.zones, z.id])}>{loc(z.name)}</button>{/each}
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="text-muted-foreground flex items-center gap-2 text-sm"><input type="checkbox" class="accent-foreground" bind:checked={sub.auto} />{L('Include automatic detections', '包含自动检测的故障')}</label>
          <button class={primary} disabled={busy}>{L('Add', '添加')}</button>
        </div>
      </div>
    </form>
    <section class="status-card mt-6" data-testid="admin-subscribers">
      <div class="status-card-body">
        <div class="border-border-soft flex items-center justify-between border-b px-4 py-3.5">
          <h2 class="text-base font-medium">{L('Subscribers', '订阅者')}</h2>
          <span class="text-muted-foreground text-sm">{L('Pending', '待发送')} {data.outbox.pending} · {L('Failed', '失败')} {data.outbox.failed} · {L('Sent 24h', '24h 已发送')} {data.outbox.sent24h}</span>
        </div>
        {#if data.subscribers.length === 0}<p class="text-muted-foreground p-4 text-sm">{L('No subscribers yet.', '还没有订阅者。')}</p>{/if}
        {#each data.subscribers as s (s.id)}
          <div class="border-border-soft flex items-start gap-3 border-b px-4 py-3 text-sm last:border-b-0" data-testid="admin-subscriber">
            <span class="bg-secondary shrink-0 rounded px-1.5 py-0.5 text-xs font-medium">{s.kind === 'email' ? L('Email', '邮件') : 'Webhook'}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{s.target}</p>
              <p class="text-muted-foreground">
                {s.zones ? s.zones.map((z) => loc(data?.zones.find((x) => x.id === z)?.name) || z).join('、') : L('All zones', '全部可用区')}
                · {s.auto ? L('with detections', '含自动检测') : L('published only', '仅发布的事件')}
                · {s.verified ? L('verified', '已确认') : L('unverified', '待确认')}
              </p>
              {#if s.lastError}<p class="text-down break-all">{s.lastError}</p>{/if}
            </div>
            <button type="button" class="{secondary} text-down shrink-0" onclick={() => run(() => adminApi.deleteSubscriber(s.id), L('Removed', '已删除'))}>{L('Remove', '删除')}</button>
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <section class="status-card mt-6">
      <div class="status-card-body flex flex-col gap-3 p-4 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="flex items-center gap-1.5"><StatusIcon severity={data.config.team ? 'up' : 'nodata'} />{L('Team webhook', '团队 Webhook')}</span>
          <span class="text-subtle">·</span>
          <span class="flex items-center gap-1.5"><StatusIcon severity={data.config.email ? 'up' : 'nodata'} />{L('Email', '邮件订阅')}</span>
          <span class="text-subtle">·</span>
          <span class="text-muted-foreground">{L('Pending', '待发送')} {data.outbox.pending} · {L('Failed', '失败')} {data.outbox.failed}</span>
          <div class="ml-auto flex flex-wrap gap-2">
            <button type="button" class={secondary} disabled={busy || !data.config.team} onclick={() => run(async () => { const r = await adminApi.testNotification(); if (!r.ok) throw new Error(r.error ?? 'failed') }, L('Test sent to the team webhook', '测试消息已发送到团队 Webhook'))} data-testid="test-team">{L('Send team test', '发送团队测试')}</button>
            {#if data.outbox.failed > 0}<button type="button" class={secondary} disabled={busy} onclick={() => run(() => adminApi.retryOutbox(), L('Retried', '已重试'))}>{L(`Retry ${data.outbox.failed}`, `重试 ${data.outbox.failed} 条失败`)}</button>{/if}
          </div>
        </div>
        <form class="flex flex-col gap-2 sm:flex-row" onsubmit={(e) => { e.preventDefault(); run(async () => { const r = await adminApi.testNotification(testUrl); if (!r.ok) throw new Error(r.error ?? 'failed') }, L('Sent', '已发送')) }}>
          <input class={input} bind:value={testUrl} required placeholder={L('Send a test to any webhook', '给任意 Webhook 发一条测试消息')} />
          <button class="{secondary} shrink-0 whitespace-nowrap" disabled={busy}>{L('Send test', '发送测试')}</button>
        </form>
      </div>
    </section>
    <AdminSettings onSaved={load} />
  {/if}
{/if}
