-- =========================================================
-- HostelHub -- PostgreSQL schema only (no data)
-- Use this for production / when you do not want the demo accounts.
--
--   createdb roomfinder
--   psql -d roomfinder -v ON_ERROR_STOP=1 -f schema.sql
--
-- Non-destructive: every statement is IF NOT EXISTS, so it is safe
-- to run against a database that already has the tables.
-- Matches the SCHEMA string inside app.py exactly.
-- =========================================================

SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT NOT NULL CHECK(role IN ('student','owner','admin')),
    joined DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hostels (
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    college TEXT NOT NULL,
    location TEXT NOT NULL,
    distance REAL NOT NULL,
    rent INTEGER NOT NULL,
    rooms INTEGER NOT NULL,
    rating REAL NOT NULL DEFAULT 4.0,
    status TEXT NOT NULL DEFAULT 'pending',
    live BOOLEAN NOT NULL DEFAULT FALSE,
    views INTEGER NOT NULL DEFAULT 0,
    amenities TEXT NOT NULL DEFAULT '',
    description TEXT,
    image TEXT
);
ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id),
    hostel_id INTEGER NOT NULL REFERENCES hostels(id),
    status TEXT NOT NULL DEFAULT 'pending',
    date DATE NOT NULL,
    message TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_hostels_owner     ON hostels(owner_id);
CREATE INDEX IF NOT EXISTS idx_hostels_college   ON hostels(college);
CREATE INDEX IF NOT EXISTS idx_hostels_status    ON hostels(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_hostel  ON inquiries(hostel_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_student ON inquiries(student_id);

COMMIT;
