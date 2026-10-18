use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSuggestion {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCompletions {
    resolved_path: String,
    entries: Vec<PathSuggestion>,
}

fn suggestion(path: PathBuf) -> PathSuggestion {
    PathSuggestion {
        name: path.file_name().map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned()),
        is_directory: path.is_dir(),
        path: path.to_string_lossy().into_owned(),
    }
}

fn match_rank(name: &str, query: &str) -> Option<usize> {
    if name.starts_with(query) { return Some(0); }
    if name.contains(query) { return Some(1); }
    let mut letters = query.chars();
    let mut next = letters.next();
    for letter in name.chars() {
        if next == Some(letter) { next = letters.next(); }
    }
    next.is_none().then_some(2)
}

// Read only names/types here; the full listing also computes expensive file metadata.
#[tauri::command]
pub async fn complete_path(input: String, current_path: String, show_hidden: bool, directories_only: bool) -> Result<PathCompletions, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home::home_dir();
        if input.is_empty() {
            let mut paths = vec![PathBuf::from(std::path::MAIN_SEPARATOR.to_string())];
            if let Some(home) = &home {
                paths.push(home.clone());
                for folder in ["Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos"] {
                    let path = home.join(folder);
                    if path.is_dir() { paths.push(path); }
                }
            }
            return Ok(PathCompletions {
                resolved_path: current_path,
                entries: paths.into_iter().map(suggestion).collect(),
            });
        }
        let expanded = if input == "~" || input.starts_with("~/") || input.starts_with("~\\") {
            home.ok_or("Home directory unavailable")?.join(input.get(2..).unwrap_or(""))
        } else { PathBuf::from(&input) };
        let resolved = if expanded.is_absolute() { expanded } else { Path::new(&current_path).join(expanded) };
        let (directory, query) = if input.ends_with(std::path::is_separator) || input == "~" {
            (resolved.as_path(), String::new())
        } else {
            (resolved.parent().unwrap_or(&resolved), resolved.file_name().unwrap_or_default().to_string_lossy().to_lowercase())
        };
        let mut matches = Vec::new();
        for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
            let Ok(entry) = entry else { continue; };
            let name = entry.file_name().to_string_lossy().into_owned();
            if !show_hidden && name.starts_with('.') && !query.starts_with('.') { continue; }
            let Some(rank) = match_rank(&name.to_lowercase(), &query) else { continue; };
            let path = entry.path();
            let is_directory = entry.file_type().is_ok_and(|kind| kind.is_dir() || (kind.is_symlink() && path.is_dir()));
            if directories_only && !is_directory { continue; }
            matches.push((rank, PathSuggestion { name, path: path.to_string_lossy().into_owned(), is_directory }));
        }
        matches.sort_by(|(rank_a, a), (rank_b, b)| rank_a.cmp(rank_b)
            .then_with(|| b.is_directory.cmp(&a.is_directory))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        matches.truncate(100);
        Ok(PathCompletions { resolved_path: resolved.to_string_lossy().into_owned(), entries: matches.into_iter().map(|(_, entry)| entry).collect() })
    }).await.map_err(|error| error.to_string())?
}
