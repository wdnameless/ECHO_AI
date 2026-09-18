// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod activate;
mod api;
mod capture;
mod db;
mod embedded;
mod handy_server;
mod models;
mod settings;
mod shortcuts;
mod tray;
mod vocab;
mod window;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_posthog::{init as posthog_init, PostHogConfig, PostHogOptions};
use tokio::task::JoinHandle;
mod speaker;
use capture::CaptureState;
use speaker::VadConfig;

#[cfg(target_os = "macos")]
#[allow(deprecated)]
use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt};

#[derive(Default)]
pub struct AudioState {
    stream_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    vad_config: Arc<Mutex<VadConfig>>,
    is_capturing: Arc<Mutex<bool>>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Early migration checksum patch: tauri-plugin-sql panics on startup if migration
    // checksums in _sqlx_migrations differ (e.g. CRLF vs LF on Windows builds).
    // Patch existing checksums to LF sha384 before the SQL plugin initializes.
    let identifier = "com.srikanthnani.pluely";
    if let Some(config_dir) = dirs::config_dir() {
        let db_path = config_dir.join(identifier).join("pluely.db");
        db::patch_migration_checksums(&db_path);
    }
    if let Some(data_dir) = dirs::data_dir() {
        let db_path = data_dir.join(identifier).join("pluely.db");
        db::patch_migration_checksums(&db_path);
    }

