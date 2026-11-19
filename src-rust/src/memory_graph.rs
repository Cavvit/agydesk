use crate::config::{DB_PATH, VAULT_DIR};
use once_cell::sync::Lazy;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

static WIKILINK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]").unwrap());
static TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:^|\s)#([a-zA-Z0-9_çğıöşüÇĞİÖŞÜ/-]{2,32})").unwrap());
static HEADING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^#{1,3}\s+(.+)$").unwrap());

#[derive(Debug, Clone, Serialize)]
pub struct MemoryStats {
    pub nodes: i64,
    pub edges: i64,
    pub session_memories: i64,
    pub indexed_now: usize,
    pub removed_now: usize,
    pub fts_ready: bool,
}

fn open_db() -> Result<Connection, String> {
    if let Some(p) = DB_PATH.parent() {
        let _ = fs::create_dir_all(p);
    }
    let conn = Connection::open(&*DB_PATH).map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS vault_nodes (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            folder TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            summary TEXT NOT NULL,
            word_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_edges (
            src TEXT NOT NULL,
            dst TEXT NOT NULL,
            kind TEXT NOT NULL,
            PRIMARY KEY (src, dst, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_vault_edges_src ON vault_edges(src);
        CREATE INDEX IF NOT EXISTS idx_vault_edges_dst ON vault_edges(dst);
        CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
            path UNINDEXED,
            title,
            headings,
            body,
            tokenize='unicode61'
        );
        CREATE TABLE IF NOT EXISTS session_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session TEXT NOT NULL,
            topic TEXT NOT NULL,
            summary TEXT NOT NULL,
            note_path TEXT NOT NULL DEFAULT '',
            ts INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS session_memory_fts USING fts5(
            mem_id UNINDEXED,
            topic,
            summary,
            tokenize='unicode61'
        );
        ",
    )
    .map_err(|e| e.to_string())
}

pub fn init_memory_graph() {
    if let Ok(conn) = open_db() {
        let _ = init_schema(&conn);
    }
}

fn should_skip_dir(name: &str) -> bool {
    let low = name.to_lowercase();
    low.starts_with('.')
        || matches!(
            low.as_str(),
            "_assets" | "assets" | "node_modules" | "target" | "__pycache__"
        )
}

fn collect_md_files(root: &Path, cur: &Path, out: &mut Vec<(String, i64)>) {
    let Ok(entries) = fs::read_dir(cur) else {
        return;
    };
    for ent in entries.flatten() {
        let path = ent.path();
        let fname = ent.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !should_skip_dir(&fname) {
                collect_md_files(root, &path, out);
            }
            continue;
        }
        let low = fname.to_lowercase();
        if !low.ends_with(".md") || low.ends_with(".excalidraw.md") {
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let mtime = ent
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push((rel_str, mtime));
    }
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn parse_markdown(rel: &str, content: &str) -> (String, String, String, String, Vec<(String, String)>, i64) {
    let stem = Path::new(rel)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel)
        .to_string();

    // Strip YAML frontmatter if present
    let body = if content.starts_with("---\n") || content.starts_with("---\r\n") {
        if let Some(end_idx) = content[3..].find("\n---") {
            &content[3 + end_idx + 4..]
        } else {
            content
        }
    } else {
        content
    };

    let mut headings: Vec<String> = Vec::new();
    for cap in HEADING_RE.captures_iter(body) {
        if let Some(m) = cap.get(1) {
            let h = m.as_str().trim();
            if !h.is_empty() {
                headings.push(h.to_string());
            }
        }
    }
    let title = headings.first().cloned().unwrap_or(stem);
    let headings_str = headings.join(" | ");

    // Build compact prose summary (~220 chars), skipping code fences and headings
    let mut summary_parts: Vec<String> = Vec::new();
    let mut in_code = false;
    let mut summary_len = 0usize;
    for line in body.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || t.is_empty() || t.starts_with('#') || t.starts_with("---") || t.starts_with("![") {
            continue;
        }
        let clean = t.trim_start_matches(|c: char| matches!(c, '-' | '*' | '>' | ' '));
        if clean.len() < 4 {
            continue;
        }
        summary_len += clean.chars().count() + 1;
        summary_parts.push(clean.to_string());
        if summary_len >= 220 {
            break;
        }
    }
    let summary = truncate_chars(&summary_parts.join(" "), 220);

    let mut edges: Vec<(String, String)> = Vec::new();
    let mut seen_edges: HashSet<(String, String)> = HashSet::new();
    for cap in WIKILINK_RE.captures_iter(body) {
        if let Some(m) = cap.get(1) {
            let target = m.as_str().trim().to_string();
            if !target.is_empty() && seen_edges.insert((target.clone(), "link".to_string())) {
                edges.push((target, "link".to_string()));
            }
        }
    }
    for cap in TAG_RE.captures_iter(body) {
        if let Some(m) = cap.get(1) {
            let tag = format!("#{}", m.as_str().to_lowercase());
            if seen_edges.insert((tag.clone(), "tag".to_string())) {
                edges.push((tag, "tag".to_string()));
            }
        }
    }

    let word_count = body.split_whitespace().count() as i64;
    // Cap indexed FTS body to 16,000 chars per note to keep index lean & fast
    let body_indexed = truncate_chars(body, 16_000);

    (title, headings_str, summary, body_indexed, edges, word_count)
}

