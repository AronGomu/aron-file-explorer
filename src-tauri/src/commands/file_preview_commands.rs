use super::text_highlighting::{highlight_text, HighlightedText};
use serde::Serialize;
use std::io::{Read, Write};

const TEXT_PREVIEW_LIMIT: usize = 256 * 1024;

#[derive(Serialize)]
pub struct TextPreview {
    pub text: Option<String>,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub highlights: Vec<HighlightedText>,
}

pub(crate) fn read_text_preview(reader: impl Read, path: &str) -> Result<TextPreview, String> {
    let mut bytes = Vec::new();
    reader
        .take((TEXT_PREVIEW_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let truncated = bytes.len() > TEXT_PREVIEW_LIMIT;
    bytes.truncate(TEXT_PREVIEW_LIMIT);

    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little_endian = bytes[0] == 0xff;
        let mut units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| {
                if little_endian {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        if truncated
            && units
                .last()
                .is_some_and(|unit| (0xd800..=0xdbff).contains(unit))
        {
            units.pop();
        }
        if !truncated && bytes.len() % 2 != 0 {
            None
        } else {
            String::from_utf16(&units).ok()
        }
    } else {
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
        match std::str::from_utf8(bytes) {
            Ok(text) => Some(text.to_owned()),
            Err(error) if truncated && error.error_len().is_none() => {
                Some(String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned())
            }
            Err(_) => None,
        }
    };
    let text = text.filter(|text| {
        !text.chars().any(|character| {
            character.is_control() && !matches!(character, '\n' | '\r' | '\t' | '\u{000c}')
        })
    });
    let highlights = text
        .as_deref()
        .and_then(|source| highlight_text(path, source))
        .unwrap_or_default();
    Ok(TextPreview {
        text,
        truncated,
        highlights,
    })
}

#[tauri::command]
pub async fn get_text_preview(path: String) -> Result<TextPreview, String> {
    tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Preview is only available for regular files".to_string());
        }
        let file = std::fs::File::open(&path).map_err(|error| error.to_string())?;
        read_text_preview(file, &path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn save_text_preview(
    path: String,
    original_text: String,
    text: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let requested = std::path::Path::new(&path);
        if !requested
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
        {
            return Err("Only TXT files can be edited in the preview".into());
        }
        let path = requested
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        let metadata = file.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > TEXT_PREVIEW_LIMIT as u64 {
            return Err("Only complete text previews can be saved".into());
        }
        let mut bytes = Vec::new();
        file.take((TEXT_PREVIEW_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let preview = read_text_preview(bytes.as_slice(), "notes.txt")?;
        if preview.truncated || preview.text.as_deref() != Some(original_text.as_str()) {
            return Err(
                "The file changed since it was loaded. Reopen its preview before saving.".into(),
            );
        }
        // Textarea values use LF; retain the file's original newline convention.
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        let text = if original_text.contains("\r\n") {
            normalized.replace('\n', "\r\n")
        } else if original_text.contains('\r') && !original_text.contains('\n') {
            normalized.replace('\n', "\r")
        } else {
            normalized
        };
        let mut output = Vec::new();
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
            output.extend_from_slice(&bytes[..2]);
            for unit in text.encode_utf16() {
                output.extend_from_slice(&if bytes[0] == 0xff {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
        } else {
            if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
                output.extend_from_slice(&bytes[..3]);
            }
            output.extend_from_slice(text.as_bytes());
        }
        // Finish writing before replacing the original, preserving it on write failures.
        let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap())
            .map_err(|error| error.to_string())?;
        temporary
            .write_all(&output)
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
        temporary.persist(path).map_err(|error| error.to_string())?;
        Ok(text)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod editing_tests {
    use super::*;

    #[tokio::test]
    async fn confirmed_text_save_preserves_encoding_line_endings_and_permissions() {
        for bytes in [
            b"Original\r\n".to_vec(),
            b"\xef\xbb\xbfOriginal\r\n".to_vec(),
            [
                vec![0xff, 0xfe],
                "Original\r\n"
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect(),
            ]
            .concat(),
            [
                vec![0xfe, 0xff],
                "Original\r\n"
                    .encode_utf16()
                    .flat_map(u16::to_be_bytes)
                    .collect(),
            ]
            .concat(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("notes.TXT");
            std::fs::write(&path, &bytes).unwrap();
            let permissions = std::fs::metadata(&path).unwrap().permissions();
            save_text_preview(
                path.to_string_lossy().into(),
                "Original\r\n".into(),
                "Edited\n".into(),
            )
            .await
            .unwrap();
            let saved = std::fs::read(&path).unwrap();
            assert_eq!(
                read_text_preview(saved.as_slice(), "notes.TXT")
                    .unwrap()
                    .text
                    .as_deref(),
                Some("Edited\r\n")
            );
            if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
                assert_eq!(&saved[..2], &bytes[..2]);
            } else {
                assert_eq!(
                    saved.starts_with(&[0xef, 0xbb, 0xbf]),
                    bytes.starts_with(&[0xef, 0xbb, 0xbf])
                );
            }
            assert_eq!(std::fs::metadata(&path).unwrap().permissions(), permissions);
        }
    }

    #[tokio::test]
    async fn save_refuses_changed_truncated_binary_and_non_txt_files() {
        let dir = tempfile::tempdir().unwrap();
        for (name, bytes, original) in [
            ("changed.txt", b"Changed elsewhere".to_vec(), "Old text"),
            ("large.txt", vec![b'x'; TEXT_PREVIEW_LIMIT + 1], "x"),
            ("binary.txt", vec![0, 1, 2], ""),
            ("code.json", b"{}".to_vec(), "{}"),
        ] {
            let path = dir.path().join(name);
            std::fs::write(&path, &bytes).unwrap();
            assert!(save_text_preview(
                path.to_string_lossy().into(),
                original.into(),
                "replacement".into()
            )
            .await
            .is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }

    #[tokio::test]
    async fn empty_text_can_be_edited_and_saved_text_can_be_emptied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.txt").to_string_lossy().into_owned();
        std::fs::write(&path, "").unwrap();
        save_text_preview(path.clone(), "".into(), "New text".into())
            .await
            .unwrap();
        save_text_preview(path.clone(), "New text".into(), "".into())
            .await
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"");
        std::fs::remove_file(&path).unwrap();
        assert!(
            save_text_preview(path.clone(), "".into(), "replacement".into())
                .await
                .is_err()
        );
        assert!(!std::path::Path::new(&path).exists());
    }
}
