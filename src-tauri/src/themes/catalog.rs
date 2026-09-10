use super::{definition::{parse_theme, ThemeDefinition}, SEEDS};
use crate::state::config_file::ConfigDirectory;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ThemeIssue {
    pub code: String,
    pub file: Option<String>,
    pub id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ThemeCatalog {
    pub revision: u32,
    pub directory: String,
    pub themes: Vec<ThemeDefinition>,
    pub issues: Vec<ThemeIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeFailure {
    pub code: &'static str,
    pub message: &'static str,
}
impl ThemeFailure {
    pub fn io() -> Self { Self { code: "io", message: "Theme directory is unavailable" } }
    pub fn save() -> Self { Self { code: "save", message: "Could not save theme selection" } }
    pub fn unavailable() -> Self { Self { code: "unavailable", message: "Theme is unavailable" } }
}

pub struct ThemeRegistry {
    pub catalog: ThemeCatalog,
    pub accepted: BTreeMap<OsString, ThemeDefinition>,
}

pub struct ThemeState {
    pub registry: Mutex<ThemeRegistry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SeedLedger {
    schema_version: u32,
    seeded_ids: Vec<String>,
}

impl ThemeState {
    pub fn new(app: &tauri::App) -> Self {
        Self::initialize(app.path().app_config_dir().ok().map(|path| path.join("themes")))
    }

    fn initialize(path: Option<PathBuf>) -> Self {
        let mut registry = ThemeRegistry {
            catalog: ThemeCatalog { revision: 1, directory: path.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(), themes: Vec::new(), issues: Vec::new() },
            accepted: BTreeMap::new(),
        };
        let directory = path.as_ref().and_then(|path| ConfigDirectory::open(path, true).ok());
        if let Some(directory) = directory {
            seed(&directory, &mut registry.catalog.issues);
            match directory.names() {
                Ok(mut names) => {
                    names.sort();
                    let mut owners = BTreeSet::new();
                    for name in names {
                        let file = name.to_string_lossy();
                        if !file.ends_with(".theme.json") { continue; }
                        let parsed = match directory.read_regular(&name, Some(65536)) {
                            Ok(bytes) => parse_theme(&bytes),
                            Err(error) => {
                                let reason = match error.kind() {
                                    io::ErrorKind::InvalidInput => "theme file must be a regular file",
                                    io::ErrorKind::InvalidData => "theme file exceeds 65536 bytes",
                                    _ => {
                                        registry.catalog.issues.push(issue("io", Some(&file), None, "Theme directory is unavailable"));
                                        continue;
                                    }
                                };
                                Err(reason.to_string())
                            }
                        };
                        match parsed {
                            Ok(theme) if owners.insert(theme.id.clone()) => {
                                registry.catalog.themes.push(theme.clone());
                                registry.accepted.insert(name, theme);
                            }
                            Ok(theme) => registry.catalog.issues.push(issue("duplicate", Some(&file), Some(&theme.id), "Duplicate theme id")),
                            Err(reason) => registry.catalog.issues.push(issue("invalid", Some(&file), None, &reason)),
                        }
                    }
                }
                Err(_) => registry.catalog.issues.push(issue("io", None, None, "Theme directory is unavailable")),
            }
        } else {
            registry.catalog.issues.push(issue("io", None, None, "Theme directory is unavailable"));
        }
        Self { registry: Mutex::new(registry) }
    }

    #[cfg(test)]
    pub(crate) fn at(path: PathBuf) -> Self { Self::initialize(Some(path)) }
}

fn issue(code: &str, file: Option<&str>, id: Option<&str>, reason: &str) -> ThemeIssue {
    ThemeIssue { code: code.into(), file: file.map(str::to_owned), id: id.map(str::to_owned), reason: reason.into() }
}

fn seed(directory: &ConfigDirectory, issues: &mut Vec<ThemeIssue>) {
    let ledger_name = OsStr::new(".seed-state.json");
    let mut ledger = match directory.read_regular(ledger_name, Some(65536)) {
        Ok(bytes) => match serde_json::from_slice::<SeedLedger>(&bytes) {
            Ok(ledger) if ledger.schema_version == 1 && ledger.seeded_ids.windows(2).all(|pair| pair[0] < pair[1]) => ledger,
            _ => { issues.push(issue("io", Some(".seed-state.json"), None, "Invalid seed ledger")); return; }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => SeedLedger { schema_version: 1, seeded_ids: Vec::new() },
        Err(_) => { issues.push(issue("io", Some(".seed-state.json"), None, "Invalid seed ledger")); return; }
    };
    if let Err(error) = directory.create_new(OsStr::new("theme.schema.json"), include_bytes!("../../resources/themes/theme.schema.json")) {
        if error.kind() != io::ErrorKind::AlreadyExists { issues.push(issue("io", Some("theme.schema.json"), None, "Could not seed theme schema")); }
    }
    for (id, bytes) in SEEDS {
        if ledger.seeded_ids.iter().any(|seeded| seeded == id) { continue; }
        let filename = format!("{id}.theme.json");
        if let Err(error) = directory.create_new(OsStr::new(&filename), bytes.as_bytes()) {
            if error.kind() != io::ErrorKind::AlreadyExists {
                issues.push(issue("io", Some(&filename), Some(id), "Could not seed theme file"));
                continue;
            }
        }
        ledger.seeded_ids.push(id.into());
        ledger.seeded_ids.sort();
        // Serialization of this fixed string/number structure cannot fail.
        let bytes = serde_json::to_vec(&ledger).expect("seed ledger is serializable");
        if directory.atomic_write(ledger_name, &bytes).is_err() {
            issues.push(issue("io", Some(".seed-state.json"), None, "Could not save seed ledger"));
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;

    fn snapshot(path: &std::path::Path) -> ThemeCatalog {
        ThemeState::at(path.to_path_buf()).registry.lock().unwrap().catalog.clone()
    }
    #[test]
    fn theme_seed_once() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("themes");
        let first = snapshot(&path);
        assert_eq!(first.themes.len(), 2);
        let ledger = fs::read(path.join(".seed-state.json")).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&ledger).unwrap(), json!({"schemaVersion":1,"seededIds":["catppuccin-latte","catppuccin-mocha"]}));
        assert_eq!(snapshot(&path), first);
        let custom = SEEDS[0].1.replace("#eff1f5", "#abcdef");
        fs::write(path.join("catppuccin-latte.theme.json"), &custom).unwrap();
        fs::remove_file(path.join("catppuccin-mocha.theme.json")).unwrap();
        let later = snapshot(&path);
        assert_eq!(later.themes.len(), 1);
        assert_eq!(later.themes[0].tokens["background"], "#abcdef");
        assert_eq!(fs::read_to_string(path.join("catppuccin-latte.theme.json")).unwrap(), custom);
        assert!(!path.join("catppuccin-mocha.theme.json").exists());
        assert_eq!(fs::read(path.join(".seed-state.json")).unwrap(), ledger);
    }
    #[test]
    fn theme_seed_ledger_recovery() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path();
        fs::write(path.join("catppuccin-latte.theme.json"), b"user bytes").unwrap();
        fs::write(path.join("theme.schema.json"), b"user schema").unwrap();
        let first = snapshot(path);
        assert_eq!(first.themes.len(), 1);
        assert_eq!(fs::read(path.join("catppuccin-latte.theme.json")).unwrap(), b"user bytes");
        assert_eq!(fs::read(path.join("theme.schema.json")).unwrap(), b"user schema");
        fs::write(path.join(".seed-state.json"), b"{corrupt").unwrap();
        fs::remove_file(path.join("catppuccin-latte.theme.json")).unwrap();
        let corrupt = snapshot(path);
        assert!(corrupt.issues.iter().any(|i| i.code == "io" && i.file.as_deref() == Some(".seed-state.json")));
        assert_eq!(corrupt.themes.len(), 1);
        assert!(!path.join("catppuccin-latte.theme.json").exists());
        assert_eq!(fs::read(path.join(".seed-state.json")).unwrap(), b"{corrupt");
        // Interrupted first seed: ledger records Latte, existing Mocha is never overwritten.
        fs::write(path.join(".seed-state.json"), br#"{"schemaVersion":1,"seededIds":["catppuccin-latte"]}"#).unwrap();
        let mocha = fs::read(path.join("catppuccin-mocha.theme.json")).unwrap();
        snapshot(path);
        assert!(!path.join("catppuccin-latte.theme.json").exists());
        assert_eq!(fs::read(path.join("catppuccin-mocha.theme.json")).unwrap(), mocha);
    }
    #[test]
    fn theme_custom_duplicate_owner() {
        let temp = tempfile::tempdir().unwrap();
        let custom = SEEDS[0].1.replace("catppuccin-latte", "custom").replace("Catppuccin Latte", "Custom first");
        fs::write(temp.path().join("a.theme.json"), &custom).unwrap();
        fs::write(temp.path().join("z.theme.json"), custom.replace("Custom first", "Custom last")).unwrap();
        fs::create_dir(temp.path().join("nested")).unwrap();
        fs::write(temp.path().join("nested/ignored.theme.json"), SEEDS[0].1).unwrap();
        let catalog = snapshot(temp.path());
        assert_eq!(catalog.themes.len(), 3);
        assert_eq!(catalog.themes.iter().find(|t| t.id == "custom").unwrap().name, "Custom first");
        assert!(catalog.issues.iter().any(|i| i.code == "duplicate" && i.file.as_deref() == Some("z.theme.json") && i.id.as_deref() == Some("custom")));
    }
    #[test]
    fn theme_file_size_and_type() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path();
        let mut bytes = SEEDS[0].1.replace("catppuccin-latte", "boundary").into_bytes();
        bytes.resize(65536, b' ');
        fs::write(path.join("boundary.theme.json"), &bytes).unwrap();
        bytes.push(b' ');
        fs::write(path.join("oversized.theme.json"), &bytes).unwrap();
        fs::create_dir(path.join("directory.theme.json")).unwrap();
        let catalog = snapshot(path);
        assert!(catalog.themes.iter().any(|t| t.id == "boundary"));
        for (file, reason) in [("oversized.theme.json", "theme file exceeds 65536 bytes"), ("directory.theme.json", "theme file must be a regular file")] {
            assert!(catalog.issues.iter().any(|i| i.file.as_deref() == Some(file) && i.reason == reason));
        }
    }
    #[cfg(unix)]
    #[test]
    fn theme_no_follow_symlinks_and_directory_swap() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("external.theme.json"), SEEDS[0].1).unwrap();
        let path = temp.path().join("themes");
        fs::create_dir(&path).unwrap();
        symlink(outside.join("external.theme.json"), path.join("linked.theme.json")).unwrap();
        let catalog = snapshot(&path);
        assert!(catalog.issues.iter().any(|i| i.file.as_deref() == Some("linked.theme.json") && i.reason == "theme file must be a regular file"));
        let pinned = ConfigDirectory::open(&path, false).unwrap();
        let moved = temp.path().join("moved");
        fs::rename(&path, &moved).unwrap();
        symlink(&outside, &path).unwrap();
        assert!(pinned.read_regular(OsStr::new("external.theme.json"), Some(65536)).is_err());
        assert!(pinned.names().unwrap().contains(&OsString::from("catppuccin-latte.theme.json")));
        assert!(ConfigDirectory::open(&path, true).is_err());
        pinned.atomic_write(OsStr::new("proof.json"), b"pinned").unwrap();
        assert_eq!(fs::read(moved.join("proof.json")).unwrap(), b"pinned");
        assert!(!outside.join("proof.json").exists());
        // Replacing a file with a symlink after discovery still cannot read its target.
        fs::remove_file(moved.join("catppuccin-latte.theme.json")).unwrap();
        symlink(outside.join("external.theme.json"), moved.join("catppuccin-latte.theme.json")).unwrap();
        assert!(pinned.read_regular(OsStr::new("catppuccin-latte.theme.json"), Some(65536)).is_err());
    }
}
