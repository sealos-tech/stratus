-- Failed admin logins per client IP (hashed). 30 failures in a row block the IP for an hour.
CREATE TABLE IF NOT EXISTS auth_failures (
  ip_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  blocked_until INTEGER
) WITHOUT ROWID;
