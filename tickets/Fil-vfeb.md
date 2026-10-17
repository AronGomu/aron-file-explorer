---
id: Fil-vfeb
status: closed
deps: []
links: []
created: 2026-10-17T14:31:52Z
type: bug
priority: 2
assignee: AronGomu
---
# Make Ctrl+W consistently close the active tab

Ctrl+W is ignored while editing and when only one tab remains. Close the active tab from the item pane, toolbar, path/search inputs and text fields. Closing the final tab closes the native window; preserve session restoration and modal protection. Keep Ctrl+T input protection and held-key repeat behavior.

## Acceptance Criteria

- [x] A1 Reproduce ignored Ctrl+W from path input in native app; verify native-red.log.
- [x] A2 Close the active tab, switch to its neighbor, protect dialogs/repeats, and close final native window with session restore; verify native-green.log.
- [x] A3 Reinstall and verify installed native behavior and matching checksum; synchronize portable keyboard documentation.
