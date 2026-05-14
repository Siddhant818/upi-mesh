"""
database.py — SQLite setup using Python's built-in sqlite3.
Creates tables on first run. Zero external dependencies.
"""

import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "upimesh.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # safe for concurrent writes
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                upi_id      TEXT    UNIQUE NOT NULL,
                name        TEXT    NOT NULL,
                balance     REAL    NOT NULL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                packet_id       TEXT    UNIQUE NOT NULL,
                packet_hash     TEXT    NOT NULL,
                sender_upi      TEXT    NOT NULL,
                receiver_upi    TEXT    NOT NULL,
                amount          REAL    NOT NULL,
                outcome         TEXT    NOT NULL,   -- SETTLED | DUPLICATE_DROPPED | INVALID
                reason          TEXT,
                bridge_node     TEXT,
                hop_count       INTEGER,
                settled_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS idempotency_cache (
                packet_hash TEXT PRIMARY KEY,
                settled_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- Seed demo accounts if empty
            INSERT OR IGNORE INTO accounts (upi_id, name, balance) VALUES
                ('alice@upi',   'Alice',   2000.00),
                ('bob@upi',     'Bob',     1500.00),
                ('charlie@upi', 'Charlie', 3000.00),
                ('diana@upi',   'Diana',   500.00);
        """)
    print(f"[DB] Initialised → {DB_PATH}")


def get_all_accounts():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM accounts ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def get_recent_transactions(limit=20):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM transactions ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats():
    with get_conn() as conn:
        total   = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        settled = conn.execute("SELECT COUNT(*) FROM transactions WHERE outcome='SETTLED'").fetchone()[0]
        dupes   = conn.execute("SELECT COUNT(*) FROM transactions WHERE outcome='DUPLICATE_DROPPED'").fetchone()[0]
        invalid = conn.execute("SELECT COUNT(*) FROM transactions WHERE outcome='INVALID'").fetchone()[0]
        volume  = conn.execute("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE outcome='SETTLED'").fetchone()[0]
    return {
        "total": total,
        "settled": settled,
        "duplicate_dropped": dupes,
        "invalid": invalid,
        "total_volume": round(volume, 2),
    }
