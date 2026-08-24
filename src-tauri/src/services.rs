use std::{
    io::{Cursor, Read},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use lofty::{file::TaggedFileExt, prelude::Accessor, probe::Probe, tag::ItemKey};
use serde::Deserialize;
use serde_json::Value;

const MAX_REQUEST_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Deserialize)]
pub struct ProxyRequest {
    url: String,
    option: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudMetadataRequest {
    url: String,
    #[allow(dead_code)]
    cache_key: Option<String>,
    extension: Option<String>,
    file_name: Option<String>,
}

fn allowed_proxy_host(host: &str) -> bool {
    ["bilibili.com", "hypergryph.com", "hycdn.cn"]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

fn checked_http_url(value: &str, restrict_host: bool) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only HTTP(S) requests are supported".to_owned());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "request URL has no host".to_owned())?;
    if restrict_host && !allowed_proxy_host(host) {
        return Err("request host is not used by the renderer's proxy API".to_owned());
    }
    Ok(url)
}

fn response_bytes(response: reqwest::blocking::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_REQUEST_BYTES)
    {
        return Err("response is too large".to_owned());
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err("response is too large".to_owned());
    }
    Ok(bytes)
}

fn request_data_blocking(request: ProxyRequest) -> Result<Value, String> {
    let option = request.option.unwrap_or(Value::Null);
    let mut url = checked_http_url(&request.url, true)?;
    if let Some(params) = option.get("params").and_then(Value::as_object) {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            let value = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            query.append_pair(key, &value);
        }
    }

    let requested_timeout = option
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(15_000)
        .clamp(1_000, 60_000);
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client
        .get(url)
        .timeout(Duration::from_millis(requested_timeout));
    if let Some(headers) = option.get("headers").and_then(Value::as_object) {
        for (name, value) in headers {
            let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Some(value) = value.as_str() else {
                continue;
            };
            if let Ok(value) = reqwest::header::HeaderValue::from_str(value) {
                builder = builder.header(name, value);
            }
        }
    }
    let response = builder
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let bytes = response_bytes(response)?;
    if option.get("responseType").and_then(Value::as_str) == Some("text") {
        return Ok(Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_request_data(request: ProxyRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || request_data_blocking(request))
        .await
        .map_err(|error| error.to_string())?
}

fn picture_mime(bytes: &[u8], declared: Option<&str>) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if declared == Some("image/png") {
        "image/png"
    } else {
        "image/jpeg"
    }
}

fn cloud_metadata_blocking(options: CloudMetadataRequest) -> Result<Value, String> {
    let url = checked_http_url(&options.url, false)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-16777215")
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let bytes = response_bytes(response)?;
    let tagged = Probe::new(Cursor::new(bytes))
        .guess_file_type()
        .map_err(|error| error.to_string())?
        .read()
        .map_err(|error| error.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let title = tag
        .and_then(|tag| tag.title())
        .map(|value| value.into_owned())
        .unwrap_or_else(|| {
            options
                .file_name
                .as_deref()
                .and_then(|name| name.rsplit_once('.').map(|(stem, _)| stem))
                .unwrap_or_default()
                .to_owned()
        });
    let artists = tag
        .and_then(|tag| tag.artist())
        .map(|value| {
            value
                .split([',', '，', '/', '|'])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let album = tag
        .and_then(|tag| tag.album())
        .map(|value| value.into_owned())
        .unwrap_or_default();
    let lyric = tag
        .and_then(|tag| {
            tag.get_string(ItemKey::Lyrics)
                .or_else(|| tag.get_string(ItemKey::UnsyncLyrics))
        })
        .filter(|value| !value.trim().is_empty());
    let cover_url = tag
        .and_then(|tag| tag.pictures().first())
        .filter(|picture| picture.data().len() as u64 <= MAX_REQUEST_BYTES)
        .map(|picture| {
            let declared = picture.mime_type().map(|mime| mime.as_str());
            format!(
                "data:{};base64,{}",
                picture_mime(picture.data(), declared),
                BASE64.encode(picture.data())
            )
        })
        .unwrap_or_default();

    Ok(serde_json::json!({
        "coverUrl": cover_url,
        "lyric": lyric.map(|text| serde_json::json!({ "lrc": { "lyric": text } })),
        "title": title,
        "artists": artists,
        "album": album,
        "extension": options.extension.unwrap_or_default()
    }))
}

#[tauri::command]
pub async fn get_cloud_music_metadata(options: CloudMetadataRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || cloud_metadata_blocking(options))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_proxy_accepts_only_the_hosts_it_uses() {
        assert!(checked_http_url("https://api.bilibili.com/x/nav", true).is_ok());
        assert!(checked_http_url("https://monster-siren.hypergryph.com/api/albums", true).is_ok());
        assert!(checked_http_url("https://example.com/", true).is_err());
        assert!(checked_http_url("file:///etc/passwd", false).is_err());
    }
}
