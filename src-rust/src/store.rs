use crate::config::{AGY_BIN, DB_PATH, PROVIDERS, WORKSPACE};
use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const USAGE_TTL_S: f64 = 300.0;

#[derive(Clone)]
pub struct LiveQuotaInfo {
    group: String,
    used_pct: u32,
    remaining_pct: u32,
    reset_s: i64,
    detail: String,
    buckets: Vec<Value>,
}

struct UsageCache {
    ts: f64,
    data: Option<HashMap<String, LiveQuotaInfo>>,
}

static USAGE_CACHE: Lazy<Mutex<UsageCache>> = Lazy::new(|| {
    Mutex::new(UsageCache {
        ts: 0.0,
        data: None,
    })
});

fn parse_iso8601_utc(s: &str) -> Option<f64> {
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let m: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    let hh: i64 = s.get(11..13)?.parse().ok()?;
    let mm: i64 = s.get(14..16)?.parse().ok()?;
    let ss: i64 = s.get(17..19)?.parse().ok()?;
    let y_adj = y - if m <= 2 { 1 } else { 0 };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = y_adj - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((days * 86400 + hh * 3600 + mm * 60 + ss) as f64)
}

fn iso_to_reset_s(iso_str: &str, now: f64) -> i64 {
    let Some(ts) = parse_iso8601_utc(iso_str) else {
        return 0;
    };
    ((ts - now) as i64).max(0)
}

fn fmt_dur_tr(reset_s: i64) -> String {
    if reset_s <= 0 {
        return String::new();
    }
    let hours = reset_s / 3600;
    let mins = (reset_s % 3600) / 60;
    if hours > 0 {
        if mins > 0 {
            format!("{} sa {} dk", hours, mins)
        } else {
            format!("{} sa", hours)
        }
    } else {
        format!("{} dk", mins.max(1))
    }
}

fn summarize_group_buckets(g_name: &str, raw_buckets: &[Value], now: f64) -> LiveQuotaInfo {
    let mut buckets = Vec::new();
    let mut pieces = Vec::new();
    let mut active_candidates: Vec<(u32, i64)> = Vec::new();

    for b in raw_buckets {
        let disabled = b.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
        let rem_frac = b
            .get("remaining_fraction")
            .and_then(|v| v.as_f64())
            .unwrap_or(if disabled { 1.0 } else { 0.0 });
        let rem_pct = ((rem_frac * 100.0).round() as i64).clamp(0, 100) as u32;
        let reset_time = b
            .get("reset_time")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let reset_s = if disabled {
            0
        } else {
            iso_to_reset_s(&reset_time, now)
        };
        let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let win = b
            .get("window")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if b_name.to_lowercase().contains("five hour") {
                    "5h".to_string()
                } else {
                    "weekly".to_string()
                }
            });
        let w_label = if win == "5h" {
            "5 sa".to_string()
        } else if win == "weekly" {
            "Haftalık".to_string()
        } else if !b_name.is_empty() {
            b_name.to_string()
        } else {
            "Limit".to_string()
        };
        let b_id = b
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(&win)
            .to_string();

        buckets.push(json!({
            "id": b_id,
            "name": if b_name.is_empty() { &w_label } else { b_name },
            "window": win,
            "remaining_pct": rem_pct,
            "disabled": disabled,
            "reset_s": reset_s,
            "reset_time": reset_time
        }));

        if disabled {
            pieces.push(format!("{}: devre dışı", w_label));
        } else {
            let dur = fmt_dur_tr(reset_s);
            if dur.is_empty() {
                pieces.push(format!("{}: %{}", w_label, rem_pct));
            } else {
                pieces.push(format!("{}: %{} ({})", w_label, rem_pct, dur));
            }
            active_candidates.push((rem_pct, reset_s));
        }
    }

    let (rem_pct, used_pct, reset_s) = if !active_candidates.is_empty() {
        active_candidates.sort_by_key(|&(rem, rst)| (rem, if rst > 0 { rst } else { i64::MAX }));
        let (r, rst) = active_candidates[0];
        (r, 100u32.saturating_sub(r), rst)
    } else {
        (100, 0, 0)
    };

    LiveQuotaInfo {
        group: g_name.to_string(),
        used_pct,
        remaining_pct: rem_pct,
        reset_s,
        detail: if pieces.is_empty() {
            g_name.to_string()
        } else {
            pieces.join(" · ")
        },
        buckets,
    }
}

