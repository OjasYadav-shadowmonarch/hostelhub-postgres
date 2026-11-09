"""
HostelHub backend (PostgreSQL edition)
========================================
A single-file Flask app that:
  1. Serves the front end (index.html / style.css / script.js) as static
     files, so the whole thing runs from ONE command:
         python app.py
  2. Exposes a JSON REST API under /api/... backed by PostgreSQL.

Configuration comes from environment variables, loaded from a `.env`
file next to this script (see .env.example):
  DATABASE_URL            full connection URL (wins if set), or
  PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
  SECRET_KEY              Flask session-signing key
  FLASK_DEBUG, HOST, PORT dev-server options

Same routes, same JSON shapes, same script.js as the SQLite version --
only the storage layer changed.
"""
# GitHub 1st deployment test - 2026-10-03
import hashlib
import hmac
import os
import re
import secrets
import time
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit

import requests
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, request, session, send_from_directory
from psycopg2 import errors as pg_errors
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Read .env (if present) into os.environ. Real environment variables that
# are already set take priority over the file.
load_dotenv(os.path.join(BASE_DIR, ".env"))


def env_bool(name, default=False):
    """Read a boolean environment setting, using default when it is absent."""
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def env_int(name, default, minimum=None, maximum=None):
    """Read an integer setting, falling back on invalid input and clamping bounds."""
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        value = int(default)
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


# A known fallback secret lets anyone forge session cookies. Refuse to start
# without a real key instead. Generate one with:
#   python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY = (os.environ.get("SECRET_KEY") or "").strip()
if len(SECRET_KEY) < 32:
    raise SystemExit(
        "SECRET_KEY is missing or too short. Set a random value of at least "
        "32 characters in the environment (or .env) before starting HostelHub."
    )

DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "")  # only used by the optional demo seeder

# Set these securely in Render Environment Variables.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^\d{10}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")

SESSION_LIFETIME_HOURS = env_int("SESSION_LIFETIME_HOURS", 12, 1, 168)
SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_HOURS * 60 * 60
TRUST_PROXY = env_bool("TRUST_PROXY", False)
CSRF_COOKIE_NAME = "hostelhub_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"

app = Flask(__name__, static_folder=None)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(hours=SESSION_LIFETIME_HOURS)
app.config.update(
    SESSION_COOKIE_NAME="hostelhub_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=env_bool("SESSION_COOKIE_SECURE", False),
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,
)

if TRUST_PROXY:
    # Trust one proxy hop. It supplies the client IP, protocol and host used
    # for rate limiting, secure-request detection and HSTS.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Rate limiting is stored in PostgreSQL so it is shared by every worker.
# A fixed window is sufficient here: these are abuse controls, not billing.
_last_rate_cleanup = 0.0
RATE_LIMIT_RETENTION_SECONDS = 24 * 60 * 60
RATE_LIMIT_CLEANUP_INTERVAL = 60 * 60


def client_ip():
    """Return the caller's address after the optional trusted-proxy fix."""
    return request.remote_addr or "unknown"


