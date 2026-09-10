use crate::constants;
use super::config_file::ConfigDirectory;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io;
use std::io::Error;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use crate::models::backend_settings::BackendSettings;

//In this file we should change everything to lowercase for the json -> first step is done in DefaultView
/// File view mode for directories.
///
/// Controls how files and directories are displayed in the UI.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[allow(non_camel_case_types)]
pub enum DefaultView {
    grid,
    list,
    details,
}

/// Font size setting for UI elements.
///
/// Controls the text size throughout the application.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum FontSize {
    Small,
    Medium,
    Large,
}

/// Direction for sorting files and directories.
///
/// Controls whether items are sorted in ascending or descending order.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum SortDirection {
    Acscending,
    Descending,
}

/// Property used for sorting files and directories.
///
/// Determines which attribute is used when ordering items.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum SortBy {
    Name,
    Size,
    Date,
    Type,
}

/// Behavior configuration for double-click actions.
///
/// Controls what happens when a user double-clicks on items.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub enum DoubleClick {
    OpenFilesAndFolders,
    SelectFilesAndFolders,
}

/// Application settings configuration.
///
/// This struct contains all configurable options for the application,
/// including appearance, behavior, and file operation preferences.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Settings {
    /// Requested plugin ID or System mode.
    pub active_theme_id: String,
    /// Default directory to open when application starts
    pub default_folder_path_on_opening: PathBuf,
    /// Default view mode for directories
    pub default_view: DefaultView,
    /// Font size setting for UI elements
    pub font_size: FontSize,
    /// Whether to display hidden files and folders
    pub show_hidden_files_and_folders: bool,
    /// Whether to show the details panel by default
    pub show_details_panel: bool,
    /// Whether to prompt for confirmation before deleting files
    pub confirm_delete: bool,
    /// Whether to automatically refresh directory contents
    pub auto_refresh_dir: bool,
    /// Direction for sorting items
    pub sort_direction: SortDirection,
    /// Property to use for sorting items
    pub sort_by: SortBy,
    /// Behavior for double-click actions
    pub double_click: DoubleClick,
    /// Whether to display file extensions
    pub show_file_extensions: bool,
    /// Height of the terminal panel in pixels
    pub terminal_height: u32,
    /// Whether to enable UI animations and transitions
    pub enable_animations_and_transitions: bool,
    /// Whether to use virtual scrolling for large directories
    pub enable_virtual_scroll_for_large_directories: bool,
    /// Absolute path to the settings file
    pub abs_file_path_buf: PathBuf,
    // need to implement
    /// Whether to enable suggestions in the application
    pub enable_suggestions: bool,
    /// Whether to highlight matches in search results
    pub highlight_matches: bool,

    /// Backend settings for the application
    pub backend_settings: BackendSettings,
    #[serde(skip)]
    raw_values: serde_json::Map<String, Value>,
}

//TODO implement the default settings -> talk to Lauritz for further more information
impl Default for Settings {
    fn default() -> Self {
        Settings {
            active_theme_id: "system".to_string(),
            default_folder_path_on_opening: Default::default(),
            abs_file_path_buf: constants::SETTINGS_CONFIG_ABS_PATH.to_path_buf(),
            default_view: DefaultView::grid,
            font_size: FontSize::Medium,
            show_hidden_files_and_folders: false,
            show_details_panel: false,
            confirm_delete: true,
            auto_refresh_dir: true,
            sort_direction: SortDirection::Acscending,
            sort_by: SortBy::Name,
            double_click: DoubleClick::OpenFilesAndFolders,
            show_file_extensions: true,
            terminal_height: 240,
            enable_animations_and_transitions: true,
            enable_virtual_scroll_for_large_directories: false,
            enable_suggestions: true, //implement?
            highlight_matches: true, // implement?
            backend_settings: BackendSettings::default(),
            raw_values: serde_json::Map::new(),
            
        }
    }
}

/// Thread-safe state for application settings.
///
/// This struct provides methods for reading, writing, and modifying application settings
/// while ensuring thread safety through a mutex-protected shared state.
pub struct SettingsState(pub Arc<Mutex<Settings>>, PathBuf, Option<String>);

