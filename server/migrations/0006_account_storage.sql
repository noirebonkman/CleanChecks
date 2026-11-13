-- Expand, rather than remove legacy columns: the running previous Worker and
-- rollback releases must remain usable while this migration is being deployed.
CREATE TABLE account_profiles (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    display_name TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
);
CREATE TABLE account_credentials (
    account_id TEXT PRIMARY KEY REFERENCES accounts(id),
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
    temporary_expires_at INTEGER
);

INSERT INTO account_profiles(account_id,display_name)
SELECT id,display_name FROM accounts;
INSERT INTO account_credentials(account_id,password_hash,must_change_password,temporary_expires_at)
SELECT id,password_hash,must_change_password,temporary_expires_at FROM accounts;

-- Compatibility mirrors contain ciphertext / password hashes, never plaintext.
-- The WHEN/WHERE guards also make the bridges safe with recursive triggers on.
CREATE TRIGGER account_storage_insert AFTER INSERT ON accounts
BEGIN
    INSERT INTO account_profiles(account_id,display_name) VALUES(NEW.id,NEW.display_name)
    ON CONFLICT(account_id) DO NOTHING;
    INSERT INTO account_credentials(account_id,password_hash,must_change_password,temporary_expires_at)
    VALUES(NEW.id,NEW.password_hash,NEW.must_change_password,NEW.temporary_expires_at)
    ON CONFLICT(account_id) DO NOTHING;
END;
CREATE TRIGGER account_profile_legacy_update AFTER UPDATE OF display_name ON accounts
WHEN NEW.display_name IS NOT OLD.display_name
BEGIN
    UPDATE account_profiles SET display_name=NEW.display_name,revision=revision+1
    WHERE account_id=NEW.id AND display_name IS NOT NEW.display_name;
END;
CREATE TRIGGER account_profile_update AFTER UPDATE OF display_name ON account_profiles
WHEN NEW.display_name IS NOT OLD.display_name
BEGIN
    UPDATE account_profiles SET revision=revision+1
    WHERE account_id=NEW.account_id AND revision=OLD.revision;
    UPDATE accounts SET display_name=NEW.display_name
    WHERE id=NEW.account_id AND display_name IS NOT NEW.display_name;
END;
CREATE TRIGGER account_credentials_legacy_update
AFTER UPDATE OF password_hash,must_change_password,temporary_expires_at ON accounts
WHEN NEW.password_hash IS NOT OLD.password_hash
    OR NEW.must_change_password IS NOT OLD.must_change_password
    OR NEW.temporary_expires_at IS NOT OLD.temporary_expires_at
BEGIN
    UPDATE account_credentials SET password_hash=NEW.password_hash,
        must_change_password=NEW.must_change_password,temporary_expires_at=NEW.temporary_expires_at
    WHERE account_id=NEW.id AND (password_hash IS NOT NEW.password_hash
        OR must_change_password IS NOT NEW.must_change_password
        OR temporary_expires_at IS NOT NEW.temporary_expires_at);
END;
CREATE TRIGGER account_credentials_update
AFTER UPDATE OF password_hash,must_change_password,temporary_expires_at ON account_credentials
WHEN NEW.password_hash IS NOT OLD.password_hash
    OR NEW.must_change_password IS NOT OLD.must_change_password
    OR NEW.temporary_expires_at IS NOT OLD.temporary_expires_at
BEGIN
    UPDATE accounts SET password_hash=NEW.password_hash,
        must_change_password=NEW.must_change_password,temporary_expires_at=NEW.temporary_expires_at
    WHERE id=NEW.account_id AND (password_hash IS NOT NEW.password_hash
        OR must_change_password IS NOT NEW.must_change_password
        OR temporary_expires_at IS NOT NEW.temporary_expires_at);
END;

CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at);
CREATE INDEX inspections_recent ON inspections(deleted,updated_at DESC,id DESC);
CREATE INDEX owner_actions_time ON owner_actions(at DESC,id DESC);
CREATE INDEX audit_actor_time ON audit(actor_id,at DESC);
CREATE INDEX inspection_photos_record ON inspection_photos(record_id,account_id,staged_at);
