# T1: Remove sidebar This PC section

**Plan:** `./artifacts/PLAN_2026_09_09_remove_sidebar_this_pc.md`  
**Depends:** none  
**Commit outcome:** Sidebar starts with Favorites; This PC section/shortcuts absent; remaining navigation unchanged.

## Context (self-contained)

- C1. Goal: remove only sidebar This PC section, not `.sidebar-content`. User chose A2: heading, This PC shortcut, user-volume shortcut, user-directory shortcuts disappear; Favorites, Drives, Network stay.
- C2. Slice: single vertical change, including setup preflight, regression test, private orphan cleanup, desktop validation. No parallel writer needed.
- C3. Out: backend commands, main `ThisPCView`, CSS redesign, new navigation, storage migration, unrelated errors, generated-code edits. Preserve dirty worktree/staging. No commit/push without separate request.

## Assumptions

- A1. No replacement shortcuts. Existing Favorites pointing to user folders remain valid.
- A2. Keep legacy `sidebarSectionsCollapsed.thisPC` when already stored; remove default property only. No storage writes merely from mounting.
- A3. Native Node source-contract tests fit small removal without new deps. These do not prove rendered behavior; desktop checks remain mandatory.
- A4. No user-owned account/key/package setup required. Node/npm/node_modules present during planning. Resolve missing desktop prerequisites before source edits; never system-apply.

## Requirements

- R1. Remove complete This PC `<section>` at `src/components/sidebar/Sidebar.jsx:407–465`, not wrapper at line 383.
- R2. Retain active headings in order: Favorites, Drives, Network. No empty replacement section. Retain footer actions Terminal, Settings, Templates, Add Source.
- R3. Remove newly orphaned `browseToProtectedFolder`, `getUserDirectories`, `userDirectories`, `getUserVolume`, `userVolume`, imported `open`, default `thisPC` collapse property.
- R4. Remove newly unreachable private permission-helper chain: `PermissionHelper` import/render, `isPermissionHelperOpen`, `permissionDirectory`, corresponding setters, named-directory failure branch. Change private signature to `handleItemClick = async (path) =>`; replace `const success = await loadDirectory(targetPath);` with `await loadDirectory(targetPath);`. Retain navigation/SFTP/history behavior preceding removed branch. Do not delete shared `PermissionHelper.jsx`.
- R5. Keep metadata loading/state: `systemInfo.current_running_os` still selects drive ejection command. Keep volume loading, `SidebarItem`, `navigateTo`, shared providers, dialog dep. Keep commented Quick Access code; pre-existing dead code outside scope.
- R6. Keep `MainLayout.jsx`, `ThisPCView.jsx`, CSS, package manifest/lock, Rust untouched. Add only `tests/sidebar-this-pc.test.mjs` plus Sidebar change; graph refresh may change generated graph files separately.

## Inputs

- I1. Read `src/components/sidebar/Sidebar.jsx:1–768` — helpers/state, sections, retained modals/footer.
- I2. Read `src/components/sidebar/Favorites.jsx:16–131` — invokes `onItemClick(item.path)` without directory name.
- I3. Read `src/layouts/MainLayout.jsx:334–453,758–759` — existing `open-this-pc` event receiver/view; unchanged.
- I4. Read `src/components/sidebar/sidebar.css:22–46` — wrapper sizing/scrollbar; unchanged.
- I5. Read `package.json:6–29`, `AGENTS.md`; inspect `git status --short` before editing. Existing dirty files include package manifest, Rust, providers, explorer list, docs, Nix files.
- I6. From Depends: none. No predecessor contract.

## Interface contract (level 5)

### Produces — existing public export unchanged

```jsx
const Sidebar = ({ onTerminalToggle, isTerminalOpen, currentView }) => {
    // Existing remaining UI; This PC section removed.
};
export default Sidebar;
```

### Consumes — existing provider/child names unchanged

```js
const { volumes, loadDirectory, loadVolumes } = useFileSystem();
const { currentPath, navigateTo } = useHistory();
const { removeFromFavorites } = useContextMenu();
const { navigateToSftpConnection, createSftpUrl, isSftpPath, parseSftpPath, createSftpPath } = useSftp();
```

```json
{
  "selector": "aside.sidebar > .sidebar-content",
  "count": 1,
  "headings": ["Favorites", "Drives", "Network"],
  "absentSectionHeading": "This PC",
  "absentSectionControls": ["Expand This PC", "Collapse This PC"],
  "retainedFooterLabels": ["Toggle Terminal", "Settings", "Templates", "Add Datasource"]
}
```