pub const SETTINGS_LOAD_ERROR: &str = "Could not load settings. Defaults are temporary; existing file was not changed.";
pub const THEME_SELECTION_COMMAND: &str = "Use set_active_theme_id for theme selection";
pub struct SettingsLoadStatus(pub Option<String>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub settings: Value,
    pub load_error: Option<String>,
}

pub fn load_settings_state() -> (SettingsState, SettingsLoadStatus) {
    SettingsState::load_at(Settings::default().abs_file_path_buf)
}

fn merge_values(target: &mut Value, source: Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge_values(target.entry(key).or_insert(Value::Null), value.clone());
        }
    } else {
        *target = source;
    }
}

fn migrate(map: &mut serde_json::Map<String, Value>) -> bool {
    let mut changed = false;
    for key in ["darkmode", "custom_themes", "default_theme", "default_themes_path", "accent_color"] {
        changed |= map.remove(key).is_some();
    }
    if !map.contains_key("active_theme_id") {
        map.insert("active_theme_id".into(), Value::String("system".into()));
        changed = true;
    }
    changed
}

impl SettingsState {
    /// Creates a new SettingsState instance.
    ///
    /// This method initializes settings by:
    /// 1. Checking if a settings file exists at the default path
    /// 2. If it exists, attempting to read settings from that file
    /// 3. If reading fails or no file exists, creating default settings
    ///
    /// # Returns
    ///
    /// A new SettingsState instance with either loaded or default settings.
    ///
    /// # Example
    ///
    /// ```rust
    /// let settings_state = SettingsState::new();
    /// ```
    pub fn new() -> Self {
        load_settings_state().0
    }

