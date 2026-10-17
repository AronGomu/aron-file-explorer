# Validation snapshot — 2026-10-17

The desktop improvements and repository cleanup were checked with the following commands.

- V1. `node --test tests/bundled-themes.test.mjs tests/file-deletion.test.mjs tests/file-selection.test.mjs tests/explorer-session.test.mjs tests/file-drag.test.mjs`: 41 passing tests.
- V2. `npm run test:themes -- --reporter=dot`: 202 passing tests. Theme-save failure now reconciles the newest catalog instead of restoring an outdated palette; missing-theme expectations follow the System fallback.
- V3. `node scripts/run-isolated-rust-tests.mjs --filter FILTER`, for `theme_`, `system_theme_persistence`, `file_move_commands`, `video_commands`, `volume_discovery` and `launch_requests`: 56 passing Rust tests in isolated profiles. The full Rust suite was not rerun for this synchronization; older fixture and concurrent-search failures remain outside these results.
- V4. `npm run test:desktop`: three passing integration tests. `npm run test:themes:audit` and `git diff --check` pass.
- V5. `node_modules/.bin/tauri build --no-bundle --ci -- --locked`: successful production build; Vite retains its existing bundle-size warning.
- V6. The five runnable checks in [tests/native/README.md](../tests/native/README.md) pass against the full native release, covering group moves in both views, target conflicts, focus, tab closing, session persistence and video/image previews. They use isolated profiles and unfocused Wayland workspaces. Live SFTP and other operating systems were not tested.
- V7. Outgoing source, tests and documentation passed secret scanning after reviewing three exact false positives in ARIA keyboard-shortcut attributes. No credential values were found or exported.

## Known broader-test limitation

`npm test` stops at `tests/sidebar-this-pc.test.mjs`, whose existing structural assertion requires `sidebar-footer`; the current sidebar has no footer. Its exact failure is `expected: /className="sidebar-footer"/`. This predates the cleanup. The focused Node command and separate complete theme suite above distinguish passing checks from that unresolved baseline test.

## Generated output and recovery

Historical agent logs, screenshots, proposals, applied patches and completed planning reports are generated output. Cleanup archived 253 files with SHA-256 verification under the current user's state directory at `explr/repo-artifact-archives/`, outside the checkout. Six retained native scripts moved into `tests/native/`; obsolete pointer-driven and fixture-specific launch scripts were archived. `artifacts/` and `.tmp/` are ignored to keep subsequent test runs out of commits. Durable implementation docs, source, tests, theme licenses and tickets remain in Git.
