use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    prelude::Accessor,
    tag::ItemKey,
};
use serde::Serialize;

const MUSIC_EXTENSIONS: &[&str] = &[
    "aiff", "aac", "ape", "asf", "bwf", "dsdiff", "dsf", "flac", "mp2", "mka", "mp3", "mpc", "mp4",
    "ogg", "opus", "speex", "theora", "vorbis", "wav", "webm", "wv", "wma", "m4a",
];
const MAX_COVER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_LYRIC_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(untagged)]
pub enum MusicNode {
    Folder(FolderNode),
    Track(TrackNode),
}

#[derive(Clone, Serialize)]
pub struct FolderNode {
    name: String,
    children: Vec<MusicNode>,
    #[serde(rename = "type")]
    node_type: &'static str,
    #[serde(rename = "dirPath")]
    dir_path: String,
}

#[derive(Clone, Serialize)]
pub struct TrackNode {
    id: String,
    name: String,
    #[serde(rename = "dirPath")]
    dir_path: String,
    common: TrackCommon,
    format: TrackFormat,
}

#[derive(Clone, Default, Serialize)]
struct TrackCommon {
    #[serde(rename = "localTitle")]
    local_title: String,
    #[serde(rename = "fileUrl")]
    file_url: String,
    title: String,
    artists: Vec<String>,
    album: String,
    albumartist: String,
    date: String,
    genre: Vec<String>,
    year: Option<u32>,
}

#[derive(Clone, Default, Serialize)]
struct TrackFormat {
    bitrate: u32,
    #[serde(rename = "bitsPerSample")]
    bits_per_sample: u8,
    container: String,
    duration: f64,
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPayload {
    pub dir_tree: Vec<FolderNode>,
    #[serde(rename = "locaFilesMetadata")]
    pub metadata: Vec<FolderNode>,
    #[serde(rename = "type")]
    pub scan_type: String,
    pub count: usize,
}

#[derive(Serialize)]
pub struct LyricPayload {
    lrc: LyricText,
}

#[derive(Serialize)]
struct LyricText {
    lyric: String,
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn folder(name: String, path: &Path) -> FolderNode {
    FolderNode {
        name,
        children: Vec::new(),
        node_type: "folder",
        dir_path: path_text(path),
    }
}

fn is_music_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MUSIC_EXTENSIONS
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(extension))
        })
}

fn split_artists(value: &str) -> Vec<String> {
    value
        .split([',', '，', '/', '|'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn read_track(path: &Path) -> TrackNode {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    let local_title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();
    let container = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let file_url = path_text(path);
    let mut common = TrackCommon {
        local_title: local_title.clone(),
        file_url: file_url.clone(),
        title: local_title,
        ..TrackCommon::default()
    };
    let mut format = TrackFormat {
        container,
        ..TrackFormat::default()
    };

    if let Ok(tagged) = lofty::read_from_path(path) {
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            common.title = tag
                .title()
                .map(|value| value.into_owned())
                .unwrap_or(common.title);
            common.artists = tag
                .artist()
                .map(|value| split_artists(&value))
                .unwrap_or_default();
            common.album = tag
                .album()
                .map(|value| value.into_owned())
                .unwrap_or_default();
            common.albumartist = tag
                .get_string(ItemKey::AlbumArtist)
                .unwrap_or_default()
                .to_owned();
            common.genre = tag
                .genre()
                .map(|value| split_artists(&value))
                .unwrap_or_default();
            if let Some(date) = tag.date() {
                common.year = Some(u32::from(date.year));
                common.date = date.to_string();
            }
        }
        let properties = tagged.properties();
        format.bitrate = properties
            .audio_bitrate()
            .unwrap_or_default()
            .saturating_mul(1000);
        format.bits_per_sample = properties.bit_depth().unwrap_or_default();
        format.duration = properties.duration().as_secs_f64();
        format.sample_rate = properties.sample_rate().unwrap_or_default();
    }

    TrackNode {
        id: uuid::Uuid::new_v4().to_string(),
        name: file_name,
        dir_path: file_url,
        common,
        format,
    }
}

pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut context = md5::Context::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        context.consume(&buffer[..count]);
    }
    Ok(format!("{:X}", context.finalize()))
}

