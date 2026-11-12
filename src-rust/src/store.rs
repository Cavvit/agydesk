use crate::config::{DB_PATH, PROVIDERS};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn open_conn() -> rusqlite::Result<Connection> {
    let c = Connection::open(&*DB_PATH)?;
    let _ = c.busy_timeout(std::time::Duration::from_millis(3000));
    Ok(c)
}

pub fn init() {
    let Ok(c) = open_conn() else { return };
    let _ = c.execute_batch(
        "CREATE TABLE IF NOT EXISTS usage(
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
          id INTEGER PRIMARY KEY, day INTEGER, title TEXT, kind TEXT, kasa TEXT);",
    );

    let n_ev: i64 = c
        .query_row("SELECT COUNT(*) FROM cal_events", [], |r| r.get(0))
        .unwrap_or(0);
    // seeds removed
    let _ = n_ev;
}

pub fn add_chat_msg(session: &str, w: &str, h: &str) {
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "INSERT INTO chat_msgs(session,w,h,ts) VALUES(?1,?2,?3,?4)",
            params![session, w, h, now_ts()],
        );
    }
}

pub fn get_chat_msgs() -> HashMap<String, Vec<Value>> {
    let mut out: HashMap<String, Vec<Value>> = HashMap::new();
    let Ok(c) = open_conn() else { return out };
    let Ok(mut stmt) = c.prepare("SELECT session, w, h FROM chat_msgs ORDER BY id") else {
        return out;
    };
    if let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    }) {
        for r in rows.flatten() {
            out.entry(r.0).or_default().push(json!({ "w": r.1, "h": r.2 }));
        }
    }
    out
}

pub fn clear_chat_msgs(session: &str) {
    if let Ok(c) = open_conn() {
        let _ = c.execute("DELETE FROM chat_msgs WHERE session=?1", params![session]);
    }
}

pub fn mark_exhausted(provider: &str, reset_s: i64) {
    if let Ok(c) = open_conn() {
        let until = now_ts() + (reset_s.max(60) as f64);
        let _ = c.execute(
            "INSERT INTO exhausted(provider,until_ts) VALUES(?1,?2)
             ON CONFLICT(provider) DO UPDATE SET until_ts=excluded.until_ts",
            params![provider, until],
        );
    }
}

pub fn get_conv_id(session: &str) -> Option<String> {
    let c = open_conn().ok()?;
    c.query_row(
        "SELECT conv_id FROM sessions WHERE session=?1",
        params![session],
        |r| r.get(0),
    )
    .ok()
}

pub fn set_conv_id(session: &str, conv_id: Option<&str>) {
    let Ok(c) = open_conn() else { return };
    match conv_id {
        None => {
            let _ = c.execute("DELETE FROM sessions WHERE session=?1", params![session]);
        }
        Some(cid) => {
            let _ = c.execute(
                "INSERT INTO sessions(session,conv_id,updated_ts) VALUES(?1,?2,?3)
                 ON CONFLICT(session) DO UPDATE SET conv_id=excluded.conv_id, updated_ts=excluded.updated_ts",
                params![session, cid, now_ts()],
            );
        }
    }
}

pub fn record_usage(provider: &str, tokens: i64, real: bool) {
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "INSERT INTO usage(provider,ts,tokens,real) VALUES(?1,?2,?3,?4)",
            params![provider, now_ts(), tokens, if real { 1 } else { 0 }],
        );
    }
}

pub fn quota_status() -> Vec<Value> {
    let mut out = Vec::new();
    let now = now_ts();
    let Ok(c) = open_conn() else { return out };

    for p in PROVIDERS {
        let Some(limit) = p.limit else {
            let n: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM usage WHERE provider=?1",
                    params![p.id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            out.push(json!({
                "id": p.id,
                "label": p.label,
                "used_pct": Value::Null,
                "count": n,
                "reset_s": Value::Null,
                "cloud": false
            }));
            continue;
        };

        let since = now - (p.window_h as f64) * 3600.0;
        let mut ts_list: Vec<f64> = Vec::new();
        if let Ok(mut st) =
            c.prepare("SELECT ts FROM usage WHERE provider=?1 AND ts>=?2 ORDER BY ts")
        {
            if let Ok(rows) = st.query_map(params![p.id, since], |r| r.get::<_, f64>(0)) {
                for t in rows.flatten() {
                    ts_list.push(t);
                }
            }
        }
        let n = ts_list.len() as u32;
        let ex: Option<f64> = c
            .query_row(
                "SELECT until_ts FROM exhausted WHERE provider=?1",
                params![p.id],
                |r| r.get(0),
            )
            .ok();

        if let Some(until_ts) = ex {
            if until_ts > now {
                out.push(json!({
                    "id": p.id,
                    "label": p.label,
                    "limit": limit,
                    "count": limit,
                    "used_pct": 100,
                    "reset_s": (until_ts - now) as i64,
                    "cloud": true
                }));
                continue;
            }
        }

        let reset = if let Some(&first) = ts_list.first() {
            ((first + (p.window_h as f64) * 3600.0 - now) as i64).max(0)
        } else {
            0
        };
        let pct = (((n as f64) / (limit as f64) * 100.0).round() as u32).min(100);
        out.push(json!({
            "id": p.id,
            "label": p.label,
            "limit": limit,
            "count": n,
            "used_pct": pct,
            "reset_s": reset,
            "cloud": true
        }));
    }
    out
}

pub fn used_pct(provider: &str) -> u32 {
    for q in quota_status() {
        if q.get("id").and_then(|v| v.as_str()) == Some(provider) {
            return q.get("used_pct").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        }
    }
    0
}

pub fn add_log(session: &str, msg: &str, kind: &str) {
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "INSERT INTO log(ts,session,msg,kind) VALUES(?1,?2,?3,?4)",
            params![now_ts(), session, msg, kind],
        );
    }
}

