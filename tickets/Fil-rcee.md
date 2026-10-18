---
id: Fil-rcee
status: closed
deps: []
links: []
created: 2026-10-17T13:31:18Z
type: task
priority: 2
assignee: AronGomu
---
# Restore explorer focus, cover interface shortcuts, and show useful physical drives

Implement requested navigation focus fix, button keyboard access, and physical-drive discovery.

## Acceptance Criteria

- [x] A1. Native resize → item click → Arrow navigation works in list and icon modes; toolbar/panel pointer actions return focus, while typing and dialogs retain theirs.
- [x] A2. Every visible toolbar/side-panel button has a discoverable conflict-free shortcut; existing bindings remain functional.
- [x] A3. Linux discovery shows root SSD once, attached data disk even unmounted, and USB; excludes virtual, boot and duplicate subvolume entries.
- [x] A4. Focused checks and installed native checks pass; portable docs updated and origin/main synchronized after changes.
