-- Engagement: rank snapshots (for rank-change alerts), friendships, earned badges.

CREATE TABLE IF NOT EXISTS rank_snapshots (
  enrollment_id TEXT NOT NULL,
  month TEXT NOT NULL,
  rank INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (enrollment_id, month)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(user_id, friend_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships (user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships (friend_user_id);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  awarded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, badge)
);
