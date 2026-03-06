-- 0002: projects, api keys, releases, crash groups, crashes, symbols, webhooks
-- This is the rest of the v1 schema. After this we're feature-complete on storage.

CREATE TABLE projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  platform   TEXT    NOT NULL DEFAULT 'windows',
  public     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_hash     TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  last_4       TEXT    NOT NULL,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_api_keys_project ON api_keys(project_id);

CREATE TABLE releases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version       TEXT    NOT NULL,
  channel       TEXT,
  first_seen_at INTEGER NOT NULL,
  install_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, version)
);
CREATE INDEX idx_releases_project ON releases(project_id, first_seen_at DESC);

CREATE TABLE crash_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  signature      TEXT    NOT NULL,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  exception_code TEXT,
  top_module     TEXT,
  top_function   TEXT,
  status         TEXT    NOT NULL DEFAULT 'open',
  UNIQUE (project_id, signature)
);
CREATE INDEX idx_groups_proj_lseen ON crash_groups(project_id, last_seen_at DESC);

CREATE TABLE crashes (
  id          TEXT    PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  group_id    INTEGER REFERENCES crash_groups(id) ON DELETE SET NULL,
  release_id  INTEGER REFERENCES releases(id) ON DELETE SET NULL,
  occurred_at INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  app_version TEXT,
  os_version  TEXT,
  cpu_arch    TEXT,
  ram_mb      INTEGER,
  dump_size   INTEGER,
  parsed_ok   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_crashes_proj_time ON crashes(project_id, uploaded_at DESC);
CREATE INDEX idx_crashes_group     ON crashes(group_id);

CREATE TABLE symbol_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_name TEXT    NOT NULL,
  signature   TEXT    NOT NULL,
  age         INTEGER NOT NULL,
  r2_key      TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  UNIQUE (project_id, signature, age)
);
CREATE INDEX idx_symbols_lookup ON symbol_files(module_name, signature, age);

CREATE TABLE webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  events     TEXT    NOT NULL DEFAULT 'new_group,regression',
  secret     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_webhooks_project ON webhooks(project_id);

-- Daily aggregate so chart queries don't scan the crashes table.
CREATE TABLE crash_daily (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL,           -- unix days (floor(unix_ms / 86_400_000))
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, day)
);