fn parse_agy_usage_json(raw: &str, now: f64) -> Option<HashMap<String, LiveQuotaInfo>> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    let obj: Value = serde_json::from_str(text).ok()?;
    let groups = obj
        .get("command")?
        .get("data")?
        .get("groups")?
        .as_array()?;
    if groups.is_empty() {
        return None;
    }

    let mut out = HashMap::new();
    let mut gemini_fallback: Option<LiveQuotaInfo> = None;

    for g in groups {
        let g_name = g.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let g_desc = g.get("description").and_then(|v| v.as_str()).unwrap_or("");
        let Some(raw_buckets) = g.get("buckets").and_then(|v| v.as_array()) else {
            continue;
        };
        if raw_buckets.is_empty() {
            continue;
        }
        let info = summarize_group_buckets(g_name, raw_buckets, now);
        let low = format!("{} {}", g_name, g_desc).to_lowercase();
        let b_ids: String = raw_buckets
            .iter()
            .filter_map(|b| b.get("id").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();

        if low.contains("argon") || b_ids.contains("argon") {
            out.insert("gemini-argon".to_string(), info);
        } else if low.contains("claude") || low.contains("gpt") || b_ids.contains("3p-") {
            out.insert("claude-opus".to_string(), info.clone());
            out.insert("claude-sonnet".to_string(), info);
        } else if low.contains("gemini") || low.contains("hydrogen") {
            gemini_fallback = Some(info.clone());
            out.insert("gemini-hydrogen".to_string(), info);
        }
    }

    if !out.contains_key("gemini-argon") {
        if let Some(fb) = gemini_fallback {
            out.insert("gemini-argon".to_string(), fb);
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn fetch_agy_usage(force: bool) -> Option<HashMap<String, LiveQuotaInfo>> {
    let now = now_ts();
    if !force {
        if let Ok(cache) = USAGE_CACHE.lock() {
            if let Some(ref data) = cache.data {
                if (now - cache.ts) < USAGE_TTL_S {
                    return Some(data.clone());
                }
            }
        }
    }

    let bin = &*AGY_BIN;
    let mut cmd = if bin.to_lowercase().ends_with(".cmd") || bin.to_lowercase().ends_with(".bat") {
        let mut c = Command::new("cmd.exe");
        c.args(["/C", bin]);
        c
    } else {
        Command::new(bin)
    };
    cmd.args(["-p", "/usage", "--output-format", "json"])
        .current_dir(&*WORKSPACE)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(parsed) = parse_agy_usage_json(&stdout, now) {
            if let Ok(mut cache) = USAGE_CACHE.lock() {
                cache.ts = now;
                cache.data = Some(parsed.clone());
            }
            if let Ok(c) = open_conn() {
                let _ = c.execute(
                    "INSERT INTO agy_usage_cache(id,raw,ts) VALUES(1,?1,?2)
                     ON CONFLICT(id) DO UPDATE SET raw=excluded.raw, ts=excluded.ts",
                    params![stdout.as_ref(), now],
                );
                for (prov, info) in &parsed {
                    if info.used_pct >= 100 && info.reset_s > 0 {
                        let until = now + (info.reset_s.max(60) as f64);
                        let _ = c.execute(
                            "INSERT INTO exhausted(provider,until_ts) VALUES(?1,?2)
                             ON CONFLICT(provider) DO UPDATE SET until_ts=excluded.until_ts",
                            params![prov, until],
                        );
                    } else if info.used_pct < 100 {
                        let _ = c.execute("DELETE FROM exhausted WHERE provider=?1", params![prov]);
                    }
                }
            }
            return Some(parsed);
        } else if let Ok(mut cache) = USAGE_CACHE.lock() {
            cache.ts = now;
        }
    } else if let Ok(mut cache) = USAGE_CACHE.lock() {
        cache.ts = now;
    }

    if let Some(cached) = USAGE_CACHE.lock().ok().and_then(|c| c.data.clone()) {
        return Some(cached);
    }
    if let Ok(c) = open_conn() {
        if let Ok(raw) = c.query_row("SELECT raw FROM agy_usage_cache WHERE id=1", [], |r| {
            r.get::<_, String>(0)
        }) {
            if let Some(parsed) = parse_agy_usage_json(&raw, now) {
                if let Ok(mut cache) = USAGE_CACHE.lock() {
                    cache.data = Some(parsed.clone());
                }
                return Some(parsed);
            }
        }
    }
    None
}


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
          id INTEGER PRIMARY KEY, day INTEGER, title TEXT, kind TEXT, kasa TEXT);
        CREATE TABLE IF NOT EXISTS ui_state(
          key TEXT PRIMARY KEY, val TEXT, updated_ts REAL);
        CREATE TABLE IF NOT EXISTS agy_usage_cache(
          id INTEGER PRIMARY KEY CHECK(id=1), raw TEXT, ts REAL);",
    );

    if let Ok(raw) = c.query_row("SELECT raw FROM agy_usage_cache WHERE id=1", [], |r| {
        r.get::<_, String>(0)
    }) {
        if let Some(parsed) = parse_agy_usage_json(&raw, now_ts()) {
            if let Ok(mut cache) = USAGE_CACHE.lock() {
                if cache.data.is_none() {
                    cache.data = Some(parsed);
                }
            }
        }
    }

    let n_ev: i64 = c
        .query_row("SELECT COUNT(*) FROM cal_events", [], |r| r.get(0))
        .unwrap_or(0);
    // Migrate legacy gemini-flash quota counters to the shared gemini-hydrogen slot.
    let _ = c.execute(
        "UPDATE usage SET provider='gemini-hydrogen' WHERE provider='gemini-flash'",
        [],
    );
    let _ = c.execute(
        "UPDATE exhausted SET provider='gemini-hydrogen'
         WHERE provider='gemini-flash'
           AND NOT EXISTS (SELECT 1 FROM exhausted WHERE provider='gemini-hydrogen')",
        [],
    );
    let _ = c.execute("DELETE FROM exhausted WHERE provider='gemini-flash'", []);
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
    quota_status_with(false, false)
}

