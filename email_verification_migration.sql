BEGIN;

-- If this column is new, existing accounts are marked verified.
-- New registrations will explicitly set email_verified = FALSE.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified
        BOOLEAN NOT NULL DEFAULT TRUE;

-- Add verification-token storage without changing existing accounts.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ;

-- Future inserts that omit this column default to unverified.
ALTER TABLE users
    ALTER COLUMN email_verified SET DEFAULT FALSE;

COMMIT;