### Storage contract

```js
// Fresh default: same existing unrelated properties, no thisPC.
{ quickAccess: false, favorites: false, drives: false }
// Existing values: parsed as before; no migration or removal of unknown keys.
localStorage.getItem('sidebarSectionsCollapsed');
localStorage.setItem('sidebarSectionsCollapsed', JSON.stringify(newSectionCollapsed));
```

- B1. Errors: no new error type/code/message. Remaining failures unchanged. No fallback UI replacing removed section.
- B2. Invariants: all `currentView` values render same retained sections; volume metadata can still load; mounts never erase favorites/connections/collapse data. Favorites named Desktop or This PC remain allowed; absence applies to built-in section, not arbitrary user data.
- B3. Integration links: no new process/host/library boundary. Existing `document` event `open-this-pc` remains received by `handleOpenThisPC` in `src/layouts/MainLayout.jsx:334,437`, observed by `<ThisPCView />` at line 759. Only removed section's dispatch disappears; main listener remains.

## TDD

- [x] D1. Red — add `tests/sidebar-this-pc.test.mjs` using only `node:test`, `node:assert/strict`, `node:fs`. `node --test tests/sidebar-this-pc.test.mjs` must fail against unchanged Sidebar on removed-heading/shortcut assertions.
- [x] D2. Green — apply R1–R6 minimal removal; same command passes.
- [x] D3. Refactor — only newly orphaned private chain; same test command remains green.

## Test plan

Source tests read `new URL('../src/components/sidebar/Sidebar.jsx', import.meta.url)` with UTF-8. Static checks deliberately test removal shape, not React runtime.

| ID / Test name | Input | Expect |
| --- | --- | --- |
| S1 / removes built-in This PC section | Sidebar source | No `<h3 className="sidebar-section-title">This PC</h3>`, `name="This PC"`, `sectionCollapsed.thisPC`, `thisPC: false` |
| S2 / removes built-in user shortcuts | Sidebar source | No identifiers `browseToProtectedFolder`, `getUserDirectories`, `userDirectories`, `getUserVolume`, `userVolume` |
| S3 / retains sidebar shell and navigation | Sidebar source | `className="sidebar-content"`, `className="sidebar-footer"`; exact h3 titles Favorites → Drives → Network occur once in increasing source order; footer labels from contract remain |
| S4 / retains drive metadata and shared loading | Sidebar source | `get_meta_data_as_json`, `setSystemInfo`, `loadVolumes`, `systemInfo?.current_running_os?.toLowerCase()` remain |
| S5 / removes orphan permission helper only | Sidebar source | No `PermissionHelper`, `permissionDirectory`, `isPermissionHelperOpen`, `@tauri-apps/plugin-dialog`; `await loadDirectory(targetPath);` remains |
| M1 / fresh sidebar | Desktop app, fresh disposable profile, explorer then this-pc view | DOM contract above; no gap where old section lived; scrolling/footer functional |
| M2 / legacy collapsed sections | Disposable localStorage `sidebarSectionsCollapsed` = `{"thisPC":true,"favorites":false,"drives":false,"network":false}`; reload, toggle each retained section twice | Section absent; each retained toggle works/persists; unknown legacy key tolerated; retained sections return expanded |
| M3 / retained navigation | Disposable profile with benign local favorite to existing folder; mounted drive; empty Network | Favorite/drive navigate; Network add dialog opens/closes; footer actions work; no new runtime errors; do not eject disks or connect external accounts |
| M4 / main This PC view survives | DevTools `document.dispatchEvent(new CustomEvent('open-this-pc'))` | Main This PC view opens, sidebar still matches contract; existing main-view folder navigation works |

## Impl steps

