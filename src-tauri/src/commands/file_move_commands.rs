use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Default, Serialize)]
pub struct MoveResult {
    pub(crate) moved: Vec<String>,
    pub(crate) failed: Vec<(String, String)>,
}

pub(crate) struct PlannedMove {
    pub label: String,
    pub source: PathBuf,
    pub destination: PathBuf,
}

pub(crate) fn plan_moves(
    sources: Vec<(String, PathBuf, bool)>,
    destination: &Path,
    mut exists: impl FnMut(&Path) -> Result<bool, String>,
) -> Result<Vec<PlannedMove>, String> {
    let mut seen = HashSet::new();
    let mut targets = HashSet::new();
    let mut plan = Vec::new();
    for (label, source, directory) in &sources {
        if !seen.insert(source.clone())
            || sources.iter().any(|(_, parent, is_dir)| {
                *is_dir && parent != source && source.starts_with(parent)
            })
        {
            continue;
        }
        if source == destination || (*directory && destination.starts_with(source)) {
            return Err("A folder cannot be moved into itself or one of its subfolders".into());
        }
        if source.parent() == Some(destination) {
            continue;
        }
        let name = source.file_name().ok_or("Cannot move a filesystem root")?;
        let target = destination.join(name);
        if !targets.insert(target.clone()) || exists(&target)? {
            return Err(format!(
                "{} already exists in the destination; no items were moved",
                name.to_string_lossy()
            ));
        }
        plan.push(PlannedMove {
            label: label.clone(),
            source: source.clone(),
            destination: target,
        });
    }
    Ok(plan)
}

fn entry_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "linux")]
fn move_one(source: &Path, destination: &Path) -> Result<(), String> {
    // Coreutils preserves links/metadata and handles cross-filesystem moves. -T
    // keeps a racing destination directory from becoming an unintended parent.
    let output = std::process::Command::new("mv")
        .args(["-n", "-T", "--"])
        .arg(source)
        .arg(destination)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    if entry_exists(source)? || !entry_exists(destination)? {
        return Err("The destination already exists or the source could not be moved".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn move_one(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let source =
        std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let destination =
        std::ffi::CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error().to_string())
    }
}

#[cfg(windows)]
fn move_one(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 2) }; // COPY_ALLOWED, no replacement.
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error().to_string())
    }
}

