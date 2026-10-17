use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::Semaphore;

static VIDEO_WORKERS: Semaphore = Semaphore::const_new(2);

#[tauri::command]
pub async fn get_video_thumbnail(path: String, size: u32) -> Result<String, String> {
    let _permit = VIDEO_WORKERS
        .acquire()
        .await
        .map_err(|error| error.to_string())?;
    create_video_thumbnail(
        Path::new(&path),
        size,
        &std::env::temp_dir().join("file_explorer_thumbnails"),
    )
    .await
}

async fn create_video_thumbnail(
    source: &Path,
    size: u32,
    directory: &Path,
) -> Result<String, String> {
    let source = tokio::fs::canonicalize(source)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = tokio::fs::metadata(&source)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Video thumbnails require a regular file".to_string());
    }
    let size = size.clamp(32, 1024);
    let mut hash = DefaultHasher::new();
    source.hash(&mut hash);
    metadata.len().hash(&mut hash);
    metadata.modified().ok().hash(&mut hash);
    size.hash(&mut hash);
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|error| error.to_string())?;
    let cached = directory.join(format!("video-v1-{:016x}.png", hash.finish()));
    if cached.is_file() {
        return Ok(cached.to_string_lossy().into_owned());
    }

    let temporary = tempfile::Builder::new()
        .prefix("video-")
        .suffix(".png")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    // Seek past a possible blank opening; very short clips fall back to their first frame.
    for seek in ["1", "0"] {
        let mut command = Command::new("ffmpeg");
        command
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-threads",
                "1",
                "-protocol_whitelist",
                "file,pipe",
                "-ss",
                seek,
                "-i",
            ])
            .arg(&source)
            .args(["-map", "0:v:0", "-frames:v", "1", "-an", "-sn", "-vf"])
            .arg(format!(
                "scale={size}:{size}:force_original_aspect_ratio=decrease"
            ))
            .args([
                "-threads", "1", "-c:v", "png", "-f", "image2", "-update", "1", "-y",
            ])
            .arg(temporary.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let status = tokio::time::timeout(Duration::from_secs(10), command.status())
            .await
            .map_err(|_| "Video thumbnail generation timed out".to_string())?
            .map_err(|error| format!("Unable to run FFmpeg: {error}"))?;
        if status.success() && image::image_dimensions(temporary.path()).is_ok() {
            if let Err(error) = temporary.persist_noclobber(&cached) {
                if !cached.is_file() {
                    return Err(error.to_string());
                }
            }
            return Ok(cached.to_string_lossy().into_owned());
        }
    }
    Err("Unable to extract a video thumbnail".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video(path: &Path, color: &str, duration: &str) {
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={color}:s=160x90:d={duration}"),
                "-an",
                "-c:v",
                "mpeg4",
                "-threads",
                "1",
                "-y",
            ])
            .arg(path)
            .status()
            .expect("FFmpeg must be installed for video thumbnail tests");
        assert!(status.success());
    }

    #[tokio::test]
    async fn extracts_short_video_with_spaces_and_scales_without_distortion() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("clip '# spaced.MP4");
        video(&source, "red", "0.2");
        let cached = create_video_thumbnail(&source, 96, &root.path().join("cache"))
            .await
            .unwrap();
        let image = image::open(cached).unwrap().to_rgb8();
        assert_eq!(image.dimensions(), (96, 54));
        let pixel = image.get_pixel(48, 27);
        assert!(pixel[0] > 200 && pixel[1] < 30 && pixel[2] < 30);
    }

    #[tokio::test]
    async fn reuses_cache_and_invalidates_changed_video_or_size() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("clip.mp4");
        let cache = root.path().join("cache");
        video(&source, "red", "1.2");
        let first = create_video_thumbnail(&source, 96, &cache).await.unwrap();
        let modified = std::fs::metadata(&first).unwrap().modified().unwrap();
        let (a, b) = tokio::join!(
            create_video_thumbnail(&source, 96, &cache),
            create_video_thumbnail(&source, 96, &cache)
        );
        assert_eq!(a.unwrap(), first);
        assert_eq!(b.unwrap(), first);
        assert_eq!(
            std::fs::metadata(&first).unwrap().modified().unwrap(),
            modified
        );
        let small = create_video_thumbnail(&source, 1, &cache).await.unwrap();
        assert_ne!(small, first);
        assert_eq!(image::image_dimensions(small).unwrap(), (32, 18));
        video(&source, "lime", "0.2");
        let changed = create_video_thumbnail(&source, 96, &cache).await.unwrap();
        assert_ne!(changed, first);
        let image = image::open(changed).unwrap().to_rgb8();
        let pixel = image.get_pixel(48, 27);
        assert!(pixel[1] > 200 && pixel[0] < 30 && pixel[2] < 30);
    }

    #[tokio::test]
    async fn invalid_missing_and_non_file_sources_return_errors_without_cached_output() {
        let root = tempfile::tempdir().unwrap();
        let cache = root.path().join("cache");
        assert!(
            create_video_thumbnail(&root.path().join("missing"), 96, &cache)
                .await
                .is_err()
        );
        assert!(create_video_thumbnail(root.path(), 96, &cache)
            .await
            .is_err());
        let broken = root.path().join("broken.mkv");
        std::fs::write(&broken, "invalid video").unwrap();
        assert!(create_video_thumbnail(&broken, 96, &cache).await.is_err());
        assert_eq!(std::fs::read_dir(cache).unwrap().count(), 0);
    }
}
