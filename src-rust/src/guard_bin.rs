#[allow(dead_code)]
mod config;
mod vault_guard;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 4 && (args[1] == "--md-to-pdf" || args[1] == "--html-to-pdf") {
        std::process::exit(vault_guard::run_pdf_export(&args[1], &args[2], &args[3]));
    }
    std::process::exit(vault_guard::run_cli_guard());
}
