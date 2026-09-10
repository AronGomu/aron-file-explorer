use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const TOKEN_NAMES: [&str; 36] = [
    "background",
    "backgroundSecondary",
    "backgroundTertiary",
    "surface",
    "surfaceHover",
    "surfaceActive",
    "border",
    "borderStrong",
    "textPrimary",
    "textSecondary",
    "textTertiary",
    "textOnAccent",
    "accent",
    "accentHover",
    "accentSurface",
    "focusRing",
    "error",
    "errorSurface",
    "success",
    "successSurface",
    "warning",
    "warningSurface",
    "info",
    "infoSurface",
    "backdrop",
    "shadow",
    "folder",
    "fileImage",
    "fileVideo",
    "fileAudio",
    "fileCode",
    "fileArchive",
    "filePdf",
    "fileText",
    "previewCheckerboardLight",
    "previewCheckerboardDark",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDefinition {
    #[serde(rename = "$schema")]
    pub schema: String,
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub appearance: String,
    pub tokens: BTreeMap<String, String>,
}

pub fn parse_theme(bytes: &[u8]) -> Result<ThemeDefinition, String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "invalid JSON")?;
    let keys = ["$schema", "schemaVersion", "id", "name", "appearance", "tokens"];
    let obj = value.as_object().ok_or("expected ThemeDefinition v1")?;
    if obj.len() != keys.len() || keys.iter().any(|key| !obj.contains_key(*key))
        || value["$schema"] != "./theme.schema.json" {
        return Err("expected ThemeDefinition v1".into());
    }
    if value["schemaVersion"].as_f64() != Some(1.0) { return Err("unsupported schemaVersion".into()); }
    let id = value["id"].as_str().unwrap_or("");
    let name = value["name"].as_str().unwrap_or("");
    let appearance = value["appearance"].as_str().unwrap_or("");
    static ID: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(||
        regex::Regex::new(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\z").expect("constant ID regex"));
    // ECMAScript \s (the JSON Schema pattern), not Rust's broader Unicode whitespace set.
    let whitespace = |c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}'
        | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}');
    if id == "system" || id.len() > 64 || !ID.is_match(id)
        || name.chars().count() > 80 || name.chars().all(whitespace)
        || !matches!(appearance, "light" | "dark") {
        return Err("invalid theme metadata".into());
    }
    let tokens = value["tokens"].as_object().ok_or("expected all 36 color tokens")?;
    if tokens.len() != TOKEN_NAMES.len() || TOKEN_NAMES.iter().any(|key| !tokens.contains_key(*key)) {
        return Err("expected all 36 color tokens".into());
    }
    let mut colors = BTreeMap::new();
    for key in TOKEN_NAMES {
        let color = tokens[key].as_str().unwrap_or("");
        if !matches!(color.len(), 7 | 9) || !color.starts_with('#') || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit) {
            return Err(format!("invalid color token: {key}"));
        }
        colors.insert(key.to_string(), color.to_string());
    }
    Ok(ThemeDefinition { schema: "./theme.schema.json".into(), schema_version: 1,
        id: id.into(), name: name.into(), appearance: appearance.into(), tokens: colors })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn theme_schema_parity() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!("../../../tests/themes/fixtures/theme-definitions/cases.json")).unwrap();
        for fixture in fixtures {
            let result = parse_theme(fixture["json"].as_str().unwrap().as_bytes());
            assert_eq!(result.as_ref().err().map(String::as_str), fixture["reason"].as_str(), "{}", fixture["name"]);
        }
    }
}
