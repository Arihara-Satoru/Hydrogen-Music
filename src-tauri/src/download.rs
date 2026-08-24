use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{Picture, PictureType},
    prelude::Accessor,
    tag::{ItemKey, Tag},
};
use serde::Deserialize;
use serde_json::Value;
use tauri::{Emitter, Manager, State};

use super::{configured_music_roots, PersistentState};

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "ape",
];
const MAX_COVER_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArgs {
    url: String,
    name: String,
    #[serde(rename = "type")]
    extension: String,
    lyrics: Option<Value>,
    cover_url: Option<String>,
    artists: Option<Vec<String>>,
    album: Option<String>,
}

struct DownloadControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
}

pub struct DownloadState(Mutex<Option<Arc<DownloadControl>>>);

impl Default for DownloadState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn sanitize_file_name(name: &str) -> String {
    let mut sanitized = name
        .chars()
        .map(|character| {
            if character.is_control() || "\\/:*?\"<>|".contains(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(['.', ' '])
        .chars()
        .take(120)
        .collect::<String>();
    if sanitized.is_empty() {
        sanitized = "unknown".to_owned();
    }
    let reserved = sanitized.to_ascii_lowercase();
    if matches!(reserved.as_str(), "con" | "prn" | "aux" | "nul")
        || (reserved.len() == 4
            && (reserved.starts_with("com") || reserved.starts_with("lpt"))
            && reserved.as_bytes()[3].is_ascii_digit()
            && reserved.as_bytes()[3] != b'0')
    {
        sanitized.insert(0, '_');
    }
    sanitized
}

fn download_extension(extension: &str) -> &'static str {
    AUDIO_EXTENSIONS
        .iter()
        .copied()
        .find(|candidate| candidate.eq_ignore_ascii_case(extension.trim_start_matches('.')))
        .unwrap_or("mp3")
}

fn unique_file_path(directory: &Path, base_name: &str, extension: &str) -> PathBuf {
    let initial = directory.join(format!("{base_name}.{extension}"));
    if !initial.exists() {
        return initial;
    }
    (1..)
        .map(|suffix| directory.join(format!("{base_name} ({suffix}).{extension}")))
        .find(|candidate| !candidate.exists())
        .unwrap()
}

fn lyric_text(lyrics: Option<&Value>) -> String {
    let Some(lyrics) = lyrics else {
        return String::new();
    };
    // ponytail: keep translated/romanized streams as adjacent valid LRC rows; add timestamp grouping only if a player rejects duplicate tags.
    ["lrc", "tlyric", "romalrc"]
        .into_iter()
        .filter_map(|key| lyrics.get(key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn fetch_cover(client: &reqwest::blocking::Client, url: Option<&str>) -> Option<Picture> {
    let url = reqwest::Url::parse(url?).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let response = client.get(url).send().ok()?.error_for_status().ok()?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_COVER_BYTES)
    {
        return None;
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_COVER_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_COVER_BYTES {
        return None;
    }
    let mut picture = Picture::from_reader(&mut bytes.as_slice()).ok()?;
    picture.set_pic_type(PictureType::CoverFront);
    Some(picture)
}

fn write_metadata(path: &Path, args: &DownloadArgs, cover: Option<Picture>) -> Result<(), String> {
    let mut tagged = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    if tagged.primary_tag().is_none() {
        tagged.insert_tag(Tag::new(tagged.primary_tag_type()));
    }
    let tag = tagged
        .primary_tag_mut()
        .ok_or_else(|| "downloaded audio format has no writable primary tag".to_owned())?;
    tag.set_title(args.name.clone());
    if let Some(artists) = &args.artists {
        tag.set_artist(artists.join(" / "));
    }
    if let Some(album) = &args.album {
        tag.set_album(album.clone());
    }
    let lyrics = lyric_text(args.lyrics.as_ref());
    if !lyrics.is_empty() {
        tag.insert_text(ItemKey::UnsyncLyrics, lyrics);
    }
    if let Some(cover) = cover {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(cover);
    }
    tagged
        .save_to_path(path, WriteOptions::default())
        .map_err(|error| error.to_string())
}

fn run_download(
    app: &tauri::AppHandle,
    args: &DownloadArgs,
    destination: &Path,
    save_lyric_file: bool,
    control: &DownloadControl,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&args.url).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("download URL must use HTTP or HTTPS".to_owned());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| error.to_string())?;
    let total = response.content_length();
    let temporary = destination.with_extension(format!(
        "{}.{}.part",
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("audio"),
        uuid::Uuid::new_v4()
    ));
    let result = (|| {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let mut buffer = [0_u8; 64 * 1024];
        let mut received = 0_u64;
        loop {
            if control.cancelled.load(Ordering::Acquire) {
                return Err("download cancelled".to_owned());
            }
            while control.paused.load(Ordering::Acquire) {
                if control.cancelled.load(Ordering::Acquire) {
                    return Err("download cancelled".to_owned());
                }
                thread::sleep(Duration::from_millis(100));
            }
            let count = response
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            file.write_all(&buffer[..count])
                .map_err(|error| error.to_string())?;
            received += count as u64;
            let progress = total
                .filter(|total| *total > 0)
                .map(|total| ((received.saturating_mul(100) / total).min(100)) as u8)
                .unwrap_or(0);
            let _ = app.emit("download-progress", progress);
        }
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, destination).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return result;
    }

    let lyrics = lyric_text(args.lyrics.as_ref());
    if save_lyric_file && !lyrics.is_empty() {
        let lyric_path = destination.with_extension("lrc");
        if !lyric_path.exists() {
            if let Err(error) = fs::write(lyric_path, &lyrics) {
                eprintln!("failed to write downloaded lyric file: {error}");
            }
        }
    }
    let cover = fetch_cover(&client, args.cover_url.as_deref());
    if let Err(error) = write_metadata(destination, args, cover) {
        eprintln!("failed to write downloaded audio metadata: {error}");
    }
    let _ = app.emit("download-progress", 100_u8);
    Ok(())
}

#[tauri::command]
pub fn download_file(
    app: tauri::AppHandle,
    args: DownloadArgs,
    downloads: State<'_, DownloadState>,
    persistent: State<'_, PersistentState>,
) -> Result<(), String> {
    let (root, create_song_folder, save_lyric_file) = {
        let data = persistent
            .data
            .lock()
            .map_err(|_| "persistent state lock poisoned".to_owned())?;
        let root = configured_music_roots(data.settings.as_ref(), "downloaded")?
            .into_iter()
            .next()
            .ok_or_else(|| "download directory is not configured or does not exist".to_owned())?;
        let local = data
            .settings
            .as_ref()
            .and_then(|settings| settings.get("local"));
        (
            root,
            local
                .and_then(|local| local.get("downloadCreateSongFolder"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
            local
                .and_then(|local| local.get("downloadSaveLyricFile"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
    };
    let base_name = sanitize_file_name(&args.name);
    let directory = if create_song_folder {
        root.join(&base_name)
    } else {
        root.clone()
    };
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let directory = fs::canonicalize(directory).map_err(|error| error.to_string())?;
    if !directory.starts_with(&root) {
        return Err("download destination escaped the configured directory".to_owned());
    }
    let destination = unique_file_path(&directory, &base_name, download_extension(&args.extension));
    let control = Arc::new(DownloadControl {
        paused: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
    });
    {
        let mut current = downloads
            .0
            .lock()
            .map_err(|_| "download state lock poisoned".to_owned())?;
        if current.is_some() {
            return Err("another download is already active".to_owned());
        }
        *current = Some(control.clone());
    }

    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = run_download(&app, &args, &destination, save_lyric_file, &control) {
            eprintln!("download failed: {error}");
        }
        if let Ok(mut current) = app.state::<DownloadState>().0.lock() {
            if current
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, &control))
            {
                *current = None;
            }
        }
        let _ = app.emit("download-next", ());
    });
    Ok(())
}

#[tauri::command]
pub fn pause_download(close: Option<String>, state: State<'_, DownloadState>) -> bool {
    state
        .0
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .is_some_and(|control| {
            if close.as_deref() == Some("shutdown") {
                control.cancelled.store(true, Ordering::Release);
            } else {
                control.paused.store(true, Ordering::Release);
            }
            true
        })
}

#[tauri::command]
pub fn resume_download(state: State<'_, DownloadState>) -> bool {
    state
        .0
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .is_some_and(|control| {
            control.paused.store(false, Ordering::Release);
            true
        })
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>) -> bool {
    state
        .0
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .is_some_and(|control| {
            control.cancelled.store(true, Ordering::Release);
            true
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_paths_are_sanitized_and_never_overwrite() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-download-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        assert_eq!(sanitize_file_name("CON"), "_CON");
        assert_eq!(sanitize_file_name(" bad:/name. "), "bad name");
        let first = unique_file_path(&directory, "track", "mp3");
        fs::write(&first, b"existing").unwrap();
        assert_eq!(
            unique_file_path(&directory, "track", "mp3"),
            directory.join("track (1).mp3")
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
