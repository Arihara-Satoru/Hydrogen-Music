use tauri::{
    AppHandle, Emitter, Manager, Runtime,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use std::sync::Mutex;

use crate::backend;

/// 创建系统托盘
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error> {
    // 托盘菜单项
    let play_pause = MenuItemBuilder::with_id("play_pause", "播放/暂停")
        .build(app)?;
    let prev = MenuItemBuilder::with_id("prev", "上一首")
        .build(app)?;
    let next = MenuItemBuilder::with_id("next", "下一首")
        .build(app)?;
    let separator1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let show_hide = MenuItemBuilder::with_id("show_hide", "显示/隐藏")
        .build(app)?;
    let separator2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&play_pause)
        .item(&prev)
        .item(&next)
        .item(&separator1)
        .item(&show_hide)
        .item(&separator2)
        .item(&quit)
        .build()?;

    // 从 icons 目录加载托盘图标
    let icon = {
        let icon_bytes = include_bytes!("../icons/32x32.png");
        let img = image::load_from_memory(icon_bytes).ok();
        if let Some(img) = img {
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            tauri::image::Image::new_owned(rgba.into_raw(), w, h)
        } else {
            app.default_window_icon().cloned().unwrap_or_else(|| {
                // 极致 fallback: 1x1 透明像素
                tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
            })
        }
    };

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Hydrogen Music")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "play_pause" => {
                    let _ = app.emit("music-playing-control", ());
                }
                "prev" => {
                    let _ = app.emit("music-song-control", "last");
                }
                "next" => {
                    let _ = app.emit("music-song-control", "next");
                }
                "show_hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                "quit" => {
                    // 先尝试保存播放状态
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("player-save", ());
                    }
                    // 显式停止 sidecar 进程
                    if let Some(state) = app.try_state::<Mutex<crate::backend::SidecarState>>() {
                        backend::stop_sidecar(&state);
                    }
                    // 退出应用
                    #[cfg(not(target_os = "macos"))]
                    {
                        app.exit(0);
                    }
                    #[cfg(target_os = "macos")]
                    {
                        std::process::exit(0);
                    }
                }
                _ => {}
            }
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
