#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

pub const WS_EX_TOOLWINDOW_VAL: isize = 0x00000080;
pub const WS_EX_APPWINDOW_VAL: isize = 0x00040000;
pub const WS_EX_NOACTIVATE_VAL: isize = 0x08000000;

static STEALTH_MODE_ENABLED: AtomicBool = AtomicBool::new(false);

/// Reports whether window-level stealth mode is currently active.
pub fn is_stealth_enabled() -> bool {
    STEALTH_MODE_ENABLED.load(Ordering::SeqCst)
}

/// Calculates the target extended window style for stealth mode (R09-R11).
///
/// When stealth is enabled:
/// - WS_EX_TOOLWINDOW is set (hides from Alt-Tab switcher).
/// - WS_EX_APPWINDOW is cleared (prevents forcing onto taskbar).
/// - If `is_overlay` is true (floating main bar), WS_EX_NOACTIVATE is set so it never steals focus.
/// - If `is_overlay` is false (dashboard, dialogs), WS_EX_NOACTIVATE is cleared so the window remains interactive.
///
/// When stealth is disabled:
/// - If `is_overlay` is true, WS_EX_TOOLWINDOW and WS_EX_NOACTIVATE remain set (floating toolbar design).
/// - If `is_overlay` is false, WS_EX_TOOLWINDOW and WS_EX_NOACTIVATE are cleared (normal window appearance in Alt-Tab).
pub fn calculate_stealth_ex_style(current_style: isize, enabled: bool, is_overlay: bool) -> isize {
    if enabled {
        let mut style = (current_style | WS_EX_TOOLWINDOW_VAL) & !WS_EX_APPWINDOW_VAL;
        if is_overlay {
            style |= WS_EX_NOACTIVATE_VAL;
        } else {
            style &= !WS_EX_NOACTIVATE_VAL;
        }
        style
    } else if is_overlay {
        current_style | WS_EX_TOOLWINDOW_VAL | WS_EX_NOACTIVATE_VAL
    } else {
        current_style & !WS_EX_TOOLWINDOW_VAL & !WS_EX_NOACTIVATE_VAL
    }
}

#[cfg(target_os = "windows")]
pub fn apply_stealth_to_window_with_mode<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
    is_overlay: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    if let Ok(hwnd_ptr) = window.hwnd() {
        let hwnd = HWND(hwnd_ptr.0 as *mut _);
        unsafe {
            let current_ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let target_ex = calculate_stealth_ex_style(current_ex, enabled, is_overlay);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, target_ex);

            let affinity = if enabled {
                WDA_EXCLUDEFROMCAPTURE
            } else {
                WDA_NONE
            };
            let _ = SetWindowDisplayAffinity(hwnd, affinity);

            let _ = SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    let _ = window.set_skip_taskbar(enabled || is_overlay);
    let _ = window.set_content_protected(enabled);

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn apply_stealth_to_window_with_mode<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
    _is_overlay: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    {
        // On macOS, set_content_protected sets NSWindowSharingNone (0) when enabled,
        // which excludes the window from screen capture / recording / sharing.
        let _ = window.set_content_protected(enabled);
        if enabled {
            let _ = window.set_skip_taskbar(true);
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Linux honest no-op: X11/Wayland display protocols lack uniform OS-level
        // screen-capture exclusion without compositor-specific private extensions.
        // We do not fake process name or window class (hard ban on masking).
        let _ = window.set_content_protected(enabled);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn apply_stealth_to_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Box<dyn std::error::Error>> {
    apply_stealth_to_window_with_mode(window, is_stealth_enabled(), true)
}

#[tauri::command]
pub fn set_stealth_mode<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    STEALTH_MODE_ENABLED.store(enabled, Ordering::SeqCst);

    // Apply to all existing windows (main, dashboard, aux dialogs, overlays)
    for (label, window) in app.webview_windows() {
        let is_overlay = label == "main" || label == "pluely" || label.starts_with("capture-overlay");
        let _ = apply_stealth_to_window_with_mode(&window, enabled, is_overlay);
    }

    Ok(())
}
// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("pluely"))
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    #[cfg(target_os = "windows")]
    {
        let _ = apply_stealth_to_window(&window);
    }

    Ok(())
}

/// Positions a window at the top center of the screen with a specified Y offset
pub fn position_window_top_center(
    window: &WebviewWindow,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        // Calculate center X position
        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;

        // Set the window position
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: y_offset,
        }))?;
    }

    Ok(())
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

/// Resizes the window to fit the current UI mode.
///
/// A height the user stretched to by hand is theirs: expanding or collapsing the
/// panel must not snap it back to the default, otherwise a drag looks like it did
/// nothing the moment anything else in the bar is touched.
#[tauri::command]
pub fn set_window_height(window: tauri::WebviewWindow, height: u32) -> Result<(), String> {
    let current = measured_height(&window);
    let target = if height > 100 && current > COLLAPSED_HEIGHT + 60.0 {
        current
    } else {
        height as f64
    };
    apply_height(&window, target)
}

