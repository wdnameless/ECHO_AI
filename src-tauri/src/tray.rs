use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_main = MenuItem::with_id(app, "toggle_main", "Показать / Скрыть Echo AI", true, None::<&str>)?;
    let open_dashboard = MenuItem::with_id(app, "open_dashboard", "Дашборд / Чаты", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "Настройки", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход из Echo AI", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&toggle_main, &open_dashboard, &open_settings, &quit],
    )?;

    let mut tray_builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Pluely - AI Meeting & Interview Assistant");

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_main" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "open_dashboard" => {
                let _ = crate::window::show_dashboard_window(app);
            }
            "open_settings" => {
                let _ = crate::window::open_dashboard_page(app.clone(), "/settings".to_string());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
