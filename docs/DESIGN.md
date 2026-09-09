# Design

React provider hierarchy feeds `MainLayout`. Providers/hooks invoke Rust commands through Tauri IPC. Rust command modules own filesystem, SFTP, search, metadata, settings, hashing, previews, permissions, volumes, templates, and shell operations. Shared backend resources are managed through Tauri state.

Primary flow:

```text
src/main.jsx -> App.jsx -> providers -> MainLayout -> hooks -> Tauri invoke -> Rust commands/state
```
