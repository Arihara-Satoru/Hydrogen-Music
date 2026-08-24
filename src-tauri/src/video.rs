use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};

use super::{update_persisted_data, PersistentState};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "webm", "mov"];

#[derive(Deserialize)]
pub struct VideoLookup {
    id: Value,
    method: String,
}

#[derive(Deserialize)]
pub struct VideoDownloadRequest {
    url: String,
    option: Value,
}

pub struct VideoDownloadState(Mutex<Option<Arc<AtomicBool>>>);

impl Default for VideoDownloadState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn path_text(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        if let Some(path) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }
        if let Some(path) = value.strip_prefix(r"\\?\") {
            return path.to_owned();
        }
    }
    value
}

fn path_key(path: &Path) -> String {
    let value = path_text(path);
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(extension))
        })
}

fn describe(path: &Path) -> Value {
    serde_json::json!({
        "path": path_text(path),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
        "available": path.is_file()
    })
}

fn normalize_pool(paths: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .filter(|path| path.is_file() && is_video(path))
        .filter(|path| seen.insert(path_key(path)))
        .map(|path| path_text(&path))
        .collect()
}

fn pool_payload(paths: &[String]) -> Value {
    serde_json::json!({
        "videos": paths.iter().map(Path::new).map(describe).collect::<Vec<_>>()
    })
}

#[tauri::command]
pub fn get_music_video_pool(
    app: tauri::AppHandle,
    state: State<'_, PersistentState>,
) -> Result<Value, String> {
    let paths = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .local_video_pool
        .clone();
    for path in &paths {
        let _ = app.asset_protocol_scope().allow_file(path);
    }
    Ok(pool_payload(&paths))
}

#[tauri::command]
pub fn add_music_video_pool_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    state: State<'_, PersistentState>,
) -> Result<Value, String> {
    let selected = normalize_pool(paths);
    let previous = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .local_video_pool
        .clone();
    let next = normalize_pool(previous.clone().into_iter().chain(selected));
    let added_count = next.len().saturating_sub(previous.len());
    for path in &next {
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|error| error.to_string())?;
    }
    update_persisted_data(&state, |data| data.local_video_pool = next.clone())?;
    Ok(serde_json::json!({
        "canceled": false,
        "addedCount": added_count,
        "videos": next.iter().map(Path::new).map(describe).collect::<Vec<_>>()
    }))
}

#[tauri::command]
pub fn remove_music_video_pool_file(
    file_path: String,
    state: State<'_, PersistentState>,
) -> Result<Value, String> {
    let target = fs::canonicalize(file_path).ok().map(|path| path_key(&path));
    let mut next = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .local_video_pool
        .clone();
    next.retain(|path| {
        let key = fs::canonicalize(path).ok().map(|path| path_key(&path));
        key != target
    });
    update_persisted_data(&state, |data| data.local_video_pool = next.clone())?;
    Ok(pool_payload(&next))
}

#[tauri::command]
pub fn clear_music_video_pool(state: State<'_, PersistentState>) -> Result<Value, String> {
    update_persisted_data(&state, |data| data.local_video_pool.clear())?;
    Ok(serde_json::json!({ "videos": [] }))
}

fn matching_record(records: &[Value], id: &Value) -> Option<(usize, Value)> {
    records
        .iter()
        .enumerate()
        .find(|(_, record)| record.get("id") == Some(id))
        .map(|(index, record)| (index, record.clone()))
}

#[tauri::command]
pub fn music_video_is_exists(
    app: tauri::AppHandle,
    obj: VideoLookup,
    state: State<'_, PersistentState>,
) -> Result<Value, String> {
    let record = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .music_videos
        .iter()
        .enumerate()
        .find(|(_, record)| record.get("id") == Some(&obj.id))
        .map(|(index, record)| (index, record.clone()));
    let Some((index, record)) = record else {
        return Ok(Value::Bool(false));
    };
    if obj.method == "verify" {
        let Some(path) = record.get("path").and_then(Value::as_str) else {
            return Ok(Value::String("404".to_owned()));
        };
        if !Path::new(path).is_file() {
            return Ok(Value::String("404".to_owned()));
        }
        app.asset_protocol_scope()
            .allow_file(path)
            .map_err(|error| error.to_string())?;
    }
    Ok(serde_json::json!({ "data": record, "index": index }))
}

#[tauri::command]
pub fn delete_music_video(id: Value, state: State<'_, PersistentState>) -> Result<bool, String> {
    let current = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .music_videos
        .clone();
    let Some((index, _)) = matching_record(&current, &id) else {
        return Ok(false);
    };
    update_persisted_data(&state, |data| {
        data.music_videos.remove(index);
    })?;
    Ok(true)
}