pub(crate) fn move_items_impl(
    paths: Vec<String>,
    destination: &Path,
) -> Result<MoveResult, String> {
    let destination = destination
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !destination.is_dir() {
        return Err("The drop destination must be a folder".into());
    }
    let mut sources = Vec::new();
    for path in paths {
        let entry = Path::new(&path);
        let name = entry.file_name().ok_or("Cannot move a filesystem root")?;
        let parent = entry
            .parent()
            .ok_or("Invalid source path")?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let source = parent.join(name);
        let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        sources.push((path, source, metadata.is_dir()));
    }
    let plan = plan_moves(sources, &destination, entry_exists)?;
    let mut result = MoveResult::default();
    for item in plan {
        match move_one(&item.source, &item.destination) {
            Ok(()) => result.moved.push(item.label),
            Err(error) => result.failed.push((item.label, error)),
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn move_items(paths: Vec<String>, destination: String) -> Result<MoveResult, String> {
    tokio::task::spawn_blocking(move || move_items_impl(paths, Path::new(&destination)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{Builder, TempDir};

    fn fixture() -> TempDir {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.tmp/drag-move-rust");
        fs::create_dir_all(&root).unwrap();
        Builder::new().prefix("move-").tempdir_in(root).unwrap()
    }

    fn paths(entries: &[PathBuf]) -> Vec<String> {
        entries
            .iter()
            .map(|p| p.to_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn moves_a_selection_with_spaces_without_changing_contents() {
        let temp = fixture();
        let source = temp.path().join("file with spaces.txt");
        let directory = temp.path().join("folder");
        let target = temp.path().join("target");
        fs::write(&source, b"unchanged").unwrap();
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("child"), b"nested").unwrap();
        fs::create_dir(&target).unwrap();
        let result = move_items_impl(paths(&[source.clone(), directory.clone()]), &target).unwrap();
        assert_eq!(result.moved.len(), 2);
        assert!(result.failed.is_empty());
        assert!(!source.exists() && !directory.exists());
        assert_eq!(
            fs::read(target.join("file with spaces.txt")).unwrap(),
            b"unchanged"
        );
        assert_eq!(fs::read(target.join("folder/child")).unwrap(), b"nested");
    }

    #[test]
    fn conflicts_preflight_the_entire_selection_without_overwriting() {
        let temp = fixture();
        let target = temp.path().join("target");
        fs::create_dir(&target).unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        fs::write(&a, b"source-a").unwrap();
        fs::write(&b, b"source-b").unwrap();
        fs::write(target.join("b"), b"existing").unwrap();
        assert!(move_items_impl(paths(&[a.clone(), b.clone()]), &target).is_err());
        assert!(a.exists() && b.exists());
        assert!(!target.join("a").exists());
        assert_eq!(fs::read(target.join("b")).unwrap(), b"existing");
        assert!(
            move_items_impl(paths(&[a.clone(), temp.path().join("missing")]), &target).is_err()
        );
        assert!(a.exists());
    }

    #[test]
    fn rejects_self_descendants_and_duplicate_destination_names() {
        let temp = fixture();
        let parent = temp.path().join("folder");
        let child = parent.join("child");
        fs::create_dir_all(&child).unwrap();
        for destination in [&parent, &child] {
            assert!(move_items_impl(paths(&[parent.clone()]), destination).is_err());
            assert!(child.exists());
        }
        let plan = plan_moves(
            vec![
                ("first".into(), PathBuf::from("/one/a"), false),
                ("second".into(), PathBuf::from("/two/a"), false),
            ],
            Path::new("/target"),
            |_| Ok(false),
        );
        assert!(plan.is_err());
    }

    #[test]
    fn selected_parent_covers_children_and_same_folder_is_a_noop() {
        let temp = fixture();
        let source = temp.path().join("folder");
        let child = source.join("child");
        let target = temp.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(&child, b"child").unwrap();
        assert!(move_items_impl(paths(&[source.clone()]), temp.path())
            .unwrap()
            .moved
            .is_empty());
        let result = move_items_impl(paths(&[child, source.clone(), source]), &target).unwrap();
        assert_eq!(result.moved.len(), 1);
        assert!(result.failed.is_empty());
        assert_eq!(fs::read(target.join("folder/child")).unwrap(), b"child");
    }

    #[cfg(unix)]
    #[test]
    fn preserves_symlinks_rejects_broken_target_links_and_resolves_destination_aliases() {
        use std::os::unix::fs::symlink;
        let temp = fixture();
        let target = temp.path().join("target");
        let directory = temp.path().join("folder");
        fs::create_dir(&target).unwrap();
        fs::create_dir(&directory).unwrap();
        let alias = temp.path().join("alias");
        symlink(&directory, &alias).unwrap();
        assert!(move_items_impl(paths(&[directory.clone()]), &alias).is_err());
        let broken = temp.path().join("broken");
        symlink("missing", &broken).unwrap();
        symlink("different-missing", target.join("broken")).unwrap();
        assert!(move_items_impl(paths(&[broken.clone()]), &target).is_err());
        assert_eq!(fs::read_link(&broken).unwrap(), Path::new("missing"));
        let link = temp.path().join("link");
        symlink(&directory, &link).unwrap();
        let result = move_items_impl(paths(&[link.clone()]), &target).unwrap();
        assert_eq!(result.moved.len(), 1);
        assert_eq!(fs::read_link(target.join("link")).unwrap(), directory);
        assert!(directory.exists());
        assert!(fs::symlink_metadata(link).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn race_created_destination_is_never_overwritten_or_treated_as_a_parent() {
        let temp = fixture();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        fs::write(&source, b"source").unwrap();
        fs::create_dir(&target).unwrap();
        assert!(move_one(&source, &target).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"source");
        assert!(!target.join("source").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn cross_volume_move_preserves_file_directory_and_symlink_contents() {
        use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
        let source = fixture();
        let target = Builder::new()
            .prefix("explr-move-test-")
            .tempdir_in("/dev/shm")
            .unwrap();
        assert_ne!(
            fs::metadata(source.path()).unwrap().dev(),
            fs::metadata(target.path()).unwrap().dev(),
            "test needs distinct filesystems"
        );
        let directory = source.path().join("folder");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("child"), b"across devices").unwrap();
        fs::set_permissions(directory.join("child"), fs::Permissions::from_mode(0o640)).unwrap();
        let link = source.path().join("link");
        symlink("folder/child", &link).unwrap();
        let result =
            move_items_impl(paths(&[directory.clone(), link.clone()]), target.path()).unwrap();
        assert_eq!(result.moved.len(), 2);
        assert!(result.failed.is_empty());
        assert!(!directory.exists() && fs::symlink_metadata(link).is_err());
        assert_eq!(
            fs::read(target.path().join("folder/child")).unwrap(),
            b"across devices"
        );
        assert_eq!(
            fs::metadata(target.path().join("folder/child"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        assert_eq!(
            fs::read_link(target.path().join("link")).unwrap(),
            Path::new("folder/child")
        );
    }
}
