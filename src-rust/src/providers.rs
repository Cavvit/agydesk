use crate::config::{
    effective_effort, model_for, provider_spec, AGY_BIN, OLLAMA_URL, VAULT_DIR, WORKSPACE,
};
use crate::router::CLOUD_CHAIN;
use crate::store;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const CREATE_NO_WINDOW: u32 = 0x08000000;

static PROCS: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));
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
    let pid = PROCS.lock().ok().and_then(|mut m| m.remove(session));
    if let Some(p) = pid {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &p.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        return true;
    }
    false
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

fn run_agy_sync<F>(
    session: &str,
    model: &str,
    effort: &str,
    prompt: &str,
    mode: &str,
    conv_id: Option<&str>,
    on_step: &F,
) -> Result<(String, i64, bool, Option<String>), String>
where
    F: Fn(String) + Send + Sync,
{
    let bin = &*AGY_BIN;
    let mut cmd = if bin.to_lowercase().ends_with(".cmd") || bin.to_lowercase().ends_with(".bat") {
        let mut c = Command::new("cmd.exe");
        c.args(["/C", bin]);
        c
    } else {
        Command::new(bin)
    };

    cmd.args([
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--model",
        model,
        "--effort",
        effort,
        "--print-timeout",
        "300s",
    ]);

    if mode == "r" || mode == "y" {
        cmd.arg("--dangerously-skip-permissions");
    } else {
        cmd.args(["--mode", "accept-edits"]);
    }
    if *VAULT_DIR != *WORKSPACE && VAULT_DIR.exists() {
        cmd.arg("--add-dir").arg(&*VAULT_DIR);
    }
    if let Some(cid) = conv_id {
        if !cid.is_empty() {
            cmd.args(["--conversation", cid]);
        }
    }

    cmd.current_dir(&*WORKSPACE)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    if let Ok(mut m) = PROCS.lock() {
        m.insert(session.to_string(), pid);
    }

    let mut new_conv = conv_id.map(|s| s.to_string());
    let mut chunks: Vec<String> = Vec::new();
    let mut tool_logs: Vec<String> = Vec::new();
    let mut final_resp: Option<String> = None;
    let mut agy_err: Option<String> = None;
    let mut tokens: i64 = 0;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with('{') {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
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
                        if let Some(delta) = su.get("text_delta").and_then(|v| v.as_str()) {
                            chunks.push(delta.to_string());
                        }
                        if let Some(err) = su.get("error").and_then(|v| v.as_str()) {
                            if !err.trim().is_empty() {
                                agy_err = Some(err.trim().to_string());
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
                            on_step(tlabel);
                        } else if !stype.is_empty() {
                            let sidx = su.get("step_index").and_then(|v| v.as_i64()).unwrap_or(0);
                            on_step(format!("agy ({}) · adım #{}: {}", model, sidx, stype));
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
                }
                _ => {}
            }
        }
    }

    let status = child.wait();
    if let Ok(mut m) = PROCS.lock() {
        m.remove(session);
    }

    let mut text = final_resp
        .unwrap_or_else(|| chunks.join(""))
        .trim()
        .to_string();
    if text.is_empty() && agy_err.is_some() {
        return Err(agy_err.unwrap());
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
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        let mut err_str = String::new();
        if let Some(mut se) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut se, &mut err_str);
        }
        let msg = err_str.trim();
        if code != 0 || !msg.is_empty() {
            return Err(if msg.is_empty() {
                format!("agy çıkış kodu: {}", code)
            } else {
                msg.to_string()
            });
        }
    }
    Ok((text, tokens, true, new_conv))
}

pub async fn complete<FS, FF>(
    mut provider: String,
    prompt: String,
    image_paths: Vec<PathBuf>,
    session: String,
    mode: String,
    effort: String,
    conv_id: Option<String>,
    on_step: FS,
    mut on_failover: FF,
) -> Result<(String, i64, bool, Option<String>), String>
where
    FS: Fn(String) + Send + Sync + Clone + 'static,
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

        let res = tokio::task::spawn_blocking(move || {
            run_agy_sync(
                &sess_c,
                &model,
                eff,
                &prompt_c,
                &mode_c,
                conv_c.as_deref(),
                &step_cb,
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
    use super::encode_base64;

    #[test]
    fn base64_encodes_standard_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }
}
