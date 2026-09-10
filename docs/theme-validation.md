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

Gallery supplies actual production Button plus T2 Settings. Unknown cases throw `Unknown theme gallery case: ${caseId}`. Gallery-only `mockIPC` rejects every command with `Unknown theme gallery IPC command: ${command}`; Button needs no IPC data. Unit coverage imports actual gallery entrypoint, calls real `@tauri-apps/api/core` `invoke`. Future cases must explicitly add their own allowlisted fixtures. No production frontend entrypoint or native IPC modification.

T2 uses production JSON seeds/root activator for both query values. `settings` renders production SettingsProvider → ThemeProvider → SettingsPanel with explicit fixture-only IPC. Unknown IPC still rejects; no fixture code enters production bundle.

## JS / bundle checks

```bash
npm test
npm run test:themes -- tests/themes/harness.test.jsx
npm run build
```

`npm test` explicitly runs Node `tests/*.test.mjs`, then Vitest. Vitest `.test.js` files stay outside Node discovery. Unit JSON goes to `artifacts/theme-validation/unit/results.json`; visual output goes to `artifacts/theme-validation/visual/`. Gallery is absent from production `dist`. Existing CSS `Unexpected "@media"` and dynamic-import warnings remain outside T1 scope. `test:themes:audit` implementation belongs to T6; do not invoke it yet.

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
| `harness-button` | T1 placeholder capture | Identical T1 capture | Not a native gallery case |
| Production app shell | T2+ colors | T2+ colors | T1 fixture-only rendered screenshot |
| Settings / reload / remaining surfaces | Owning follow-up ticket | Owning follow-up ticket | T6 integrated evidence |


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

Authoring/decoder limits: [themes.md](./themes.md). Schema/JS/Rust content parity is scoped to common decoder domain; surrogate/numeric exceptions are explicit shared fixtures. Native Linux proof does not claim macOS/Windows support verification or media readiness. T3 owns live watching; T4/T5 own remaining component colors. Fresh independent review remains mandatory.
