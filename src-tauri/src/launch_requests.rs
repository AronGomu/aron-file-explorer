use serde::Serialize;
use std::{ffi::OsString, path::PathBuf};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub directories: Vec<String>,
    pub selected_paths: Vec<String>,
    pub properties: bool,
}

pub fn parse(arguments: impl IntoIterator<Item = OsString>) -> LaunchRequest {
    let arguments: Vec<_> = arguments.into_iter().collect();
    let mut request = LaunchRequest::default();
    request.properties = arguments.iter().any(|arg| arg == "--properties");
    let select = request.properties || arguments.iter().any(|arg| arg == "--select");
    for argument in arguments {
        if argument == "--select" || argument == "--properties" {
            continue;
        }
        let path = if argument.to_string_lossy().starts_with("file:") {
            match tauri::Url::parse(&argument.to_string_lossy())
                .ok()
                .and_then(|url| url.to_file_path().ok())
            {
                Some(path) => path,
                None => continue,
            }
        } else {
            PathBuf::from(argument)
        };
        // Preserve a selected symlink rather than revealing its target.
        let path = if select {
            path.parent()
                .and_then(|parent| parent.canonicalize().ok())
                .and_then(|parent| path.file_name().map(|name| parent.join(name)))
                .filter(|path| path.symlink_metadata().is_ok())
        } else {
            path.canonicalize().ok().filter(|path| path.is_dir())
        };
        let Some(path) = path else {
            continue;
        };
        let directory = if select {
            path.parent().unwrap()
        } else {
            path.as_path()
        };
        let directory = directory.to_string_lossy().into_owned();
        if !request.directories.contains(&directory) {
            request.directories.push(directory);
        }
        if select {
            request
                .selected_paths
                .push(path.to_string_lossy().into_owned());
        }
    }
    request
}

#[tauri::command]
pub fn get_launch_request() -> LaunchRequest {
    parse(std::env::args_os().skip(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_arguments_accept_paths_and_file_uris_without_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().canonicalize().unwrap();
        let uri = tauri::Url::from_directory_path(&path).unwrap().to_string();
        let request = parse([path.clone().into_os_string(), uri.into()]);
        assert_eq!(request.directories, [path.to_string_lossy()]);
        assert!(request.selected_paths.is_empty());
        assert!(!request.properties);
    }

    #[test]
    fn reveal_and_properties_select_the_requested_file_in_its_parent() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("a # file.txt");
        std::fs::write(&file, "fixture").unwrap();
        let file = file.canonicalize().unwrap();
        let uri = tauri::Url::from_file_path(&file).unwrap().to_string();
        for flag in ["--select", "--properties"] {
            let request = parse([flag.into(), uri.clone().into()]);
            assert_eq!(
                request.directories,
                [file.parent().unwrap().to_string_lossy()]
            );
            assert_eq!(request.selected_paths, [file.to_string_lossy()]);
            assert_eq!(request.properties, flag == "--properties");
        }
        assert!(parse(["file:///nonexistent-explr-fixture".into()])
            .directories
            .is_empty());
        assert!(parse(["https://example.com/".into()])
            .directories
            .is_empty());
    }
}
