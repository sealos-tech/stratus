// Minimal History API router.

export type Route =
  | { name: 'home' }
  | { name: 'history' }
  | { name: 'incident'; id: number }
  | { name: 'outage'; id: number }
  | { name: 'monitor'; zone: string; monitor: string }
  | { name: 'admin' }
  | { name: 'notFound' }

function parse(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/') return { name: 'home' }
  if (p === '/history') return { name: 'history' }
  if (p === '/admin') return { name: 'admin' }
  let m = /^\/incidents\/(\d+)$/.exec(p)
  if (m) return { name: 'incident', id: Number(m[1]) }
  m = /^\/monitors\/([^/]+)\/([^/]+)$/.exec(p)
  if (m) return { name: 'monitor', zone: decodeURIComponent(m[1]), monitor: decodeURIComponent(m[2]) }
  return { name: 'notFound' }
}

export const router = $state({ route: parse(location.pathname), search: location.search })

export function navigate(href: string) {
  const url = new URL(href, location.origin)
  if (url.pathname + url.search === location.pathname + location.search) return
  history.pushState(null, '', url)
  router.route = parse(url.pathname)
  router.search = url.search
  window.scrollTo({ top: 0 })
}

window.addEventListener('popstate', () => {
  router.route = parse(location.pathname)
  router.search = location.search
})

/** Click handler for internal links: keeps modifier-clicks (new tab) working. */
export function link(event: MouseEvent) {
  const a = event.currentTarget as HTMLAnchorElement
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (a.target === '_blank' || a.origin !== location.origin) return
  event.preventDefault()
  navigate(a.pathname + a.search)
}

export const monitorHref = (zone: string, monitor: string) => `/monitors/${encodeURIComponent(zone)}/${encodeURIComponent(monitor)}`
