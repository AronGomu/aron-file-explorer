import React, { act } from 'react';
import { createHash } from 'node:crypto';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ThemeProvider, { useTheme } from '../../src/providers/ThemeProvider';
import SettingsProvider from '../../src/providers/SettingsProvider';
import { showError } from '../../src/utils/NotificationSystem';
import latte from '../../src-tauri/resources/themes/catppuccin-latte.theme.json';
import mocha from '../../src-tauri/resources/themes/catppuccin-mocha.theme.json';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn() }));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let root, container, theme, handlers, snapshot, disk, calls;
function Probe() { theme = useTheme(); return <input aria-label="draft" defaultValue="retained draft" />; }
async function mount(strict = false) {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    const app = <SettingsProvider><ThemeProvider><Probe /></ThemeProvider></SettingsProvider>;
    await act(async () => root.render(strict ? <React.StrictMode>{app}</React.StrictMode> : app));
}
const publish = async catalog => { await act(async () => { for (const handler of handlers) handler({ payload: catalog }); }); };
const changed = (revision, themes = [latte, mocha], issues = []) => ({ ...snapshot, revision, themes, issues });
const color = () => document.documentElement.style.getPropertyValue('--background');
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); handlers = new Set(); calls = [];
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    disk = { active_theme_id: 'system' };
    snapshot = { revision: 1, directory: '/fixture/themes', themes: [latte, mocha], issues: [] };
    listen.mockImplementation(async (name, handler) => { calls.push(name); handlers.add(handler); return () => handlers.delete(handler); });
    invoke.mockImplementation(async (command, args) => {
        calls.push(command);
        if (command === 'get_settings_snapshot') return { settings: { ...disk }, loadError: null };
        if (command === 'get_theme_catalog') return snapshot;
        if (command === 'set_active_theme_id') { disk.active_theme_id = args.id; return { active_theme_id: args.id }; }
        throw new Error(`Unexpected IPC ${command}`);
    });
});
afterEach(() => { if (root) act(() => root.unmount()); root = null; container?.remove(); });

test('theme_event_order: listen before snapshot; newer event beats late snapshot', async () => {
    const pending = deferred(); const impl = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => command === 'get_theme_catalog' ? pending.promise : impl(command, args));
    await mount();
    expect(listen).toHaveBeenCalledWith('themes-changed', expect.any(Function));
    const edit = { ...latte, tokens: { ...latte.tokens, background: '#abcdef' } };
    await publish(changed(3, [edit, mocha]));
    await act(async () => pending.resolve(snapshot));
    expect(color()).toBe('#abcdef');
    await publish(changed(2)); expect(color()).toBe('#abcdef');
    await publish(changed(3, [mocha])); expect(color()).toBe('#abcdef');
    expect(theme.themes).toEqual([edit, mocha]); expect(showError).not.toHaveBeenCalled();
});

test('theme_listener_cleanup: late promise after StrictMode cleanup cannot leak or snapshot', async () => {
    const pending = deferred(); let stale;
    listen.mockImplementationOnce((_, handler) => { stale = handler; return pending.promise; });
    await mount(true);
    const unlisten = vi.fn(); await act(async () => pending.resolve(unlisten));
    expect(unlisten).toHaveBeenCalledTimes(1); expect(handlers.size).toBe(1);
    await act(async () => stale({ payload: changed(100, [mocha]) }));
    expect(theme.themes).toHaveLength(2);
    act(() => root.unmount()); root = null; expect(handlers.size).toBe(0);
});

test('theme_watch_invalid_then_valid: byte state dedupe, unrelated revision, correction clears', async () => {
    await mount();
    const issue = { code: 'invalid', file: 'bad.theme.json', id: null, reason: 'invalid JSON', fingerprint: 'a'.repeat(64) };
    await publish(changed(2, undefined, [issue])); expect(showError).toHaveBeenCalledTimes(1);
    await publish(changed(3, [...snapshot.themes, { ...latte, id: 'copy' }], [issue])); expect(showError).toHaveBeenCalledTimes(1);
    await publish(changed(4, undefined, [{ ...issue, fingerprint: 'b'.repeat(64) }])); expect(showError).toHaveBeenCalledTimes(2);
    expect(color()).toBe(latte.tokens.background);
    await publish(changed(5));
    await publish(changed(6, undefined, [issue])); expect(showError).toHaveBeenCalledTimes(3);
});