fn upsert_note_in_conn(conn: &Connection, rel: &str, mtime: i64, content: &str) -> Result<(), String> {
    let folder = Path::new(rel)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();
    let (title, headings, summary, body_indexed, edges, word_count) = parse_markdown(rel, content);

    conn.execute(
        "INSERT OR REPLACE INTO vault_nodes (path, title, folder, mtime, summary, word_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![rel, title, folder, mtime, summary, word_count],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM vault_fts WHERE path = ?1", params![rel])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO vault_fts (path, title, headings, body) VALUES (?1, ?2, ?3, ?4)",
        params![rel, title, headings, body_indexed],
    )
    .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM vault_edges WHERE src = ?1", params![rel])
        .map_err(|e| e.to_string())?;
    for (dst, kind) in edges {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO vault_edges (src, dst, kind) VALUES (?1, ?2, ?3)",
            params![rel, dst, kind],
        );
    }
    Ok(())
}

fn remove_note_in_conn(conn: &Connection, rel: &str) {
    let _ = conn.execute("DELETE FROM vault_nodes WHERE path = ?1", params![rel]);
    let _ = conn.execute("DELETE FROM vault_fts WHERE path = ?1", params![rel]);
    let _ = conn.execute("DELETE FROM vault_edges WHERE src = ?1", params![rel]);
}

pub fn index_single_note(rel: &str) {
    let rel_norm = rel.replace('\\', "/");
    if !rel_norm.to_lowercase().ends_with(".md") {
        return;
    }
    let Ok(conn) = open_db() else {
        return;
    };
    let full = VAULT_DIR.join(&rel_norm);
    if !full.exists() {
        remove_note_in_conn(&conn, &rel_norm);
        return;
    }
    let mtime = fs::metadata(&full)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    if let Ok(content) = fs::read_to_string(&full) {
        let _ = upsert_note_in_conn(&conn, &rel_norm, mtime, &content);
    }
}

pub fn sync_vault_index() -> Result<MemoryStats, String> {
    let conn = open_db()?;
    let mut existing: HashMap<String, i64> = HashMap::new();
    if let Ok(mut st) = conn.prepare("SELECT path, mtime FROM vault_nodes") {
        if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
            for row in rows.flatten() {
                existing.insert(row.0, row.1);
            }
        }
    }

    let mut disk_files: Vec<(String, i64)> = Vec::new();
    if VAULT_DIR.exists() {
        collect_md_files(&VAULT_DIR, &VAULT_DIR, &mut disk_files);
    }
    let disk_set: HashSet<String> = disk_files.iter().map(|(p, _)| p.clone()).collect();

    let mut indexed_now = 0usize;
    let mut removed_now = 0usize;

    for old_path in existing.keys() {
        if !disk_set.contains(old_path) {
            remove_note_in_conn(&conn, old_path);
            removed_now += 1;
        }
    }

    for (rel, mtime) in disk_files {
        if existing.get(&rel).copied() == Some(mtime) {
            continue;
        }
        let full = VAULT_DIR.join(&rel);
        if let Ok(content) = fs::read_to_string(&full) {
            if upsert_note_in_conn(&conn, &rel, mtime, &content).is_ok() {
                indexed_now += 1;
            }
        }
    }

    let nodes: i64 = conn
        .query_row("SELECT COUNT(*) FROM vault_nodes", [], |r| r.get(0))
        .unwrap_or(0);
    let edges: i64 = conn
        .query_row("SELECT COUNT(*) FROM vault_edges", [], |r| r.get(0))
        .unwrap_or(0);
    let session_memories: i64 = conn
        .query_row("SELECT COUNT(*) FROM session_memory", [], |r| r.get(0))
        .unwrap_or(0);

    Ok(MemoryStats {
        nodes,
        edges,
        session_memories,
        indexed_now,
        removed_now,
        fts_ready: true,
    })
}

