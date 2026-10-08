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
import requests
import os
import re
from datetime import date, datetime

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from flask import Flask, abort, g, jsonify, request, session, send_from_directory
from psycopg2 import errors as pg_errors
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# Read .env (if present) into os.environ. Real environment variables that
# are already set take priority over the file.
load_dotenv(os.path.join(BASE_DIR, ".env"))

DEMO_PASSWORD = "demo123"        # password for every seeded student/owner demo account
DEMO_PASSWORD = "demo123"

# Set these securely in Render Environment Variables.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^\d{10}$")


def env_bool(name, default=False):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY") or "roomfinder-dev-secret-change-me"

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


def seed(db):
    """Wipe everything and rebuild with the original demo dataset (admin 'Reset')."""
    db.executescript(
        "DROP TABLE IF EXISTS inquiries CASCADE; "
        "DROP TABLE IF EXISTS hostels CASCADE; "
        "DROP TABLE IF EXISTS users CASCADE;"
    )
    create_schema(db)
    insert_demo_data(db)
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

        if ADMIN_USERNAME and ADMIN_PASSWORD:
            existing_admin = db.execute(
                "SELECT id FROM users WHERE lower(username)=lower(%s)",
                (ADMIN_USERNAME,),
            ).fetchone()

            if existing_admin:
                db.execute(
                    "UPDATE users "
                    "SET role='admin', password_hash=%s, status='active' "
                    "WHERE id=%s",
                    (
                        generate_password_hash(ADMIN_PASSWORD),
                        existing_admin["id"],
                    ),
                )
            else:
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

def user_public(row):
    return {
        "id": row["id"], "name": row["name"], "username": row["username"],
        "email": row["email"], "phone": row["phone"], "role": row["role"],
        "joined": str(row["joined"]), "status": row["status"],
    }


def hostel_public(row):
    return {
        "id": row["id"], "name": row["name"], "type": row["type"],
        "ownerId": row["owner_id"], "college": row["college"], "location": row["location"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "distance": row["distance"], "rent": row["rent"], "rooms": row["rooms"],
        "rating": row["rating"], "status": row["status"], "live": bool(row["live"]),
        "views": row["views"],
        "amenities": [a for a in row["amenities"].split(",") if a],
        "description": row["description"], "image": row["image"],
    }


def inquiry_public(row):
    return {
        "id": row["id"], "studentId": row["student_id"], "hostelId": row["hostel_id"],
        "status": row["status"], "date": str(row["date"]), "message": row["message"],
    }


# ---------------------------------------------------------------- #
# Auth helpers
# ---------------------------------------------------------------- #

def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    row = get_db().execute("SELECT * FROM users WHERE id=%s", (uid,)).fetchone()
    return row


def error(message, code=400):
    return jsonify({"error": message}), code


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
    user, err = require_role("owner")
    if err:
        return err

    data = request.get_json(silent=True) or {}
    address = str(data.get("address", "")).strip()

    if not address:
        return error("Please enter a location.", 400)

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
@app.get("/api/meta")
def api_meta():
    return jsonify({"colleges": COLLEGES, "amenities": AMENITY_DEFS})

@app.get("/api/state")
def api_state():
    db = get_db()
    users = [user_public(r) for r in db.execute("SELECT * FROM users").fetchall()]
    hostels = [hostel_public(r) for r in db.execute("SELECT * FROM hostels").fetchall()]
    inquiries = [inquiry_public(r) for r in db.execute("SELECT * FROM inquiries").fetchall()]
    return jsonify({"users": users, "hostels": hostels, "inquiries": inquiries})


@app.get("/api/auth/me")
def api_me():
    user = current_user()
    return jsonify({"user": user_public(user) if user else None})


# ---------------------------------------------------------------- #
# Auth
# ---------------------------------------------------------------- #

@app.post("/api/auth/login")

def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    portal = data.get("portal") or None

    if not username or not password:
        return error("Please enter both username and password.")

    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE lower(username)=lower(%s)",
        (username,)
    ).fetchone()

    if not row:
        return error("No account found with that username.")

    if not check_password_hash(row["password_hash"], password):
        return error("Incorrect password.")

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

    session["user_id"] = row["id"]
    return jsonify({"user": user_public(row)})



