// Day and minute arithmetic in the site timezone. Days are keyed "YYYY-MM-DD".

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Local day key and minute of the day (0..1439) of a UNIX timestamp in seconds. */
export function localParts(ts: number, timeZone: string): { day: string; minute: number } {
  const p: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(ts * 1000))) p[part.type] = part.value
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) }
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** `count` day keys ending with `lastDay`, oldest first. */
export function dayRange(lastDay: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(lastDay, i - count + 1))
}

/** UNIX seconds of local midnight starting `day`. */
export function dayStart(day: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`) / 1000
  const local = localParts(utcMidnight, timeZone)
  const localAsUtc = Date.parse(`${local.day}T00:00:00Z`) / 1000 + local.minute * 60
  return utcMidnight - (localAsUtc - utcMidnight)
}

export function toUnix(value: string | number): number {
  return typeof value === 'number' ? value : Math.floor(Date.parse(value) / 1000)
}
