-- 0005: cache of resolved (PDB, RVA) -> function lookups.
--
-- PDB resolution does a linear scan over symbols; cache to avoid repeating
-- it for every dashboard view of the same crash group.

CREATE TABLE symbol_cache (
  symbol_file_id INTEGER NOT NULL REFERENCES symbol_files(id) ON DELETE CASCADE,
  rva            INTEGER NOT NULL,
  function       TEXT,
  resolved_at    INTEGER NOT NULL,
  PRIMARY KEY (symbol_file_id, rva)
);
