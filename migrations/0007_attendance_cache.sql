-- Scale fix: shared attendance cache so one portal fetch serves many readers
-- (leaderboard, analytics, compare, overview, digest), plus totals on snapshots
-- so the leaderboard can be served entirely from D1.

CREATE TABLE IF NOT EXISTS attendance_cache (
  enrollment_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (enrollment_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_attendance_cache_fetched ON attendance_cache (fetched_at);

ALTER TABLE rank_snapshots ADD COLUMN total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rank_snapshots ADD COLUMN present INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rank_snapshots ADD COLUMN absent INTEGER NOT NULL DEFAULT 0;