pub fn get_stats() -> Value {
    let Ok(conn) = open_db() else {
        return json!({ "nodes": 0, "edges": 0, "session_memories": 0, "fts_ready": false });
    };
    let nodes: i64 = conn
        .query_row("SELECT COUNT(*) FROM vault_nodes", [], |r| r.get(0))
        .unwrap_or(0);
    let edges: i64 = conn
        .query_row("SELECT COUNT(*) FROM vault_edges", [], |r| r.get(0))
        .unwrap_or(0);
    let session_memories: i64 = conn
        .query_row("SELECT COUNT(*) FROM session_memory", [], |r| r.get(0))
        .unwrap_or(0);
    json!({
        "nodes": nodes,
        "edges": edges,
        "session_memories": session_memories,
        "fts_ready": true
    })
}

fn build_fts_query(raw: &str) -> String {
    const STOP: &[&str] = &[
        "ve", "veya", "ile", "icin", "için", "ama", "fakat", "bir", "bu", "şu", "su", "o",
        "da", "de", "mi", "mı", "mu", "mü", "ne", "nasıl", "nasil", "neden", "niye", "gibi",
        "daha", "çok", "cok", "en", "var", "yok", "bana", "ben", "sen", "the", "and", "for",
        "with", "that", "this", "from", "what", "how", "why", "not", "yaz", "yap", "anlat",
        "açıkla", "acikla", "özetle", "ozetle",
    ];
    let mut terms: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for tok in raw.split(|c: char| !c.is_alphanumeric() && c != '_') {
        let low = tok.to_lowercase();
        if low.chars().count() < 3 || STOP.contains(&low.as_str()) {
            continue;
        }
        if seen.insert(low.clone()) {
            terms.push(format!("\"{}\"*", low));
            if terms.len() >= 8 {
                break;
            }
        }
    }
    terms.join(" OR ")
}

fn record_turn_memory_in_conn(
    conn: &Connection,
    session: &str,
    user_text: &str,
    ai_reply: &str,
    active_note: Option<&str>,
) -> Result<(), String> {
    let q_clean = user_text.trim();
    let a_clean = ai_reply.trim();
    if q_clean.chars().count() < 6 || a_clean.chars().count() < 16 {
        return Ok(());
    }
    let topic = truncate_chars(
        q_clean.lines().next().unwrap_or(q_clean).trim(),
        100,
    );
    // Pick first meaningful non-code line(s) from AI reply as compact summary
    let mut lines: Vec<&str> = Vec::new();
    let mut in_code = false;
    for l in a_clean.lines() {
        let t = l.trim();
        if t.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || t.is_empty() {
            continue;
        }
        lines.push(t.trim_start_matches(|c: char| matches!(c, '#' | '-' | '*' | ' ')));
        if lines.len() >= 2 {
            break;
        }
    }
    let summary = truncate_chars(&lines.join(" — "), 240);
    if summary.is_empty() {
        return Ok(());
    }
    let note_path = active_note.unwrap_or("").replace('\\', "/");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO session_memory (session, topic, summary, note_path, ts)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![session, topic, summary, note_path, ts],
    )
    .map_err(|e| e.to_string())?;
    let mem_id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO session_memory_fts (mem_id, topic, summary) VALUES (?1, ?2, ?3)",
        params![mem_id, topic, summary],
    )
    .map_err(|e| e.to_string())?;

    // Keep session_memory bounded to last 500 entries
    let _ = conn.execute(
        "DELETE FROM session_memory WHERE id NOT IN (SELECT id FROM session_memory ORDER BY id DESC LIMIT 500)",
        [],
    );
    let _ = conn.execute(
        "DELETE FROM session_memory_fts WHERE mem_id NOT IN (SELECT id FROM session_memory)",
        [],
    );
    Ok(())
}

