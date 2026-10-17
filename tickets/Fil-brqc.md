---
id: Fil-brqc
status: closed
deps: []
links: []
created: 2026-10-17T14:19:22Z
type: feature
priority: 2
assignee: AronGomu
---
# Show image thumbnails for video files in icon and list views

Extract a still frame for videos and render through the existing lazy image-thumbnail pipeline in icon and list views. Preserve file actions and use the existing video icon when extraction fails. Keep generation bounded and cached; support common video formats including formats the webview cannot play.

## Acceptance Criteria

- [x] A1 Native baseline displays icons for video fixtures; verify native-red.log.
- [x] A2 Generate valid scaled stills, reuse cache, invalidate changed files and fall back for invalid/unsupported media; verify focused Rust tests.
- [x] A3 Render loaded video image thumbnails in native icon/list views and preserve images/file selection; verify native-green.log.
- [x] A4 Reinstall validated build, verify installed native previews and checksum, synchronize portable documentation.
