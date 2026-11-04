// Stand-in for the monitored pages and the webhook receivers during E2E runs.
//   GET  /page/:id          200 HTML, or 503 when :id is in the "down" set
//   POST /control           {"down": ["alpha"], "slowOnce": ["beta"]}: 503 set, and the next
//                           request for each slowOnce id is delayed past the slow threshold
//   POST /hook/:name        records the JSON body, answers {"code":0} (what chat bots return)
//   GET  /hooks             recorded hook calls; DELETE /hooks clears them
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 5199)
let down = new Set()
let slowOnce = new Set()
let hooks = []

const SLOW_MS = 6000

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const parts = url.pathname.split('/').filter(Boolean)
  if (req.method === 'GET' && parts[0] === 'page') {
    if (down.has(parts[1])) return send(res, 503, '<h1>Service Unavailable</h1>', 'text/html')
    if (slowOnce.delete(parts[1])) await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    return send(res, 200, `<!doctype html><title>${parts[1]}</title><h1>${parts[1]} ok</h1>`, 'text/html')
  }
  if (req.method === 'POST' && url.pathname === '/control') {
    const body = JSON.parse((await readBody(req)) || '{}')
    down = new Set(body.down ?? [])
    slowOnce = new Set(body.slowOnce ?? [])
    return send(res, 200, { down: [...down], slowOnce: [...slowOnce] })
  }
  if (req.method === 'POST' && parts[0] === 'hook') {
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
    hooks.push({ name: parts[1], body, at: Date.now() })
    return send(res, 200, { code: 0, msg: 'success' })
  }
  if (url.pathname === '/hooks') {
    if (req.method === 'DELETE') hooks = []
    return send(res, 200, hooks)
  }
  if (url.pathname === '/health') return send(res, 200, { ok: true })
  send(res, 404, { error: 'not found' })
}).listen(PORT, '127.0.0.1', () => console.log(`mock server on http://127.0.0.1:${PORT}`))
