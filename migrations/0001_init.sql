-- Small key/value rows. "state" holds the latest result and per-day counts of every page
-- (one row read + one row written per minute; rebuilt from `daily` if lost).
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

-- One row per page per local day (site timezone).
CREATE TABLE IF NOT EXISTS daily (
  zone TEXT NOT NULL,
  monitor TEXT NOT NULL,
  day TEXT NOT NULL,                       -- YYYY-MM-DD
  up INTEGER NOT NULL DEFAULT 0,
  degraded INTEGER NOT NULL DEFAULT 0,
  down INTEGER NOT NULL DEFAULT 0,
  maintenance INTEGER NOT NULL DEFAULT 0,
  latency_sum INTEGER NOT NULL DEFAULT 0,
  latency_count INTEGER NOT NULL DEFAULT 0,
  latency_min INTEGER,
  latency_max INTEGER,
  minutes TEXT NOT NULL,                   -- 1440 chars, one per minute: '.' none, u/d/x/m
  latencies TEXT NOT NULL,                 -- 1440 x 4 hex chars, latency in ms per minute
  PRIMARY KEY (zone, monitor, day)
) WITHOUT ROWID;

-- Automatic detections: a period in which a page failed its checks.
CREATE TABLE IF NOT EXISTS outages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone TEXT NOT NULL,
  monitor TEXT NOT NULL,
  start_ts INTEGER NOT NULL,
  end_ts INTEGER,                          -- NULL while ongoing
  error TEXT NOT NULL,                     -- latest error message
  errors TEXT NOT NULL,                    -- JSON [[ts, error], ...], one entry per change
  notified INTEGER NOT NULL DEFAULT 0      -- 1 once it lasted past the grace period and was announced
);
CREATE INDEX IF NOT EXISTS outages_open ON outages (end_ts);
CREATE INDEX IF NOT EXISTS outages_monitor ON outages (zone, monitor, start_ts);
CREATE INDEX IF NOT EXISTS outages_start ON outages (start_ts);

-- Incidents and maintenances published from the admin console.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                      -- incident / maintenance
  title TEXT NOT NULL,
  impact TEXT NOT NULL,                    -- degraded / partial / major / maintenance
  status TEXT NOT NULL,                    -- latest update status
  components TEXT NOT NULL,                -- JSON [{zone, monitor?}], [] = every zone
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,                         -- resolved at (incident) / planned end (maintenance)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_window ON events (ends_at, starts_at);

CREATE TABLE IF NOT EXISTS event_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS event_updates_event ON event_updates (event_id, created_at);

-- People and bots that asked to be notified.
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                      -- email / webhook
  target TEXT NOT NULL,                    -- address or webhook URL
  zones TEXT,                              -- JSON ["bja", ...]; NULL = every zone
  auto INTEGER NOT NULL DEFAULT 1,         -- 1 = also automatic outage detections
  lang TEXT NOT NULL DEFAULT 'en',
  token TEXT NOT NULL,                     -- confirm / unsubscribe token
  verified INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_target ON subscribers (kind, target);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_token ON subscribers (token);
CREATE INDEX IF NOT EXISTS subscribers_ip ON subscribers (ip_hash, created_at);

-- Notifications waiting to be delivered to subscribers; drained every minute with retries.
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id INTEGER NOT NULL,
  notice TEXT NOT NULL,                    -- JSON Notice (worker/notify.ts)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / sending / sent / failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (status, next_at);
