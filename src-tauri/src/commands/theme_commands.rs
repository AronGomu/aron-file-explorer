use crate::state::SettingsState;
use crate::themes::catalog::{ThemeCatalog, ThemeFailure, ThemeState};
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Serialize)]
pub struct SelectionResult {
    pub active_theme_id: String,
}

#[tauri::command]
pub fn get_theme_catalog(state: tauri::State<'_, ThemeState>) -> Result<ThemeCatalog, ThemeFailure> {
    let registry = state.registry.lock().map_err(|_| ThemeFailure::io())?;
    if registry.catalog.directory.is_empty() { return Err(ThemeFailure::io()); }
    Ok(registry.catalog.clone())
}

#[tauri::command]
pub fn set_active_theme_id(
    id: String,
    themes: tauri::State<'_, ThemeState>,
    settings: tauri::State<'_, Arc<Mutex<SettingsState>>>,
) -> Result<SelectionResult, ThemeFailure> {
    set_active_theme_id_impl(id, &themes, &settings)
}

pub(crate) fn set_active_theme_id_impl(
    id: String, themes: &ThemeState, settings: &Arc<Mutex<SettingsState>>,
) -> Result<SelectionResult, ThemeFailure> {
    // Hold registry validation through persistence. Never acquire these locks in reverse order.
    let registry = themes.registry.lock().map_err(|_| ThemeFailure::io())?;
    if id != "system" && !registry.catalog.themes.iter().any(|theme| theme.id == id) {
        return Err(ThemeFailure::unavailable());
    }
    let settings = settings.lock().map_err(|_| ThemeFailure::save())?;
    settings.save_active_theme_id(&id).map_err(|_| ThemeFailure::save())?;
    Ok(SelectionResult { active_theme_id: id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::settings_commands::{update_multiple_settings_impl, update_settings_field_impl, reset_settings_impl};
    use crate::state::THEME_SELECTION_COMMAND;
    use serde_json::{json, Value};
    use std::fs;

    #[test]
    fn theme_switch_reload_race() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let directory = temp.path().join("themes");
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let themes = Arc::new(ThemeState::at(directory.clone()));
        let held_settings = settings.lock().unwrap();
        let save = {
            let settings = settings.clone(); let themes = themes.clone();
            std::thread::spawn(move || set_active_theme_id_impl("catppuccin-latte".into(), &themes, &settings))
        };
        let deadline = Instant::now() + Duration::from_secs(2);
        while themes.registry.try_lock().is_ok() {
            assert!(Instant::now() < deadline, "selection must acquire registry before settings");
            std::thread::yield_now();
        }
        fs::remove_file(directory.join("catppuccin-latte.theme.json")).unwrap();
        let (done, receiver) = mpsc::channel();
        let reload = {
            let themes = themes.clone();
            std::thread::spawn(move || {
                themes.registry.lock().unwrap().reload(&directory, &Default::default(), None);
                done.send(()).unwrap();
            })
        };
        assert!(receiver.recv_timeout(Duration::from_millis(30)).is_err());
        drop(held_settings);
        assert_eq!(save.join().unwrap().unwrap().active_theme_id, "catppuccin-latte");
        receiver.recv_timeout(Duration::from_secs(2)).unwrap(); reload.join().unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap()["active_theme_id"], "catppuccin-latte");
        let before = fs::read(&path).unwrap();
        assert_eq!(set_active_theme_id_impl("catppuccin-latte".into(), &themes, &settings).unwrap_err().code, "unavailable");
        assert_eq!(fs::read(path).unwrap(), before);
    }

    #[test]
    fn theme_selection_unknown_and_generic_bypass() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let themes = ThemeState::at(temp.path().join("themes"));
        let before = fs::read(&path).unwrap();
        let failure = set_active_theme_id_impl("unknown".into(), &themes, &settings).unwrap_err();
        assert_eq!(serde_json::to_value(failure).unwrap(), json!({"code":"unavailable","message":"Theme is unavailable"}));
        for key in ["active_theme_id", "active_theme_id.value"] {
            assert_eq!(update_settings_field_impl(settings.clone(), key.into(), json!("unknown")).unwrap_err(), THEME_SELECTION_COMMAND);
            let updates = json!({"abs_file_path_buf": "/must-not-write", key: "unknown", "show_details_panel": true});
            assert_eq!(update_multiple_settings_impl(settings.clone(), updates.as_object().unwrap().clone()).unwrap_err(), THEME_SELECTION_COMMAND);
        }
        assert_eq!(fs::read(path).unwrap(), before);
    }
    #[test]
    fn theme_settings_raw_migration_selection_reset() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let redirect = temp.path().join("must-not-write.json");
        let original = json!({"darkmode":true,"custom_themes":["old"],"default_theme":"old","default_themes_path":"old","accent_color":"#ffffff",
            "abs_file_path_buf":redirect,"show_details_panel":true,"unrelated":{"nested":[1,"keep"]},"backend_settings":{"logging_config":{"custom":{"keep":true}}}});
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let mut migrated = original.clone();
        for key in ["darkmode", "custom_themes", "default_theme", "default_themes_path", "accent_color"] { migrated.as_object_mut().unwrap().remove(key); }
        migrated["active_theme_id"] = json!("system");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(), migrated);
        let themes = ThemeState::at(temp.path().join("themes"));
        set_active_theme_id_impl("catppuccin-mocha".into(), &themes, &settings).unwrap();
        migrated["active_theme_id"] = json!("catppuccin-mocha");
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).unwrap(), migrated);
        update_settings_field_impl(settings.clone(), "backend_settings.logging_config.logging_level".into(), json!("Minimal")).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["unrelated"], original["unrelated"]);
        assert_eq!(saved["backend_settings"]["logging_config"]["custom"], original["backend_settings"]["logging_config"]["custom"]);
        assert_eq!(saved["backend_settings"]["logging_config"]["logging_level"], "Minimal");
        assert!(!redirect.exists());
        reset_settings_impl(settings.clone()).unwrap();
        let state = settings.lock().unwrap();
        let memory = state.0.lock().unwrap();
        assert_eq!(memory.active_theme_id, "system");
        assert_eq!(memory.abs_file_path_buf, path);
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap()["active_theme_id"], "system");
        assert!(!redirect.exists());
    }
    #[cfg(unix)]
    #[test]
    fn theme_selection_save_failure_and_reset_failure() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config"); fs::create_dir(&config).unwrap();
        let path = config.join("settings.json");
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let themes = ThemeState::at(temp.path().join("themes"));
        set_active_theme_id_impl("catppuccin-mocha".into(), &themes, &settings).unwrap();
        let before = fs::read(&path).unwrap();
        fs::set_permissions(&config, fs::Permissions::from_mode(0o500)).unwrap();
        let selection = set_active_theme_id_impl("catppuccin-latte".into(), &themes, &settings);
        let reset = reset_settings_impl(settings.clone());
        let generic = update_settings_field_impl(settings.clone(), "show_details_panel".into(), json!(true));
        fs::set_permissions(&config, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(selection.unwrap_err().code, "save");
        assert!(reset.is_err()); assert!(generic.is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(settings.lock().unwrap().0.lock().unwrap().active_theme_id, "catppuccin-mocha");
        assert!(!settings.lock().unwrap().0.lock().unwrap().show_details_panel);
        assert_eq!(fs::read_dir(config).unwrap().count(), 1);
    }
    #[test]
    fn theme_settings_malformed_blocks_every_save() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json"); fs::write(&path, b"{bad").unwrap();
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let themes = ThemeState::at(temp.path().join("themes"));
        assert_eq!(set_active_theme_id_impl("system".into(), &themes, &settings).unwrap_err().code, "save");
        assert!(reset_settings_impl(settings.clone()).is_err());
        assert!(update_settings_field_impl(settings.clone(), "show_details_panel".into(), json!(true)).is_err());
        assert_eq!(fs::read(path).unwrap(), b"{bad");
    }
    #[test]
    fn theme_concurrent_selection_and_settings_disk_match_memory() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        let settings = Arc::new(Mutex::new(SettingsState::new_with_path(path.clone())));
        let themes = Arc::new(ThemeState::at(temp.path().join("themes")));
        let mut workers = Vec::new();
        for index in 0..8 {
            let settings = settings.clone(); let themes = themes.clone();
            workers.push(std::thread::spawn(move || {
                for _ in 0..8 {
                    let id = if index % 2 == 0 { "catppuccin-latte" } else { "catppuccin-mocha" };
                    set_active_theme_id_impl(id.into(), &themes, &settings).unwrap();
                    update_settings_field_impl(settings.clone(), "show_details_panel".into(), json!(index % 2 == 0)).unwrap();
                }
            }));
        }
        for worker in workers { worker.join().unwrap(); }
        let disk: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let state = settings.lock().unwrap(); let memory = state.0.lock().unwrap();
        assert_eq!(disk["active_theme_id"], memory.active_theme_id);
        assert_eq!(disk["show_details_panel"], memory.show_details_panel);
    }
}
