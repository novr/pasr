CREATE TABLE slack_user_oauth (
  user_id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  scope TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
