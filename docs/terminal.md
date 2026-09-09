# Integrated terminal

## Architecture

A1. `src/components/terminal/Terminal.jsx` mounts xterm.js 6 inside existing bottom panel. Fit addon tracks panel/window size. WebGL addon accelerates rendering when WebGL2 works; initialization/context-loss failure falls back to default renderer.

A2. `src/components/terminal/terminalSession.js` bridges xterm to Tauri commands. Input serialized in arrival order; Unicode input encoded by Rust, legacy mouse binary input preserved separately. Output passed as `Uint8Array` → xterm incremental UTF-8/ANSI parser. No React transcript, custom built-ins, command logging, localStorage command history, HTML output rendering.

A3. `src-tauri/src/commands/terminal_commands.rs` owns session registry. Each command resolves session against invoking window label. `terminal_create` accepts local cwd, dimensions, Tauri `Channel`; returns session ID, initial-shell quoting mode. `terminal_write`, `terminal_interrupt`, `terminal_resize`, `terminal_ack`, `terminal_close` operate on that session only.

A4. `src-tauri/src/terminal.rs` uses `portable-pty` for PTY/ConPTY. Unix: `$SHELL -i`; unset/empty → `/bin/bash -i` when available, else `/bin/sh -i`. Windows: `powershell.exe`. Environment inherited, `TERM=xterm-256color`, `COLORTERM=truecolor`. Real shell owns history, completion, variables, job control, child processes.

A5. Output reader emits up to 8 KiB per message. At most 256 KiB outstanding output awaits consumed-byte ACKs from xterm `write` callbacks; extra single read buffer ≤8 KiB. Reader pauses at limit → OS PTY backpressure. These bounds exclude JSON serialization overhead, OS buffers, xterm parser/render buffers. Invalid over-ACK rejected. Closing wakes blocked flow waiter. After shell exit, output drains until EOF/idle with a one-second grace period. Bytes still pending at grace expiry produce an explicit truncation error before exit; delayed finite-output callbacks no longer hit the former silent 100 ms cutoff. Stalled ACK drain reports explicit error after one second rather than retaining session forever. Terminal error notice survives the subsequent exit event.

A6. Input queue bounded to 256 KiB UTF-8 accounting, including replies generated before session creation resolves. Startup success flushes queued replies in order; failure/disposal releases queue without sending. Oversized paste rejected visibly. Input split into ≤1024-code-point writes, preserving order/surrogate pairs. Unix native writes nonblocking/cancellable, with two-second stall timeout reporting partial-byte count. Generation tokens reject stale IPC writes arriving after interrupt. Scrollback bounded to 5,000 lines. Output not stored in React state. Resize events update PTY dimensions → native SIGWINCH where supported. Fit host uses external margins, not padding inside measured border-box.

## Lifetime / navigation

B1. No PTY until first panel open. Hide/reopen preserves shell, running commands, scrollback. Hidden output still consumed with same bounds. Hide is not stop.

B2. New shell starts in currently selected explorer directory; no selected directory → home. Invalid/nonlocal cwd rejected, including SFTP paths. No silent home fallback for invalid supplied path.

B3. Subsequent explorer navigation does not send `cd` into shell. Shell `cd` does not navigate explorer. Persistent shell cwd can differ from explorer cwd; toolbar path insertion uses explorer selection explicitly.

B4. Shell `exit` leaves transcript visible, disables input. **Stop** explicitly terminates current shell/foreground process without closing explorer, including recovery from unresponsive raw TUIs. **New shell** starts fresh session in current explorer directory. Old session cleanup completion, including late creation cleanup, is awaited before replacement. Stop shows a disabled pending state until close completes. Close failure remains visible and blocks replacement; repeated New shell attempts cannot bypass failed cleanup. Closing app window/unmounting terminal closes PTY, terminates shell; Unix cleanup also kills foreground PTY process group. Independent reaper waits for shell regardless of reader EOF. Unix nonblocking reader stops even if background descendants retain slave. Deliberately detached/background descendants are not guaranteed to terminate. Windows shell reaping/exit notification independent of reader, but blocked ConPTY I/O cancellation and descendant cleanup remain runtime-unverified.