def rate_limited(bucket, limit, window_seconds, key=None):
    """Record a hit in a shared fixed window and return whether it exceeds limit."""
    now = time.time()
    window_start = int(now // window_seconds) * window_seconds
    bucket_key = str(key or client_ip())
    db = get_db()
    row = db.execute(
        "INSERT INTO rate_limit_windows (bucket, key, window_start, hits) "
        "VALUES (%s, %s, to_timestamp(%s), 1) "
        "ON CONFLICT (bucket, key) DO UPDATE SET "
        "hits = CASE WHEN rate_limit_windows.window_start = EXCLUDED.window_start "
        "THEN rate_limit_windows.hits + 1 ELSE 1 END, "
        "window_start = EXCLUDED.window_start "
        "RETURNING hits",
        (bucket, bucket_key, window_start),
    ).fetchone()
    db.commit()

    global _last_rate_cleanup
    if now - _last_rate_cleanup >= RATE_LIMIT_CLEANUP_INTERVAL:
        _last_rate_cleanup = now
        db.execute(
            "DELETE FROM rate_limit_windows WHERE window_start < to_timestamp(%s)",
            (now - RATE_LIMIT_RETENTION_SECONDS,),
        )
        db.commit()

    return bool(row and row["hits"] > limit)


def same_origin(value):
    """Return whether a URL has the same case-insensitive netloc as the request host."""
    if not value:
        return False
    try:
        return urlsplit(value).netloc.lower() == request.host.lower()
    except ValueError:
        return False


@app.before_request
def protect_state_changing_requests():
    """Reject cross-site API writes and require a double-submit CSRF token."""
    if request.method in ("GET", "HEAD", "OPTIONS", "TRACE"):
        return None
    if not request.path.startswith("/api/"):
        return None

    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")
    if origin and not same_origin(origin):
        return error("Cross-site request blocked.", 403)
    if not origin and referer and not same_origin(referer):
        return error("Cross-site request blocked.", 403)
    if (
        not origin
        and not referer
        and request.headers.get("Sec-Fetch-Site", "").lower() == "cross-site"
    ):
        return error("Cross-site request blocked.", 403)

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get(CSRF_HEADER_NAME)
    if (
        not cookie_token
        or not header_token
        or not hmac.compare_digest(cookie_token, header_token)
    ):
        return error("Security token missing or invalid. Refresh and try again.", 403)

    return None


def get_or_create_csrf_token():
    """Reuse the request or cookie CSRF token, generating one when absent."""
    token = getattr(g, "csrf_token", None)
    if token:
        return token
    token = request.cookies.get(CSRF_COOKIE_NAME) or secrets.token_urlsafe(32)
    g.csrf_token = token
    return token


@app.after_request
def add_security_headers(response):
    """Apply response security headers and issue a CSRF cookie when needed."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "geolocation=(self), camera=(), microphone=()"
    )
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; "
        "frame-ancestors 'none'; form-action 'self'; "
        "script-src 'self' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; "
        "style-src-elem 'self' https://fonts.googleapis.com https://unpkg.com; "
        "style-src-attr 'unsafe-inline'; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "img-src 'self' data: blob: https:; "
        "connect-src 'self' https://router.project-osrm.org "
        "https://tiles.openfreemap.org https://*.openstreetmap.org https://unpkg.com; "
        "worker-src 'self' blob:;",
    )
    if request.is_secure:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )

    # Double-submit CSRF cookie. It is readable by the app's same-origin
    # JavaScript, but not by other origins, and is separate from the signed
    # session cookie.
    if (
        request.method in ("GET", "HEAD")
        and not request.path.startswith("/static/")
        and not request.cookies.get(CSRF_COOKIE_NAME)
    ):
        response.set_cookie(
            CSRF_COOKIE_NAME,
            get_or_create_csrf_token(),
            max_age=SESSION_LIFETIME_SECONDS,
            secure=app.config["SESSION_COOKIE_SECURE"],
            httponly=False,
            samesite="Lax",
            path="/",
        )
    return response


@app.errorhandler(413)
def request_too_large(_exc):
    """Return a JSON size error for API requests and plain text otherwise."""
    if request.path.startswith("/api/"):
        return error("That upload is too large.", 413)
    return "Request entity too large", 413


@app.errorhandler(404)
def not_found(exc):
    """Return a JSON 404 for API requests or the original HTTP error response."""
    if request.path.startswith("/api/"):
        return error("Not found.", 404)
    return exc.get_response()


def session_signature(row):
    message = f"{row['id']}:{row['password_hash']}:{row['role']}:{row['status']}"
    return hmac.new(
        str(app.secret_key).encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def start_session(row):
    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    session["auth_sig"] = session_signature(row)
    session["auth_at"] = int(time.time())

# ---------------------------------------------------------------- #
# PostgreSQL connection settings (all from the environment / .env)
# ---------------------------------------------------------------- #

def db_config():
    """Keyword arguments for psycopg2.connect().

    DATABASE_URL wins if set (postgresql://user:pass@host:5432/dbname).
    Otherwise the individual PG* variables are used; PGPASSWORD is left
    out when unset so libpq can fall back to ~/.pgpass or trust auth.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        return {"dsn": url}
    cfg = {
        "host": os.environ.get("PGHOST", "localhost"),
        "port": os.environ.get("PGPORT", "5432"),
        "dbname": os.environ.get("PGDATABASE", "roomfinder"),
        "user": os.environ.get("PGUSER", "postgres"),
    }
    if os.environ.get("PGPASSWORD"):
        cfg["password"] = os.environ["PGPASSWORD"]
    if os.environ.get("PGSSLMODE"):
        cfg["sslmode"] = os.environ["PGSSLMODE"]
    return cfg


def connect():
    return psycopg2.connect(**db_config())


# ---------------------------------------------------------------- #
# Static "constants" (mirrors the old COLLEGES / AMENITY_DEFS in script.js)
# ---------------------------------------------------------------- #

COLLEGES = [
    "Delhi University (North Campus)",
    "IIT Delhi",
    "Jawaharlal Nehru University",
    "Jamia Millia Islamia",
    "Delhi Technological University",
    "Shivaji University",
    "COEP Technological University",
    "Vishwakarma Institute of Technology",
    "KIT's College of Engineering Kolhapur (Empowered Autonomous)",
]

AMENITY_DEFS = [
    {"id": "wifi", "label": "Free WiFi", "icon": "📶"},
    {"id": "ac", "label": "Air Conditioning", "icon": "❄️"},
    {"id": "food", "label": "Food Included", "icon": "🍱"},
    {"id": "laundry", "label": "Laundry", "icon": "🧺"},
    {"id": "security", "label": "24/7 Security", "icon": "🛡️"},
    {"id": "power", "label": "Power Backup", "icon": "🔌"},
    {"id": "gym", "label": "Gym", "icon": "🏋️"},
    {"id": "study", "label": "Study Lounge", "icon": "📚"},
]


# ---------------------------------------------------------------- #
# Database helpers
# ---------------------------------------------------------------- #

class PGConn:
    """Thin wrapper so route code can keep calling
    db.execute(sql, params).fetchone()/.fetchall() like it did with
    sqlite3, instead of juggling cursors everywhere. Rows come back as
    dicts, so row["column"] works exactly as before."""

    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, seq_of_params):
        cur = self.conn.cursor()
        cur.executemany(sql, seq_of_params)
        return cur

    def executescript(self, sql):
        cur = self.conn.cursor()
        cur.execute(sql)
        return cur

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


def get_db():
    if "db" not in g:
        g.db = PGConn(connect())
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()  # closing with an open transaction rolls it back


# Keep this in sync with schema.sql / database.sql. Every statement is
# IF NOT EXISTS, so running it against an existing database is safe.
SCHEMA = """
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
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
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

ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS food_type TEXT DEFAULT 'Veg & Non-Veg';

ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS curfew TEXT DEFAULT '10:00 PM';

ALTER TABLE hostels
ADD COLUMN IF NOT EXISTS sharing_pricing TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id),
    hostel_id INTEGER NOT NULL REFERENCES hostels(id),
    status TEXT NOT NULL DEFAULT 'pending',
    date DATE NOT NULL,
    message TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wishlists (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hostel_id INTEGER NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, hostel_id)
);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    bucket TEXT NOT NULL,
    key TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_hostels_owner     ON hostels(owner_id);
CREATE INDEX IF NOT EXISTS idx_hostels_college   ON hostels(college);
CREATE INDEX IF NOT EXISTS idx_hostels_status    ON hostels(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_hostel  ON inquiries(hostel_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_student ON inquiries(student_id);
CREATE INDEX IF NOT EXISTS idx_reviews_hostel    ON reviews(hostel_id);
CREATE INDEX IF NOT EXISTS idx_reviews_student   ON reviews(student_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_student ON wishlists(student_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_hostel  ON wishlists(hostel_id);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_windows(window_start);
"""

# (id, name, username, email, phone, role, joined, status) -- password hash is added at insert time
DEMO_USERS = [
    (1, "Sunita Devi", "sunita", "sunita@example.com", "9123456780", "owner", "2024-01-05", "active"),
    (2, "Vikram Patel", "vikram", "vikram@example.com", "9876543212", "owner", "2024-03-15", "inactive"),
    (3, "Rahul Mehta", "rahul", "rahul@example.com", "9001122334", "student", "2024-01-01", "active"),
    (4, "Anjali Gupta", "anjali", "anjali@example.com", "9001122335", "student", "2024-02-01", "active"),
    (5, "Vikram Rao", "vikramrao", "vikram.s@example.com", "9001122336", "student", "2024-03-01", "active"),
    (6, "Priya Nair", "priyanair", "priya.n@example.com", "9001122337", "student", "2024-03-15", "active"),
    (7, "Admin User", "admin", "admin@hostelhub.com", "9000000000", "admin", "2023-01-01", "active"),
    (8, "Priya Sharma", "priya", "priya.sharma@example.com", "9876543210", "owner", "2024-01-10", "active"),
    (9, "Karan Singh", "karan", "karan@example.com", "9001122338", "student", "2024-04-02", "active"),
    (10, "Neha Verma", "neha", "neha@example.com", "9001122339", "student", "2024-04-20", "active"),
]

# (id, name, type, owner_id, college, location, distance, rent, rooms, rating,
#  status, live, views, amenities, description, image)
DEMO_HOSTELS = [
    (1, "Comfort Boys PG", "Boys Hostel", 1, COLLEGES[0], "0.5km from University Main Gate", 0.5,
     7500, 20, 4.1, "verified", True, 145, "wifi,security,power",
     "A quiet, secure PG for boys right by the main gate — five minutes to every lecture hall.", None),
    (2, "Elite Girls Residency", "Girls Hostel", 8, COLLEGES[0], "Near Engineering Block, College Road", 0.8,
     9000, 32, 4.6, "verified", True, 518, "wifi,ac,food,laundry,security",
     "Premium girls' residency with home-style meals, daily housekeeping and a warm, supervised community.", None),
    (3, "Campus View PG", "PG/Rooms", 2, COLLEGES[0], "Opposite Main Library, Campus Road", 0.3,
     8500, 15, 3.9, "pending", False, 0, "wifi,study",
     "Compact rooms directly opposite the main library — built for late-night study sessions.", None),
    (4, "Sunshine Boys Hostel", "Boys Hostel", 1, COLLEGES[1], "1km from University, Market Street", 1.0,
     7000, 25, 4.0, "verified", True, 289, "wifi,food,power,gym",
     "Budget-friendly rooms a short walk from the market, with a small in-house gym.", None),
    (5, "Heritage Girls Hostel", "Girls Hostel", 8, COLLEGES[1], "Old Campus Road, Heritage Colony", 1.2,
     8200, 18, 4.4, "verified", True, 401, "wifi,ac,food,laundry,security,study",
     "A well-established hostel in a leafy colony, known for its strict security and study rooms.", None),
    (6, "Student PG Rooms", "PG/Rooms", 1, COLLEGES[1], "Back Gate Area, Student Lane", 0.6,
     6500, 12, 3.8, "verified", True, 210, "wifi,power",
     "No-frills rooms near the back gate — the cheapest verified option close to campus.", None),
]

# (id, student_id, hostel_id, status, date, message)
DEMO_INQUIRIES = [
    (1, 3, 1, "responded", "2024-05-02", "Is the room still available for this semester?"),
    (2, 4, 2, "pending", "2024-05-10", "Can I schedule a visit this weekend?"),
    (3, 5, 4, "responded", "2024-05-11", "Do you offer monthly or semester-long contracts?"),
    (4, 6, 5, "pending", "2024-05-14", "Is food included in the rent you listed?"),
]

# SERIAL sequences don't know about the explicit ids the demo rows use --
# bump them past the highest id so the next signup / listing / inquiry
# doesn't collide with a seeded row.
SYNC_SEQUENCES = (
    "SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT MAX(id) FROM users)); "
    "SELECT setval(pg_get_serial_sequence('hostels', 'id'), (SELECT MAX(id) FROM hostels)); "
    "SELECT setval(pg_get_serial_sequence('inquiries', 'id'), (SELECT MAX(id) FROM inquiries));"
)


def create_schema(db):
    db.executescript(SCHEMA)


def insert_demo_data(db):
    """Insert demo records, requiring configured passwords before creating accounts."""
    if not (DEMO_PASSWORD and ADMIN_USERNAME and ADMIN_PASSWORD):
        raise RuntimeError(
            "DEMO_PASSWORD, ADMIN_USERNAME and ADMIN_PASSWORD must all be set "
            "before loading the demo dataset. Refusing to create accounts "
            "with blank passwords."
        )
    ph = generate_password_hash(DEMO_PASSWORD)
    ph_admin = generate_password_hash(ADMIN_PASSWORD)
    db.executemany(
        "INSERT INTO users (id, name, username, email, phone, role, joined, status, password_hash) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [u + (ph_admin if u[2] == ADMIN_USERNAME else ph,) for u in DEMO_USERS],
    )
    db.executemany(
        "INSERT INTO hostels (id, name, type, owner_id, college, location, distance, rent, rooms, rating, "
        "status, live, views, amenities, description, image) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        DEMO_HOSTELS,
    )
    db.executemany(
        "INSERT INTO inquiries (id, student_id, hostel_id, status, date, message) VALUES (%s,%s,%s,%s,%s,%s)",
        DEMO_INQUIRIES,
    )
    db.executescript(SYNC_SEQUENCES)


def ensure_configured_admin(db, strict=False):
    """Provision the environment-configured administrator if needed.

    Existing accounts are never overwritten or silently promoted. In strict
    mode (used after a destructive demo reset) a conflicting non-admin
    username aborts the transaction instead of leaving no usable admin.
    """
    if not (ADMIN_USERNAME and ADMIN_PASSWORD):
        return

    existing_admin = db.execute(
        "SELECT id, role FROM users WHERE lower(username)=lower(%s)",
        (ADMIN_USERNAME,),
    ).fetchone()

    if existing_admin:
        if existing_admin["role"] != "admin":
            message = (
                "Configured ADMIN_USERNAME matches a non-admin account; "
                "refusing to promote it automatically."
            )
            if strict:
                raise RuntimeError(message)
            app.logger.warning(message)
        return

    db.execute(
        """
        INSERT INTO users
            (name, username, email, phone, role,
             joined, status, password_hash)
        VALUES (%s, %s, %s, %s, 'admin', %s, 'active', %s)
        """,
        (
            "HostelHub Administrator",
            ADMIN_USERNAME,
            None,
            None,
            date.today().isoformat(),
            generate_password_hash(ADMIN_PASSWORD),
        ),
    )


def seed(db):
    """Wipe everything and rebuild with the optional demo dataset.

    This is not used by the administrator reset endpoint, which keeps the
    signed-in administrator account. Callers must explicitly opt in.
    """
    db.executescript(
        "DROP TABLE IF EXISTS reviews CASCADE; "
        "DROP TABLE IF EXISTS wishlists CASCADE; "
        "DROP TABLE IF EXISTS inquiries CASCADE; "
        "DROP TABLE IF EXISTS rate_limit_windows CASCADE; "
        "DROP TABLE IF EXISTS hostels CASCADE; "
        "DROP TABLE IF EXISTS users CASCADE;"
    )
    create_schema(db)
    insert_demo_data(db)
    ensure_configured_admin(db, strict=True)
    db.commit()


def init_db():
    """Create the schema and provision the configured administrator."""
    try:
        conn = connect()
    except psycopg2.OperationalError as exc:
        raise SystemExit(
            "Could not connect to PostgreSQL. Check DATABASE_URL (or "
            "PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD) "
            "in your environment, and confirm the database exists.\n\n"
            + str(exc)
        )

    db = PGConn(conn)

    try:
        create_schema(db)
        ensure_configured_admin(db)
        db.commit()

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


# ---------------------------------------------------------------- #
# Serialization helpers (snake_case DB rows -> camelCase JSON,
# matching the field names script.js already expects)
# ---------------------------------------------------------------- #

def user_public(row, include_contact=True):
    """Serialize a user without credentials, optionally blanking contact details."""
    data = {
        "id": row["id"], "name": row["name"], "username": row["username"],
        "email": row["email"], "phone": row["phone"], "role": row["role"],
        "joined": str(row["joined"]), "status": row["status"],
    }
    if not include_contact:
        data["email"] = ""
        data["phone"] = ""
    return data


def hostel_public(row):
    return {
        "id": row["id"], "name": row["name"], "type": row["type"],
        "ownerId": row["owner_id"], "college": row["college"], "location": row["location"],
        "latitude": row.get("latitude") if isinstance(row, dict) else getattr(row, "latitude", None),
        "longitude": row.get("longitude") if isinstance(row, dict) else getattr(row, "longitude", None),
        "distance": row["distance"], "rent": row["rent"], "rooms": row["rooms"],
        "rating": row["rating"], "status": row["status"], "live": bool(row["live"]),
        "views": row["views"],
        "amenities": [a for a in row["amenities"].split(",") if a] if row.get("amenities") else [],
        "description": row.get("description"), "image": row.get("image"),
        "curfew": row.get("curfew") or "10:00 PM",
        "foodType": row.get("food_type") or "Veg & Non-Veg",
        "sharingPricing": row.get("sharing_pricing") or "",
        "ownerPhone": row.get("owner_phone") or "",
        "ownerName": row.get("owner_name") or "",
    }


def inquiry_public(row):
    return {
        "id": row["id"], "studentId": row["student_id"], "hostelId": row["hostel_id"],
        "status": row["status"], "date": str(row["date"]), "message": row["message"],
    }


ALLOWED_HOSTEL_TYPES = {"Boys Hostel", "Girls Hostel", "PG/Rooms"}
ALLOWED_AMENITIES = {item["id"] for item in AMENITY_DEFS}
ALLOWED_COLLEGES = set(COLLEGES)
MAX_IMAGE_LENGTH = 4_000_000
IMAGE_DATA_RE = re.compile(
    r"^data:image/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$",
    re.IGNORECASE,
)
IMAGE_URL_RE = re.compile(r"^https?://[^\s\"'<>]{1,2048}$", re.IGNORECASE)


class ValidationError(ValueError):
    pass


def clean_image_value(value):
    """Normalize an optional image value or raise ValidationError for invalid input."""
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError("The listing image is invalid.")
    value = value.strip()
    if len(value) > MAX_IMAGE_LENGTH:
        raise ValidationError("The listing image is too large.")
    if value.startswith("data:image/"):
        if not IMAGE_DATA_RE.match(value):
            raise ValidationError("Please upload a PNG, JPEG, GIF or WebP image.")
        return value
    if not IMAGE_URL_RE.match(value):
        raise ValidationError("Please provide a valid image URL.")
    return value


def listing_payload(data, existing=None):
    """Validate and normalise the owner's listing form payload."""
    existing = existing or {}

    def text_value(key, fallback, limit, label):
        """Read and trim a text field, rejecting values longer than its limit."""
        raw = data.get(key, fallback)
        if raw is None:
            raw = fallback
        raw = str(raw).strip()
        if len(raw) > limit:
            raise ValidationError(f"{label} is too long (maximum {limit} characters).")
        return raw

    def number_value(key, fallback, label, cast, minimum, maximum):
        """Parse a numeric field and raise ValidationError if invalid or out of bounds."""
        raw = data.get(key, fallback)
        if raw in (None, ""):
            raw = fallback
        try:
            value = cast(raw)
        except (TypeError, ValueError):
            raise ValidationError(f"Please enter a valid {label}.")
        if value < minimum or value > maximum:
            raise ValidationError(f"Please enter a valid {label}.")
        return value

    name = text_value("name", existing.get("name", ""), 120, "Property name")
    location = text_value("location", existing.get("location", ""), 200, "Location")
    if not name or not location:
        raise ValidationError("Please fill in property name, location and rent.")

    hostel_type = text_value("type", existing.get("type", "Boys Hostel"), 40, "Property type")
    if hostel_type not in ALLOWED_HOSTEL_TYPES:
        raise ValidationError("Please choose a valid property type.")

    college = text_value("college", existing.get("college", COLLEGES[0]), 160, "College")
    if college not in ALLOWED_COLLEGES:
        raise ValidationError("Please choose a valid college.")

    rent = number_value("rent", existing.get("rent", 0), "monthly rent", int, 1, 1_000_000)
    rooms = number_value("rooms", existing.get("rooms", 1), "room count", int, 1, 10_000)
    distance = number_value(
        "distance", existing.get("distance", 0.5), "distance", float, 0, 1_000
    )

    amenities = data.get("amenities", None)
    if amenities is None:
        fallback = existing.get("amenities", "")
        amenities = fallback.split(",") if isinstance(fallback, str) else []
    if not isinstance(amenities, list):
        raise ValidationError("Please choose valid amenities.")
    cleaned_amenities = []
    for amenity in amenities:
        if not isinstance(amenity, str) or amenity not in ALLOWED_AMENITIES:
            raise ValidationError("Please choose valid amenities.")
        if amenity not in cleaned_amenities:
            cleaned_amenities.append(amenity)

    description = text_value(
        "description", existing.get("description", "") or "", 2000, "Description"
    )
    image = clean_image_value(data.get("image", existing.get("image")))

    latitude = data.get("latitude", existing.get("latitude"))
    longitude = data.get("longitude", existing.get("longitude"))
    if latitude in ("", None):
        latitude = None
    else:
        try:
            latitude = float(latitude)
        except (TypeError, ValueError):
            raise ValidationError("Please enter a valid latitude.")
        if latitude < -90 or latitude > 90:
            raise ValidationError("Please enter a valid latitude.")
    if longitude in ("", None):
        longitude = None
    else:
        try:
            longitude = float(longitude)
        except (TypeError, ValueError):
            raise ValidationError("Please enter a valid longitude.")
        if longitude < -180 or longitude > 180:
            raise ValidationError("Please enter a valid longitude.")

    return {
        "name": name,
        "type": hostel_type,
        "college": college,
        "location": location,
        "distance": distance,
        "latitude": latitude,
        "longitude": longitude,
        "rent": rent,
        "rooms": rooms,
        "amenities": ",".join(cleaned_amenities),
        "description": description,
        "image": image,
    }


# ---------------------------------------------------------------- #
# Auth helpers
# ---------------------------------------------------------------- #

def current_user():
    """Return the active user after validating session age and signature, or clear it."""
    uid = session.get("user_id")
    signature = session.get("auth_sig")
    issued_at = session.get("auth_at")
    if not uid or not signature or not issued_at:
        session.clear()
        return None

    try:
        issued_at = int(issued_at)
    except (TypeError, ValueError):
        session.clear()
        return None

    if time.time() - issued_at > SESSION_LIFETIME_SECONDS:
        session.clear()
        return None

    row = get_db().execute("SELECT * FROM users WHERE id=%s", (uid,)).fetchone()
    if not row or row["status"] != "active":
        session.clear()
        return None

    if not hmac.compare_digest(signature, session_signature(row)):
        session.clear()
        return None

    return row


def error(message, code=400):
    return jsonify({"error": message}), code


def rate_limit_error(retry_after=300):
    response, status = error("Too many attempts. Please try again later.", 429)
    response.headers["Retry-After"] = str(retry_after)
    return response, status


def require_login():
    user = current_user()
    if not user:
        return None, error("You need to be logged in.", 401)
    return user, None


def require_role(*roles):
    user, err = require_login()
    if err:
        return None, err
    if user["role"] not in roles:
        return None, error("You don't have permission to do that.", 403)
    return user, None


# ---------------------------------------------------------------- #
# Static front-end (index.html / style.css / script.js)
# ---------------------------------------------------------------- #

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


STATIC_EXTENSIONS = {".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2"}


@app.route("/<path:filename>")
def static_files(filename):
    # Serve only front-end assets that live next to app.py. Everything else
    # in this folder (.env with the database password, app.py, *.sql, ...)
    # must never be downloadable, so anything that isn't a whitelisted asset
    # type -- or sits behind a dotfile/dot-directory -- is a 404.
    # send_from_directory additionally guards against path traversal.
    if any(part.startswith(".") for part in filename.split("/")):
        abort(404)
    if os.path.splitext(filename)[1].lower() not in STATIC_EXTENSIONS:
        abort(404)
    return send_from_directory(BASE_DIR, filename)


# ---------------------------------------------------------------- #
# Meta / bootstrap
# ---------------------------------------------------------------- #

@app.post("/api/geocode")
def api_geocode():
    """Geocode an owner address with rate limiting and validate the returned coordinates."""
    user, err = require_role("owner")
    if err:
        return err

    if rate_limited("geocode", 30, 3600, key=str(user["id"])):
        return rate_limit_error(3600)

    data = request.get_json(silent=True) or {}
    address = str(data.get("address", "")).strip()

    if not address:
        return error("Please enter a location.", 400)
    if len(address) > 240:
        return error("Please enter a shorter location.", 400)

    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": address,
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "in",
            },
            headers={
                "User-Agent": "HostelHub/1.0 (student project)",
                "Referer": request.host_url,
            },
            timeout=10,
        )

        response.raise_for_status()
        results = response.json()

    except requests.RequestException:
        return error(
            "Unable to search the location right now. Please try again.",
            502,
        )

    if not results:
        return error(
            "Location not found. Please try a more specific address.",
            404,
        )

    result = results[0]

    try:
        latitude = float(result["lat"])
        longitude = float(result["lon"])
    except (KeyError, TypeError, ValueError):
        return error("Invalid location data received.", 502)

    return jsonify(
        {
            "ok": True,
            "latitude": latitude,
            "longitude": longitude,
            "display_name": result.get("display_name", address),
        }
    )


