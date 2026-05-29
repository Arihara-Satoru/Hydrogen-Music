use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

mod backend;
mod tray;
mod shortcuts;

/// 全局快捷键注册表：Shortcut → (事件名, 事件负载)
static SHORTCUT_REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, (String, Option<serde_json::Value>)>>> =
    std::sync::OnceLock::new();

fn shortcut_registry() -> &'static Mutex<HashMap<String, (String, Option<serde_json::Value>)>> {
    SHORTCUT_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

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

#[derive(serde::Serialize, serde::Deserialize)]
struct DockMenuSong {
    name: String,
    artist: String,
}

// ═══════════════════════════════════════════════════════════════
// Dock 菜单命令（macOS）
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
fn update_dock_menu(_app: tauri::AppHandle, _song: Option<DockMenuSong>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};

        let app = &_app;
        let mut builder = MenuBuilder::new(app);

        if let Some(ref s) = _song {
            let song_item = MenuItemBuilder::with_id("song_info", &format!("{} - {}", s.name, s.artist))
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?;
            builder = builder.item(&song_item);
            builder = builder.item(&PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?);
        }

        let play_pause = MenuItemBuilder::with_id("dock_play_pause", "播放/暂停")
            .build(app)
            .map_err(|e| e.to_string())?;
        let prev = MenuItemBuilder::with_id("dock_prev", "上一首")
            .build(app)
            .map_err(|e| e.to_string())?;
        let next = MenuItemBuilder::with_id("dock_next", "下一首")
            .build(app)
            .map_err(|e| e.to_string())?;

        builder = builder.item(&play_pause).item(&prev).item(&next);
        let menu = builder.build().map_err(|e| e.to_string())?;
        app.set_menu(menu).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_sidecar_url() -> String {
    backend::sidecar_url()
}

// ═══════════════════════════════════════════════════════════════
// 全局快捷键命令
// ═══════════════════════════════════════════════════════════════

