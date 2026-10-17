//! Native side of one portal request. No explorer session or remote paths are accepted.
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use tauri::Manager;

pub type Filter = (String, Vec<(u32, String)>);
pub type Choice = (String, String, Vec<(String, String)>, String);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub mode: String,
    pub title: String,
    pub app_id: String,
    pub parent_window: String,
    pub modal: bool,
    pub multiple: bool,
    pub directory: bool,
    pub current_folder: String,
    pub current_name: String,
    pub accept_label: String,
    pub filters: Vec<Filter>,
    pub current_filter: Option<Filter>,
    pub choices: Vec<Choice>,
    pub files: Vec<String>,
}

struct Session { request: Request, response: PathBuf, finished: Mutex<bool> }
static SESSION: OnceLock<Session> = OnceLock::new();
pub fn active() -> bool { SESSION.get().is_some() }
pub fn config_dir() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from)
        .filter(|p| p.is_absolute()).unwrap_or_else(|| home::home_dir().unwrap().join(".config"))
        .join("com.explr.chooser")
}

pub fn initialize() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != "--chooser-request") { return Ok(()); }
    if args.len() != 3 { return Err("Usage: explr-chooser --chooser-request REQUEST.json".into()); }
    let input = PathBuf::from(&args[2]);
    let meta = fs::symlink_metadata(&input).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 1_048_576 { return Err("Invalid chooser request file".into()); }
    let request: Request = serde_json::from_slice(&fs::read(&input).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if !["OpenFile", "SaveFile", "SaveFiles"].contains(&request.mode.as_str()) { return Err("Unsupported chooser mode".into()); }
    if request.mode == "SaveFiles" && request.files.is_empty() { return Err("SaveFiles requires filenames".into()); }
    for name in &request.files { validate_name(name)?; }
    SESSION.set(Session { request, response: input.with_file_name("response.json"), finished: Mutex::new(false) })
        .map_err(|_| "Chooser already initialized".to_string())
}

#[tauri::command]
pub fn get_chooser_request() -> Option<Request> {
    SESSION.get().map(|s| {
        let mut request = s.request.clone();
        if !Path::new(&request.current_folder).is_absolute() || !Path::new(&request.current_folder).is_dir() {
            request.current_folder = home::home_dir().unwrap_or_else(|| PathBuf::from("/")).to_string_lossy().into_owned();
        }
        request
    })
}

fn entry_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err("Enter a filename without path separators".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub paths: Vec<String>,
    pub folder: String,
    pub name: String,
    pub choices: Vec<(String, String)>,
    pub current_filter: Option<Filter>,
}

#[derive(Debug, Serialize)]
pub struct Checked { uris: Vec<String>, overwrite: Vec<String> }

