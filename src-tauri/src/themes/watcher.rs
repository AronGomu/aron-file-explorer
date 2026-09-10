use super::catalog::{ThemeCatalog, ThemeRegistry, ThemeState};
use crate::state::config_file::ConfigDirectory;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const QUIET: Duration = Duration::from_millis(150);
const WATCH_FAILURE: &str = "Could not watch theme directory";
const EMIT_FAILURE: &str = "Could not emit theme catalog";

#[derive(Default)]
struct Debounce(BTreeMap<PathBuf, Instant>, Vec<BTreeSet<PathBuf>>);
impl Debounce {
    fn record(&mut self, path: PathBuf, now: Instant) {
        self.0.insert(path.clone(), now + QUIET);
        if let Some(group) = self.1.iter().find(|group| group.contains(&path)) {
            for related in group { self.0.insert(related.clone(), now + QUIET); }
        }
    }
    fn event(&mut self, event: &Event, directory: &Path, now: Instant) {
        let paths = relevant(event, directory);
        if paths.len() > 1 && matches!(event.kind, EventKind::Modify(notify::event::ModifyKind::Name(_))) {
            // Rename links last only until this burst settles, never through ownership arbitration.
            let mut group: BTreeSet<_> = paths.iter().cloned().collect();
            self.1.retain(|previous| {
                if previous.is_disjoint(&group) { true }
                else { group.extend(previous.iter().cloned()); false }
            });
            self.1.push(group);
        }
        for path in paths { self.record(path, now); }
        if event.need_rescan() { self.record(directory.to_path_buf(), now); }
    }
    fn wait(&self, now: Instant) -> Option<Duration> {
        self.0.values().min().map(|deadline| deadline.saturating_duration_since(now))
    }
    fn due(&mut self, now: Instant) -> Vec<PathBuf> {
        let paths = self.0.iter().filter(|(_, deadline)| **deadline <= now).map(|(path, _)| path.clone()).collect::<Vec<_>>();
        for path in &paths { self.0.remove(path); }
        self.1.retain(|group| group.iter().any(|path| self.0.contains_key(path)));
        paths
    }
}

enum Message { Event(notify::Result<Event>), Stop }

struct Backend {
    watcher: Option<RecommendedWatcher>,
    callbacks_done: mpsc::Receiver<()>,
}
impl Drop for Backend {
    fn drop(&mut self) {
        drop(self.watcher.take());
        match self.callbacks_done.recv_timeout(Duration::from_secs(2)) {
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
            _ => eprintln!("Theme watcher cleanup failed: callback shutdown timeout"),
        }
    }
}

pub struct ThemeWatcher {
    sender: mpsc::Sender<Message>,
    worker: Option<JoinHandle<()>>,
}
impl Drop for ThemeWatcher {
    fn drop(&mut self) {
        if self.sender.send(Message::Stop).is_err() { eprintln!("Theme watcher worker already stopped"); }
        if let Some(worker) = self.worker.take() {
            // Worker owns neither ThemeState nor this guard; it cannot self-join.
            if worker.join().is_err() { eprintln!("Theme watcher worker panicked during cleanup"); }
        }
    }
}

// Strong handle owner lives on main's stack until after stop/join. No managed-state cycle.
pub fn start_theme_watcher(app: Weak<tauri::AppHandle>, directory: PathBuf) -> Result<ThemeWatcher, String> {
    let registry = app.upgrade().ok_or("Theme app is unavailable")?.state::<ThemeState>().registry.clone();
    start(directory, registry, move |catalog| {
        let app = app.upgrade().ok_or("Theme app is unavailable")?;
        app.emit_to("main", "themes-changed", catalog).map_err(|_| EMIT_FAILURE.to_string())
    })
}

fn relevant(event: &Event, directory: &Path) -> Vec<PathBuf> {
    if matches!(event.kind, EventKind::Access(_)) { return Vec::new(); }
    // Both rename paths participate. Temp names matter for rename bursts but never parse.
    event.paths.iter().filter(|path| *path == directory || path.parent() == Some(directory)).cloned().collect()
}