B5. Late async create response after component disposal immediately closes returned session. Window destruction marks owner closed, rejecting in-flight creation before registry insertion.

## Clipboard / file paths

C1. **Ctrl+Shift+C / Cmd+C**: copy selected terminal text. Toolbar **Copy** same behavior. Plain Ctrl+C bypasses full/stalled frontend queues, cancels pending paste chunks, cancels active Unix write. Priority interrupts serialize separately from paste; fresh input waits for every preceding interrupt to finish. Unix checks actual termios: ISIG enabled with VINTR set to Ctrl+C → flush slave-side queues when NOFLSH is unset, signal current foreground group with SIGINT; raw TUIs or different VINTR → literal Ctrl+C byte. Slave handle opens only for flushing with O_NOCTTY/O_NONBLOCK, then closes; no retained slave suppresses EOF. Never unconditionally kills raw TUIs. Interrupt can discard queued paste input; user must re-paste deliberately. Windows retains literal control-byte path; saturation responsiveness there remains unverified.

C2. **Ctrl+Shift+V / Cmd+V**, browser paste event, toolbar **Paste**: insert clipboard text. Clipboard toolbar requires WebView clipboard permission/API support; failures displayed. Keyboard paste uses browser paste event directly.

C3. Pasted newlines/tabs become spaces; C0/C1 control characters removed. Notice shown when sanitization changes text. Paste does not synthesize Enter. This deliberately sacrifices multiline paste fidelity for safety, including inside editors. Keyboard input still supports real Enter/control keys.

C4. **Paste paths** inserts selected local file/directory paths; no selection → explorer current directory. Initial shell determines quoting: POSIX-style shells, Fish, PowerShell supported. Unknown shell → explicit error. Paths containing control characters rejected. Quoting follows initial shell, not later nested shells/SSH targets; manually adapt paths after changing shell family. Local paths do not map automatically into remote SSH sessions.

C5. Terminal output cannot read/write clipboard via OSC 52: parser handler consumes it. No clipboard addon installed. Output uses xterm parser, never `dangerouslySetInnerHTML`.

C6. **Ctrl/Meta + backtick** toggles panel. Terminal-owned key events do not bubble to explorer shortcuts. **Clear** clears scrollback; does not stop proc or clear shell history.

## Assumptions

D1. User approved xterm.js + real PTY, not embedding standalone Alacritty GUI. Initial target Linux; portable backend retained for Windows/macOS, not runtime-certified there.

D2. Clipboard paste must not auto-execute. Sanitization chosen instead of confirmation dialogs or multiline execution support.

D3. No automatic bidirectional cwd synchronization. No new tabs/session restoration across app restarts, remote SSH transport, benchmarks, or shell config management.

D4. Old `execute_command*` Rust handlers remain registered for unrelated callers; terminal no longer uses them. Existing parent-generated architecture HTML describes previous snapshot, not replacement.

## Automated validation

Run from repo root with Node, Rust, native Tauri build dependencies available:

```bash
node --test src/components/terminal/terminalSession.test.js
npm run build
cargo check
cargo test terminal -- --nocapture
```

E1. Node tests cover sanitized paste, shell-specific quoting, binary output/ACK timing, serialized input, disposal/late create, bounded startup replies/paste, Ctrl+C bypass/cancellation, overlapping-interrupt ordering, fit-host spacing.

E2. Rust tests use isolated Bash without user shell startup scripts. Cover retained variables, incremental output before cmd finishes, `stty size` after resize, Ctrl+C interruption, saturated input recovery, literal Ctrl+C in raw mode, explicit exit, normal/forced shell exit with background slave holders, ACK bounds, close during output flood, remote cwd rejection. These tests do not run herdr or real agent CLIs.

E3. NixOS native build needs transient development environment exposing GTK3, WebKitGTK 4.1, DBus, OpenSSL, pkg-config. No system rebuild needed. Validation during implementation used existing `/nix/store/*-dev/{lib,share}/pkgconfig` directories via `PKG_CONFIG_PATH`; ordinary shell initially lacked DBus discovery. No system config changed.

E4. Frontend build warning about malformed CSS outside terminal scope remains; static xterm/WebGL imports also increase main bundle. Runtime responsiveness unmeasured. Build success is not proof of herdr compatibility.