pub fn quota_status_with(live: bool, refresh: bool) -> Vec<Value> {
    let mut out = Vec::new();
    let now = now_ts();
    let live_map = if live || refresh {
        fetch_agy_usage(refresh)
    } else {
        USAGE_CACHE.lock().ok().and_then(|c| c.data.clone())
    };
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
                "detail": format!("sınırsız · {} istek", n),
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

        if let Some(ref map) = live_map {
            if let Some(info) = map.get(p.id) {
                out.push(json!({
                    "id": p.id,
                    "label": p.label,
                    "limit": limit,
                    "count": n,
                    "used_pct": info.used_pct,
                    "remaining_pct": info.remaining_pct,
                    "reset_s": info.reset_s,
                    "detail": info.detail,
                    "group": info.group,
                    "buckets": info.buckets,
                    "source": "agy_cli",
                    "cloud": true
                }));
                continue;
            }
        }

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

pub fn get_ui_state() -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Ok(c) = open_conn() else { return out };
    let Ok(mut st) = c.prepare("SELECT key, val FROM ui_state") else {
        return out;
    };
    if let Ok(rows) = st.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        for r in rows.flatten() {
            out.insert(r.0, Value::String(r.1));
        }
    }
    out
}

pub fn set_ui_state(items: &serde_json::Map<String, Value>) {
    let Ok(mut c) = open_conn() else { return };
    let Ok(tx) = c.transaction() else { return };
    let ts = now_ts();
    for (k, v) in items {
        if k.is_empty() {
            continue;
        }
        if v.is_null() {
            let _ = tx.execute("DELETE FROM ui_state WHERE key=?1", params![k]);
        } else {
            let s = match v {
                Value::String(st) => st.clone(),
                other => other.to_string(),
            };
            let _ = tx.execute(
                "INSERT INTO ui_state(key,val,updated_ts) VALUES(?1,?2,?3)
                 ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_ts=excluded.updated_ts",
                params![k, s, ts],
            );
        }
    }
    let _ = tx.commit();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agy_usage_json_groups() {
        let raw = r#"{"status":"SUCCESS","command":{"name":"usage","data":{"groups":[{"name":"Gemini Models","description":"Gemini 4 Hydrogen","buckets":[{"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.66,"reset_time":"2026-11-20T22:51:49Z"},{"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":0.65,"reset_time":"2026-11-15T13:20:49Z"}]},{"name":"Claude and GPT models","description":"Claude Opus 5.5, Claude Sonnet 5.5","buckets":[{"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.0,"reset_time":"2026-11-17T07:42:49Z"},{"id":"3p-5h","name":"Five Hour Limit Remaining","window":"5h","disabled":true,"remaining_fraction":1.0}]},{"name":"Gemini 4 Argon","description":"Argon","buckets":[{"id":"gemini-argon-wtu-weekly","name":"Gemini 4 Argon Weekly Limit","window":"weekly","remaining_fraction":0.74,"reset_time":"2026-11-20T23:13:24Z"}]}]}}}"#;
        let parsed = parse_agy_usage_json(raw, 1794745200.0).expect("should parse");
        assert_eq!(parsed["gemini-hydrogen"].remaining_pct, 65);
        assert_eq!(parsed["gemini-hydrogen"].used_pct, 35);
        assert!(parsed["gemini-hydrogen"].detail.contains("Haftalık: %66"));
        assert!(parsed["gemini-hydrogen"].detail.contains("5 sa: %65"));
        assert_eq!(parsed["gemini-argon"].remaining_pct, 74);
        assert_eq!(parsed["gemini-argon"].used_pct, 26);
        assert_eq!(parsed["claude-opus"].used_pct, 100);
        assert_eq!(parsed["claude-sonnet"].used_pct, 100);
    }
}
