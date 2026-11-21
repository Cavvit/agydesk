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

    // 4b. Strictly sandboxed agydesk-guard helpers ONLY (zero shell metacharacters)
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
        return GuardDecision::Deny(
            "AgyNote/AgyStudy kısıtlı modda: genel terminal komutları kapalıdır. Yalnızca `C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe` ile `--list`, `--md-to-pdf`, `--html-to-pdf`, `--copy`, `--move`, `--sync` izinlidir. Genel terminal için AgyAI sekmesini kullanın.".to_string(),
        );
    }

    // 5. Everything else (MCP/browser/graphify, swarm, run_workflow, schedule, etc.) -> HARD DENY
    GuardDecision::Deny(
        "AgyNote/AgyStudy kısıtlı modda: terminal komutu, proje değişikliği, MCP/tarayıcı ve dosya indirme/yükleme kapalıdır. Tam erişim için AgyAI sekmesini kullanın.".to_string(),
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

        // Project repo, .git, .gemini, .agents, general shell -> HARD DENY even in study
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
        assert_eq!(
            evaluate_hook(&hook_call("run_command", json!({ "CommandLine": "dir C:\\Users\\cavit\\Downloads" })), "study", &p)["decision"],
            "deny"
        );
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
}
