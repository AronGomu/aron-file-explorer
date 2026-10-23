use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApplication {
    id: String,
    name: String,
    is_default: bool,
}

#[cfg(target_os = "linux")]
mod linux {
    use gio::prelude::*;
    use std::collections::HashSet;

    pub fn content_type(path: &str) -> Result<String, String> {
        if let Ok(info) = gio::File::for_path(path).query_info(
            "standard::content-type", gio::FileQueryInfoFlags::NONE, gio::Cancellable::NONE,
        ) {
            if let Some(content_type) = info.content_type() {
                return Ok(content_type.to_string());
            }
        }
        // Remote files can be matched by name without downloading their contents.
        // Pass NULL: an empty data buffer would identify an empty file instead.
        let filename = std::ffi::CString::new(path).map_err(|error| error.to_string())?;
        let content_type: gtk::glib::GString = unsafe {
            gtk::glib::translate::from_glib_full(gio::ffi::g_content_type_guess(
                filename.as_ptr(), std::ptr::null(), 0, std::ptr::null_mut(),
            ))
        };
        Ok(content_type.to_string())
    }

    pub fn applications(content_type: &str) -> Vec<gio::AppInfo> {
        let mut applications = gio::AppInfo::all_for_type(content_type);
        if let Some(default) = gio::AppInfo::default_for_type(content_type, false) {
            applications.insert(0, default);
        }
        let mut seen = HashSet::new();
        applications.retain(|app| {
            (app.supports_files() || app.supports_uris()) &&
                app.id().is_some_and(|id| seen.insert(id.to_string()))
        });
        applications
    }

    pub fn list(path: &str) -> Result<Vec<super::OpenWithApplication>, String> {
        let content_type = content_type(path)?;
        let default = gio::AppInfo::default_for_type(&content_type, false).and_then(|app| app.id());
        let mut applications: Vec<_> = applications(&content_type).into_iter().map(|app| {
            let id = app.id().unwrap();
            super::OpenWithApplication {
                is_default: default.as_ref() == Some(&id),
                id: id.to_string(),
                name: app.display_name().to_string(),
            }
        }).collect();
        applications.sort_by(|a, b| b.is_default.cmp(&a.is_default)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id)));
        Ok(applications)
    }

    pub fn launch(path: &str, application_id: &str) -> Result<(), String> {
        if !std::path::Path::new(path).is_file() {
            return Err("Select an existing file to open.".into());
        }
        let app = applications(&content_type(path)?).into_iter()
            .find(|app| app.id().as_deref() == Some(application_id))
            .ok_or("This application is no longer available for this file type.")?;
        app.launch(&[gio::File::for_path(path)], gio::AppLaunchContext::NONE)
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn get_open_with_applications(path: String) -> Result<Vec<OpenWithApplication>, String> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(move || linux::list(&path))
        .await.map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "linux"))]
    { let _ = path; Err("Application selection is only available on Linux.".into()) }
}

#[tauri::command]
pub async fn open_file_with_application(path: String, application_id: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return tauri::async_runtime::spawn_blocking(move || linux::launch(&path, &application_id))
        .await.map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "linux"))]
    { let _ = (path, application_id); Err("Application selection is only available on Linux.".into()) }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux;

    #[test]
    fn detects_local_contents_and_remote_filenames() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("no-extension");
        std::fs::write(&path, b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n").unwrap();
        assert_eq!(linux::content_type(path.to_str().unwrap()).unwrap(), "application/pdf");
        assert_eq!(linux::content_type("remote-video.mp4").unwrap(), "video/mp4");
        assert_eq!(linux::content_type("remote-notes.txt").unwrap(), "text/plain");
    }

    #[test]
    fn rejects_missing_files_directories_and_unmatched_programs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.txt");
        assert!(linux::launch(path.to_str().unwrap(), "missing.desktop").is_err());
        assert!(linux::launch(directory.path().to_str().unwrap(), "missing.desktop").is_err());
        std::fs::write(&path, "Some text\n").unwrap();
        assert!(linux::launch(path.to_str().unwrap(), "missing.desktop").is_err());
    }
}
