use serde::Serialize;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::sync::Mutex;

#[cfg(not(target_os = "macos"))]
type TrashEntry = trash::TrashItem;
#[cfg(target_os = "macos")]
struct TrashEntry {
    original: PathBuf,
    trashed: PathBuf,
}

static LAST_DELETION: Mutex<Vec<TrashEntry>> = Mutex::new(Vec::new());

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionResult {
    trashed: Vec<String>,
    failed: Vec<(String, String)>,
    undo_errors: Vec<String>,
}

#[cfg(not(target_os = "macos"))]
fn trash_one(path: &Path) -> Result<(Option<TrashEntry>, Option<String>), String> {
    // Snapshot identities so undo cannot pick an older deletion of the same path.
    let before = trash::os_limited::list().map_err(|error| error.to_string())?;
    trash::delete(path).map_err(|error| error.to_string())?;
    match trash::os_limited::list() {
        Ok(items) => {
            let entry = items.into_iter().find(|item| {
                item.original_path() == path && !before.iter().any(|old| old.id == item.id)
            });
            let warning = entry.is_none().then(|| {
                format!(
                    "{} was moved to trash, but its undo entry could not be found.",
                    path.display()
                )
            });
            Ok((entry, warning))
        }
        Err(error) => Ok((
            None,
            Some(format!(
                "{} was moved to trash, but undo is unavailable: {error}",
                path.display()
            )),
        )),
    }
}

#[cfg(target_os = "macos")]
fn trash_one(path: &Path) -> Result<(Option<TrashEntry>, Option<String>), String> {
    use cocoa::base::{id, nil, BOOL, YES};
    use cocoa::foundation::{NSAutoreleasePool, NSString};
    use objc::{class, msg_send, sel, sel_impl};
    unsafe {
        let pool = NSAutoreleasePool::new(nil);
        let string = NSString::alloc(nil).init_str(path.to_str().ok_or("Invalid UTF-8 path")?);
        let url: id = msg_send![class!(NSURL), fileURLWithPath: string];
        let manager: id = msg_send![class!(NSFileManager), defaultManager];
        let mut resulting: id = nil;
        let mut error: id = nil;
        let success: BOOL = msg_send![manager, trashItemAtURL: url resultingItemURL: &mut resulting error: &mut error];
        let result = if success == YES && resulting != nil {
            let destination: id = msg_send![resulting, path];
            let bytes: *const std::os::raw::c_char = msg_send![destination, UTF8String];
            let trashed = PathBuf::from(
                std::ffi::CStr::from_ptr(bytes)
                    .to_string_lossy()
                    .into_owned(),
            );
            Ok((
                Some(TrashEntry {
                    original: path.to_path_buf(),
                    trashed,
                }),
                None,
            ))
        } else if success == YES {
            Ok((
                None,
                Some("Moved to trash, but undo is unavailable.".into()),
            ))
        } else {
            Err("macOS could not move this item to Trash.".into())
        };
        let _: () = msg_send![string, release];
        pool.drain();
        result
    }
}

fn trash_items_impl(paths: Vec<String>, history: &mut Vec<TrashEntry>) -> DeletionResult {
    let mut result = DeletionResult::default();
    let mut entries = Vec::new();
    for path in paths {
        // Canonicalize only the parent: deleting a symlink must preserve its target.
        let absolute = Path::new(&path)
            .parent()
            .and_then(|parent| parent.canonicalize().ok())
            .and_then(|parent| Path::new(&path).file_name().map(|name| parent.join(name)));
        let outcome = absolute
            .ok_or_else(|| "Could not resolve parent directory".to_string())
            .and_then(|absolute| trash_one(&absolute));
        match outcome {
            Ok((entry, warning)) => {
                result.trashed.push(path);
                if let Some(entry) = entry {
                    entries.push(entry);
                }
                if let Some(warning) = warning {
                    result.undo_errors.push(warning);
                }
            }
            Err(error) => result.failed.push((path, error)),
        }
    }
    if !result.trashed.is_empty() {
        *history = entries;
    }
    result
}

