// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Helper mode: read one PDF's text for Ask and exit (see rag/pdf.rs).
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == pageturn_lib::PDF_HELPER_FLAG {
        std::process::exit(pageturn_lib::run_pdf_helper(&args[2]));
    }
    pageturn_lib::run()
}