    fn load_at(path: PathBuf) -> (Self, SettingsLoadStatus) {
        let loaded = (|| -> io::Result<Settings> {
            let directory = ConfigDirectory::open(path.parent().ok_or_else(|| Error::new(io::ErrorKind::InvalidInput, "Invalid settings path"))?, true)?;
            let name = path.file_name().ok_or_else(|| Error::new(io::ErrorKind::InvalidInput, "Invalid settings path"))?;
            let (mut raw, missing) = match directory.read_regular(name, None) {
                Ok(bytes) => (serde_json::from_slice::<Value>(&bytes)?.as_object().cloned()
                    .ok_or_else(|| Error::new(io::ErrorKind::InvalidData, "Settings is not a JSON object"))?, false),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let mut defaults = Settings::default();
                    defaults.abs_file_path_buf = path.clone();
                    (Self::settings_to_json_map(&defaults)?, true)
                }
                Err(error) => return Err(error),
            };
            let changed = migrate(&mut raw);
            let settings = Self::typed_view(raw.clone(), &path)?;
            if missing || changed { directory.atomic_write(name, &serde_json::to_vec_pretty(&raw)?)?; }
            Ok(settings)
        })();
        let (settings, error) = match loaded {
            Ok(settings) => (settings, None),
            Err(_) => {
                let mut defaults = Settings::default();
                defaults.abs_file_path_buf = path.clone();
                (defaults, Some(SETTINGS_LOAD_ERROR.to_string()))
            }
        };
        (Self(Arc::new(Mutex::new(settings)), path, error.clone()), SettingsLoadStatus(error))
    }

    fn typed_view(raw: serde_json::Map<String, Value>, path: &PathBuf) -> io::Result<Settings> {
        let mut merged = serde_json::to_value(Settings::default())?;
        merge_values(&mut merged, Value::Object(raw.clone()));
        // The serialized path is historical data, never authority to redirect a write.
        merged["abs_file_path_buf"] = serde_json::to_value(path)?;
        let mut settings: Settings = serde_json::from_value(merged)?;
        settings.abs_file_path_buf = path.clone();
        settings.raw_values = raw;
        Ok(settings)
    }

    fn raw_for_save(&self) -> io::Result<(ConfigDirectory, serde_json::Map<String, Value>)> {
        if self.2.is_some() { return Err(Error::new(io::ErrorKind::InvalidData, SETTINGS_LOAD_ERROR)); }
        let directory = ConfigDirectory::open(self.1.parent().unwrap(), false)?;
        let bytes = directory.read_regular(self.1.file_name().unwrap(), None)?;
        let mut raw = serde_json::from_slice::<Value>(&bytes)?.as_object().cloned()
            .ok_or_else(|| Error::new(io::ErrorKind::InvalidData, "Settings is not a JSON object"))?;
        migrate(&mut raw);
        Self::typed_view(raw.clone(), &self.1)?;
        Ok((directory, raw))
    }

    fn commit(&self, settings: &mut Settings, directory: &ConfigDirectory, raw: serde_json::Map<String, Value>) -> io::Result<Settings> {
        let next = Self::typed_view(raw.clone(), &self.1)?;
        directory.atomic_write(self.1.file_name().unwrap(), &serde_json::to_vec_pretty(&raw)?)?;
        *settings = next.clone();
        Ok(next)
    }

    pub(crate) fn save_active_theme_id(&self, id: &str) -> io::Result<()> {
        let mut settings = self.0.lock().map_err(|_| Error::new(io::ErrorKind::Other, "Failed to acquire settings lock"))?;
        let (directory, mut raw) = self.raw_for_save()?;
        raw.insert("active_theme_id".into(), Value::String(id.to_string()));
        self.commit(&mut settings, &directory, raw)?;
        Ok(())
    }

    /// Converts a Settings struct to a JSON map representation.
    ///
    /// This function serializes the settings object into a serde_json Map structure
    /// for easier manipulation of individual fields.
    ///
    /// # Arguments
    ///
    /// * `settings` - A reference to the Settings struct to be converted.
    ///
    /// # Returns
    ///
    /// * `Ok(Map<String, Value>)` - A map of setting keys to their values if successful.
    /// * `Err(Error)` - If serialization fails or the result is not a JSON object.
    ///
    /// # Example
    ///
    /// ```rust
    /// let settings = Settings::default();
    /// let map = settings_to_json_map(&settings)?;
    /// println!("Settings map: {:?}", map);
    /// ```
    pub fn settings_to_json_map(
        settings: &Settings,
    ) -> Result<serde_json::Map<String, Value>, Error> {
        let mut settings_value = serde_json::to_value(settings)
            .map_err(|e| Error::new(io::ErrorKind::Other, e))?;
        merge_values(&mut settings_value, Value::Object(settings.raw_values.clone()));
        settings_value["abs_file_path_buf"] = serde_json::to_value(&settings.abs_file_path_buf)?;

        settings_value.as_object().cloned().ok_or_else(|| {
            Error::new(
                io::ErrorKind::InvalidData,
                "Settings is not a JSON object",
            )
        })
    }

    /// Updates a single setting field with a new value.
    ///
    /// This method updates a specific setting identified by its key, validates that the
    /// key exists, and writes the updated settings to file.
    ///
    /// # Arguments
    ///
    /// * `&self` - Reference to the settings state.
    /// * `key` - A string slice identifying the setting to update.
    /// * `value` - The new value to assign to the setting.
    ///
    /// # Returns
    ///
    /// * `Ok(Settings)` - The updated Settings struct if successful.
    /// * `Err(io::Error)` - If the key doesn't exist or there's an error saving the settings.
    ///
    /// # Example
    ///
    /// ```rust
    /// let result = settings_state.update_setting_field("theme", json!("dark"))?;
    /// println!("Updated settings: {:?}", result);
    /// ```
    pub fn update_setting_field(&self, key: &str, value: Value) -> Result<Settings, Error> {
        if key.split('.').next() == Some("active_theme_id") {
            return Err(Error::new(io::ErrorKind::InvalidInput, THEME_SELECTION_COMMAND));
        }
        let mut settings = self.0.lock().map_err(|_| Error::new(io::ErrorKind::Other, "Failed to acquire settings lock"))?;
        let (directory, mut raw) = self.raw_for_save()?;
        let mut view = Self::settings_to_json_map(&Self::typed_view(raw.clone(), &self.1)?)?;
        let path: Vec<&str> = key.split('.').collect();
        if !view.contains_key(path[0]) {
            return Err(Error::new(io::ErrorKind::InvalidInput, format!("Unknown settings key: {}", key)));
        }
        Self::update_nested_field(&mut view, &path, value.clone())?;
        // Validate with defaults, but persist only the requested field, preserving raw extras.
        Self::typed_view(view, &self.1)?;
        fn patch(obj: &mut serde_json::Map<String, Value>, path: &[&str], value: Value) {
            let entry = obj.entry(path[0]).or_insert_with(|| Value::Object(Default::default()));
            if path.len() == 1 { merge_values(entry, value); }
            else { patch(entry.as_object_mut().expect("validated object path"), &path[1..], value); }
        }
        patch(&mut raw, &path, value);
        self.commit(&mut settings, &directory, raw)
    }

    /// Helper method to update a nested field in a JSON object using a path.
    ///
    /// # Arguments
    ///
    /// * `obj` - The JSON object to modify
    /// * `path` - Vector of path segments (field names)
    /// * `value` - The new value to set
    ///
    /// # Returns
    ///
    /// * `Ok(bool)` - True if the update was successful
    /// * `Err(Error)` - If the path is invalid
    fn update_nested_field(
        obj: &mut serde_json::Map<String, Value>,
        path: &[&str],
        value: Value,
    ) -> Result<bool, Error> {
        if path.is_empty() {
            return Ok(false);
        }

        if path.len() == 1 {
            // Base case: directly update the field
            obj.insert(path[0].to_string(), value);
            return Ok(true);
        }

        // Recursive case: traverse the path
        let field = path[0];

        if let Some(Value::Object(nested_obj)) = obj.get_mut(field) {
            let sub_path = &path[1..];
            return Self::update_nested_field(nested_obj, sub_path, value);
        }

        Err(Error::new(
            io::ErrorKind::InvalidInput,
            format!("Invalid nested path at: {}", field),
        ))
    }

    /// Retrieves the value of a specific setting field.
    ///
    /// This method gets the value of a setting identified by its key.
    ///
    /// # Arguments
    ///
    /// * `&self` - Reference to the settings state.
    /// * `key` - A string slice identifying the setting to retrieve.
    ///
    /// # Returns
    ///
    /// * `Ok(Value)` - The value of the requested setting if found.
    /// * `Err(Error)` - If the key doesn't exist or there's an error accessing the settings.
    ///
    /// # Example
    ///
    /// ```rust
    /// let theme = settings_state.get_setting_field("theme")?;
    /// println!("Current theme: {}", theme);
    /// ```
    pub fn get_setting_field(&self, key: &str) -> Result<Value, Error> {
        let settings = self.0.lock().map_err(|_| io::Error::new(io::ErrorKind::Other, "Failed to acquire settings lock"))?;
        let settings_value =
            serde_json::to_value(&*settings).map_err(|e| Error::new(io::ErrorKind::Other, e))?;

        if let Some(obj) = settings_value.as_object() {
            // Handle nested fields with dot notation
            if key.contains('.') {
                let path: Vec<&str> = key.split('.').collect();
                return Self::get_nested_field(obj, &path);
            }

            // Handle top-level fields
            obj.get(key).cloned().ok_or_else(|| {
                Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("Unknown settings key: {}", key),
                )
            })
        } else {
            Err(Error::new(
                io::ErrorKind::InvalidData,
                "Failed to serialize settings to object",
            ))
        }
    }

    /// Helper method to get a nested field from a JSON object using a path.
    ///
    /// # Arguments
    ///
    /// * `obj` - The JSON object to retrieve from
    /// * `path` - Vector of path segments (field names)
    ///
    /// # Returns
    ///
    /// * `Ok(Value)` - The value at the specified path if found
    /// * `Err(Error)` - If the path is invalid or not found
    fn get_nested_field(
        obj: &serde_json::Map<String, Value>,
        path: &[&str],
    ) -> Result<Value, Error> {
        if path.is_empty() {
            return Err(Error::new(
                io::ErrorKind::InvalidInput,
                "Empty path provided",
            ));
        }

        let field = path[0];

        if let Some(value) = obj.get(field) {
            if path.len() == 1 {
                // Base case: return the value
                return Ok(value.clone());
            }

            // Recursive case: continue traversing
            if let Some(nested_obj) = value.as_object() {
                return Self::get_nested_field(nested_obj, &path[1..]);
            } else {
                return Err(Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("Cannot traverse into non-object field: {}", field),
                ));
            }
        }

        Err(Error::new(
            io::ErrorKind::InvalidInput,
            format!("Unknown settings key: {}", path.join(".")),
        ))
    }

    /// Updates multiple settings fields at once.
    ///
    /// This method applies a batch of updates to the settings in a single operation,
    /// writing the updated settings to file.
    ///
    /// # Arguments
    ///
    /// * `&self` - Reference to the settings state.
    /// * `updates` - A map of setting keys to their new values.
    ///
    /// # Returns
    ///
    /// * `Ok(Settings)` - The final updated Settings struct if successful.
    /// * `Err(io::Error)` - If any key doesn't exist, no updates were provided, or there's an error saving the settings.
    ///
    /// # Example
    ///
    /// ```rust
    /// let mut updates = serde_json::Map::new();
    /// updates.insert("theme".to_string(), json!("dark"));
    /// updates.insert("notifications".to_string(), json!(true));
    ///
    /// let result = settings_state.update_multiple_settings(&updates)?;
    /// println!("Updated settings: {:?}", result);
    /// ```
    pub fn update_multiple_settings(
        &self,
        updates: &serde_json::Map<String, Value>,
    ) -> Result<Settings, Error> {
        if updates.keys().any(|key| key.split('.').next() == Some("active_theme_id")) {
            return Err(Error::new(io::ErrorKind::InvalidInput, THEME_SELECTION_COMMAND));
        }
        let mut last_updated_settings = None;

        for (key, value) in updates {
            // We reuse the existing function here
            let updated = self.update_setting_field(key, value.clone())?;
            last_updated_settings = Some(updated);
        }

        // Return the last successful update
        last_updated_settings
            .ok_or_else(|| Error::new(io::ErrorKind::InvalidInput, "No settings were provided"))
    }

    /// Resets all settings to their default values.
    ///
    /// This method replaces the current settings with the default values
    /// and writes these defaults to the settings file.
    ///
    /// # Arguments
    ///
    /// * `&self` - Reference to the settings state.
    ///
    /// # Returns
    ///
    /// * `Ok(Settings)` - The default Settings struct if successful.
    /// * `Err(io::Error)` - If there was an error during the reset process.
    ///
    /// # Example
    ///
    /// ```rust
    /// let result = settings_state.reset_settings();
    /// match result {
    ///     Ok(settings) => println!("Settings have been reset to defaults."),
    ///     Err(e) => eprintln!("Failed to reset settings: {}", e),
    /// }
    /// ```
    pub fn reset_settings(&self) -> Result<Settings, Error> {
        let mut settings = self.0.lock().map_err(|_| Error::new(io::ErrorKind::Other, "Failed to acquire settings lock"))?;
        let (directory, _) = self.raw_for_save()?;
        let mut defaults = Settings::default();
        defaults.abs_file_path_buf = self.1.clone();
        self.commit(&mut settings, &directory, Self::settings_to_json_map(&defaults)?)
    }

    #[cfg(test)]
    pub fn new_with_path(path: PathBuf) -> Self {
        Self::load_at(path).0
    }

    #[cfg(test)]
    pub fn read_settings_from_file(path: &PathBuf) -> io::Result<Settings> {
        let directory = ConfigDirectory::open(path.parent().unwrap(), false)?;
        let bytes = directory.read_regular(path.file_name().unwrap(), None)?;
        let mut raw = serde_json::from_slice::<Value>(&bytes)?.as_object().cloned()
            .ok_or_else(|| Error::new(io::ErrorKind::InvalidData, "Settings is not a JSON object"))?;
        migrate(&mut raw);
        Self::typed_view(raw, path)
    }
}

