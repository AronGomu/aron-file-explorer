# xterm.js + Rust PTY Terminal Integration

## Goal

True terminal inside Explr: persistent Bash, agentic CLI workflows, reliable herdr interaction, easy explorer/terminal copy-paste. Preserve responsiveness under heavy output.

## Assumptions

A1. This plan records implemented work, then defines remaining acceptance work. Not a proposal to rewrite completed impl.

A2. Linux first. Native Wayland/hardware-GPU acceptance still needed; Xvfb smoke does not prove desktop performance.

A3. Hide preserves session. Stop terminates shell/foreground proc. Explorer navigation does not inject `cd`. Pasted text never auto-executes; multiline paste currently becomes spaces.

A4. Planning-only update. Tests below describe execution/acceptance steps; no tests or benchmarks rerun for plan generation.

## Current state

Branch: `terminal-integration`. Base commit: `22b69f5`; implementation remains uncommitted. Recorded evidence: `docs/terminal.md`, sections “Automated validation” / “Native GUI smoke — observed”. Prior run: 14 Node tests, 10 Rust terminal tests, builds passed; independent review clear. Not full product certification.

## Phase 1 — Core integration: completed

- [x] B1. Replace custom cmd/result console with xterm.js, FitAddon, optional WebGL. Verify: `src/components/terminal/Terminal.jsx`; `package.json`; recorded native GUI mount/input smoke.
- [x] B2. Implement persistent PTY, streaming bytes, resize, window-scoped sessions, independent reaping. Verify: `src-tauri/src/terminal.rs`; `src-tauri/src/commands/terminal_commands.rs`; recorded Rust terminal tests.
- [x] B3. Bound output/input queues; preserve startup replies; prioritize ordered interrupts over blocked paste. Verify: `src/components/terminal/terminalSession.test.js`; `src-tauri/src/terminal_tests.rs`; recorded 14/14 + 10/10 pass.
- [x] B4. Preserve hide/reopen; add Copy/Paste/Paste paths, Stop/New shell; isolate terminal keys. Verify: `src/layouts/MainLayout.jsx`; `src/components/terminal/Terminal.jsx`; recorded native clipboard, resize, interrupt, isolated herdr pane smoke.

## Phase 2 — Reproducible baseline

- [ ] C1. Rerun regression/build gates before further changes. Verify: every command below exits 0; capture warnings separately. Partial: Node/build pass; native Rust gates failed on missing `libpsl.pc`; follow-up fixes pass scoped Rust harness, not full app. See `docs/terminal-final-implementation-report.md`. Existing unrelated CSS/Rust warnings are not terminal fixes.

```bash
node --test src/components/terminal/terminalSession.test.js
npm run build
cargo check --offline
cargo test --offline terminal -- --nocapture
cargo build --offline --features custom-protocol
```

- [ ] C2. Record toolchain, dependency versions, OS, display backend, GPU, shell, viewport. Verify: complete environment record accompanying results. Partial: environment recorded in final report; GUI viewport not captured. NixOS needs transient GTK3/WebKitGTK 4.1/DBus/OpenSSL/pkg-config dev environment; no system apply.

## Phase 3 — Real workflow acceptance

- [ ] D1. Test Bash cwd/state, history, completion, pipes, resize, repeated Ctrl+C, hide/reopen. Verify: correct initial `pwd`; same `$$` after hide/reopen; retained variables; no explorer shortcut interference.
- [ ] D2. Expand isolated herdr test: tabs/panes, navigation, resize, mouse, Unicode, prefix keys. Verify: expected rendering/input across each action; no attachment to existing user server. Use fresh config with `herdr --no-session`; test named persistent-session behavior separately.
- [ ] D3. Test chosen agent CLI in disposable workspace. Verify: streaming, prompt entry, interrupt, continuation. Any credential use or model-backed spend requires explicit approval first.
- [ ] D4. Test explorer/terminal clipboard both directions. Verify: spaces, quotes, metacharacters remain literal; selected paths inserted correctly; multiline/control paste produces notice, no execution; clipboard-denial errors visible.

## Phase 4 — Responsiveness checks

- [ ] E1. Check responsiveness during bounded log output, TUI redraw, herdr pane activity. Verify: input, resize, Ctrl+C remain usable. No Alacritty comparison required.
- [ ] E2. Check bounds under stress. Verify: no silent output loss during live session, no input lockup, memory stabilizes after workload. Distinguish queue bounds from total renderer/OS memory.
- [ ] E3. Fix responsiveness regressions only if observed. Verify: targeted regression test red → green; affected workflow rerun. Inspect IPC chunking/ACK rate, renderer fallback, React updates as needed. Do not switch engines without separate decision.

## Phase 5 — Resilience / platform scope

- [ ] F1. Exercise output flood, saturated paste, repeated interrupts, shell exit with background slave holders, app close, Stop/restart. Verify: shell reaped, no retained terminal reader threads/FDs; fresh input survives overlapping interrupts.
- [ ] F2. Exercise WebGL init failure/context loss, hidden panel output, SFTP-before-open, missing shell/invalid cwd. Verify: usable fallback or explicit error; never silently execute locally for remote cwd.
- [ ] F3. Validate macOS/Windows if included in release scope. Verify: clipboard shortcuts, native shell, ConPTY interruption/cleanup, high DPI. Otherwise label Linux-only validation; do not claim cross-platform runtime parity.

## Phase 6 — Handoff

- [ ] G1. Update `docs/terminal.md` with observed evidence, remaining limits. Verify: every completed checklist item has command output or observed behavior; untested items stay unchecked.
- [ ] G2. Independently review any follow-up fixes; rerun affected gates. Verify: no remaining must-fix findings.
- [ ] G3. Commit/publish only after explicit request. Verify: intentional paths only; no scratch, secrets, unrelated changes; no history rewrite.

## Out of scope

H1. Alacritty window embedding; automatic bidirectional cwd sync; SSH backend; session restoration across app restart; new terminal tab system; unrelated explorer refactors; system rebuild/deploy.

## Next step

Execute Phase 2, then Phase 3 workflow acceptance: Bash, herdr, agent CLI, copy-paste. Standalone responsiveness checks remain part of validation, not a benchmark priority.
