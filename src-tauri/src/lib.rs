use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

mod desktop;
mod download;
mod local_music;
mod lyric_window;
mod services;
mod video;

const API_ADDRESS: &str = "127.0.0.1:36530";
const API_HEALTH_PATH: &str = "/__hydrogen/health";
const API_HEALTH_TOKEN: &str = "hydrogen-kugou-api-v1";

#[derive(Clone, Debug, Serialize)]
struct DeviceIdentity {
    guid: String,
    dev: String,
    mid: String,
}

#[derive(Clone, Serialize)]
struct ApiStatus {
    ready: bool,
    error: Option<String>,
    device: DeviceIdentity,
}

struct ApiState {
    device: DeviceIdentity,
    startup_error: Mutex<Option<String>>,
}

struct SidecarProcess(Mutex<Option<CommandChild>>);

#[derive(Clone, Default, Deserialize, Serialize)]
struct PersistedData {
    settings: Option<Value>,
    playlist: Option<Value>,
    progress: Option<Value>,
    #[serde(default)]
    local_hash_tracks: serde_json::Map<String, Value>,
    #[serde(default)]
    music_videos: Vec<Value>,
    #[serde(default)]
    local_video_pool: Vec<String>,
}

struct PersistentState {
    path: PathBuf,
    data: Mutex<PersistedData>,
}

fn load_persisted_data(path: &Path) -> PersistedData {
    [path.to_path_buf(), path.with_extension("bak")]
        .into_iter()
        .find_map(|candidate| {
            fs::read(&candidate)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        })
        .unwrap_or_default()
}

fn save_persisted_data(path: &Path, data: &PersistedData) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid persistent state path".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    let backup = path.with_extension("bak");
    let bytes = serde_json::to_vec(data).map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;

    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

fn update_persisted_data(
    state: &PersistentState,
    update: impl FnOnce(&mut PersistedData),
) -> Result<(), String> {
    let mut current = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?;
    let mut next = current.clone();
    update(&mut next);
    save_persisted_data(&state.path, &next)?;
    *current = next;
    Ok(())
}

fn default_settings() -> Value {
    serde_json::json!({
        "_appVersion": env!("CARGO_PKG_VERSION"),
        "music": {
            "level": "high",
            "lyricSize": "20",
            "tlyricSize": "14",
            "rlyricSize": "12",
            "lyricInterlude": 13,
            "searchAssistLimit": 8,
            "showSongTranslation": true,
            "audioVisualizer": false,
            "loudnessNormalization": false,
            "autoPlayOnStartup": false,
            "pauseOnOtherAudio": false,
            "coverSize": 400
        },
        "local": {
            "videoFolder": null,
            "downloadFolder": null,
            "downloadCreateSongFolder": false,
            "downloadSaveLyricFile": false,
            "localFolder": []
        },
        "shortcuts": [
            { "id": "play", "name": "播放/暂停", "shortcut": "CommandOrControl+P", "globalShortcut": "CommandOrControl+Alt+P" },
            { "id": "last", "name": "上一首", "shortcut": "CommandOrControl+Left", "globalShortcut": "CommandOrControl+Alt+Left" },
            { "id": "next", "name": "下一首", "shortcut": "CommandOrControl+Right", "globalShortcut": "CommandOrControl+Alt+Right" },
            { "id": "volumeUp", "name": "增加音量", "shortcut": "CommandOrControl+Up", "globalShortcut": "CommandOrControl+Alt+Up" },
            { "id": "volumeDown", "name": "减少音量", "shortcut": "CommandOrControl+Down", "globalShortcut": "CommandOrControl+Alt+Down" },
            { "id": "processForward", "name": "快进(3s)", "shortcut": "CommandOrControl+]", "globalShortcut": "CommandOrControl+Alt+]" },
            { "id": "processBack", "name": "后退(3s)", "shortcut": "CommandOrControl+[", "globalShortcut": "CommandOrControl+Alt+[" }
        ],
        "other": {
            "globalShortcuts": true,
            "enableUpdate": true,
            "startupAnimation": "ark",
            "quitApp": "minimize",
            "customFont": "",
            "customFontLabel": ""
        }
    })
}

#[tauri::command]
fn get_settings(state: State<'_, PersistentState>) -> Result<Value, String> {
    state
        .data
        .lock()
        .map(|data| data.settings.clone().unwrap_or_else(default_settings))
        .map_err(|_| "persistent state lock poisoned".to_owned())
}

