# Theme validation

Run from repo root. Local deps only; no accounts, secrets, system apply, or production test hooks.

## Supported host

- H1. Linux x86_64 / NixOS. Node 24.18.0; npm 11.16.0; Rust/Cargo 1.95.0.
- H2. SDK: dbus 1.16.2; GTK 3.24.52; WebKitGTK 2.52.6; OpenSSL 3.6.3.
- H3. Browser: local Playwright Chromium revision 1243. Preserve cache through review revalidation.

```bash
nix develop --no-warn-dirty --command pkg-config --exists dbus-1 gtk+-3.0 webkit2gtk-4.1 openssl
nix develop --no-warn-dirty --command pkg-config --modversion dbus-1 gtk+-3.0 webkit2gtk-4.1 openssl
npm ci --ignore-scripts
```

Committed flake supplies SDK, not Node/Rust toolchain. SDK failure blocks native proof; never substitute a system-wide apply.

## Browser gallery

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp/theme-validation/playwright-browsers" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp/theme-validation/playwright-browsers" nix develop --no-warn-dirty --command npm run test:themes:visual -- tests/themes/visual/harness.spec.js
```

URL: `http://127.0.0.1:1422/?case=harness-button&theme=catppuccin-latte|catppuccin-mocha`.

Gallery supplies actual production components for 23 final cases plus harness/reload probes. Unknown cases throw `Unknown theme gallery case: ${caseId}`. Gallery-only `mockIPC` rejects every command with `Unknown theme gallery IPC command: ${command}`; Button needs no IPC data. Unit coverage imports actual gallery entrypoint, calls real `@tauri-apps/api/core` `invoke`. Future cases must explicitly add their own allowlisted fixtures. No production frontend entrypoint or native IPC modification.

T2 uses production JSON seeds/root activator for both query values. `settings` renders production SettingsProvider → ThemeProvider → SettingsPanel with explicit fixture-only IPC. Unknown IPC still rejects; no fixture code enters production bundle.

## JS / bundle checks

```bash
npm test
npm run test:themes -- tests/themes/harness.test.jsx
npm run build
```

`npm test` explicitly runs Node `tests/*.test.mjs`, then Vitest. Vitest `.test.js` files stay outside Node discovery. Unit JSON goes to `artifacts/theme-validation/unit/results.json`; visual output goes to `artifacts/theme-validation/visual/`. Gallery is absent from production `dist`. Build warnings must be retained in command output; do not infer a warning-free build. `npm run test:themes:audit` now scans live source with pinned PostCSS 8.5.28 / @babel/parser 8.0.4.

## Locks / native build

Root Cargo lock migrated from `e91a404:src-tauri/Cargo.lock`, not generated afresh. Initial migration added 17 package versions with no existing upgrades. That graph compiled directly but Tauri CLI rejected npm/Rust minor mismatches.

Approved compatibility floor: npm dialog `^2.3.2` requires API `^2.6.0`; Rust dialog 2.3.0 requires Tauri `^2.6`, fs `^2.4`, plugin build `^2.3`. Final lock uses Tauri 2.6.0/dialog 2.3.0 with minimally matched Tauri family. npm API 2.6.0/dialog 2.3.2/opener 2.4.0 share API `^2.6`. Manifests unchanged. Necessary dependency runtime changes exist; this is not a zero-runtime-change lock migration. Preserve unrelated old Cargo resolutions; never run broad lock regeneration.

```bash
nix develop --no-warn-dirty --command cargo metadata --locked --format-version 1 > /dev/null
CARGO_TARGET_DIR="$PWD/target" npm run tauri -- build --debug --no-bundle -- --locked
```

## Fixture-only native capture

**Never launch the native executable unsandboxed.** Startup scans mounts/home and cleans SFTP temp files. HOME/XDG/cwd alone do not protect host content. The following script creates a private filesystem, network, PID, IPC namespace; starts Xvfb inside it; binds only read-only `/nix/store`, the built executable, capture script, generated fixture `/etc`, writable run-owned fixture/evidence directories. No host `/etc`, `/home`, `/run`, X socket directory, or credentials are bound.

```bash
THEME_VALIDATION_FONTS="$(nix eval --raw nixpkgs#dejavu_fonts.outPath)" \
THEME_VALIDATION_MESA="$(nix eval --raw nixpkgs#mesa.outPath)" \
nix shell nixpkgs#bubblewrap nixpkgs#xvfb nixpkgs#xorg.xwininfo \
  nixpkgs#imagemagick nixpkgs#dejavu_fonts nixpkgs#mesa \
  --command bash scripts/capture-native-theme.sh
```

