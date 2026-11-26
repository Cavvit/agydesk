use crate::config::{DRIVE_DIR, DRIVE_VAULT_DIR, PERSONAL_DIRS, ROOT, VAULT_DIR};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct GuardPolicy {
    pub vault_dir: PathBuf,
    pub drive_dir: Option<PathBuf>,
    pub drive_vault_dir: Option<PathBuf>,
    pub personal_dirs: Vec<(String, String, PathBuf)>,
    pub project_dir: PathBuf,
}

impl GuardPolicy {
    pub fn from_config() -> Self {
        Self {
            vault_dir: VAULT_DIR.clone(),
            drive_dir: DRIVE_DIR.clone(),
            drive_vault_dir: DRIVE_VAULT_DIR.clone(),
            personal_dirs: PERSONAL_DIRS
                .iter()
                .map(|(k, l, p)| ((*k).to_string(), (*l).to_string(), p.clone()))
                .collect(),
            project_dir: ROOT.clone(),
        }
    }
}

/// Normalize a path lexically (resolving `.` and `..`, converting `/` to `\`, stripping `\\?\`)
/// and lowercase it for case-insensitive Windows prefix comparison.
fn normalize_win(p: &Path, base: &Path) -> String {
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    };
    let mut parts: Vec<String> = Vec::new();
    let mut prefix_str = String::new();
    for comp in abs.components() {
        match comp {
            Component::Prefix(pr) => {
                let s = pr.as_os_str().to_string_lossy().to_string();
                prefix_str = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
            }
            Component::RootDir => {}
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(os) => {
                parts.push(os.to_string_lossy().to_string());
            }
        }
    }
    let joined = if prefix_str.is_empty() {
        format!(r"\{}", parts.join(r"\"))
    } else if parts.is_empty() {
        format!(r"{}\", prefix_str)
    } else {
        format!(r"{}\{}", prefix_str, parts.join(r"\"))
    };
    joined.to_lowercase()
}

fn is_under(target_norm: &str, root: &Path) -> bool {
    let root_norm = normalize_win(root, root);
    let root_trimmed = root_norm.trim_end_matches('\\');
    if target_norm == root_trimmed || target_norm == format!(r"{}\", root_trimmed) {
        return true;
    }
    target_norm.starts_with(&format!(r"{}\", root_trimmed))
}

fn touches_agents_dir(target_norm: &str) -> bool {
    const SENSITIVE: &[&str] = &[".agents", ".agent", ".gemini", ".git", ".ssh"];
    for seg in target_norm.split('\\') {
        if SENSITIVE.contains(&seg) {
            return true;
        }
    }
    false
}

fn touches_forbidden_dir(target_norm: &str, policy: &GuardPolicy) -> bool {
    touches_agents_dir(target_norm) || is_under(target_norm, &policy.project_dir)
}

fn touches_forbidden_cmd(cmdline: &str, cwd: &Path, policy: &GuardPolicy) -> bool {
    let cwd_norm = normalize_win(cwd, cwd);
    if touches_forbidden_dir(&cwd_norm, policy) {
        return true;
    }
    let low = cmdline.replace('/', "\\").to_ascii_lowercase();
    let proj_norm = normalize_win(&policy.project_dir, &policy.project_dir);
    let proj_trim = proj_norm.trim_end_matches('\\');
    if !proj_trim.is_empty() && low.contains(proj_trim) {
        return true;
    }
    if let Some(proj_name) = policy
        .project_dir
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
    {
        if !proj_name.is_empty() && low.contains(&proj_name) {
            return true;
        }
    }
    if low.contains("agydesk-guard") || low.contains("atolye.db") {
        return true;
    }
    const SENSITIVE: &[&str] = &[".agents", ".agent", ".gemini", ".git", ".ssh"];
    for tok in low.split(|c: char| {
        c.is_whitespace()
            || matches!(
                c,
                '\\' | '"' | '\'' | ';' | '|' | '&' | '(' | ')' | ',' | '=' | ':' | '<' | '>'
            )
    }) {
        if SENSITIVE.contains(&tok) {
            return true;
        }
    }
    false
}

fn is_allowed_browser_mcp_schema(target_norm: &str) -> bool {
    let low = target_norm.replace('/', "\\").to_ascii_lowercase();
    (low.contains(r"\.gemini\antigravity-cli\mcp\chrome-devtools")
        || low.contains(r"\.gemini\antigravity-cli\mcp\playwright"))
        && !low.contains("..")
}

fn match_personal_dir(target_norm: &str, policy: &GuardPolicy) -> Option<(String, String)> {
    for (key, label, dir) in &policy.personal_dirs {
        if is_under(target_norm, dir) {
            return Some((key.clone(), label.clone()));
        }
    }
    None
}

fn extract_path_arg(args: &Value) -> Option<String> {
    const KEYS: &[&str] = &[
        "Path",
        "path",
        "AbsolutePath",
        "TargetFile",
        "DirectoryPath",
        "SearchPath",
        "SearchDirectory",
        "FilePath",
        "file_path",
    ];
    for k in KEYS {
        if let Some(s) = args.get(*k).and_then(|v| v.as_str()) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn deny(reason: &str) -> Value {
    json!({ "decision": "deny", "reason": reason })
}

fn allow() -> Value {
    json!({ "decision": "allow" })
}

#[derive(Debug, Clone)]
pub enum GuardDecision {
    Allow,
    Deny(String),
    AskApproval {
        tool: String,
        action: String,
        root_key: String,
        root_label: String,
        path: String,
        dst_path: Option<String>,
    },
}

#[allow(dead_code)]
pub fn evaluate_hook(payload: &Value, scope: &str, policy: &GuardPolicy) -> Value {
    match evaluate_hook_decision(payload, scope, policy) {
        GuardDecision::Allow => allow(),
        GuardDecision::Deny(r) => deny(&r),
        GuardDecision::AskApproval {
            tool,
            action,
            root_key,
            root_label,
            path,
            dst_path,
        } => json!({
            "decision": "ask",
            "tool": tool,
            "action": action,
            "root_key": root_key,
            "root_label": root_label,
            "path": path,
            "dst_path": dst_path,
        }),
    }
}

pub fn evaluate_hook_decision(payload: &Value, scope: &str, policy: &GuardPolicy) -> GuardDecision {
    // Only enforce restrictions for AgyNote (`restricted`) and AgyStudy (`study`) sessions.
    if scope != "restricted" && scope != "study" {
        return GuardDecision::Allow;
    }
    let allow_personal = scope == "study";

    let tool_call = match payload.get("toolCall") {
        Some(tc) => tc,
        None => {
            return GuardDecision::Deny(
                "AgyNote/AgyStudy güvenlik kalkanı: geçersiz araç çağrısı.".to_string(),
            )
        }
    };
    let raw_name = tool_call
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let name = raw_name
        .strip_prefix("cortex_step_type_")
        .unwrap_or(&raw_name);
    let args = tool_call.get("args").cloned().unwrap_or_else(|| json!({}));
    let cwd = payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| policy.vault_dir.clone());

    // 1. Read-only web search (no download/upload capability) & built-in image generation
    if name == "search_web" || name == "generate_image" {
        return GuardDecision::Allow;
    }

    // 2. Image generation subagent ONLY (block self/research/other subagents)
    if name == "invoke_subagent" {
        let tname = args
            .get("TypeName")
            .or_else(|| args.get("type_name"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if tname == "image-generator" {
            return GuardDecision::Allow;
        }
        return GuardDecision::Deny(
            "AgyNote/AgyStudy kısıtlı modda: yalnızca image-generator alt ajanı kullanılabilir."
                .to_string(),
        );
    }

    // 3. Read / search tools -> auto-allowed inside VAULT_DIR or DRIVE_DIR;
    //    approval-gated for personal dirs in AgyStudy (`study` scope).
    if matches!(
        name,
        "read_file"
            | "view_file"
            | "view_file_outline"
            | "view_code_item"
            | "find_by_name"
            | "grep_search"
            | "list_dir"
    ) {
        let Some(pstr) = extract_path_arg(&args) else {
            return GuardDecision::Deny(
                "AgyNote/AgyStudy kısıtlı modda: dosya/klasör yolu belirtilmelidir.".to_string(),
            );
        };
        let norm = normalize_win(Path::new(&pstr), &cwd);
        if allow_personal && is_allowed_browser_mcp_schema(&norm) {
            return GuardDecision::Allow;
        }
        if touches_forbidden_dir(&norm, policy) {
            return GuardDecision::Deny(
                "AgyNote/AgyStudy güvenlik kalkanı: proje ve yapılandırma klasörlerine erişim kapalıdır. Proje işleri için AgyAI sekmesini kullanın.".to_string(),
            );
        }
        let in_vault = is_under(&norm, &policy.vault_dir);
        let in_drive = policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&norm, d))
            .unwrap_or(false);
        if in_vault || in_drive {
            return GuardDecision::Allow;
        }
        if allow_personal {
            if let Some((rk, rl)) = match_personal_dir(&norm, policy) {
                let disp = resolve_win_preserve_case(Path::new(&pstr), &cwd)
                    .to_string_lossy()
                    .to_string();
                return GuardDecision::AskApproval {
                    tool: name.to_string(),
                    action: "Okuma / Listeleme".to_string(),
                    root_key: rk,
                    root_label: rl,
                    path: disp,
                    dst_path: None,
                };
            }
        }
        return GuardDecision::Deny(
            "AgyNote/AgyStudy kısıtlı modda: yalnızca AgyDesk kasası ve Google Drive (AgyStudy'de onaylı kişisel klasörler) okunabilir. Proje/sistem dosyaları için AgyAI sekmesini kullanın.".to_string(),
        );
    }

    // 4. Write / edit tools -> auto-allowed inside VAULT_DIR or DRIVE_VAULT_DIR;
    //    approval-gated for personal dirs & personal Drive in AgyStudy (`study` scope).
    if matches!(
        name,
        "write_file"
            | "write_to_file"
            | "edit_file"
            | "replace_file_content"
            | "multi_replace_file_content"
    ) {
        let Some(pstr) = extract_path_arg(&args) else {
            return GuardDecision::Deny(
                "AgyNote/AgyStudy kısıtlı modda: hedef dosya yolu belirtilmelidir.".to_string(),
            );
        };
        let norm = normalize_win(Path::new(&pstr), &cwd);
        if touches_forbidden_dir(&norm, policy) {
            return GuardDecision::Deny(
                "AgyNote/AgyStudy güvenlik kalkanı: proje ve yapılandırma dosyaları değiştirilemez."
                    .to_string(),
            );
        }
        let in_vault = is_under(&norm, &policy.vault_dir);
        let in_drive_vault = policy
            .drive_vault_dir
            .as_ref()
            .map(|d| is_under(&norm, d))
            .unwrap_or(false);
        if in_vault || in_drive_vault {
            return GuardDecision::Allow;
        }
        if allow_personal {
            let disp = resolve_win_preserve_case(Path::new(&pstr), &cwd)
                .to_string_lossy()
                .to_string();
            if let Some((rk, rl)) = match_personal_dir(&norm, policy) {
                return GuardDecision::AskApproval {
                    tool: name.to_string(),
                    action: "Yazma / Düzenleme".to_string(),
                    root_key: rk,
                    root_label: rl,
                    path: disp,
                    dst_path: None,
                };
            }
            let in_drive = policy
                .drive_dir
                .as_ref()
                .map(|d| is_under(&norm, d))
                .unwrap_or(false);
            if in_drive {
                return GuardDecision::AskApproval {
                    tool: name.to_string(),
                    action: "Google Drive Yazma / Düzenleme".to_string(),
                    root_key: "drive".to_string(),
                    root_label: "Google Drive".to_string(),
                    path: disp,
                    dst_path: None,
                };
            }
        }
        return GuardDecision::Deny(
            "AgyNote/AgyStudy kısıtlı modda: yazma/düzenleme yalnızca AgyDesk_Belgeler kasası ve G:\\Drive'ım\\AgyDesk_Belgeler içinde (AgyStudy'de onaylı kişisel klasörlerde) yapılabilir.".to_string(),
        );
    }

    // 4b. Sandboxed agydesk-guard helpers (auto-allowed in Vault/Drive, approval-gated in personal dirs)
    //     + approval-gated general shell commands in AgyStudy (`study` scope) outside forbidden project/config dirs.
    if name == "run_command" {
        let cmdline = args
            .get("CommandLine")
            .or_else(|| args.get("command_line"))
            .or_else(|| args.get("command"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some((mode, src_p, dst_p, approval)) =
            parse_safe_guard_cmd(cmdline, &cwd, policy, allow_personal)
        {
            if let Some((rk, rl)) = approval {
                let action = match mode.as_str() {
                    "--list" => "Klasör Listeleme",
                    "--read-doc" | "--read" => "Belge Okuma",
                    "--copy" => "Kopyalama",
                    "--move" => "Taşıma",
                    "--sync" => "Klasör Senkronizasyonu",
                    "--md-to-pdf" | "--html-to-pdf" => "PDF Dönüşümü",
                    _ => "Dosya İşlemi",
                };
                return GuardDecision::AskApproval {
                    tool: format!("agydesk-guard {}", mode),
                    action: action.to_string(),
                    root_key: rk,
                    root_label: rl,
                    path: src_p.to_string_lossy().to_string(),
                    dst_path: dst_p.map(|p| p.to_string_lossy().to_string()),
                };
            }
            return GuardDecision::Allow;
        }
        if allow_personal {
            let trimmed = cmdline.trim();
            if trimmed.is_empty() || touches_forbidden_cmd(trimmed, &cwd, policy) {
                return GuardDecision::Deny(
                    "AgyStudy güvenlik kalkanı: proje klasörleri (ai-workstation, atolye.db, agydesk-guard) ve yapılandırma klasörlerine (.git, .agents, .gemini, .ssh) dokunan terminal komutları kapalıdır. Proje işleri için AgyAI sekmesini kullanın.".to_string(),
                );
            }
            return GuardDecision::AskApproval {
                tool: "run_command".to_string(),
                action: "Terminal Komutu Çalıştırma".to_string(),
                root_key: "shell".to_string(),
                root_label: "Terminal (Shell)".to_string(),
                path: trimmed.to_string(),
                dst_path: None,
            };
        }
        return GuardDecision::Deny(
            "AgyNote kısıtlı modda: genel terminal komutları kapalıdır. Yalnızca `C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe` ile `--read-doc`, `--list`, `--md-to-pdf`, `--html-to-pdf`, `--copy`, `--move`, `--sync` izinlidir. Genel terminal için AgyAI sekmesini kullanın.".to_string(),
        );
    }

    // 4c. Browser MCP tools (`chrome-devtools`, `playwright`) in AgyStudy (`study` scope) -> approval-gated
    if allow_personal && (name == "call_mcp_tool" || name.starts_with("mcp__chrome-devtools__") || name.starts_with("mcp__playwright__")) {
        let (server, tool_name, inner_args) = if name == "call_mcp_tool" {
            let srv = args
                .get("ServerName")
                .or_else(|| args.get("server_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            let tn = args
                .get("ToolName")
                .or_else(|| args.get("tool_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let ia = args.get("Arguments").or_else(|| args.get("arguments")).cloned().unwrap_or_else(|| json!({}));
            (srv, tn, ia)
        } else if let Some(tn) = name.strip_prefix("mcp__chrome-devtools__") {
            ("chrome-devtools".to_string(), tn.to_string(), args.clone())
        } else {
            let tn = name.strip_prefix("mcp__playwright__").unwrap_or(name);
            ("playwright".to_string(), tn.to_string(), args.clone())
        };
        if server == "chrome-devtools" || server == "playwright" {
            let args_str = inner_args.to_string();
            if touches_forbidden_cmd(&args_str, &cwd, policy) {
                return GuardDecision::Deny(
                    "AgyStudy güvenlik kalkanı: tarayıcı aracıyla proje veya yapılandırma dosyalarına erişilemez.".to_string(),
                );
            }
            let detail = inner_args
                .get("url")
                .or_else(|| inner_args.get("Url"))
                .or_else(|| inner_args.get("filePath"))
                .or_else(|| inner_args.get("text"))
                .and_then(|v| v.as_str())
                .map(|s| {
                    let t: String = s.chars().take(120).collect();
                    format!("{} → {}", tool_name, t)
                })
                .unwrap_or_else(|| format!("{} ({})", tool_name, server));
            return GuardDecision::AskApproval {
                tool: format!("{}:{}", server, tool_name),
                action: "Chrome Tarayıcı Erişimi".to_string(),
                root_key: "browser".to_string(),
                root_label: "Chrome Tarayıcı".to_string(),
                path: detail,
                dst_path: None,
            };
        }
    }

    // 5. Everything else (non-browser MCP/graphify, swarm, run_workflow, schedule, etc.) -> HARD DENY
    if allow_personal {
        return GuardDecision::Deny(
            "AgyStudy çalışma modunda bu araç kapalıdır. Python/PowerShell/MATLAB komutları (PPTX/DOCX/XLSX üretimi dahil) için `run_command`, açık Chrome penceresi için `chrome-devtools` MCP kullanıcı onayı ile kullanılabilir; proje/sistem işleri için AgyAI sekmesini kullanın.".to_string(),
        );
    }
    GuardDecision::Deny(
        "AgyNote kısıtlı modda: terminal komutu, proje değişikliği, MCP/tarayıcı ve dosya indirme/yükleme kapalıdır. Tam erişim için AgyAI sekmesini kullanın.".to_string(),
    )
}

fn split_simple_tokens(cmd: &str) -> Option<Vec<String>> {
    // Reject any shell chaining / redirection / subshell / env-expansion metacharacters
    const FORBIDDEN: &[char] = &[';', '|', '&', '>', '<', '`', '$', '(', ')', '\n', '\r', '%'];
    if cmd.chars().any(|c| FORBIDDEN.contains(&c)) {
        return None;
    }
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for ch in cmd.chars() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
            }
            Some(_) => cur.push(ch),
            None if ch == '"' || ch == '\'' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            None => cur.push(ch),
        }
    }
    if quote.is_some() {
        return None;
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    Some(tokens)
}

fn validate_pdf_paths(
    mode: &str,
    in_raw: &str,
    out_raw: &str,
    cwd: &Path,
    policy: &GuardPolicy,
    allow_personal: bool,
) -> Option<(PathBuf, PathBuf, Option<(String, String)>)> {
    let in_norm = normalize_win(Path::new(in_raw), cwd);
    let out_norm = normalize_win(Path::new(out_raw), cwd);
    if touches_forbidden_dir(&in_norm, policy) || touches_forbidden_dir(&out_norm, policy) {
        return None;
    }
    let in_low = in_norm.to_ascii_lowercase();
    let out_low = out_norm.to_ascii_lowercase();
    let valid_in_ext = match mode {
        "--md-to-pdf" => in_low.ends_with(".md"),
        "--html-to-pdf" => in_low.ends_with(".html") || in_low.ends_with(".htm"),
        _ => false,
    };
    if !valid_in_ext || !out_low.ends_with(".pdf") {
        return None;
    }
    let in_auto = is_under(&in_norm, &policy.vault_dir)
        || policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&in_norm, d))
            .unwrap_or(false);
    let out_auto = is_under(&out_norm, &policy.vault_dir)
        || policy
            .drive_vault_dir
            .as_ref()
            .map(|d| is_under(&out_norm, d))
            .unwrap_or(false);
    let mut approval: Option<(String, String)> = None;
    let in_ok = if in_auto {
        true
    } else if allow_personal {
        if let Some(p) = match_personal_dir(&in_norm, policy) {
            approval = Some(p);
            true
        } else {
            false
        }
    } else {
        false
    };
    let out_ok = if out_auto {
        true
    } else if allow_personal {
        if let Some(p) = match_personal_dir(&out_norm, policy) {
            approval = Some(p);
            true
        } else if policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&out_norm, d))
            .unwrap_or(false)
        {
            approval = Some(("drive".to_string(), "Google Drive".to_string()));
            true
        } else {
            false
        }
    } else {
        false
    };
    if in_ok && out_ok {
        Some((
            resolve_win_preserve_case(Path::new(in_raw), cwd),
            resolve_win_preserve_case(Path::new(out_raw), cwd),
            approval,
        ))
    } else {
        None
    }
}

/// Lexically resolve `.` and `..` while preserving original filename casing on Windows.
fn resolve_win_preserve_case(p: &Path, base: &Path) -> PathBuf {
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    };
    let mut parts: Vec<String> = Vec::new();
    let mut prefix_str = String::new();
    for comp in abs.components() {
        match comp {
            Component::Prefix(pr) => {
                let s = pr.as_os_str().to_string_lossy().to_string();
                prefix_str = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
            }
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(os) => {
                parts.push(os.to_string_lossy().to_string());
            }
        }
    }
    if prefix_str.is_empty() {
        PathBuf::from(format!(r"\{}", parts.join(r"\")))
    } else if parts.is_empty() {
        PathBuf::from(format!(r"{}\", prefix_str))
    } else {
        PathBuf::from(format!(r"{}\{}", prefix_str, parts.join(r"\")))
    }
}

fn validate_file_op_paths(
    mode: &str,
    src_raw: &str,
    dst_raw: &str,
    cwd: &Path,
    policy: &GuardPolicy,
    allow_personal: bool,
) -> Option<(PathBuf, PathBuf, Option<(String, String)>)> {
    let src_norm = normalize_win(Path::new(src_raw), cwd);
    let dst_norm = normalize_win(Path::new(dst_raw), cwd);
    if touches_forbidden_dir(&src_norm, policy) || touches_forbidden_dir(&dst_norm, policy) {
        return None;
    }
    // Reject copying/moving/syncing a directory into itself
    let src_trim = src_norm.trim_end_matches('\\');
    let dst_trim = dst_norm.trim_end_matches('\\');
    if dst_trim == src_trim || dst_trim.starts_with(&format!(r"{}\", src_trim)) {
        return None;
    }
    let src_in_vault = is_under(&src_norm, &policy.vault_dir);
    let src_in_drive = policy
        .drive_dir
        .as_ref()
        .map(|d| is_under(&src_norm, d))
        .unwrap_or(false);
    let src_in_drive_vault = policy
        .drive_vault_dir
        .as_ref()
        .map(|d| is_under(&src_norm, d))
        .unwrap_or(false);

    let mut approval: Option<(String, String)> = None;

    // `--move` modifies source (removes it), so auto-allow only if writable (VAULT_DIR or DRIVE_VAULT_DIR)
    let src_auto = match mode {
        "--copy" | "--sync" => src_in_vault || src_in_drive,
        "--move" => src_in_vault || src_in_drive_vault,
        _ => false,
    };
    let src_ok = if src_auto {
        true
    } else if allow_personal {
        if let Some(p) = match_personal_dir(&src_norm, policy) {
            approval = Some(p);
            true
        } else if mode == "--move" && src_in_drive {
            approval = Some(("drive".to_string(), "Google Drive".to_string()));
            true
        } else {
            false
        }
    } else {
        false
    };

    let dst_auto = is_under(&dst_norm, &policy.vault_dir)
        || policy
            .drive_vault_dir
            .as_ref()
            .map(|d| is_under(&dst_norm, d))
            .unwrap_or(false);
    let dst_ok = if dst_auto {
        true
    } else if allow_personal {
        if let Some(p) = match_personal_dir(&dst_norm, policy) {
            approval = Some(p);
            true
        } else if policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&dst_norm, d))
            .unwrap_or(false)
        {
            approval = Some(("drive".to_string(), "Google Drive".to_string()));
            true
        } else {
            false
        }
    } else {
        false
    };

    if src_ok && dst_ok {
        Some((
            resolve_win_preserve_case(Path::new(src_raw), cwd),
            resolve_win_preserve_case(Path::new(dst_raw), cwd),
            approval,
        ))
    } else {
        None
    }
}

fn validate_list_path(
    dir_raw: &str,
    cwd: &Path,
    policy: &GuardPolicy,
    allow_personal: bool,
) -> Option<(PathBuf, Option<(String, String)>)> {
    let norm = normalize_win(Path::new(dir_raw), cwd);
    if touches_forbidden_dir(&norm, policy) {
        return None;
    }
    let in_vault = is_under(&norm, &policy.vault_dir);
    let in_drive = policy
        .drive_dir
        .as_ref()
        .map(|d| is_under(&norm, d))
        .unwrap_or(false);
    if in_vault || in_drive {
        return Some((resolve_win_preserve_case(Path::new(dir_raw), cwd), None));
    }
    if allow_personal {
        if let Some(p) = match_personal_dir(&norm, policy) {
            return Some((resolve_win_preserve_case(Path::new(dir_raw), cwd), Some(p)));
        }
    }
    None
}

fn validate_read_doc_path(
    file_raw: &str,
    cwd: &Path,
    policy: &GuardPolicy,
    allow_personal: bool,
) -> Option<(PathBuf, Option<(String, String)>)> {
    let norm = normalize_win(Path::new(file_raw), cwd);
    if touches_forbidden_dir(&norm, policy) {
        return None;
    }
    const ALLOWED_EXTS: &[&str] = &[
        ".docx", ".doc", ".pptx", ".ppsx", ".xlsx", ".odt", ".ods", ".odp", ".slx", ".rtf", ".csv",
        ".txt", ".md",
    ];
    if !ALLOWED_EXTS.iter().any(|e| norm.ends_with(e)) {
        return None;
    }
    let in_vault = is_under(&norm, &policy.vault_dir);
    let in_drive = policy
        .drive_dir
        .as_ref()
        .map(|d| is_under(&norm, d))
        .unwrap_or(false);
    if in_vault || in_drive {
        return Some((resolve_win_preserve_case(Path::new(file_raw), cwd), None));
    }
    if allow_personal {
        if let Some(p) = match_personal_dir(&norm, policy) {
            return Some((resolve_win_preserve_case(Path::new(file_raw), cwd), Some(p)));
        }
    }
    None
}

fn parse_safe_guard_cmd(
    cmdline: &str,
    cwd: &Path,
    policy: &GuardPolicy,
    allow_personal: bool,
) -> Option<(String, PathBuf, Option<PathBuf>, Option<(String, String)>)> {
    let tokens = split_simple_tokens(cmdline.trim())?;
    if tokens.len() != 3 && tokens.len() != 4 {
        return None;
    }
    let exe_norm = tokens[0].replace('/', "\\").to_ascii_lowercase();
    let expected_exe = crate::config::ROOT
        .join("agydesk-guard.exe")
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if exe_norm != expected_exe && exe_norm != r"c:\users\cavit\ai-workstation\agydesk-guard.exe" {
        return None;
    }
    let mode = tokens[1].as_str();
    match (tokens.len(), mode) {
        (3, "--list") => {
            let (dir_p, appr) = validate_list_path(&tokens[2], cwd, policy, allow_personal)?;
            Some((mode.to_string(), dir_p, None, appr))
        }
        (3, "--read-doc" | "--read") => {
            let (file_p, appr) = validate_read_doc_path(&tokens[2], cwd, policy, allow_personal)?;
            Some((mode.to_string(), file_p, None, appr))
        }
        (4, "--md-to-pdf" | "--html-to-pdf") => {
            let (in_p, out_p, appr) =
                validate_pdf_paths(mode, &tokens[2], &tokens[3], cwd, policy, allow_personal)?;
            Some((mode.to_string(), in_p, Some(out_p), appr))
        }
        (4, "--copy" | "--move" | "--sync") => {
            let (src_p, dst_p, appr) =
                validate_file_op_paths(mode, &tokens[2], &tokens[3], cwd, policy, allow_personal)?;
            Some((mode.to_string(), src_p, Some(dst_p), appr))
        }
        _ => None,
    }
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn render_inline_md(raw: &str) -> String {
    let s = html_escape(raw);
    // Inline code `...`
    let mut out = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '`' {
            let mut code = String::new();
            let mut closed = false;
            while let Some(cc) = chars.next() {
                if cc == '`' {
                    closed = true;
                    break;
                }
                code.push(cc);
            }
            if closed {
                out.push_str("<code>");
                out.push_str(&code);
                out.push_str("</code>");
            } else {
                out.push('`');
                out.push_str(&code);
            }
        } else {
            out.push(c);
        }
    }
    // Bold **...**
    let mut bold_out = String::new();
    let parts: Vec<&str> = out.split("**").collect();
    for (i, p) in parts.iter().enumerate() {
        if i % 2 == 1 && i + 1 < parts.len() {
            bold_out.push_str("<strong>");
            bold_out.push_str(p);
            bold_out.push_str("</strong>");
        } else {
            bold_out.push_str(p);
        }
    }
    bold_out
}

fn markdown_to_a4_html(title: &str, md: &str) -> String {
    let mut body = String::new();
    let lines: Vec<&str> = md.lines().collect();
    let mut i = 0usize;
    let mut in_code = false;
    let mut in_ul = false;
    let mut in_ol = false;

    let close_lists = |body: &mut String, in_ul: &mut bool, in_ol: &mut bool| {
        if *in_ul {
            body.push_str("</ul>\n");
            *in_ul = false;
        }
        if *in_ol {
            body.push_str("</ol>\n");
            *in_ol = false;
        }
    };

    while i < lines.len() {
        let line = lines[i];
        let t = line.trim();

        if t.starts_with("```") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            if in_code {
                body.push_str("</code></pre>\n");
                in_code = false;
            } else {
                body.push_str("<pre><code>");
                in_code = true;
            }
            i += 1;
            continue;
        }
        if in_code {
            body.push_str(&html_escape(line));
            body.push('\n');
            i += 1;
            continue;
        }
        if t.is_empty() {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            i += 1;
            continue;
        }
        if t == "---" || t == "***" {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str("<hr/>\n");
            i += 1;
            continue;
        }
        // Markdown table
        if t.starts_with('|') && i + 1 < lines.len() && lines[i + 1].trim().contains("---") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            let headers: Vec<&str> = t.trim_matches('|').split('|').map(|s| s.trim()).collect();
            body.push_str("<table><thead><tr>");
            for h in headers {
                body.push_str("<th>");
                body.push_str(&render_inline_md(h));
                body.push_str("</th>");
            }
            body.push_str("</tr></thead><tbody>\n");
            i += 2;
            while i < lines.len() && lines[i].trim().starts_with('|') {
                let cols: Vec<&str> = lines[i]
                    .trim()
                    .trim_matches('|')
                    .split('|')
                    .map(|s| s.trim())
                    .collect();
                body.push_str("<tr>");
                for c in cols {
                    body.push_str("<td>");
                    body.push_str(&render_inline_md(c));
                    body.push_str("</td>");
                }
                body.push_str("</tr>\n");
                i += 1;
            }
            body.push_str("</tbody></table>\n");
            continue;
        }
        // Headings
        if let Some(h) = t.strip_prefix("#### ") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str(&format!("<h4>{}</h4>\n", render_inline_md(h)));
            i += 1;
            continue;
        }
        if let Some(h) = t.strip_prefix("### ") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str(&format!("<h3>{}</h3>\n", render_inline_md(h)));
            i += 1;
            continue;
        }
        if let Some(h) = t.strip_prefix("## ") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str(&format!("<h2>{}</h2>\n", render_inline_md(h)));
            i += 1;
            continue;
        }
        if let Some(h) = t.strip_prefix("# ") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str(&format!("<h1>{}</h1>\n", render_inline_md(h)));
            i += 1;
            continue;
        }
        if let Some(q) = t.strip_prefix("> ") {
            close_lists(&mut body, &mut in_ul, &mut in_ol);
            body.push_str(&format!("<blockquote>{}</blockquote>\n", render_inline_md(q)));
            i += 1;
            continue;
        }
        // Unordered list / checklist
        if let Some(item) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
            if in_ol {
                body.push_str("</ol>\n");
                in_ol = false;
            }
            if !in_ul {
                body.push_str("<ul>\n");
                in_ul = true;
            }
            let rendered = if let Some(rest) = item.strip_prefix("[x] ").or_else(|| item.strip_prefix("[X] ")) {
                format!("<span class=\"ok\">☑</span> {}", render_inline_md(rest))
            } else if let Some(rest) = item.strip_prefix("[ ] ") {
                format!("☐ {}", render_inline_md(rest))
            } else {
                render_inline_md(item)
            };
            body.push_str(&format!("<li>{}</li>\n", rendered));
            i += 1;
            continue;
        }
        // Ordered list (e.g. "1. ")
        if let Some(dot) = t.find(". ") {
            if dot > 0 && dot <= 3 && t[..dot].chars().all(|c| c.is_ascii_digit()) {
                if in_ul {
                    body.push_str("</ul>\n");
                    in_ul = false;
                }
                if !in_ol {
                    body.push_str("<ol>\n");
                    in_ol = true;
                }
                body.push_str(&format!("<li>{}</li>\n", render_inline_md(&t[dot + 2..])));
                i += 1;
                continue;
            }
        }

        close_lists(&mut body, &mut in_ul, &mut in_ol);
        body.push_str(&format!("<p>{}</p>\n", render_inline_md(t)));
        i += 1;
    }
    if in_code {
        body.push_str("</code></pre>\n");
    }
    close_lists(&mut body, &mut in_ul, &mut in_ol);

    format!(
        r#"<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"/>
<title>{}</title>
<style>
@page {{ size: A4; margin: 16mm 15mm; }}
body {{ font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1f2c; }}
h1 {{ font-size: 17pt; color: #0f2a4a; border-bottom: 2px solid #2563eb; padding-bottom: 4px; margin-top: 0; }}
h2 {{ font-size: 13.5pt; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; margin-top: 16px; page-break-after: avoid; }}
h3 {{ font-size: 11.5pt; color: #1e40af; margin-top: 12px; page-break-after: avoid; }}
h4 {{ font-size: 10.5pt; color: #334155; margin-top: 10px; page-break-after: avoid; }}
p {{ margin: 5px 0; }}
ul, ol {{ margin: 4px 0 8px 20px; padding: 0; }}
li {{ margin: 2px 0; }}
blockquote {{ margin: 8px 0; padding: 6px 12px; border-left: 3px solid #2563eb; background: #f1f5f9; color: #334155; }}
code {{ font-family: Consolas, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }}
pre {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px 10px; overflow-x: auto; page-break-inside: avoid; }}
pre code {{ background: none; padding: 0; }}
table {{ width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9.5pt; page-break-inside: avoid; }}
th, td {{ border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }}
th {{ background: #eff6ff; color: #1e3a8a; font-weight: 600; }}
hr {{ border: none; border-top: 1px solid #cbd5e1; margin: 12px 0; }}
.ok {{ color: #15803d; font-weight: 700; }}
</style>
</head>
<body>
{}
</body>
</html>"#,
        html_escape(title),
        body
    )
}

fn find_edge_browser() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Strictly sandboxed local PDF exporter: `agydesk-guard.exe --md-to-pdf <in.md> <out.pdf>`
/// or `agydesk-guard.exe --html-to-pdf <in.html> <out.pdf>`.
#[allow(dead_code)]
pub fn run_pdf_export(mode: &str, in_arg: &str, out_arg: &str) -> i32 {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let policy = GuardPolicy::from_config();
    let allow_personal = std::env::var("AGYDESK_SCOPE").ok().as_deref() == Some("study");
    let cwd = std::env::current_dir().unwrap_or_else(|_| policy.vault_dir.clone());
    let Some((in_path, out_path, _)) =
        validate_pdf_paths(mode, in_arg, out_arg, &cwd, &policy, allow_personal)
    else {
        eprintln!("HATA: Yalnızca AgyDesk kasası veya izinli klasörler içindeki .md/.html -> .pdf dönüşümüne izin verilir.");
        return 2;
    };
    let Ok(raw) = std::fs::read_to_string(&in_path) else {
        eprintln!("HATA: Girdi dosyası okunamadı: {}", in_path.display());
        return 3;
    };
    let Some(browser) = find_edge_browser() else {
        eprintln!("HATA: PDF motoru (Microsoft Edge / Chrome) bulunamadı.");
        return 4;
    };
    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let title = in_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("AgyDesk_Belge");
    let html_content = if mode == "--md-to-pdf" {
        markdown_to_a4_html(title, &raw)
    } else {
        // Inject strict CSP to block network/file exfiltration inside headless browser
        let csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:;\"/>";
        if let Some(idx) = raw.to_ascii_lowercase().find("<head>") {
            let mut s = String::with_capacity(raw.len() + csp.len());
            s.push_str(&raw[..idx + 6]);
            s.push_str(csp);
            s.push_str(&raw[idx + 6..]);
            s
        } else {
            format!("<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>{}</head><body>{}</body></html>", csp, raw)
        }
    };

    let tmp_html = std::env::temp_dir().join(format!("agydesk_pdf_{}.html", std::process::id()));
    if let Err(e) = std::fs::write(&tmp_html, html_content.as_bytes()) {
        eprintln!("HATA: Geçici HTML yazılamadı: {}", e);
        return 5;
    }

    let file_url = format!(
        "file:///{}",
        tmp_html.to_string_lossy().replace('\\', "/")
    );
    let pdf_flag = format!("--print-to-pdf={}", out_path.to_string_lossy());
    let status = std::process::Command::new(&browser)
        .args([
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-pdf-header-footer",
            &pdf_flag,
            &file_url,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let _ = std::fs::remove_file(&tmp_html);

    match status {
        Ok(out) if out.status.success() && out_path.exists() => {
            let sz = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
            if sz > 0 {
                println!("OK: PDF oluşturuldu ({} bayt): {}", sz, out_path.display());
                return 0;
            }
            eprintln!("HATA: PDF dosyası boş oluştu.");
            6
        }
        Ok(out) => {
            eprintln!(
                "HATA: PDF üretimi başarısız (kod {:?}): {}",
                out.status.code(),
                String::from_utf8_lossy(&out.stderr).trim()
            );
            7
        }
        Err(e) => {
            eprintln!("HATA: PDF motoru başlatılamadı: {}", e);
            8
        }
    }
}

fn is_agents_entry(name: &std::ffi::OsStr) -> bool {
    let s = name.to_string_lossy().to_ascii_lowercase();
    s == ".agents" || s == ".agent"
}

fn copy_dir_recursive(src: &Path, dst: &Path, skip_up_to_date: bool) -> io::Result<(usize, usize)> {
    std::fs::create_dir_all(dst)?;
    let mut copied = 0usize;
    let mut skipped = 0usize;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if is_agents_entry(&entry.file_name()) {
            continue;
        }
        let ft = entry.file_type()?;
        if ft.is_symlink() {
            continue;
        }
        let s_path = entry.path();
        let d_path = dst.join(entry.file_name());
        if ft.is_dir() {
            let (c, sk) = copy_dir_recursive(&s_path, &d_path, skip_up_to_date)?;
            copied += c;
            skipped += sk;
        } else if ft.is_file() {
            if skip_up_to_date && d_path.exists() {
                if let (Ok(sm), Ok(dm)) = (std::fs::metadata(&s_path), std::fs::metadata(&d_path)) {
                    let same_size = sm.len() == dm.len();
                    let not_newer = match (sm.modified(), dm.modified()) {
                        (Ok(st), Ok(dt)) => st <= dt,
                        _ => false,
                    };
                    if same_size && not_newer {
                        skipped += 1;
                        continue;
                    }
                }
            }
            if let Some(parent) = d_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(&s_path, &d_path)?;
            copied += 1;
        }
    }
    Ok((copied, skipped))
}

/// Strictly sandboxed binary/folder file operations between Vault and Drive:
/// `agydesk-guard.exe --copy "<src>" "<dst>"`
/// `agydesk-guard.exe --move "<src>" "<dst>"`
/// `agydesk-guard.exe --sync "<src_dir>" "<dst_dir>"`
#[allow(dead_code)]
pub fn run_file_op(mode: &str, src_arg: &str, dst_arg: &str) -> i32 {
    let policy = GuardPolicy::from_config();
    let allow_personal = std::env::var("AGYDESK_SCOPE").ok().as_deref() == Some("study");
    let cwd = std::env::current_dir().unwrap_or_else(|_| policy.vault_dir.clone());
    let Some((src_path, dst_path, _)) =
        validate_file_op_paths(mode, src_arg, dst_arg, &cwd, &policy, allow_personal)
    else {
        eprintln!(
            "HATA: {} yalnızca AgyDesk kasası ve izinli klasör sınırları içinde izinlidir.",
            mode
        );
        return 2;
    };
    if !src_path.exists() {
        eprintln!("HATA: Kaynak bulunamadı: {}", src_path.display());
        return 3;
    }

    match mode {
        "--copy" => {
            if src_path.is_dir() {
                match copy_dir_recursive(&src_path, &dst_path, false) {
                    Ok((c, _)) => {
                        println!(
                            "OK: Klasör kopyalandı ({} dosya): {} -> {}",
                            c,
                            src_path.display(),
                            dst_path.display()
                        );
                        0
                    }
                    Err(e) => {
                        eprintln!("HATA: Klasör kopyalanamadı: {}", e);
                        4
                    }
                }
            } else {
                let final_dst = if dst_path.is_dir() {
                    match src_path.file_name() {
                        Some(name) => dst_path.join(name),
                        None => dst_path.clone(),
                    }
                } else {
                    dst_path.clone()
                };
                if let Some(parent) = final_dst.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::copy(&src_path, &final_dst) {
                    Ok(bytes) => {
                        println!(
                            "OK: Kopyalandı ({} bayt): {} -> {}",
                            bytes,
                            src_path.display(),
                            final_dst.display()
                        );
                        0
                    }
                    Err(e) => {
                        eprintln!("HATA: Dosya kopyalanamadı: {}", e);
                        4
                    }
                }
            }
        }
        "--move" => {
            let final_dst = if src_path.is_file() && dst_path.is_dir() {
                match src_path.file_name() {
                    Some(name) => dst_path.join(name),
                    None => dst_path.clone(),
                }
            } else {
                dst_path.clone()
            };
            if let Some(parent) = final_dst.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if std::fs::rename(&src_path, &final_dst).is_ok() {
                println!(
                    "OK: Taşındı: {} -> {}",
                    src_path.display(),
                    final_dst.display()
                );
                return 0;
            }
            // Cross-volume fallback (e.g. C:\ <-> G:\)
            if src_path.is_dir() {
                match copy_dir_recursive(&src_path, &final_dst, false) {
                    Ok((c, _)) => match std::fs::remove_dir_all(&src_path) {
                        Ok(()) => {
                            println!(
                                "OK: Klasör taşındı ({} dosya): {} -> {}",
                                c,
                                src_path.display(),
                                final_dst.display()
                            );
                            0
                        }
                        Err(e) => {
                            eprintln!("HATA: Kopyalandı ama kaynak klasör silinemedi: {}", e);
                            5
                        }
                    },
                    Err(e) => {
                        eprintln!("HATA: Klasör taşınamadı: {}", e);
                        5
                    }
                }
            } else {
                match std::fs::copy(&src_path, &final_dst) {
                    Ok(bytes) => match std::fs::remove_file(&src_path) {
                        Ok(()) => {
                            println!(
                                "OK: Taşındı ({} bayt): {} -> {}",
                                bytes,
                                src_path.display(),
                                final_dst.display()
                            );
                            0
                        }
                        Err(e) => {
                            eprintln!("HATA: Kopyalandı ama kaynak dosya silinemedi: {}", e);
                            5
                        }
                    },
                    Err(e) => {
                        eprintln!("HATA: Dosya taşınamadı: {}", e);
                        5
                    }
                }
            }
        }
        "--sync" => {
            if !src_path.is_dir() {
                eprintln!("HATA: --sync için kaynak bir klasör olmalıdır: {}", src_path.display());
                return 3;
            }
            match copy_dir_recursive(&src_path, &dst_path, true) {
                Ok((c, sk)) => {
                    println!(
                        "OK: Senkronize edildi (kopyalanan: {}, güncel/atlanan: {}): {} -> {}",
                        c,
                        sk,
                        src_path.display(),
                        dst_path.display()
                    );
                    0
                }
                Err(e) => {
                    eprintln!("HATA: Senkronizasyon başarısız: {}", e);
                    6
                }
            }
        }
        _ => {
            eprintln!("HATA: Bilinmeyen mod: {}", mode);
            2
        }
    }
}

fn fmt_tr_datetime(unix_secs: u64) -> String {
    // Turkey permanent UTC+3
    let local = unix_secs.saturating_add(3 * 3600);
    let days = (local / 86400) as i64;
    let rem = local % 86400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    // Howard Hinnant civil_from_days
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02} {:02}:{:02}", year, m, d, hour, min)
}

fn fmt_human_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:>6.1} GB", b / GB)
    } else if b >= MB {
        format!("{:>6.1} MB", b / MB)
    } else if b >= KB {
        format!("{:>6.1} KB", b / KB)
    } else {
        format!("{:>6} B ", bytes)
    }
}

fn list_dir_entries(dir_path: &Path, policy: &GuardPolicy) -> io::Result<Vec<(u64, bool, u64, String)>> {
    const SENSITIVE: &[&str] = &[".agents", ".agent", ".gemini", ".git", ".ssh"];
    let mut items = Vec::new();
    for entry in std::fs::read_dir(dir_path)? {
        let Ok(entry) = entry else { continue };
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let low = name.to_ascii_lowercase();
        if SENSITIVE.contains(&low.as_str()) {
            continue;
        }
        let entry_path = entry.path();
        let entry_norm = normalize_win(&entry_path, dir_path);
        if touches_forbidden_dir(&entry_norm, policy) {
            continue;
        }
        let meta = entry.metadata().ok();
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let is_dir = ft.is_dir();
        let size = if is_dir {
            0
        } else {
            meta.as_ref().map(|m| m.len()).unwrap_or(0)
        };
        items.push((mtime, is_dir, size, name));
    }
    items.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.3.to_lowercase().cmp(&b.3.to_lowercase())));
    Ok(items)
}

/// Strictly sandboxed directory listing sorted newest-first (`agydesk-guard.exe --list <dir>`).
#[allow(dead_code)]
pub fn run_list_dir(dir_arg: &str) -> i32 {
    let policy = GuardPolicy::from_config();
    let cwd = std::env::current_dir().unwrap_or_else(|_| policy.vault_dir.clone());
    let allow_personal = std::env::var("AGYDESK_SCOPE").ok().as_deref() == Some("study");
    let Some((dir_path, _)) = validate_list_path(dir_arg, &cwd, &policy, allow_personal) else {
        eprintln!("HATA: Bu klasörü listeleme yetkisi yok: {}", dir_arg);
        return 2;
    };
    if !dir_path.is_dir() {
        eprintln!("HATA: Klasör bulunamadı: {}", dir_path.display());
        return 3;
    }
    let items = match list_dir_entries(&dir_path, &policy) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("HATA: Klasör okunamadı: {}", e);
            return 4;
        }
    };
    const MAX_SHOW: usize = 100;
    println!(
        "KLASÖR: {} (toplam {} öğe, en yeniden eskiye)",
        dir_path.display(),
        items.len()
    );
    for (mtime, is_dir, size, name) in items.iter().take(MAX_SHOW) {
        let kind = if *is_dir { "[KLASÖR]" } else { "[DOSYA] " };
        let dt = fmt_tr_datetime(*mtime);
        let sz = if *is_dir {
            "        -".to_string()
        } else {
            fmt_human_size(*size)
        };
        println!("{} {}  {}  {}", kind, dt, sz, name);
    }
    if items.len() > MAX_SHOW {
        println!("... ve {} öğe daha", items.len() - MAX_SHOW);
    }
    0
}

fn parse_word_xml_to_md(xml: &str) -> String {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.trim_text(false);

    let mut out: Vec<String> = Vec::new();
    let mut in_p = false;
    let mut in_t = false;
    let mut tbl_depth: usize = 0;
    let mut in_tc = false;
    let mut p_heading: u8 = 0;
    let mut cur_p = String::new();
    let mut cur_cell_lines: Vec<String> = Vec::new();
    let mut cur_row: Vec<String> = Vec::new();
    let mut cur_table: Vec<Vec<String>> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"tbl" => {
                    tbl_depth += 1;
                    if tbl_depth == 1 {
                        cur_table.clear();
                    }
                }
                b"tr" if tbl_depth == 1 => {
                    cur_row.clear();
                }
                b"tc" if tbl_depth == 1 => {
                    in_tc = true;
                    cur_cell_lines.clear();
                }
                b"p" => {
                    in_p = true;
                    p_heading = 0;
                    cur_p.clear();
                }
                b"t" if in_p => {
                    in_t = true;
                }
                b"pStyle" if in_p => {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"val" {
                            if let Ok(v) = attr.unescape_value() {
                                let vl = v.to_ascii_lowercase();
                                if vl.contains("heading1") || vl == "title" || vl.contains("baslik1") {
                                    p_heading = 1;
                                } else if vl.contains("heading2") || vl.contains("subtitle") || vl.contains("baslik2") {
                                    p_heading = 2;
                                } else if vl.contains("heading") || vl.contains("baslik") {
                                    p_heading = 3;
                                }
                            }
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"br" | b"cr" if in_p => cur_p.push('\n'),
                b"tab" if in_p => cur_p.push('\t'),
                b"pStyle" if in_p => {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"val" {
                            if let Ok(v) = attr.unescape_value() {
                                let vl = v.to_ascii_lowercase();
                                if vl.contains("heading1") || vl == "title" || vl.contains("baslik1") {
                                    p_heading = 1;
                                } else if vl.contains("heading2") || vl.contains("subtitle") || vl.contains("baslik2") {
                                    p_heading = 2;
                                } else if vl.contains("heading") || vl.contains("baslik") {
                                    p_heading = 3;
                                }
                            }
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Text(e)) if in_t => {
                if let Ok(txt) = e.unescape() {
                    cur_p.push_str(&txt);
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => {
                    in_t = false;
                }
                b"p" => {
                    in_p = false;
                    in_t = false;
                    let trimmed = cur_p.trim().to_string();
                    cur_p.clear();
                    if in_tc && tbl_depth == 1 {
                        if !trimmed.is_empty() {
                            cur_cell_lines.push(trimmed.replace('\n', " "));
                        }
                    } else if !trimmed.is_empty() {
                        let line = match p_heading {
                            1 => format!("# {}", trimmed),
                            2 => format!("## {}", trimmed),
                            3 => format!("### {}", trimmed),
                            _ => trimmed,
                        };
                        out.push(line);
                    }
                }
                b"tc" if tbl_depth == 1 => {
                    in_tc = false;
                    cur_row.push(cur_cell_lines.join(" ").replace('|', "\\|"));
                    cur_cell_lines.clear();
                }
                b"tr" if tbl_depth == 1 => {
                    if !cur_row.is_empty() {
                        cur_table.push(std::mem::take(&mut cur_row));
                    }
                }
                b"tbl" => {
                    if tbl_depth == 1 && !cur_table.is_empty() {
                        let cols = cur_table.iter().map(|r| r.len()).max().unwrap_or(0);
                        if cols > 0 {
                            let mut md_tbl = Vec::new();
                            for (ri, row) in cur_table.iter().enumerate() {
                                let mut padded = row.clone();
                                padded.resize(cols, String::new());
                                md_tbl.push(format!("| {} |", padded.join(" | ")));
                                if ri == 0 {
                                    let sep: Vec<&str> = vec!["---"; cols];
                                    md_tbl.push(format!("| {} |", sep.join(" | ")));
                                }
                            }
                            out.push(md_tbl.join("\n"));
                        }
                        cur_table.clear();
                    }
                    tbl_depth = tbl_depth.saturating_sub(1);
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out.join("\n\n")
}

fn trailing_num(name: &str) -> u32 {
    let stem = name.rsplit('/').next().unwrap_or(name);
    let stem = stem.strip_suffix(".xml").unwrap_or(stem);
    let digits: String = stem.chars().rev().take_while(|c| c.is_ascii_digit()).collect();
    digits.chars().rev().collect::<String>().parse().unwrap_or(0)
}

fn extract_docx_text(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Geçersiz DOCX arşivi: {}", e))?;

    let mut headers: Vec<String> = Vec::new();
    let mut footers: Vec<String> = Vec::new();
    let mut has_footnotes = false;
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let n = f.name().to_string();
            if n.starts_with("word/header") && n.ends_with(".xml") {
                headers.push(n);
            } else if n.starts_with("word/footer") && n.ends_with(".xml") {
                footers.push(n);
            } else if n == "word/footnotes.xml" {
                has_footnotes = true;
            }
        }
    }
    headers.sort_by_key(|n| trailing_num(n));
    footers.sort_by_key(|n| trailing_num(n));

    let mut sections: Vec<String> = Vec::new();
    for h in headers {
        if let Ok(mut entry) = archive.by_name(&h) {
            let mut xml = String::new();
            let _ = entry.read_to_string(&mut xml);
            let txt = parse_word_xml_to_md(&xml);
            if !txt.trim().is_empty() {
                sections.push(format!("[Üst Bilgi]\n{}", txt.trim()));
            }
        }
    }
    if let Ok(mut entry) = archive.by_name("word/document.xml") {
        let mut xml = String::new();
        let _ = entry.read_to_string(&mut xml);
        let txt = parse_word_xml_to_md(&xml);
        if !txt.trim().is_empty() {
            sections.push(txt.trim().to_string());
        }
    }
    if has_footnotes {
        if let Ok(mut entry) = archive.by_name("word/footnotes.xml") {
            let mut xml = String::new();
            let _ = entry.read_to_string(&mut xml);
            let txt = parse_word_xml_to_md(&xml);
            if !txt.trim().is_empty() {
                sections.push(format!("[Dipnotlar]\n{}", txt.trim()));
            }
        }
    }
    for ft in footers {
        if let Ok(mut entry) = archive.by_name(&ft) {
            let mut xml = String::new();
            let _ = entry.read_to_string(&mut xml);
            let txt = parse_word_xml_to_md(&xml);
            if !txt.trim().is_empty() {
                sections.push(format!("[Alt Bilgi]\n{}", txt.trim()));
            }
        }
    }
    Ok(sections.join("\n\n---\n\n"))
}

fn parse_drawingml_text(xml: &str) -> Vec<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.trim_text(false);
    let mut lines = Vec::new();
    let mut in_p = false;
    let mut in_t = false;
    let mut cur = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"p" => {
                    in_p = true;
                    cur.clear();
                }
                b"t" if in_p => in_t = true,
                _ => {}
            },
            Ok(Event::Empty(e)) if in_p && e.local_name().as_ref() == b"br" => cur.push('\n'),
            Ok(Event::Text(e)) if in_t => {
                if let Ok(t) = e.unescape() {
                    cur.push_str(&t);
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"p" => {
                    in_p = false;
                    in_t = false;
                    let s = cur.trim().to_string();
                    if !s.is_empty() {
                        lines.push(s);
                    }
                    cur.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    lines
}

fn extract_pptx_text(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Geçersiz PPTX arşivi: {}", e))?;

    let mut slides: Vec<(u32, String)> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let n = f.name().to_string();
            if n.starts_with("ppt/slides/slide") && n.ends_with(".xml") {
                let num = trailing_num(&n);
                if num > 0 {
                    slides.push((num, n));
                }
            }
        }
    }
    slides.sort_by_key(|(n, _)| *n);

    let mut out = Vec::new();
    for (num, sname) in slides {
        let mut xml = String::new();
        if let Ok(mut entry) = archive.by_name(&sname) {
            let _ = entry.read_to_string(&mut xml);
        }
        let lines = parse_drawingml_text(&xml);
        let mut block = format!("## Slayt {}\n{}", num, lines.join("\n"));
        let notes_name = format!("ppt/notesSlides/notesSlide{}.xml", num);
        if let Ok(mut n_entry) = archive.by_name(&notes_name) {
            let mut nxml = String::new();
            let _ = n_entry.read_to_string(&mut nxml);
            let nlines = parse_drawingml_text(&nxml);
            if !nlines.is_empty() {
                block.push_str(&format!("\n[Notlar]: {}", nlines.join(" ")));
            }
        }
        out.push(block);
    }
    Ok(out.join("\n\n"))
}

fn xlsx_col_idx(cell_ref: &str) -> Option<usize> {
    let mut col: usize = 0;
    let mut any = false;
    for b in cell_ref.bytes() {
        if b.is_ascii_alphabetic() {
            any = true;
            col = col * 26 + ((b.to_ascii_uppercase() - b'A') as usize + 1);
        } else {
            break;
        }
    }
    if any { Some(col - 1) } else { None }
}

fn extract_xlsx_text(path: &Path) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Geçersiz XLSX arşivi: {}", e))?;

    let mut shared: Vec<String> = Vec::new();
    if let Ok(mut entry) = archive.by_name("xl/sharedStrings.xml") {
        let mut xml = String::new();
        let _ = entry.read_to_string(&mut xml);
        let mut reader = Reader::from_str(&xml);
        reader.trim_text(false);
        let mut in_si = false;
        let mut in_t = false;
        let mut cur = String::new();
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) => match e.local_name().as_ref() {
                    b"si" => {
                        in_si = true;
                        cur.clear();
                    }
                    b"t" if in_si => in_t = true,
                    _ => {}
                },
                Ok(Event::Text(e)) if in_t => {
                    if let Ok(t) = e.unescape() {
                        cur.push_str(&t);
                    }
                }
                Ok(Event::End(e)) => match e.local_name().as_ref() {
                    b"t" => in_t = false,
                    b"si" => {
                        in_si = false;
                        in_t = false;
                        shared.push(std::mem::take(&mut cur));
                    }
                    _ => {}
                },
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }

    let mut sheet_names: Vec<String> = Vec::new();
    if let Ok(mut entry) = archive.by_name("xl/workbook.xml") {
        let mut xml = String::new();
        let _ = entry.read_to_string(&mut xml);
        let mut reader = Reader::from_str(&xml);
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) | Ok(Event::Empty(e))
                    if e.local_name().as_ref() == b"sheet" =>
                {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"name" {
                            if let Ok(v) = attr.unescape_value() {
                                sheet_names.push(v.to_string());
                            }
                        }
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }

    let mut sheets: Vec<(u32, String)> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let n = f.name().to_string();
            if n.starts_with("xl/worksheets/sheet") && n.ends_with(".xml") {
                sheets.push((trailing_num(&n), n));
            }
        }
    }
    sheets.sort_by_key(|(n, _)| *n);

    let mut out = Vec::new();
    for (idx, (num, sname)) in sheets.iter().enumerate() {
        let mut xml = String::new();
        if let Ok(mut entry) = archive.by_name(sname) {
            let _ = entry.read_to_string(&mut xml);
        }
        let mut reader = Reader::from_str(&xml);
        reader.trim_text(false);
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut cur_row: Vec<String> = Vec::new();
        let mut cell_type = String::new();
        let mut cell_col: Option<usize> = None;
        let mut in_v = false;
        let mut in_is_t = false;
        let mut val_buf = String::new();

        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) => match e.local_name().as_ref() {
                    b"row" => cur_row.clear(),
                    b"c" => {
                        cell_type.clear();
                        cell_col = None;
                        val_buf.clear();
                        for attr in e.attributes().flatten() {
                            match attr.key.local_name().as_ref() {
                                b"t" => {
                                    if let Ok(v) = attr.unescape_value() {
                                        cell_type = v.to_string();
                                    }
                                }
                                b"r" => {
                                    if let Ok(v) = attr.unescape_value() {
                                        cell_col = xlsx_col_idx(&v);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    b"v" => in_v = true,
                    b"t" if cell_type == "inlineStr" => in_is_t = true,
                    _ => {}
                },
                Ok(Event::Text(e)) if in_v || in_is_t => {
                    if let Ok(t) = e.unescape() {
                        val_buf.push_str(&t);
                    }
                }
                Ok(Event::End(e)) => match e.local_name().as_ref() {
                    b"v" => in_v = false,
                    b"t" => in_is_t = false,
                    b"c" => {
                        let resolved = if cell_type == "s" {
                            val_buf
                                .trim()
                                .parse::<usize>()
                                .ok()
                                .and_then(|i| shared.get(i).cloned())
                                .unwrap_or_default()
                        } else {
                            val_buf.trim().to_string()
                        };
                        let col = cell_col.unwrap_or(cur_row.len());
                        if col >= cur_row.len() {
                            cur_row.resize(col + 1, String::new());
                        }
                        cur_row[col] = resolved.replace('\n', " ").replace('|', "\\|");
                    }
                    b"row" => {
                        if cur_row.iter().any(|c| !c.is_empty()) {
                            rows.push(std::mem::take(&mut cur_row));
                        }
                    }
                    _ => {}
                },
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
        let title = sheet_names
            .get(idx)
            .cloned()
            .unwrap_or_else(|| format!("Sayfa {}", num));
        let mut block = format!("## Sayfa: {}\n", title);
        let max_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0).min(30);
        if max_cols > 0 {
            for (ri, r) in rows.iter().take(250).enumerate() {
                let mut padded = r.iter().take(max_cols).cloned().collect::<Vec<_>>();
                padded.resize(max_cols, String::new());
                block.push_str(&format!("| {} |\n", padded.join(" | ")));
                if ri == 0 {
                    block.push_str(&format!("| {} |\n", vec!["---"; max_cols].join(" | ")));
                }
            }
            if rows.len() > 250 {
                block.push_str(&format!("... ({} satır daha)\n", rows.len() - 250));
            }
        }
        out.push(block);
    }
    Ok(out.join("\n"))
}

fn extract_odf_text(path: &Path) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Geçersiz ODF arşivi: {}", e))?;
    let mut xml = String::new();
    if let Ok(mut entry) = archive.by_name("content.xml") {
        let _ = entry.read_to_string(&mut xml);
    }
    let mut reader = Reader::from_str(&xml);
    reader.trim_text(false);
    let mut lines = Vec::new();
    let mut cur = String::new();
    let mut depth = 0usize;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"p" | b"h" => {
                    depth += 1;
                    if depth == 1 {
                        cur.clear();
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(e)) if depth > 0 => match e.local_name().as_ref() {
                b"s" => cur.push(' '),
                b"tab" => cur.push('\t'),
                b"line-break" => cur.push('\n'),
                _ => {}
            },
            Ok(Event::Text(e)) if depth > 0 => {
                if let Ok(t) = e.unescape() {
                    cur.push_str(&t);
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"p" | b"h" => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        let s = cur.trim().to_string();
                        if !s.is_empty() {
                            lines.push(s);
                        }
                        cur.clear();
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    Ok(lines.join("\n\n"))
}

fn extract_slx_text(path: &Path) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Geçersiz SLX arşivi: {}", e))?;
    let mut xml_files: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let n = f.name().to_string();
            if n == "simulink/blockdiagram.xml"
                || (n.starts_with("simulink/systems/") && n.ends_with(".xml"))
            {
                xml_files.push(n);
            }
        }
    }
    xml_files.sort();

    let mut out = Vec::new();
    for xf in xml_files {
        let mut xml = String::new();
        if let Ok(mut entry) = archive.by_name(&xf) {
            let _ = entry.read_to_string(&mut xml);
        }
        let mut reader = Reader::from_str(&xml);
        let mut cur_block: Option<String> = None;
        let mut cur_param: Option<String> = None;
        let mut param_val = String::new();
        let mut block_params: Vec<String> = Vec::new();
        let mut solver_params: Vec<String> = Vec::new();
        let mut blocks: Vec<String> = Vec::new();

        const SOLVER_KEYS: &[&str] = &["StopTime", "StartTime", "Solver", "SolverName", "MaxStep", "FixedStep"];
        const BLOCK_KEYS: &[&str] = &[
            "Time", "Before", "After", "Gain", "Numerator", "Denominator", "P", "I", "D", "N",
            "Controller", "Form", "Inputs", "Signs", "Value", "Amplitude", "Frequency",
        ];

        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) => match e.local_name().as_ref() {
                    b"Block" => {
                        let mut btype = String::new();
                        let mut bname = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.local_name().as_ref() {
                                b"BlockType" => btype = attr.unescape_value().map(|v| v.to_string()).unwrap_or_default(),
                                b"Name" => bname = attr.unescape_value().map(|v| v.to_string()).unwrap_or_default(),
                                _ => {}
                            }
                        }
                        cur_block = Some(format!("{} [{}]", bname, btype));
                        block_params.clear();
                    }
                    b"P" => {
                        cur_param = None;
                        param_val.clear();
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"Name" {
                                cur_param = attr.unescape_value().ok().map(|v| v.to_string());
                            }
                        }
                    }
                    _ => {}
                },
                Ok(Event::Text(e)) if cur_param.is_some() => {
                    if let Ok(t) = e.unescape() {
                        param_val.push_str(&t);
                    }
                }
                Ok(Event::End(e)) => match e.local_name().as_ref() {
                    b"P" => {
                        if let Some(pk) = cur_param.take() {
                            let pv = param_val.trim().to_string();
                            if !pv.is_empty() {
                                if cur_block.is_some() && BLOCK_KEYS.contains(&pk.as_str()) {
                                    block_params.push(format!("{}={}", pk, pv));
                                } else if cur_block.is_none() && SOLVER_KEYS.contains(&pk.as_str()) {
                                    solver_params.push(format!("{}={}", pk, pv));
                                }
                            }
                        }
                        param_val.clear();
                    }
                    b"Block" => {
                        if let Some(blk) = cur_block.take() {
                            if block_params.is_empty() {
                                blocks.push(format!("- {}", blk));
                            } else {
                                blocks.push(format!("- {} ({})", blk, block_params.join(", ")));
                            }
                            block_params.clear();
                        }
                    }
                    _ => {}
                },
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
        if !solver_params.is_empty() || !blocks.is_empty() {
            let mut sec = format!("## {}", xf);
            if !solver_params.is_empty() {
                sec.push_str(&format!("\nSolver: {}", solver_params.join(", ")));
            }
            if !blocks.is_empty() {
                sec.push('\n');
                sec.push_str(&blocks.join("\n"));
            }
            out.push(sec);
        }
    }
    Ok(out.join("\n\n"))
}

fn extract_legacy_doc_text(path: &Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let in_esc = path.to_string_lossy().replace('\'', "''");
    let ps = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
         $ErrorActionPreference='Stop'; \
         $wd=[Activator]::CreateInstance([Type]::GetTypeFromProgID('Word.Application')); \
         try {{ \
           $wd.Visible = $false; \
           $doc = $wd.Documents.Open('{}', $false, $true); \
           try {{ \
             Write-Output $doc.Content.Text; \
           }} finally {{ \
             try {{ $doc.Close($false) }} catch {{}} \
           }} \
         }} finally {{ \
           try {{ $wd.Quit($false) }} catch {{}} \
         }}",
        in_esc
    );
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Word COM başlatılamadı: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "Eski .doc dosyası Word ile açılamadı: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).replace('\r', "\n"))
}

/// Strictly sandboxed Office/Simulink document text reader (`agydesk-guard.exe --read-doc "<file>"`).
#[allow(dead_code)]
pub fn run_read_doc(file_arg: &str) -> i32 {
    let policy = GuardPolicy::from_config();
    let cwd = std::env::current_dir().unwrap_or_else(|_| policy.vault_dir.clone());
    let allow_personal = std::env::var("AGYDESK_SCOPE").ok().as_deref() == Some("study");
    let Some((file_path, _)) = validate_read_doc_path(file_arg, &cwd, &policy, allow_personal)
    else {
        eprintln!("HATA: Bu belgeyi okuma yetkisi yok veya uzantı desteklenmiyor: {}", file_arg);
        return 2;
    };
    if !file_path.is_file() {
        eprintln!("HATA: Dosya bulunamadı: {}", file_path.display());
        return 3;
    }
    let ext = file_path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{}", s.to_ascii_lowercase()))
        .unwrap_or_default();

    let res = match ext.as_str() {
        ".docx" => extract_docx_text(&file_path),
        ".pptx" | ".ppsx" => extract_pptx_text(&file_path),
        ".xlsx" => extract_xlsx_text(&file_path),
        ".odt" | ".ods" | ".odp" => extract_odf_text(&file_path),
        ".slx" => extract_slx_text(&file_path),
        ".doc" => extract_legacy_doc_text(&file_path),
        _ => std::fs::read(&file_path)
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .map_err(|e| e.to_string()),
    };

    match res {
        Ok(text) => {
            const MAX_CHARS: usize = 60_000;
            let trimmed = text.trim();
            println!("BELGE: {}", file_path.display());
            if trimmed.is_empty() {
                println!("(Belgeden metin çıkarılamadı — taranmış görsel içeriyor olabilir.)");
            } else if trimmed.chars().count() > MAX_CHARS {
                let head: String = trimmed.chars().take(MAX_CHARS).collect();
                println!("{}", head);
                println!("\n... [kısaltıldı: toplam {} karakter]", trimmed.chars().count());
            } else {
                println!("{}", trimmed);
            }
            0
        }
        Err(e) => {
            eprintln!("HATA: Belge okunamadı: {}", e);
            4
        }
    }
}

fn request_ui_approval(
    session: &str,
    tool: &str,
    action: &str,
    root_key: &str,
    root_label: &str,
    path: &str,
    dst_path: Option<&str>,
) -> Value {
    let api_url = std::env::var("AGYDESK_API_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8780".to_string());
    let host_port = api_url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("127.0.0.1:8780");

    let body = json!({
        "session": session,
        "tool": tool,
        "action": action,
        "root_key": root_key,
        "root_label": root_label,
        "path": path,
        "dst_path": dst_path,
    })
    .to_string();

    let Ok(mut stream) = TcpStream::connect(host_port) else {
        return deny("AgyDesk onay servisine bağlanılamadı.");
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(125)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));

    let req = format!(
        "POST /api/guard/approve HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        host_port,
        body.len(),
        body
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return deny("AgyDesk onay isteği gönderilemedi.");
    }

    let mut resp = String::new();
    if stream.read_to_string(&mut resp).is_err() {
        return deny("AgyDesk onay yanıtı alınamadı (zaman aşımı).");
    }
    let Some((_, body_str)) = resp.split_once("\r\n\r\n") else {
        return deny("AgyDesk onay yanıtı geçersiz.");
    };
    let trimmed = body_str.trim();
    // Handle possible HTTP chunked framing or direct JSON body
    let json_slice = if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        &trimmed[start..=end]
    } else {
        trimmed
    };
    serde_json::from_str::<Value>(json_slice)
        .unwrap_or_else(|_| deny("AgyDesk onay yanıtı ayrıştırılamadı."))
}

/// Entrypoint for `agydesk-guard.exe` invoked by `PreToolUse` hook.
pub fn run_cli_guard() -> i32 {
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let payload: Value = serde_json::from_str(&input).unwrap_or_else(|_| json!({}));
    let scope = std::env::var("AGYDESK_SCOPE").unwrap_or_default();
    let session = std::env::var("AGYDESK_SESSION").unwrap_or_default();
    let policy = GuardPolicy::from_config();
    let decision = match evaluate_hook_decision(&payload, &scope, &policy) {
        GuardDecision::Allow => allow(),
        GuardDecision::Deny(r) => deny(&r),
        GuardDecision::AskApproval {
            tool,
            action,
            root_key,
            root_label,
            path,
            dst_path,
        } => request_ui_approval(
            &session,
            &tool,
            &action,
            &root_key,
            &root_label,
            &path,
            dst_path.as_deref(),
        ),
    };
    println!("{}", decision);
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_policy() -> GuardPolicy {
        GuardPolicy {
            vault_dir: PathBuf::from(r"C:\Users\cavit\Desktop\AgyDesk_Belgeler"),
            drive_dir: Some(PathBuf::from(r"G:\Drive'ım")),
            drive_vault_dir: Some(PathBuf::from(r"G:\Drive'ım\AgyDesk_Belgeler")),
            personal_dirs: vec![
                ("downloads".to_string(), "İndirilenler".to_string(), PathBuf::from(r"C:\Users\cavit\Downloads")),
                ("desktop".to_string(), "Masaüstü".to_string(), PathBuf::from(r"C:\Users\cavit\Desktop")),
                ("documents".to_string(), "Belgeler".to_string(), PathBuf::from(r"C:\Users\cavit\Documents")),
                ("pictures".to_string(), "Resimler".to_string(), PathBuf::from(r"C:\Users\cavit\Pictures")),
            ],
            project_dir: PathBuf::from(r"C:\Users\cavit\ai-workstation"),
        }
    }

    fn hook_call(name: &str, args: Value) -> Value {
        json!({
            "cwd": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler",
            "toolCall": { "id": "t1", "name": name, "args": args }
        })
    }

    #[test]
    fn full_scope_allows_everything() {
        let p = test_policy();
        let res = evaluate_hook(
            &hook_call("run_command", json!({ "CommandLine": "cargo build" })),
            "full",
            &p,
        );
        assert_eq!(res["decision"], "allow");
    }

    #[test]
    fn restricted_blocks_shell_mcp_and_project_paths() {
        let p = test_policy();
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "echo hi" })), "restricted", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("call_mcp_tool", json!({ "ServerName": "graphify", "ToolName": "query_graph" })), "restricted", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("call_mcp_tool", json!({ "ServerName": "playwright", "ToolName": "browser_navigate" })), "restricted", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\ai-workstation\frontend\app.js" })), "restricted", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("write_file", json!({ "Path": r"C:\Users\cavit\ai-workstation\frontend\app.js" })), "restricted", &p)["decision"],
            "deny"
        );
        // Traversal escape attempt
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler\..\..\ai-workstation\README.md" })), "restricted", &p)["decision"],
            "deny"
        );
        // Self-tamper on .agents
        assert_eq!(
            evaluate_hook(&hook_call("write_file", json!({ "Path": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler\.agents\hooks.json" })), "restricted", &p)["decision"],
            "deny"
        );
        // Personal Drive folder write blocked
        assert_eq!(
            evaluate_hook(&hook_call("write_file", json!({ "Path": r"G:\Drive'ım\İKA\rapor.docx" })), "restricted", &p)["decision"],
            "deny"
        );
        // Non-image subagent blocked
        assert_eq!(
            evaluate_hook(&hook_call("invoke_subagent", json!({ "TypeName": "self" })), "restricted", &p)["decision"],
            "deny"
        );
    }

    #[test]
    fn restricted_allows_vault_drive_read_drive_vault_write_image_and_web() {
        let p = test_policy();
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Notlar\test.md" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("write_file", json!({ "Path": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Notlar\yeni.md" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"G:\Drive'ım\Dönem 7\not.pdf" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("write_file", json!({ "Path": r"G:\Drive'ım\AgyDesk_Belgeler\AgyDesk_Notlar\yeni.md" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("invoke_subagent", json!({ "TypeName": "image-generator" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("generate_image", json!({ "Prompt": "dc motor diagram" })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("search_web", json!({ "query": "laplace transform" })), "restricted", &p)["decision"],
            "allow"
        );
    }

    #[test]
    fn restricted_allows_only_safe_pdf_export_and_blocks_injection() {
        let p = test_policy();
        let ok_md = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --md-to-pdf "C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Notlar\test.md" "C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Dokuman\test.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_md })), "restricted", &p)["decision"],
            "allow"
        );
        let ok_html = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --html-to-pdf "AgyDesk_Notlar\test.html" "AgyDesk_Dokuman\test.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_html })), "restricted", &p)["decision"],
            "allow"
        );
        // Shell injection blocked
        let inj = format!("{}; whoami", ok_md);
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": inj })), "restricted", &p)["decision"],
            "deny"
        );
        // Output outside vault blocked
        let escape = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --md-to-pdf "AgyDesk_Notlar\test.md" "C:\Users\cavit\ai-workstation\evil.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": escape })), "restricted", &p)["decision"],
            "deny"
        );
    }

    #[test]
    fn restricted_allows_safe_file_ops_and_blocks_escapes() {
        let p = test_policy();
        // Vault PDF -> Drive Vault (allowed)
        let ok_copy_pdf = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Dokuman\Is_Sagligi_ve_Guvenligi\cikmis.pdf" "G:\Drive'ım\AgyDesk_Belgeler\AgyDesk_Dokuman\Is_Sagligi_ve_Guvenligi\cikmis.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_copy_pdf })), "restricted", &p)["decision"],
            "allow"
        );
        // Personal Drive -> Vault (read-only Drive to Vault copy allowed)
        let ok_drive_to_vault = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "G:\Drive'ım\Dönem 7\ders.pdf" "AgyDesk_Dokuman\ders.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_drive_to_vault })), "restricted", &p)["decision"],
            "allow"
        );
        // Sync folder Vault -> Drive Vault (allowed)
        let ok_sync = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --sync "AgyDesk_Dokuman\Is_Sagligi_ve_Guvenligi" "G:\Drive'ım\AgyDesk_Belgeler\AgyDesk_Dokuman\Is_Sagligi_ve_Guvenligi""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_sync })), "restricted", &p)["decision"],
            "allow"
        );
        // Move inside Vault (allowed)
        let ok_move = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --move "AgyDesk_Dokuman\eski.pdf" "AgyDesk_Dokuman\yeni.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": ok_move })), "restricted", &p)["decision"],
            "allow"
        );
        // Move OUT of personal Drive blocked (personal Drive is read-only)
        let bad_move_drive = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --move "G:\Drive'ım\Dönem 7\ders.pdf" "AgyDesk_Dokuman\ders.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": bad_move_drive })), "restricted", &p)["decision"],
            "deny"
        );
        // Copy into personal Drive outside AgyDesk_Belgeler blocked
        let bad_copy_drive = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "AgyDesk_Dokuman\ders.pdf" "G:\Drive'ım\İKA\ders.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": bad_copy_drive })), "restricted", &p)["decision"],
            "deny"
        );
        // Copy from project repo blocked
        let bad_copy_proj = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "C:\Users\cavit\ai-workstation\atolye.db" "AgyDesk_Dokuman\atolye.db""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": bad_copy_proj })), "restricted", &p)["decision"],
            "deny"
        );
        // Touching .agents blocked
        let bad_agents = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "AgyDesk_Notlar\test.md" ".agents\hooks.json""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": bad_agents })), "restricted", &p)["decision"],
            "deny"
        );
        // Shell injection blocked
        let bad_inj = format!("{} && calc.exe", ok_copy_pdf);
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": bad_inj })), "restricted", &p)["decision"],
            "deny"
        );
    }

    #[test]
    fn copy_dir_recursive_preserves_binary_and_skips_agents() {
        let base = std::env::temp_dir().join(format!("agydesk_guard_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(src.join(".agents")).unwrap();
        let pdf_bytes: Vec<u8> = vec![0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x00, 0xFF];
        std::fs::write(src.join("Sinav_2025.pdf"), &pdf_bytes).unwrap();
        std::fs::write(src.join(".agents").join("hooks.json"), b"{}").unwrap();

        let (c1, s1) = copy_dir_recursive(&src, &dst, true).unwrap();
        assert_eq!((c1, s1), (1, 0));
        assert_eq!(std::fs::read(dst.join("Sinav_2025.pdf")).unwrap(), pdf_bytes);
        assert!(!dst.join(".agents").exists());

        // Second sync skips identical up-to-date file
        let (c2, s2) = copy_dir_recursive(&src, &dst, true).unwrap();
        assert_eq!((c2, s2), (0, 1));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn study_scope_asks_approval_for_personal_dirs_but_hard_denies_projects() {
        let p = test_policy();
        // Downloads read -> ask in study, deny in restricted (AgyNote)
        let dl_read = hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Downloads\odev.pdf" }));
        let res_study = evaluate_hook(&dl_read, "study", &p);
        assert_eq!(res_study["decision"], "ask");
        assert_eq!(res_study["root_key"], "downloads");
        assert_eq!(evaluate_hook(&dl_read, "restricted", &p)["decision"], "deny");

        // Downloads write -> ask in study
        let dl_write = hook_call("write_file", json!({ "Path": r"C:\Users\cavit\Downloads\ozet.md" }));
        assert_eq!(evaluate_hook(&dl_write, "study", &p)["decision"], "ask");

        // Desktop outside vault -> ask; inside vault -> auto allow
        let desk_out = hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Desktop\rapor.pdf" }));
        assert_eq!(evaluate_hook(&desk_out, "study", &p)["decision"], "ask");
        let desk_in = hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Desktop\AgyDesk_Belgeler\not.md" }));
        assert_eq!(evaluate_hook(&desk_in, "study", &p)["decision"], "allow");

        // Personal Drive write -> ask in study, deny in restricted
        let drv_write = hook_call("write_file", json!({ "Path": r"G:\Drive'ım\İKA\rapor.md" }));
        let res_drv = evaluate_hook(&drv_write, "study", &p);
        assert_eq!(res_drv["decision"], "ask");
        assert_eq!(res_drv["root_key"], "drive");
        assert_eq!(evaluate_hook(&drv_write, "restricted", &p)["decision"], "deny");

        // Copy from Downloads -> Vault -> ask in study, deny in restricted
        let dl_copy = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --copy "C:\Users\cavit\Downloads\slayt.pdf" "AgyDesk_Dokuman\slayt.pdf""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_copy })), "study", &p)["decision"],
            "ask"
        );
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_copy })), "restricted", &p)["decision"],
            "deny"
        );

        // Project repo, .git, .gemini, .agents -> HARD DENY even in study
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\ai-workstation\src-rust\src\main.rs" })), "study", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\Documents\myrepo\.git\config" })), "study", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("read_file", json!({ "Path": r"C:\Users\cavit\.gemini\settings.json" })), "study", &p)["decision"],
            "deny"
        );
        // General shell in study -> approval-gated (ask), while restricted (AgyNote) -> hard deny
        let shell_res = evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "python -c \"print(2+2)\"" })), "study", &p);
        assert_eq!(shell_res["decision"], "ask");
        assert_eq!(shell_res["root_key"], "shell");
        assert_eq!(shell_res["action"], "Terminal Komutu Çalıştırma");
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "python -c \"print(2+2)\"" })), "restricted", &p)["decision"],
            "deny"
        );
        // Shell touching project repo / config dirs -> HARD DENY even in study
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": r"type C:\Users\cavit\ai-workstation\README.md" })), "study", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": r"dir C:\Users\cavit\.gemini" })), "study", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "git status .git" })), "study", &p)["decision"],
            "deny"
        );
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "sqlite3 atolye.db .tables" })), "study", &p)["decision"],
            "deny"
        );
    }

    #[test]
    fn guard_read_doc_policy_and_docx_extraction() {
        let p = test_policy();
        // Vault DOCX -> auto allow in both restricted and study
        let vault_doc = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --read-doc "C:\Users\cavit\Desktop\AgyDesk_Belgeler\AgyDesk_Dokuman\Grup14_Odev_Soru.docx""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": vault_doc })), "restricted", &p)["decision"],
            "allow"
        );
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": vault_doc })), "study", &p)["decision"],
            "allow"
        );
        // Downloads DOCX -> ask in study, deny in restricted
        let dl_doc = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --read-doc "C:\Users\cavit\Downloads\odev.docx""#;
        let res_dl = evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_doc })), "study", &p);
        assert_eq!(res_dl["decision"], "ask");
        assert_eq!(res_dl["root_key"], "downloads");
        assert_eq!(res_dl["action"], "Belge Okuma");
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_doc })), "restricted", &p)["decision"],
            "deny"
        );
        // Project dir or shell injection -> HARD DENY
        let proj_doc = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --read-doc "C:\Users\cavit\ai-workstation\secret.docx""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": proj_doc })), "study", &p)["decision"],
            "deny"
        );
        let inj_doc = format!("{}; whoami", vault_doc);
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": inj_doc })), "study", &p)["decision"],
            "deny"
        );

        // Synthetic DOCX extraction (heading, paragraph, OMML math <m:t>, table)
        let tmp = std::env::temp_dir().join(format!("agydesk_docx_test_{}.docx", std::process::id()));
        {
            let f = std::fs::File::create(&tmp).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::FileOptions::default();
            zw.start_file("word/document.xml", opts).unwrap();
            let doc_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Ödev Teslim Şartları</w:t></w:r></w:p>
    <w:p><w:r><w:t>Transfer fonksiyonu: </w:t></w:r><m:oMath><m:r><m:t>G(s)=10/(s+2)</m:t></m:r></m:oMath></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Bölüm</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Puan</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Simulink (.slx)</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>"#;
            zw.write_all(doc_xml.as_bytes()).unwrap();
            zw.finish().unwrap();
        }
        let extracted = extract_docx_text(&tmp).unwrap();
        let _ = std::fs::remove_file(&tmp);
        assert!(extracted.contains("# Ödev Teslim Şartları"));
        assert!(extracted.contains("G(s)=10/(s+2)"));
        assert!(extracted.contains("| Bölüm | Puan |"));
        assert!(extracted.contains("| Simulink (.slx) | 40 |"));
    }

    #[test]
    fn guard_list_dir_policy_and_ordering() {
        let p = test_policy();
        // Downloads --list -> ask in study, deny in restricted
        let dl_list = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --list "C:\Users\cavit\Downloads""#;
        let res_study = evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_list })), "study", &p);
        assert_eq!(res_study["decision"], "ask");
        assert_eq!(res_study["root_key"], "downloads");
        assert_eq!(res_study["action"], "Klasör Listeleme");
        assert!(res_study["dst_path"].is_null());
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": dl_list })), "restricted", &p)["decision"],
            "deny"
        );

        // Vault and Drive --list -> auto allow in both restricted and study
        let vault_list = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --list "C:\Users\cavit\Desktop\AgyDesk_Belgeler""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": vault_list })), "restricted", &p)["decision"],
            "allow"
        );
        let drive_list = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --list "G:\Drive'ım""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": drive_list })), "study", &p)["decision"],
            "allow"
        );

        // Project dir, .git, shell injection -> HARD DENY even in study
        let proj_list = r#"C:\Users\cavit\ai-workstation\agydesk-guard.exe --list "C:\Users\cavit\ai-workstation""#;
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": proj_list })), "study", &p)["decision"],
            "deny"
        );
        let inj_list = format!("{}; whoami", dl_list);
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": inj_list })), "study", &p)["decision"],
            "deny"
        );

        // list_dir_entries skips sensitive dirs and returns entries
        let base = std::env::temp_dir().join(format!("agydesk_list_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join(".git")).unwrap();
        std::fs::create_dir_all(base.join("AltKlasor")).unwrap();
        std::fs::write(base.join("not.pdf"), b"abc").unwrap();
        let items = list_dir_entries(&base, &p).unwrap();
        let names: Vec<&str> = items.iter().map(|i| i.3.as_str()).collect();
        assert!(names.contains(&"not.pdf"));
        assert!(names.contains(&"AltKlasor"));
        assert!(!names.contains(&".git"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn study_scope_allows_browser_mcp_with_approval_and_blocks_other_mcp() {
        let p = test_policy();
        let schema_read = hook_call(
            "read_file",
            json!({ "Path": r"C:\Users\cavit\.gemini\antigravity-cli\mcp\chrome-devtools\list_pages.json" }),
        );
        assert_eq!(evaluate_hook(&schema_read, "study", &p)["decision"], "allow");
        assert_eq!(evaluate_hook(&schema_read, "restricted", &p)["decision"], "deny");

        let schema_write = hook_call(
            "write_file",
            json!({ "Path": r"C:\Users\cavit\.gemini\antigravity-cli\mcp\chrome-devtools\list_pages.json" }),
        );
        assert_eq!(evaluate_hook(&schema_write, "study", &p)["decision"], "deny");
        let cfg_read = hook_call(
            "read_file",
            json!({ "Path": r"C:\Users\cavit\.gemini\config\mcp_config.json" }),
        );
        assert_eq!(evaluate_hook(&cfg_read, "study", &p)["decision"], "deny");

        let cdp_call = hook_call(
            "call_mcp_tool",
            json!({ "ServerName": "chrome-devtools", "ToolName": "list_pages", "Arguments": {} }),
        );
        let res_study = evaluate_hook(&cdp_call, "study", &p);
        assert_eq!(res_study["decision"], "ask");
        assert_eq!(res_study["root_key"], "browser");
        assert_eq!(evaluate_hook(&cdp_call, "restricted", &p)["decision"], "deny");

        let bad_upload = hook_call(
            "call_mcp_tool",
            json!({
                "ServerName": "chrome-devtools",
                "ToolName": "upload_file",
                "Arguments": { "filePath": r"C:\Users\cavit\ai-workstation\atolye.db" }
            }),
        );
        assert_eq!(evaluate_hook(&bad_upload, "study", &p)["decision"], "deny");

        let graph_call = hook_call(
            "call_mcp_tool",
            json!({ "ServerName": "graphify", "ToolName": "query_graph", "Arguments": {} }),
        );
        assert_eq!(evaluate_hook(&graph_call, "study", &p)["decision"], "deny");
    }
}
