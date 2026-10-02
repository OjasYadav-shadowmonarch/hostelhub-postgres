-- =========================================================
-- HostelHub -- PostgreSQL database file (schema + demo data)
--
-- Attach / import it into an empty database:
--   createdb roomfinder
--   psql -d roomfinder -v ON_ERROR_STOP=1 -f database.sql
-- (or open it in pgAdmin / DBeaver Query Tool and run it)
--
-- Safe to re-run: tables are CREATE ... IF NOT EXISTS and the demo rows
-- use ON CONFLICT (id) DO NOTHING, so nothing existing is overwritten.
-- For a completely fresh start, uncomment the DROP lines below first.
--
-- Demo logins -- every account uses password:  demo123
--                except 'admin' whose password is:  hostelhub123
-- (Do not load the demo rows into a production database; use schema.sql.)
-- =========================================================

SET client_encoding = 'UTF8';

-- DROP TABLE IF EXISTS inquiries CASCADE;
-- DROP TABLE IF EXISTS hostels   CASCADE;
-- DROP TABLE IF EXISTS users     CASCADE;

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

-- ---------------------------------------------------------
-- Demo data
-- ---------------------------------------------------------

INSERT INTO users (id, name, username, email, phone, role, joined, status, password_hash) VALUES
(1, 'Sunita Devi', 'sunita', 'sunita@example.com', '9123456780', 'owner', '2024-01-05', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(2, 'Vikram Patel', 'vikram', 'vikram@example.com', '9876543212', 'owner', '2024-03-15', 'inactive', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(3, 'Rahul Mehta', 'rahul', 'rahul@example.com', '9001122334', 'student', '2024-01-01', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(4, 'Anjali Gupta', 'anjali', 'anjali@example.com', '9001122335', 'student', '2024-02-01', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(5, 'Vikram Rao', 'vikramrao', 'vikram.s@example.com', '9001122336', 'student', '2024-03-01', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(6, 'Priya Nair', 'priyanair', 'priya.n@example.com', '9001122337', 'student', '2024-03-15', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(7, 'Admin User', 'admin', 'admin@hostelhub.com', '9000000000', 'admin', '2023-01-01', 'active', 'scrypt:32768:8:1$cwEqLtvrnLvt6swG$05bcffe124a4f1a1c0cc2458d85e84d8a256a8e8cdc6ff0cbed50aa06109cbb4024e41e5c2cfbf311584b4f3db07f6daf594ada3eb4f64d35888a8995a667cc4'),
(8, 'Priya Sharma', 'priya', 'priya.sharma@example.com', '9876543210', 'owner', '2024-01-10', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(9, 'Karan Singh', 'karan', 'karan@example.com', '9001122338', 'student', '2024-04-02', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05'),
(10, 'Neha Verma', 'neha', 'neha@example.com', '9001122339', 'student', '2024-04-20', 'active', 'scrypt:32768:8:1$jpg8CC1v9o85YAyH$4c628b8d43c4d94e895f55c2b140c69943a7cd8d1071df743b7b5c1371f6f2c0e558c0cdb808b8246620da0cf242f5af29dfe2a12b50b02403ab3355080ede05')
ON CONFLICT (id) DO NOTHING;

INSERT INTO hostels (id, name, type, owner_id, college, location, distance, rent, rooms, rating, status, live, views, amenities, description, image) VALUES
(1, 'Comfort Boys PG', 'Boys Hostel', 1, 'Delhi University (North Campus)', '0.5km from University Main Gate', 0.5, 7500, 20, 4.1, 'verified', TRUE, 145, 'wifi,security,power', 'A quiet, secure PG for boys right by the main gate — five minutes to every lecture hall.', NULL),
(2, 'Elite Girls Residency', 'Girls Hostel', 8, 'Delhi University (North Campus)', 'Near Engineering Block, College Road', 0.8, 9000, 32, 4.6, 'verified', TRUE, 518, 'wifi,ac,food,laundry,security', 'Premium girls'' residency with home-style meals, daily housekeeping and a warm, supervised community.', NULL),
(3, 'Campus View PG', 'PG/Rooms', 2, 'Delhi University (North Campus)', 'Opposite Main Library, Campus Road', 0.3, 8500, 15, 3.9, 'pending', FALSE, 0, 'wifi,study', 'Compact rooms directly opposite the main library — built for late-night study sessions.', NULL),
(4, 'Sunshine Boys Hostel', 'Boys Hostel', 1, 'IIT Delhi', '1km from University, Market Street', 1.0, 7000, 25, 4.0, 'verified', TRUE, 289, 'wifi,food,power,gym', 'Budget-friendly rooms a short walk from the market, with a small in-house gym.', NULL),
(5, 'Heritage Girls Hostel', 'Girls Hostel', 8, 'IIT Delhi', 'Old Campus Road, Heritage Colony', 1.2, 8200, 18, 4.4, 'verified', TRUE, 401, 'wifi,ac,food,laundry,security,study', 'A well-established hostel in a leafy colony, known for its strict security and study rooms.', NULL),
(6, 'Student PG Rooms', 'PG/Rooms', 1, 'IIT Delhi', 'Back Gate Area, Student Lane', 0.6, 6500, 12, 3.8, 'verified', TRUE, 210, 'wifi,power', 'No-frills rooms near the back gate — the cheapest verified option close to campus.', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inquiries (id, student_id, hostel_id, status, date, message) VALUES
(1, 3, 1, 'responded', '2024-05-02', 'Is the room still available for this semester?'),
(2, 4, 2, 'pending', '2024-05-10', 'Can I schedule a visit this weekend?'),
(3, 5, 4, 'responded', '2024-05-11', 'Do you offer monthly or semester-long contracts?'),
(4, 6, 5, 'pending', '2024-05-14', 'Is food included in the rent you listed?')
ON CONFLICT (id) DO NOTHING;

-- The rows above use explicit ids, so move the SERIAL sequences past them;
-- otherwise the next signup / listing / inquiry would collide.
SELECT setval(pg_get_serial_sequence('users', 'id'),     (SELECT MAX(id) FROM users));
SELECT setval(pg_get_serial_sequence('hostels', 'id'),   (SELECT MAX(id) FROM hostels));
SELECT setval(pg_get_serial_sequence('inquiries', 'id'), (SELECT MAX(id) FROM inquiries));

COMMIT;