pub fn record_turn_memory(session: &str, user_text: &str, ai_reply: &str, active_note: Option<&str>) {
    if let Ok(conn) = open_db() {
        let _ = record_turn_memory_in_conn(&conn, session, user_text, ai_reply, active_note);
    }
}

fn query_memory_context_in_conn(
    conn: &Connection,
    query: &str,
    active_note: Option<&str>,
    max_chars: usize,
) -> (String, Vec<Value>, Vec<Value>, Vec<Value>) {
    let active_norm = active_note.map(|s| s.replace('\\', "/"));
    let fts_q = build_fts_query(query);

    let mut note_hits: Vec<(String, String, String)> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();
    if let Some(ref a) = active_norm {
        seen_paths.insert(a.clone());
    }

    if !fts_q.is_empty() {
        if let Ok(mut st) = conn.prepare(
            "SELECT n.path, n.title, n.summary
             FROM vault_fts f
             JOIN vault_nodes n ON n.path = f.path
             WHERE vault_fts MATCH ?1
             ORDER BY bm25(vault_fts)
             LIMIT 6",
        ) {
            if let Ok(rows) = st.query_map(params![fts_q], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    if seen_paths.insert(row.0.clone()) {
                        note_hits.push(row);
                        if note_hits.len() >= 3 {
                            break;
                        }
                    }
                }
            }
        }
    }

    // 1-hop graph neighbors from active_note or top FTS hit (wikilinks + shared tags)
    let mut seed_paths: Vec<String> = Vec::new();
    if let Some(ref a) = active_norm {
        seed_paths.push(a.clone());
    }
    if let Some((top_path, _, _)) = note_hits.first() {
        seed_paths.push(top_path.clone());
    }

    let mut neighbor_hits: Vec<(String, String, String)> = Vec::new();
    for seed in seed_paths {
        let seed_stem = Path::new(&seed)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&seed)
            .to_string();
        if let Ok(mut st) = conn.prepare(
            "SELECT DISTINCT n.path, n.title, n.summary
             FROM vault_nodes n
             WHERE n.path != ?1
               AND (
                   -- outgoing wikilinks from seed
                   EXISTS (
                       SELECT 1 FROM vault_edges e
                       WHERE e.src = ?1 AND e.kind = 'link'
                         AND (lower(n.title) = lower(e.dst) OR lower(n.path) LIKE '%' || lower(e.dst) || '.md')
                   )
                   -- incoming wikilinks to seed
                   OR EXISTS (
                       SELECT 1 FROM vault_edges e
                       WHERE e.src = n.path AND e.kind = 'link'
                         AND lower(e.dst) = lower(?2)
                   )
                   -- shared tags with seed
                   OR EXISTS (
                       SELECT 1 FROM vault_edges e1
                       JOIN vault_edges e2 ON e1.dst = e2.dst AND e1.kind = 'tag' AND e2.kind = 'tag'
                       WHERE e1.src = ?1 AND e2.src = n.path
                   )
               )
             LIMIT 4",
        ) {
            if let Ok(rows) = st.query_map(params![seed, seed_stem], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            }) {
                for row in rows.flatten() {
                    if seen_paths.insert(row.0.clone()) {
                        neighbor_hits.push(row);
                        if neighbor_hits.len() >= 3 {
                            break;
                        }
                    }
                }
            }
        }
        if neighbor_hits.len() >= 3 {
            break;
        }
    }

    // Past session memory FTS5
    let mut mem_hits: Vec<(String, String)> = Vec::new();
    if !fts_q.is_empty() {
        if let Ok(mut st) = conn.prepare(
            "SELECT m.topic, m.summary
             FROM session_memory_fts f
             JOIN session_memory m ON m.id = f.mem_id
             WHERE session_memory_fts MATCH ?1
             ORDER BY bm25(session_memory_fts), m.ts DESC
             LIMIT 2",
        ) {
            if let Ok(rows) = st.query_map(params![fts_q], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    mem_hits.push(row);
                }
            }
        }
    }

    if note_hits.is_empty() && neighbor_hits.is_empty() && mem_hits.is_empty() {
        return (String::new(), vec![], vec![], vec![]);
    }

    let mut out = String::from("[HAFIZA GRAFI — ilgili not/bağlantı özetleri, gerekirse tam oku]\n");
    for (p, t, s) in &note_hits {
        let line = format!("• [[{}]] ({}): {}\n", t, p, s);
        if out.chars().count() + line.chars().count() > max_chars {
            break;
        }
        out.push_str(&line);
    }
    for (p, t, s) in &neighbor_hits {
        let line = format!("• [bağlantılı] [[{}]] ({}): {}\n", t, p, s);
        if out.chars().count() + line.chars().count() > max_chars {
            break;
        }
        out.push_str(&line);
    }
    for (topic, sum) in &mem_hits {
        let line = format!("• [geçmiş sohbet] {}: {}\n", topic, sum);
        if out.chars().count() + line.chars().count() > max_chars {
            break;
        }
        out.push_str(&line);
    }
    out.push('\n');

    let note_json = note_hits
        .into_iter()
        .map(|(p, t, s)| json!({ "path": p, "title": t, "summary": s }))
        .collect();
    let neigh_json = neighbor_hits
        .into_iter()
        .map(|(p, t, s)| json!({ "path": p, "title": t, "summary": s }))
        .collect();
    let mem_json = mem_hits
        .into_iter()
        .map(|(t, s)| json!({ "topic": t, "summary": s }))
        .collect();

    (out, note_json, neigh_json, mem_json)
}

