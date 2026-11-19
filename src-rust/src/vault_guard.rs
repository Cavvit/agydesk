use crate::config::{DRIVE_DIR, DRIVE_VAULT_DIR, VAULT_DIR};
use serde_json::{json, Value};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct GuardPolicy {
    pub vault_dir: PathBuf,
    pub drive_dir: Option<PathBuf>,
    pub drive_vault_dir: Option<PathBuf>,
}

impl GuardPolicy {
    pub fn from_config() -> Self {
        Self {
            vault_dir: VAULT_DIR.clone(),
            drive_dir: DRIVE_DIR.clone(),
            drive_vault_dir: DRIVE_VAULT_DIR.clone(),
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
    target_norm.contains(r"\.agents\")
        || target_norm.ends_with(r"\.agents")
        || target_norm.contains(r"\.agent\")
        || target_norm.ends_with(r"\.agent")
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

pub fn evaluate_hook(payload: &Value, scope: &str, policy: &GuardPolicy) -> Value {
    // Only enforce restrictions for AgyNote / AgyStudy restricted sessions.
    if scope != "restricted" {
        return allow();
    }

    let tool_call = match payload.get("toolCall") {
        Some(tc) => tc,
        None => return deny("AgyNote/AgyStudy güvenlik kalkanı: geçersiz araç çağrısı."),
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
        return allow();
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
            return allow();
        }
        return deny(
            "AgyNote/AgyStudy kısıtlı modda: yalnızca image-generator alt ajanı kullanılabilir.",
        );
    }

    // 3. Read / search tools -> allowed inside VAULT_DIR or DRIVE_DIR
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
            return deny("AgyNote/AgyStudy kısıtlı modda: dosya/klasör yolu belirtilmelidir.");
        };
        let norm = normalize_win(Path::new(&pstr), &cwd);
        let in_vault = is_under(&norm, &policy.vault_dir);
        let in_drive = policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&norm, d))
            .unwrap_or(false);
        if in_vault || in_drive {
            return allow();
        }
        return deny(
            "AgyNote/AgyStudy kısıtlı modda: yalnızca AgyDesk kasası ve Google Drive içindeki dosyalar okunabilir. Proje/sistem dosyaları için AgyAI sekmesini kullanın.",
        );
    }

    // 4. Write / edit tools -> allowed ONLY inside VAULT_DIR or DRIVE_VAULT_DIR (never `.agents`)
    if matches!(
        name,
        "write_file"
            | "write_to_file"
            | "edit_file"
            | "replace_file_content"
            | "multi_replace_file_content"
    ) {
        let Some(pstr) = extract_path_arg(&args) else {
            return deny("AgyNote/AgyStudy kısıtlı modda: hedef dosya yolu belirtilmelidir.");
        };
        let norm = normalize_win(Path::new(&pstr), &cwd);
        if touches_agents_dir(&norm) {
            return deny("AgyNote/AgyStudy güvenlik kalkanı: .agents yapılandırması değiştirilemez.");
        }
        let in_vault = is_under(&norm, &policy.vault_dir);
        let in_drive_vault = policy
            .drive_vault_dir
            .as_ref()
            .map(|d| is_under(&norm, d))
            .unwrap_or(false);
        if in_vault || in_drive_vault {
            return allow();
        }
        return deny(
            "AgyNote/AgyStudy kısıtlı modda: yazma/düzenleme yalnızca AgyDesk_Belgeler kasası ve G:\\Drive'ım\\AgyDesk_Belgeler içinde yapılabilir.",
        );
    }

    // 4b. Strictly sandboxed PDF export helper ONLY (zero shell metacharacters, vault/Drive paths only)
    if name == "run_command" {
        let cmdline = args
            .get("CommandLine")
            .or_else(|| args.get("command_line"))
            .or_else(|| args.get("command"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if parse_safe_pdf_export_cmd(cmdline, &cwd, policy).is_some() {
            return allow();
        }
        return deny(
            "AgyNote/AgyStudy kısıtlı modda: genel terminal komutları kapalıdır. Yalnızca PDF üretimi için `C:\\Users\\cavit\\ai-workstation\\agydesk-guard.exe --md-to-pdf \"<girdi.md>\" \"<cikti.pdf>\"` (veya `--html-to-pdf`) izinlidir. Genel terminal için AgyAI sekmesini kullanın.",
        );
    }

    // 5. Everything else (MCP/browser/graphify, swarm, run_workflow, schedule, etc.) -> HARD DENY
    deny(
        "AgyNote/AgyStudy kısıtlı modda: terminal komutu, proje değişikliği, MCP/tarayıcı ve dosya indirme/yükleme kapalıdır. Tam erişim için AgyAI sekmesini kullanın.",
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
) -> Option<(PathBuf, PathBuf)> {
    let in_norm = normalize_win(Path::new(in_raw), cwd);
    let out_norm = normalize_win(Path::new(out_raw), cwd);
    if touches_agents_dir(&in_norm) || touches_agents_dir(&out_norm) {
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
    let in_ok = is_under(&in_norm, &policy.vault_dir)
        || policy
            .drive_dir
            .as_ref()
            .map(|d| is_under(&in_norm, d))
            .unwrap_or(false);
    let out_ok = is_under(&out_norm, &policy.vault_dir)
        || policy
            .drive_vault_dir
            .as_ref()
            .map(|d| is_under(&out_norm, d))
            .unwrap_or(false);
    if in_ok && out_ok {
        Some((PathBuf::from(in_norm), PathBuf::from(out_norm)))
    } else {
        None
    }
}

fn parse_safe_pdf_export_cmd(
    cmdline: &str,
    cwd: &Path,
    policy: &GuardPolicy,
) -> Option<(String, PathBuf, PathBuf)> {
    let tokens = split_simple_tokens(cmdline.trim())?;
    if tokens.len() != 4 {
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
    if mode != "--md-to-pdf" && mode != "--html-to-pdf" {
        return None;
    }
    let (in_p, out_p) = validate_pdf_paths(mode, &tokens[2], &tokens[3], cwd, policy)?;
    Some((mode.to_string(), in_p, out_p))
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
    let cwd = std::env::current_dir().unwrap_or_else(|_| policy.vault_dir.clone());
    let Some((in_path, out_path)) = validate_pdf_paths(mode, in_arg, out_arg, &cwd, &policy) else {
        eprintln!("HATA: Yalnızca AgyDesk kasası veya G:\\Drive'ım\\AgyDesk_Belgeler içindeki .md/.html -> .pdf dönüşümüne izin verilir.");
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

/// Entrypoint for `AgyDesk.exe --vault-guard` invoked by `PreToolUse` hook.
pub fn run_cli_guard() -> i32 {
    let mut input = String::new();
    let _ = io::stdin().read_to_string(&mut input);
    let payload: Value = serde_json::from_str(&input).unwrap_or_else(|_| json!({}));
    let scope = std::env::var("AGYDESK_SCOPE").unwrap_or_default();
    let policy = GuardPolicy::from_config();
    let decision = evaluate_hook(&payload, &scope, &policy);
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
}
