# Explr File Chooser

## Scope and assumptions

- A1. This branch starts at `0f4ed7d82bfeaddae2e9cf95ff5978444caaf275`, excluding uncommitted explorer work. The chooser uses its own application identity, settings, themes and favorites. Tabs and navigation history live only for one request.
- A2. Linux applications using the XDG desktop FileChooser portal can use this interface. Applications that implement private dialogs must opt into the portal themselves. Changing the default directory handler does not change file choosers.
- A3. Local UTF-8 paths and locally mounted drives are supported. SFTP staging and non-UTF-8 filenames are not included. Search filters the current folder; it does not start home-directory indexing.

## Behavior

- B1. Reuses Explr file rows, grid/details views, thumbnails, media/text previews and themes. Includes tabs, navigation, path entry, hidden files, favorites, drive locations and New Folder.
- B2. OpenFile supports single/multiple files or directories, caller title/accept label, MIME/glob filters and extra select/boolean choices. Enter and double-click return files; directories navigate. Escape dismisses New Folder, clears a search, then cancels.
- B3. SaveFile validates the destination and confirms overwrites without writing the target. SaveFiles returns ordered destinations with numbered collision suffixes. These names are recommendations to the caller, not filesystem reservations.
- B4. Copy Path is explicit; preview text selection does not automatically modify the clipboard. Rename, deletion, cut/paste, terminal execution, SFTP and drive management are excluded from chooser controls.
- B5. Each request uses a private temporary directory and separate native process. Only the desktop broker may call the backend. Request.Close and broker disconnect clean up outstanding processes. Native validation rechecks selection type, existence and access before returning file URIs.

## Build and install

Requires the normal project npm/Rust toolchains and Tauri Linux GTK 3/WebKitGTK 4.1 dependencies. Runtime integration also requires Python GObject/Gio and xdg-desktop-portal.

```sh
npm ci
npm run build:chooser
npm run install:chooser
```

The installer installs only user files and prints a backup manifest. It preserves existing portal defaults and routes only FileChooser through Explr, with the previous implementations as fallbacks. Its user catalog retains installed system portals. It leaves the normal explorer executable and directory association intact.

When existing portal requests and sharing sessions are finished:

```sh
systemctl --user daemon-reload
systemctl --user restart xdg-desktop-portal.service
```

Restore using the printed manifest, then reload/restart the broker when idle:

```sh
python3 scripts/install-chooser.py --restore /path/to/manifest.json
```

Restore refuses files edited after installation. Do not delete backups until the installation is accepted. The background chooser has no standalone launcher; applications open it through the portal.

## Architecture

| Boundary | Source |
| --- | --- |
| Portal options, request lifetime and D-Bus responses | `linux/chooser-portal.py` |
| Native validation, response file and window parenting | `src-tauri/src/chooser.rs` |
| Restricted native command dispatch | `src-tauri/src/main.rs` |
| Request-specific UI and selection policy | `src/chooser/ChooserApp.jsx`, `selection.js` |
| Reversible user installation and portal catalog | `scripts/install-chooser.py`, `linux/chooser-catalog.py` |

## Validation

```sh
cargo test --release chooser::tests
node --test tests/chooser-selection.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_chooser_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-chooser-dbus.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-native-chooser.py
```

The native script requires Xvfb, xdotool, ImageMagick, bubblewrap, Mesa and a built chooser. It uses a private display, network namespace and session bus; all mouse/keyboard events stay within that display. `XVFB`, `XDOTOOL` and `CHOOSER_BINARY` can select explicit executable paths. It never uses a browser preview. A successful private X11 check does not establish Wayland parenting or a live browser upload.
