---
id: Fil-oxu0
status: closed
deps: []
links: []
created: 2026-10-17T14:01:29Z
type: bug
priority: 2
assignee: AronGomu
---
# Persist file pane zoom and folder scroll across sessions

Zoom resets to 100% and directory scroll state exists only in memory. Persist shared icon/list zoom and per-folder scroll offsets across app restarts. Preserve existing selection and launch-request behavior.

## Acceptance Criteria

- [x] A1 Native restart reproduces missing zoom/scroll persistence; verify artifacts/zoom-scroll/native-red.log.
- [x] A2 Stored zoom and per-folder offsets restore in icon/list views; verify Node storage tests and native restart checks.
- [x] A3 Build and reinstall validated native application; verify installed restart checks, binary hash and desktop default.
