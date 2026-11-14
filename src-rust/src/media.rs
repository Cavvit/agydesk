use crate::config::ROOT;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SmtcWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for SmtcWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

static WORKER: Lazy<Mutex<Option<SmtcWorker>>> = Lazy::new(|| Mutex::new(None));

fn spawn_worker() -> Result<SmtcWorker, String> {
    let script = ROOT.join("backend").join("smtc_worker.ps1");
    if !script.exists() {
        return Err("smtc_worker.ps1 bulunamadı".to_string());
    }
    let mut child = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script.to_string_lossy(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("SMTC worker başlatılamadı: {e}"))?;

    let stdin = child.stdin.take().ok_or("stdin yok")?;
    let stdout = child.stdout.take().ok_or("stdout yok")?;
    Ok(SmtcWorker {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn rpc(payload: &Value) -> Value {
    let Ok(mut guard) = WORKER.lock() else {
        return json!({"ok": false, "error": "SMTC kilidi alınamadı"});
    };
    let line = format!("{}\n", payload);

    for attempt in 0..2 {
        let need_spawn = match guard.as_mut() {
            Some(w) => !matches!(w.child.try_wait(), Ok(None)),
            None => true,
        };
        if need_spawn {
            match spawn_worker() {
                Ok(w) => *guard = Some(w),
                Err(e) => return json!({"ok": false, "error": e}),
            }
        }
        if let Some(w) = guard.as_mut() {
            if w.stdin.write_all(line.as_bytes()).is_ok() && w.stdin.flush().is_ok() {
                let mut resp = String::new();
                if w.stdout.read_line(&mut resp).is_ok() && !resp.trim().is_empty() {
                    if let Ok(v) = serde_json::from_str::<Value>(resp.trim()) {
                        return v;
                    }
                }
            }
        }
        *guard = None;
        if attempt == 1 {
            break;
        }
    }
    json!({"ok": false, "error": "SMTC çağrısı başarısız"})
}

pub fn get_status(app: &str) -> Value {
    let mut v = rpc(&json!({"op": "status", "app": app}));
    if let Some(obj) = v.as_object_mut() {
        obj.entry("active").or_insert(Value::Null);
        obj.entry("sessions").or_insert_with(|| json!([]));
    }
    v
}

pub fn send_cmd(action: &str, app: &str, position_ms: Option<i64>) -> Value {
    if !matches!(action, "playpause" | "next" | "prev" | "seek") {
        return json!({"ok": false, "error": format!("Geçersiz komut: {action}")});
    }
    if action == "seek" {
        let Some(pos) = position_ms else {
            return json!({"ok": false, "error": "position_ms gerekli"});
        };
        return rpc(&json!({"op": "cmd", "action": action, "app": app, "position_ms": pos.max(0)}));
    }
    rpc(&json!({"op": "cmd", "action": action, "app": app}))
}

pub fn shutdown() {
    if let Ok(mut guard) = WORKER.lock() {
        *guard = None;
    }
}
