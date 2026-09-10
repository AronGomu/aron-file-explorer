import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import SettingsProvider from '../../src/providers/SettingsProvider';
import ThemeProvider, { useTheme } from '../../src/providers/ThemeProvider';
import SettingsPanel from '../../src/components/settings/SettingsPanel';
import PreviewModal from '../../src/components/preview/PreviewModal';
import { showConfirm } from '../../src/utils/NotificationSystem';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { applyThemeToDOM, EMBEDDED_THEMES } from '../../src/themes/applyTheme';
import { TOKEN_NAMES, TOKEN_TO_CSS } from '../../src/themes/themeContract';
import { auditSources, auditRepository } from '../../scripts/audit-theme-colors.mjs';

test('theme_integrated_root_contract: both shipped palettes replace all root tokens', () => {
    const root = document.createElement('div');
    root.style.setProperty('--font-size-md', '19px');
    for (const theme of EMBEDDED_THEMES) {
        applyThemeToDOM(theme, root);
        for (const name of TOKEN_NAMES) expect(root.style.getPropertyValue(TOKEN_TO_CSS[name])).toBe(theme.tokens[name]);
        expect(root.dataset.theme).toBe(theme.id);
        expect(root.style.colorScheme).toBe(theme.appearance);
        expect(root.style.getPropertyValue('--font-size-md')).toBe('19px');
    }
});

// Defining invariants: no legacy aliases, source color literals fail closed,
// generated styles obey same token contract as static CSS.
test('theme_no_legacy_colors: root emits no retired compatibility aliases', () => {
    const root = document.createElement('div');
    applyThemeToDOM(EMBEDDED_THEMES[0], root);
    expect(root.style.getPropertyValue('--accent-color')).toBe('');
    expect(root.style.getPropertyValue('--text-color')).toBe('');
    expect(auditRepository()).toEqual([]);
});

test.each([
    'color: #123456', 'background: rgba(1, 2, 3, .5)', 'color: rebeccapurple',
    'background: linear-gradient(var(--surface), red)', 'color: var(--text-primary, white)',
    'box-shadow: 0 0 3px hsl(0 0% 0%)', 'border: 1px solid rgb(12 12 12 / 50%)',
    'scrollbar-color: red blue', 'border-block-color: red', '-webkit-tap-highlight-color: red',
])('theme_no_legacy_colors: CSS rejects %s', declaration => {
    expect(auditSources({ 'src/probe.css': `.probe { ${declaration}; }` })).toContain('Unapproved color literal: src/probe.css:1');
});

test.each([
    'const view = <div style={{ color: "red" }} />;',
    'const view = <svg fill="#123456" />;',
    'node.style.backgroundColor = "#abcdef";',
    'node.style["color"] = "red";',
    'node.style.setProperty("color", "white");',
    'node.style.cssText = `color: rgba(0, 0, 0, .5);`;',
    'const css = `.probe { background: linear-gradient(white, ${ink}); }`;',
    'node.innerHTML = `<div style="color: black">fixture</div>`;',
])('theme_no_legacy_colors: JS/JSX generated styles reject %s', source => {
    expect(auditSources({ 'src/probe.jsx': source }).some(message => message.startsWith('Unapproved color literal: src/probe.jsx:'))).toBe(true);
});

test.each([
    '.theme-light { color: var(--text-primary); }',
    '@media (prefers-color-scheme: dark) { .probe { color: var(--text-primary); } }',
    ':root { --dark-background: var(--background); }',
])('theme_no_legacy_colors: legacy CSS rejects %s', source => {
    expect(auditSources({ 'src/probe.css': source })).toContain('Legacy theme reference: src/probe.css:1');
});

test('theme_no_legacy_colors: unresolved token, legacy setting, precise allowlist', () => {
    expect(auditSources({ 'src/probe.jsx': 'const settings = { darkmode: true };' })).toContain('Legacy theme reference: src/probe.jsx:1');
    expect(auditSources({ 'src/probe.css': '.probe { color: var(--missing-color); }' })).toContain('Unresolved color token: src/probe.css:1');
    const sources = { 'src/probe.css': '.probe { fill: #123456; }' };
    const entry = { path: 'src/probe.css', match: 'fill: #123456', reason: 'asset' };
    expect(auditSources(sources, [entry])).toEqual([]);
    expect(auditSources(sources, [{ ...entry, match: '#123456' }])).toContain('Unapproved color literal: src/probe.css:1');
    expect(auditSources({}, [entry])).toEqual(['Unused color exception: src/probe.css']);
    expect(() => auditSources({}, [{ ...entry, path: 'src/**' }])).toThrow('Invalid theme color allowlist entry');
});

test('theme_no_legacy_colors: noncolor sizes, URLs, hash names, content, terminal stay excluded', () => {
    expect(auditSources({
        'src/probe.css': '.probe { width: 12px; font-family: var(--font-mono, monospace); background: url("icon.svg#fff"), rgba(var(--background-rgb), .5); color: var(--text-primary); }',
        'src/probe.jsx': 'const title = "red"; const hash = "#abcdef"; const label = "Remove darkmode from config"; const url = "/assets/darkmode.svg"; const view = <div id="red" title="darkmode">black</div>;',
        'src/url.css': '.probe { background-image: url("/assets/darkmode.svg"); }',
        'src/components/terminal/Terminal.jsx': 'const theme = { background: "#123456" };',
    })).toEqual([]);
});

