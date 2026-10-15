
BEGIN;

-- Preserve existing accounts as verified when adding this column.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified
        BOOLEAN NOT NULL DEFAULT TRUE;

-- New accounts created by the application must be unverified.
ALTER TABLE users
    ALTER COLUMN email_verified SET DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ;

COMMIT;