fn attach(watcher: &mut RecommendedWatcher, directory: &Path) -> Result<(), String> {
    // Watch notifications are hints only. Parsing always reopens through pinned/no-follow helper.
    let _pinned = ConfigDirectory::open(directory, false).map_err(|_| WATCH_FAILURE.to_string())?;
    watcher.watch(directory, RecursiveMode::NonRecursive).map_err(|_| WATCH_FAILURE.to_string())
}

fn emit_snapshot(registry: &Arc<Mutex<ThemeRegistry>>, emit: &mut impl FnMut(ThemeCatalog) -> Result<(), String>) {
    let catalog = match registry.lock() {
        Ok(registry) => registry.catalog.clone(),
        Err(_) => { eprintln!("Theme registry lock failed while emitting"); return; }
    };
    let revision = catalog.revision;
    if emit(catalog).is_err() {
        eprintln!("Could not emit theme catalog; diagnostic retained for next snapshot");
        match registry.lock() {
            Ok(mut registry) => { registry.watch_issue(EMIT_FAILURE); }
            Err(_) => eprintln!("Theme registry lock failed while recording emit failure"),
        }
    } else {
        match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
            Ok(time) => eprintln!("Theme catalog emitted: revision={revision} unix_ms={}", time.as_millis()),
            Err(_) => eprintln!("Theme catalog emitted: revision={revision} clock=unavailable"),
        }
    }
}

