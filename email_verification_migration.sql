BEGIN;

-- Add the column as verified for existing accounts if it is missing.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified
        BOOLEAN NOT NULL DEFAULT TRUE;

-- Preserve accounts that existed before email verification was introduced.
-- Only do this when the column was newly introduced, not on every migration run.
-- See the safer migration instructions below before applying this SQL.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMPTZ;

-- New registrations must default to unverified.
ALTER TABLE users
    ALTER COLUMN email_verified SET DEFAULT FALSE;

COMMIT;