Script uses a fresh private X socket directory, Xvfb `-displayfd` readiness, PID/socket verification, real `xwininfo` capture. Store-only software Mesa is needed for WebKit EGL; otherwise a window can exist with a blank WebView. No graphics-device or host driver-directory bind.

Each run retains exact argv/status, app/Xvfb stdout/stderr, namespace mounts, isolated env/cwd, window tree, screenshot/image stats, source-config before/after hashes, fixture file list, cleanup receipt under `artifacts/theme-validation/native/native-capture.*`. Scratch cwd/HOME/all XDG/TMPDIR roots live under repo-local scratch and are removed on exit. Evidence and browser cache remain.

Capture rejects near-uniform images, but **exit 0 or window existence alone is not rendered-app proof**. Inspect retained screenshot: require recognizable toolbar, sidebar, file grid labels. Successful Linux capture shows synthetic `/etc` entries `fonts`, `group`, `hosts`, `passwd`; these are generated fixtures, not host files. Drive device/capacity metadata can remain visible via allowed `/nix/store` mount, without access to host home/content. App exits via intentional SIGTERM after capture (143); Xvfb exits 0. Native `GStreamer element appsink not found. Please install it.` warning means video preview is unverified, not grounds to install system packages.

## Rust tests / publication gates

- G1. T1 runs real Node dummy Cargo/test executables only. Tests verify CLI filtering/artifact selection/dedup, malformed JSON, missing executable, compile/child errors, actual cwd/env/argv, stdout/stderr logs. Test scratch roots are removed after every case.
- G2. Existing/full Rust suites remain deferred to T2 settings reset/load safety work. Later runner uses unique cwd/HOME/XDG/TMPDIR and `--test-threads=1`; it is env isolation, not a filesystem/network sandbox. Audit suite hardcoded paths/network effects before execution.
- G3. Requested `vitest@3.2.7` remains pinned. `GHSA-82fw-gwwq-j7x9` affects dev-only `@vitest/mocker`/Vitest; production-only audit clean. User disposition required before publication; no risk waiver or automatic upgrade.
- G4. Native Linux screenshot proves rendered production app under fixture isolation, not Catppuccin colors, full functionality, video, native reload, or macOS/Windows behavior. T2–T6 own later feature evidence. Parent fresh review remains required.

## Screenshot matrix

| Surface | Latte query | Mocha query | Native Linux |
| --- | --- | --- | --- |
| `harness-button` | Harness check only | Harness check only | Not a native gallery case |
| 23 final gallery cases | Integrated capture + rendered text | Integrated capture + rendered text | Browser fixtures are not native evidence |
| Real packaged app | Selection/reload scenario | Selection/reload scenario | Debug `.deb`, isolated real IPC/disk/restarts |


## T2 selection validation

Run filtered Rust suites only after auditing reset/path safety. Runner pins worktree-local target; test children receive isolated cwd/HOME/all XDG/TMPDIR. Settings tests now retain injected paths and preserve malformed source bytes. Full Rust suite is still deferred; runner is environment isolation, not native filesystem sandbox.

```bash
nix develop --no-warn-dirty --command node scripts/run-isolated-rust-tests.mjs --filter theme_
nix develop --no-warn-dirty --command node scripts/run-isolated-rust-tests.mjs --filter tests_settings
npm run test:themes -- tests/themes/definition.test.js tests/themes/selection.test.jsx tests/themes/migration-contract.test.js
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp/theme-validation/playwright-browsers" nix develop --no-warn-dirty --command npm run test:themes:visual -- tests/themes/visual/settings.spec.js --repeat-each 3
```

Native UI selection automation extends original sandbox; no app test hooks. At fixed 1200x800 viewport, real X11 actions select System/Latte/Mocha, verify persisted JSON, deny saves via fixture directory permissions, restart, edit seeded JSON, restart again, migrate legacy settings. Screenshots plus before/after settings/seed files retained. Tab/file/terminal-input screenshots require visual inspection; no claim based solely on window existence.