@app.get("/api/csrf")
def api_csrf():
    return jsonify({"token": get_or_create_csrf_token()})


@app.get("/api/meta")
def api_meta():
    return jsonify({"colleges": COLLEGES, "amenities": AMENITY_DEFS})

@app.get("/api/state")
def api_state():
    """Return only the slice of platform data the current caller may see.

    Guests receive public, live listings plus owner display names. Students
    receive their own inquiries and the owners they can contact. Owners get
    their own listings and the students who contacted them. Administrators
    receive the full dataset.
    """
    db = get_db()
    user = current_user()
    role = user["role"] if user else None

    stats_row = db.execute("""
        SELECT
            (SELECT COUNT(*) FROM users WHERE role='owner') AS owner_count,
            (SELECT COUNT(*) FROM users WHERE role='student') AS student_count,
            (SELECT COUNT(*) FROM hostels WHERE status='verified') AS verified_hostels,
            (SELECT COUNT(*) FROM hostels) AS total_hostels,
            (SELECT COUNT(*) FROM inquiries) AS total_inquiries,
            (SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0)
               FROM hostels WHERE status='verified') AS average_rating
    """).fetchone()
    stats = {
        "ownerCount": int(stats_row["owner_count"] or 0),
        "studentCount": int(stats_row["student_count"] or 0),
        "verifiedHostels": int(stats_row["verified_hostels"] or 0),
        "totalHostels": int(stats_row["total_hostels"] or 0),
        "totalInquiries": int(stats_row["total_inquiries"] or 0),
        "averageRating": float(stats_row["average_rating"] or 0),
    }

    hostel_select = """
        SELECT h.*, u.phone AS owner_phone, u.name AS owner_name
        FROM hostels h
        LEFT JOIN users u ON u.id = h.owner_id
    """

    if role == "admin":
        user_rows = db.execute("SELECT * FROM users ORDER BY id").fetchall()
        users = [user_public(r) for r in user_rows]
        hostels = [
            hostel_public(r)
            for r in db.execute(hostel_select + " ORDER BY h.id").fetchall()
        ]
        inquiries = [
            inquiry_public(r)
            for r in db.execute("SELECT * FROM inquiries ORDER BY id").fetchall()
        ]

    elif role == "owner":
        users = [user_public(user)]
        inquiries = [
            inquiry_public(r)
            for r in db.execute(
                "SELECT i.* FROM inquiries i "
                "JOIN hostels h ON h.id = i.hostel_id "
                "WHERE h.owner_id=%s ORDER BY i.id",
                (user["id"],),
            ).fetchall()
        ]
        student_ids = sorted({i["studentId"] for i in inquiries})
        if student_ids:
            users.extend(
                user_public(r)
                for r in db.execute(
                    "SELECT * FROM users WHERE id = ANY(%s) ORDER BY id",
                    (student_ids,),
                ).fetchall()
            )
        hostels = [
            hostel_public(r)
            for r in db.execute(
                hostel_select + " WHERE h.owner_id=%s ORDER BY h.id",
                (user["id"],),
            ).fetchall()
        ]

    elif role == "student":
        users = [user_public(user)]
        inquiries = [
            inquiry_public(r)
            for r in db.execute(
                "SELECT * FROM inquiries WHERE student_id=%s ORDER BY id",
                (user["id"],),
            ).fetchall()
        ]
        inquiries_for_hostels = sorted({i["hostelId"] for i in inquiries})
        visible_condition = "(h.status='verified' AND h.live=TRUE)"
        params = []
        if inquiries_for_hostels:
            visible_condition += " OR h.id = ANY(%s)"
            params.append(inquiries_for_hostels)
        hostels = [
            hostel_public(r)
            for r in db.execute(
                hostel_select + f" WHERE {visible_condition} ORDER BY h.id",
                tuple(params),
            ).fetchall()
        ]
        owner_ids = sorted({h["ownerId"] for h in hostels})
        if owner_ids:
            users.extend(
                user_public(r, include_contact=False)
                for r in db.execute(
                    "SELECT * FROM users WHERE id = ANY(%s) AND role='owner' ORDER BY id",
                    (owner_ids,),
                ).fetchall()
            )

    else:
        hostels = [
            hostel_public(r)
            for r in db.execute(
                hostel_select
                + " WHERE h.status='verified' AND h.live=TRUE ORDER BY h.id"
            ).fetchall()
        ]
        owner_ids = sorted({h["ownerId"] for h in hostels})
        users = []
        if owner_ids:
            users = [
                user_public(r, include_contact=False)
                for r in db.execute(
                    "SELECT * FROM users WHERE id = ANY(%s) AND role='owner' ORDER BY id",
                    (owner_ids,),
                ).fetchall()
            ]
        inquiries = []

    return jsonify(
        {
            "users": users,
            "hostels": hostels,
            "inquiries": inquiries,
            "stats": stats,
        }
    )