- [ ] P1. Frontload setup/user interaction before edits. Verify: `node --version`, `npm --version`, `test -d node_modules`, `npm run build`, isolated desktop procedure below; desktop opens. Never clear user's data. If native launch fails, record exact prerequisite/error before implementation. No accounts/secrets needed; no package installation planned.
- [x] P2. Record worktree baseline; create feature branch `plan/remove-sidebar-this-pc` if absent. Verify: `git status --short`, `git branch --show-current`; preserve existing changes/staging. Do not reset/stash user work.
- [x] P3. Add native tests per S1–S5. Verify: Red failure identifies old section, not missing deps/syntax.
- [x] P4. Remove section/private orphan chain per R1–R6. Verify: same test cmd passes; review `git diff -- src/components/sidebar/Sidebar.jsx`; no surviving caller broken.
- [ ] P5. Validate M1–M4, build. Verify: capture each manual outcome, test output, build exit code; runtime gap means incomplete ticket, never checked done.
- [x] P6. Refresh graph after source changes: `graphify update .`. Verify: success output; inspect generated diff separately, report unrelated refresh noise without deleting it.

## Validation

- [x] V1. `node --test tests/sidebar-this-pc.test.mjs` — S1–S5 pass; Red + Green evidence recorded.
- [ ] V2. `npm run build` — exit 0; compare warnings with preflight baseline.
- [ ] V3. Isolated desktop procedure below — M1–M4 outcomes recorded; no runtime regressions from slice.
- [x] V4. No silent-failure swallow on added paths — none expected, removal adds no error path. Existing untouched SFTP catches remain outside scope; report, do not fix.
- [ ] V5. App functional — Favorites, Drives, Network, footer, main This PC route exercised; no destructive/eject test.
- [x] V6. `git diff --check -- src/components/sidebar/Sidebar.jsx`; `git diff --no-index --check /dev/null tests/sidebar-this-pc.test.mjs` — no whitespace diagnostics. Confirm only intended source/test paths changed beyond preserved baseline/generated graph.
- [ ] V7. Commit msg draft: `refactor(sidebar): remove redundant This PC shortcuts`. Draft only; no commit authorization.

## Isolated desktop procedure (Linux)

Backend config/logs use process cwd (`src-tauri/src/constants.rs:7–20`). WebView state needs separate HOME/XDG dirs. Do not launch ordinary `npm run tauri dev` against user profile for these checks.

- [ ] H1. Start frontend in separate terminal: `npm run dev`. Verify: configured dev URL `http://localhost:1420` responds (`src-tauri/tauri.conf.json:9`).
- [ ] H2. Build debug binary inside existing Nix dev shell; launch from fresh scratch cwd with isolated HOME/XDG. Execute following block from repo root. Verify: desktop opens; printed scratch path differs from real HOME; generated config/logs stay under scratch `work`; WebView state stays under scratch `data`/`cache`. If isolation cannot be observed, do not seed storage; record blocker.

```bash
ROOT="$PWD"
mkdir -p "$ROOT/.tmp"
RUN_DIR="$(mktemp -d "$ROOT/.tmp/sidebar-this-pc.XXXXXX")"
export ROOT RUN_DIR
mkdir -p "$RUN_DIR/home" "$RUN_DIR/config" "$RUN_DIR/data" "$RUN_DIR/cache" "$RUN_DIR/state" "$RUN_DIR/work"
printf 'Isolated run: %s\n' "$RUN_DIR"
nix develop --no-warn-dirty --command bash -c '
  cargo build --manifest-path "$ROOT/src-tauri/Cargo.toml" --bin src-tauri --target-dir "$RUN_DIR/target" &&
  cd "$RUN_DIR/work" &&
  env HOME="$RUN_DIR/home" XDG_CONFIG_HOME="$RUN_DIR/config" XDG_DATA_HOME="$RUN_DIR/data" XDG_CACHE_HOME="$RUN_DIR/cache" XDG_STATE_HOME="$RUN_DIR/state" "$RUN_DIR/target/debug/src-tauri"
'
```

- [ ] H3. Use only scratch-owned directories as Favorites/navigation fixtures. In isolated WebView DevTools, seed M2 collapse JSON; never copy real favorites/SFTP data. Verify: M1–M4 results captured; disk eject/external SFTP connection not exercised.
- [ ] H4. Close app/frontend. Inspect own `RUN_DIR` before cleanup; remove only run-owned scratch through approved targeted cleanup. Verify: evidence retained outside scratch; no user paths removed. No wildcard/root cleanup.

## Risks / limits

- L1. Source-contract tests cannot prove DOM/event behavior. M1–M4 mandatory, never replaced with static claims.
- L2. Existing metadata mock fallback, SFTP swallowing/listener cleanup unchanged. Shared bugs unrelated to removal stay out.
- L3. No architecture decision introduced: reversible UI subtraction, unchanged wire/storage/public APIs. ADR count: 0 per ADR eligibility rules.
