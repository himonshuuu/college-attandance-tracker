CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ENROLLMENT_ID TEXT NOT NULL UNIQUE,
  class_name TEXT NOT NULL DEFAULT '',
  stream TEXT NOT NULL DEFAULT '',
  roll_number TEXT NOT NULL DEFAULT '',
  profile_photo_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students (ENROLLMENT_ID);
CREATE INDEX IF NOT EXISTS idx_students_active ON students (active, id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('browser', 'email')),
  email TEXT,
  push_subscription TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(enrollment_id, method)
);

CREATE INDEX IF NOT EXISTS idx_subs_enrollment ON subscriptions (enrollment_id);
