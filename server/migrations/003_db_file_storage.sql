-- Allow payment proofs to be stored inside PostgreSQL (for hosts without a persistent disk, e.g. Render free).
ALTER TABLE files ADD COLUMN data bytea;
ALTER TABLE files ALTER COLUMN storage_name DROP NOT NULL;
