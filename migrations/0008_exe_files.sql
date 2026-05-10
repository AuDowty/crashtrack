-- 0008: per-project EXE/DLL uploads for SEH .pdata unwinding.
--
-- Symbols (PDBs) give us function names. PE binaries (EXE/DLL) give us the
-- .pdata + .xdata unwind metadata, which is what enables precise stack
-- walking via the same algorithm Windows itself uses for SEH dispatch.
-- Indexed by basename (e.g. "myapp.exe") since the minidump exposes module
-- basenames in MINIDUMP_MODULE.

CREATE TABLE pe_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  basename    TEXT    NOT NULL,                  -- "myapp.exe" (lowercased)
  r2_key      TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  UNIQUE (project_id, basename)
);

-- Cached at ingest so view-time SEH unwinding doesn't need to re-fetch the
-- full dump from R2. JSON object:
--   { rip: "0x...", rsp: "0x...", rbp: "0x...", stack_base: "0x...",
--     stack_b64: "..." }
-- where stack_b64 is the base64-encoded crashing thread's stack memory.
-- Caps at ~96 KB (typical thread stack) so D1 row stays under 2 MB.
ALTER TABLE crashes ADD COLUMN unwind_data TEXT;
