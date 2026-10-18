# Explorer themes

Open **Settings → Appearance → Theme**. Selection applies immediately, persists on success. Failed saves restore previous selection/colors. **System** follows OS appearance: Latte for light, Mocha for dark. Explicit choices ignore OS changes. Switching does not remount app providers.

## Files and editing

1. E1. Open absolute directory shown below Theme selector. Backend resolves `app.path().app_config_dir()?.join("themes")` for `com.explr.app`; no cwd fallback.
2. E2. Copy `catppuccin-latte.theme.json` or `catppuccin-mocha.theme.json` inside that directory. Choose unique kebab-case `id`, nonblank `name`, `appearance` (`light` or `dark`). `system` is reserved.
3. E3. Keep `$schema: "./theme.schema.json"`, `schemaVersion: 1`, all 36 `tokens`. Use only `#RRGGBB` or `#RRGGBBAA`. Unknown fields rejected. Metadata limits: ID 64 codepoints, name 80 codepoints.
4. E4. Save as `*.theme.json`. Live reload waits 150ms after last filesystem event per path; complete valid saves update catalog without restart. Atomic editor replacements read final files, not temporary content.
5. E5. Select custom entry. Catppuccin defaults appear first; remaining entries use `(name,id)` Unicode codepoint order. An unavailable saved selection falls back to System; startup persists that correction when settings are writable.

Exact examples: [Latte](../src-tauri/resources/themes/catppuccin-latte.theme.json), [Mocha](../src-tauri/resources/themes/catppuccin-mocha.theme.json), [v1 schema](../src-tauri/resources/themes/theme.schema.json). Token names/CSS mapping: [`themeContract.js`](../src/themes/themeContract.js). Do not rename/drop tokens. Font, spacing, and motion settings remain separate.

## File ownership and safety

Root-only regular files; maximum 65,536 bytes. Reads stop at limit + 1. Symlinks/reparse points excluded; Unix descriptor-relative operations pin directories across path swaps. Windows ancestor handles deny delete sharing. JSON cannot load scripts, CSS, external paths or schema URLs.

Bundled files seed once per ID using create-new plus `.seed-state.json`. An older installation with the ledger below receives newly bundled IDs while its edited or deleted themes remain untouched:

```json
{"schemaVersion":1,"seededIds":["catppuccin-latte","catppuccin-mocha"]}
```

Existing seed/schema bytes never overwritten. Deleted seeded themes stay deleted. Corrupt ledger disables seeding, reports error, leaves existing valid themes discoverable. Sorted basename determines duplicate owner at startup. Embedded immutable palettes are emergency/bootstrap values, not extra selectable plugins.

Invalid/missing selected files use the OS-matched System default at cold start; an unavailable saved ID is reset to `system` without repairing theme files. During live editing, invalid saves retain each accepted file’s last-good definition. Deletion removes the selectable entry and falls back to System. Existing live ID owner wins duplicate collisions; after deletion, lexicographically first valid candidate takes over. Ordinary renames preserving ID do not flicker. Ownership is basename-based: renaming an owner with competing duplicates triggers the same sorted takeover; saved ID stays unchanged, winning colors change atomically without intermediate fallback. Directory recreation reattaches watching without reseeding. Valid custom colors may have low contrast: schema validity is not an accessibility guarantee. Bundled AA token pairs plus rendered component text/states are tested. Static CSS, JSX styles, generated inline styles use semantic root tokens; consumed legacy aliases are removed. Media/document pixels, native media/PDF/OS controls, raster assets are not recolored. File/status icon colors supplement readable labels or shape; they never provide the sole state cue.

## Validation and decoder boundary

Rust is authoritative file decoder. Equivalent schema/JS/Rust acceptance and reason checks apply **within common decoder domain**: Unicode-scalar strings, numbers representable by current `serde_json` configuration. Metadata length counts Unicode codepoints, not UTF-16 units or UTF-8 bytes. Common-domain fixtures include astral/boundary/multiple-error cases.

Raw JSON Schema/AJV acceptance is broader than native decoding for escaped unpaired surrogates. Shared fixtures explicitly assert expected divergences, not skipped tests:

| Fixture | JS/AJV | Rust file decoder |
| --- | --- | --- |
| Name `"\ud800"` or `"\udfff"` | Accepted | `invalid JSON` |
| Valid pair `"\ud83e\udeb7"` | Accepted, one codepoint | Accepted, one codepoint |
| `schemaVersion: 1e400` | Rejected; JS `unsupported schemaVersion` | Rejected; `invalid JSON` |

Schema remains unchanged. No alternate production decoder or numeric feature upgrade. Evidence corpus: [`cases.json`](../tests/themes/fixtures/theme-definitions/cases.json); tests: [`definition.test.js`](../tests/themes/definition.test.js), [`definition.rs`](../src-tauri/src/themes/definition.rs).

Read-layer type/byte-limit failures precede content parsing. Content reason priority:

```text
invalid JSON
expected ThemeDefinition v1
unsupported schemaVersion
invalid theme metadata
expected all 36 color tokens
invalid color token: <tokenName>
```

First invalid color follows `TOKEN_NAMES` order. Physical guard reasons: `theme file exceeds 65536 bytes`, `theme file must be a regular file`.

Diagnostics use existing error toasts for 5000ms; basenames/IDs/reasons only, never JSON bodies. Identical outstanding issues deduplicate across rerenders, selections, unrelated catalog revisions. Internal `ThemeIssue` optionally carries `fingerprint?: string`: opaque SHA-256 of successfully read bytes; omitted for read failures. Changed bad bytes with same reason notify once; corrected save clears dedupe. Plugin JSON schema remains unchanged.

