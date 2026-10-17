---
id: Fil-af2r
status: closed
deps: []
links: []
created: 2026-10-17T14:46:38Z
type: feature
priority: 2
assignee: AronGomu
---
# Move selected files by dragging onto folders, breadcrumbs and sidebar locations

Enable moving one or multiple selected items through internal native HTML dragging. Targets include folder items in grid/list, breadcrumb folder segments, sidebar favorites and usable drive/network locations. Preserve rubber-band/keyboard selection, avoid overwrites or self/descendant moves, and support local volume boundaries.

## Acceptance Criteria

- [x] A1 Native baseline lacks item dragging/drop moves; native-red.log records draggable=false and mousedown prevented.
- [x] A2 Safe local batch moves, conflicts, self/descendant rejection and cross-volume moves verified by 7 Rust tests; drag selection/target guards verified by 4 Node tests.
- [x] A3 Native grid/list moves to folder, breadcrumb and sidebar destinations verified: 12 passing scenarios, including multiple selections, conflicts/cancellation and preserved marquee/keyboard selection.
- [x] A4 Installed release passes all 12 native scenarios; build/installed SHA-256 82f5a9b6eed5238926d933fb60248543a0d11611c26929dd84b4088422750e45. Portable documentation synchronized at f18ae0d1f16f02806a31fd0df5b876b26a66fe73 with clean status and 0/0 divergence.