```bash
CARGO_TARGET_DIR="$PWD/target" npm run tauri -- build --debug --no-bundle -- --locked
THEME_VALIDATION_FONTS="$(nix eval --raw nixpkgs#dejavu_fonts.outPath)" \
THEME_VALIDATION_MESA="$(nix eval --raw nixpkgs#mesa.outPath)" \
nix shell nixpkgs#bubblewrap nixpkgs#xvfb nixpkgs#xorg.xwininfo \
  nixpkgs#imagemagick nixpkgs#dejavu_fonts nixpkgs#mesa nixpkgs#xdotool nixpkgs#jq \
  --command bash scripts/capture-native-theme.sh --selection
```

Authoring/decoder limits: [themes.md](./themes.md). Schema/JS/Rust content parity is scoped to common decoder domain; surrogate/numeric exceptions are explicit shared fixtures. Native Linux proof does not claim macOS/Windows support verification or media readiness. T3 supplies live watching; T4/T5 supply component colors. T6 integrates their gates without changing keyboard/navigation behavior. Fresh independent review remains mandatory.

## T6 integrated gate

```bash
npm test
npm run test:themes
npm run test:themes:audit
npm run build
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp/theme-validation/playwright-browsers" \
  nix develop --no-warn-dirty --command npm run test:themes:visual -- --workers=2
nix develop --no-warn-dirty --command node scripts/run-isolated-rust-tests.mjs --filter theme_
nix develop --no-warn-dirty --command node scripts/run-isolated-rust-tests.mjs --filter tests_settings
```

[`integration.test.jsx`](../tests/themes/integration.test.jsx) checks atomic 36-token root replacement, non-color preservation, alias removal, planted audit defects, System light→dark→light with open Settings/preview/confirm, custom discovery/selection/live edit/invalid/duplicate/deletion/cold fallback. Tauri command/event transport is mocked here; in-memory remount is not native persistence proof. Rust/native scripts cover disk ownership and migration.

[`integration.spec.js`](../tests/themes/visual/integration.spec.js) writes `artifacts/theme-validation/visual/manifest.json`: exactly 46 unique base entries (23 case IDs × Latte/Mocha), screenshot paths, extra observed hover/focus captures, contrast artifact, `pass|fail|not-run`. These are generated output locations, not durable evidence links. Cases start with clean browser storage. Manifest rewrites per completed case; an interrupted run leaves remaining entries `not-run`. Missing files/duplicates fail validation; captures are not golden-image comparison or user signoff.

| Core cases | Peripheral cases |
| --- | --- |
| settings, explorer-grid, explorer-list, explorer-details | search, network, sftp-form, templates |
| sidebar-tabs, breadcrumb, context-menu, controls, this-pc | preview-image, preview-video, preview-text, preview-error |
| — | dialogs, permissions, toasts, confirm, loading, error-fallback |

Contrast receipts enumerate visible DOM text/input values with computed foreground, ancestor backgrounds, group opacity, ratio, threshold, exact disabled-element exception. Normal text ≥4.5:1; large text ≥3:1. Rendered focus outline samples ≥3:1. Existing [`explorer.spec.js`](../tests/themes/visual/explorer.spec.js) and [`peripheral.spec.js`](../tests/themes/visual/peripheral.spec.js) retain explicit border/focus/selected/disabled/empty/loading/error checks and native media pixel boundaries. Matrix `pass` means its recorded assertions passed, not that every possible interaction/focus affordance was audited. Screenshot inspection remains required. Gradients, complex overlapping paint, platform controls and arbitrary user theme AA are not exhaustively certified by DOM compositing.

Disabled controls use WCAG inactive-control exception, identified per element. File-type icons retain filenames/type labels; status decoration retains readable message text; checkerboard indicates transparency without altering image pixels. These are bounded redundant-content exceptions, not blanket low-contrast exemptions.

### Source audit boundary

[`audit-theme-colors.mjs`](../scripts/audit-theme-colors.mjs) parses `src/**/*.css`, `src/**/*.js`, `src/**/*.jsx`; CSS declarations/selectors/media rules and JS/JSX color properties/generated style strings are inspected, not blindly replaced. It rejects literal hex/named/RGB/HSL/gradient/fallback colors, legacy names, unresolved color vars. Root semantic tokens and three derived RGB vars resolve through contract; geometry/font/spacing vars are not color aliases. Sizes, URLs/hash identifiers, ordinary content strings are not color declarations. JSON seeds/fixtures are trusted inputs outside this source scan. No arbitrary runtime dataflow claim.

