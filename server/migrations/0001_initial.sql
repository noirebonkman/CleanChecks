PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS installation (id INTEGER PRIMARY KEY CHECK(id = 1));
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','inspector')),
 active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS login_attempts (
 username TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inspections (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 payload TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
 operation_id TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inspections_owner ON inspections(account_id, updated_at);
CREATE TABLE IF NOT EXISTS sites (
 id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL,
 operation_id TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 object_key TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action TEXT NOT NULL,
 target_id TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_time ON audit(at);

CREATE TABLE IF NOT EXISTS owner_actions (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_id TEXT NOT NULL,
 action TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL
);