@app.route("/history")
def history():

    """Render daily activity counts for administrators or an access guidance page."""
    user, err = require_role("admin")
    if err:
        status = err[1] if isinstance(err, tuple) and len(err) > 1 else 401
        needs_login = status == 401
        access_title = "Sign in to continue" if needs_login else "Administrator access only"
        access_copy = (
            "This daily operations summary is reserved for HostelHub "
            "administrators. Open HostelHub, sign in with your admin account, "
            "then return to this page."
            if needs_login else
            "Your account is signed in, but it does not have administrator "
            "permissions. Switch to an admin account to view today's summary."
        )
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070a12">
  <meta name="robots" content="noindex, nofollow">
  <title>{access_title} - HostelHub Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/pro/history.css">
</head>
<body>
  <header class="hh-hist-topbar">
    <div class="hh-hist-topbar-inner">
      <a class="hh-hist-brand" href="/" aria-label="HostelHub home">
        <span class="hh-hist-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10.8 12 3.5l9 7.3"></path>
            <path d="M5.5 9.5V20h13V9.5"></path>
            <path d="M9.5 20v-5.5h5V20"></path>
          </svg>
        </span>
        <span class="hh-hist-brand-name">Hostel<span>Hub</span></span>
      </a>
      <span class="hh-hist-tag">Admin console</span>
      <div class="hh-hist-topbar-actions">
        <a class="hh-hist-btn hh-hist-btn-gold" href="/">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"></path>
          </svg>
          <span>HostelHub</span>
        </a>
      </div>
    </div>
  </header>

  <main class="hh-hist-access-wrap">
    <section class="hh-hist-access" aria-labelledby="hhHistAccessTitle">
      <span class="hh-hist-access-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 4.5 6v5.5c0 4.4 3 8.1 7.5 9.5 4.5-1.4 7.5-5.1 7.5-9.5V6L12 3Z"></path>
          <path d="m8.8 12.2 2.2 2.2 4.2-4.4"></path>
        </svg>
      </span>
      <p class="hh-hist-eyebrow">Daily operations</p>
      <h1 id="hhHistAccessTitle">{access_title}</h1>
      <p class="hh-hist-access-copy">{access_copy}</p>
      <div class="hh-hist-access-actions">
        <a class="hh-hist-btn hh-hist-btn-gold" href="/">Go to HostelHub</a>
        <a class="hh-hist-btn" href="/history">Try again</a>
      </div>
    </section>
  </main>