let root, host, context, catalog, settings, prefersDark, mediaListeners, eventListeners;
function Draft() { context = useTheme(); return <input aria-label="retained draft" defaultValue="draft" />; }
async function mount() {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<SettingsProvider><ThemeProvider>
        <Draft /><SettingsPanel isOpen onClose={() => {}} />
        <PreviewModal payload={{ kind: 'Text', name: 'reference.txt', text: '<exact> content', bytes: 15 }} />
    </ThemeProvider></SettingsProvider>));
}
async function publish(themes, issues = []) {
    catalog = { ...catalog, revision: catalog.revision + 1, themes, issues };
    await act(async () => { for (const handler of eventListeners) handler({ payload: catalog }); });
}
async function os(dark) {
    prefersDark = dark;
    await act(async () => { for (const handler of mediaListeners) handler({ matches: dark }); });
}
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); vi.useFakeTimers();
    prefersDark = false; mediaListeners = new Set(); eventListeners = new Set();
    window.matchMedia = () => ({ matches: prefersDark, addEventListener: (_, handler) => mediaListeners.add(handler), removeEventListener: (_, handler) => mediaListeners.delete(handler) });
    catalog = { revision: 1, directory: '/fixture/themes', themes: [...EMBEDDED_THEMES], issues: [] };
    settings = { active_theme_id: 'system', unrelated: { retained: true } };
    listen.mockImplementation(async (_, handler) => { eventListeners.add(handler); return () => eventListeners.delete(handler); });
    invoke.mockImplementation(async (command, args) => {
        if (command === 'get_settings_snapshot') return { settings: { ...settings }, loadError: null };
        if (command === 'get_theme_catalog') return catalog;
        if (command === 'set_active_theme_id') { settings.active_theme_id = args.id; return { active_theme_id: args.id }; }
        throw new Error(`Unexpected IPC ${command}`);
    });
});
afterEach(() => {
    if (root) act(() => root.unmount()); root = null; host?.remove();
    document.getElementById('notification-container')?.remove();
    vi.clearAllTimers(); vi.useRealTimers();
});

test('theme_system_os_transition: Settings + preview + open confirm retain identity across light dark light', async () => {
    await mount(); const draft = host.querySelector('input[aria-label="retained draft"]'); draft.value = 'typed state';
    const preview = document.querySelector('.preview-line-content');
    const promise = showConfirm('Preserve open dialog');
    const dialog = document.body.lastElementChild;
    for (const dark of [true, false]) {
        await os(dark);
        expect(document.documentElement.dataset.theme).toBe(dark ? 'catppuccin-mocha' : 'catppuccin-latte');
        expect(settings.active_theme_id).toBe('system');
        expect(document.querySelector('.preview-line-content')).toBe(preview);
        expect(preview.textContent).toBe('<exact> content');
        expect(draft.value).toBe('typed state'); expect(dialog.isConnected).toBe(true);
        expect(dialog.firstElementChild.style.background).toBe('var(--surface)');
    }
    dialog.querySelector('button').click(); await expect(promise).resolves.toBe(false);
    expect(invoke.mock.calls.filter(([command]) => command === 'set_active_theme_id')).toEqual([]);
});

test('theme_custom_plugin_roundtrip: discovery selection edit diagnostics deletion remount preserves requested ID', async () => {
    await mount();
    const custom = { ...EMBEDDED_THEMES[0], id: 'custom-copy', name: 'Custom Copy', tokens: { ...EMBEDDED_THEMES[0].tokens, background: '#abcdef' } };
    await publish([...EMBEDDED_THEMES, custom]);
    const selector = document.querySelector('#theme-selection');
    expect([...selector.options].map(option => option.value)).toContain(custom.id);
    await act(async () => { selector.value = custom.id; selector.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(settings.active_theme_id).toBe(custom.id);
    const draft = host.querySelector('input[aria-label="retained draft"]'); draft.value = 'kept';
    const edited = { ...custom, tokens: { ...custom.tokens, background: '#123456' } };
    await publish([...EMBEDDED_THEMES, edited]);
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#123456');
    expect(host.querySelector('input[aria-label="retained draft"]')).toBe(draft);
    expect(draft.value).toBe('kept');
    await publish([...EMBEDDED_THEMES, edited], [
        { code: 'invalid', file: 'custom.theme.json', id: custom.id, reason: 'invalid JSON' },
        { code: 'duplicate', file: 'duplicate.theme.json', id: custom.id, reason: 'duplicate theme id' },
    ]);
    expect(document.querySelector('#notification-container').textContent).toContain('Invalid theme file "custom.theme.json": invalid JSON. Keeping "Custom Copy".');
    expect(document.querySelector('#notification-container').textContent).toContain('Duplicate theme id "custom-copy" in "duplicate.theme.json". File ignored.');
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#123456');
    await publish([...EMBEDDED_THEMES]);
    expect(selector.selectedOptions[0].disabled).toBe(true);
    expect(context.activeThemeId).toBe(custom.id);
    expect(document.documentElement.style.getPropertyValue('--background')).toBe('#123456');
    act(() => root.unmount()); root = null; host.remove();
    await mount();
    expect(settings.active_theme_id).toBe(custom.id);
    expect(settings.unrelated).toEqual({ retained: true });
    expect(document.documentElement.dataset.theme).toBe('catppuccin-latte');
    expect(document.querySelector('#theme-selection').selectedOptions[0].disabled).toBe(true);
});