pub fn query_memory_context(query: &str, active_note: Option<&str>, max_chars: usize) -> String {
    let Ok(conn) = open_db() else {
        return String::new();
    };
    let (ctx, _, _, _) = query_memory_context_in_conn(&conn, query, active_note, max_chars);
    ctx
}

pub fn debug_query(query: &str, active_note: Option<&str>) -> Value {
    let Ok(conn) = open_db() else {
        return json!({ "ok": false, "context": "" });
    };
    let (ctx, notes, neighbors, memories) = query_memory_context_in_conn(&conn, query, active_note, 1400);
    json!({
        "ok": true,
        "fts_query": build_fts_query(query),
        "notes": notes,
        "neighbors": neighbors,
        "memories": memories,
        "context": ctx,
        "chars": ctx.chars().count()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn fts_and_wikilink_neighbor_retrieval() {
        let conn = mem_conn();
        upsert_note_in_conn(
            &conn,
            "EEM/RLC_Devreleri.md",
            100,
            "# RLC Devreleri\nRezonans frekansı ve empedans hesabı. Bkz: [[Laplace_Donusumu]] #elektrik",
        )
        .unwrap();
        upsert_note_in_conn(
            &conn,
            "Mat/Laplace_Donusumu.md",
            101,
            "# Laplace Dönüşümü\nZaman domeninden s-domenine geçiş formülleri. #elektrik",
        )
        .unwrap();
        upsert_note_in_conn(
            &conn,
            "EEM/OpAmp.md",
            102,
            "# OpAmp\nİdeal işlemsel yükselteç devresi.",
        )
        .unwrap();

        let (ctx, notes, neighbors, _) =
            query_memory_context_in_conn(&conn, "RLC rezonans empedans", None, 1400);
        assert!(!notes.is_empty(), "expected FTS hit for RLC");
        assert_eq!(notes[0]["path"], "EEM/RLC_Devreleri.md");
        assert!(
            neighbors.iter().any(|n| n["path"] == "Mat/Laplace_Donusumu.md"),
            "expected 1-hop wikilink/tag neighbor Laplace_Donusumu, got: {:?}",
            neighbors
        );
        assert!(ctx.contains("HAFIZA GRAFI"));
        assert!(ctx.chars().count() <= 1450);
    }

    #[test]
    fn session_memory_recall_and_sanitization() {
        let conn = mem_conn();
        record_turn_memory_in_conn(
            &conn,
            "side_ai",
            "Thevenin eşdeğer devresi nasıl bulunur?",
            "Açık devre gerilimi Vth ve pasif direnç Rth hesaplanır.",
            Some("EEM/Thevenin.md"),
        )
        .unwrap();

        let (ctx, _, _, mems) = query_memory_context_in_conn(
            &conn,
            "Thevenin \"eşdeğer\" (Vth)???",
            None,
            1400,
        );
        assert_eq!(mems.len(), 1);
        assert!(ctx.contains("Vth"));
    }
}