test.each([
    ['fingerprint', 'success', false], ['fingerprint', 'save', false],
    ['absent', 'success', false], ['absent', 'save', false],
    ['fingerprint', 'success', true], ['absent', 'success', true],
])('theme_pending_correction: %s / %s / batched=%s re-arms identical issue', async (fingerprint, outcome, batched) => {
    await mount();
    const issue = { code: 'invalid', file: 'bad.theme.json', id: null, reason: 'invalid JSON',
        ...(fingerprint === 'fingerprint' ? { fingerprint: createHash('sha256').update('{bad one').digest('hex') } : {}) };
    const invalidNotices = () => showError.mock.calls.filter(([message]) => message.startsWith('Invalid theme file'));
    await publish(changed(2, undefined, [issue])); expect(invalidNotices()).toHaveLength(1);
    const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    let save; await act(async () => { save = theme.setTheme(mocha.id); });
    expect(theme.isSaving).toBe(true);
    await publish(changed(3, [...snapshot.themes, { ...latte, id: 'copy' }], [issue]));
    expect(invalidNotices()).toHaveLength(1);
    if (batched) {
        await act(async () => {
            for (const handler of handlers) {
                handler({ payload: changed(4) });
                handler({ payload: changed(5, undefined, [issue]) });
            }
        });
    } else {
        await publish(changed(4));
        await publish(changed(5, undefined, [issue]));
    }
    expect(invalidNotices()).toHaveLength(1); // Display remains deferred during selection.
    await act(async () => {
        if (outcome === 'success') pending.resolve({ active_theme_id: mocha.id });
        else pending.reject({ code: 'save' });
        await save;
    });
    expect(invalidNotices()).toHaveLength(2);
    expect(theme.isSaving).toBe(false);
    expect(theme.activeThemeId).toBe(outcome === 'success' ? mocha.id : 'system');
    expect(color()).toBe(outcome === 'success' ? mocha.tokens.background : latte.tokens.background);
    expect(showError).toHaveBeenCalledTimes(outcome === 'success' ? 2 : 3);
    await publish(changed(6, [...snapshot.themes, { ...latte, id: 'copy' }], [issue]));
    expect(invalidNotices()).toHaveLength(2);
});

test('theme_post_reload_os: System follows OS; explicit selection ignores OS', async () => {
    let onChange;
    window.matchMedia = () => ({ matches: false, addEventListener: (_, handler) => { onChange = handler; }, removeEventListener() {} });
    await mount();
    const light = { ...latte, tokens: { ...latte.tokens, background: '#abcdef' } };
    const dark = { ...mocha, tokens: { ...mocha.tokens, background: '#123456' } };
    await publish(changed(2, [light, dark])); expect(color()).toBe('#abcdef');
    await act(async () => onChange({ matches: true })); expect(color()).toBe('#123456');
    expect(theme.activeThemeId).toBe('system');
    await act(async () => theme.setTheme(latte.id)); expect(color()).toBe('#abcdef');
    await act(async () => onChange({ matches: false }));
    await act(async () => onChange({ matches: true }));
    expect(color()).toBe('#abcdef'); expect(theme.activeThemeId).toBe(latte.id);
});

test('theme_watch_delete_active: root and child identity survive; inactive copy never applies', async () => {
    await mount(); const input = container.querySelector('input'); input.value = 'typed draft';
    await act(async () => theme.setTheme(latte.id));
    await publish(changed(2, [latte, mocha, { ...mocha, id: 'copy' }])); expect(color()).toBe(latte.tokens.background);
    await publish(changed(3, [mocha]));
    expect(theme.activeThemeId).toBe(latte.id); expect(theme.resolvedThemeId).toBe(latte.id);
    expect(container.querySelector('input')).toBe(input); expect(input.value).toBe('typed draft');
});