## Native GUI smoke — observed

G1. Historical implementation validation, before follow-up defects below were reproduced: Node **14/14**, Rust terminal **10/10**, `npm run build`, `cargo check --offline`, `cargo build --offline --features custom-protocol`. Independent review found no remaining must-fix after overlapping-interrupt regression fix. Full unrelated Rust suite not run.

G2. Native app exercised through WebKitWebDriver (`browserName: "wry"`, `webkitgtk:browserOptions.binary` pointing to built app), `TAURI_WEBVIEW_AUTOMATION=true`, isolated Xvfb display, fresh HOME/XDG/TMPDIR/config/cwd. Real Tauri IPC, real Bash PTY, actual xterm renderer—not mocked transport. WebDriver typed commands; assertions read xterm buffer through test-only runtime inspection. No production test hooks added.

G3. Observed: exported Bash variable retained across cmds; hide/reopen retains transcript; window resize matched native `stty size` at 79 columns × 12 rows; keyboard Ctrl+C interrupted sleeping proc. Multiline/control-containing paste showed sanitization notice without execution. Toolbar Copy → Paste roundtrip preserved selected text. Browser clipboard reads outside user gesture were denied; user-clicked toolbar roundtrip succeeded.

G4. Isolated `herdr --no-session` used fresh config, onboarding/update checks disabled, no agents, no attachment to existing user server. Alternate screen rendered; nested Bash pane accepted cmd, displayed expected output. Stop terminated session; New shell restarted; explicit `exit` updated GUI. Persistent-session detach was not certified by monolithic smoke test. No paid agent work launched.

G5. Xvfb smoke is not hardware-GPU performance evidence. User desktop/Wayland latency, WebGL context-loss behavior, sustained agent workloads remain unmeasured. Broader manual acceptance below remains pending beyond these observed checks.

## Manual acceptance — broader checks pending

- [ ] F1. Launch app in disposable config/data context. Open terminal in local test directory → `pwd` matches selected directory; actual process has TTY.
- [ ] F2. Run Bash, set/export variable, run later cmd → retained state. Hide/reopen → same shell PID, transcript.
- [ ] F3. Run Neovim/tmux or equivalent disposable TUI → mouse, Ctrl keys, Unicode, resize, fullscreen redraw correct; explorer shortcuts not triggered.
- [ ] F4. Run isolated herdr instance with explicit temporary config, no agents, no attachment to existing user session → navigation/render/input correct. Do not run default `herdr` against live user sessions during automated checks.
- [ ] F5. Run user-approved agent CLI in disposable workspace → streaming, prompt handling, interrupt, resume behave correctly. Do not launch paid/model-backed work without approval.
- [ ] F6. Copy terminal selection; paste text/path with spaces, quotes, shell metacharacters. Verify literal insertion, no execution until Enter. Paste multiline/control-containing text → visible sanitization notice.
- [ ] F7. Open SFTP explorer directory before first terminal open → clear local-cwd rejection, no local shell spawned against remote path.
- [ ] F8. Check standalone responsiveness during bounded log/TUI workloads. Verify usable input, resize, Ctrl+C; no silent output loss or unbounded memory growth. No Alacritty comparison required.
- [ ] F9. Close app while shell/TUI active; verify shell/foreground proc exits. Repeat with sustained output, WebGL context loss, restart, window resizing, clipboard permissions denied.
- [ ] F10. Validate native macOS/Windows shells, clipboard shortcuts, ConPTY lifecycle, high-DPI rendering separately.

## Follow-up fixes — reviewed slice, native gates pending

H1. Scope: `docs/terminal-final-implementation-report.md` T2 only. Slave-side paste purge, bounded/observable exit drain, close-before-create. Existing integration files outside these paths unchanged. No commits, staged files, system changes, paid CLI, live herdr sessions. Assumption: Linux-only scoped evidence; frontend host/IPC mocks do not certify real WebView behavior.

H2. Red → green evidence, captured before production edits:

