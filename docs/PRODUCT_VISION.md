# Product Vision

## Final Goal

Build a fast, keyboard-first desktop workspace combining file explorer and terminal in one application. Explorer and terminal share navigation context, selection, actions, and feedback so users can inspect files, run commands, preview media, and move through the filesystem without breaking flow.

File Pilot is primary interaction reference for explorer quality, speed, navigation, and preview behavior. This project should learn from that experience without becoming a clone.

## Product Pillars

1. **Keyboard first** — every core action is reachable, predictable, discoverable, and conflict-free from keyboard.
2. **Performance first** — directory loading, search, focus movement, preview, and terminal output remain responsive on large trees and slow transports.
3. **Shared context** — explorer path and terminal working directory stay synchronized by explicit, understandable rules.
4. **Native preview** — images, video, audio, PDF, text, folders, and extensible future formats preview in-app with safe large-file handling.
5. **Terminal choice** — terminal integration evolves behind a stable adapter so future users can select or plug in terminal engines.
6. **Transport independence** — local files, SFTP, and future providers expose one explorer-facing model while preserving transport-specific capabilities.
7. **Safe power** — destructive file actions, remote credentials, host identity, local asset access, and shell execution use explicit capability boundaries.
8. **Cross-platform** — Linux, macOS, and Windows behavior remains intentional, tested, and native-feeling.

## Target Experience

- Launch one app into a ready explorer/terminal workspace.
- Navigate, select, search, preview, rename, copy, move, delete, and open files without mouse use.
- Toggle or focus terminal instantly; terminal starts in explorer directory.
- Change directory in terminal; explorer follows when user enables or requests synchronization.
- Send selected file paths from explorer to terminal safely, with correct shell quoting.
- Preview common media immediately; cancel expensive work; continue keyboard navigation while preview stays open.
- Swap terminal engine without rewriting explorer, command routing, or workspace layout.

## Architectural Direction

- Central command/keymap router with focus scopes and conflict resolution.
- Canonical workspace state for active path, selection, focused pane, tabs, and terminal sessions.
- Typed IPC contracts between React and Rust.
- Filesystem transport interface for local, SFTP, and future providers.
- Preview pipeline based on metadata, thumbnails, streaming, cancellation, and bounded memory.
- Terminal adapter interface separating UI/workspace integration from PTY or external terminal engine.
- Backend-owned secrets stored through OS credential facilities; frontend receives opaque connection IDs.
- Verified remote host identity with known-hosts or explicit trust-on-first-use policy.
- Transport capability model distinguishing trash/recovery from permanent deletion.

## Delivery Stages

1. **Secure foundation** — move remote secrets behind OS credential storage, verify SFTP host keys, restrict asset access, distinguish trash from permanent deletion, review shell capability exposure.
2. **Stabilize foundation** — remove state duplication, fix IPC drift, add frontend quality gates, record performance baselines and budgets.
3. **Define core contracts** — typed IPC, workspace state, command router, filesystem transport, preview handler, and terminal adapter interfaces.
4. **Keyboard core** — focus model, command palette, configurable bindings, conflict tests, shortcut help.
5. **Explorer core** — reliable navigation/selection, paged async directory model, lazy metadata, cancellation, virtualization, operation queue.
6. **Preview core** — safe media streaming/thumbnails, transport capability matrix, cancellation, cache, pluggable handlers.
7. **Terminal core** — built-in PTY adapter, streaming I/O, resize/signals, process-tree lifecycle, explorer↔terminal actions.
8. **Terminal adapters** — validate stable adapter through optional external/pluggable terminal integration.
9. **Cross-platform hardening** — Linux/macOS/Windows integration, security, performance, recovery, and packaging tests.

## Success Measures

- Core explorer workflow completes keyboard-only.
- Shortcut conflicts are detected automatically.
- Reference hardware, datasets, and transport conditions are documented; p95 input-to-paint latency stays below 50 ms under each benchmark workload.
- Large files never require full base64 copies in frontend memory.
- Terminal cancellation terminates underlying process tree.
- Explorer and terminal path sync behavior is deterministic and user-controlled.
- New preview or terminal adapter can be added without editing unrelated explorer code.
- Permanent remote deletion always requires explicit confirmation describing lack of recovery.
- SFTP connection fails closed when host identity is unknown or changed, except explicit trust-on-first-use flow.

## Out of Scope for Initial Foundation

- Recreating every File Pilot feature.
- Plugin marketplace or remote plugin execution.
- Cloud storage providers beyond transport interface design.
- Full IDE/editor features.
- Shell replacement or command-language invention.