fn image_mime(bytes: &[u8], path: Option<&Path>) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if path
        .and_then(Path::extension)
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
    {
        "image/png"
    } else {
        "image/jpeg"
    }
}

fn image_data_url(bytes: &[u8], mime: &str) -> Option<String> {
    (bytes.len() as u64 <= MAX_COVER_BYTES)
        .then(|| format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

pub fn read_cover(path: &Path) -> String {
    if let Ok(tagged) = lofty::read_from_path(path) {
        if let Some(picture) = tagged
            .primary_tag()
            .or_else(|| tagged.first_tag())
            .and_then(|tag| tag.pictures().first())
        {
            let mime = picture
                .mime_type()
                .map(|mime| mime.as_str())
                .unwrap_or_else(|| image_mime(picture.data(), None));
            if let Some(url) = image_data_url(picture.data(), mime) {
                return url;
            }
        }
    }

    let Some(parent) = path.parent() else {
        return String::new();
    };
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    for name in [
        format!("{stem}.jpg"),
        format!("{stem}.jpeg"),
        format!("{stem}.png"),
        format!("{stem}.webp"),
        "cover.jpg".to_owned(),
        "folder.jpg".to_owned(),
        "cover.png".to_owned(),
        "folder.png".to_owned(),
    ] {
        let candidate = parent.join(name);
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_COVER_BYTES {
            continue;
        }
        if let Ok(bytes) = fs::read(&candidate) {
            if let Some(url) = image_data_url(&bytes, image_mime(&bytes, Some(&candidate))) {
                return url;
            }
        }
    }
    String::new()
}

fn normalize_lyric(text: String) -> String {
    text.trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|line| line.replace('\0', "").trim().to_owned())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn decode_lyric(bytes: &[u8]) -> Option<String> {
    let text = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        String::from_utf8(bytes[3..].to_vec()).ok()?
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .ok()?
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .ok()?
    } else {
        // ponytail: UTF-8/UTF-16 covers modern LRC files; add explicit GB18030 decoding if legacy libraries require it.
        String::from_utf8(bytes.to_vec()).ok()?
    };
    let text = normalize_lyric(text);
    (!text.is_empty()).then_some(text)
}

fn has_timed_lyric(text: &str) -> bool {
    text.lines().any(|line| {
        let Some((prefix, _)) = line.split_once(']') else {
            return false;
        };
        prefix.strip_prefix('[').is_some_and(|time| {
            time.contains(':') && time.bytes().any(|byte| byte.is_ascii_digit())
        })
    })
}

struct LyricCandidate {
    text: String,
    timed: bool,
    source_priority: u8,
    extension_priority: u8,
    order: usize,
}

pub fn read_lyric(path: &Path) -> Option<LyricPayload> {
    let mut candidates = Vec::new();
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_string_lossy();
    let mut sidecars = fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let candidate = entry.path();
            let candidate_stem = candidate.file_stem()?.to_string_lossy();
            let extension = candidate.extension()?.to_string_lossy();
            let is_txt = extension.eq_ignore_ascii_case("txt");
            (candidate_stem.eq_ignore_ascii_case(&stem)
                && (extension.eq_ignore_ascii_case("lrc") || is_txt))
                .then_some((candidate, u8::from(is_txt)))
        })
        .collect::<Vec<(PathBuf, u8)>>();
    sidecars.sort_by(|left, right| left.0.cmp(&right.0));
    for (path, extension_priority) in sidecars {
        let Ok(metadata) = path.metadata() else {
            continue;
        };
        if metadata.len() > MAX_LYRIC_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(path) else {
            continue;
        };
        if let Some(text) = decode_lyric(&bytes) {
            candidates.push(LyricCandidate {
                timed: has_timed_lyric(&text),
                text,
                source_priority: 0,
                extension_priority,
                order: candidates.len(),
            });
        }
    }

    if let Ok(tagged) = lofty::read_from_path(path) {
        for tag in tagged.tags() {
            for key in [ItemKey::Lyrics, ItemKey::UnsyncLyrics] {
                for text in tag.get_strings(key) {
                    let text = normalize_lyric(text.to_owned());
                    if !text.is_empty() {
                        candidates.push(LyricCandidate {
                            timed: has_timed_lyric(&text),
                            text,
                            source_priority: 1,
                            extension_priority: 0,
                            order: candidates.len(),
                        });
                    }
                }
            }
        }
    }

    candidates.sort_by_key(|candidate| {
        (
            if candidate.timed {
                candidate.source_priority
            } else {
                candidate.source_priority + 2
            },
            candidate.extension_priority,
            candidate.order,
        )
    });
    candidates.into_iter().next().map(|candidate| LyricPayload {
        lrc: LyricText {
            lyric: candidate.text,
        },
    })
}

