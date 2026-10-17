---
id: Fil-41kx
status: closed
deps: []
links: []
created: 2026-10-17T14:08:20Z
type: bug
priority: 2
assignee: AronGomu
---
# Dismiss path input selection and return focus after outside clicks

Selecting text in the location input then clicking non-editable application content should dismiss editing and return keyboard focus to the item pane. Preserve clicks inside the input, clicks into other editable controls, dialogs, and path navigation.

## Acceptance Criteria

- [x] A1 Reproduce outside-click focus failure in native app; verify native-red.log.
- [x] A2 Clear location selection and focus items on outside click; verify native-green.log including input/dialog protection.
- [x] A3 Install validated build; verify installed native checks, matching checksum and desktop default.
