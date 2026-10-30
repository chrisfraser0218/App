-- Add authentication without changing any existing financial record or owner.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN username VARCHAR(32);
ALTER TABLE users ADD COLUMN credential_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username);
ALTER TABLE users ADD CONSTRAINT ck_users_username CHECK
    (username IS NULL OR (username = LOWER(username) AND username ~ '^[a-z][a-z0-9_]{2,31}$'));

-- Old identities stay locked until the Mac owner provisions credentials locally.
-- No passwords, sample financial data, ownership transfers or financial updates.
