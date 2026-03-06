-- 0003: teams (orgs + members) + globally-unique project slugs.
--
-- Pre-v1 schema reshape: projects move from (user_id, slug) UNIQUE to
-- (slug) UNIQUE so URLs are /app/<slug> regardless of owner. Safe to drop
-- and recreate projects here because no production data exists yet.

CREATE TABLE orgs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE org_members (
  org_id     INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX idx_org_members_user ON org_members(user_id);

DROP TABLE IF EXISTS projects;
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     INTEGER REFERENCES orgs(id) ON DELETE CASCADE,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  platform   TEXT    NOT NULL DEFAULT 'windows',
  public     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_projects_org  ON projects(org_id);