</body>
</html>
""", status

    db = get_db()
    today = date.today()

    students = db.execute(
        "SELECT COUNT(*) FROM users WHERE role='student' AND joined=%s",
        (today,)
    ).fetchone()["count"]

    owners = db.execute(
        "SELECT COUNT(*) FROM users WHERE role='owner' AND joined=%s",
        (today,)
    ).fetchone()["count"]

    inquiries = db.execute(
        "SELECT COUNT(*) FROM inquiries WHERE date=%s",
        (today,)
    ).fetchone()["count"]

    today_label = today.strftime("%A, %d %B %Y")
    today_iso = today.isoformat()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070a12">
  <meta name="robots" content="noindex, nofollow">
  <title>Daily summary - HostelHub Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/pro/history.css">
</head>
<body>
  <header class="hh-hist-topbar">
    <div class="hh-hist-topbar-inner">
      <a class="hh-hist-brand" href="/" aria-label="HostelHub home">
        <span class="hh-hist-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10.8 12 3.5l9 7.3"></path>
            <path d="M5.5 9.5V20h13V9.5"></path>
            <path d="M9.5 20v-5.5h5V20"></path>
          </svg>
        </span>
        <span class="hh-hist-brand-name">Hostel<span>Hub</span></span>
      </a>
      <span class="hh-hist-tag">Admin console</span>
      <div class="hh-hist-topbar-actions">
        <a class="hh-hist-btn" href="/history" aria-label="Refresh today's counts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 11a8.1 8.1 0 0 0-15.5-3.4L4 9"></path>
            <path d="M4 4v5h5"></path>
            <path d="M4 13a8.1 8.1 0 0 0 15.5 3.4L20 15"></path>
            <path d="M20 20v-5h-5"></path>
          </svg>
          <span>Refresh</span>
        </a>
        <a class="hh-hist-btn hh-hist-btn-gold" href="/">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"></path>
          </svg>
          <span>Dashboard</span>
        </a>
      </div>
    </div>
  </header>

  <main class="hh-hist-main">
    <p class="hh-hist-eyebrow">Daily operations</p>
    <div class="hh-hist-heading">
      <div>
        <h1>Today's summary</h1>
        <p>A live snapshot of new accounts and enquiries recorded across HostelHub today.</p>
      </div>
      <span class="hh-hist-date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2"></rect>
          <path d="M16 3v4M8 3v4M3 10h18"></path>
        </svg>
        {today_label}
      </span>
    </div>

    <section class="hh-hist-grid" aria-label="Today's activity">
      <article class="hh-hist-card students">
        <span class="hh-hist-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10 12 4 2 10l10 6 10-6Z"></path>
            <path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"></path>
          </svg>
        </span>
        <div class="hh-hist-value">{students}</div>
        <p class="hh-hist-label">Student registrations</p>
        <p class="hh-hist-note">New accounts created through the student portal today.</p>
      </article>

      <article class="hh-hist-card owners">
        <span class="hh-hist-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 10.8 12 3.5l9 7.3"></path>
            <path d="M5.5 9.5V20h13V9.5"></path>
            <path d="M9.5 20v-5.5h5V20"></path>
          </svg>
        </span>
        <div class="hh-hist-value">{owners}</div>
        <p class="hh-hist-label">Owner registrations</p>
        <p class="hh-hist-note">New property owners who joined HostelHub today.</p>
      </article>

      <article class="hh-hist-card inquiries">
        <span class="hh-hist-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"></path>
            <path d="M8 9h8M8 13h5"></path>
          </svg>
        </span>
        <div class="hh-hist-value">{inquiries}</div>
        <p class="hh-hist-label">Enquiries received</p>
        <p class="hh-hist-note">Messages sent from students to property owners today.</p>
      </article>
    </section>

    <footer class="hh-hist-footer">
      <p>Counts reflect records dated {today_iso} and refresh when this page reloads.</p>
      <a href="/">Open the dashboard
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6"></path>
        </svg>
      </a>
    </footer>
  </main>
</body>
</html>
"""


