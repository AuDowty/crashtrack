-- 0009: add file + line columns to symbol_cache so the line-number-aware
-- pdb_resolve output can persist. Should have been part of migration 0005
-- but I forgot to include them (the plan said add them, the SQL didn't).

ALTER TABLE symbol_cache ADD COLUMN file TEXT;
ALTER TABLE symbol_cache ADD COLUMN line INTEGER;
