import { handleAdmin } from './admin'
import { handlePublic, HttpError, json } from './api'
import type { Env } from './env'
import { cleanup, runChecks } from './run'

export { Prober } from './prober'

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/unsubscribe'
    if (!isApi) return env.ASSETS.fetch(request)
    try {
      if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(request, env)
      return await handlePublic(request, env, ctx)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, 0, e.headers)
      if (e instanceof SyntaxError) return json({ error: 'invalid JSON body' }, 400)
      console.error(e)
      return json({ error: (e as Error).message }, 500)
    }
  },

  async scheduled(controller, env): Promise<void> {
    if (controller.cron === '17 3 * * *') {
      await cleanup(env, Math.floor(controller.scheduledTime / 1000))
      return
    }
    await runChecks(env, controller.scheduledTime)
  },
} satisfies ExportedHandler<Env>
