#[allow(dead_code)]
mod config;
mod vault_guard;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 {
        match args[1].as_str() {
            "--list" => std::process::exit(vault_guard::run_list_dir(&args[2])),
            "--read-doc" | "--read" => std::process::exit(vault_guard::run_read_doc(&args[2])),
            _ => {}
        }
    }
    if args.len() == 4 {
        match args[1].as_str() {
            "--md-to-pdf" | "--html-to-pdf" => {
                std::process::exit(vault_guard::run_pdf_export(&args[1], &args[2], &args[3]));
            }
            "--copy" | "--move" | "--sync" => {
                std::process::exit(vault_guard::run_file_op(&args[1], &args[2], &args[3]));
            }
            _ => {}
        }
    }
    std::process::exit(vault_guard::run_cli_guard());
}