pub fn get_log(limit: i64) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(c) = open_conn() else { return out };
    let Ok(mut st) = c.prepare("SELECT id, ts, session, msg, kind FROM log ORDER BY id DESC LIMIT ?1") else {
        return out;
    };
    if let Ok(rows) = st.query_map(params![limit], |r| {
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "ts": r.get::<_, f64>(1)?,
            "session": r.get::<_, String>(2)?,
            "msg": r.get::<_, String>(3)?,
            "kind": r.get::<_, String>(4)?,
        }))
    }) {
        for r in rows.flatten() {
            out.push(r);
        }
    }
    out
}

#[derive(Clone, Debug, Serialize)]
pub struct CheckpointRow {
    pub id: i64,
    pub ts: f64,
    pub session: String,
    pub reference: String,
    pub note: String,
}

pub fn add_checkpoint(session: &str, reference: &str, note: &str) {
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "INSERT INTO checkpoint(ts,session,ref,note) VALUES(?1,?2,?3,?4)",
            params![now_ts(), session, reference, note],
        );
    }
}

pub fn pending_checkpoints(session: &str) -> Vec<CheckpointRow> {
    let mut out = Vec::new();
    let Ok(c) = open_conn() else { return out };
    let Ok(mut st) = c.prepare(
        "SELECT id, ts, session, ref, note FROM checkpoint WHERE session=?1 AND undone=0 ORDER BY id",
    ) else {
        return out;
    };
    if let Ok(rows) = st.query_map(params![session], |r| {
        Ok(CheckpointRow {
            id: r.get(0)?,
            ts: r.get(1)?,
            session: r.get(2)?,
            reference: r.get(3)?,
            note: r.get(4)?,
        })
    }) {
        for r in rows.flatten() {
            out.push(r);
        }
    }
    out
}

pub fn mark_undone(session: &str) {
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "UPDATE checkpoint SET undone=1 WHERE session=?1",
            params![session],
        );
    }
}

pub fn get_cal_events() -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(c) = open_conn() else { return out };
    let Ok(mut st) = c.prepare("SELECT id, day, title, kind, kasa FROM cal_events ORDER BY day, id") else {
        return out;
    };
    if let Ok(rows) = st.query_map([], |r| {
        Ok(json!({
            "id": r.get::<_, i64>(0)?,
            "day": r.get::<_, i64>(1)?,
            "title": r.get::<_, String>(2)?,
            "kind": r.get::<_, String>(3)?,
            "kasa": r.get::<_, String>(4)?,
        }))
    }) {
        for r in rows.flatten() {
            out.push(r);
        }
    }
    out
}

pub fn add_cal_event(day: i64, title: &str, kind: &str, kasa: &str) -> Value {
    let clean = title.trim();
    if let Ok(c) = open_conn() {
        let _ = c.execute(
            "INSERT INTO cal_events(day,title,kind,kasa) VALUES(?1,?2,?3,?4)",
            params![day, clean, kind, kasa],
        );
        let id = c.last_insert_rowid();
        return json!({
            "id": id,
            "day": day,
            "title": clean,
            "kind": kind,
            "kasa": kasa
        });
    }
    json!({ "id": 0, "day": day, "title": clean, "kind": kind, "kasa": kasa })
}

pub fn del_cal_event(ev_id: i64) {
    if let Ok(c) = open_conn() {
        let _ = c.execute("DELETE FROM cal_events WHERE id=?1", params![ev_id]);
    }
}
