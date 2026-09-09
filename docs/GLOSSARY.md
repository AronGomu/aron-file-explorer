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
| preview | in-app media and metadata viewer | `src/hooks/usePreview.js`, `PreviewModal` |
| terminal | embedded command console | `src/components/terminal/Terminal.jsx` |

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
