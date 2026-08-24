use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

#[derive(Clone, Copy)]
struct Constraints {
    min_width: u32,
    min_height: u32,
    max_width: u32,
    max_height: u32,
}

impl Default for Constraints {
    fn default() -> Self {
        Self {
            min_width: 520,
            min_height: 280,
            max_width: 1200,
            max_height: 640,
        }
    }
}

pub struct LyricWindowState(Mutex<Constraints>);

impl Default for LyricWindowState {
    fn default() -> Self {
        Self(Mutex::new(Constraints::default()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    success: bool,
    message: Option<String>,
    error: Option<String>,
}

impl CommandResult {
    fn success(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: Some(message.into()),
            error: None,
        }
    }

    fn error(error: impl Into<String>) -> Self {
        Self {
            success: false,
            message: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConstraints {
    min_width: u32,
    min_height: u32,
    max_width: u32,
    max_height: u32,
}

fn lyric_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("desktop-lyric")
        .ok_or_else(|| "desktop lyric window does not exist".to_owned())
}

fn bounds(window: &WebviewWindow, content: bool) -> Result<WindowBounds, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = if content {
        window.inner_position()
    } else {
        window.outer_position()
    }
    .map_err(|error| error.to_string())?
    .to_logical::<i32>(scale);
    let size = if content {
        window.inner_size()
    } else {
        window.outer_size()
    }
    .map_err(|error| error.to_string())?
    .to_logical::<u32>(scale);
    Ok(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn valid_size(width: u32, height: u32) -> bool {
    (120..=4096).contains(&width) && (80..=2160).contains(&height)
}

#[tauri::command]
pub fn create_lyric_window(app: tauri::AppHandle) -> CommandResult {
    if let Some(window) = app.get_webview_window("desktop-lyric") {
        let _ = window.show();
        let _ = window.set_focus();
        return CommandResult::success("桌面歌词窗口已显示");
    }
    let handle = app.clone();
    let result = WebviewWindowBuilder::new(
        &app,
        "desktop-lyric",
        WebviewUrl::App("desktop-lyric.html".into()),
    )
    .title("Hydrogen Music Lyrics")
    .inner_size(760.0, 360.0)
    .min_inner_size(520.0, 280.0)
    .max_inner_size(1200.0, 640.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .visible(true)
    .center()
    .build();
    match result {
        Ok(window) => {
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    let _ = handle.emit_to("main", "desktop-lyric-closed", ());
                }
            });
            CommandResult::success("桌面歌词窗口已创建")
        }
        Err(error) => CommandResult::error(error.to_string()),
    }
}

#[tauri::command]
pub fn close_lyric_window(app: tauri::AppHandle) -> CommandResult {
    match lyric_window(&app).and_then(|window| window.close().map_err(|error| error.to_string())) {
        Ok(()) => CommandResult::success("桌面歌词窗口已关闭"),
        Err(error) => CommandResult::error(error),
    }
}

#[tauri::command]
pub fn is_lyric_window_visible(app: tauri::AppHandle) -> bool {
    app.get_webview_window("desktop-lyric")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn update_lyric_data(window: WebviewWindow, data: Value) -> Result<(), String> {
    if window.label() != "main" || !data.is_object() {
        return Err("invalid lyric update source or payload".to_owned());
    }
    window
        .app_handle()
        .emit_to("desktop-lyric", "lyric-update", data)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn request_lyric_data(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "desktop-lyric" {
        return Err("invalid lyric data requester".to_owned());
    }
    window
        .app_handle()
        .emit_to("main", "get-current-lyric-data", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn seek_desktop_lyric(window: WebviewWindow, position: f64) -> CommandResult {
    if window.label() != "desktop-lyric" || !position.is_finite() || position < 0.0 {
        return CommandResult::error("播放位置无效");
    }
    match window
        .app_handle()
        .emit_to("main", "set-position", position)
    {
        Ok(()) => CommandResult::success("播放位置已更新"),
        Err(error) => CommandResult::error(error.to_string()),
    }
}

#[tauri::command]
pub fn control_desktop_lyric_playback(window: WebviewWindow, action: String) -> CommandResult {
    if window.label() != "desktop-lyric"
        || !matches!(action.as_str(), "previous" | "playpause" | "next")
    {
        return CommandResult::error("播放操作无效");
    }
    match window.app_handle().emit_to("main", &action, ()) {
        Ok(()) => CommandResult::success("播放操作已发送"),
        Err(error) => CommandResult::error(error.to_string()),
    }
}

#[tauri::command]
pub fn resize_lyric_window(app: tauri::AppHandle, width: u32, height: u32) -> CommandResult {
    if !valid_size(width, height) {
        return CommandResult::error("窗口尺寸无效");
    }
    match lyric_window(&app).and_then(|window| {
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())
    }) {
        Ok(()) => CommandResult::success("窗口尺寸已更新"),
        Err(error) => CommandResult::error(error),
    }
}

#[tauri::command]
pub fn get_lyric_window_bounds(app: tauri::AppHandle) -> Option<WindowBounds> {
    lyric_window(&app)
        .ok()
        .and_then(|window| bounds(&window, false).ok())
}

#[tauri::command]
pub fn get_lyric_window_content_bounds(app: tauri::AppHandle) -> Option<WindowBounds> {
    lyric_window(&app)
        .ok()
        .and_then(|window| bounds(&window, true).ok())
}

#[tauri::command]
pub fn move_lyric_window(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let window = lyric_window(&app)?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    if let (Some(width), Some(height)) = (width, height) {
        if !valid_size(width, height) {
            return Err("window size is invalid".to_owned());
        }
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_lyric_window_resizable(app: tauri::AppHandle, resizable: bool) -> Result<(), String> {
    lyric_window(&app)?
        .set_resizable(resizable)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_lyric_window_min_max(state: State<'_, LyricWindowState>) -> WindowConstraints {
    let value = state.0.lock().map(|value| *value).unwrap_or_default();
    WindowConstraints {
        min_width: value.min_width,
        min_height: value.min_height,
        max_width: value.max_width,
        max_height: value.max_height,
    }
}

#[tauri::command]
pub fn set_lyric_window_min_max(
    app: tauri::AppHandle,
    state: State<'_, LyricWindowState>,
    min_width: u32,
    min_height: u32,
    max_width: u32,
    max_height: u32,
) -> CommandResult {
    if !valid_size(min_width, min_height)
        || !valid_size(max_width, max_height)
        || min_width > max_width
        || min_height > max_height
    {
        return CommandResult::error("窗口尺寸无效");
    }
    let result = lyric_window(&app).and_then(|window| {
        window
            .set_max_size(Some(LogicalSize::new(max_width, max_height)))
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(min_width, min_height)))
            .map_err(|error| error.to_string())
    });
    match result {
        Ok(()) => {
            if let Ok(mut value) = state.0.lock() {
                *value = Constraints {
                    min_width,
                    min_height,
                    max_width,
                    max_height,
                };
            }
            CommandResult::success("窗口约束已更新")
        }
        Err(error) => CommandResult::error(error),
    }
}

#[tauri::command]
pub fn set_lyric_window_movable(_movable: bool) -> CommandResult {
    // ponytail: Tauri has no cross-platform movable toggle; the existing lyric UI already gates every manual drag while locked.
    CommandResult::success("窗口移动状态由歌词界面控制")
}

#[tauri::command]
pub fn notify_lyric_window_closed(app: tauri::AppHandle) -> Result<(), String> {
    app.emit_to("main", "desktop-lyric-closed", ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lyric_window_size_guard_rejects_dangerous_or_impossible_bounds() {
        assert!(valid_size(760, 360));
        assert!(!valid_size(0, 0));
        assert!(!valid_size(5000, 360));
    }
}
