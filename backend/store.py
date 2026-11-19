"""SQLite: kullanım sayacı, etkinlik günlüğü, checkpoint kayıtları."""
import json
import sqlite3
import subprocess
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import AGY_BIN, DB_PATH, PROVIDERS, WORKSPACE

_usage_lock = threading.Lock()
_usage_cache: dict = {"ts": 0.0, "db": "", "data": None}
_USAGE_TTL_S = 45.0


def _iso_to_reset_s(iso_str: str | None, now: float) -> int:
    if not iso_str:
        return 0
    s = iso_str.strip()
    if not s:
        return 0
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, int(dt.timestamp() - now))
    except Exception:
        return 0


def _fmt_dur_tr(reset_s: int) -> str:
    if reset_s <= 0:
        return ""
    hours = reset_s // 3600
    mins = (reset_s % 3600) // 60
    if hours > 0:
        return f"{hours} sa {mins} dk" if mins > 0 else f"{hours} sa"
    return f"{max(1, mins)} dk"


def _summarize_group_buckets(g_name: str, raw_buckets: list[dict], now: float) -> dict:
    buckets = []
    pieces = []
    for b in raw_buckets:
        disabled = bool(b.get("disabled", False))
        rem_frac = float(b.get("remaining_fraction", 1.0 if disabled else 0.0))
        rem_pct = max(0, min(100, round(rem_frac * 100)))
        reset_time = str(b.get("reset_time") or "")
        reset_s = 0 if disabled else _iso_to_reset_s(reset_time, now)
        b_name = str(b.get("name") or "")
        win = str(b.get("window") or ("5h" if "five hour" in b_name.lower() else "weekly"))
        w_label = "5 sa" if win == "5h" else ("Haftalık" if win == "weekly" else (b_name or "Limit"))
        buckets.append({
            "id": str(b.get("id") or win),
            "name": b_name or w_label,
            "window": win,
            "remaining_pct": rem_pct,
            "disabled": disabled,
            "reset_s": reset_s,
            "reset_time": reset_time,
        })
        if disabled:
            pieces.append(f"{w_label}: devre dışı")
        else:
            dur = _fmt_dur_tr(reset_s)
            pieces.append(f"{w_label}: %{rem_pct}" + (f" ({dur})" if dur else ""))

    active = [x for x in buckets if not x["disabled"]]
    if active:
        limiting = min(active, key=lambda x: (x["remaining_pct"], x["reset_s"] if x["reset_s"] > 0 else 10**9))
        rem_pct = limiting["remaining_pct"]
        used_pct = 100 - rem_pct
        reset_s = limiting["reset_s"]
    else:
        rem_pct = 100
        used_pct = 0
        reset_s = 0

    return {
        "group": g_name,
        "used_pct": used_pct,
        "remaining_pct": rem_pct,
        "reset_s": reset_s,
        "detail": " · ".join(pieces) if pieces else g_name,
        "buckets": buckets,
    }


def parse_agy_usage_json(raw: str, now_ts: float | None = None) -> dict[str, dict] | None:
    """`agy -p /usage --output-format json` (veya TSV) çıktısını sağlayıcı bazlı kotalara ayrıştırır."""
    now = now_ts if now_ts is not None else time.time()
    text = (raw or "").strip()
    if not text:
        return None

    groups_data: list[dict] = []
    tsv_text = ""
    if text.startswith("{"):
        try:
            obj = json.loads(text)
            groups_data = ((obj.get("command") or {}).get("data") or {}).get("groups") or []
            tsv_text = str(obj.get("response") or "")
        except Exception:
            tsv_text = text
    else:
        tsv_text = text

    if not groups_data and tsv_text:
        by_group: dict[str, list[dict]] = {}
        for line in tsv_text.splitlines():
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            g_name, b_name, rem_str = parts[0].strip(), parts[1].strip(), parts[2].strip()
            rst_str = parts[3].strip() if len(parts) > 3 else ""
            disabled = rem_str.lower() == "disabled"
            rem_frac = 1.0
            if not disabled and rem_str.endswith("%"):
                try:
                    rem_frac = float(rem_str[:-1]) / 100.0
                except Exception:
                    continue
            by_group.setdefault(g_name, []).append({
                "id": f"{g_name}-{b_name}".lower().replace(" ", "-"),
                "name": b_name,
                "window": "5h" if "five hour" in b_name.lower() else "weekly",
                "remaining_fraction": rem_frac,
                "disabled": disabled,
                "reset_time": rst_str,
            })
        groups_data = [{"name": k, "description": "", "buckets": v} for k, v in by_group.items()]

    if not groups_data:
        return None

    out: dict[str, dict] = {}
    gemini_fallback: dict | None = None
    for g in groups_data:
        g_name = str(g.get("name") or "")
        g_desc = str(g.get("description") or "")
        raw_buckets = g.get("buckets") or []
        if not raw_buckets:
            continue
        info = _summarize_group_buckets(g_name, raw_buckets, now)
        low = f"{g_name} {g_desc}".lower()
        b_ids = " ".join(str(b.get("id") or "") for b in raw_buckets).lower()
        if "argon" in low or "argon" in b_ids:
            out["gemini-argon"] = info
        elif "claude" in low or "gpt" in low or "3p-" in b_ids:
            out["claude-opus"] = info
            out["claude-sonnet"] = info
        elif "gemini" in low or "hydrogen" in low:
            out["gemini-hydrogen"] = info
            gemini_fallback = info

    if "gemini-argon" not in out and gemini_fallback is not None:
        out["gemini-argon"] = gemini_fallback

    return out or None


