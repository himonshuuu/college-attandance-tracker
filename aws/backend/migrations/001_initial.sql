CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  enrollment_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  stream TEXT NOT NULL DEFAULT '',
  roll_number TEXT NOT NULL DEFAULT '',
  profile_photo_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_active_id ON users (active, id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('browser', 'email', 'monthly_report')),
  email TEXT,
  push_subscription TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, method)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enrollment ON subscriptions (enrollment_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS college_sessions (
  enrollment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  obtained_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets (email);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets (expires_at);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  enrollment_id TEXT NOT NULL,
  month TEXT NOT NULL,
  rank INTEGER NOT NULL,
  pct INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total INTEGER NOT NULL DEFAULT 0,
  present INTEGER NOT NULL DEFAULT 0,
  absent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (enrollment_id, month)
);

CREATE TABLE IF NOT EXISTS friendships (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, friend_user_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships (user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships (friend_user_id);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge TEXT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge)
);

CREATE TABLE IF NOT EXISTS attendance_cache (
  enrollment_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month TEXT NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (enrollment_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_attendance_cache_fetched ON attendance_cache (fetched_at);

CREATE TABLE IF NOT EXISTS migration_runs (
  id BIGSERIAL PRIMARY KEY,
  source_path TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);
