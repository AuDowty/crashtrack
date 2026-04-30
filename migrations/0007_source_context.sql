-- 0007: per-project GitHub repo + source-path stripping for source context.
--
-- When a frame has a PDB-resolved file path like
--   C:\Users\austi\Desktop\crashtrack-test\src\main.rs
-- we want to map that to the equivalent file in the user's GitHub repo
-- (e.g. `src/main.rs`) and fetch ±3 lines of code via GitHub raw to show
-- inline in the dashboard. This is the v1 source-context flow — no source
-- bundle uploads needed for OSS repos.

ALTER TABLE projects ADD COLUMN github_repo TEXT;
-- The substring marker after which the file path is treated as a repo-relative
-- path. e.g. value "src" means strip everything through the last "\src\" /
-- "/src/" and keep the rest. Default sensible for most repos.
ALTER TABLE projects ADD COLUMN source_root TEXT DEFAULT 'src';
-- Optional git ref (branch, tag, commit sha). Defaults to "main" if NULL.
ALTER TABLE projects ADD COLUMN github_ref TEXT;