fn start(
    directory: PathBuf,
    registry: Arc<Mutex<ThemeRegistry>>,
    mut emit: impl FnMut(ThemeCatalog) -> Result<(), String> + Send + 'static,
) -> Result<ThemeWatcher, String> {
    let parent = directory.parent().ok_or(WATCH_FAILURE)?;
    let _pinned_parent = ConfigDirectory::open(parent, false).map_err(|_| WATCH_FAILURE.to_string())?;
    let (sender, receiver) = mpsc::channel();
    let event_sender = sender.clone();
    // notify has no public thread join. Disconnect proves callback object is destroyed.
    let (callback_lifetime, callbacks_done) = mpsc::channel::<()>();
    let watcher = RecommendedWatcher::new(move |event| {
        let _alive = &callback_lifetime;
        if event_sender.send(Message::Event(event)).is_err() {
            eprintln!("Theme watcher callback receiver closed during cleanup");
        }
    }, Config::default().with_follow_symlinks(false)).map_err(|_| WATCH_FAILURE.to_string())?;
    let mut backend = Backend { watcher: Some(watcher), callbacks_done };
    let watcher = backend.watcher.as_mut().expect("watcher exists until backend drop");
    watcher.watch(parent, RecursiveMode::NonRecursive).map_err(|_| WATCH_FAILURE.to_string())?;
    let mut attached = attach(watcher, &directory).is_ok();
    if !attached {
        eprintln!("Could not watch theme directory; parent recovery watch retained");
        registry.lock().map_err(|_| WATCH_FAILURE)?.watch_issue(WATCH_FAILURE);
    }
    let worker = thread::Builder::new().name("theme-reload".into()).spawn(move || {
        let watcher = backend.watcher.as_mut().expect("watcher exists until backend drop");
        let mut pending = Debounce::default();
        // Close initialization→watch gap using current disk state, never reseed.
        pending.record(directory.clone(), Instant::now());
        'worker: loop {
            let message = match pending.wait(Instant::now()) {
                Some(wait) => receiver.recv_timeout(wait),
                None => receiver.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            };
            // Drain already queued rename/write hints before reading final filesystem state.
            for message in std::iter::once(message).chain(receiver.try_iter().map(Ok)) {
                match message {
                    Ok(Message::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break 'worker,
                    Ok(Message::Event(Ok(event))) => {
                        let now = Instant::now();
                        pending.event(&event, &directory, now);
                    }
                    Ok(Message::Event(Err(_))) => {
                        eprintln!("Theme filesystem watcher reported an error");
                        let changed = match registry.lock() {
                            Ok(mut registry) => registry.watch_issue(WATCH_FAILURE),
                            Err(_) => { eprintln!("Theme registry lock failed"); break 'worker; }
                        };
                        if changed { emit_snapshot(&registry, &mut emit); }
                        pending.record(directory.clone(), Instant::now());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
            }
            let due = pending.due(Instant::now());
            if due.is_empty() { continue; }
            let lifecycle = due.iter().any(|path| path == &directory);
            if lifecycle {
                if attached {
                    if let Err(error) = watcher.unwatch(&directory) {
                        // Removed directories can already have lost their kernel watch.
                        if !matches!(error.kind, notify::ErrorKind::WatchNotFound) {
                            eprintln!("Could not detach previous theme directory watch");
                        }
                    }
                }
                attached = attach(watcher, &directory).is_ok();
            }
            let ready: BTreeSet<_> = due.iter().filter_map(|path| path.file_name().map(|name| name.to_os_string())).collect();
            let deferred: BTreeSet<_> = pending.0.keys().filter_map(|path| path.file_name().map(|name| name.to_os_string())).collect();
            let changed = match registry.lock() {
                Ok(mut registry) => {
                    if lifecycle && attached { registry.clear_watch_issue(WATCH_FAILURE); }
                    let mut changed = registry.reload(&directory, &deferred, if lifecycle { None } else { Some(&ready) });
                    if lifecycle && !attached { changed |= registry.watch_issue(WATCH_FAILURE); }
                    changed
                }
                Err(_) => { eprintln!("Theme registry lock failed while reloading"); break; }
            };
            if changed { emit_snapshot(&registry, &mut emit); }
        }
        drop(backend);
    }).map_err(|_| "Could not start theme watcher worker".to_string())?;
    Ok(ThemeWatcher { sender, worker: Some(worker) })
}

#[cfg(test)]
pub(super) fn start_test(directory: PathBuf, registry: Arc<Mutex<ThemeRegistry>>) -> ThemeWatcher {
    start(directory, registry, |_| Ok(())).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::SEEDS;
    use std::fs;

    fn wait(state: &ThemeState, predicate: impl Fn(&ThemeCatalog) -> bool) -> ThemeCatalog {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            let catalog = state.registry.lock().unwrap().catalog.clone();
            if predicate(&catalog) { return catalog; }
            assert!(Instant::now() < deadline, "theme watcher did not settle: {catalog:?}");
            thread::sleep(Duration::from_millis(10));
        }
    }
    fn setup() -> (tempfile::TempDir, PathBuf, ThemeState, ThemeWatcher) {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("themes");
        let state = ThemeState::at(path.clone());
        let watcher = start_test(path.clone(), state.registry.clone());
        (temp, path, state, watcher)
    }
    fn latte(catalog: &ThemeCatalog) -> &super::super::definition::ThemeDefinition {
        catalog.themes.iter().find(|theme| theme.id == "catppuccin-latte").unwrap()
    }

    #[test]
    fn theme_watch_debounce() {
        let start = Instant::now();
        let mut debounce = Debounce::default();
        debounce.record("a".into(), start);
        assert!(debounce.due(start + Duration::from_millis(149)).is_empty());
        assert_eq!(debounce.due(start + Duration::from_millis(150)), [PathBuf::from("a")]);
        debounce.record("a".into(), start);
        debounce.record("a".into(), start + Duration::from_millis(100));
        debounce.record("b".into(), start + Duration::from_millis(50));
        assert_eq!(debounce.due(start + Duration::from_millis(200)), [PathBuf::from("b")]);
        assert!(debounce.due(start + Duration::from_millis(249)).is_empty());
        assert_eq!(debounce.due(start + Duration::from_millis(250)), [PathBuf::from("a")]);
    }

    #[test]
    fn theme_watch_rename_groups_merge_then_expire() {
        use notify::event::{ModifyKind, RenameMode};
        let path = PathBuf::from("/fixture/themes");
        let start = Instant::now(); let mut pending = Debounce::default();
        let rename = |a: &str, b: &str| Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(path.join(a)).add_path(path.join(b));
        pending.event(&rename("a", "b"), &path, start);
        pending.event(&rename("c", "d"), &path, start);
        pending.event(&rename("b", "c"), &path, start + Duration::from_millis(50));
        pending.event(&rename("b", "c"), &path, start + Duration::from_millis(75));
        pending.record(path.join("d"), start + Duration::from_millis(100));
        assert!(pending.due(start + Duration::from_millis(249)).is_empty());
        assert_eq!(pending.due(start + Duration::from_millis(250)), ["a", "b", "c", "d"].map(|p| path.join(p)));
        assert!(pending.1.is_empty(), "settled rename relations cannot persist as identity");
        pending.record(path.join("a"), start + Duration::from_millis(300));
        pending.record(path.join("d"), start + Duration::from_millis(400));
        assert_eq!(pending.due(start + Duration::from_millis(450)), [path.join("a")]);
        assert_eq!(pending.due(start + Duration::from_millis(550)), [path.join("d")]);
    }

    #[test]
    fn theme_watch_rename_write_shared_deadline() {
        rename_write_deadline(false, false, false);
    }

    #[test]
    fn theme_watch_rename_chain_shared_deadline() {
        rename_write_deadline(true, false, false);
    }

    #[test]
    fn theme_watch_rename_duplicate_shared_deadline() {
        rename_write_deadline(false, true, false);
        rename_write_deadline(true, true, false);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn theme_watch_notify_rename_write_shared_deadline() {
        rename_write_deadline(false, false, true);
        rename_write_deadline(false, true, true);
    }

    fn rename_write_deadline(chained: bool, duplicate: bool, real_notify: bool) {
        use notify::event::{ModifyKind, RenameMode};
        let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("themes");
        let state = ThemeState::at(path.clone());
        let a = path.join("catppuccin-latte.theme.json");
        let z = path.join("z.theme.json");
        let final_path = if chained { path.join("zz.theme.json") } else { z.clone() };
        let mut registry = state.registry.lock().unwrap();
        if duplicate {
            fs::write(path.join("duplicate.theme.json"), SEEDS[0].1.replace("Catppuccin Latte", "Takeover").replace("#eff1f5", "#abcdef")).unwrap();
            registry.reload(&path, &BTreeSet::new(), None);
        }
        let old = registry.catalog.clone();
        let (sender, events) = mpsc::channel();
        let mut watcher = if real_notify {
            Some(RecommendedWatcher::new(move |event| {
                if sender.send(event).is_err() { eprintln!("Fixture event receiver closed during cleanup"); }
            }, Config::default()).unwrap())
        } else { None };
        if let Some(watcher) = watcher.as_mut() { watcher.watch(&path, RecursiveMode::NonRecursive).unwrap(); }
        // Capture actual Linux hints, then replay against fake time: no scheduling sleeps.
        let observed = |expected: Event| {
            if !real_notify { return expected; }
            let deadline = Instant::now() + Duration::from_secs(4);
            loop {
                let event = events.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap().unwrap();
                let kind_matches = event.kind == expected.kind || matches!((&expected.kind, &event.kind),
                    (EventKind::Any, EventKind::Modify(notify::event::ModifyKind::Data(_))));
                if kind_matches && event.paths == expected.paths { return event; }
            }
        };
        let start = Instant::now(); let mut pending = Debounce::default();
        let rename = |from, to| Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both))).add_path(from).add_path(to);
        fs::rename(&a, &z).unwrap();
        pending.event(&observed(rename(a, z.clone())), &path, start);
        if chained {
            fs::rename(&z, &final_path).unwrap();
            pending.event(&observed(rename(z, final_path.clone())), &path, start + Duration::from_millis(50));
        }
        fs::write(&final_path, SEEDS[0].1.replace("#eff1f5", "#123456")).unwrap();
        pending.event(&observed(Event::new(EventKind::Any).add_path(final_path)), &path, start + Duration::from_millis(100));
        fs::write(path.join("independent.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "independent")).unwrap();
        pending.record(path.join("independent.theme.json"), start + Duration::from_millis(25));
        for ms in [150, 175, 249, 250] {
            let due = pending.due(start + Duration::from_millis(ms));
            let ready = due.iter().map(|p| p.file_name().unwrap().to_os_string()).collect();
            let deferred = pending.0.keys().map(|p| p.file_name().unwrap().to_os_string()).collect();
            if !due.is_empty() { registry.reload(&path, &deferred, Some(&ready)); }
            let accepted = registry.catalog.themes.iter().find(|t| t.id == "catppuccin-latte")
                .expect("rename burst must never publish a missing requested ID");
            if ms < 250 {
                assert_eq!(accepted, latte(&old), "related paths must stay pending until 250ms");
            } else {
                assert_eq!(accepted.tokens["background"], if duplicate { "#abcdef" } else { "#123456" });
                assert_eq!(accepted.name, if duplicate { "Takeover" } else { "Catppuccin Latte" });
                assert_eq!(registry.catalog.revision, old.revision + 2);
                assert!(pending.0.is_empty());
                if duplicate {
                    assert_eq!(registry.catalog.issues[0].file.as_deref(), Some(if chained { "zz.theme.json" } else { "z.theme.json" }));
                }
            }
            assert_eq!(registry.catalog.themes.iter().any(|t| t.id == "independent"), ms >= 175,
                "unrelated path must retain its own 175ms deadline");
        }
    }

    #[test]
    fn theme_watch_independent_paths() {
        let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("themes");
        let state = ThemeState::at(path.clone());
        fs::write(path.join("ready.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "ready")).unwrap();
        fs::write(path.join("unsettled.theme.json"), b"{unfinished").unwrap();
        let mut registry = state.registry.lock().unwrap();
        let ready = BTreeSet::from(["ready.theme.json".into()]);
        registry.reload(&path, &BTreeSet::new(), Some(&ready));
        assert!(registry.catalog.themes.iter().any(|theme| theme.id == "ready"));
        assert!(registry.catalog.issues.is_empty(), "unsettled path cannot be inspected by another path's deadline");
        let ready = BTreeSet::from(["unsettled.theme.json".into()]);
        registry.reload(&path, &BTreeSet::new(), Some(&ready));
        assert_eq!(registry.catalog.issues[0].file.as_deref(), Some("unsettled.theme.json"));
    }

    #[test]
    fn theme_watch_atomic_save() {
        let (_temp, path, state, _watcher) = setup();
        let old = state.registry.lock().unwrap().catalog.clone();
        let bytes = SEEDS[0].1.replace("#eff1f5", "#abcdef");
        fs::write(path.join(".editor.tmp"), &bytes).unwrap();
        fs::rename(path.join(".editor.tmp"), path.join("catppuccin-latte.theme.json")).unwrap();
        let new = wait(&state, |catalog| latte(catalog).tokens["background"] == "#abcdef");
        assert_eq!(new.revision, old.revision + 1);
        assert!(new.issues.is_empty());
        fs::write(path.join("catppuccin-latte.theme.json"), &bytes).unwrap();
        thread::sleep(Duration::from_millis(350));
        assert_eq!(state.registry.lock().unwrap().catalog, new);
        fs::rename(path.join("catppuccin-latte.theme.json"), path.join("renamed.theme.json")).unwrap();
        thread::sleep(Duration::from_millis(350));
        assert_eq!(state.registry.lock().unwrap().catalog, new);
        assert!(state.registry.lock().unwrap().accepted.contains_key(std::ffi::OsStr::new("renamed.theme.json")));
    }

    #[test]
    fn theme_watch_invalid_then_valid() {
        let (_temp, path, state, _watcher) = setup();
        let file = path.join("catppuccin-latte.theme.json");
        fs::write(&file, b"{bad one").unwrap();
        let bad = wait(&state, |catalog| catalog.issues.iter().any(|issue| issue.code == "invalid"));
        assert_eq!(latte(&bad).tokens["background"], "#eff1f5");
        assert_eq!(bad.issues[0].fingerprint.as_ref().unwrap().len(), 64);
        fs::write(&file, b"{bad one").unwrap();
        thread::sleep(Duration::from_millis(350));
        assert_eq!(state.registry.lock().unwrap().catalog, bad);
        fs::write(&file, b"{bad two").unwrap();
        let changed = wait(&state, |catalog| catalog.revision > bad.revision);
        assert_eq!(changed.issues[0].reason, bad.issues[0].reason);
        assert_ne!(changed.issues[0].fingerprint, bad.issues[0].fingerprint);
        fs::write(&file, SEEDS[0].1.replace("#eff1f5", "#abcdef")).unwrap();
        let good = wait(&state, |catalog| catalog.issues.is_empty());
        assert_eq!(latte(&good).tokens["background"], "#abcdef");
        fs::write(&file, b"{bad one").unwrap();
        let bad_again = wait(&state, |catalog| !catalog.issues.is_empty());
        assert_eq!(bad_again.issues[0], bad.issues[0]);
        assert!(bad_again.revision > good.revision);
    }

    #[test]
    fn theme_watch_duplicate() {
        let (_temp, path, state, _watcher) = setup();
        // Earlier basename cannot steal a live owner; retained candidates enable takeover.
        fs::write(path.join("a.theme.json"), SEEDS[0].1.replace("Catppuccin Latte", "First candidate")).unwrap();
        fs::write(path.join("b.theme.json"), SEEDS[0].1.replace("Catppuccin Latte", "Second candidate")).unwrap();
        let duplicate = wait(&state, |catalog| catalog.issues.len() == 2);
        assert_eq!(latte(&duplicate).name, "Catppuccin Latte");
        fs::write(path.join("catppuccin-latte.theme.json"), b"{bad").unwrap();
        let invalid = wait(&state, |catalog| catalog.issues.len() == 3);
        assert_eq!(latte(&invalid).name, "Catppuccin Latte");
        fs::remove_file(path.join("catppuccin-latte.theme.json")).unwrap();
        let takeover = wait(&state, |catalog| latte(catalog).name == "First candidate");
        assert_eq!(takeover.issues.len(), 1);
        fs::remove_file(path.join("a.theme.json")).unwrap();
        let second = wait(&state, |catalog| latte(catalog).name == "Second candidate");
        assert!(second.issues.is_empty());
    }

    #[test]
    fn theme_watch_rename_owner_duplicate_takeover() {
        let (_temp, path, state, _watcher) = setup();
        fs::write(path.join("duplicate.theme.json"), SEEDS[0].1.replace("Catppuccin Latte", "Takeover").replace("#eff1f5", "#abcdef")).unwrap();
        let old = wait(&state, |catalog| catalog.issues.len() == 1);
        assert_eq!(latte(&old).name, "Catppuccin Latte");
        fs::rename(path.join("catppuccin-latte.theme.json"), path.join("z.theme.json")).unwrap();
        let new = wait(&state, |catalog| latte(catalog).name == "Takeover");
        assert_eq!(new.revision, old.revision + 1);
        assert_eq!(latte(&new).tokens["background"], "#abcdef");
        assert_eq!(new.issues.len(), 1);
        assert_eq!(new.issues[0].file.as_deref(), Some("z.theme.json"));
        assert_eq!(new.issues[0].code, "duplicate");
        assert_eq!(latte(&new).id, latte(&old).id);
    }

    #[test]
    fn theme_watch_delete_active() {
        let (_temp, path, state, _watcher) = setup();
        fs::remove_file(path.join("catppuccin-latte.theme.json")).unwrap();
        wait(&state, |catalog| catalog.themes.len() == 1);
        assert!(!path.join("catppuccin-latte.theme.json").exists());
    }

    #[test]
    fn theme_watch_directory_recreated() {
        let (_temp, path, state, _watcher) = setup();
        fs::remove_dir_all(&path).unwrap();
        wait(&state, |catalog| catalog.themes.is_empty());
        fs::create_dir(&path).unwrap();
        fs::write(path.join("custom.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "custom")).unwrap();
        let restored = wait(&state, |catalog| catalog.themes.len() == 1 && catalog.issues.is_empty());
        assert_eq!(restored.themes[0].id, "custom");
        assert_eq!(fs::read_dir(&path).unwrap().count(), 1);
        fs::write(path.join("custom.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "custom").replace("#eff1f5", "#abcdef")).unwrap();
        wait(&state, |catalog| catalog.themes[0].tokens["background"] == "#abcdef");
    }

    #[cfg(unix)]
    #[test]
    fn theme_watch_no_follow_and_fifo() {
        use std::os::unix::fs::symlink;
        use std::os::unix::ffi::OsStrExt;
        let (temp, path, state, _watcher) = setup();
        let outside = temp.path().join("outside"); fs::create_dir(&outside).unwrap();
        fs::write(outside.join("external.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "external")).unwrap();
        symlink(outside.join("external.theme.json"), path.join("linked.theme.json")).unwrap();
        let fifo = std::ffi::CString::new(path.join("fifo.theme.json").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        let invalid = wait(&state, |catalog| catalog.issues.len() == 2);
        assert!(invalid.issues.iter().all(|issue| issue.reason == "theme file must be a regular file" && issue.fingerprint.is_none()));
        fs::rename(&path, temp.path().join("moved")).unwrap();
        symlink(&outside, &path).unwrap();
        let swapped = wait(&state, |catalog| catalog.issues.iter().any(|issue| issue.code == "io"));
        assert!(!swapped.themes.iter().any(|theme| theme.id == "external"));
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 1);
    }

    #[test]
    fn theme_watch_event_paths() {
        use notify::event::{ModifyKind, RenameMode};
        let path = PathBuf::from("/fixture/themes");
        let event = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(path.join("old.theme.json")).add_path(path.join("new.theme.json"));
        assert_eq!(relevant(&event, &path).len(), 2);
        assert!(relevant(&Event::new(EventKind::Any).add_path("/fixture/other".into()), &path).is_empty());
        assert!(relevant(&Event::new(EventKind::Any).add_path(path.join("nested/ignored.theme.json")), &path).is_empty());
    }

    #[test]
    fn theme_watch_emit_failure() {
        let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("themes");
        let state = ThemeState::at(path.clone());
        let _watcher = start(path.clone(), state.registry.clone(), |_| Err("fixture rejection".into())).unwrap();
        fs::write(path.join("copy.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "copy")).unwrap();
        let snapshot = wait(&state, |catalog| catalog.issues.iter().any(|issue| issue.reason == EMIT_FAILURE));
        assert!(snapshot.themes.iter().any(|theme| theme.id == "copy"));
        assert!(snapshot.revision >= 3);
    }

    #[test]
    fn theme_watch_shutdown() {
        let temp = tempfile::tempdir().unwrap(); let path = temp.path().join("themes");
        let state = ThemeState::at(path.clone());
        let (entered, started) = mpsc::channel(); let (resume, blocked) = mpsc::channel();
        let owner = Arc::new(()); let weak = Arc::downgrade(&owner);
        let watcher = start(path.clone(), state.registry.clone(), move |_| {
            let _handle = weak.upgrade().expect("external emitter owner retained through join");
            entered.send(()).unwrap(); blocked.recv().unwrap(); Ok(())
        }).unwrap();
        fs::write(path.join("copy.theme.json"), SEEDS[0].1.replace("catppuccin-latte", "copy")).unwrap();
        started.recv_timeout(Duration::from_secs(4)).unwrap();
        // Exit during emission plus queued callback. Guard cannot finish before emission returns.
        fs::write(path.join("queued.theme.json"), b"{bad").unwrap();
        let (finished, completion) = mpsc::channel();
        let shutdown = thread::spawn(move || { drop(watcher); finished.send(()).unwrap(); });
        assert!(completion.recv_timeout(Duration::from_millis(30)).is_err());
        resume.send(()).unwrap();
        completion.recv_timeout(Duration::from_secs(3)).unwrap(); shutdown.join().unwrap();
        assert_eq!(Arc::strong_count(&owner), 1);
        let revision = state.registry.lock().unwrap().catalog.revision;
        fs::write(path.join("after.theme.json"), b"{bad").unwrap();
        thread::sleep(Duration::from_millis(200));
        assert_eq!(state.registry.lock().unwrap().catalog.revision, revision);
    }
}
