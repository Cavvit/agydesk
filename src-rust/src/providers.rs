use crate::config::{
    effective_effort, is_restricted_session, is_study_session, model_for, provider_spec, AGY_BIN,
    CLI_WORKSPACE, DRIVE_DIR, OLLAMA_URL, PERSONAL_DIRS, VAULT_DIR, WORKSPACE,
};
use crate::router::CLOUD_CHAIN;
use crate::store;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x08000000;

type StepCallback = Arc<dyn Fn(String) + Send + Sync>;

struct WarmAgyProc {
    child: Child,
    pid: u32,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    model: String,
    effort: String,
    mode: String,
    restricted: bool,
    conv_id: Option<String>,
    last_used: Instant,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    auth_cb: Arc<Mutex<Option<StepCallback>>>,
}

impl WarmAgyProc {
    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn kill_now(mut self) {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &self.pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static PROCS: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static WARM_PROCS: Lazy<Mutex<HashMap<String, WarmAgyProc>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RESET_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)Resets in (?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?").unwrap());

fn parse_reset_s(err: &str) -> i64 {
    let Some(cap) = RESET_RE.captures(err) else {
        return 3600;
    };
    let h: i64 = cap.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    let mn: i64 = cap.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    let s: i64 = cap.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
    (h * 3600 + mn * 60 + s).max(60)
}

pub fn agy_available() -> bool {
    let bin = &*AGY_BIN;
    Path::new(bin).exists() || bin == "agy"
}

pub async fn ollama_alive() -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    else {
        return false;
    };
    let url = format!("{}/api/tags", &*OLLAMA_URL);
    client
        .get(url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub fn kill_session_proc(session: &str) -> bool {
    let warm = WARM_PROCS.lock().ok().and_then(|mut m| m.remove(session));
    let pid = PROCS.lock().ok().and_then(|mut m| m.remove(session));
    let mut killed = false;
    if let Some(wp) = warm {
        wp.kill_now();
        killed = true;
    }
    if let Some(p) = pid {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &p.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        killed = true;
    }
    killed
}

pub fn reap_idle_procs(max_idle: Duration) -> usize {
    let mut stale: Vec<(String, WarmAgyProc)> = Vec::new();
    if let Ok(mut map) = WARM_PROCS.lock() {
        let keys: Vec<String> = map
            .iter_mut()
            .filter_map(|(k, wp)| {
                if wp.last_used.elapsed() >= max_idle || !wp.is_alive() {
                    Some(k.clone())
                } else {
                    None
                }
            })
            .collect();
        for k in keys {
            if let Some(wp) = map.remove(&k) {
                stale.push((k, wp));
            }
        }
    }
    let count = stale.len();
    for (sess, wp) in stale {
        if let Ok(mut pm) = PROCS.lock() {
            if pm.get(&sess).copied() == Some(wp.pid) {
                pm.remove(&sess);
            }
        }
        wp.kill_now();
    }
    count
}

pub fn kill_all_procs() {
    let all_warm: Vec<WarmAgyProc> = WARM_PROCS
        .lock()
        .ok()
        .map(|mut m| m.drain().map(|(_, v)| v).collect())
        .unwrap_or_default();
    for wp in all_warm {
        wp.kill_now();
    }
    let all_pids: Vec<u32> = PROCS
        .lock()
        .ok()
        .map(|mut m| m.drain().map(|(_, v)| v).collect())
        .unwrap_or_default();
    for p in all_pids {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &p.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

pub fn warm_pool_count() -> usize {
    WARM_PROCS.lock().map(|m| m.len()).unwrap_or(0)
}

async fn mock_reply(provider: &str, prompt: &str, why: &str) -> (String, i64, bool, Option<String>) {
    tokio::time::sleep(Duration::from_millis(600)).await;
    let snippet: String = prompt.chars().take(160).collect();
    (
        format!("[DEMO · {}] {}. İstek: {}", provider, why, snippet),
        0,
        false,
        None,
    )
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((input.len() + 2) / 3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

async fn local_complete(prompt: &str, image_paths: &[PathBuf]) -> (String, i64, bool, Option<String>) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
    else {
        return mock_reply("local", prompt, "HTTP istemci hatası").await;
    };
    let url = format!("{}/api/generate", &*OLLAMA_URL);
    let mut body = json!({
        "model": model_for("local", "low"),
        "prompt": prompt,
        "think": false,
        "stream": false
    });
    if !image_paths.is_empty() {
        let b64s: Vec<String> = image_paths
            .iter()
            .filter_map(|p| std::fs::read(p).ok())
            .filter(|bytes| !bytes.is_empty() && bytes.len() <= 20 * 1024 * 1024)
            .map(|bytes| encode_base64(&bytes))
            .collect();
        if !b64s.is_empty() {
            if let Some(obj) = body.as_object_mut() {
                obj.insert("images".to_string(), json!(b64s));
            }
        }
    }
    if let Ok(resp) = client.post(url).json(&body).send().await {
        if resp.status().is_success() {
            if let Ok(j) = resp.json::<Value>().await {
                let text = j
                    .get("response")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let tokens = j.get("eval_count").and_then(|v| v.as_i64()).unwrap_or(0);
                return (text, tokens, true, None);
            }
        }
    }
    mock_reply("local", prompt, "Ollama çalışmıyor (yerel model kapalı)").await
}

fn agy_command() -> Command {
    let bin = &*AGY_BIN;
    if bin.to_lowercase().ends_with(".cmd") || bin.to_lowercase().ends_with(".bat") {
        let mut c = Command::new("cmd.exe");
        c.args(["/C", bin]);
        c
    } else {
        Command::new(bin)
    }
}

pub fn detect_auth_hint(line: &str) -> Option<String> {
    let low = line.to_lowercase();
    let is_auth = low.contains("accounts.google.com")
        || low.contains("oauth")
        || low.contains("open your browser")
        || low.contains("sign in")
        || low.contains("authenticate")
        || low.contains("authentication")
        || low.contains("login");
    if !is_auth {
        return None;
    }
    if let Some(idx) = line.find("https://") {
        let url: String = line[idx..]
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches(|c: char| matches!(c, ')' | ']' | '"' | '\'' | ','))
            .to_string();
        if !url.is_empty() {
            return Some(format!(
                "🔑 Tarayıcıda oturum açılması bekleniyor: {} (girişi tamamla veya ■ Dur ile iptal et)",
                url
            ));
        }
    }
    Some("🔑 Tarayıcıda Google oturumu açılması bekleniyor (Chrome penceresini tamamla veya ■ Dur ile iptal et)…".to_string())
}

pub fn is_auth_error(msg: &str) -> bool {
    let low = msg.to_lowercase();
    [
        "authentication failed",
        "auth_required",
        "unauthenticated",
        "unauthorized",
        "login required",
        "not logged in",
        "invalid_grant",
        "token expired",
    ]
    .iter()
    .any(|k| low.contains(k))
}

pub fn run_agy_login_sync() -> Result<(), String> {
    let mut cmd = agy_command();
    cmd.args([
        "-p",
        "ok",
        "--output-format",
        "json",
        "--model",
        "gemini-4-hydrogen-low",
        "--effort",
        "low",
        "--print-timeout",
        "150s",
        "--mode",
        "accept-edits",
    ])
    .current_dir(&*WORKSPACE)
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stdout.lines() {
        let t = line.trim();
        if t.starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(t) {
                let err = v
                    .get("error")
                    .or_else(|| v.get("result").and_then(|r| r.get("error")))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .trim();
                if !err.is_empty() {
                    return Err(err.to_string());
                }
            }
        }
    }
    if out.status.success() {
        return Ok(());
    }
    let msg = stderr.trim();
    if !msg.is_empty() {
        return Err(msg.to_string());
    }
    Err(format!(
        "agy giriş çıkış kodu: {}",
        out.status.code().unwrap_or(-1)
    ))
}

fn spawn_warm_proc(
    session: &str,
    model: &str,
    effort: &str,
    mode: &str,
    restricted: bool,
    conv_id: Option<&str>,
) -> Result<WarmAgyProc, String> {
    let mut cmd = agy_command();
    cmd.args([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        model,
        "--effort",
        effort,
        "--print-timeout",
        "300s",
        "-p=",
    ]);

    if restricted {
        // Hard security boundary is enforced by PreToolUse hook (agydesk-guard.exe, matcher="*").
        // Use --dangerously-skip-permissions so whitelisted tools (incl. sandboxed PDF export)
        // execute without headless print-mode interactive approval cancellation.
        let study = is_study_session(session);
        cmd.arg("--dangerously-skip-permissions");
        cmd.env("AGYDESK_SCOPE", if study { "study" } else { "restricted" });
        cmd.env("AGYDESK_SESSION", session);
        cmd.env("AGYDESK_API_URL", "http://127.0.0.1:8780");
        if let Some(ref drive) = *DRIVE_DIR {
            if drive.exists() {
                cmd.arg("--add-dir").arg(drive);
            }
        }
        if study {
            for (_, _, pdir) in PERSONAL_DIRS.iter() {
                if pdir.exists() {
                    cmd.arg("--add-dir").arg(pdir);
                }
            }
        }
        cmd.current_dir(&*VAULT_DIR);
    } else {
        if mode == "r" || mode == "y" {
            cmd.arg("--dangerously-skip-permissions");
        } else {
            cmd.args(["--mode", "accept-edits"]);
        }
        cmd.env("AGYDESK_SCOPE", "full");
        if *VAULT_DIR != *CLI_WORKSPACE && VAULT_DIR.exists() {
            cmd.arg("--add-dir").arg(&*VAULT_DIR);
        }
        if let Some(ref drive) = *DRIVE_DIR {
            if drive.exists() {
                cmd.arg("--add-dir").arg(drive);
            }
        }
        cmd.current_dir(&*CLI_WORKSPACE);
    }
    if let Some(cid) = conv_id {
        if !cid.is_empty() {
            cmd.args(["--conversation", cid]);
        }
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "agy stdin alınamadı".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "agy stdout alınamadı".to_string())?;
    let stderr_pipe = child.stderr.take();

    if let Ok(mut m) = PROCS.lock() {
        m.insert(session.to_string(), pid);
    }

    let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let auth_cb: Arc<Mutex<Option<StepCallback>>> = Arc::new(Mutex::new(None));

    if let Some(se) = stderr_pipe {
        let se_lines = Arc::clone(&stderr_lines);
        let se_cb = Arc::clone(&auth_cb);
        std::thread::spawn(move || {
            let reader = BufReader::new(se);
            for line in reader.lines().flatten() {
                let t = line.trim().to_string();
                if t.is_empty() {
                    continue;
                }
                if let Some(hint) = detect_auth_hint(&t) {
                    if let Ok(guard) = se_cb.lock() {
                        if let Some(ref cb) = *guard {
                            cb(hint);
                        }
                    }
                }
                if let Ok(mut buf) = se_lines.lock() {
                    if buf.len() >= 60 {
                        buf.remove(0);
                    }
                    buf.push(t);
                }
            }
        });
    }

    Ok(WarmAgyProc {
        child,
        pid,
        stdin,
        stdout: BufReader::new(stdout),
        model: model.to_string(),
        effort: effort.to_string(),
        mode: mode.to_string(),
        restricted,
        conv_id: conv_id.map(|s| s.to_string()),
        last_used: Instant::now(),
        stderr_lines,
        auth_cb,
    })
}

fn run_turn_on_warm<F, FD>(
    wp: &mut WarmAgyProc,
    prompt: &str,
    on_step: &F,
    on_delta: &FD,
) -> (Result<(String, i64, bool, Option<String>), String>, bool, bool)
where
    F: Fn(String) + Send + Sync + Clone + 'static,
    FD: Fn(String) + Send + Sync,
{
    if let Ok(mut buf) = wp.stderr_lines.lock() {
        buf.clear();
    }
    let step_arc: StepCallback = Arc::new(on_step.clone());
    if let Ok(mut guard) = wp.auth_cb.lock() {
        *guard = Some(Arc::clone(&step_arc));
    }

    let payload = json!({
        "event": "user",
        "message": { "content": prompt }
    });
    let write_res = writeln!(wp.stdin, "{}", payload).and_then(|_| wp.stdin.flush());
    if let Err(e) = write_res {
        if let Ok(mut guard) = wp.auth_cb.lock() {
            *guard = None;
        }
        return (Err(format!("agy stdin hatası: {}", e)), false, true);
    }

    let mut new_conv = wp.conv_id.clone();
    let mut chunks: Vec<String> = Vec::new();
    let mut tool_logs: Vec<String> = Vec::new();
    let mut final_resp: Option<String> = None;
    let mut agy_err: Option<String> = None;
    let mut tokens: i64 = 0;
    let mut last_step_label = String::new();
    let mut got_result = false;

    let got_json = Arc::new(AtomicBool::new(false));
    let done_flag = Arc::new(AtomicBool::new(false));

    std::thread::scope(|scope| {
        let wd_got = Arc::clone(&got_json);
        let wd_done = Arc::clone(&done_flag);
        scope.spawn(move || {
            for _ in 0..24 {
                if wd_done.load(Ordering::Relaxed) || wd_got.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            if !wd_done.load(Ordering::Relaxed) && !wd_got.load(Ordering::Relaxed) {
                on_step(
                    "⏳ agy CLI bekleniyor — Chrome'da oturum açma ekranı açıldıysa girişi tamamla (veya ■ Dur ile iptal et)…".to_string(),
                );
            }
        });

        let mut line = String::new();
        loop {
            line.clear();
            match wp.stdout.read_line(&mut line) {
                Ok(0) => break, // EOF
                Err(_) => break,
                Ok(_) => {}
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !trimmed.starts_with('{') {
                if let Some(hint) = detect_auth_hint(trimmed) {
                    got_json.store(true, Ordering::Relaxed);
                    on_step(hint);
                }
                continue;
            }
            let Ok(ev) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            got_json.store(true, Ordering::Relaxed);
            let etype = ev.get("event").and_then(|v| v.as_str()).unwrap_or("");
            match etype {
                "init" => {
                    if let Some(cid) = ev.get("conversation_id").and_then(|v| v.as_str()) {
                        new_conv = Some(cid.to_string());
                    }
                }
                "step_update" => {
                    if let Some(su) = ev.get("step_update") {
                        if let Some(cid) = su.get("conversation_id").and_then(|v| v.as_str()) {
                            new_conv = Some(cid.to_string());
                        }
                        let stype = su.get("step_type").and_then(|v| v.as_str()).unwrap_or("");
                        let mut has_delta = false;
                        if let Some(delta) = su.get("text_delta").and_then(|v| v.as_str()) {
                            if !delta.is_empty() {
                                has_delta = true;
                                chunks.push(delta.to_string());
                                on_delta(delta.to_string());
                            }
                        }
                        if let Some(err) = su.get("error").and_then(|v| v.as_str()) {
                            if !err.trim().is_empty() {
                                agy_err = Some(err.trim().to_string());
                            }
                        } else if let Some(terr) = su
                            .get("tool_info")
                            .and_then(|ti| ti.get("error"))
                            .and_then(|e| e.get("message"))
                            .and_then(|v| v.as_str())
                        {
                            let t = terr.trim();
                            if !t.is_empty() {
                                let msg = format!("⚠ Araç engellendi/hata: {}", t);
                                if !tool_logs.contains(&msg) {
                                    tool_logs.push(msg);
                                }
                            }
                        }
                        let mut tlabel = String::new();
                        let pick_label = |tname: &str, obj: Option<&Value>| {
                            let tsum = obj
                                .and_then(|o| {
                                    o.get("toolSummary")
                                        .or_else(|| o.get("Path"))
                                        .and_then(|v| v.as_str())
                                })
                                .unwrap_or(tname)
                                .trim_matches('"');
                            format!("🛠 {}: {}", tname, tsum)
                        };
                        if let Some(t0) = su
                            .get("tool_calls")
                            .and_then(|v| v.as_array())
                            .and_then(|a| a.first())
                        {
                            let tname = t0.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                            tlabel = pick_label(tname, t0.get("args"));
                        } else if let Some(tname) = su.get("tool_name").and_then(|v| v.as_str()) {
                            tlabel = pick_label(
                                tname,
                                su.get("tool_info").and_then(|i| i.get("parameters")),
                            );
                        }
                        if !tlabel.is_empty() {
                            if !tool_logs.contains(&tlabel) {
                                tool_logs.push(tlabel.clone());
                            }
                            if last_step_label != tlabel {
                                last_step_label = tlabel.clone();
                                on_step(tlabel);
                            }
                        } else if !has_delta && !stype.is_empty() {
                            let sidx = su.get("step_index").and_then(|v| v.as_i64()).unwrap_or(0);
                            let lbl = format!("agy ({}) · adım #{}: {}", wp.model, sidx, stype);
                            if last_step_label != lbl {
                                last_step_label = lbl.clone();
                                on_step(lbl);
                            }
                        }
                        if let Some(tot) = su
                            .get("usage")
                            .and_then(|u| u.get("total_tokens"))
                            .and_then(|v| v.as_i64())
                        {
                            tokens = tot;
                        }
                    }
                }
                "result" => {
                    got_result = true;
                    if let Some(res) = ev.get("result") {
                        if let Some(cid) = res.get("conversation_id").and_then(|v| v.as_str()) {
                            new_conv = Some(cid.to_string());
                        }
                        if let Some(rtxt) = res.get("response").and_then(|v| v.as_str()) {
                            final_resp = Some(rtxt.to_string());
                        }
                        if let Some(err) = res.get("error").and_then(|v| v.as_str()) {
                            if !err.trim().is_empty() {
                                agy_err = Some(err.trim().to_string());
                            }
                        } else if res
                            .get("status")
                            .and_then(|v| v.as_str())
                            .map(|s| s != "SUCCESS")
                            .unwrap_or(false)
                        {
                            let st = res.get("status").and_then(|v| v.as_str()).unwrap_or("ERROR");
                            if agy_err.is_none() {
                                agy_err = Some(format!("agy durum: {}", st));
                            }
                        }
                        if let Some(tot) = res
                            .get("usage")
                            .and_then(|u| u.get("total_tokens"))
                            .and_then(|v| v.as_i64())
                        {
                            tokens = tot;
                        }
                    }
                    break;
                }
                _ => {}
            }
        }
        done_flag.store(true, Ordering::Relaxed);
    });

    if let Ok(mut guard) = wp.auth_cb.lock() {
        *guard = None;
    }

    let keep_alive = got_result && agy_err.is_none() && wp.is_alive();
    wp.conv_id = new_conv.clone();
    wp.last_used = Instant::now();

    let mut text = final_resp
        .unwrap_or_else(|| chunks.join(""))
        .trim()
        .to_string();
    if text.is_empty() && agy_err.is_some() {
        return (Err(agy_err.unwrap()), keep_alive, false);
    }
    if text.is_empty() && !tool_logs.is_empty() {
        let start = tool_logs.len().saturating_sub(8);
        let items: Vec<String> = tool_logs[start..]
            .iter()
            .map(|x| format!("• {}", x))
            .collect();
        text = format!("✓ Tamamlanan işlemler:\n{}", items.join("\n"));
    }
    if text.is_empty() {
        let code = wp.child.try_wait().ok().flatten().and_then(|s| s.code()).unwrap_or(-1);
        let err_str = wp
            .stderr_lines
            .lock()
            .map(|v| v.join("\n"))
            .unwrap_or_default();
        let msg = err_str.trim();
        if !got_result || code != 0 || !msg.is_empty() {
            return (
                Err(if msg.is_empty() {
                    format!("agy çıkış kodu: {}", code)
                } else {
                    msg.to_string()
                }),
                false,
                !got_result && chunks.is_empty(),
            );
        }
    }
    (Ok((text, tokens, true, new_conv)), keep_alive, false)
}

fn run_agy_sync<F, FD>(
    session: &str,
    model: &str,
    effort: &str,
    prompt: &str,
    mode: &str,
    conv_id: Option<&str>,
    on_step: &F,
    on_delta: &FD,
) -> Result<(String, i64, bool, Option<String>), String>
where
    F: Fn(String) + Send + Sync + Clone + 'static,
    FD: Fn(String) + Send + Sync,
{
    let restricted = is_restricted_session(session);
    let mut reused = false;

    let mut wp = if let Some(mut existing) = WARM_PROCS.lock().ok().and_then(|mut m| m.remove(session)) {
        let config_match = existing.model == model
            && existing.effort == effort
            && existing.mode == mode
            && existing.restricted == restricted
            && conv_id.is_some()
            && existing.conv_id.as_deref() == conv_id;
        if config_match && existing.is_alive() {
            reused = true;
            existing
        } else {
            existing.kill_now();
            spawn_warm_proc(session, model, effort, mode, restricted, conv_id)?
        }
    } else {
        spawn_warm_proc(session, model, effort, mode, restricted, conv_id)?
    };

    let (mut res, mut keep_alive, retryable) = run_turn_on_warm(&mut wp, prompt, on_step, on_delta);

    // If a reused warm process died before producing output, transparently respawn once.
    if reused && retryable && res.is_err() {
        wp.kill_now();
        wp = spawn_warm_proc(session, model, effort, mode, restricted, conv_id)?;
        let (r2, ka2, _) = run_turn_on_warm(&mut wp, prompt, on_step, on_delta);
        res = r2;
        keep_alive = ka2;
    }

    if keep_alive {
        if let Ok(mut m) = WARM_PROCS.lock() {
            m.insert(session.to_string(), wp);
        } else {
            wp.kill_now();
        }
    } else {
        if let Ok(mut pm) = PROCS.lock() {
            if pm.get(session).copied() == Some(wp.pid) {
                pm.remove(session);
            }
        }
        wp.kill_now();
    }

    res
}

pub async fn complete<FS, FD, FF>(
    mut provider: String,
    prompt: String,
    image_paths: Vec<PathBuf>,
    session: String,
    mode: String,
    effort: String,
    conv_id: Option<String>,
    on_step: FS,
    on_delta: FD,
    mut on_failover: FF,
) -> Result<(String, i64, bool, Option<String>), String>
where
    FS: Fn(String) + Send + Sync + Clone + 'static,
    FD: Fn(String) + Send + Sync + Clone + 'static,
    FF: FnMut(String, String) + Send,
{
    if provider == "local" {
        if ollama_alive().await {
            return Ok(local_complete(&prompt, &image_paths).await);
        }
        if agy_available() {
            provider = "gemini-hydrogen".to_string();
            on_failover(
                provider.clone(),
                "Yerel Ollama kapalı → Gemini 4 Hydrogen (agy CLI)".to_string(),
            );
        } else {
            return Ok(local_complete(&prompt, &image_paths).await);
        }
    }

    if !agy_available() {
        return Ok(mock_reply(&provider, &prompt, "agy CLI bulunamadı").await);
    }

    let mut chain = vec![provider.clone()];
    for &p in CLOUD_CHAIN {
        if p != provider {
            chain.push(p.to_string());
        }
    }

    let mut cur_conv = conv_id;
    let mut last_err: Option<String> = None;

    for (idx, prov) in chain.iter().enumerate() {
        let eff = effective_effort(prov, &effort);
        let model = model_for(prov, eff);
        let sess_c = session.clone();
        let prompt_c = prompt.clone();
        let mode_c = mode.clone();
        let conv_c = cur_conv.clone();
        let step_cb = on_step.clone();
        let delta_cb = on_delta.clone();

        let res = tokio::task::spawn_blocking(move || {
            run_agy_sync(
                &sess_c,
                &model,
                eff,
                &prompt_c,
                &mode_c,
                conv_c.as_deref(),
                &step_cb,
                &delta_cb,
            )
        })
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(out) => {
                if idx > 0 {
                    let orig_lbl = provider_spec(&provider).label;
                    let new_lbl = provider_spec(prov).label;
                    on_failover(
                        prov.clone(),
                        format!("{} kotası doldu → {}", orig_lbl, new_lbl),
                    );
                }
                return Ok(out);
            }
            Err(msg) => {
                last_err = Some(msg.clone());
                if msg.contains("RESOURCE_EXHAUSTED")
                    || msg.contains("Individual quota reached")
                    || msg.contains("\"error_code\":429")
                {
                    store::mark_exhausted(prov, parse_reset_s(&msg));
                    cur_conv = None;
                    if idx + 1 < chain.len() {
                        let cur_lbl = provider_spec(prov).label;
                        let nxt_lbl = provider_spec(&chain[idx + 1]).label;
                        on_step(format!(
                            "⚠ {} kotası doldu → {} modeline geçiliyor…",
                            cur_lbl, nxt_lbl
                        ));
                    }
                    continue;
                }
                return Err(msg);
            }
        }
    }

    if last_err.is_some() {
        return Ok(local_complete(&prompt, &image_paths).await);
    }
    Ok(mock_reply(&provider, &prompt, "beklenmeyen durum").await)
}

#[cfg(test)]
mod tests {
    use super::{detect_auth_hint, encode_base64, is_auth_error};

    #[test]
    fn base64_encodes_standard_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn auth_error_and_hint_detection() {
        assert!(is_auth_error("authentication failed or timed out"));
        assert!(is_auth_error("Error: INVALID_GRANT token expired"));
        assert!(!is_auth_error("RESOURCE_EXHAUSTED quota reached"));
        let hint = detect_auth_hint("Open your browser to sign in: https://accounts.google.com/o/oauth2/auth?foo=1");
        assert!(hint.as_deref().unwrap_or("").contains("https://accounts.google.com/o/oauth2/auth?foo=1"));
        assert!(detect_auth_hint("normal info line").is_none());
    }
}
