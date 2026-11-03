<script lang="ts">
  // Admin → Settings: zones, pages, notifications and check parameters. Saved to D1; the next
  // monitoring round (within a minute) uses it.
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Plus from '@lucide/svelte/icons/plus'
  import Trash from '@lucide/svelte/icons/trash-2'
  import StatusIcon from '$lib/components/StatusIcon.svelte'
  import { adminApi } from '$lib/api'
  import { i18n } from '$lib/i18n.svelte'
  import { fillDomain, type AdminSettings, type PageSetting, type SecretField, type Settings, type SettingsInput, type ZoneSetting } from '$shared/settings'
  import type { ApiProbeResult } from '$shared/types'

  let { onSaved }: { onSaved: () => void } = $props()
  const L = (en: string, zh: string) => (i18n.lang === 'en' ? en : zh)

  let view = $state<AdminSettings | null>(null)
  let form = $state<Settings | null>(null)
  let savedJson = $state('')
  // New values for secret fields; empty = keep what is stored.
  let secretInput = $state<Record<SecretField, string>>({ 'notify.webhookUrl': '', 'notify.webhookSecret': '', 'email.resendApiKey': '' })
  let clearSecret = $state<Record<SecretField, boolean>>({ 'notify.webhookUrl': false, 'notify.webhookSecret': false, 'email.resendApiKey': false })
  let busy = $state(false)
  let message = $state<{ ok: boolean; text: string } | null>(null)
  let openZone = $state<string | null>(null)
  let probing = $state<string | null>(null)
  let probeResults = $state<Record<string, ApiProbeResult[]>>({})
  let newZoneIds = $state<Set<string>>(new Set())

  async function load() {
    view = await adminApi.getSettings()
    form = JSON.parse(JSON.stringify(view.settings)) as Settings
    savedJson = JSON.stringify(view.settings)
    newZoneIds = new Set()
  }
  $effect(() => {
    load().catch((e: Error) => (message = { ok: false, text: e.message }))
  })

  const dirty = $derived(
    !!form && (JSON.stringify(form) !== savedJson || Object.values(secretInput).some(Boolean) || Object.values(clearSecret).some(Boolean))
  )

  function toInput(): SettingsInput {
    const s = $state.snapshot(form!) as Settings
    const secret = (f: SecretField) => (clearSecret[f] ? '' : secretInput[f].trim() || null)
    return {
      ...s,
      notify: { ...s.notify, webhookUrl: secret('notify.webhookUrl'), webhookSecret: secret('notify.webhookSecret') },
      email: { ...s.email, resendApiKey: secret('email.resendApiKey') },
    }
  }

  async function save() {
    busy = true
    message = null
    try {
      view = await adminApi.saveSettings(toInput())
      form = JSON.parse(JSON.stringify(view.settings)) as Settings
      savedJson = JSON.stringify(view.settings)
      newZoneIds = new Set()
      for (const k of Object.keys(secretInput) as SecretField[]) {
        secretInput[k] = ''
        clearSecret[k] = false
      }
      message = { ok: true, text: L('Saved. The next check round (within a minute) uses it.', '已保存，下一轮检测（1 分钟内）生效。') }
      onSaved()
    } catch (e) {
      message = { ok: false, text: (e as Error).message }
    } finally {
      busy = false
    }
  }

  async function probeZone(id: string) {
    probing = id
    try {
      probeResults[id] = await adminApi.probe(toInput(), id)
    } catch (e) {
      message = { ok: false, text: (e as Error).message }
    } finally {
      probing = null
    }
  }

  // ---- Zones ----
  const slug = (s: string) => s.toLowerCase().split('.')[0].replace(/[^a-z0-9-]/g, '').slice(0, 32) || 'zone'

  function addZone() {
    const id = `zone-${(form!.zones.length + 1).toString()}`
    form!.zones.push({ id, domain: '', name: { en: '', zh: '' }, location: { en: '', zh: '' }, country: '', probe: 'apac', exclude: [], extra: [] })
    newZoneIds = new Set([...newZoneIds, id])
    openZone = id
  }
  function onDomain(zone: ZoneSetting) {
    // A new zone's id follows its domain until saved; saved ids never change (history is keyed by them).
    if (!newZoneIds.has(zone.id)) return
    const next = slug(zone.domain)
    if (form!.zones.some((z) => z !== zone && z.id === next)) return
    newZoneIds.delete(zone.id)
    zone.id = next
    newZoneIds = new Set([...newZoneIds, next])
    openZone = next
  }
  function removeZone(i: number) {
    const z = form!.zones[i]
    if (!newZoneIds.has(z.id) && !confirm(L(`Remove zone "${z.name.en || z.domain}"? Its history stays in the database but is no longer shown.`, `删除可用区「${z.name.zh || z.domain}」？它的历史数据会留在库里，但不再显示。`))) return
    form!.zones.splice(i, 1)
  }
  function moveZone(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= form!.zones.length) return
    ;[form!.zones[i], form!.zones[j]] = [form!.zones[j], form!.zones[i]]
  }
  function toggleApp(zone: ZoneSetting, appId: string) {
    zone.exclude = zone.exclude.includes(appId) ? zone.exclude.filter((x) => x !== appId) : [...zone.exclude, appId]
  }
  function addPage(zone: ZoneSetting) {
    zone.extra.push({ id: '', name: { en: '', zh: '' }, url: `https://${zone.domain || 'example.com'}/`, keyword: '' })
  }

  // ---- Standard pages ----
  function addApp() {
    form!.apps.push({ id: '', name: { en: '', zh: '' }, url: 'https://{domain}/' })
  }
  function removeApp(i: number) {
    const id = form!.apps[i].id
    form!.apps.splice(i, 1)
    for (const z of form!.zones) z.exclude = z.exclude.filter((x) => x !== id)
  }
  function onPageName(p: PageSetting | Settings['apps'][number]) {
    if (!p.id) p.id = slug((p.name.en || p.name.zh).replace(/\s+/g, '-'))
  }

  const pageCount = (z: ZoneSetting) => form!.apps.filter((a) => !z.exclude.includes(a.id)).length + z.extra.length
  const regionLabel = (id: string) => {
    const r = view?.regions.find((x) => x.id === id)
    return r ? (i18n.lang === 'en' ? r.label.en : r.label.zh) : id
  }

  const timeZones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']

  const input = 'border-input focus:border-foreground/40 h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none'
  const small = 'border-input focus:border-foreground/40 h-8 w-full rounded-md border bg-transparent px-2.5 text-sm outline-none'
  const btn = 'h-9 rounded-md px-3 text-sm font-medium transition disabled:opacity-50'
  const primary = `${btn} bg-primary text-primary-foreground hover:opacity-90`
  const secondary = `${btn} border border-[#cacace] dark:border-input hover:bg-secondary`
  const ghost = 'text-muted-foreground hover:text-foreground hover:bg-secondary grid size-8 place-items-center rounded-md transition disabled:opacity-30'
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground line-through hover:bg-secondary'}`
  const label = 'text-sm font-medium'
  const hint = 'text-subtle text-xs leading-[18px]'