#[tauri::command]
pub async fn trash_items(paths: Vec<String>) -> Result<DeletionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut history = LAST_DELETION.lock().map_err(|error| error.to_string())?;
        Ok(trash_items_impl(paths, &mut history))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn restore_items(history: &mut Vec<TrashEntry>) -> DeletionResult {
    let mut result = DeletionResult::default();
    history.retain(|entry| {
        #[cfg(not(target_os = "macos"))]
        let path = entry.original_path();
        #[cfg(target_os = "macos")]
        let path = entry.original.clone();
        let restored = if path.symlink_metadata().is_ok() {
            Err("An item already exists at the original path. Rename or move it before retrying undo.".to_string())
        } else {
            #[cfg(not(target_os = "macos"))]
            let restored = trash::os_limited::restore_all([entry.clone()]).map_err(|error| error.to_string());
            #[cfg(target_os = "macos")]
            let restored = std::fs::rename(&entry.trashed, &path).map_err(|error| error.to_string());
            restored
        };
        match restored {
            Ok(()) => { result.trashed.push(path.to_string_lossy().into_owned()); false }
            Err(error) => { result.failed.push((path.to_string_lossy().into_owned(), error)); true }
        }
    });
    result
}

#[tauri::command]
pub async fn undo_last_deletion() -> Result<DeletionResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut history = LAST_DELETION.lock().map_err(|error| error.to_string())?;
        Ok(restore_items(&mut history))
    })
    .await
    .map_err(|error| error.to_string())?
}

// Called only after the UI explicitly confirms unrecoverable deletion.
#[tauri::command]
pub async fn permanently_delete(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let metadata = path.symlink_metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        }
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletion_batch_restores_files_directories_and_symlinks_without_overwriting() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("undo.txt");
        let folder = directory.path().join("folder");
        std::fs::write(&file, "original").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("child"), "child").unwrap();
        let mut paths = vec![
            file.to_string_lossy().into_owned(),
            folder.to_string_lossy().into_owned(),
        ];
        #[cfg(unix)]
        {
            let link = directory.path().join("link");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            paths.insert(0, link.to_string_lossy().into_owned());
        }
        let mut history = Vec::new();
        let deleted = trash_items_impl(paths.clone(), &mut history);
        assert!(deleted.failed.is_empty(), "{:?}", deleted.failed);
        assert!(deleted.undo_errors.is_empty(), "{:?}", deleted.undo_errors);
        assert_eq!(deleted.trashed.len(), paths.len());
        assert!(!file.exists());
        std::fs::write(&file, "replacement").unwrap();
        let restored = restore_items(&mut history);
        assert_eq!(restored.failed.len(), 1);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "replacement");
        assert_eq!(
            std::fs::read_to_string(folder.join("child")).unwrap(),
            "child"
        );
        std::fs::remove_file(&file).unwrap();
        assert!(restore_items(&mut history).failed.is_empty());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
        assert!(history.is_empty());
        assert!(restore_items(&mut history).trashed.is_empty());
    }

    #[test]
    fn undo_restores_only_latest_deletion_of_the_same_path() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("same.txt");
        let path = file.to_string_lossy().into_owned();
        let mut history = Vec::new();
        std::fs::write(&file, "older deletion").unwrap();
        assert!(trash_items_impl(vec![path.clone()], &mut history)
            .failed
            .is_empty());
        let mut older = std::mem::take(&mut history);
        std::fs::write(&file, "latest deletion").unwrap();
        assert!(trash_items_impl(vec![path], &mut history).failed.is_empty());
        assert_eq!(restore_items(&mut history).trashed.len(), 1);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "latest deletion");
        std::fs::remove_file(&file).unwrap();
        assert_eq!(restore_items(&mut older).trashed.len(), 1);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "older deletion");
    }

    #[test]
    fn failed_trash_preserves_previous_undo_batch() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("keep.txt");
        std::fs::write(&file, "keep").unwrap();
        let mut history = Vec::new();
        assert!(
            trash_items_impl(vec![file.to_string_lossy().into_owned()], &mut history)
                .failed
                .is_empty()
        );
        assert_eq!(
            trash_items_impl(
                vec![directory
                    .path()
                    .join("missing")
                    .to_string_lossy()
                    .into_owned()],
                &mut history
            )
            .failed
            .len(),
            1
        );
        assert_eq!(restore_items(&mut history).trashed.len(), 1);
        assert_eq!(std::fs::read_to_string(file).unwrap(), "keep");
    }
}
