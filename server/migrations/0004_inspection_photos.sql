CREATE TABLE IF NOT EXISTS inspection_photos (
    account_id TEXT NOT NULL REFERENCES accounts(id),
    record_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    stored_bytes INTEGER NOT NULL,
    staged_at INTEGER,
    PRIMARY KEY (account_id, record_id, photo_id)
);

UPDATE inspection_trash
SET expires_at = expires_at - 1987200000;