#[cfg(test)]
mod tests_settings {
    use super::*;
    use serde_json::{json, Map, Value};
    use tempfile::tempdir;
    use crate::models::LoggingLevel;
    use crate::commands::hash_commands::ChecksumMethod;

    /// Tests that the default settings have the expected initial values.
    ///
    /// Verifies that a newly created Settings instance has the correct
    /// default values for all properties.
    #[test]
    fn test_default_settings() {
        let settings = Settings::default();
        assert_eq!(settings.show_hidden_files_and_folders, false);
        assert_eq!(settings.default_folder_path_on_opening, PathBuf::new());
        //assert_eq!(settings.default_folder_path_on_opening, Default::default());
        assert_eq!(settings.backend_settings.default_checksum_hash, ChecksumMethod::SHA256);
        assert_eq!(settings.backend_settings.logging_config.logging_level, LoggingLevel::Full);
        assert_eq!(
            settings.abs_file_path_buf,
            constants::SETTINGS_CONFIG_ABS_PATH.to_path_buf()
        );
    }

    /// Tests the creation of a new SettingsState with a custom path.
    ///
    /// Verifies that:
    /// 1. The settings file is created at the specified path
    /// 2. The file can be read back
    /// 3. The read settings have the expected default values
    /// 4. The path in the settings matches the custom path
    #[test]
    fn test_settings_state_creation() {
        // Create a temporary directory
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let test_path = temp_dir.path().join("settings.json");

        // Create a new Settings with our test path
        let _settings_state = SettingsState::new_with_path(test_path.clone());

        // Verify the file was created
        assert!(
            test_path.exists(),
            "Settings file should exist after creation"
        );

        // Read the file and verify its contents
        let read_result = SettingsState::read_settings_from_file(&test_path);
        assert!(read_result.is_ok(), "Should be able to read settings file");

        let settings = read_result.unwrap();
        assert_eq!(settings.show_hidden_files_and_folders, false);
        assert_eq!(settings.default_folder_path_on_opening, PathBuf::new());
        //assert_eq!(settings.default_folder_path_on_opening, Default::default());
        assert_eq!(settings.abs_file_path_buf, test_path);
    }