</script>

{#snippet secretField(field: SecretField, title: string, placeholder: string, help: string)}
  {@const stored = view?.secrets[field]}
  <label class="flex flex-col gap-1.5">
    <span class={label}>{title}</span>
    {#if stored && !clearSecret[field]}
      <div class="flex items-center gap-2">
        <input class={input} type="password" placeholder={L(`Set (${stored}); leave empty to keep`, `已设置（${stored}），留空则不修改`)} bind:value={secretInput[field]} autocomplete="off" data-testid="secret-{field}" />
        <button type="button" class="{secondary} shrink-0" onclick={() => (clearSecret[field] = true)}>{L('Clear', '清除')}</button>
      </div>
    {:else}
      <div class="flex items-center gap-2">
        <input class={input} type="password" {placeholder} bind:value={secretInput[field]} autocomplete="off" data-testid="secret-{field}" />
        {#if clearSecret[field]}<button type="button" class="{secondary} shrink-0" onclick={() => (clearSecret[field] = false)}>{L('Undo', '撤销')}</button>{/if}
      </div>
    {/if}
    <span class={hint}>{help}</span>
  </label>
{/snippet}

{#if !form || !view}
  <p class="text-muted-foreground py-10 text-sm">{message?.text ?? L('Loading…', '加载中…')}</p>
{:else}
  <div class="flex flex-col gap-6 pb-24" data-testid="settings">
    <!-- Zones -->
    <section class="status-card mt-6">
      <div class="status-card-body">
        <div class="border-border-soft flex items-center justify-between gap-3 border-b px-4 py-3.5">
          <div>
            <h2 class="text-base font-medium">{L('Zones', '可用区')}</h2>
            <p class={hint}>{L('Each zone checks the standard pages below; drop the ones it lacks or add its own.', '每个可用区检测下面的「标准页面」，可以去掉不提供的，也可以加专属页面。')}</p>
          </div>
          <button type="button" class="{secondary} flex shrink-0 items-center gap-1" onclick={addZone} data-testid="add-zone"><Plus class="size-4" />{L('Add zone', '添加可用区')}</button>
        </div>
        {#each form.zones as zone, zi (zone)}
          {@const isOpen = openZone === zone.id}
          <div class="border-border-soft border-b last:border-b-0" data-testid="settings-zone" data-zone={zone.id}>
            <div class="flex items-center gap-2 px-4 py-3">
              <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm" onclick={() => (openZone = isOpen ? null : zone.id)} data-testid="settings-zone-toggle">
                <ChevronDown class="text-muted-foreground size-4 shrink-0 transition-transform {isOpen ? '' : '-rotate-90'}" />
                <span class="truncate font-medium">{(i18n.lang === 'en' ? zone.name.en : zone.name.zh) || zone.domain || L('New zone', '新可用区')}</span>
                <span class="text-subtle hidden truncate sm:inline">{zone.domain}</span>
                <span class="text-muted-foreground shrink-0">· {pageCount(zone)} {pageCount(zone) === 1 ? L('page', '个页面') : L('pages', '个页面')} · {regionLabel(zone.probe)}</span>
              </button>
              <button type="button" class={ghost} disabled={zi === 0} onclick={() => moveZone(zi, -1)} aria-label="Move up">↑</button>
              <button type="button" class={ghost} disabled={zi === form.zones.length - 1} onclick={() => moveZone(zi, 1)} aria-label="Move down">↓</button>
              <button type="button" class="{ghost} hover:text-down" onclick={() => removeZone(zi)} aria-label="Remove" data-testid="remove-zone"><Trash class="size-4" /></button>
            </div>
            {#if isOpen}
              <div class="flex flex-col gap-4 px-4 pt-1 pb-4 sm:pl-10">
                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="flex flex-col gap-1.5 sm:col-span-2"><span class={label}>{L('Domain', '域名')}</span>
                    <input class={input} bind:value={zone.domain} onblur={() => onDomain(zone)} placeholder="tokyo.sealos.io" data-testid="zone-domain" />
                    <span class={hint}>ID: <code>{zone.id}</code> {newZoneIds.has(zone.id) ? L('(from the domain, fixed once saved)', '（按域名生成，保存后固定）') : L('(history is stored under it, cannot change)', '（历史数据按它保存，不可修改）')}</span>
                  </label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Name (English)', '名称（英文）')}</span><input class={input} bind:value={zone.name.en} placeholder="Tokyo" data-testid="zone-name-en" /></label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Name (Chinese)', '名称（中文）')}</span><input class={input} bind:value={zone.name.zh} placeholder={L('Optional', '东京')} data-testid="zone-name-zh" /></label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Location (English)', '位置（英文）')}</span><input class={input} bind:value={zone.location.en} placeholder="Tokyo, Japan" /></label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Location (Chinese)', '位置（中文）')}</span><input class={input} bind:value={zone.location.zh} placeholder={L('Optional', '日本 · 东京')} /></label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Country code', '国家代码')}</span><input class={input} bind:value={zone.country} maxlength="2" placeholder="JP" /></label>
                  <label class="flex flex-col gap-1.5"><span class={label}>{L('Check from', '探测地区')}</span>
                    <select class={input} bind:value={zone.probe} data-testid="zone-probe">
                      {#each view.regions as r (r.id)}<option value={r.id}>{i18n.lang === 'en' ? r.label.en : r.label.zh}</option>{/each}
                    </select>
                  </label>
                </div>

                <div class="flex flex-col gap-2">
                  <span class={label}>{L('Standard pages', '标准页面')} <span class="text-subtle font-normal">· {L('click to toggle', '点击切换是否检测')}</span></span>
                  <div class="flex flex-wrap gap-1.5">
                    {#if form.apps.length === 0}<span class="text-subtle text-xs">{L('None yet (add them under Standard pages below)', '还没有标准页面（在下方「标准页面」里添加）')}</span>{/if}
                    {#each form.apps as app (app)}
                      <button type="button" class={chip(!zone.exclude.includes(app.id))} onclick={() => toggleApp(zone, app.id)} title={fillDomain(app.url, zone.domain || '{domain}')} data-testid="zone-app-{app.id}">{i18n.lang === 'en' ? app.name.en : app.name.zh}</button>
                    {/each}
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  <span class={label}>{L('Zone-only pages', '专属页面')}</span>
                  {#each zone.extra as page, pi (page)}
                    <div class="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                      <input class={small} bind:value={page.name.en} onblur={() => onPageName(page)} placeholder={L('English name', '英文名')} />
                      <input class={small} bind:value={page.name.zh} onblur={() => onPageName(page)} placeholder={L('Chinese name', '中文名')} />
                      <input class={small} bind:value={page.url} placeholder="https://…" data-testid="extra-url" />
                      <button type="button" class="{ghost} hover:text-down" onclick={() => zone.extra.splice(pi, 1)} aria-label="Remove"><Trash class="size-4" /></button>
                      <input class="{small} sm:col-span-2" bind:value={page.id} placeholder="id" />
                      <input class="{small} sm:col-span-2" bind:value={page.keyword} placeholder={L('Text the page must contain (optional)', '页面必须包含的文字（可选）')} />
                    </div>
                  {/each}
                  <button type="button" class="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm" onclick={() => addPage(zone)} data-testid="add-page"><Plus class="size-4" />{L('Add page', '添加页面')}</button>
                </div>

                <div class="flex flex-col gap-2">
                  <button type="button" class="{secondary} w-fit" disabled={!!probing || !zone.domain} onclick={() => probeZone(zone.id)} data-testid="probe-zone">
                    {probing === zone.id ? L('Checking…', '检测中…') : L('Check this zone now', '立即检测这个可用区')}
                  </button>
                  {#if probeResults[zone.id]}
                    <div class="flex flex-col rounded-md border text-sm" data-testid="probe-results">
                      {#each probeResults[zone.id] as r (r.id)}
                        <div class="border-border-soft flex items-center gap-2 border-b px-3 py-2 last:border-b-0" data-ok={r.ok}>
                          <StatusIcon severity={r.ok ? 'up' : 'major'} />
                          <span class="min-w-0 flex-1 truncate" title={r.url}>{r.url}</span>
                          <span class="shrink-0 tabular-nums {r.ok ? 'text-muted-foreground' : 'text-down'}">{r.ok ? `${r.latency} ms` : r.error}</span>
                        </div>
                      {/each}
                    </div>
                    <span class={hint}>{L('Checked from the admin request’s location; after saving, checks run from the region above.', '这是从管理后台所在节点检测的，保存后会改从上面选的探测地区检测。')}</span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <!-- Standard pages -->
    <section class="status-card">
      <div class="status-card-body">
        <div class="border-border-soft flex items-center justify-between gap-3 border-b px-4 py-3.5">
          <div>
            <h2 class="text-base font-medium">{L('Standard pages', '标准页面')}</h2>
            <p class={hint}>{L('Pages checked in every zone. {domain} in the URL becomes the zone’s domain.', '每个可用区都会检测的页面。地址里的 {domain} 会替换成可用区域名。')}</p>
          </div>
          <button type="button" class="{secondary} flex shrink-0 items-center gap-1" onclick={addApp} data-testid="add-app"><Plus class="size-4" />{L('Add', '添加')}</button>
        </div>
        <div class="flex flex-col gap-2 p-4">
          {#if form.apps.length === 0}<p class="text-muted-foreground text-sm">{L('No standard pages; each zone checks only its own pages.', '还没有标准页面，每个可用区只检测自己的专属页面。')}</p>{/if}
          {#each form.apps as app, ai (app)}
            <div class="grid items-center gap-2 sm:grid-cols-[7rem_1fr_1fr_2fr_auto]" data-testid="settings-app">
              <input class={small} bind:value={app.id} placeholder="id" disabled={JSON.parse(savedJson).apps?.some((a: { id: string }) => a.id === app.id)} />
              <input class={small} bind:value={app.name.en} onblur={() => onPageName(app)} placeholder={L('English name', '英文名')} />
              <input class={small} bind:value={app.name.zh} onblur={() => onPageName(app)} placeholder={L('Chinese name', '中文名')} />
              <input class={small} bind:value={app.url} placeholder={'https://app.{domain}/'} />
              <button type="button" class="{ghost} hover:text-down" onclick={() => removeApp(ai)} aria-label="Remove"><Trash class="size-4" /></button>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- Notifications -->
    <section class="status-card">
      <div class="status-card-body flex flex-col gap-4 p-4">
        <h2 class="text-base font-medium">{L('Notifications', '通知')}</h2>
        {@render secretField('notify.webhookUrl', L('Team webhook', '团队 Webhook'), 'https://hooks.slack.com/services/…', L('Every outage, incident and maintenance is posted here. Slack, Discord, Feishu/Lark, DingTalk and WeCom bot URLs get a native message; any other URL receives JSON.', '所有故障、事件、维护消息都会发到这里。Slack、Discord、飞书、钉钉、企业微信机器人地址会收到对应格式的消息，其他地址收到 JSON。'))}
        {@render secretField('notify.webhookSecret', L('Signing secret (optional)', '签名密钥（可选）'), L('Only for Feishu/Lark bots with signature verification on', '只有开了签名校验的飞书机器人才需要'), L('From the bot’s Security settings → Signature verification.', '在机器人的「安全设置 → 签名校验」里复制。'))}
        <label class="flex flex-col gap-1.5">
          <span class={label}>{L('Notify after (minutes)', '持续多少分钟才通知')}</span>
          <input class="{input} w-32" type="number" min="0" max="60" bind:value={form.notify.graceMinutes} data-testid="grace-minutes" />
          <span class={hint}>{L('A detected outage must last this long before it is announced, so short blips stay quiet. 0 = immediately.', '自动检测到的故障要连续这么久才发通知，过滤掉一两分钟的抖动。0 = 立刻通知。')}</span>
        </label>
      </div>
    </section>

    <!-- Email -->
    <section class="status-card">
      <div class="status-card-body flex flex-col gap-4 p-4">
        <div>
          <h2 class="text-base font-medium">{L('Email subscriptions', '邮件订阅')}</h2>
          <p class={hint}>{L('With both set, visitors can subscribe by email; otherwise only by webhook. Sent through Resend; verify the sender domain there first.', '两项都填了，访客才能用邮箱订阅；否则只能用 Webhook 订阅。邮件通过 Resend 发送，发件域名要先在 Resend 里验证。')}</p>
        </div>
        {@render secretField('email.resendApiKey', 'Resend API Key', 're_…', L('Create one at resend.com → API Keys.', '在 resend.com → API Keys 创建。'))}
        <label class="flex flex-col gap-1.5">
          <span class={label}>{L('Sender', '发件人')}</span>
          <input class={input} bind:value={form.email.from} placeholder="Status <status@example.com>" data-testid="email-from" />
        </label>
      </div>
    </section>

    <!-- Site and checks -->
    <section class="status-card">
      <div class="status-card-body flex flex-col gap-4 p-4">
        <h2 class="text-base font-medium">{L('Site and checks', '站点与检测')}</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Title (English)', '标题（英文）')}</span><input class={input} bind:value={form.site.title.en} data-testid="site-title-en" /></label>
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Title (Chinese)', '标题（中文）')}</span><input class={input} bind:value={form.site.title.zh} /></label>
          <label class="flex flex-col gap-1.5 sm:col-span-2"><span class={label}>{L('Site URL', '站点地址')}</span>
            <input class={input} bind:value={form.site.url} placeholder="https://status.example.com" data-testid="site-url" />
            <span class={hint}>{L('Used for links in notifications and confirmation emails; empty = no links.', '通知和确认邮件里的链接用它，留空则不带链接。')}</span>
          </label>
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Time zone', '时区')}</span>
            <input class={input} bind:value={form.site.timezone} list="tz-list" placeholder="UTC" data-testid="site-timezone" />
            <datalist id="tz-list">{#each timeZones as tz (tz)}<option value={tz}></option>{/each}</datalist>
            <span class={hint}>{L('Where a day starts and ends in the history bars and daily uptime.', '历史条和每日可用率按这个时区切分一天。')}</span>
          </label>
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Default language', '默认语言')}</span>
            <select class={input} bind:value={form.site.language} data-testid="site-language">
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
            <span class={hint}>{L('For visitors whose browser language is not supported, and for team notifications.', '浏览器语言不受支持的访客看到的语言，也是团队通知用的语言。')}</span>
          </label>
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Check timeout (ms)', '检测超时（毫秒）')}</span><input class={input} type="number" min="1000" max="30000" step="500" bind:value={form.probe.timeoutMs} /></label>
          <label class="flex flex-col gap-1.5"><span class={label}>{L('Slow above (ms)', '慢于多少毫秒算「缓慢」')}</span><input class={input} type="number" min="500" max="30000" step="500" bind:value={form.probe.degradedMs} data-testid="degraded-ms" /></label>
        </div>
      </div>
    </section>
  </div>

  <!-- Save bar -->
  <div class="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur" data-testid="save-bar">
    <div class="mx-auto flex w-full max-w-[702px] items-center justify-between gap-3 px-4 py-3">
      <p class="min-w-0 text-sm {message ? (message.ok ? 'text-up' : 'text-down') : 'text-muted-foreground'}" data-testid="settings-message">
        {message?.text ?? (dirty ? L('Unsaved changes', '有未保存的修改') : L('All changes saved', '所有修改已保存'))}
      </p>
      <div class="flex shrink-0 gap-2">
        {#if dirty}<button type="button" class={secondary} disabled={busy} onclick={() => { load(); message = null }}>{L('Discard', '放弃')}</button>{/if}
        <button type="button" class={primary} disabled={busy || !dirty} onclick={save} data-testid="save-settings">{busy ? '…' : L('Save', '保存')}</button>
      </div>
    </div>
  </div>
{/if}
