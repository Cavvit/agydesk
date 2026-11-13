"""SQLite: kullanım sayacı, etkinlik günlüğü, checkpoint kayıtları."""
import sqlite3
import time
from contextlib import contextmanager

from .config import DB_PATH, PROVIDERS


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS usage(
              id INTEGER PRIMARY KEY, provider TEXT, ts REAL, tokens INTEGER, real INTEGER);
            CREATE TABLE IF NOT EXISTS log(
              id INTEGER PRIMARY KEY, ts REAL, session TEXT, msg TEXT, kind TEXT);
            CREATE TABLE IF NOT EXISTS checkpoint(
              id INTEGER PRIMARY KEY, ts REAL, session TEXT, ref TEXT, note TEXT, undone INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS sessions(
              session TEXT PRIMARY KEY, conv_id TEXT, updated_ts REAL);
            CREATE TABLE IF NOT EXISTS exhausted(
              provider TEXT PRIMARY KEY, until_ts REAL);
            CREATE TABLE IF NOT EXISTS chat_msgs(
              id INTEGER PRIMARY KEY, session TEXT, w TEXT, h TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS cal_events(
              id INTEGER PRIMARY KEY, day INTEGER, title TEXT, kind TEXT, kasa TEXT);
            """
        )
        # Migrate legacy gemini-flash quota counters to the shared gemini-hydrogen slot.
        c.execute("UPDATE usage SET provider='gemini-hydrogen' WHERE provider='gemini-flash'")
        c.execute(
            "UPDATE exhausted SET provider='gemini-hydrogen' "
            "WHERE provider='gemini-flash' "
            "AND NOT EXISTS (SELECT 1 FROM exhausted WHERE provider='gemini-hydrogen')"
        )
        c.execute("DELETE FROM exhausted WHERE provider='gemini-flash'")
        # seeds removed (keep calendar empty on fresh install, matching store.rs)


def add_chat_msg(session: str, w: str, h: str):
    with conn() as c:
        c.execute("INSERT INTO chat_msgs(session,w,h,ts) VALUES(?,?,?,?)",
                  (session, w, h, time.time()))


def get_chat_msgs() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    with conn() as c:
        rows = c.execute("SELECT session, w, h FROM chat_msgs ORDER BY id").fetchall()
    for r in rows:
        out.setdefault(r["session"], []).append({"w": r["w"], "h": r["h"]})
    return out


def clear_chat_msgs(session: str):
    with conn() as c:
        c.execute("DELETE FROM chat_msgs WHERE session=?", (session,))


def mark_exhausted(provider: str, reset_s: int):
    with conn() as c:
        c.execute(
            "INSERT INTO exhausted(provider,until_ts) VALUES(?,?) "
            "ON CONFLICT(provider) DO UPDATE SET until_ts=excluded.until_ts",
            (provider, time.time() + max(60, reset_s)),
        )


def get_conv_id(session: str) -> str | None:
    with conn() as c:
        r = c.execute("SELECT conv_id FROM sessions WHERE session=?", (session,)).fetchone()
        return r["conv_id"] if r else None


def set_conv_id(session: str, conv_id: str | None):
    with conn() as c:
        if conv_id is None:
            c.execute("DELETE FROM sessions WHERE session=?", (session,))
        else:
            c.execute(
                "INSERT INTO sessions(session,conv_id,updated_ts) VALUES(?,?,?) "
                "ON CONFLICT(session) DO UPDATE SET conv_id=excluded.conv_id, updated_ts=excluded.updated_ts",
                (session, conv_id, time.time()),
            )


def record_usage(provider: str, tokens: int, real: bool):
    with conn() as c:
        c.execute("INSERT INTO usage(provider,ts,tokens,real) VALUES(?,?,?,?)",
                  (provider, time.time(), tokens, int(real)))


def quota_status() -> list[dict]:
    out = []
    now = time.time()
    with conn() as c:
        for key, p in PROVIDERS.items():
            if p["limit"] is None:
                n = c.execute("SELECT COUNT(*) FROM usage WHERE provider=?", (key,)).fetchone()[0]
                out.append({"id": key, "label": p["label"], "used_pct": None, "count": n,
                            "reset_s": None, "cloud": False})
                continue
            since = now - p["window_h"] * 3600
            rows = c.execute("SELECT ts FROM usage WHERE provider=? AND ts>=? ORDER BY ts",
                             (key, since)).fetchall()
            n = len(rows)
            ex = c.execute("SELECT until_ts FROM exhausted WHERE provider=?", (key,)).fetchone()
            if ex and ex["until_ts"] > now:
                out.append({"id": key, "label": p["label"], "limit": p["limit"], "count": p["limit"],
                            "used_pct": 100, "reset_s": int(ex["until_ts"] - now), "cloud": True})
                continue
            reset = int(rows[0]["ts"] + p["window_h"] * 3600 - now) if rows else 0
            out.append({"id": key, "label": p["label"], "limit": p["limit"], "count": n,
                        "used_pct": min(100, round(n / p["limit"] * 100)),
                        "reset_s": reset, "cloud": True})
    return out


def used_pct(provider: str) -> int:
    for q in quota_status():
        if q["id"] == provider:
            return q["used_pct"] or 0
    return 0


def add_log(session: str, msg: str, kind: str = ""):
    with conn() as c:
        c.execute("INSERT INTO log(ts,session,msg,kind) VALUES(?,?,?,?)",
                  (time.time(), session, msg, kind))


def get_log(limit: int = 60) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def add_checkpoint(session: str, ref: str, note: str):
    with conn() as c:
        c.execute("INSERT INTO checkpoint(ts,session,ref,note) VALUES(?,?,?,?)",
                  (time.time(), session, ref, note))


def pending_checkpoints(session: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM checkpoint WHERE session=? AND undone=0 ORDER BY id",
                         (session,)).fetchall()
    return [dict(r) for r in rows]


def mark_undone(session: str):
    with conn() as c:
        c.execute("UPDATE checkpoint SET undone=1 WHERE session=?", (session,))


def get_cal_events() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT id, day, title, kind, kasa FROM cal_events ORDER BY day, id").fetchall()
    return [dict(r) for r in rows]


def add_cal_event(day: int, title: str, kind: str = "task", kasa: str = "") -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO cal_events(day,title,kind,kasa) VALUES(?,?,?,?)",
            (int(day), title.strip(), kind, kasa),
        )
        return {"id": cur.lastrowid, "day": int(day), "title": title.strip(), "kind": kind, "kasa": kasa}


def del_cal_event(ev_id: int):
    with conn() as c:
        c.execute("DELETE FROM cal_events WHERE id=?", (int(ev_id),))

