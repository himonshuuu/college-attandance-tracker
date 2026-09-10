CREATE TABLE subscriptions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('browser', 'email', 'monthly_report')),
  email TEXT,
  push_subscription TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(enrollment_id, method)
);

INSERT INTO subscriptions_new (id, enrollment_id, method, email, push_subscription, created_at)
SELECT id, enrollment_id, method, email, push_subscription, created_at FROM subscriptions;

DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

CREATE INDEX idx_subs_enrollment ON subscriptions (enrollment_id);
