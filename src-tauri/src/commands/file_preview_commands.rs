use serde::Serialize;
use std::io::Read;

const TEXT_PREVIEW_LIMIT: usize = 256 * 1024;

#[derive(Serialize)]
pub struct TextPreview {
    pub text: Option<String>,
    pub truncated: bool,
}

pub(crate) fn read_text_preview(reader: impl Read) -> Result<TextPreview, String> {
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
    Ok(TextPreview { text, truncated })
}

#[tauri::command]
pub async fn get_text_preview(path: String) -> Result<TextPreview, String> {
    tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Preview is only available for regular files".to_string());
        }
        let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
        read_text_preview(file)
    })
    .await
    .map_err(|error| error.to_string())?
}
