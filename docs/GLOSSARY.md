# Glossary

[x] Activated
[x] Project scanned

## Frontend

| word | short description | ref in code |
| --- | --- | --- |
| shell | primary desktop UI layout | `src/layouts/MainLayout.jsx`, `src/App.jsx` |
| provider | React context state boundary | `src/providers/`, `src/App.jsx` |
| hook | reusable frontend state/IPC logic | `src/hooks/` |
| panel | file-explorer UI region | `src/components/`, `src/layouts/` |
| keymap | target scoped keyboard command registry | `src/utils/keyboard.js`, `docs/PRODUCT_VISION.md` |
| preview | in-app file viewer with editable local TXT text | `src/components/explorer/DetailsPanel.jsx`, `src/components/explorer/FileContentPreview.jsx` |

## Backend

| word | short description | ref in code |
| --- | --- | --- |
| command | Tauri IPC backend operation | `src-tauri/src/commands/`, `all_commands()` |
| state | managed shared backend data | `src-tauri/src/state/`, `setup_app_state()` |
| search | indexed/fuzzy file lookup engine | `src-tauri/src/search_engine/` |
| previewer | backend preview payload builder | `preview_commands::build_preview` |
| executor | backend shell command runner | `command_exec_commands.rs` |
| sftp | remote filesystem transport | `src-tauri/src/commands/sftp_file_system_operation_commands.rs` |

## Other

| word | short description | ref in code |
| --- | --- | --- |
| ipc | frontend-to-Rust command bridge | `src-tauri/src/main.rs`, Tauri `invoke` calls |
| tauri | desktop shell and build system | `src-tauri/tauri.conf.json` |
| graph | persistent code knowledge graph | `graphify-out/graph.json` |
| adapter | stable boundary for replaceable engines | target architecture in `docs/PRODUCT_VISION.md` |
| transport | filesystem source normalized for explorer | `FileSystemProvider`, `SftpProvider` |

## File chooser

| word | short description | ref in code |
| --- | --- | --- |
| chooser | request-scoped file selection UI returning local URIs | `src/chooser/ChooserApp.jsx`, `src-tauri/src/chooser.rs` |
| portal backend | D-Bus implementation used by the desktop broker | `linux/chooser-portal.py` |
| chooser catalog | user catalog retaining system portal implementations | `linux/chooser-catalog.py` |
