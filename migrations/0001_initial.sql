CREATE TABLE absences (
  id TEXT PRIMARY KEY,
  target_user TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  absence_type TEXT NOT NULL DEFAULT 'absence',
  notify_channels TEXT NOT NULL DEFAULT '[]',
  notify_users TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_absences_target_user ON absences(target_user);
CREATE INDEX idx_absences_date_range ON absences(start_date, end_date);

CREATE TABLE member_master (
  target_user TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  default_notify_channels TEXT NOT NULL DEFAULT '[]',
  default_notify_users TEXT NOT NULL DEFAULT '[]',
  default_registration_notify TEXT NOT NULL DEFAULT 'none'
    CHECK (default_registration_notify IN ('none', 'ch', 'dm', 'both')),
  updated_at TEXT NOT NULL
);