/// Resizes the window to an exact height. Used by the drag handle, which supplies a
/// height the user is actively choosing.
#[tauri::command]
pub fn set_window_height_absolute(
    window: tauri::WebviewWindow,
    height: u32,
) -> Result<(), String> {
    apply_height(&window, height as f64)
}

/// The compact bar's height, below which the window is considered collapsed.
const COLLAPSED_HEIGHT: f64 = 54.0;

fn measured_height<R: Runtime>(window: &tauri::WebviewWindow<R>) -> f64 {
    match (window.outer_size(), window.scale_factor()) {
        (Ok(size), Ok(scale)) => size.height as f64 / scale,
        (Ok(size), Err(_)) => size.height as f64,
        _ => COLLAPSED_HEIGHT,
    }
}

fn apply_height<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    target_height: f64,
) -> Result<(), String> {
    use tauri::{LogicalSize, Size};

    // If the window is maximized or in fullscreen mode, do not force-resize.
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }

    // Preserve the user's custom stretched width instead of resetting to a hardcoded 600px
    let current_width = if let Ok(size) = window.outer_size() {
        if let Ok(scale_factor) = window.scale_factor() {
            (size.width as f64) / scale_factor
        } else {
            size.width as f64
        }
    } else {
        600.0
    };

    let target_width = if current_width < 400.0 { 600.0 } else { current_width };

    let new_size = LogicalSize::new(target_width, target_height);
    window
        .set_size(Size::Logical(new_size))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

/// Shows the dashboard window and navigates it to the given route
/// (e.g. "/settings" or "/models"). Route is validated to
/// prevent navigation outside the app shell.
#[tauri::command]
pub fn open_dashboard_page(app: tauri::AppHandle, route: String) -> Result<(), String> {
    const ALLOWED_ROUTES: &[&str] = &[
        "/dashboard",
        "/chats",
        "/models",
        "/system-prompts",
        "/shortcuts",
        "/screenshot",
        "/settings",
        "/audio",
        "/responses",
        "/dev-space",
    ];
    let normalized = if route.starts_with('/') {
        route
    } else {
        format!("/{}", route)
    };

    if !ALLOWED_ROUTES.contains(&normalized.as_str()) {
        return Err(format!("Route not allowed: {}", normalized));
    }

    show_dashboard_window(&app)?;

    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        let _ = dashboard_window.emit(
            "navigate",
            tauri::WebviewUrl::App(normalized.clone().into()),
        );
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                // Window is hidden, show and focus it
                dashboard_window
                    .show()
                    .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
                dashboard_window
                    .set_focus()
                    .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("index.html".into()));

    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .title("Echo AI - Настройки")
        .center()
        .decorations(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .content_protected(false)
        .visible(false)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    #[cfg(not(target_os = "macos"))]
    let base_builder = base_builder
        .title("Echo AI - Настройки")
        .center()
        .decorations(true)
        .inner_size(1020.0, 720.0)
        .min_inner_size(880.0, 600.0)
        .visible(false)
        .content_protected(false);

    let window = base_builder.build()?;
    setup_dashboard_close_handler(&window);
    // The settings window is a normal interactive window: it must NOT carry the
    // overlay's stealth flags. `WS_EX_NOACTIVATE` in particular makes it unable to
    // take focus, which reads to the user as "buttons do not respond".
    let _ = window.hide();
    guard_settings_visibility(app.clone(), window.clone());
    if is_stealth_enabled() {
        let _ = apply_stealth_to_window_with_mode(&window, true, false);
    }
    Ok(window)
}

/// Steady-state interval of the visibility guard.
const SETTINGS_GUARD_MS: u64 = 500;

/// Set once the user asks for the settings window, which disarms the guard.
static SETTINGS_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Whether the window is on screen, according to the OS.
///
/// Tauri's `is_visible` reports *its own* flag, which stays `false` when the
/// shell reveals a window the app never showed — exactly the reveal this guard
/// exists to undo, so it must ask the window manager instead.
fn visible_on_screen<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;

        if let Ok(hwnd_ptr) = window.hwnd() {
            let hwnd = HWND(hwnd_ptr.0 as *mut _);
            return unsafe { IsWindowVisible(hwnd).as_bool() };
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        window.is_visible().unwrap_or(false)
    }
}

fn guard_settings_visibility<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    // The window is preloaded for its WebView2 side effect — created on demand it
    // came up blank — so nothing but an explicit request may leave it visible.
    // The shell reveals it on its own every so often (WebView2 attaching, the
    // window being activated, session events), and a guard that only runs for the
    // first seconds after creation misses exactly those: the window then stays on
    // screen, which is the "settings open by themselves at launch" report.
    tauri::async_runtime::spawn(async move {
        // Poll quickly while the window settles, then slowly: a reveal can happen
        // at any point in the session, but only costs a visibility query.
        let startup_until = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let interval = if std::time::Instant::now() < startup_until {
                std::time::Duration::from_millis(100)
            } else {
                std::time::Duration::from_millis(SETTINGS_GUARD_MS)
            };
            tokio::time::sleep(interval).await;

            if SETTINGS_REQUESTED.load(Ordering::SeqCst) {
                // The user asked for the window: leave it alone for now, but keep
                // the guard running. Returning here killed the task for the whole
                // session, so once Settings had been opened a single time nothing
                // hid it again — `SETTINGS_REQUESTED` is cleared when the window
                // closes, and the guard has to still be there to act on that.
                continue;
            }
            match app.get_webview_window("dashboard") {
                Some(win) => {
                    if visible_on_screen(&win) {
                        hide_at_os_level(&win);
                    }
                }
                // Closed for real: nothing left to guard.
                None => return,
            }
        }
    });
    let _ = window;
}