def fetch_agy_usage(force: bool = False) -> dict[str, dict] | None:
    """agy CLI üzerinden canlı `/usage` kotalarını sorgular ve önbelleğe alır."""
    now = time.time()
    db_key = str(DB_PATH)
    with _usage_lock:
        if (
            not force
            and _usage_cache["db"] == db_key
            and _usage_cache["data"] is not None
            and (now - _usage_cache["ts"]) < _USAGE_TTL_S
        ):
            return _usage_cache["data"]

    try:
        res = subprocess.run(
            [AGY_BIN, "-p", "/usage", "--output-format", "json"],
            cwd=str(WORKSPACE),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000),
        )
        parsed = parse_agy_usage_json(res.stdout, now)
        if parsed:
            with _usage_lock:
                _usage_cache["ts"] = now
                _usage_cache["db"] = db_key
                _usage_cache["data"] = parsed
            try:
                with conn() as c:
                    c.execute(
                        "INSERT INTO agy_usage_cache(id,raw,ts) VALUES(1,?,?) "
                        "ON CONFLICT(id) DO UPDATE SET raw=excluded.raw, ts=excluded.ts",
                        (res.stdout, now),
                    )
                    for prov, info in parsed.items():
                        if info["used_pct"] >= 100 and info["reset_s"] > 0:
                            c.execute(
                                "INSERT INTO exhausted(provider,until_ts) VALUES(?,?) "
                                "ON CONFLICT(provider) DO UPDATE SET until_ts=excluded.until_ts",
                                (prov, now + max(60, info["reset_s"])),
                            )
                        elif info["used_pct"] < 100:
                            c.execute("DELETE FROM exhausted WHERE provider=?", (prov,))
            except Exception:
                pass
            return parsed
    except Exception:
        pass

    with _usage_lock:
        if _usage_cache["db"] == db_key and _usage_cache["data"] is not None:
            return _usage_cache["data"]

    try:
        with conn() as c:
            row = c.execute("SELECT raw FROM agy_usage_cache WHERE id=1").fetchone()
            if row and row["raw"]:
                parsed = parse_agy_usage_json(row["raw"], now)
                if parsed:
                    with _usage_lock:
                        _usage_cache["ts"] = now
                        _usage_cache["db"] = db_key
                        _usage_cache["data"] = parsed
                    return parsed
    except Exception:
        pass
    return None



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
            CREATE TABLE IF NOT EXISTS ui_state(
              key TEXT PRIMARY KEY, val TEXT, updated_ts REAL);
            CREATE TABLE IF NOT EXISTS agy_usage_cache(
              id INTEGER PRIMARY KEY CHECK(id=1), raw TEXT, ts REAL);
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


def get_compact_ctx(session: str) -> str | None:
    key = f"compact_ctx:{session}"
    with conn() as c:
        r = c.execute("SELECT val FROM ui_state WHERE key=?", (key,)).fetchone()
        return r["val"] if (r and r["val"]) else None


def set_compact_ctx(session: str, summary: str | None):
    key = f"compact_ctx:{session}"
    with conn() as c:
        if not summary:
            c.execute("DELETE FROM ui_state WHERE key=?", (key,))
        else:
            c.execute(
                "INSERT INTO ui_state(key,val,updated_ts) VALUES(?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_ts=excluded.updated_ts",
                (key, summary, time.time()),
            )


def pop_compact_ctx(session: str) -> str | None:
    val = get_compact_ctx(session)
    if val:
        set_compact_ctx(session, None)
    return val


def record_usage(provider: str, tokens: int, real: bool):
    with conn() as c:
        c.execute("INSERT INTO usage(provider,ts,tokens,real) VALUES(?,?,?,?)",
                  (provider, time.time(), tokens, int(real)))


def quota_status(live: bool = False, refresh: bool = False) -> list[dict]:
    out = []
    now = time.time()
    live_map: dict[str, dict] | None = None
    if live or refresh:
        live_map = fetch_agy_usage(force=refresh)
    else:
        with _usage_lock:
            if _usage_cache["db"] == str(DB_PATH) and _usage_cache["data"] is not None:
                live_map = _usage_cache["data"]

    with conn() as c:
        for key, p in PROVIDERS.items():
            if p["limit"] is None:
                n = c.execute("SELECT COUNT(*) FROM usage WHERE provider=?", (key,)).fetchone()[0]
                out.append({"id": key, "label": p["label"], "used_pct": None, "count": n,
                            "reset_s": None, "cloud": False, "detail": f"sınırsız · {n} istek"})
                continue
            since = now - p["window_h"] * 3600
            rows = c.execute("SELECT ts FROM usage WHERE provider=? AND ts>=? ORDER BY ts",
                             (key, since)).fetchall()
            n = len(rows)
            if live_map and key in live_map:
                info = live_map[key]
                out.append({
                    "id": key,
                    "label": p["label"],
                    "limit": p["limit"],
                    "count": n,
                    "used_pct": info["used_pct"],
                    "remaining_pct": info["remaining_pct"],
                    "reset_s": info["reset_s"],
                    "detail": info["detail"],
                    "group": info["group"],
                    "buckets": info["buckets"],
                    "source": "agy_cli",
                    "cloud": True,
                })
                continue
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
    for q in quota_status(live=False):
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


def get_ui_state() -> dict[str, str]:
    with conn() as c:
        rows = c.execute("SELECT key, val FROM ui_state").fetchall()
    return {r["key"]: r["val"] for r in rows}


def set_ui_state(items: dict[str, str | None]):
    now = time.time()
    with conn() as c:
        for k, v in items.items():
            if not k:
                continue
            if v is None:
                c.execute("DELETE FROM ui_state WHERE key=?", (k,))
            else:
                c.execute(
                    "INSERT INTO ui_state(key,val,updated_ts) VALUES(?,?,?) "
                    "ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_ts=excluded.updated_ts",
                    (str(k), str(v), now),
                )