#[tauri::command]
fn register_shortcuts(app: tauri::AppHandle, shortcuts: Vec<ShortcutConfig>) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();

    // 先注销所有已有的快捷键
    let _ = global_shortcut.unregister_all();
    let mut registry = shortcut_registry().lock().map_err(|e| e.to_string())?;
    registry.clear();
    drop(registry);

    for sc in &shortcuts {
        // 收集需要注册的快捷键字符串（shortcut + global_shortcut）
        let keys_to_register: Vec<&str> = [
            sc.shortcut.as_deref(),
            sc.global_shortcut.as_deref(),
        ]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .collect();

        let id = sc.id.clone();
        let event_name = shortcuts::shortcut_id_to_event(&id).to_string();
        let payload = shortcuts::shortcut_id_to_payload(&id);

        for shortcut_str in keys_to_register {
            // 解析快捷键字符串
            let (modifiers, code) = match shortcuts::parse_electron_shortcut(shortcut_str) {
                Some(v) => v,
                None => {
                    eprintln!("[shortcuts] Failed to parse: {}", shortcut_str);
                    continue;
                }
            };

            let combined = modifiers.iter().fold(Modifiers::empty(), |acc, m| acc | *m);
            let shortcut = Shortcut::new(Some(combined), code);

            // 注册快捷键
            match global_shortcut.register(shortcut) {
                Ok(()) => {
                    // 存入注册表
                    let mut registry = shortcut_registry().lock().map_err(|e| e.to_string())?;
                    registry.insert(shortcut_str.to_string(), (event_name.clone(), payload.clone()));
                    println!("[shortcuts] Registered: {} → {} ({})", shortcut_str, event_name, id);
                }
                Err(e) => {
                    eprintln!("[shortcuts] Failed to register {}: {}", shortcut_str, e);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn unregister_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    let mut registry = shortcut_registry().lock().map_err(|e| e.to_string())?;
    registry.clear();
    Ok(())
}

#[derive(serde::Deserialize)]
#[allow(dead_code)]
struct ShortcutConfig {
    id: String,
    name: String,
    #[serde(default)]
    shortcut: Option<String>,
    #[serde(default)]
    global_shortcut: Option<String>,
    #[serde(default)]
    r#type: bool,
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // 查找快捷键对应的注册事件
                    let shortcut_str = shortcut_to_string(shortcut);
                    if event.state == ShortcutState::Pressed {
                        if let Ok(registry) = shortcut_registry().lock() {
                            if let Some((event_name, payload)) = registry.get(shortcut_str.as_str()) {
                                if let Some(p) = payload {
                                    let _ = app.emit(event_name, p.clone());
                                } else {
                                    let _ = app.emit(event_name, ());
                                }
                            }
                        }
                    }
                })
                .build(),
        )
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

            // ── 创建系统托盘 ──
            if let Err(e) = tray::create_tray(app.handle()) {
                eprintln!("[tray] Failed to create tray: {}", e);
            }

            // ── 启动 sidecar 进程（文件 I/O + KuGou API） ──
            let sidecar_state: std::sync::Mutex<backend::SidecarState> = Mutex::new(backend::SidecarState::new());
            app.manage(sidecar_state);

            let sidecar_handle = app.state::<Mutex<backend::SidecarState>>();
            match backend::start_sidecar() {
                Ok(child) => {
                    if let Ok(mut guard) = sidecar_handle.lock() {
                        guard.process = Some(child);
                    }
                    // 等待 sidecar 就绪（最长 15 秒）
                    let ready = backend::wait_for_sidecar(15000);
                    if ready {
                        println!("[backend] Sidecar ready on {}", backend::sidecar_url());
                    } else {
                        eprintln!("[backend] Sidecar did not become ready within timeout");
                    }
                }
                Err(e) => {
                    eprintln!("[backend] Failed to start sidecar: {}", e);
                }
            }

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
            register_shortcuts,
            unregister_shortcuts,
            update_dock_menu,
            get_sidecar_url,
        ]);

    let builder = builder.on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let label = window.label().to_string();
            if label == "main" {
                window.hide().ok();
                api.prevent_close();
            } else if label == "lyric" {
                let _ = window.emit("desktop-lyric-closed", ());
            }
        } else if let tauri::WindowEvent::Destroyed = event {
            // 窗口销毁时停止 sidecar
            if window.label() == "main" {
                if let Some(state) = window.try_state::<Mutex<backend::SidecarState>>() {
                    backend::stop_sidecar(&state);
                }
            }
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 将 Shortcut 转换为可读字符串，用于注册表查找
fn shortcut_to_string(shortcut: &Shortcut) -> String {
    let mut parts = Vec::new();
    let m = shortcut.mods;
    if m.contains(Modifiers::CONTROL) {
        parts.push("CommandOrControl");
    }
    if m.contains(Modifiers::ALT) {
        parts.push("Alt");
    }
    if m.contains(Modifiers::SHIFT) {
        parts.push("Shift");
    }
    if m.contains(Modifiers::SUPER) {
        parts.push("Super");
    }

    let code_str = code_to_string(shortcut.key);
    parts.push(&code_str);
    parts.join("+")
}

fn code_to_string(code: Code) -> String {
    match code {
        Code::KeyA => "A".into(),
        Code::KeyB => "B".into(),
        Code::KeyC => "C".into(),
        Code::KeyD => "D".into(),
        Code::KeyE => "E".into(),
        Code::KeyF => "F".into(),
        Code::KeyG => "G".into(),
        Code::KeyH => "H".into(),
        Code::KeyI => "I".into(),
        Code::KeyJ => "J".into(),
        Code::KeyK => "K".into(),
        Code::KeyL => "L".into(),
        Code::KeyM => "M".into(),
        Code::KeyN => "N".into(),
        Code::KeyO => "O".into(),
        Code::KeyP => "P".into(),
        Code::KeyQ => "Q".into(),
        Code::KeyR => "R".into(),
        Code::KeyS => "S".into(),
        Code::KeyT => "T".into(),
        Code::KeyU => "U".into(),
        Code::KeyV => "V".into(),
        Code::KeyW => "W".into(),
        Code::KeyX => "X".into(),
        Code::KeyY => "Y".into(),
        Code::KeyZ => "Z".into(),
        Code::Digit0 => "0".into(),
        Code::Digit1 => "1".into(),
        Code::Digit2 => "2".into(),
        Code::Digit3 => "3".into(),
        Code::Digit4 => "4".into(),
        Code::Digit5 => "5".into(),
        Code::Digit6 => "6".into(),
        Code::Digit7 => "7".into(),
        Code::Digit8 => "8".into(),
        Code::Digit9 => "9".into(),
        Code::ArrowLeft => "Left".into(),
        Code::ArrowRight => "Right".into(),
        Code::ArrowUp => "Up".into(),
        Code::ArrowDown => "Down".into(),
        Code::BracketRight => "]".into(),
        Code::BracketLeft => "[".into(),
        Code::Space => "Space".into(),
        Code::Enter => "Enter".into(),
        Code::Escape => "Escape".into(),
        Code::Tab => "Tab".into(),
        Code::F1 => "F1".into(),
        Code::F2 => "F2".into(),
        Code::F3 => "F3".into(),
        Code::F4 => "F4".into(),
        Code::F5 => "F5".into(),
        Code::F6 => "F6".into(),
        Code::F7 => "F7".into(),
        Code::F8 => "F8".into(),
        Code::F9 => "F9".into(),
        Code::F10 => "F10".into(),
        Code::F11 => "F11".into(),
        Code::F12 => "F12".into(),
        _ => "Unknown".into(),
    }
}
