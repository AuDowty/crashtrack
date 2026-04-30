-- 0006: human-readable exception details per crash.
--
-- We could re-derive these from the dump but storing them at ingest time
-- makes dashboard reads cheap and survives R2 lifecycle eviction.

ALTER TABLE crashes ADD COLUMN exception_name TEXT;     -- "EXCEPTION_ACCESS_VIOLATION"
ALTER TABLE crashes ADD COLUMN av_operation TEXT;       -- 'read' | 'write' | 'execute' | NULL
ALTER TABLE crashes ADD COLUMN av_address TEXT;         -- hex "0x0" — the address the code tried to access
