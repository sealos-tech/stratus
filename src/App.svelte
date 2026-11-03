<script lang="ts">
  import Header from '$lib/components/Header.svelte'
  import Footer from '$lib/components/Footer.svelte'
  import SubscribeDialog from '$lib/components/SubscribeDialog.svelte'
  import Home from './routes/Home.svelte'
  import History from './routes/History.svelte'
  import Incident from './routes/Incident.svelte'
  import Monitor from './routes/Monitor.svelte'
  import Admin from './routes/Admin.svelte'
  import { fetchSummary } from '$lib/api'
  import { router, link } from '$lib/router.svelte'
  import { i18n, loc, setSiteLanguage, t } from '$lib/i18n.svelte'
  import type { ApiSummary } from '$shared/types'

  const REFRESH_MS = 60_000

  let summary = $state<ApiSummary | null>(null)
  let error = $state<string | null>(null)
  let now = $state(Math.floor(Date.now() / 1000))
  let tick = $state(0)
  let subscribeOpen = $state(false)

  async function load() {
    try {
      summary = await fetchSummary()
      setSiteLanguage(summary.site.language)
      error = null
    } catch (e) {
      error = (e as Error).message
    }
  }

  $effect(() => {
    load()
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load()
        tick++
      }
    }, REFRESH_MS)
    const clock = setInterval(() => (now = Math.floor(Date.now() / 1000)), 15_000)
    return () => {
      clearInterval(refresh)
      clearInterval(clock)
    }
  })

  $effect(() => {
    document.documentElement.lang = i18n.lang === 'en' ? 'en' : 'zh-CN'
    const base = summary ? loc(summary.site.title) : 'Status'
    document.title = router.route.name === 'admin' ? `Admin · ${base}` : base
  })
</script>

<div class="mx-auto w-full max-w-[702px] px-4">
  <Header site={summary?.site ?? null} onSubscribe={router.route.name === 'admin' ? undefined : () => (subscribeOpen = true)} divider={router.route.name === 'history'} />
  <main class={router.route.name === 'history' ? '' : 'mt-2'}>
    {#if router.route.name === 'home'}
      <Home data={summary} {error} {now} onRetry={load} />
    {:else if router.route.name === 'history'}
      <History {now} />
    {:else if router.route.name === 'incident'}
      {#key router.route.id}<Incident id={router.route.id} {now} />{/key}
    {:else if router.route.name === 'monitor'}
      {#key `${router.route.zone}/${router.route.monitor}`}
        <Monitor zone={router.route.zone} monitor={router.route.monitor} {now} refresh={tick} />
      {/key}
    {:else if router.route.name === 'admin'}
      <Admin {now} />
    {:else}
      <div class="status-card mt-10"><div class="status-card-body p-10 text-center">
        <p class="text-base font-medium">{t('notFound')}</p>
        <a href="/" onclick={link} class="text-muted-foreground mt-2 inline-block text-sm hover:underline">{t('backToStatus')}</a>
      </div></div>
    {/if}
  </main>
  <Footer />
</div>

<SubscribeDialog bind:open={subscribeOpen} zones={summary?.zones ?? []} emailEnabled={summary?.subscribe.email ?? false} />