    #[test]
    fn test_init_settings_json_exists() {
        // Create a temporary directory
        let temp_dir = tempdir().expect("Failed to create temporary directory");
        let test_path = temp_dir.path().join("settings.json");

        // Step 1: Create the first SettingsState and update some values
        let settings_state = SettingsState::new_with_path(test_path.clone());

        let mut updates = Map::new();
        updates.insert("show_hidden_files_and_folders".to_string(), json!(true));
        updates.insert("default_folder_path_on_opening".to_string(), json!("solarized"));

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_ok(), "Settings update should succeed");

        // Step 2: Drop the first state and reinitialize from file
        drop(settings_state);

        let loaded = SettingsState::read_settings_from_file(&test_path);
        assert!(
            loaded.is_ok(),
            "Should load settings from file after reload"
        );

        let loaded_settings = loaded.unwrap();
        assert_eq!(loaded_settings.show_hidden_files_and_folders, true);
        assert_eq!(loaded_settings.default_folder_path_on_opening, PathBuf::from("solarized"));
    }

    /// Tests updating the show_hidden_files_and_folders setting field.
    ///
    /// Verifies that:
    /// 1. The show_hidden_files_and_folders field can be updated to true
    /// 2. The returned settings object reflects the updated value
    #[test]
    fn test_update_show_hidden_files_and_folders_field() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("show_hidden_files_and_folders", json!(true));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().show_hidden_files_and_folders, true);
    }

    /// Tests updating the default_folder_path_on_opening setting field.
    ///
    /// Verifies that:
    /// 1. The default_folder_path_on_opening field can be updated to a new string value
    /// 2. The returned settings object reflects the updated value
    #[test]
    fn test_update_default_folder_path_on_opening_field() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("default_folder_path_on_opening", json!("ocean"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().default_folder_path_on_opening, PathBuf::from("ocean"));
    }

    /// Tests updating the default_checksum_hash setting field.
    ///
    /// Verifies that:
    /// 1. The default_checksum_hash field can be updated to a new string value
    /// 2. The returned settings object reflects the updated value
    #[test]
    fn test_update_default_checksum_hash_field() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("backend_settings.default_checksum_hash", json!("MD5"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().backend_settings.default_checksum_hash, ChecksumMethod::MD5);
    }

    /// Tests updating the logging_state setting field.
    ///
    /// Verifies that:
    /// 1. The logging_state field can be updated to a different enum value
    /// 2. The returned settings object reflects the updated enum value
    #[test]
    fn test_update_logging_level_field() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("backend_settings.logging_config.logging_level", json!("Minimal"));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().backend_settings.logging_config.logging_level, LoggingLevel::Minimal);
    }

    /// Tests error handling when attempting to update a non-existent key.
    ///
    /// Verifies that:
    /// 1. Attempting to update a non-existent key results in an error
    /// 2. The error message contains "Unknown settings key"
    #[test]
    fn test_invalid_key() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("non_existing_key", json!("value"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unknown settings key"));
    }

    /// Tests type validation when updating the show_hidden_files_and_folders field.
    ///
    /// Verifies that:
    /// 1. Attempting to update the show_hidden_files_and_folders field with a non-boolean value results in an error
    /// 2. The error message indicates the type mismatch
    #[test]
    fn test_invalid_type_for_show_hidden_files_and_folders() {
        let state = SettingsState::new_with_path(
            tempfile::NamedTempFile::new().unwrap().path().with_extension("settings.json"),
        );

        let result = state.update_setting_field("show_hidden_files_and_folders", json!("not_a_bool"));
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("expected a boolean") || err.contains("invalid type"));
    }

    /// Tests retrieving an existing setting field.
    ///
    /// Verifies that:
    /// 1. A previously set field can be retrieved successfully
    /// 2. The retrieved value matches what was set
    #[test]
    fn test_get_existing_field() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        // Set a known value
        settings_state
            .update_setting_field("show_hidden_files_and_folders", json!(true))
            .unwrap();

        // Call get_setting_field
        let result = settings_state.get_setting_field("show_hidden_files_and_folders");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), json!(true));
    }

    /// Tests error handling when retrieving a non-existent key.
    ///
    /// Verifies that:
    /// 1. Attempting to get a non-existent key results in an error
    /// 2. The error message contains "Unknown settings key"
    #[test]
    fn test_get_invalid_key() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let result = settings_state.get_setting_field("non_existing_key");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unknown settings key"));
    }

    /// Tests retrieving a complex field (array type).
    #[test]
    fn test_get_complex_field() {
        let temp_dir = tempdir().unwrap();
        let settings_state = SettingsState::new_with_path(temp_dir.path().join("settings.json"));
        settings_state.update_setting_field("backend_settings.search_engine_config.preferred_extensions", json!(["rs", "js"])).unwrap();
        assert_eq!(settings_state.get_setting_field("backend_settings.search_engine_config.preferred_extensions").unwrap(), json!(["rs", "js"]));
    }

    /// Tests updating multiple valid settings fields at once.
    ///
    /// Verifies that:
    /// 1. Multiple fields can be updated in a single operation
    /// 2. All updated fields have the expected values in the returned settings
    #[test]
    fn test_update_multiple_valid_fields() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let mut updates: Map<String, Value> = Map::new();
        updates.insert("show_hidden_files_and_folders".into(), Value::Bool(true));
        updates.insert("default_folder_path_on_opening".into(), Value::String("gruvbox".into()));

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_ok());

        let updated = result.unwrap();
        assert_eq!(updated.show_hidden_files_and_folders, true);
        assert_eq!(updated.default_folder_path_on_opening, PathBuf::from("gruvbox"));
    }

    /// Tests error handling when updating with an invalid key.
    ///
    /// Verifies that:
    /// 1. Attempting to update multiple settings with a non-existent key results in an error
    /// 2. The error message identifies the specific invalid key
    #[test]
    fn test_update_with_invalid_key() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let mut updates: Map<String, Value> = Map::new();
        updates.insert("non_existing_field".into(), Value::String("value".into()));

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unknown settings key: non_existing_field"));
    }

    /// Tests error handling when updating with a mix of valid and invalid keys.
    ///
    /// Verifies that:
    /// 1. When attempting to update multiple settings with both valid and invalid keys,
    ///    the operation fails with an error
    /// 2. No partial updates are applied (all-or-nothing behavior)
    /// 3. The error message identifies the specific invalid key
    #[test]
    fn test_update_with_mixed_valid_and_invalid_keys() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let mut updates: Map<String, Value> = Map::new();
        updates.insert("show_hidden_files_and_folders".into(), Value::Bool(false));
        updates.insert("unknown".into(), Value::String("oops".into()));

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unknown settings key: unknown"));
    }

    /// Tests error handling when updating with an empty updates map.
    ///
    /// Verifies that:
    /// 1. Attempting to update with an empty map results in an error
    /// 2. The error message indicates that no settings were provided
    #[test]
    fn test_update_with_empty_updates_map() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let updates: Map<String, Value> = Map::new();

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().to_string(), "No settings were provided");
    }

    /// Tests type validation when updating with an invalid value type.
    ///
    /// Verifies that:
    /// 1. Attempting to update a field with a value of the wrong type results in an error
    /// 2. The error message indicates the type mismatch
    #[test]
    fn test_update_with_invalid_value_type() {
        let temp_file = tempfile::NamedTempFile::new().unwrap();
        let settings_state = SettingsState::new_with_path(temp_file.path().with_extension("settings.json"));

        let mut updates: Map<String, Value> = Map::new();
        updates.insert("show_hidden_files_and_folders".into(), Value::String("not_a_bool".into())); // show_hidden_files_and_folders expects bool

        let result = settings_state.update_multiple_settings(&updates);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("invalid type: string"));
    }
}

