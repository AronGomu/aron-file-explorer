# Project Context

FileExplorer is cross-platform Tauri desktop file manager.

- Frontend: React 19 + Vite (`src/`)
- Backend: Rust + Tauri 2 (`src-tauri/`)
- IPC: Tauri commands registered in `src-tauri/src/main.rs`
- Automated tests: Rust unit/integration tests; no frontend test framework detected
- CI: `.github/workflows/test-only.yml`

Source-of-truth code lives in `src/` and `src-tauri/src/`. Generated docs and build output are not source of truth.
