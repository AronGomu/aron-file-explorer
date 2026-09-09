# Sidebar This PC removal — final implementation report

State: **partial**. Code committed locally; full runtime acceptance, main merge, publication pending.

## Ticket State List

| ID | Ticket | Implementation | Validation | Integration |
| --- | --- | --- | --- | --- |
| T1 | Remove sidebar This PC section | Implemented; commit `611fbbb984ea9c9b9f122006516cd6fd04b00130` | Source tests/build pass; desktop coverage partial | Branch `plan/remove-sidebar-this-pc`; not merged or pushed |

## Evidence

- E1. Fresh worker `5114ac08` ran explicit `ship`, headless REMOVE/production. Routing: Autonomous well-specified feature → `openai-codex/gpt-5.6-luna:high`. Independent fresh-context reviewer found no removal-scope defect; stale metadata comment corrected afterward. Parent strengthened heading uniqueness/footer-label tests.
- E2. Worker ran `node --test tests/sidebar-this-pc.test.mjs` against original Sidebar; removal assertion failed before source edit. Parent final rerun: `tests 5`, `pass 5`, `fail 0`.
- E3. `npm run build` passed: Vite 6.4.3, 107 modules transformed. Existing dependency tree temporarily linked into isolated worktree; link removed. Build warning: `Unexpected "@media" [css-syntax-error]`; dynamic/static Tauri core import warning remains. Baseline build before source edits was not completed, so warning equivalence was not experimentally established.
- E4. Native `cargo build --manifest-path "$WT/src-tauri/Cargo.toml" --bin src-tauri --target-dir "$WT/.tmp/sidebar-build-target"` passed inside existing main-worktree Nix dev shell. Four Rust warnings remained in untouched permission/search code. Rust unit tests were not run.
- E5. `git diff --check` plus new-test whitespace check passed. `git diff --exit-code -- src/main.jsx src-tauri/tauri.conf.json src/components/sidebar/sidebar.css` passed after all temporary runtime instrumentation was removed.
- E6. Final `graphify update .` passed: 1,666 nodes, 4,100 edges, 123 communities. Generated worktree graph kept untracked, outside product commit. Warning: `Cargo.toml` produced zero nodes; missing-skill warnings remain. No LLM extraction used.
- E7. Intended diff credential-pattern scan returned no matches. Source commit includes only `src/components/sidebar/Sidebar.jsx` plus `tests/sidebar-this-pc.test.mjs`. Main worktree staged/unstaged changes were not included.

## Runtime observations

| ID | Check | Observed evidence | Remaining gap |
| --- | --- | --- | --- |
| M1 | Fresh sidebar | Native XWayland screenshot: Favorites first; Drives, Network, footer visible; no old This PC section/gap | Dedicated overflow-scroll interaction not exercised; exact DOM selector count not captured |
| M2 | Legacy collapse storage | Disposable profile seeded with `thisPC:true`; all retained collapse/expand handlers returned true; restored source reload showed expanded sections | Raw legacy-key persistence after toggles not separately read back |
| M3 | Retained navigation/footer | Temporary DOM-click harness: favorite/drive active-state changes, Network add dialog, Terminal active state, Settings modal, Templates view, Add Data Source modal all true | No full console error capture; favorite/drive assertions used active state rather than independent directory-content checks |
| M4 | Main This PC | Temporary `document.dispatchEvent(new CustomEvent('open-this-pc'))` rendered native main This PC view; sidebar unchanged; system info displayed disposable HOME | Main-view folder navigation not exercised |

Runtime harness was temporary validation instrumentation, not committed test coverage. Screenshots were viewed during session, then deleted with owned scratch; observations above are retained record, not replayable image evidence.

## Files touched