fn video_directory(state: &PersistentState) -> Result<Option<PathBuf>, String> {
    let configured = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?
        .settings
        .as_ref()
        .and_then(|settings| settings.get("local"))
        .and_then(|local| local.get("videoFolder"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    let Some(directory) = configured else {
        return Ok(None);
    };
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    fs::canonicalize(directory)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub fn delete_cached_video_files(state: &PersistentState) -> Result<usize, String> {
    let Some(root) = video_directory(state)? else {
        return Ok(0);
    };
    let data = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?;
    let external = data
        .local_video_pool
        .iter()
        .filter_map(|path| fs::canonicalize(path).ok())
        .map(|path| path_key(&path))
        .collect::<HashSet<_>>();
    let cached = data
        .music_videos
        .iter()
        .filter_map(|record| record.get("path").and_then(Value::as_str))
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect::<Vec<_>>();
    drop(data);

    let mut deleted = 0;
    for path in cached {
        if path.starts_with(&root) && !external.contains(&path_key(&path)) && path.is_file() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

fn safe_segment(value: Option<&Value>, fallback: &str) -> String {
    let raw = value
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| Some(value.to_string()))
        })
        .unwrap_or_else(|| fallback.to_owned());
    let value = raw
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(64)
        .collect::<String>();
    if value.is_empty() {
        fallback.to_owned()
    } else {
        value
    }
}

fn download_video(
    app: &tauri::AppHandle,
    request: &VideoDownloadRequest,
    destination: &Path,
    cancel: &AtomicBool,
) -> Result<&'static str, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("video URL must use HTTP(S)".to_owned());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30 * 60))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client.get(url);
    if let Some(headers) = request.option.get("headers").and_then(Value::as_object) {
        for (name, value) in headers {
            let (Ok(name), Some(value)) = (
                reqwest::header::HeaderName::from_bytes(name.as_bytes()),
                value.as_str(),
            ) else {
                continue;
            };
            if let Ok(value) = reqwest::header::HeaderValue::from_str(value) {
                builder = builder.header(name, value);
            }
        }
    }
    let mut response = builder
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let total = response.content_length().unwrap_or_default();
    let temporary = destination.with_extension("part");
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    let mut downloaded = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_file(temporary);
            return Ok("cancel");
        }
        let count = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        file.write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        downloaded += count as u64;
        if total > 0 {
            let _ = app.emit(
                "download-video-progress",
                ((downloaded.saturating_mul(100) / total).min(100)) as u8,
            );
        }
    }
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(temporary, destination).map_err(|error| error.to_string())?;
    Ok("success")
}

#[tauri::command]
pub async fn get_bili_video(
    app: tauri::AppHandle,
    request: VideoDownloadRequest,
) -> Result<String, String> {
    let state = app.state::<PersistentState>();
    let Some(directory) = video_directory(&state)? else {
        return Ok("noSavePath".to_owned());
    };
    let params = request
        .option
        .get("params")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "video download parameters are missing".to_owned())?;
    let cid = safe_segment(params.get("cid"), "video");
    let quality = safe_segment(params.get("quality"), "default");
    let destination = directory.join(format!("{cid}_{quality}.mp4"));
    let control = Arc::new(AtomicBool::new(false));
    {
        let video_state = app.state::<VideoDownloadState>();
        let mut current = video_state
            .0
            .lock()
            .map_err(|_| "video download lock poisoned".to_owned())?;
        if let Some(previous) = current.replace(control.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
    }
    let run_app = app.clone();
    let run_destination = destination.clone();
    let result = if destination.is_file() {
        "success"
    } else {
        tauri::async_runtime::spawn_blocking(move || {
            download_video(&run_app, &request, &run_destination, &control)
        })
        .await
        .map_err(|error| error.to_string())??
    };
    if result != "success" {
        return Ok(result.to_owned());
    }
    app.asset_protocol_scope()
        .allow_file(&destination)
        .map_err(|error| error.to_string())?;
    let mut record = Value::Object(params);
    if let Some(record) = record.as_object_mut() {
        if let Some(timing) = record
            .get("timing")
            .and_then(Value::as_str)
            .and_then(|timing| serde_json::from_str(timing).ok())
        {
            record.insert("timing".to_owned(), timing);
        }
        record.insert("path".to_owned(), Value::String(path_text(&destination)));
    }
    update_persisted_data(&state, |data| {
        data.music_videos
            .retain(|current| current.get("id") != record.get("id"));
        data.music_videos.push(record);
    })?;
    Ok("success".to_owned())
}

#[tauri::command]
pub fn cancel_download_music_video(state: State<'_, VideoDownloadState>) -> Result<(), String> {
    if let Some(control) = state
        .0
        .lock()
        .map_err(|_| "video download lock poisoned".to_owned())?
        .as_ref()
    {
        control.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_unused_video(state: State<'_, PersistentState>) -> Result<Value, String> {
    let Some(directory) = video_directory(&state)? else {
        return Ok(Value::String("noSavePath".to_owned()));
    };
    let data = state
        .data
        .lock()
        .map_err(|_| "persistent state lock poisoned".to_owned())?;
    let referenced = data
        .music_videos
        .iter()
        .filter_map(|record| record.get("path").and_then(Value::as_str))
        .chain(data.local_video_pool.iter().map(String::as_str))
        .filter_map(|path| fs::canonicalize(path).ok())
        .map(|path| path_key(&path))
        .collect::<HashSet<_>>();
    drop(data);
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() && !referenced.contains(&path_key(&path)) {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(Value::Bool(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_normalization_rejects_non_video_and_deduplicates() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-video-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let video = directory.join("clip.MP4");
        let text = directory.join("clip.txt");
        fs::write(&video, b"video").unwrap();
        fs::write(&text, b"text").unwrap();
        let result = normalize_pool([path_text(&video), path_text(&video), path_text(&text)]);
        assert_eq!(result, vec![path_text(&video)]);
        fs::remove_dir_all(directory).unwrap();
    }
}
