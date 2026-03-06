-- 0001_init: users + sessions
-- This is the auth-only slice. Projects / crashes come in 0002.

CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id    INTEGER NOT NULL UNIQUE,
  github_login TEXT    NOT NULL,
  email        TEXT,
  avatar_url   TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
