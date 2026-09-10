import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import ThemeProvider, { useTheme } from '../../src/providers/ThemeProvider.jsx';
import SettingsProvider, { useSettings } from '../../src/providers/SettingsProvider.jsx';
import SettingsPanel from '../../src/components/settings/SettingsPanel.jsx';
import { bootstrapTheme } from '../../src/themes/applyTheme';
import { showError } from '../../src/utils/NotificationSystem';
import latte from '../../src-tauri/resources/themes/catppuccin-latte.theme.json';
import mocha from '../../src-tauri/resources/themes/catppuccin-mocha.theme.json';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn() }));
let root, container, theme, settings, disk, catalog, media, listeners, mounts;
const loadError = 'Could not load settings. Defaults are temporary; existing file was not changed.';
function Probe({ renderPanel }) {
    theme = useTheme(); settings = useSettings();
    const [state, setState] = useState(() => { mounts++; return 'tab/file/form/terminal'; });
    return <><input aria-label="preserved state" value={state} onChange={event => setState(event.target.value)} />
        <output>{String(theme.activeThemeId)}/{theme.resolvedThemeId}</output>{renderPanel && <SettingsPanel isOpen onClose={() => {}} />}</>;
}
const flush = async () => { await act(async () => {}); };
async function mount(strict = false, renderPanel = true) {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    const app = <SettingsProvider><ThemeProvider><Probe renderPanel={renderPanel} /></ThemeProvider></SettingsProvider>;
    await act(async () => root.render(strict ? <React.StrictMode>{app}</React.StrictMode> : app));
}
const os = async dark => { await act(async () => { media.matches = dark; for (const listener of listeners) listener({ matches: dark }); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); listeners = new Set(); mounts = 0;
    media = { matches: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
    window.matchMedia = () => media;
    disk = { active_theme_id: 'system' };
    catalog = { revision: 1, directory: '/fixture/config/com.explr.app/themes', themes: [mocha, latte], issues: [] };
    invoke.mockImplementation(async (command, args) => {
        if (command === 'get_settings_snapshot') return { settings: structuredClone(disk), loadError: null };
        if (command === 'get_theme_catalog') return structuredClone(catalog);
        if (command === 'set_active_theme_id') { disk.active_theme_id = args.id; return { active_theme_id: args.id }; }
        if (command === 'reset_settings_command') { disk = { active_theme_id: 'system' }; return JSON.stringify(disk); }
        throw new Error(`Unexpected IPC ${command}`);
    });
    bootstrapTheme();
});
afterEach(() => {
    if (root) { act(() => root.unmount()); root = null; }
    container?.remove(); document.body.innerHTML = '';
});

test('theme_selection_system: OS changes follow System; explicit ignores OS', async () => {
    await mount();
    expect(theme.activeThemeId).toBe('system'); expect(theme.resolvedThemeId).toBe(latte.id);
    await os(true); expect(theme.resolvedThemeId).toBe(mocha.id);
    await act(async () => theme.setTheme(latte.id));
    expect(invoke).toHaveBeenCalledWith('set_active_theme_id', { id: latte.id });
    await os(false); await os(true);
    expect(theme.activeThemeId).toBe(latte.id); expect(theme.resolvedThemeId).toBe(latte.id);
    expect(document.documentElement.style.getPropertyValue('--background')).toBe(latte.tokens.background);
});

test.each([
    ['string', latte.id], ['null', null], ['object', { unexpected: true }],
])('theme_settings_root_authority: nested %s theme extra never overrides snapshot/reload prefs', async (_, nestedTheme) => {
    const preferences = { active_theme_id: mocha.id, font_size: 'Large',
        enable_animations_and_transitions: false, terminal_height: 321, default_view: 'details' };
    const extras = { active_theme_id: nestedTheme, font_size: 'Small',
        enable_animations_and_transitions: true, terminal_height: 1, default_view: 'grid' };
    disk = { ...preferences, backend_settings: { search_engine_config: extras } };
    const original = structuredClone(disk);
    await mount(false, false);
    const assertAuthority = () => {
        expect(settings.settings).toMatchObject(preferences);
        expect(settings.settings.backend_settings.search_engine_config).toEqual(extras);
        expect(theme.activeThemeId).toBe(mocha.id);
        expect(theme.resolvedThemeId).toBe(mocha.id);
        expect(container.querySelector('output').textContent).toBe(`${mocha.id}/${mocha.id}`);
        expect(document.documentElement.style.getPropertyValue('--background')).toBe(mocha.tokens.background);
        expect(disk).toEqual(original);
        expect(invoke.mock.calls.every(([command]) => ['get_settings_snapshot', 'get_theme_catalog'].includes(command))).toBe(true);
        expect(showError).not.toHaveBeenCalled();
    };
    assertAuthority();
    await act(async () => theme.setTheme(latte.id));
    expect(disk.active_theme_id).toBe(latte.id);
    expect(disk.backend_settings.search_engine_config).toEqual(extras);
    // An external root preference change must win again on reload, not the preserved extra.
    disk.active_theme_id = mocha.id;
    invoke.mockClear();
    await act(async () => settings.reloadSettings());
    assertAuthority();
});

test('theme_settings_search_projection: supported nested keys project; absent keys retain defaults', async () => {
    const search = { search_engine_enabled: false, case_sensitive_search: true,
        index_hidden_files: true, fuzzy_search_enabled: false, extra: { keep: 17 } };
    disk = { active_theme_id: 'system', search_engine_enabled: true, case_sensitive_search: false,
        index_hidden_files: false, fuzzy_search_enabled: true,
        backend_settings: { search_engine_config: search, default_checksum_hash: 'SHA512' } };
    await mount();
    expect(settings.settings).toMatchObject({ search_engine_enabled: false, case_sensitive_search: true,
        index_hidden_files: true, fuzzy_search_enabled: false, default_checksum_hash: 'SHA512' });
    expect(settings.settings.backend_settings.search_engine_config).toEqual(search);
    expect(settings.settings).not.toHaveProperty('extra');
    disk = { active_theme_id: 'system', backend_settings: { search_engine_config: { case_sensitive_search: true } } };
    await act(async () => settings.reloadSettings());
    expect(settings.settings).toMatchObject({ search_engine_enabled: true, case_sensitive_search: true,
        index_hidden_files: false, fuzzy_search_enabled: true, default_checksum_hash: 'SHA256' });
    disk = { active_theme_id: 'system' };
    await act(async () => settings.reloadSettings());
    expect(settings.settings).toMatchObject({ search_engine_enabled: true, case_sensitive_search: false,
        index_hidden_files: false, fuzzy_search_enabled: true, default_checksum_hash: 'SHA256' });
    expect(invoke.mock.calls.every(([command]) => ['get_settings_snapshot', 'get_theme_catalog'].includes(command))).toBe(true);
});

test('theme_selection_save_failure: optimistic, serialized, resolved rejection, exact rollback', async () => {
    await mount();
    const pending = deferred();
    invoke.mockImplementationOnce(command => { expect(command).toBe('set_active_theme_id'); return pending.promise; });
    let promise;
    await act(async () => { promise = theme.setTheme(mocha.id); });
    expect(theme.activeThemeId).toBe(mocha.id); expect(theme.isSaving).toBe(true);
    expect(document.querySelector('#theme-selection').disabled).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--background')).toBe(mocha.tokens.background);
    const calls = invoke.mock.calls.length;
    await act(async () => theme.setTheme(latte.id));
    expect(invoke.mock.calls.length).toBe(calls);
    await act(async () => { pending.reject({ code: 'save', message: 'Could not save theme selection' }); await promise; });
    expect(theme.activeThemeId).toBe('system'); expect(theme.resolvedThemeId).toBe(latte.id);
    expect(disk.active_theme_id).toBe('system'); expect(theme.isSaving).toBe(false);
    expect(showError).toHaveBeenCalledWith('Could not save theme selection. Keeping "Catppuccin Latte".', 5000);
});

test('theme_selection_unknown: no save; missing startup keeps requested disabled option', async () => {
    disk.active_theme_id = 'deleted-custom';
    await mount();
    expect(theme.activeThemeId).toBe('deleted-custom'); expect(theme.resolvedThemeId).toBe(latte.id);
    expect(document.querySelector('option[value="deleted-custom"]').disabled).toBe(true);
    expect(showError).toHaveBeenCalledWith('Theme "deleted-custom" is unavailable. Keeping "Catppuccin Latte".', 5000);
    const calls = invoke.mock.calls.length;
    await act(async () => theme.setTheme('unknown'));
    expect(invoke.mock.calls.length).toBe(calls);
    expect(theme.activeThemeId).toBe('deleted-custom');
});

test('theme_reset_isolated: real reset syncs System without remount; reload preserves child identity', async () => {
    await mount();
    const input = container.querySelector('input[aria-label="preserved state"]');
    const childMounts = mounts;
    await act(async () => theme.setTheme(mocha.id));
    await act(async () => theme.setTheme(latte.id));
    await act(async () => settings.resetSettings());
    expect(invoke).toHaveBeenCalledWith('reset_settings_command');
    expect(theme.activeThemeId).toBe('system');
    await act(async () => settings.reloadSettings());
    expect(container.querySelector('input[aria-label="preserved state"]')).toBe(input);
    expect(input.value).toBe('tab/file/form/terminal'); expect(mounts).toBe(childMounts);
});

test('theme_reset_failure: preserves settings/root; queued reset cannot race selection response', async () => {
    await mount();
    await act(async () => theme.setTheme(mocha.id));
    invoke.mockRejectedValueOnce('Denied');
    await act(async () => { await expect(settings.resetSettings()).rejects.toBe('Denied'); });
    expect(theme.activeThemeId).toBe(mocha.id); expect(theme.resolvedThemeId).toBe(mocha.id);
    const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    let save, reset;
    await act(async () => { save = theme.setTheme(latte.id); reset = settings.resetSettings(); });
    await act(async () => { pending.resolve({ active_theme_id: latte.id }); await save; await reset; });
    expect(theme.activeThemeId).toBe('system'); expect(disk.active_theme_id).toBe('system');
});

test('theme_settings_malformed: snapshot error stays visible; transport failure never bulk writes', async () => {
    invoke.mockImplementationOnce(async () => ({ settings: {}, loadError }));
    await mount();
    expect(settings.error).toBe(loadError);
    expect(document.body.textContent).toContain(loadError);
    expect(showError).toHaveBeenCalledWith(loadError, 5000);
    expect(invoke.mock.calls.some(([command]) => command.startsWith('update_'))).toBe(false);
    invoke.mockRejectedValueOnce('transport');
    await act(async () => settings.reloadSettings());
    expect(settings.error).toBe(loadError);
    expect(invoke.mock.calls.some(([command]) => command.startsWith('update_'))).toBe(false);
});

test('theme_bootstrap_no_legacy_flash: delayed IPC has OS-matched root/loading colors', async () => {
    media.matches = true; bootstrapTheme();
    const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    await mount();
    expect(container.textContent).toContain('Loading settings...');
    expect(document.documentElement.dataset.theme).toBe(mocha.id);
    expect(container.querySelector('[style]').style.backgroundColor).toBe('var(--background)');
    await act(async () => pending.resolve({ settings: disk, loadError: null }));
    expect(theme.resolvedThemeId).toBe(mocha.id);
});

test('theme_settings_gallery: builtin order/custom codepoint order; no picker; issue dedupe', async () => {
    catalog.themes.push(...[
        { ...latte, id: 'b', name: 'Same' }, { ...latte, id: 'a', name: 'Same' },
        { ...latte, id: 'astral', name: '🪷' }, { ...latte, id: 'bmp', name: '\ue000' },
    ]);
    catalog.issues = [{ code: 'duplicate', id: 'a', file: 'z.theme.json', reason: '' }];
    await mount(true);
    const selector = document.querySelector('#theme-selection');
    expect([...selector.options].map(option => option.value)).toEqual(['system', latte.id, mocha.id, 'a', 'b', 'bmp', 'astral']);
    expect([...selector.options].slice(0, 3).map(option => option.textContent)).toEqual(['System', 'Catppuccin Latte', 'Catppuccin Mocha']);
    expect(document.body.textContent).toContain(catalog.directory);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    expect(document.querySelector('input[name="darkmode"]')).toBeNull();
    expect(showError.mock.calls.filter(([message]) => message.includes('Duplicate theme id'))).toHaveLength(1);
    await flush(); expect(listeners.size).toBe(1);
    act(() => root.unmount()); root = null; expect(listeners.size).toBe(0);
});

test('theme_issue_dedupe: selection does not re-toast unchanged startup issue', async () => {
    catalog.issues = [{ code: 'invalid', file: 'bad.theme.json', id: null, reason: 'invalid JSON' }];
    await mount();
    await act(async () => theme.setTheme(mocha.id));
    expect(showError.mock.calls.filter(([message]) => message.startsWith('Invalid theme file'))).toHaveLength(1);
});

test('theme_settings_strict_mode: stale snapshot never duplicates load-error toast', async () => {
    const implementation = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => command === 'get_settings_snapshot'
        ? Promise.resolve({ settings: {}, loadError }) : implementation(command, args));
    await mount(true);
    expect(showError.mock.calls.filter(([message]) => message === loadError)).toHaveLength(1);
});
