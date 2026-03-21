-- 0004: per-crash stack walk results.
--
-- Stack is computed at ingest time (we have the dump in memory anyway),
-- stored as JSON. Schema: [{ address: "0x14000abcd", module: "myapp.exe", offset: "0x1234" }].
-- Strings (not bigints) because JSON can't represent u64 reliably.

ALTER TABLE crashes ADD COLUMN stack_json TEXT;
