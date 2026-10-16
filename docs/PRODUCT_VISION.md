# Product Vision

## Final Goal

Build a fast, keyboard-first desktop file explorer. Navigation, selection, actions, and feedback share context so users can inspect files, preview media, and move through the filesystem without breaking flow.

File Pilot is primary interaction reference for explorer quality, speed, navigation, and preview behavior. This project should learn from that experience without becoming a clone.

## Product Pillars

1. **Keyboard first** — every core action is reachable, predictable, discoverable, and conflict-free from keyboard.
2. **Performance first** — directory loading, search, focus movement, and preview remain responsive on large trees and slow transports.
3. **Shared context** — explorer path and tabs stay synchronized by explicit, understandable rules.
4. **Native preview** — images, video, audio, PDF, text, folders, and extensible future formats preview in-app with safe large-file handling.
5. **Transport independence** — local files, SFTP, and future providers expose one explorer-facing model while preserving transport-specific capabilities.
6. **Safe power** — destructive file actions, remote credentials, host identity, local asset access, and shell execution use explicit capability boundaries.
7. **Cross-platform** — Linux, macOS, and Windows behavior remains intentional, tested, and native-feeling.

## Target Experience

- Launch one app into a ready explorer workspace.
- Navigate, select, search, preview, rename, copy, move, delete, and open files without mouse use.
- Preview common media immediately; cancel expensive work; continue keyboard navigation while preview stays open.

## Architectural Direction

- Central command/keymap router with focus scopes and conflict resolution.
- Canonical workspace state for active path, selection, focused pane, and tabs.
- Typed IPC contracts between React and Rust.
- Filesystem transport interface for local, SFTP, and future providers.
- Preview pipeline based on metadata, thumbnails, streaming, cancellation, and bounded memory.
- Backend-owned secrets stored through OS credential facilities; frontend receives opaque connection IDs.
- Verified remote host identity with known-hosts or explicit trust-on-first-use policy.
- Transport capability model distinguishing trash/recovery from permanent deletion.

## Delivery Stages

1. **Secure foundation** — move remote secrets behind OS credential storage, verify SFTP host keys, restrict asset access, distinguish trash from permanent deletion, review shell capability exposure.
2. **Stabilize foundation** — remove state duplication, fix IPC drift, add frontend quality gates, record performance baselines and budgets.
3. **Define core contracts** — typed IPC, workspace state, command router, filesystem transport, and preview handler interfaces.
4. **Keyboard core** — focus model, command palette, configurable bindings, conflict tests, shortcut help.
5. **Explorer core** — reliable navigation/selection, paged async directory model, lazy metadata, cancellation, virtualization, operation queue.
6. **Preview core** — safe media streaming/thumbnails, transport capability matrix, cancellation, cache, pluggable handlers.
7. **Cross-platform hardening** — Linux/macOS/Windows integration, security, performance, recovery, and packaging tests.

## Success Measures

- Core explorer workflow completes keyboard-only.
- Shortcut conflicts are detected automatically.
- Reference hardware, datasets, and transport conditions are documented; p95 input-to-paint latency stays below 50 ms under each benchmark workload.
- Large files never require full base64 copies in frontend memory.
- New preview adapter can be added without editing unrelated explorer code.
- Permanent remote deletion always requires explicit confirmation describing lack of recovery.
- SFTP connection fails closed when host identity is unknown or changed, except explicit trust-on-first-use flow.

## Out of Scope for Initial Foundation

- Recreating every File Pilot feature.
- Plugin marketplace or remote plugin execution.
- Cloud storage providers beyond transport interface design.
- Full IDE/editor features.
- Shell replacement or command-language invention.
