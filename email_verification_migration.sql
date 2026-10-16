BEGIN;

-- Keep existing accounts verified so current users are not locked out.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE;

-- New accounts must explicitly be marked unverified during signup.
ALTER TABLE users
ALTER COLUMN email_verified SET DEFAULT FALSE;

-- Store only a hash of the verification token, never the raw token.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verification_last_sent_at TIMESTAMPTZ;

COMMIT;