[`color-allowlist.json`](../tests/themes/color-allowlist.json) contains exact `{path,match,reason}` entries only; reasons: `terminal|user-content|native-control|asset`. No path globs; stale exceptions fail. Current allowlist is empty. Explicit terminal component directory boundary is excluded; shared root changes still run terminal-state native checks. Any future asset exception must identify exact declaration/string, not a whole file. `Theme color audit passed` requires zero findings; CLI exits nonzero on unapproved literals, legacy refs, unresolved color vars or malformed input.

### Extracted debug package: no install

Build and inspect from root; `set -euo pipefail` prevents stale/missing package selection. Fresh run-owned extraction directory prevents stale extracted resources without deleting another run's files. Local Nix `dpkg` provides extraction on hosts without `dpkg-deb`.

```bash
set -euo pipefail
CARGO_TARGET_DIR="$PWD/target" npm run tauri -- build --debug --bundles deb -- --locked
mkdir -p "$PWD/.tmp/theme-validation"
export THEME_VALIDATION_PACKAGE_ROOT="$(mktemp -d "$PWD/.tmp/theme-validation/package.XXXXXX")"
nix shell nixpkgs#dpkg --command bash -c '
  set -euo pipefail
  mapfile -t packages < <(find "$PWD/target/debug/bundle/deb" -maxdepth 1 -type f -name "*.deb")
  test "${#packages[@]}" -eq 1
  dpkg-deb --contents "${packages[0]}"
  dpkg-deb --extract "${packages[0]}" "$THEME_VALIDATION_PACKAGE_ROOT"
  cmp src-tauri/resources/themes/LICENSE "$THEME_VALIDATION_PACKAGE_ROOT/usr/lib/Explr/themes/LICENSE"
  sha256sum "${packages[0]}" "$THEME_VALIDATION_PACKAGE_ROOT/usr/lib/Explr/themes/LICENSE"
'
export THEME_VALIDATION_FONTS="$(nix eval --raw nixpkgs#dejavu_fonts.outPath)"
export THEME_VALIDATION_MESA="$(nix eval --raw nixpkgs#mesa.outPath)"
export THEME_VALIDATION_X11="$(nix eval --raw nixpkgs#xorg.libX11.outPath)"
for scenario in selection reload; do
  nix shell nixpkgs#bubblewrap nixpkgs#xvfb nixpkgs#xorg.xwininfo \
    nixpkgs#imagemagick nixpkgs#dejavu_fonts nixpkgs#mesa nixpkgs#xdotool \
    nixpkgs#jq nixpkgs#python3 \
    --command bash scripts/capture-native-theme.sh --scenario "$scenario"
done
```

Native scripts launch extracted executable inside existing private namespace, not gallery/dev server. Selection scenario checks real IPC→settings bytes→restart for System/explicit/custom IDs, denied save rollback, migration preservation. Reload scenario checks real file writes/atomic rename→watch event→same-window pixel change, invalid-save last-good, duplicate/rename/deletion/directory recovery, cold invalid/missing fallback, PTY PID/starttime/cwd/executable preservation, graceful close. Review screenshots for selected-file marker, tab/form/terminal continuity; PTY identity alone cannot prove every UI state. Never enable asset-protocol relaxations to manufacture media success.

Native result records use `{platform,build,caseId,status,command,observation,screenshot}` under `artifacts/theme-validation/native/results.json`; `build` distinguishes `dev` (including debug `.deb`) from `release`. Attach package resource listing, exact executable/hash, license comparison, settings receipts, command logs, screenshots. Script exit 0 alone is insufficient.

### Strict acceptance boundaries

- B1. Report `pass`, `fail`, `not-run` separately. Full npm/theme/browser/build/audit plus focused Rust/debug-package checks are current theme-only gate; no claim of complete full Rust, optimized release, OS-installed or cross-platform validation.
- B2. T4 accepted residuals remain: real pointer-tab drag expected failure, baseline keyboard/ThisPC observation limits. Synthetic drag event success is not real pointer success. No keyboard UX changes in T6.
- B3. T5 accepted residuals remain: native asset-video and unreachable fixture states. Browser video/PDF checks cannot promote native media to pass. No new production routes, IPC hooks or protocol exceptions.
- B4. macOS/Windows and optimized release are `not-run` without actual environments/builds. Full Rust `--all` is `not-run` unless separately safety-audited/executed. SDK/package/browser failures must remain failures, not skipped green gates.
- B5. Graph generation requires installed Graphify runtime; absence/failure is recorded separately. Independent review precedes conventional commit/feature-branch push. No main merge or plan cleanup inside T6 worker.