    // Get PostHog API key
    let posthog_api_key = option_env!("POSTHOG_API_KEY").unwrap_or("").to_string();
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:pluely.db", db::migrations())
                .build(),
        )
        .manage(AudioState::default())
        .manage(CaptureState::default())
        .manage(shortcuts::WindowVisibility {
            is_hidden: Mutex::new(false),
        })
        .manage(shortcuts::RegisteredShortcuts::default())
        .manage(shortcuts::LicenseState::default())
        .manage(shortcuts::MoveWindowState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window or settings window if already running
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }
        }))
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_shell::init()) // Add shell plugin
        .plugin(posthog_init(PostHogConfig {
            api_key: posthog_api_key,
            options: Some(PostHogOptions {
                // disable session recording
                disable_session_recording: Some(true),
                // disable pageview
                capture_pageview: Some(false),
                // disable pageleave
                capture_pageleave: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        }))
        .plugin(tauri_plugin_machine_uid::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    let mut builder = builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            window::set_window_height,
            window::open_dashboard,
            window::open_dashboard_page,
            window::toggle_dashboard,
            window::move_window,
            handy_server::handy_server_status,
            handy_server::handy_server_status_detailed,
            handy_server::stt_readiness,
            handy_server::start_handy_server,
            handy_server::speak_text,
            handy_server::read_asr_port_file,
            capture::capture_to_base64,
            capture::start_screen_capture,
            capture::capture_selected_area,
            capture::close_overlay_window,
            shortcuts::check_shortcuts_registered,
            shortcuts::get_registered_shortcuts,
            shortcuts::update_shortcuts,
            shortcuts::validate_shortcut_key,
            shortcuts::set_license_status,
            shortcuts::set_app_icon_visibility,
            shortcuts::set_always_on_top,
            window::set_stealth_mode,
            shortcuts::exit_app,
            activate::activate_license_api,
            activate::deactivate_license_api,
            activate::validate_license_api,
            activate::mask_license_key_cmd,
            activate::get_checkout_url,
            activate::secure_storage_save,
            activate::secure_storage_get,
            activate::secure_storage_get_item,
            activate::secure_storage_remove,
            api::transcribe_audio,
            api::chat_stream_response,
            api::fetch_models,
            api::fetch_prompts,
            api::create_system_prompt,
            api::check_license_status,
            api::get_activity,
            speaker::start_system_audio_capture,
            speaker::stop_system_audio_capture,
            speaker::manual_stop_continuous,
            speaker::check_system_audio_access,
            speaker::request_system_audio_access,
            speaker::get_vad_config,
            speaker::update_vad_config,
            speaker::get_capture_status,
            speaker::get_audio_sample_rate,
            speaker::get_input_devices,
            speaker::get_output_devices,
            vocab::get_corrections,
            vocab::add_correction,
            vocab::delete_correction,
            settings::commands::get_paths,
            settings::commands::set_paths,
            settings::commands::pick_directory,
            settings::commands::enable_portable,
            settings::commands::disable_portable,
            settings::commands::get_start_minimized,
            settings::commands::set_start_minimized,
            models::list_models,
            models::model_catalog,
            models::download_model,
            models::delete_model,
            models::select_model,
            models::selected_model,
        ])
        .setup(|app| {
            // Setup main window positioning
            window::setup_main_window(app).expect("Failed to setup main window");
            // Auto-start the local Handy STT server (whisper over HTTP on :8000)
            handy_server::ensure_server_running();
            // Setup System Tray icon & menu
            if let Err(e) = tray::setup_tray(app.handle()) {
                eprintln!("Failed to setup system tray: {}", e);
            }

            // Start hidden when the user asked for it: the tray icon is the
            // entry point, and an overlay dropping onto the screen at login is
            // exactly what this preference exists to avoid.
            if settings::load_settings().start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            #[cfg(target_os = "macos")]
            init(app.app_handle());
            let app_handle = app.handle();
            if app_handle.get_webview_window("dashboard").is_none() {
                if let Err(e) = window::create_dashboard_window(&app_handle) {
                    eprintln!("Failed to pre-create dashboard window on startup: {}", e);
                }
            }

            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;

                #[allow(deprecated, unexpected_cfgs)]
                if let Err(e) = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    Some(vec![]),
                )) {
                    eprintln!("Failed to initialize autostart plugin: {}", e);
                }
            }

            // Initialize global shortcut plugin with centralized handler
            app.handle()
                .plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

                            let action_id = {
                                let state = app.state::<shortcuts::RegisteredShortcuts>();
                                let registered = match state.shortcuts.lock() {
                                    Ok(guard) => guard,
                                    Err(poisoned) => {
                                        eprintln!("Mutex poisoned in handler, recovering...");
                                        poisoned.into_inner()
                                    }
                                };

                                registered.iter().find_map(|(action_id, shortcut_str)| {
                                    if let Ok(s) = shortcut_str.parse::<Shortcut>() {
                                        if &s == shortcut {
                                            return Some(action_id.clone());
                                        }
                                    }
                                    None
                                })
                            };

                            if let Some(action_id) = action_id {
                                match event.state() {
                                    ShortcutState::Pressed => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::start_move_window(app, direction);
                                        } else {
                                            eprintln!("Shortcut triggered: {}", action_id);
                                            shortcuts::handle_shortcut_action(app, &action_id);
                                        }
                                    }
                                    ShortcutState::Released => {
                                        if let Some(direction) =
                                            action_id.strip_prefix("move_window_")
                                        {
                                            shortcuts::stop_move_window(app, direction);
                                        }
                                    }
                                }
                            }
                        })
                        .build(),
                )
                .expect("Failed to initialize global shortcut plugin");
            if let Err(e) = shortcuts::setup_global_shortcuts(app.handle()) {
                eprintln!("Failed to setup global shortcuts: {}", e);
            }
            Ok(())
        });

    // Add macOS-specific permissions plugin
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
fn init(app_handle: &AppHandle) {
    let window: WebviewWindow = app_handle.get_webview_window("main").unwrap();

    let panel = window.to_panel().unwrap();

    let delegate = panel_delegate!(MyPanelDelegate {
        window_did_become_key,
        window_did_resign_key
    });

    let handle = app_handle.to_owned();

    delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_become_key" => {
                let app_name = handle.package_info().name.to_owned();

                println!("[info]: {:?} panel becomes key window!", app_name);
            }
            "window_did_resign_key" => {
                println!("[info]: panel resigned from key window!");
            }
            _ => (),
        }
    }));

    // Set the window to float level
    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    panel.set_level(NSFloatWindowLevel);

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

    #[allow(deprecated)]
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
    );

    panel.set_delegate(delegate);
}