test.each(['save', 'unavailable', 'success'])('theme_switch_reload_race: pending deletion %s reconciles newest catalog', async outcome => {
    await mount(); const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    let save; await act(async () => { save = theme.setTheme(mocha.id); });
    const edit = { ...latte, tokens: { ...latte.tokens, background: '#abcdef' } };
    await publish(changed(2, [edit])); expect(theme.activeThemeId).toBe(mocha.id);
    await act(async () => {
        if (outcome === 'success') pending.resolve({ active_theme_id: mocha.id });
        else pending.reject({ code: outcome });
        await save;
    });
    expect(theme.activeThemeId).toBe(outcome === 'success' ? mocha.id : 'system');
    expect(color()).toBe(outcome === 'success' ? mocha.tokens.background : '#abcdef');
    expect(theme.themes).toEqual([edit]); expect(theme.isSaving).toBe(false);
});

test('theme_listener_failure: snapshot still loads; watch diagnostic visible', async () => {
    listen.mockRejectedValueOnce(new Error('listener rejected')); await mount();
    expect(theme.isLoading).toBe(false); expect(theme.themes).toHaveLength(2);
    expect(showError).toHaveBeenCalledWith('Theme hot reload is unavailable. Keeping "Catppuccin Latte".', 5000);
});

test('theme_switch_reload_race: edited pending target wins over captured definition', async () => {
    await mount(); const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    let save; await act(async () => { save = theme.setTheme(mocha.id); });
    const edit = { ...mocha, tokens: { ...mocha.tokens, background: '#123456' } };
    await publish(changed(2, [latte, edit])); expect(color()).toBe('#123456');
    await act(async () => { pending.resolve({ active_theme_id: mocha.id }); await save; });
    expect(theme.activeThemeId).toBe(mocha.id); expect(color()).toBe('#123456');
});

test('theme_listener_cleanup: rejected late unlisten is handled, no stale selection DOM restore', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    listen.mockImplementationOnce(async (_, handler) => { handlers.add(handler); return async () => { handlers.delete(handler); throw new Error('cleanup rejected'); }; });
    await mount(); const pending = deferred(); invoke.mockImplementationOnce(() => pending.promise);
    let save; await act(async () => { save = theme.setTheme(mocha.id); });
    await act(async () => root.unmount()); root = null;
    document.documentElement.style.setProperty('--background', '#123456');
    await act(async () => { pending.reject({ code: 'save' }); await save; });
    expect(color()).toBe('#123456'); expect(handlers.size).toBe(0);
    expect(errors).toHaveBeenCalledWith('Could not remove theme listener', expect.any(Error));
});

test('theme_event_order: registration must resolve before requesting initial snapshot', async () => {
    const registered = deferred(); listen.mockReturnValueOnce(registered.promise);
    await mount(); expect(calls).not.toContain('get_theme_catalog');
    await act(async () => registered.resolve(() => {}));
    expect(calls).toContain('get_theme_catalog'); expect(theme.isLoading).toBe(false);
});

test('theme_watch_duplicate: owner rename takeover changes colors atomically, not selection', async () => {
    await mount(); await act(async () => theme.setTheme(latte.id));
    const accepted = { ...latte, name: 'Takeover', tokens: { ...latte.tokens, background: '#abcdef' } };
    await publish(changed(2, [accepted, mocha], [{ code: 'duplicate', file: 'z.theme.json', id: latte.id, reason: 'Duplicate theme id' }]));
    expect(theme.activeThemeId).toBe(latte.id); expect(disk.active_theme_id).toBe(latte.id);
    expect(color()).toBe('#abcdef');
    expect(showError).toHaveBeenCalledWith('Duplicate theme id "catppuccin-latte" in "z.theme.json". File ignored.', 5000);
});