fn scan_directory(
    path: &Path,
    display_name: String,
    count: &mut usize,
) -> (FolderNode, FolderNode) {
    let mut tree = folder(display_name.clone(), path);
    let mut metadata = folder(display_name, path);
    let Ok(entries) = fs::read_dir(path) else {
        return (tree, metadata);
    };
    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for entry in entries {
        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let (child_tree, child_metadata) = scan_directory(&entry_path, name, count);
            tree.children.push(MusicNode::Folder(child_tree));
            metadata.children.push(MusicNode::Folder(child_metadata));
        } else if file_type.is_file() && is_music_file(&entry_path) {
            metadata
                .children
                .push(MusicNode::Track(read_track(&entry_path)));
            *count += 1;
        }
    }
    (tree, metadata)
}

pub fn scan_roots(roots: Vec<std::path::PathBuf>, scan_type: String) -> ScanPayload {
    // ponytail: scan sequentially and reparse tags for correctness; add a bounded mtime cache when very large libraries make this measurable.
    let mut dir_tree = Vec::new();
    let mut metadata = Vec::new();
    let mut count = 0;
    for root in roots {
        let display_name = path_text(&root);
        let (tree, metadata_root) = scan_directory(&root, display_name, &mut count);
        dir_tree.push(tree);
        metadata.push(metadata_root);
    }
    ScanPayload {
        dir_tree,
        metadata,
        scan_type,
        count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanner_keeps_the_existing_tree_and_fallback_metadata_shape() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-scan-{}", uuid::Uuid::new_v4()));
        let child = directory.join("album");
        fs::create_dir_all(&child).unwrap();
        fs::write(child.join("track.MP3"), b"not-real-audio").unwrap();
        fs::write(child.join("ignore.txt"), b"ignore").unwrap();

        let payload = scan_roots(vec![directory.clone()], "local".to_owned());
        assert_eq!(payload.count, 1);
        assert_eq!(payload.dir_tree.len(), 1);
        let MusicNode::Folder(album) = &payload.metadata[0].children[0] else {
            panic!("album folder missing");
        };
        let MusicNode::Track(track) = &album.children[0] else {
            panic!("track missing");
        };
        assert_eq!(track.common.title, "track");
        assert_eq!(track.format.container, "mp3");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn local_assets_hash_and_prefer_a_timed_sidecar_lyric() {
        let directory =
            std::env::temp_dir().join(format!("hydrogen-assets-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let audio = directory.join("track.mp3");
        fs::write(&audio, b"audio").unwrap();
        fs::write(directory.join("track.txt"), "plain lyric").unwrap();
        fs::write(directory.join("track.lrc"), "[00:01.000]timed lyric").unwrap();

        assert_eq!(
            hash_file(&audio).unwrap(),
            "A5CA0B5894324F8BB54BB9FFFAD29D1E"
        );
        let lyric = read_lyric(&audio).unwrap();
        assert_eq!(lyric.lrc.lyric, "[00:01.000]timed lyric");
        fs::remove_dir_all(directory).unwrap();
    }
}
