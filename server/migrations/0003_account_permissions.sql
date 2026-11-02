CREATE TABLE IF NOT EXISTS account_permissions (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 view_all_records INTEGER CHECK(view_all_records IS NULL OR view_all_records IN (0,1)),
 write_own_records INTEGER CHECK(write_own_records IS NULL OR write_own_records IN (0,1)),
 manage_sites INTEGER CHECK(manage_sites IS NULL OR manage_sites IN (0,1)),
 manage_users INTEGER CHECK(manage_users IS NULL OR manage_users IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 operation_id TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES accounts(id),
 updated_at TEXT NOT NULL
);
