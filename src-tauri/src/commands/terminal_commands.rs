use crate::terminal::{Session, TerminalEvent};
use portable_pty::CommandBuilder;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State, Window};

#[derive(Default)]
struct Registry {
    next_id: u32,
    sessions: HashMap<(String, u32), Arc<Session>>,
    closed_windows: HashSet<String>,
}

#[derive(Default, Clone)]
pub struct Terminals(Arc<Mutex<Registry>>);

impl Terminals {
    fn get(&self, owner: &str, id: u32) -> Result<Arc<Session>, String> {
        self.0
            .lock()
            .unwrap()
            .sessions
            .get(&(owner.to_string(), id))
            .cloned()
            .ok_or_else(|| "Terminal session not found for this window".into())
    }

    pub fn close_window(&self, owner: &str) {
        let sessions = {
            let mut registry = self.0.lock().unwrap();
            registry.closed_windows.insert(owner.to_string());
            let keys: Vec<_> = registry
                .sessions
                .keys()
                .filter(|(label, _)| label == owner)
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| registry.sessions.remove(&key))
                .collect::<Vec<_>>()
        };
        for session in sessions {
            session.close();
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Output {
    Output { id: u32, data: Vec<u8> },
    Exit { id: u32, code: u32 },
    Error { id: u32, message: String },
}

#[derive(Serialize)]
pub struct Created {
    id: u32,
    shell: String,
}

fn shell_command(working_directory: Option<String>) -> Result<(CommandBuilder, String), String> {
    let cwd = match working_directory {
        Some(path) if path.starts_with("sftp:") || path.contains("://") => {
            return Err(
                "Remote directories cannot start a local terminal. Select a local directory."
                    .into(),
            );
        }
        Some(path) => PathBuf::from(path),
        None => home::home_dir().ok_or("Home directory is unavailable")?,
    };
    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err("Terminal working directory must be an existing local directory".into());
    }
    let shell = if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if Path::new("/bin/bash").is_file() {
                    "/bin/bash".into()
                } else {
                    "/bin/sh".into()
                }
            })
    };
    let name = Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let quoting = match name {
        "bash" | "sh" | "zsh" | "dash" | "ksh" => "posix",
        "fish" => "fish",
        "powershell.exe" | "powershell" | "pwsh" | "pwsh.exe" => "powershell",
        _ => "unknown",
    }
    .to_string();
    let mut command = CommandBuilder::new(&shell);
    if !cfg!(windows) {
        command.arg("-i");
    }
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    Ok((command, quoting))
}

#[tauri::command]
pub async fn terminal_create(
    window: Window,
    state: State<'_, Terminals>,
    working_directory: Option<String>,
    cols: u16,
    rows: u16,
    output: Channel<Output>,
) -> Result<Created, String> {
    let state = state.inner().clone();
    let owner = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let (command, shell) = shell_command(working_directory)?;
        let mut registry = state.0.lock().unwrap();
        if registry.closed_windows.contains(&owner) {
            return Err("Terminal window has closed".into());
        }
        registry.next_id = registry
            .next_id
            .checked_add(1)
            .ok_or("Terminal session IDs exhausted")?;
        let id = registry.next_id;
        // Keep registry locked until insertion: early output ACKs must find the session.
        let session = Session::spawn(command, cols, rows, move |event| {
            let message = match event {
                TerminalEvent::Output(data) => Output::Output { id, data },
                TerminalEvent::Exit(code) => Output::Exit { id, code },
                TerminalEvent::Error(message) => Output::Error { id, message },
            };
            output.send(message).is_ok()
        })?;
        registry.sessions.insert((owner, id), session);
        Ok(Created { id, shell })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn terminal_write(
    window: Window,
    state: State<'_, Terminals>,
    id: u32,
    data: String,
    generation: u64,
    binary: Option<bool>,
) -> Result<(), String> {
    let session = state.get(window.label(), id)?;
    if data.len() > 8192 {
        return Err("Terminal input chunk is too large".into());
    }
    let bytes = if binary.unwrap_or(false) {
        data.chars()
            .map(|c| {
                u8::try_from(c as u32).map_err(|_| "Invalid binary terminal input".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        data.into_bytes()
    };
    tauri::async_runtime::spawn_blocking(move || session.write_generation(&bytes, generation))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn terminal_interrupt(
    window: Window,
    state: State<'_, Terminals>,
    id: u32,
) -> Result<(), String> {
    let session = state.get(window.label(), id)?;
    tauri::async_runtime::spawn_blocking(move || session.interrupt())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_resize(
    window: Window,
    state: State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.get(window.label(), id)?.resize(cols, rows)
}

#[tauri::command]
pub fn terminal_ack(
    window: Window,
    state: State<'_, Terminals>,
    id: u32,
    bytes: usize,
) -> Result<(), String> {
    state.get(window.label(), id)?.ack(bytes)
}

#[tauri::command]
pub async fn terminal_close(
    window: Window,
    state: State<'_, Terminals>,
    id: u32,
) -> Result<(), String> {
    let session = state
        .inner()
        .0
        .lock()
        .unwrap()
        .sessions
        .remove(&(window.label().to_string(), id));
    if let Some(session) = session {
        tauri::async_runtime::spawn_blocking(move || session.close())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_remote_or_invalid_working_directory() {
        assert!(shell_command(Some("sftp://server/home".into())).is_err());
        assert!(shell_command(Some("sftp:server/home".into())).is_err());
        assert!(shell_command(Some("relative/path".into())).is_err());
    }

    #[test]
    fn missing_session_is_not_accessible() {
        let state = Terminals::default();
        assert!(state.get("other-window", 1).is_err());
    }
}
