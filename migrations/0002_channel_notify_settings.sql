CREATE TABLE channel_notify_settings (
  channel_id TEXT PRIMARY KEY,
  notify_when_empty INTEGER NOT NULL CHECK (notify_when_empty IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