@app.get("/api/auth/me")
def api_me():
    user = current_user()
    return jsonify({"user": user_public(user) if user else None})


# ---------------------------------------------------------------- #
# Auth
# ---------------------------------------------------------------- #

@app.post("/api/auth/login")

def api_login():
    """Validate credentials and role, then start a session subject to rate limiting."""
    if rate_limited("login", 10, 300):
        return rate_limit_error(300)

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    portal = data.get("portal") or None

    if not username or not password:
        return error("Please enter both username and password.")

    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE lower(username)=lower(%s) AND deleted_at IS NULL",
        (username,)
    ).fetchone()

    if not row or not check_password_hash(row["password_hash"], password):
        return error("Invalid username or password.", 401)

    if row["status"] == "inactive":
        return error("This account has been deactivated. Contact an administrator.")

    # Only the administrator configured in the server environment
    # may bypass the portal-role match check.
    is_configured_admin = (
        bool(ADMIN_USERNAME)
        and row["role"] == "admin"
        and row["username"].lower() == ADMIN_USERNAME.lower()
    )

    if row["role"] == "admin" and not is_configured_admin:
        return error("This administrator account is not authorized.", 403)

    if portal and not is_configured_admin and row["role"] != portal:
        return error(
            f"This account is registered as {row['role']}, not {portal}.",
            409
        )

    start_session(row)
    return jsonify({"user": user_public(row)})



@app.post("/api/auth/signup")
def api_signup():
    """Validate and create a student or owner account, then start its session."""
    if rate_limited("signup", 5, 600):
        return rate_limit_error(600)

    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()
    password = data.get("password") or ""
    confirm = data.get("confirm") or ""

    requested_role = data.get("role") or "student"
    role = (
        requested_role
        if requested_role in ("student", "owner")
        else "invalid"
    )

    if not name or not username or not email or not phone or not password or not confirm:
        return error("Please fill in all required fields.")

    if len(name) > 100:
        return error("Name is too long (maximum 100 characters).")

    if not USERNAME_RE.match(username):
        return error(
            "Username must be 3-40 characters and use only letters, "
            "numbers, dots, dashes or underscores."
        )

    if len(email) > 254 or not EMAIL_RE.match(email):
        return error("Please enter a valid email address (e.g. name@example.com).")

    if not PHONE_RE.match(phone):
        return error(
            "Phone number must be exactly 10 digits, "
            "with no letters or symbols."
        )

    if len(password) < 8:
        return error("Password must be at least 8 characters.")

    if len(password) > 128:
        return error("Password is too long (maximum 128 characters).")

    if password != confirm:
        return error("Passwords do not match.")

    if role not in ("student", "owner"):
        return error(
            "Only student and owner accounts can be registered. "
            "Admin accounts are provisioned privately."
        )

    db = get_db()

    existing = db.execute(
        "SELECT id FROM users WHERE lower(username)=lower(%s)",
        (username,),
    ).fetchone()

    if existing:
        return error("That username is already taken.")

    try:
        cur = db.execute(
            "INSERT INTO users "
            "(name, username, email, phone, role, joined, status, password_hash) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id",
            (
                name,
                username,
                email,
                phone,
                role,
                date.today().isoformat(),
                "active",
                generate_password_hash(password),
            ),
        )
    except pg_errors.UniqueViolation:
        db.rollback()
        return error("That username is already taken.")

    new_id = cur.fetchone()["id"]
    db.commit()

    row = db.execute(
        "SELECT * FROM users WHERE id=%s",
        (new_id,),
    ).fetchone()

    start_session(row)

    return jsonify({"user": user_public(row)}), 201
@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.put("/api/auth/profile")
def api_update_profile():
    """Validate and save the signed-in user's contact details."""
    user, err = require_login()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()

    if not name or not email or not phone:
        return error("Name, email and phone are required.")
    if len(name) > 100 or len(email) > 254:
        return error("Please keep your name and email address within the allowed length.")
    if not EMAIL_RE.match(email):
        return error("Please enter a valid email address (e.g. name@example.com).")
    if not PHONE_RE.match(phone):
        return error("Phone number must be exactly 10 digits, with no letters or symbols.")

    db = get_db()
    db.execute("UPDATE users SET name=%s, email=%s, phone=%s WHERE id=%s", (name, email, phone, user["id"]))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=%s", (user["id"],)).fetchone()
    return jsonify({"user": user_public(row)})


