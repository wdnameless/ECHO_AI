// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    if let Some(code) = pluely_lib::portable_update::maybe_run_helper() {
        std::process::exit(code);
    }

    pluely_lib::run()
}