#[cfg(test)]
mod theme_settings_regression {
    use super::*;
    #[test]
    fn theme_settings_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy["darkmode"] = Value::Bool(true);
        legacy["unrelated"] = serde_json::json!({"nested": [1, "keep"]});
        std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let loaded = SettingsState::read_settings_from_file(&path).unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap()["active_theme_id"], "system");
    }
    #[test]
    fn theme_settings_malformed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"{broken").unwrap();
        let _state = SettingsState::new_with_path(path.clone());
        assert_eq!(std::fs::read(&path).unwrap(), b"{broken");
    }
}

#[cfg(test)]
mod theme_snapshot_tests {
    use super::*;
    use crate::commands::settings_commands::get_settings_snapshot_impl;
    use serde_json::json;

    #[test]
    fn theme_snapshot_defaults_extras_and_load_error() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        std::fs::write(&path, br#"{"custom":{"nested":true},"backend_settings":{"logging_config":{"extra":17}}}"#).unwrap();
        let (state, status) = SettingsState::load_at(path.clone());
        let snapshot = get_settings_snapshot_impl(&Arc::new(Mutex::new(state)), &status).unwrap();
        assert!(snapshot.load_error.is_none());
        assert_eq!(snapshot.settings["active_theme_id"], "system");
        assert_eq!(snapshot.settings["custom"], json!({"nested":true}));
        assert_eq!(snapshot.settings["backend_settings"]["logging_config"]["extra"], 17);
        assert_eq!(snapshot.settings["backend_settings"]["logging_config"]["logging_level"], "Full");
        std::fs::write(&path, b"malformed").unwrap();
        let (state, status) = SettingsState::load_at(path.clone());
        let snapshot = get_settings_snapshot_impl(&Arc::new(Mutex::new(state)), &status).unwrap();
        assert_eq!(snapshot.load_error.as_deref(), Some(SETTINGS_LOAD_ERROR));
        assert_eq!(snapshot.settings["active_theme_id"], "system");
        assert_eq!(std::fs::read(path).unwrap(), b"malformed");
    }

    #[test]
    fn theme_snapshot_lock_failure_rejects_not_settings() {
        let temp = tempfile::tempdir().unwrap();
        let (state, status) = SettingsState::load_at(temp.path().join("settings.json"));
        let state = Arc::new(Mutex::new(state));
        let inner = state.lock().unwrap().0.clone();
        let poison = std::thread::spawn(move || { let _guard = inner.lock().unwrap(); panic!("fixture poison"); });
        assert!(poison.join().is_err());
        assert_eq!(get_settings_snapshot_impl(&state, &status).err().unwrap(), "Failed to acquire lock on settings state");
    }

    #[cfg(unix)]
    #[test]
    fn theme_snapshot_serialization_failure_rejects_not_settings() {
        use std::os::unix::ffi::OsStringExt;
        let temp = tempfile::tempdir().unwrap();
        let (state, status) = SettingsState::load_at(temp.path().join("settings.json"));
        state.0.lock().unwrap().abs_file_path_buf = std::ffi::OsString::from_vec(vec![0xff]).into();
        assert_eq!(get_settings_snapshot_impl(&Arc::new(Mutex::new(state)), &status).err().unwrap(), "Failed to serialize settings snapshot");
    }
}