@app.put("/api/auth/password")
def api_update_password():
    """Verify the current password, save its replacement and refresh the session."""
    user, err = require_login()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    current_password = data.get("currentPassword") or ""
    new_password = data.get("newPassword") or ""

    if not current_password or not new_password:
        return error("Please fill in both password fields.")
    if not check_password_hash(user["password_hash"], current_password):
        return error("Your current password is incorrect.")
    if len(new_password) < 8:
        return error("New password must be at least 8 characters.")
    if len(new_password) > 128:
        return error("New password is too long (maximum 128 characters).")

    db = get_db()
    db.execute("UPDATE users SET password_hash=%s WHERE id=%s", (generate_password_hash(new_password), user["id"]))
    db.commit()
    updated = db.execute("SELECT * FROM users WHERE id=%s", (user["id"],)).fetchone()
    start_session(updated)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- #
# Hostels
# ---------------------------------------------------------------- #

def hostel_or_404(db, hostel_id):
    return db.execute("SELECT * FROM hostels WHERE id=%s", (hostel_id,)).fetchone()


@app.post("/api/hostels")
def api_create_hostel():
    """Validate an owner listing and save it with pending approval status."""
    user, err = require_role("owner")
    if err:
        return err

    data = request.get_json(silent=True) or {}

    try:
        fields = listing_payload(data)
    except ValidationError as exc:
        return error(str(exc))

    db = get_db()

    cur = db.execute(
        "INSERT INTO hostels "
        "(name, type, owner_id, college, location, distance, "
        "latitude, longitude, rent, rooms, rating, status, live, views, "
        "amenities, description, image) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,4.0,'pending',FALSE,0,%s,%s,%s) "
        "RETURNING id",
        (
            fields["name"],
            fields["type"],
            user["id"],
            fields["college"],
            fields["location"],
            fields["distance"],
            fields["latitude"],
            fields["longitude"],
            fields["rent"],
            fields["rooms"],
            fields["amenities"],
            fields["description"],
            fields["image"],
        ),
    )

    new_id = cur.fetchone()["id"]
    db.commit()

    row = hostel_or_404(db, new_id)

    return jsonify({"hostel": hostel_public(row)}), 201

@app.put("/api/hostels/<int:hostel_id>")
def api_update_hostel(hostel_id):
    """Validate and update a listing after checking ownership or administrator access."""
    user, err = require_login()
    if err:
        return err

    db = get_db()
    h = hostel_or_404(db, hostel_id)

    if not h:
        return error("Listing not found.", 404)

    if user["role"] != "admin" and h["owner_id"] != user["id"]:
        return error("You don't have permission to edit this listing.", 403)

    data = request.get_json(silent=True) or {}

    try:
        fields = listing_payload(data, existing=h)
    except ValidationError as exc:
        return error(str(exc))

    db.execute(
        "UPDATE hostels SET "
        "name=%s, type=%s, college=%s, distance=%s, location=%s, "
        "latitude=%s, longitude=%s, rent=%s, rooms=%s, "
        "description=%s, amenities=%s, image=%s "
        "WHERE id=%s",
        (
            fields["name"],
            fields["type"],
            fields["college"],
            fields["distance"],
            fields["location"],
            fields["latitude"],
            fields["longitude"],
            fields["rent"],
            fields["rooms"],
            fields["description"],
            fields["amenities"],
            fields["image"],
            hostel_id,
        ),
    )

    db.commit()

    row = hostel_or_404(db, hostel_id)

    return jsonify({"hostel": hostel_public(row)})


@app.delete("/api/hostels/<int:hostel_id>")
def api_delete_hostel(hostel_id):
    user, err = require_login()
    if err:
        return err
    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h:
        return error("Listing not found.", 404)
    if user["role"] != "admin" and h["owner_id"] != user["id"]:
        return error("You don't have permission to delete this listing.", 403)
    db.execute("DELETE FROM inquiries WHERE hostel_id=%s", (hostel_id,))
    db.execute("DELETE FROM hostels WHERE id=%s", (hostel_id,))
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/hostels/<int:hostel_id>/toggle-availability")
def api_toggle_availability(hostel_id):
    user, err = require_role("owner")
    if err:
        return err
    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h or h["owner_id"] != user["id"]:
        return error("Listing not found.", 404)
    if h["status"] != "verified":
        return error("Only verified listings can be toggled.")
    db.execute("UPDATE hostels SET live=%s WHERE id=%s", (not h["live"], hostel_id))
    db.commit()
    return jsonify({"hostel": hostel_public(hostel_or_404(db, hostel_id))})


@app.post("/api/hostels/<int:hostel_id>/approve")
def api_approve_hostel(hostel_id):
    _, err = require_role("admin")
    if err:
        return err
    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h:
        return error("Listing not found.", 404)
    db.execute("UPDATE hostels SET status='verified', live=TRUE WHERE id=%s", (hostel_id,))
    db.commit()
    return jsonify({"hostel": hostel_public(hostel_or_404(db, hostel_id))})


@app.post("/api/hostels/<int:hostel_id>/reject")
def api_reject_hostel(hostel_id):
    _, err = require_role("admin")
    if err:
        return err
    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h:
        return error("Listing not found.", 404)
    db.execute("DELETE FROM inquiries WHERE hostel_id=%s", (hostel_id,))
    db.execute("DELETE FROM hostels WHERE id=%s", (hostel_id,))
    db.commit()
    return jsonify({"ok": True})


@app.post("/api/hostels/<int:hostel_id>/contact")
def api_contact_owner(hostel_id):
    """Create a student inquiry for a live verified listing and return owner details."""
    user = current_user()
    if not user:
        return error("Please log in to contact the hostel owner.", 401)
    if user["role"] != "student":
        return error("Only students can send inquiries to hostel owners.", 403)
    if rate_limited("contact", 20, 3600, key=str(user["id"])):
        return rate_limit_error(3600)

    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h or h["status"] != "verified" or not h["live"]:
        return error("Listing not found.", 404)

    existing = db.execute(
        "SELECT * FROM inquiries WHERE hostel_id=%s AND student_id=%s AND status='pending'",
        (hostel_id, user["id"]),
    ).fetchone()

    owner = db.execute("SELECT * FROM users WHERE id=%s", (h["owner_id"],)).fetchone()
    if not owner:
        return error("The property owner could not be reached.", 404)

    if existing:
        return jsonify({"created": False, "owner": user_public(owner)})

    message = (request.get_json(silent=True) or {}).get(
        "message", "Hi, I'm interested in this hostel — could you share more details?"
    )
    if not isinstance(message, str):
        return error("Please enter a valid message.")
    message = message.strip()
    if len(message) > 2000:
        return error("Message is too long (maximum 2000 characters).")
    if not message:
        message = "Hi, I'm interested in this hostel — could you share more details?"
    db.execute(
        "INSERT INTO inquiries (student_id, hostel_id, status, date, message) VALUES (%s,%s,%s,%s,%s)",
        (user["id"], hostel_id, "pending", date.today().isoformat(), message),
    )
    db.execute("UPDATE hostels SET views = views + 1 WHERE id=%s", (hostel_id,))
    db.commit()
    return jsonify({"created": True, "owner": user_public(owner)})


# ---------------------------------------------------------------- #
# Inquiries
# ---------------------------------------------------------------- #