- R1. `cargo test --offline --manifest-path .tmp/terminal-fix/session-harness/Cargo.toml`: red **7 passed / 2 failed**. Saturated paste contaminated fresh `printf`; test no longer masks failure with Ctrl+U or a semicolon continuation. Delayed emit received **38,903 / 50,000** bytes, no error (`finite output silently truncated`). Green: **11 passed / 0 failed**, including exact 50,000 bytes with 150 ms callback delay; continuous post-exit output emits `Terminal output drain timed out after shell exit; output truncated` before Exit. Ten consecutive final runs passed **110 / 110** tests.
- R2. `node --test src/components/terminal/terminalSession.test.js`: baseline **14 passed**; first disposal regressions **14 passed / 3 failed** (`disposal completed before terminal_close`, `disposal completed before late create`, `Missing expected rejection.`). Final **20 passed / 0 failed**. Covers close completion, repeated disposal, late create/close failure, disposal before start, failed creation; existing raw-byte/overlapping-interrupt input behavior unchanged.
- R3. `node --test src/components/terminal/Terminal.test.js`: initial **0 passed / 2 failed**; replacement created before close completed or despite close failure (`2 !== 1`). Final **6 passed / 0 failed**. Runs actual transformed JSX, effects, handlers with mocked React host/xterm/IPC. Also covers repeated failed-cleanup attempts, Stop pending/failure, persistent truncation notice. Intermediate edge tests first failed before corresponding fixes.
- R4. `node --test src/components/terminal/*.test.js`: final **26 passed / 0 failed**. `node --check src/components/terminal/terminalSession.js`, `git diff --check`, `test -z "$(git diff --cached --name-only)"`: exit **0**. No lint/typecheck/full-test scripts configured in `package.json`.
- R5. `PATH="$PWD/../../node_modules/.bin:$PATH" npm run build -- --configLoader native --outDir .tmp/terminal-fix/frontend-dist`: exit **0**, **114 modules transformed**, **built in 1.28s**. Uses original worktree dependencies read-only; native config loader avoids Vite's shared `node_modules/.vite-temp` writes. Existing warnings: `Unexpected "@media" [css-syntax-error]`, mixed static/dynamic Tauri import, bundle >500 kB. No CSS/bundle changes in this fix.

H3. Reproduce standalone Rust evidence from repo root. Harness imports actual `Session` source plus colocated tests, not a copied implementation; excludes two Tauri command tests. Bash, cached Rust dependencies required. Scratch may be removed after running; commands recreate it.

```bash
mkdir -p .tmp/terminal-fix/session-harness/src
cat > .tmp/terminal-fix/session-harness/Cargo.toml <<'TOML'
[package]
name = "terminal-session-regressions"
version = "0.0.0"
edition = "2021"
[workspace]
[dependencies]
portable-pty = "0.9"
libc = "0.2"
TOML
printf '#[path = "%s/src-tauri/src/terminal.rs"]\npub mod terminal;\n' "$PWD" \
  > .tmp/terminal-fix/session-harness/src/lib.rs
cargo test --offline --manifest-path .tmp/terminal-fix/session-harness/Cargo.toml
```

H4. Native gates remain incomplete. Ordinary `pkg-config` missing (exit 127); final transient attempt used existing real Nix-store pkg-config 0.29.2 and `*-dev/{lib,share}/pkgconfig` metadata only. `libpsl.pc` still unavailable (`No package 'libpsl' found`); dynamic libsoup flags resolved with this tool. `cd src-tauri; timeout 120s cargo check --offline -j 2` with scratch `CARGO_TARGET_DIR` exited **124** during dependency compilation. No further environment repair attempted. Full native check, native terminal tests, custom-protocol build, GUI/Wayland/GPU/macOS/Windows acceptance remain unproved. Prior G1–G5 observations are not re-certification of this patch.

H5. Independent fresh Rust/concurrency review accepted the three fixes; frontend review confirmed cleanup/error retention. Parent reran Node 26/26, actual Session Rust 11/11, frontend build; after applying reviewed delta to original worktree, Node 26/26 and diff checks passed again. Frontend reviewer also flagged xterm's still-focusable stdin after exit; parent deferred this pre-existing UI behavior because client rejects backend writes after exit/disposal. No keyboard/focus/accessibility or native runtime certification implied. Optional NOFLSH/remapped-VINTR regressions remain absent. Main worktree has unrelated dirty overlap; no commits/pushes or main integration.