fn validate(request: &Request, selection: &Selection) -> Result<Checked, String> {
    let mut paths = Vec::new();
    let mut overwrite = Vec::new();
    if request.mode == "OpenFile" {
        if selection.paths.is_empty() || (!request.multiple && selection.paths.len() != 1) {
            return Err("Choose the requested number of files or folders".into());
        }
        let mut seen = HashSet::new();
        for path in &selection.paths {
            let path = Path::new(path);
            if !path.is_absolute() { return Err("Choose a local absolute path".into()); }
            let metadata = fs::metadata(path).map_err(|e| format!("Selection is no longer available: {e}"))?;
            if request.directory != metadata.is_dir() || (!request.directory && !metadata.is_file()) {
                return Err(if request.directory { "Choose folders only" } else { "Choose regular files only" }.into());
            }
            if request.directory { fs::read_dir(path).map_err(|e| e.to_string())?; }
            else { fs::File::open(path).map_err(|e| e.to_string())?; }
            if seen.insert(path.to_path_buf()) { paths.push(path.to_path_buf()); }
        }
    } else {
        let folder = Path::new(&selection.folder);
        if !folder.is_absolute() || !folder.is_dir() { return Err("Choose an existing local folder".into()); }
        // Check access without creating/truncating the file the caller intends to save.
        use std::os::unix::ffi::OsStrExt;
        let c_folder = std::ffi::CString::new(folder.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        if unsafe { libc::access(c_folder.as_ptr(), libc::W_OK | libc::X_OK) } != 0 { return Err("Destination folder is not writable".into()); }
        let names = if request.mode == "SaveFiles" { request.files.clone() } else { vec![selection.name.clone()] };
        let mut reserved = HashSet::new();
        for name in names {
            validate_name(&name)?;
            let mut path = folder.join(&name);
            if request.mode == "SaveFiles" {
                let original = path.clone();
                let mut number = 1;
                while entry_exists(&path)? || reserved.contains(&path) {
                    let stem = original.file_stem().unwrap().to_string_lossy();
                    let suffix = original.extension().map(|x| format!(".{}", x.to_string_lossy())).unwrap_or_default();
                    path = folder.join(format!("{stem} ({number}){suffix}"));
                    number += 1;
                }
            } else if entry_exists(&path)? {
                if !path.is_file() { return Err("Destination already exists and is not a regular file".into()); }
                overwrite.push(path.to_string_lossy().into_owned());
            }
            reserved.insert(path.clone());
            paths.push(path);
        }
    }
    for (id, _, values, _) in &request.choices {
        let selected: Vec<_> = selection.choices.iter().filter(|(key, _)| key == id).collect();
        if selected.len() != 1 || if values.is_empty() {
            !["true", "false"].contains(&selected[0].1.as_str())
        } else { !values.iter().any(|(key, _)| key == &selected[0].1) } {
            return Err("Invalid application choice".into());
        }
    }
    if selection.choices.len() != request.choices.len() { return Err("Unexpected application choice".into()); }
    if let Some(filter) = &selection.current_filter {
        if !request.filters.contains(filter) && request.current_filter.as_ref() != Some(filter) {
            return Err("Unknown file filter".into());
        }
    }
    let uris = paths.iter().map(|p| tauri::Url::from_file_path(p).map(|u| u.to_string()).map_err(|_| "Invalid file URI".to_string())).collect::<Result<_, _>>()?;
    Ok(Checked { uris, overwrite })
}

#[tauri::command]
pub fn chooser_check(selection: Selection) -> Result<Checked, String> {
    validate(&SESSION.get().ok_or("No chooser request")?.request, &selection)
}


#[tauri::command]
pub fn chooser_new_folder(folder: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let parent = Path::new(&folder);
    if !parent.is_absolute() || !parent.is_dir() { return Err("Choose a local folder".into()); }
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn chooser_finish(app: tauri::AppHandle, selection: Option<Selection>, overwrite_confirmed: bool) -> Result<(), String> {
    let session = SESSION.get().ok_or("No chooser request")?;
    let mut finished = session.finished.lock().map_err(|e| e.to_string())?;
    if *finished { return Err("Request already completed".into()); }
    let result = if let Some(selection) = selection {
        let checked = validate(&session.request, &selection)?;
        if !checked.overwrite.is_empty() && !overwrite_confirmed { return Err("Confirm replacement of the existing file".into()); }
        serde_json::json!({"response":0,"uris":checked.uris,"choices":selection.choices,"current_filter":selection.current_filter})
    } else { serde_json::json!({"response":1}) };
    let mut file = tempfile::NamedTempFile::new_in(session.response.parent().unwrap()).map_err(|e| e.to_string())?;
    file.write_all(serde_json::to_string(&result).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist_noclobber(&session.response).map_err(|e| e.to_string())?;
    *finished = true;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn chooser_list(path: String, filter: Option<Filter>) -> Result<serde_json::Value, String> {
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let mut entries: serde_json::Value = serde_json::from_str(&crate::commands::file_system_operation_commands::open_directory(canonical.to_string_lossy().into_owned()).await?)
        .map_err(|e| e.to_string())?;
    if let (Some((_, rules)), Some(files)) = (filter, entries["files"].as_array_mut()) {
        files.retain(|file| rules.iter().any(|(kind, pattern)| {
            let name = file["name"].as_str().unwrap_or_default();
            if *kind == 0 { glob::Pattern::new(pattern).is_ok_and(|p| p.matches(name)) }
            else {
                // A non-null zero-length buffer describes an empty file to GLib.
                // Pass NULL to request filename-based MIME detection instead.
                let filename = std::ffi::CString::new(name).unwrap();
                let content_type: gtk::glib::GString = unsafe {
                    gtk::glib::translate::from_glib_full(gio::ffi::g_content_type_guess(filename.as_ptr(), std::ptr::null(), 0, std::ptr::null_mut()))
                };
                let mime = gio::content_type_get_mime_type(&content_type).unwrap_or_default();
                pattern.strip_suffix("/*").map_or(mime.as_str() == pattern, |prefix| mime.starts_with(&format!("{prefix}/")))
                    || gio::content_type_is_a(&content_type, pattern)
            }
        }));
    }
    entries["directory"] = canonical.to_string_lossy().as_ref().into();
    Ok(entries)
}

pub fn configure_window(app: &tauri::App) -> Result<(), String> {
    let Some(session) = SESSION.get() else { return Ok(()); };
    use gtk::prelude::*;
    use gtk::glib::translate::ToGlibPtr;
    let window = app.get_webview_window("main").ok_or("Missing chooser window")?;
    window.set_title(&session.request.title).map_err(|e| e.to_string())?;
    let native = window.gtk_window().map_err(|e| e.to_string())?;
    native.set_modal(session.request.modal);
    native.realize();
    if let Some(gdk_window) = native.window() {
        let display = gdk_window.display();
        let parent = &session.request.parent_window;
        // GTK3's backend-specific foreign-parent APIs are not exposed by gtk-rs.
        unsafe extern "C" {
            fn gdk_wayland_window_set_transient_for_exported(window: *mut std::ffi::c_void, handle: *const std::ffi::c_char) -> i32;
            fn gdk_x11_window_foreign_new_for_display(display: *mut std::ffi::c_void, xid: libc::c_ulong) -> *mut std::ffi::c_void;
            fn gdk_window_set_transient_for(window: *mut std::ffi::c_void, parent: *mut std::ffi::c_void);
            fn g_object_unref(object: *mut std::ffi::c_void);
        }
        let raw: *mut gtk::gdk::ffi::GdkWindow = gdk_window.to_glib_none().0;
        if let Some(handle) = parent.strip_prefix("wayland:").filter(|_| display.type_().name() == "GdkWaylandDisplay") {
            let handle = std::ffi::CString::new(handle).map_err(|e| e.to_string())?;
            if unsafe { gdk_wayland_window_set_transient_for_exported(raw.cast(), handle.as_ptr()) } == 0 { eprintln!("Could not attach chooser to its Wayland parent"); }
        } else if let Some(xid) = parent.strip_prefix("x11:").filter(|_| display.type_().name() == "GdkX11Display") {
            let xid = libc::c_ulong::from_str_radix(xid, 16).map_err(|e| e.to_string())?;
            let raw_display: *mut gtk::gdk::ffi::GdkDisplay = display.to_glib_none().0;
            unsafe {
                let foreign = gdk_x11_window_foreign_new_for_display(raw_display.cast(), xid);
                if !foreign.is_null() { gdk_window_set_transient_for(raw.cast(), foreign); g_object_unref(foreign); }
            }
        }
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(mode: &str) -> Request {
        Request { mode: mode.into(), title: "Test".into(), app_id: "test".into(), parent_window: "".into(), modal: true,
            multiple: false, directory: false, current_folder: "/".into(), current_name: "".into(), accept_label: "".into(),
            filters: vec![], current_filter: None, choices: vec![], files: vec![] }
    }
    fn selection(folder: &Path) -> Selection {
        Selection { paths: vec![], folder: folder.to_str().unwrap().into(), name: "new.txt".into(), choices: vec![], current_filter: None }
    }
    #[test]
    fn open_rejects_wrong_type_missing_file_and_excess_selection() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("sample.txt"); fs::write(&file, "sample").unwrap();
        let req = request("OpenFile"); let mut selected = selection(temp.path());
        selected.paths = vec![temp.path().to_str().unwrap().into()]; assert!(validate(&req, &selected).is_err());
        selected.paths = vec![file.to_str().unwrap().into(), file.to_str().unwrap().into()]; assert!(validate(&req, &selected).is_err());
        selected.paths.pop(); assert!(validate(&req, &selected).is_ok());
        fs::remove_file(file).unwrap(); assert!(validate(&req, &selected).is_err());
    }
    #[test]
    fn uri_encoding_and_folder_selection() {
        let temp = tempfile::tempdir().unwrap(); let folder = temp.path().join("été # folder"); fs::create_dir(&folder).unwrap();
        let mut req = request("OpenFile"); req.directory = true;
        let mut selected = selection(temp.path()); selected.paths = vec![folder.to_str().unwrap().into()];
        let checked = validate(&req, &selected).unwrap();
        assert!(checked.uris[0].contains("%20%23%20"));
        assert_eq!(tauri::Url::parse(&checked.uris[0]).unwrap().to_file_path().unwrap(), folder);
    }
    #[test]
    fn save_never_creates_or_truncates_and_requires_overwrite() {
        let temp = tempfile::tempdir().unwrap(); let req = request("SaveFile"); let selected = selection(temp.path());
        assert!(validate(&req, &selected).unwrap().overwrite.is_empty());
        let file = temp.path().join("new.txt"); assert!(!file.exists());
        fs::write(&file, "preserve").unwrap();
        assert_eq!(validate(&req, &selected).unwrap().overwrite.len(), 1);
        assert_eq!(fs::read_to_string(file).unwrap(), "preserve");
    }
    #[test]
    fn savefiles_preserves_order_and_resolves_duplicate_names() {
        let temp = tempfile::tempdir().unwrap(); fs::write(temp.path().join("a.txt"), "preserve").unwrap();
        let mut req = request("SaveFiles"); req.files = vec!["a.txt".into(), "b.txt".into(), "a.txt".into()];
        let checked = validate(&req, &selection(temp.path())).unwrap();
        let names: Vec<_> = checked.uris.iter().map(|uri| tauri::Url::parse(uri).unwrap().to_file_path().unwrap().file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["a (1).txt", "b.txt", "a (2).txt"]);
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }
    #[test]
    fn invalid_names_choices_and_filters_are_rejected() {
        let temp = tempfile::tempdir().unwrap(); let mut req = request("SaveFile"); let mut selected = selection(temp.path());
        for name in ["", ".", "..", "../escape", "bad\0name"] { selected.name = name.into(); assert!(validate(&req, &selected).is_err()); }
        selected.name = "okay".into(); req.choices = vec![("x".into(), "X".into(), vec![], "false".into())];
        assert!(validate(&req, &selected).is_err());
        selected.choices = vec![("x".into(), "true".into())]; assert!(validate(&req, &selected).is_ok());
        selected.current_filter = Some(("Unknown".into(), vec![])); assert!(validate(&req, &selected).is_err());
    }
    #[tokio::test]
    async fn filters_match_globs_mime_and_keep_folders() {
        let temp = tempfile::tempdir().unwrap(); fs::create_dir(temp.path().join("folder")).unwrap();
        for name in ["a.txt", "b.png", "c.TXT"] { fs::write(temp.path().join(name), "data").unwrap(); }
        let list = chooser_list(temp.path().to_str().unwrap().into(), Some(("Text".into(), vec![(0, "*.[tT][xX][tT]".into())]))).await.unwrap();
        assert_eq!(list["files"].as_array().unwrap().len(), 2); assert_eq!(list["directories"].as_array().unwrap().len(), 1);
        let list = chooser_list(temp.path().to_str().unwrap().into(), Some(("Images".into(), vec![(1, "image/*".into())]))).await.unwrap();
        assert_eq!(list["files"].as_array().unwrap().len(), 1); assert_eq!(list["files"][0]["name"], "b.png");
    }
}