@app.put("/api/inquiries/<int:inquiry_id>/respond")
def api_respond_inquiry(inquiry_id):
    user, err = require_role("owner")
    if err:
        return err
    db = get_db()
    row = db.execute(
        "SELECT inquiries.*, hostels.owner_id AS hostel_owner_id FROM inquiries "
        "JOIN hostels ON hostels.id = inquiries.hostel_id WHERE inquiries.id=%s",
        (inquiry_id,),
    ).fetchone()
    if not row or row["hostel_owner_id"] != user["id"]:
        return error("Inquiry not found.", 404)
    db.execute("UPDATE inquiries SET status='responded' WHERE id=%s", (inquiry_id,))
    db.commit()
    updated = db.execute("SELECT * FROM inquiries WHERE id=%s", (inquiry_id,)).fetchone()
    return jsonify({"inquiry": inquiry_public(updated)})


# ---------------------------------------------------------------- #
# Admin: users, export, reset
# ---------------------------------------------------------------- #

@app.put("/api/users/<int:user_id>/toggle-status")
def api_toggle_user_status(user_id):
    _, err = require_role("admin")
    if err:
        return err
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=%s", (user_id,)).fetchone()
    if not row or row["role"] == "admin":
        return error("User not found.", 404)
    new_status = "inactive" if row["status"] == "active" else "active"
    db.execute("UPDATE users SET status=%s WHERE id=%s", (new_status, user_id))
    db.commit()
    return jsonify({"user": user_public(db.execute("SELECT * FROM users WHERE id=%s", (user_id,)).fetchone())})


@app.get("/api/export")
def api_export():
    _, err = require_role("admin")
    if err:
        return err
    db = get_db()
    payload = {
        "exportedAt": datetime.utcnow().isoformat() + "Z",
        "users": [user_public(r) for r in db.execute("SELECT * FROM users").fetchall()],
        "hostels": [hostel_public(r) for r in db.execute("SELECT * FROM hostels").fetchall()],
        "inquiries": [inquiry_public(r) for r in db.execute("SELECT * FROM inquiries").fetchall()],
    }
    return jsonify(payload)



@app.post("/api/reset")
def api_reset():
    """Clear platform data after configured administrator and password checks."""
    user, err = require_role("admin")
    if err:
        return err

    if (
        not ADMIN_USERNAME
        or user["username"].lower() != ADMIN_USERNAME.lower()
    ):
        return error(
            "Only the configured administrator can clear platform data.",
            403,
        )

    if rate_limited("reset", 3, 3600, key=str(user["id"])):
        return rate_limit_error(3600)

    body = request.get_json(silent=True) or {}
    confirmation = body.get("password") or ""
    if not confirmation or not check_password_hash(
        user["password_hash"], confirmation
    ):
        return error("Administrator password confirmation failed.", 403)

    db = get_db()

    try:
        # Delete related records before deleting their parent records.
        db.execute("DELETE FROM inquiries")
        db.execute("DELETE FROM hostels")
        db.execute(
            "DELETE FROM users WHERE id <> %s",
            (user["id"],),
        )
        db.commit()

    except Exception:
        db.rollback()
        raise

    return jsonify({"ok": True, "loggedOut": False})


# ---------------------------------------------------------------- #
# Reviews & Wishlist API
# ---------------------------------------------------------------- #

@app.get("/api/hostels/<int:hostel_id>/reviews")
def api_get_reviews(hostel_id):
    db = get_db()
    rows = db.execute(
        """SELECT r.id, r.rating, r.comment, r.created_at, u.name as student_name
           FROM reviews r
           JOIN users u ON u.id = r.student_id
           WHERE r.hostel_id = %s
           ORDER BY r.created_at DESC""",
        (hostel_id,)
    ).fetchall()
    return jsonify({
        "reviews": [
            {
                "id": r["id"],
                "rating": r["rating"],
                "comment": r["comment"],
                "date": r["created_at"].strftime("%Y-%m-%d"),
                "studentName": r["student_name"]
            } for r in rows
        ]
    })


@app.post("/api/hostels/<int:hostel_id>/reviews")
def api_add_review(hostel_id):
    """Validate and upsert a student review for a live verified listing, updating its rating."""
    user, err = require_role("student")
    if err:
        return err
    if rate_limited("review", 10, 3600, key=str(user["id"])):
        return rate_limit_error(3600)

    body = request.get_json(silent=True) or {}
    try:
        rating = int(body.get("rating", 0))
    except (ValueError, TypeError):
        return error("Invalid rating value.", 400)
    comment = (body.get("comment") or "").strip() if isinstance(body.get("comment", ""), str) else ""
    if rating < 1 or rating > 5:
        return error("Rating must be between 1 and 5.", 400)
    if not comment:
        return error("Please provide a review comment.", 400)
    if len(comment) > 2000:
        return error("Review is too long (maximum 2000 characters).", 400)

    db = get_db()
    hostel = hostel_or_404(db, hostel_id)
    if not hostel or hostel["status"] != "verified" or not hostel["live"]:
        return error("Listing not found.", 404)
    existing = db.execute("SELECT id FROM reviews WHERE student_id=%s AND hostel_id=%s", (user["id"], hostel_id)).fetchone()
    if existing:
        db.execute("UPDATE reviews SET rating=%s, comment=%s, created_at=CURRENT_TIMESTAMP WHERE id=%s", (rating, comment, existing["id"]))
    else:
        db.execute("INSERT INTO reviews (student_id, hostel_id, rating, comment) VALUES (%s, %s, %s, %s)", (user["id"], hostel_id, rating, comment))

    avg_row = db.execute("SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating FROM reviews WHERE hostel_id=%s", (hostel_id,)).fetchone()
    new_rating = float(avg_row["avg_rating"]) if avg_row and avg_row["avg_rating"] is not None else float(rating)
    db.execute("UPDATE hostels SET rating=%s WHERE id=%s", (new_rating, hostel_id))
    db.commit()

    return jsonify({"ok": True, "newRating": new_rating})


@app.get("/api/wishlist")
def api_get_wishlist():
    user, err = require_role("student")
    if err:
        return jsonify({"savedIds": []})
    db = get_db()
    rows = db.execute("SELECT hostel_id FROM wishlists WHERE student_id=%s", (user["id"],)).fetchall()
    return jsonify({"savedIds": [r["hostel_id"] for r in rows]})


@app.post("/api/wishlist/<int:hostel_id>/toggle")
def api_toggle_wishlist(hostel_id):
    """Toggle a student wishlist entry, allowing additions only for live verified listings."""
    user, err = require_role("student")
    if err:
        return err
    db = get_db()
    hostel = hostel_or_404(db, hostel_id)
    if not hostel:
        return error("Listing not found.", 404)
    row = db.execute("SELECT id FROM wishlists WHERE student_id=%s AND hostel_id=%s", (user["id"], hostel_id)).fetchone()
    if row:
        db.execute("DELETE FROM wishlists WHERE id=%s", (row["id"],))
        saved = False
    else:
        if hostel["status"] != "verified" or not hostel["live"]:
            return error("Listing not found.", 404)
        db.execute("INSERT INTO wishlists (student_id, hostel_id) VALUES (%s, %s) ON CONFLICT (student_id, hostel_id) DO NOTHING", (user["id"], hostel_id))
        saved = True
    db.commit()
    return jsonify({"ok": True, "saved": saved, "hostelId": hostel_id})


# ---------------------------------------------------------------- #

# Initialize the non-destructive schema when imported by Gunicorn.
init_db()

if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=env_bool("FLASK_DEBUG", False),
    )
