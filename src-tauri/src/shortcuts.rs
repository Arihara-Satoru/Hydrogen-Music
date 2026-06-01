use tauri_plugin_global_shortcut::{Code, Modifiers};

/// 快捷键字符串 → Tauri Shortcut 解析
///
/// 支持的格式:
/// - `CommandOrControl+P` → CmdOrCtrl + KeyP
/// - `CommandOrControl+Alt+P` → CmdOrCtrl + Alt + KeyP
/// - `CommandOrControl+Left` → CmdOrCtrl + ArrowLeft
/// - `CommandOrControl+]` → CmdOrCtrl + BracketRight
/// - `CommandOrControl+[` → CmdOrCtrl + BracketLeft
/// - `CommandOrControl+Up` → CmdOrCtrl + ArrowUp
/// - `CommandOrControl+Down` → CmdOrCtrl + ArrowDown
pub fn parse_shortcut(shortcut_str: &str) -> Option<(Vec<Modifiers>, Code)> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();
    if parts.is_empty() {
        return None;
    }

    let mut modifiers = Vec::new();
    let key_part = parts[parts.len() - 1];

    for i in 0..parts.len() - 1 {
        match parts[i] {
            "CommandOrControl" | "CmdOrCtrl" | "Command" | "Control" => {
                modifiers.push(Modifiers::CONTROL);
                #[cfg(target_os = "macos")]
                modifiers.push(Modifiers::SUPER);
            }
            "Alt" | "Option" => {
                modifiers.push(Modifiers::ALT);
            }
            "Shift" => {
                modifiers.push(Modifiers::SHIFT);
            }
            "Super" | "Meta" | "Win" | "Cmd" => {
                modifiers.push(Modifiers::SUPER);
            }
            _ => {}
        }
    }

    // 去重 modifiers
    modifiers.sort();
    modifiers.dedup();

    let code = match key_part {
        // 字母键（单个大写字母）
        key if key.len() == 1 && key.chars().next().map_or(false, |c| c.is_ascii_uppercase()) => {
            match key.chars().next()? {
                'A' => Code::KeyA,
                'B' => Code::KeyB,
                'C' => Code::KeyC,
                'D' => Code::KeyD,
                'E' => Code::KeyE,
                'F' => Code::KeyF,
                'G' => Code::KeyG,
                'H' => Code::KeyH,
                'I' => Code::KeyI,
                'J' => Code::KeyJ,
                'K' => Code::KeyK,
                'L' => Code::KeyL,
                'M' => Code::KeyM,
                'N' => Code::KeyN,
                'O' => Code::KeyO,
                'P' => Code::KeyP,
                'Q' => Code::KeyQ,
                'R' => Code::KeyR,
                'S' => Code::KeyS,
                'T' => Code::KeyT,
                'U' => Code::KeyU,
                'V' => Code::KeyV,
                'W' => Code::KeyW,
                'X' => Code::KeyX,
                'Y' => Code::KeyY,
                'Z' => Code::KeyZ,
                _ => return None,
            }
        }
        // 数字键
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        // 功能键
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        // 方向键
        "Left" => Code::ArrowLeft,
        "Right" => Code::ArrowRight,
        "Up" => Code::ArrowUp,
        "Down" => Code::ArrowDown,
        // 符号键
        "]" => Code::BracketRight,
        "[" => Code::BracketLeft,
        "=" => Code::Equal,
        "-" => Code::Minus,
        ";" => Code::Semicolon,
        "'" => Code::Quote,
        "," => Code::Comma,
        "." => Code::Period,
        "/" => Code::Slash,
        "`" => Code::Backquote,
        "\\" => Code::Backslash,
        // 其他
        "Space" => Code::Space,
        "Enter" | "Return" => Code::Enter,
        "Tab" => Code::Tab,
        "Escape" | "Esc" => Code::Escape,
        "Backspace" => Code::Backspace,
        "Delete" => Code::Delete,
        "Home" => Code::Home,
        "End" => Code::End,
        "PageUp" => Code::PageUp,
        "PageDown" => Code::PageDown,
        "Insert" => Code::Insert,
        "Pause" => Code::Pause,
        "ScrollLock" => Code::ScrollLock,
        "CapsLock" => Code::CapsLock,
        "NumLock" => Code::NumLock,
        _ => return None,
    };

    Some((modifiers, code))
}

/// 快捷键 ID → 事件名映射
pub fn shortcut_id_to_event(id: &str) -> &'static str {
    match id {
        "play" => "music-playing-control",
        "last" => "music-song-control",
        "next" => "music-song-control",
        "volumeUp" => "music-volume-up",
        "volumeDown" => "music-volume-down",
        "processForward" => "music-process-control",
        "processBack" => "music-process-control",
        _ => "music-playing-control",
    }
}

/// 快捷键 ID → 事件负载
pub fn shortcut_id_to_payload(id: &str) -> Option<serde_json::Value> {
    match id {
        "play" => Some(serde_json::Value::Null),
        "last" => Some(serde_json::json!("last")),
        "next" => Some(serde_json::json!("next")),
        "volumeUp" => Some(serde_json::Value::Null),
        "volumeDown" => Some(serde_json::Value::Null),
        "processForward" => Some(serde_json::json!("forward")),
        "processBack" => Some(serde_json::json!("back")),
        _ => None,
    }
}


