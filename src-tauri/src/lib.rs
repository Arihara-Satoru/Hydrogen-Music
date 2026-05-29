use tauri::{
    Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};

/// KuGou API 后端进程句柄（后续 Phase 4 使用）
#[allow(dead_code)]
struct KugouBackend(std::process::Child);

// ═══════════════════════════════════════════════════════════════
// 窗口控制命令
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
fn window_min(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_max(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn window_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════
// 桌面歌词窗口命令
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
fn create_lyric_window(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("lyric").is_some() {
        return Ok(());
    }

    let lyric_window = WebviewWindowBuilder::new(
        &app,
        "lyric",
        WebviewUrl::App("desktop-lyric.html".into()),
    )
    .title("Hydrogen Music - 桌面歌词")
    .inner_size(500.0, 350.0)
    .min_inner_size(250.0, 100.0)
    .max_inner_size(500.0, 800.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    // macOS: 使用更高层级的置顶模式
    #[cfg(target_os = "macos")]
    {
        let _ = lyric_window.set_always_on_top(true);
    }

    // Windows: 窗口事件后持续保证置顶
    #[cfg(target_os = "windows")]
    {
        let wh = lyric_window.clone();
        lyric_window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(_) = event {
                let _ = wh.set_always_on_top(true);
            }
        });
        let wh2 = lyric_window.clone();
        lyric_window.once("tauri://created", move |_| {
            let _ = wh2.set_always_on_top(true);
        });
    }

    Ok(())
}

#[tauri::command]
fn close_lyric_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyric") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn is_lyric_window_visible(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(app
        .get_webview_window("lyric")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false))
}

#[tauri::command]
fn set_lyric_window_movable(app: tauri::AppHandle, movable: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("lyric") {
        let _ = window.set_resizable(movable);
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════
// 应用入口
// ═══════════════════════════════════════════════════════════════

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let main_window = app.get_webview_window("main").unwrap();

            // ── 平台特定窗口配置 ──
            #[cfg(target_os = "macos")]
            {
                main_window
                    .set_title_bar_style(tauri::TitleBarStyle::Overlay)
                    .ok();
            }

            #[cfg(target_os = "windows")]
            {
                main_window.set_decorations(false).ok();
            }

            // ── 监听窗口大小变化 → 通知前端最大化状态 ──
            let app_handle = app.handle().clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    if let Some(w) = app_handle.get_webview_window("main") {
                        if let Ok(maximized) = w.is_maximized() {
                            let _ = w.emit("window-maximized-changed", maximized);
                        }
                    }
                }
            });

            // ── 延迟显示窗口 ──
            let win = main_window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = win.show();
                let _ = win.set_focus();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_min,
            window_max,
            window_close,
            window_is_maximized,
            create_lyric_window,
            close_lyric_window,
            is_lyric_window_visible,
            set_lyric_window_movable,
        ]);

    // ── macOS: close 请求时隐藏而非退出 ──
    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            window.hide().ok();
            api.prevent_close();
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
