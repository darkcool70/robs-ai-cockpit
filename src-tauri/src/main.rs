// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `ai-cockpit sink <hook|statusline> <run-dir>` is invoked by Claude Code (hooks and
    // statusLine) and must never start the GUI.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(profile) = std::env::var_os(ai_cockpit_lib::login_browser::PROFILE_ENV) {
        if args.len() == 1 && args[0].starts_with("https://") {
            let result = ai_cockpit_lib::login_browser::open(&args[0], profile.into());
            if let Err(e) = &result { eprintln!("{e}"); }
            std::process::exit(if result.is_ok() { 0 } else { 1 });
        }
    }
    if args.first().map(String::as_str) == Some("sink") {
        std::process::exit(ai_cockpit_lib::sink::run(&args[1..]));
    }
    ai_cockpit_lib::run()
}