@app.post("/api/auth/signup")
def api_signup():
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

    if not EMAIL_RE.match(email):
        return error("Please enter a valid email address (e.g. name@example.com).")

    if not PHONE_RE.match(phone):
        return error(
            "Phone number must be exactly 10 digits, "
            "with no letters or symbols."
        )

    if len(password) < 6:
        return error("Password must be at least 6 characters.")

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
    "INSERT INTO hostels (name, type, owner_id, college, location, latitude, longitude, "
    "distance, rent, rooms, rating, status, live, views, amenities, description, image) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,4.0,'pending',FALSE,0,%s,%s,%s) RETURNING id",
    (
        name,
        data.get("type", "Boys Hostel"),
        user["id"],
        data.get("college", COLLEGES[0]),
        location,
        data.get("latitude"),
        data.get("longitude"),
        float(data.get("distance") or 0.5),
        int(rent),
        int(data.get("rooms") or 1),
        ",".join(data.get("amenities") or []),
        (data.get("description") or "").strip(),
        data.get("image"),
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

    session["user_id"] = row["id"]
    return jsonify({"user": user_public(row)}), 201


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.put("/api/auth/profile")
def api_update_profile():
    user, err = require_login()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    phone = (data.get("phone") or "").strip()

    if not name or not email or not phone:
        return error("Name, email and phone are required.")
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
    if len(new_password) < 6:
        return error("New password must be at least 6 characters.")

    db = get_db()
    db.execute("UPDATE users SET password_hash=%s WHERE id=%s", (generate_password_hash(new_password), user["id"]))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- #
# Hostels
# ---------------------------------------------------------------- #

def hostel_or_404(db, hostel_id):
    return db.execute("SELECT * FROM hostels WHERE id=%s", (hostel_id,)).fetchone()


@app.post("/api/hostels")
def api_create_hostel():
    user, err = require_role("owner")
    if err:
        return err
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    location = (data.get("location") or "").strip()
    rent = data.get("rent")
    if not name or not location or not rent:
        return error("Please fill in property name, location and rent.")

    db = get_db()
    cur = db.execute(
        "INSERT INTO hostels (name, type, owner_id, college, location, distance, rent, rooms, rating, "
        "status, live, views,"
        "amenities, description, image) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,4.0,'pending',FALSE,0,%s,%s,%s)"
        "RETURNING id",
        (
    name,
    data.get("type", "Boys Hostel"),
    user["id"],
    data.get("college", COLLEGES[0]),
    location,
    float(data.get("distance") or 0.5),
    data.get("latitude"),
    data.get("longitude"),
    int(rent),
    int(data.get("rooms") or 1),
    ",".join(data.get("amenities") or []),
    (data.get("description") or "").strip(),
    data.get("image"),
)
    new_id = cur.fetchone()["id"]
    db.commit()
    row = hostel_or_404(db, new_id)
    return jsonify({"hostel": hostel_public(row)}), 201


@app.put("/api/hostels/<int:hostel_id>")
def api_update_hostel(hostel_id):
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
    name = (data.get("name") or h["name"]).strip()
    location = (data.get("location") or h["location"]).strip()
    rent = data.get("rent", h["rent"])
    if not name or not location or not rent:
        return error("Please fill in property name, location and rent.")

    db.execute(
      "UPDATE hostels SET name=%s, type=%s, college=%s, distance=%s, location=%s, "
      "latitude=%s, longitude=%s, rent=%s, rooms=%s, description=%s, amenities=%s, image=%s "
      "WHERE id=%s",
        (
    name,
    data.get("type", h["type"]),
    data.get("college", h["college"]),
    float(data.get("distance", h["distance"])),
    location,
    data.get("latitude", h["latitude"]),
    data.get("longitude", h["longitude"]),
    int(rent),
    int(data.get("rooms", h["rooms"])),
    (data.get("description", h["description"]) or "").strip(),
    ",".join(data.get("amenities", h["amenities"].split(","))),
    data.get("image", h["image"]),
    hostel_id,
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
    user, err = require_role("student")
    if err:
        return err
    db = get_db()
    h = hostel_or_404(db, hostel_id)
    if not h:
        return error("Listing not found.", 404)

    existing = db.execute(
        "SELECT * FROM inquiries WHERE hostel_id=%s AND student_id=%s AND status='pending'",
        (hostel_id, user["id"]),
    ).fetchone()

    owner = db.execute("SELECT * FROM users WHERE id=%s", (h["owner_id"],)).fetchone()

    if existing:
        return jsonify({"created": False, "owner": user_public(owner)})

    message = (request.get_json(silent=True) or {}).get(
        "message", "Hi, I'm interested in this hostel — could you share more details?"
    )
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

# Initialize the non-destructive schema when imported by Gunicorn.
init_db()

if __name__ == "__main__":
    if not os.environ.get("SECRET_KEY"):
        print("WARNING: SECRET_KEY is not set -- using the insecure development default. "
              "Set it in .env before deploying.")
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=env_bool("FLASK_DEBUG", False),
    )
