import { cloudflare } from '@cloudflare/vite-plugin'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

/**
 * Cron triggers do not fire on their own in `vite dev`, so this fires the monitoring round once
 * a minute, as production does. DEV_CRON=0 turns it off (the E2E suite drives rounds itself).
 */
function devCron(): Plugin {
  return {
    name: 'sealos-status:dev-cron',
    apply: 'serve',
    configureServer(server) {
      if (process.env.DEV_CRON === '0' || !server.httpServer) return
      let timer: ReturnType<typeof setInterval> | undefined
      const tick = async () => {
        const address = server.httpServer?.address()
        if (!address || typeof address === 'string') return
        const minute = Math.floor(Date.now() / 60000) * 60000
        try {
          const res = await fetch(`http://localhost:${address.port}/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time=${minute}`)
          if (!res.ok) server.config.logger.warn(`[dev-cron] monitoring round failed: HTTP ${res.status}`)
        } catch (e) {
          server.config.logger.warn(`[dev-cron] monitoring round failed: ${(e as Error).message}`)
        }
      }
      server.httpServer.once('listening', () => {
        server.config.logger.info('[dev-cron] running a monitoring round every minute')
        setTimeout(tick, 3000)
        timer = setInterval(tick, 60_000)
      })
      server.httpServer.once('close', () => clearInterval(timer))
    },
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    // E2E runs point at e2e/wrangler.jsonc (own vars, no .dev.vars) and a throwaway state dir.
    cloudflare({
      configPath: process.env.WRANGLER_CONFIG ?? './wrangler.jsonc',
      persistState: process.env.STATE_DIR ? { path: process.env.STATE_DIR } : true,
    }),
    devCron(),
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      $shared: fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
})