```text
Invalid theme file "<file>": <reason>. Keeping "<activeName>".
Theme "<id>" is unavailable. Using the System default.
Duplicate theme id "<id>" in "<file>". File ignored.
Could not save theme selection. Keeping "<activeName>".
Theme directory is unavailable. Keeping "<activeName>".
Theme hot reload is unavailable. Keeping "<activeName>".
```

## Settings persistence and IPC

Runtime settings use `app.path().app_config_dir()?.join("settings.json")` (`$XDG_CONFIG_HOME/com.explr.app/settings.json`, normally `~/.config/com.explr.app/settings.json` on Linux). Every version uses this version-independent location before any legacy settings. A valid `<process cwd>/config/settings.json` is copied only when the OS settings file is absent; an existing OS file always wins, and the legacy file remains untouched. The installer never replaces this writable config. Theme files use the sibling `themes/` directory. New installations default to `active_theme_id: "system"`, mapping light appearance to Catppuccin Latte and dark appearance to Catppuccin Mocha. Migration removes exactly `darkmode`, `custom_themes`, `default_theme`, `default_themes_path`, `accent_color`; adds missing `active_theme_id: "system"`. No legacy theme mapping. Raw unrelated values/nested extras survive migration, selection saves, generic field saves. Partial valid objects gain typed defaults in memory, not destructive normalization on disk.

Same-directory temporary file, file sync, atomic replacement precede memory commit. This guarantees atomic visible replacement; directory fsync/power-loss durability is not claimed. Actual settings path is trusted; serialized `abs_file_path_buf` cannot redirect writes. Malformed/unreadable startup files remain unchanged; all writes/reset are blocked until repair and restart:

```text
Could not load settings. Defaults are temporary; existing file was not changed.
```

Frontend shows persistent Settings error plus toast; never bulk-saves temporary defaults. Reset uses `reset_settings_command`, keeps actual/injected path, selects System only after successful persistence. Failure retains settings/theme.

| Command | Result |
| --- | --- |
| `get_settings_snapshot` | `{ settings, loadError }`; transport/lock/serialization rejects String |
| `get_theme_catalog` | `{ revision, directory, themes, issues }`; revision starts at 1 |
| `set_active_theme_id`, `{ id }` | `{ active_theme_id }`; structured `{ code, message }` rejection |

Selection accepts `system` or registered ID. Generic field/batch selection writes reject exactly `Use set_active_theme_id for theme selection` before any mutation. Lock order: theme registry → settings outer mutex → settings inner mutex. Client queues writes/reset/snapshots, permits one optimistic theme save. Existing unrelated batch semantics are not redesigned.

## Live event and lifecycle

`themes-changed` targets main window with exact full `ThemeCatalog`, not patches. Revision starts at 1, increases only for observable themes/issues changes; unchanged bytes and metadata-only notifications do not emit. Frontend subscribes before initial snapshot, ignores older/equal revisions, cleans late listener promises in StrictMode. Pending selection overlays newest catalog; registry→settings lock order serializes selection validation/persistence against reload. No provider/navigation remount.

`ThemeState` owns watcher guard. Internal starter accepts `Weak<AppHandle>`; main retains external strong owner until processing worker stops/joins. Parent directory and themes directory use nonrecursive notify8.2.0 watches. Library exposes no private-thread join: backend drop plus bounded callback-disconnect acknowledgement proves callback quiescence; timeout logs cleanup failure. Watch failures remain visible; accepted catalog still supports explicit selections. Emit failures log and persist diagnostics in subsequent snapshot. Successful emissions log revision/timestamp without file contents.

Linux extracted-debug-package runtime checks are separate from browser event fixtures; neither proves OS installation, macOS, Windows, release builds, or updater behavior. Reproducible matrix, audit boundaries, strict pass/fail/not-run reporting: [theme-validation.md](./theme-validation.md). The bundled catalog contains 26 variants across the 12 approved families.

## Provenance

Palette: Catppuccin v1.8.0, commit [`07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`](https://github.com/catppuccin/palette/tree/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd). Primary [`palette.json`](https://raw.githubusercontent.com/catppuccin/palette/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd/palette.json) SHA256 `4bc114bb6b3c9a9c9e156564aa84625aef32c5da514d9dd431cf1fcad433a05f`. All seed RGB values verified against pinned source; alpha/semantic roles follow approved definitions. Mauve accent. Latte tertiary text uses subtext1 for AA.

Exact upstream [MIT license](../src-tauri/resources/themes/LICENSE), copyright 2021 Catppuccin, is bundled at `themes/LICENSE`. License SHA256 `814096d2c34cc216c624738a49356f32b7237733b4f7edb0685f4e50ef5074ba`.


## Bundled catalog and palette adaptations

The 24 additional variants are Dracula, Alucard, Nord, Gruvbox Dark/Light, Solarized Dark/Light, Tokyo Night Night/Storm/Moon/Day, Rosé Pine Main/Moon/Dawn, One Dark/Light, Everforest Dark/Light, GitHub Dark Default/Light Default, Monokai Classic, and Kanagawa Wave/Dragon/Lotus. Catppuccin Latte/Mocha remain the System defaults. Everforest uses medium contrast backgrounds; Monokai uses the open-source Classic palette.

Pinned repository revisions, palette paths, theme IDs, and license files: [`sources.json`](../src-tauri/resources/themes/sources.json). Original license texts ship with native bundles and the Linux installation. These are Explorer adaptations: neutral surfaces and semantic roles follow each source palette; foreground, muted text, focus rings, and strong borders are adjusted toward white/black when needed for readable controls. Accent button text selects white/black by contrast. Node catalog validation checks all 26 definitions, provenance coverage, text contrast ≥4.5:1, and focus/border contrast ≥3:1; Rust tests check seeding, upgrades, and preservation of edits/deletions.
