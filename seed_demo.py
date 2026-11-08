"""Load the optional local demonstration dataset.

This is destructive: it drops the users, hostels, inquiries, reviews and
wishlists tables, then recreates them and inserts the demo records.

Required environment variables:
  SECRET_KEY
  DEMO_PASSWORD
  ADMIN_USERNAME
  ADMIN_PASSWORD

Run it only against a local development database:

    python seed_demo.py --reset

For production, use schema.sql and never seed demo accounts.
"""

import os
import sys

import app


def main():
    """Require reset consent and demo credentials, then seed the database with rollback on failure."""
    if "--reset" not in sys.argv[1:]:
        raise SystemExit(
            "This command replaces all application data. Re-run with --reset "
            "if you are sure you are using a local database."
        )

    missing = [
        name
        for name, value in (
            ("DEMO_PASSWORD", os.environ.get("DEMO_PASSWORD")),
            ("ADMIN_USERNAME", os.environ.get("ADMIN_USERNAME")),
            ("ADMIN_PASSWORD", os.environ.get("ADMIN_PASSWORD")),
        )
        if not (value or "").strip()
    ]
    if missing:
        raise SystemExit(
            "Set these environment variables before loading demo data: "
            + ", ".join(missing)
        )

    db = app.PGConn(app.connect())
    try:
        app.seed(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print("Demo data loaded. Change or remove demo credentials before deployment.")


if __name__ == "__main__":
    main()