#[tauri::command]
fn set_settings(
    app: tauri::AppHandle,
    settings: String,
    state: State<'_, PersistentState>,
) -> Result<(), String> {
    if settings.len() > 1024 * 1024 {
        return Err("settings payload is too large".to_owned());
    }
    let settings: Value = serde_json::from_str(&settings).map_err(|error| error.to_string())?;
    if !settings.is_object() {
        return Err("settings payload must be an object".to_owned());
    }
    update_persisted_data(&state, |data| data.settings = Some(settings.clone()))?;
    if let Err(error) = desktop::register_shortcuts_for_settings(&app, &settings) {
        eprintln!("{error}");
    }
    Ok(())
}

fn close_or_hide(app: &tauri::AppHandle) -> Result<(), String> {
    let quit = app
        .state::<PersistentState>()
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .settings
        .as_ref()
        .and_then(|settings| settings.get("other"))
        .and_then(|other| other.get("quitApp"))
        .and_then(Value::as_str)
        == Some("quit");
    if quit {
        app.emit("player-save", ())
            .map_err(|error| error.to_string())
    } else if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|error| error.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn exit_app(
    app: tauri::AppHandle,
    playlist: String,
    state: State<'_, PersistentState>,
) -> Result<(), String> {
    if playlist.len() > 100 * 1024 * 1024 {
        return Err("playlist payload is too large".to_owned());
    }
    let playlist: Value = serde_json::from_str(&playlist).map_err(|error| error.to_string())?;
    if !playlist.is_object() {
        return Err("playlist payload must be an object".to_owned());
    }
    update_persisted_data(&state, |data| data.playlist = Some(playlist))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_last_playlist(state: State<'_, PersistentState>) -> Result<Option<Value>, String> {
    let data = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?;
    let Some(mut playlist) = data.playlist.clone() else {
        return Ok(None);
    };
    if let (Some(playlist), Some(progress)) = (playlist.as_object_mut(), data.progress.as_ref()) {
        for key in ["progress", "songId", "currentIndex", "updatedAt"] {
            if let Some(value) = progress.get(key) {
                playlist.insert(key.to_owned(), value.clone());
            }
        }
    }
    Ok(Some(playlist))
}

#[tauri::command]
fn save_last_playlist(playlist: String, state: State<'_, PersistentState>) -> Result<(), String> {
    if playlist.len() > 100 * 1024 * 1024 {
        return Err("playlist payload is too large".to_owned());
    }
    let playlist: Value = serde_json::from_str(&playlist).map_err(|error| error.to_string())?;
    if !playlist.is_object() {
        return Err("playlist payload must be an object".to_owned());
    }
    update_persisted_data(&state, |data| data.playlist = Some(playlist))
}

#[tauri::command]
fn save_last_playback_progress(
    progress_state: Value,
    state: State<'_, PersistentState>,
) -> Result<(), String> {
    if !progress_state.is_object() {
        return Err("playback progress must be an object".to_owned());
    }
    update_persisted_data(&state, |data| data.progress = Some(progress_state))
}

#[tauri::command]
fn clear_all_cache_data(state: State<'_, PersistentState>) -> Result<Value, String> {
    let deleted_music_video_files = video::delete_cached_video_files(&state)?;
    update_persisted_data(&state, |data| {
        data.playlist = None;
        data.progress = None;
        data.local_hash_tracks.clear();
        data.music_videos.clear();
        data.local_video_pool.clear();
    })?;
    Ok(serde_json::json!({
        "success": true,
        "deletedMusicVideoFiles": deleted_music_video_files
    }))
}

#[tauri::command]
fn reset_all_data(
    app: tauri::AppHandle,
    state: State<'_, PersistentState>,
) -> Result<Value, String> {
    update_persisted_data(&state, |data| *data = PersistedData::default())?;
    app.emit("reset-local-storage", ())
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[derive(Deserialize)]
struct ScanLocalMusicParams {
    #[serde(rename = "type")]
    scan_type: String,
}

fn configured_music_roots(
    settings: Option<&Value>,
    scan_type: &str,
) -> Result<Vec<PathBuf>, String> {
    let local = settings.and_then(|settings| settings.get("local"));
    let paths = match scan_type {
        "downloaded" => local
            .and_then(|local| local.get("downloadFolder"))
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .into_iter()
            .collect::<Vec<_>>(),
        "local" => local
            .and_then(|local| local.get("localFolder"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .collect(),
        _ => return Err("local music scan type must be `downloaded` or `local`".to_owned()),
    };

    Ok(paths
        .into_iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.is_dir())
        .collect())
}

fn authorized_music_file(state: &PersistentState, file_path: &str) -> Result<PathBuf, String> {
    if file_path.trim().is_empty() || file_path.len() > 32 * 1024 {
        return Err("invalid local music file path".to_owned());
    }
    let path = fs::canonicalize(file_path).map_err(|error| error.to_string())?;
    if !path.is_file() {
        return Err("local music path is not a file".to_owned());
    }
    let roots = {
        let data = state
            .data
            .lock()
            .map_err(|_| "persistent state lock poisoned".to_owned())?;
        let mut roots = configured_music_roots(data.settings.as_ref(), "downloaded")?;
        roots.extend(configured_music_roots(data.settings.as_ref(), "local")?);
        roots
    };
    roots
        .iter()
        .any(|root| path.starts_with(root))
        .then_some(path)
        .ok_or_else(|| "local music file is outside configured directories".to_owned())
}

#[tauri::command]
async fn scan_local_music(
    app: tauri::AppHandle,
    params: ScanLocalMusicParams,
) -> Result<local_music::ScanPayload, String> {
    let roots = {
        let state = app.state::<PersistentState>();
        let data = state
            .data
            .lock()
            .map_err(|_| "persistent state lock poisoned".to_owned())?;
        configured_music_roots(data.settings.as_ref(), &params.scan_type)?
    };

    for root in &roots {
        app.asset_protocol_scope()
            .allow_directory(root, true)
            .map_err(|error| error.to_string())?;
    }

    let scan_type = params.scan_type;
    tauri::async_runtime::spawn_blocking(move || local_music::scan_roots(roots, scan_type))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_local_music_file_hash(
    file_path: String,
    state: State<'_, PersistentState>,
) -> Result<String, String> {
    let path = authorized_music_file(&state, &file_path)?;
    tauri::async_runtime::spawn_blocking(move || local_music::hash_file(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn remember_local_music_hash_track(
    hash: String,
    song: Value,
    state: State<'_, PersistentState>,
) -> Result<bool, String> {
    let hash = hash.trim().to_ascii_uppercase();
    if hash.len() != 32 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) || !song.is_object() {
        return Ok(false);
    }
    let file_path = song
        .get("common")
        .and_then(|common| common.get("fileUrl"))
        .or_else(|| song.get("url"))
        .or_else(|| song.get("dirPath"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    authorized_music_file(&state, file_path)?;
    if serde_json::to_vec(&song)
        .map_err(|error| error.to_string())?
        .len()
        > 1024 * 1024
    {
        return Err("local music track payload is too large".to_owned());
    }
    update_persisted_data(&state, |data| {
        data.local_hash_tracks.insert(hash, song);
    })?;
    Ok(true)
}

#[tauri::command]
fn get_local_music_hash_tracks(state: State<'_, PersistentState>) -> Result<Value, String> {
    state
        .data
        .lock()
        .map(|data| Value::Object(data.local_hash_tracks.clone()))
        .map_err(|_| "persistent state lock poisoned".to_owned())
}

#[tauri::command]
async fn get_local_music_image(
    file_path: String,
    state: State<'_, PersistentState>,
) -> Result<String, String> {
    let path = authorized_music_file(&state, &file_path)?;
    tauri::async_runtime::spawn_blocking(move || local_music::read_cover(&path))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_local_music_lyric(
    file_path: String,
    state: State<'_, PersistentState>,
) -> Result<Option<local_music::LyricPayload>, String> {
    let path = authorized_music_file(&state, &file_path)?;
    tauri::async_runtime::spawn_blocking(move || local_music::read_lyric(&path))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
struct SidecarJob(isize);

#[cfg(windows)]
impl Drop for SidecarJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        unsafe {
            CloseHandle(self.0 as _);
        }
    }
}

#[cfg(windows)]
fn keep_sidecar_bound_to_app(process_id: u32) -> Result<SidecarJob, String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error().to_string();
            CloseHandle(job);
            return Err(error);
        }

        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, process_id);
        if process.is_null() {
            let error = std::io::Error::last_os_error().to_string();
            CloseHandle(job);
            return Err(error);
        }
        let assigned = AssignProcessToJobObject(job, process);
        CloseHandle(process);
        if assigned == 0 {
            let error = std::io::Error::last_os_error().to_string();
            CloseHandle(job);
            return Err(error);
        }
        Ok(SidecarJob(job as isize))
    }
}

fn parse_device(text: &str) -> Option<DeviceIdentity> {
    let mut lines = text.lines();
    let guid = lines.next()?.trim();
    let dev = lines.next()?.trim();
    if guid.len() != 32 || !guid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    if dev.is_empty()
        || dev.len() > 32
        || !dev
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return None;
    }

    let guid = guid.to_ascii_lowercase();
    let digest = md5::compute(&guid);
    Some(DeviceIdentity {
        mid: u128::from_be_bytes(digest.0).to_string(),
        guid,
        dev: dev.to_ascii_uppercase(),
    })
}

fn load_or_create_device(path: &Path) -> Result<DeviceIdentity, String> {
    if let Ok(text) = fs::read_to_string(path) {
        if let Some(device) = parse_device(&text) {
            return Ok(device);
        }
    }

    let guid = uuid::Uuid::new_v4().simple().to_string();
    let device = parse_device(&format!("{guid}\nHYDRO{}\n", &guid[..5]))
        .ok_or_else(|| "failed to create KuGou device identity".to_owned())?;
    let parent = path
        .parent()
        .ok_or_else(|| "invalid KuGou device identity path".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, format!("{}\n{}\n", device.guid, device.dev))
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(device)
}

fn probe_api() -> Result<(), String> {
    let address = API_ADDRESS
        .parse::<SocketAddr>()
        .map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(300))
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|error| error.to_string())?;
    stream
        .write_all(
            format!(
        "GET {API_HEALTH_PATH} HTTP/1.1\r\nHost: {API_ADDRESS}\r\nConnection: close\r\n\r\n"
      )
            .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 200") && response.contains(API_HEALTH_TOKEN) {
        Ok(())
    } else {
        Err("unexpected KuGou API health response".to_owned())
    }
}

fn wait_for_api(timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = "KuGou API did not start".to_owned();
    while Instant::now() < deadline {
        match probe_api() {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(last_error)
}

#[tauri::command]
async fn wait_for_kugou_api_ready(app: tauri::AppHandle) -> ApiStatus {
    let state = app.state::<ApiState>();
    let device = state.device.clone();
    if let Some(error) = state
        .startup_error
        .lock()
        .ok()
        .and_then(|value| value.clone())
    {
        return ApiStatus {
            ready: false,
            error: Some(error),
            device,
        };
    }
    drop(state);

    let result =
        tauri::async_runtime::spawn_blocking(|| wait_for_api(Duration::from_secs(12))).await;
    match result {
        Ok(Ok(())) => ApiStatus {
            ready: true,
            error: None,
            device,
        },
        Ok(Err(error)) => ApiStatus {
            ready: false,
            error: Some(error),
            device,
        },
        Err(error) => ApiStatus {
            ready: false,
            error: Some(error.to_string()),
            device,
        },
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            wait_for_kugou_api_ready,
            exit_app,
            get_settings,
            set_settings,
            get_last_playlist,
            save_last_playlist,
            save_last_playback_progress,
            clear_all_cache_data,
            reset_all_data,
            scan_local_music,
            get_local_music_file_hash,
            remember_local_music_hash_track,
            get_local_music_hash_tracks,
            get_local_music_image,
            get_local_music_lyric,
            services::get_request_data,
            services::get_cloud_music_metadata,
            video::get_music_video_pool,
            video::add_music_video_pool_files,
            video::remove_music_video_pool_file,
            video::clear_music_video_pool,
            video::music_video_is_exists,
            video::delete_music_video,
            video::get_bili_video,
            video::cancel_download_music_video,
            video::clear_unused_video,
            download::download_file,
            download::pause_download,
            download::resume_download,
            download::cancel_download,
            desktop::register_shortcuts,
            desktop::unregister_shortcuts,
            lyric_window::create_lyric_window,
            lyric_window::close_lyric_window,
            lyric_window::is_lyric_window_visible,
            lyric_window::update_lyric_data,
            lyric_window::request_lyric_data,
            lyric_window::seek_desktop_lyric,
            lyric_window::control_desktop_lyric_playback,
            lyric_window::resize_lyric_window,
            lyric_window::get_lyric_window_bounds,
            lyric_window::get_lyric_window_content_bounds,
            lyric_window::move_lyric_window,
            lyric_window::set_lyric_window_resizable,
            lyric_window::get_lyric_window_min_max,
            lyric_window::set_lyric_window_min_max,
            lyric_window::set_lyric_window_movable,
            lyric_window::notify_lyric_window_closed
        ])
        .setup(|app| {
            let device_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("kugou-device");
            let persistent_path = device_path.with_file_name("state.json");
            let device = load_or_create_device(&device_path)?;
            app.manage(ApiState {
                device: device.clone(),
                startup_error: Mutex::new(None),
            });
            app.manage(PersistentState {
                data: Mutex::new(load_persisted_data(&persistent_path)),
                path: persistent_path,
            });
            app.manage(download::DownloadState::default());
            app.manage(video::VideoDownloadState::default());
            app.manage(lyric_window::LyricWindowState::default());
            desktop::install_tray(app)?;
            if let Err(error) = desktop::register_shortcuts(app.handle().clone()) {
                eprintln!("{error}");
            }

            let command = app
                .shell()
                .sidecar("kugoumusicapi")?
                .env("HOST", "127.0.0.1")
                .env("PORT", "36530")
                .env("platform", "lite")
                .env("KUGOU_API_GUID", &device.guid)
                .env("KUGOU_API_DEV", &device.dev)
                .env("KUGOU_API_HEALTH_TOKEN", API_HEALTH_TOKEN)
                .env("KUGOU_API_HEALTH_PATH", API_HEALTH_PATH);
            let (mut events, child) = command.spawn()?;
            #[cfg(windows)]
            app.manage(keep_sidecar_bound_to_app(child.pid())?);
            app.manage(SidecarProcess(Mutex::new(Some(child))));

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[KuGou API] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[KuGou API] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(error) => {
                            if let Ok(mut value) = handle.state::<ApiState>().startup_error.lock() {
                                *value = Some(error);
                            }
                        }
                        CommandEvent::Terminated(status) if status.code != Some(0) => {
                            if let Ok(mut value) = handle.state::<ApiState>().startup_error.lock() {
                                *value =
                                    Some(format!("KuGou API exited with code {:?}", status.code));
                            }
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = close_or_hide(window.app_handle()) {
                    eprintln!("failed to close or hide the main window: {error}");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(process) = handle.try_state::<SidecarProcess>() {
                let child = process.0.lock().ok().and_then(|mut child| child.take());
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_parser_validates_and_normalizes_identity() {
        let device = parse_device("0123456789abcdef0123456789ABCDEF\nhydro_1\n").unwrap();
        assert_eq!(device.guid, "0123456789abcdef0123456789abcdef");
        assert_eq!(device.dev, "HYDRO_1");
        assert!(parse_device("not-a-guid\nHYDRO1\n").is_none());
        assert!(parse_device("0123456789abcdef0123456789abcdef\nbad name\n").is_none());
    }

    #[test]
    fn persistent_state_replaces_data_without_losing_the_previous_snapshot() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-state-{}", uuid::Uuid::new_v4()));
        let path = directory.join("state.json");
        let first = PersistedData {
            settings: Some(serde_json::json!({ "music": { "level": "high" } })),
            ..PersistedData::default()
        };
        save_persisted_data(&path, &first).unwrap();
        assert_eq!(load_persisted_data(&path).settings, first.settings);

        let second = PersistedData {
            playlist: Some(serde_json::json!({ "songList": [1, 2, 3] })),
            ..first
        };
        save_persisted_data(&path, &second).unwrap();
        assert_eq!(load_persisted_data(&path).playlist, second.playlist);
        assert!(!path.with_extension("bak").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_music_roots_come_only_from_the_selected_settings_group() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-roots-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let settings = serde_json::json!({
            "local": {
                "downloadFolder": directory,
                "localFolder": [directory]
            }
        });

        assert_eq!(
            configured_music_roots(Some(&settings), "downloaded")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            configured_music_roots(Some(&settings), "local")
                .unwrap()
                .len(),
            1
        );
        assert!(configured_music_roots(Some(&settings), "other").is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
