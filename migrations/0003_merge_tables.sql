DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  enrollment_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  class_name TEXT NOT NULL DEFAULT '',
  stream TEXT NOT NULL DEFAULT '',
  roll_number TEXT NOT NULL DEFAULT '',
  profile_photo_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_enrollment ON users (enrollment_id);
CREATE INDEX idx_users_active ON users (active, id);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('browser', 'email')),
  email TEXT,
  push_subscription TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(enrollment_id, method)
);

CREATE INDEX idx_subs_enrollment ON subscriptions (enrollment_id);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE college_sessions (
  enrollment_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  obtained_at INTEGER NOT NULL
);

CREATE TABLE monitor_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
