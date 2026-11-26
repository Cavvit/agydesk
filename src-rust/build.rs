use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let ico_path = manifest_dir
        .parent()
        .unwrap()
        .join("frontend")
        .join("agydesk.ico");
    println!("cargo:rerun-if-changed={}", ico_path.display());

    if !ico_path.exists() {
        return;
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let rc_path = out_dir.join("agydesk.rc");
    let obj_path = out_dir.join("agydesk_res.o");

    let ico_escaped = ico_path.to_string_lossy().replace('\\', "/");
    let rc_content = format!("1 ICON \"{}\"\n", ico_escaped);
    if fs::write(&rc_path, rc_content).is_err() {
        return;
    }

    let windres_cmd = if PathBuf::from(r"C:\TDM-GCC-64\bin\windres.exe").exists() {
        r"C:\TDM-GCC-64\bin\windres.exe"
    } else {
        "windres"
    };

    if let Ok(status) = Command::new(windres_cmd)
        .args([
            "-i",
            &rc_path.to_string_lossy(),
            "-o",
            &obj_path.to_string_lossy(),
            "-O",
            "coff",
        ])
        .status()
    {
        if status.success() && obj_path.exists() {
            println!("cargo:rustc-link-arg-bin=AgyDesk={}", obj_path.display());
        }
    }
}