- F1. `src/components/sidebar/Sidebar.jsx`: removed built-in section, user shortcuts, newly orphaned permission-helper chain; retained metadata, navigation, SFTP/history, remaining sections/footer. Updated now-stale metadata comment.
- F2. `tests/sidebar-this-pc.test.mjs`: five native Node source-contract tests; exact retained-heading uniqueness/order; retained footer accessible label.
- F3. `artifacts/FINAL_IMPLEMENTATION_REPORT_remove_sidebar_this_pc.md`: this report.
- F4. Generated `graphify-out/` exists only in ticket worktree; not committed. Main graph not refreshed because source not merged.

## Assumptions

### A1 — Isolation

New worktree started from `22b69f5a677f23ec96f0578acdcf6ce76a2db60b`. Pre-existing dirty main worktree plus separate dirty `remove/this-pc-sidebar` worktree left untouched. No commits imported from either dirty baseline.

### A2 — Dependency reuse

Main-worktree `node_modules` and Nix dev shell reused for validation without committing their unrelated manifest/config changes. Worktree did not initially contain these untracked/staged prerequisites. Native preflight therefore occurred after source implementation, contrary to planned ordering; this deviation is recorded rather than presented as preflight success.

### A3 — Runtime workaround

Wayland launch failed: `Gdk-Message: 18:57:44.778: Error 71 (Protocol error) dispatching to Wayland display.` XWayland launch used `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`.

Existing main Vite process owned IPv6 localhost port 1420. Ticket server used IPv4 `127.0.0.1:1420`. Validation-only binary temporarily used that IPv4 dev URL; `src-tauri/tauri.conf.json` restored afterward. Initial screenshot from wrong server discarded as candidate evidence. Existing main dev processes left running.

### A4 — Storage/profile safety

Runtime app ran from fresh scratch cwd with isolated HOME/XDG config/data/cache/state. Only disposable favorite fixture/storage seeded. No ejection, external SFTP connection, system apply, or user-data deletion performed.

### A5 — Publication destination

Proposed destination is existing `fork` remote, not upstream `origin`; destination not yet confirmed. No push attempted. Per G3, publication pauses for explicit confirmation even though orchestration requested autonomy.

### A6 — Acceptance honesty

Static tests do not prove full UI behavior. Remaining M1–M4 gaps keep T1 incomplete. Initial reviewer build blocker was resolved by parent dependency linkage; initial subagent acceptance rejection was not treated as verified success.

## User TODO

- [ ] U1. Confirm proposed publication destination: reply **“Use fork; publish after remaining validation passes.”** Verify: explicit confirmation received before any push.
- [ ] U2. After remaining runtime checks pass, orchestrator may merge/publish ticket and report. Verify: main contains source commit; remote SHA matches local main. No PR requested.

## Remaining agent work

- [ ] W1. Finish runtime gaps listed M1–M4 using isolated profile. Verify: DOM count, overflow scrolling, raw legacy-key preservation, actual folder contents, main-view navigation, runtime error record.
- [ ] W2. Merge validated ticket into main without disturbing staged/unstaged user changes. Verify: intended diff only; tests/build pass after integration.
- [ ] W3. Publish only after U1. Verify: remote SHA matches intended branch/main commits.
- [ ] W4. Remove plan index, matching ticket directory, matching HTML/progress, remaining run scratch only after successful main integration/publication. Verify: final report retained; unrelated artifacts untouched.

## Cleanup / residual risks

- C1. Owned app/frontend processes stopped. Temporary `node_modules` symlink removed. Ticket `.tmp/`, `.pi-subagents/`, worker ledger `/tmp/ship-run-20260909-remove-sidebar-this-pc.md` removed. Temporary `src/main.jsx` / Tauri config edits fully restored.
- C2. Final graph regenerated after cleanup; kept untracked. Plan artifacts retained because main integration is incomplete. Existing unrelated artifacts, branches, worktrees remain.
- C3. Out-of-scope existing SFTP error swallowing/listener cleanup, CSS warning, Rust warnings unchanged. No backend/shared permission component/CSS/package changes committed.
