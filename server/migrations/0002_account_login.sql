ALTER TABLE accounts ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN temporary_expires_at INTEGER;
CREATE TABLE IF NOT EXISTS inspection_trash (
 record_id TEXT PRIMARY KEY REFERENCES inspections(id),
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
