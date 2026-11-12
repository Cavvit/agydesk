use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git(ws: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(ws)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn available(ws: &Path) -> bool {
    git(ws, &["rev-parse", "--is-inside-work-tree"]).is_ok()
        && git(ws, &["rev-parse", "HEAD"]).is_ok()
}

pub fn snapshot(ws: &Path) -> Option<String> {
    if !available(ws) {
        return None;
    }
    let r = git(ws, &["stash", "create"]).ok()?;
    if r.is_empty() {
        git(ws, &["rev-parse", "HEAD"]).ok()
    } else {
        Some(r)
    }
}

pub fn restore(ws: &Path, reference: &str) -> Result<(), String> {
    let src = format!("--source={}", reference);
    git(ws, &["restore", &src, "--staged", "--worktree", "."]).map(|_| ())
}
