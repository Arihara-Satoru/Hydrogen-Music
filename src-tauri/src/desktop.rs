use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{default_settings, PersistentState};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_player_action(app: &tauri::AppHandle, action: &str) {
    match action {
        "play" => {
            let _ = app.emit("music-playing-control", ());
        }
        "last" => {
            let _ = app.emit("music-song-control", "last");
        }
        "next" => {
            let _ = app.emit("music-song-control", "next");
        }
        "volumeUp" => {
            let _ = app.emit("music-volume-up", ());
        }
        "volumeDown" => {
            let _ = app.emit("music-volume-down", ());
        }
        "processForward" => {
            let _ = app.emit("music-process-control", "forward");
        }
        "processBack" => {
            let _ = app.emit("music-process-control", "back");
        }
        _ => {}
    }
}

pub fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "显示播放器", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "tray-play", "播放/暂停", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "tray-last", "上一首", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "tray-next", "下一首", true, None::<&str>)?;
    let modes = ["顺序播放", "列表循环", "单曲循环", "随机播放"]
        .into_iter()
        .enumerate()
        .map(|(index, label)| {
            MenuItem::with_id(app, format!("tray-mode-{index}"), label, true, None::<&str>)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mode_items = modes
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<_>)
        .collect::<Vec<_>>();
    let play_mode = Submenu::with_id_and_items(app, "tray-mode", "播放模式", true, &mode_items)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "tray-exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show, &play, &previous, &next, &play_mode, &separator, &exit,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Hydrogen Music")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => show_main_window(app),
            "tray-play" => emit_player_action(app, "play"),
            "tray-last" => emit_player_action(app, "last"),
            "tray-next" => emit_player_action(app, "next"),
            "tray-exit" => {
                let _ = app.emit("player-save", ());
            }
            id if id.starts_with("tray-mode-") => {
                if let Ok(mode) = id.trim_start_matches("tray-mode-").parse::<u8>() {
                    let _ = app.emit("music-playmode-control", mode);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn register_shortcuts_for_settings(
    app: &tauri::AppHandle,
    settings: &Value,
) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())?;
    let enabled = settings
        .get("other")
        .and_then(|other| other.get("globalShortcuts"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    if !enabled {
        return Ok(());
    }

    let mut errors = Vec::new();
    for shortcut in settings
        .get("shortcuts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(action) = shortcut.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(accelerator) = shortcut.get("globalShortcut").and_then(Value::as_str) else {
            continue;
        };
        let action = action.to_owned();
        if let Err(error) = app
            .global_shortcut()
            .on_shortcut(accelerator, move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    emit_player_action(app, &action);
                }
            })
        {
            errors.push(format!("{accelerator}: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to register shortcuts: {}",
            errors.join(", ")
        ))
    }
}

#[tauri::command]
pub fn register_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    let settings = app
        .state::<PersistentState>()
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .settings
        .clone()
        .unwrap_or_else(default_settings);
    register_shortcuts_for_settings(&app, &settings)
}

#[tauri::command]
pub fn unregister_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_actions_are_all_supported() {
        let settings = default_settings();
        let ids = settings["shortcuts"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|shortcut| shortcut["id"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            [
                "play",
                "last",
                "next",
                "volumeUp",
                "volumeDown",
                "processForward",
                "processBack"
            ]
        );
    }
}
