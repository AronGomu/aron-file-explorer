use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

#[tauri::command]
pub async fn get_image_thumbnail(path: String, size: u32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let source = PathBuf::from(path);
        let metadata = source.metadata().map_err(|error| error.to_string())?;
        let size = size.clamp(32, 1024);
        let mut hash = DefaultHasher::new();
        source.hash(&mut hash);
        metadata.len().hash(&mut hash);
        metadata.modified().ok().hash(&mut hash);
        size.hash(&mut hash);
        let directory = std::env::temp_dir().join("file_explorer_thumbnails");
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let cached = directory.join(format!("{:016x}.png", hash.finish()));
        if cached.is_file() {
            return Ok(cached.to_string_lossy().into_owned());
        }

        let mut decoder = ImageReader::open(&source)
            .map_err(|error| error.to_string())?
            .with_guessed_format()
            .map_err(|error| error.to_string())?
            .into_decoder()
            .map_err(|error| error.to_string())?;
        let orientation = decoder
            .orientation()
            .unwrap_or(image::metadata::Orientation::NoTransforms);
        let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
        image.apply_orientation(orientation);
        let thumbnail = image.thumbnail(size, size);
        let mut temporary =
            tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
        thumbnail
            .write_to(temporary.as_file_mut(), ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        if let Err(error) = temporary.persist_noclobber(&cached) {
            if !cached.is_file() {
                return Err(error.to_string());
            }
        }
        Ok(cached.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}