/// Takes the window off screen, whatever state the toolkit thinks it is in.
fn hide_at_os_level<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

        if let Ok(hwnd_ptr) = window.hwnd() {
            let hwnd = HWND(hwnd_ptr.0 as *mut _);
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
    // Keep the toolkit's own state in step with what is on screen.
    let _ = window.hide();
}

/// Sets up the close event handler for the dashboard window.
///
/// Also answers the other way the window can reappear: a reveal activates it, so
/// hiding on focus gets it off screen immediately instead of at the next poll.
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
            // The user is done with it, so the guard must protect again.
            //
            // This flag is a one-way latch unless it is cleared here: once the
            // user had opened Settings even once, the guard returned for the rest
            // of the session and every later unrequested reveal (WebView2
            // attaching, activation, a session event) left the window on screen —
            // the "settings open by themselves" report.
            SETTINGS_REQUESTED.store(false, Ordering::SeqCst);
        }
        tauri::WindowEvent::Focused(true) if !SETTINGS_REQUESTED.load(Ordering::SeqCst) => {
            hide_at_os_level(&window_clone);
        }
        _ => {}
    });
}


/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    SETTINGS_REQUESTED.store(true, Ordering::SeqCst);
    let dashboard_window = match app.get_webview_window("dashboard") {
        Some(win) => win,
        None => create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?,
    };


    dashboard_window
        .show()
        .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
    let _ = dashboard_window.unminimize();
    dashboard_window
        .set_focus()
        .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    if is_stealth_enabled() {
        let _ = apply_stealth_to_window_with_mode(&dashboard_window, true, false);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_stealth_ex_style_overlay_enabled() {
        let base_style = 0isize;
        let style = calculate_stealth_ex_style(base_style, true, true);
        assert_ne!(style & WS_EX_TOOLWINDOW_VAL, 0, "Overlay must have WS_EX_TOOLWINDOW");
        assert_ne!(style & WS_EX_NOACTIVATE_VAL, 0, "Overlay must have WS_EX_NOACTIVATE");
        assert_eq!(style & WS_EX_APPWINDOW_VAL, 0, "Overlay must not have WS_EX_APPWINDOW");
    }

    #[test]
    fn test_calculate_stealth_ex_style_aux_window_enabled() {
        let base_style = WS_EX_APPWINDOW_VAL;
        let style = calculate_stealth_ex_style(base_style, true, false);
        assert_ne!(style & WS_EX_TOOLWINDOW_VAL, 0, "Aux window must have WS_EX_TOOLWINDOW (hide from Alt-Tab)");
        assert_eq!(style & WS_EX_APPWINDOW_VAL, 0, "Aux window must strip WS_EX_APPWINDOW (hide from taskbar)");
        assert_eq!(style & WS_EX_NOACTIVATE_VAL, 0, "Aux window must NOT have WS_EX_NOACTIVATE (must remain clickable/interactive)");
    }

    #[test]
    fn test_calculate_stealth_ex_style_aux_window_disabled() {
        let stealth_style = WS_EX_TOOLWINDOW_VAL;
        let style = calculate_stealth_ex_style(stealth_style, false, false);
        assert_eq!(style & WS_EX_TOOLWINDOW_VAL, 0, "Disabled stealth must restore WS_EX_TOOLWINDOW for aux window");
        assert_eq!(style & WS_EX_NOACTIVATE_VAL, 0, "Disabled stealth must not have WS_EX_NOACTIVATE for aux window");
    }

    #[test]
    fn test_calculate_stealth_ex_style_overlay_disabled() {
        let base_style = 0isize;
        let style = calculate_stealth_ex_style(base_style, false, true);
        assert_ne!(style & WS_EX_TOOLWINDOW_VAL, 0, "Overlay retains toolwindow even with stealth off");
        assert_ne!(style & WS_EX_NOACTIVATE_VAL, 0, "Overlay retains noactivate even with stealth off");
    }

    #[test]
    fn test_is_stealth_enabled_tracks_state() {
        STEALTH_MODE_ENABLED.store(false, Ordering::SeqCst);
        assert!(!is_stealth_enabled());

        STEALTH_MODE_ENABLED.store(true, Ordering::SeqCst);
        assert!(is_stealth_enabled());

        STEALTH_MODE_ENABLED.store(false, Ordering::SeqCst);
        assert!(!is_stealth_enabled());
    }
}
