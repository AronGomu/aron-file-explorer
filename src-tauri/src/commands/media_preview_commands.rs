use axum::{
    body::Body,
    extract::{Path, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::{collections::VecDeque, path::PathBuf, sync::Arc};
use tokio::sync::{Mutex, OnceCell, Semaphore};
use tower_http::services::ServeFile;

type MediaFiles = Arc<Mutex<VecDeque<(String, PathBuf)>>>;

struct MediaServer {
    port: u16,
    files: MediaFiles,
}

static MEDIA_SERVER: OnceCell<MediaServer> = OnceCell::const_new();
static MEDIA_METADATA_WORKERS: Semaphore = Semaphore::const_new(2);

#[tauri::command]
pub async fn get_media_duration(path: String) -> Result<Option<f64>, String> {
    let _permit = MEDIA_METADATA_WORKERS.acquire().await.map_err(|error| error.to_string())?;
    let path = tokio::fs::canonicalize(path).await.map_err(|error| error.to_string())?;
    if !tokio::fs::metadata(&path).await.map_err(|error| error.to_string())?.is_file() {
        return Err("Media duration requires a regular file".into());
    }
    let mut command = tokio::process::Command::new("ffprobe");
    command.args([
        "-v", "error", "-protocol_whitelist", "file,pipe",
        "-show_entries", "format=duration:stream=duration,codec_type", "-of", "json", "-i",
    ]).arg(path)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(5), command.output())
        .await.map_err(|_| "Reading media duration timed out".to_string())?
        .map_err(|error| error.to_string())?;
    if !output.status.success() { return Ok(None); }
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let duration = |value: &serde_json::Value| value.as_str().and_then(|text| text.parse::<f64>().ok())
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0);
    let streams = metadata["streams"].as_array();
    if !streams.is_some_and(|streams| streams.iter().any(|stream| matches!(stream["codec_type"].as_str(), Some("audio" | "video")))) {
        return Ok(None);
    }
    Ok(duration(&metadata["format"]["duration"]).or_else(|| streams?.iter()
        .filter(|stream| matches!(stream["codec_type"].as_str(), Some("audio" | "video")))
        .filter_map(|stream| duration(&stream["duration"]))
        .max_by(f64::total_cmp)))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPreview {
    pub url: String,
    pub has_audio: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPreviewInfo {
    duration: Option<f64>,
    has_audio: Option<bool>,
}

#[tauri::command]
pub async fn get_video_preview_info(path: String) -> Result<VideoPreviewInfo, String> {
    let (duration, has_audio) = tokio::join!(
        get_media_duration(path.clone()),
        super::video_commands::video_has_audio(std::path::Path::new(&path)),
    );
    Ok(VideoPreviewInfo { duration: duration?, has_audio })
}

async fn serve_media(
    State(files): State<MediaFiles>,
    Path(token): Path<String>,
    request: Request<Body>,
) -> Response {
    let path = files
        .lock()
        .await
        .iter()
        .find(|(key, _)| key == &token)
        .map(|(_, path)| path.clone());
    match path {
        Some(path) => match ServeFile::new(path).try_call(request).await {
            Ok(response) => response.map(Body::new),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        },
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[tauri::command]
pub async fn get_media_preview_url(path: String, video: bool) -> Result<MediaPreview, String> {
    let path = tokio::fs::canonicalize(path)
        .await
        .map_err(|error| error.to_string())?;
    if !tokio::fs::metadata(&path)
        .await
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Media previews require a regular file".to_string());
    }
    // GStreamer's media loader cannot read Tauri asset:// URLs. Serve only explicitly
    // registered files over loopback; opaque tokens never expose filesystem paths.
    let server = MEDIA_SERVER
        .get_or_try_init(|| async {
            let listener =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
            let port = listener.local_addr()?.port();
            let files = MediaFiles::default();
            let app = Router::new()
                .route("/{token}", get(serve_media))
                .with_state(files.clone());
            tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            Ok::<_, std::io::Error>(MediaServer { port, files })
        })
        .await
        .map_err(|error| error.to_string())?;
    let mut files = server.files.lock().await;
    let entry = if let Some(index) = files.iter().position(|(_, existing)| existing == &path) {
        files.remove(index).unwrap()
    } else {
        (hex::encode(rand::random::<[u8; 32]>()), path.clone())
    };
    let url = format!("http://127.0.0.1:{}/{}", server.port, entry.0);
    files.push_back(entry);
    if files.len() > 64 {
        files.pop_front();
    }
    drop(files);
    let has_audio = if video {
        super::video_commands::video_has_audio(&path).await
    } else {
        None
    };
    Ok(MediaPreview { url, has_audio })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn streams_byte_ranges_and_head_and_rejects_unregistered_paths() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("space # ' video.webm");
        tokio::fs::write(&path, b"0123456789").await.unwrap();
        let files = MediaFiles::default();
        files.lock().await.push_back(("known-token".into(), path));
        for (range, expected, content_range) in [
            ("bytes=2-5", "2345", "bytes 2-5/10"),
            ("bytes=7-", "789", "bytes 7-9/10"),
            ("bytes=-3", "789", "bytes 7-9/10"),
        ] {
            let request = Request::builder()
                .header("Range", range)
                .body(Body::empty())
                .unwrap();
            let response =
                serve_media(State(files.clone()), Path("known-token".into()), request).await;
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(response.headers()["Content-Range"], content_range);
            assert_eq!(response.headers()["Content-Type"], "video/webm");
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap(),
                expected
            );
        }
        let request = Request::builder()
            .method("HEAD")
            .body(Body::empty())
            .unwrap();
        let response = serve_media(State(files.clone()), Path("known-token".into()), request).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["Content-Length"], "10");
        assert!(to_bytes(response.into_body(), 1024)
            .await
            .unwrap()
            .is_empty());
        let request = Request::builder()
            .header("Range", "bytes=100-200")
            .body(Body::empty())
            .unwrap();
        let response = serve_media(State(files.clone()), Path("known-token".into()), request).await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        let response = serve_media(
            State(files),
            Path("../other.webm".into()),
            Request::new(Body::empty()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn registers_only_regular_files_and_reuses_their_token() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("video.mp4");
        std::fs::write(&path, "video").unwrap();
        let preview = get_media_preview_url(path.to_string_lossy().into(), false)
            .await
            .unwrap();
        let url = preview.url;
        assert!(url.starts_with("http://127.0.0.1:"));
        assert!(!url.contains("video.mp4"));
        assert_eq!(
            get_media_preview_url(path.to_string_lossy().into(), false)
                .await
                .unwrap()
                .url,
            url
        );
        assert!(
            get_media_preview_url(directory.path().to_string_lossy().into(), false)
                .await
                .is_err()
        );
        assert!(get_media_preview_url(
            directory.path().join("missing").to_string_lossy().into(),
            false
        )
        .await
        .is_err());
    }
}
