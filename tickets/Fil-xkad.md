---
id: Fil-xkad
status: closed
deps: []
links: []
created: 2026-10-17T15:37:50Z
type: task
priority: 2
assignee: AronGomu
---
# Clean generated artifacts and synchronize validated application

Archive obsolete agent output outside the checkout, retain reusable native tests under tests/native, validate current changes, synchronize the existing remote branch, and rebuild/reinstall the functional native release.

## Acceptance Criteria

- [x] A1 Verified external recovery archive contains 253 obsolete files; reusable checks relocated under tests/native/ and generated output ignored.
- [x] A2 41 focused Node, 202 theme, 54 unique Rust and 3 desktop tests pass; five native suites pass. Known baseline sidebar assertion and scoped Rust coverage recorded in docs/validation-status.md; outgoing sources scanned, with three reviewed ARIA false positives.
- [x] A3 Revision 06ca2bf synchronized on the current feature branch with clean worktree and 0/0 divergence. Reinstalled build checksum 10750e25eae0f7a669d302e1a5b029233f18ea4a7e095619c8a3cb0b5c25a975 matches the installed executable; all five installed native suites pass.
