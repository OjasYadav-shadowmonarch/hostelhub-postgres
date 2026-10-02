# HostelHub — PostgreSQL edition

The same app as the SQLite build — same routes, same JSON, same
`index.html` / `style.css` / `script.js` — with storage moved to
PostgreSQL and all configuration read from a `.env` file.

## Files

| File | Purpose |
|------|---------|
| `app.py` | Flask backend + static front-end server |
| `database.sql` | **The database file** — schema + demo data, import it into Postgres |
| `schema.sql` | Schema only (tables/indexes, no demo accounts) — use for production |
| `.env.example` | Template for your `.env` (DB connection, secret key, dev options) |
| `requirements.txt` | `Flask`, `psycopg2-binary`, `python-dotenv` |

## 1. Create the database and attach the SQL file

```bash
createdb -U postgres roomfinder
psql -U postgres -d roomfinder -v ON_ERROR_STOP=1 -f database.sql
```

pgAdmin / DBeaver: create an empty `roomfinder` database, open
`database.sql` in the Query Tool and run it.

`database.sql` is safe to re-run (it never overwrites existing rows). For a
clean slate, uncomment the three `DROP TABLE` lines at its top first.

No Postgres installed? A throwaway one in Docker:

```bash
docker run --name hostelhub-db -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=roomfinder -p 5432:5432 -d postgres:16
```

## 2. Configure `.env`

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

Edit `.env`: set `PGPASSWORD` (or use `DATABASE_URL` instead) and a real
`SECRET_KEY`. Real environment variables, if set, override the file.

| Variable | Default | Meaning |
|----------|---------|---------|
| `DATABASE_URL` | — | Full connection URL; wins over the `PG*` values |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` | `localhost` / `5432` / `roomfinder` / `postgres` | Individual settings |
| `PGPASSWORD` | — | Database password |
| `SECRET_KEY` | insecure dev value | Session-cookie signing key |
| `FLASK_DEBUG` | `0` | `1` enables auto-reload/debugger (dev only) |
| `HOST` / `PORT` | `127.0.0.1` / `5000` | Dev-server bind address |

## 3. Install and run

```bash
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**. On start the app creates any missing
tables and loads the demo data only if the `users` table is empty, so you
can skip step 1's import and let the app set itself up — or import
`database.sql` first; both give the same result.

Under gunicorn/waitress (`gunicorn app:app`) the app does **not** create
tables for you — apply `database.sql` or `schema.sql` beforehand.

## Demo accounts

All seeded student/owner accounts use **`demo123`**. The admin signs in from
either the student or owner login screen.

| Username | Password       | Role    |
|----------|----------------|---------|
| `rahul`  | `demo123`      | student |
| `priya`  | `demo123`      | owner   |
| `admin`  | `hostelhub123` | admin   |

## What changed from the SQLite version

- `sqlite3` → `psycopg2`; `?` placeholders → `%s`
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL`; `lastrowid` → `INSERT ... RETURNING id`
- `live` is a real `BOOLEAN`; `joined` / `date` are real `DATE` columns (the API still returns `YYYY-MM-DD` strings)
- Case-insensitive unique index on usernames, so simultaneous signups can't create duplicates
- Connection settings, secret key and debug mode come from `.env` instead of being hard-coded
- Static serving is now an allowlist (html/css/js/images/fonts only), so `.env`, `app.py` and the `.sql` files can never be downloaded from the web server
- Admin "Reset" rebuilds the tables with demo data, as before

## API overview

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/meta` | Colleges + amenity list |
| GET | `/api/state` | All users/hostels/inquiries |
| GET | `/api/auth/me` | Current logged-in user |
| POST | `/api/auth/login` | Log in (admin bypasses the portal check) |
| POST | `/api/auth/signup` | Create account |
| POST | `/api/auth/logout` | Log out |
| PUT | `/api/auth/profile` | Update name / email / phone |
| PUT | `/api/auth/password` | Change password |
| POST | `/api/hostels` | Owner: create listing |
| PUT / DELETE | `/api/hostels/<id>` | Owner/admin: edit / delete listing |
| POST | `/api/hostels/<id>/toggle-availability` | Owner: show/hide listing |
| POST | `/api/hostels/<id>/approve` · `/reject` | Admin: approve / reject listing |
| POST | `/api/hostels/<id>/contact` | Student: send inquiry |
| PUT | `/api/inquiries/<id>/respond` | Owner: mark responded |
| PUT | `/api/users/<id>/toggle-status` | Admin: activate/deactivate user |
| GET | `/api/export` | Admin: export all data as JSON |
| POST | `/api/reset` | Admin: reset to demo data |

## Before deploying

- Set a strong `SECRET_KEY` and `FLASK_DEBUG=0`.
- Load `schema.sql` (not `database.sql`) so the known demo passwords don't exist in production.
- Run behind gunicorn/waitress and HTTPS rather than `python app.py`.
