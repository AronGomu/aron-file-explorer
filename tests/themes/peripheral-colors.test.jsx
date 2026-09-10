import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyThemeToDOM, EMBEDDED_THEMES } from '../../src/themes/applyTheme';
import PreviewModal from '../../src/components/preview/PreviewModal.jsx';
import App from '../../src/App.jsx';
import SettingsProvider from '../../src/providers/SettingsProvider.jsx';
import ThemeProvider from '../../src/providers/ThemeProvider.jsx';
import { invoke } from '@tauri-apps/api/core';
import * as notices from '../../src/utils/NotificationSystem.js';
import { peripheralIPC, preparePeripheral } from './gallery/peripheralIPC.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: path => `asset:${path}` }));
let root, host;
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount()); host.remove();
    document.getElementById('notification-container')?.replaceChildren();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.clearAllTimers(); vi.useRealTimers();
});

for (const theme of EMBEDDED_THEMES) {
    test(`theme_toasts_all_types: ${theme.id} roles, tokens, copy, 5000ms + dismissal`, () => {
        applyThemeToDOM(theme);
        for (const type of ['info', 'success', 'warning', 'error']) {
            const toast = notices.showNotification(`<${type}> exact copy`, type, 5000);
            expect(toast.textContent).toBe(`<${type}> exact copy`);
            expect(toast.getAttribute('role')).toBe(type === 'error' ? 'alert' : 'status');
            expect(toast.style.background).toBe(`var(--${type}-surface)`);
            expect(toast.style.color).toBe('var(--text-primary)');
            expect(toast.style.border).toBe('1px solid var(--border-strong)');
            expect(toast.parentNode.hasAttribute('aria-live')).toBe(false);
            vi.advanceTimersByTime(4999); expect(toast.isConnected).toBe(true);
            vi.advanceTimersByTime(1); expect(toast.style.animation).toBe('fadeOut 0.3s ease-out');
            vi.advanceTimersByTime(299); expect(toast.isConnected).toBe(true);
            vi.advanceTimersByTime(1); expect(toast.isConnected).toBe(false);
        }
        const sticky = notices.showError('click to dismiss', 0);
        vi.advanceTimersByTime(9000); expect(sticky.isConnected).toBe(true);
        sticky.click(); vi.advanceTimersByTime(300); expect(sticky.isConnected).toBe(false);
        const defaultToast = notices.showInfo('default');
        vi.advanceTimersByTime(2999); expect(defaultToast.style.animation).toBe('slideIn 0.3s ease-out');
        vi.advanceTimersByTime(1); expect(defaultToast.style.animation).toBe('fadeOut 0.3s ease-out');
        const unknown = notices.showNotification('fallback', 'unknown', 0);
        expect(unknown.style.background).toBe('var(--info-surface)');
        expect(unknown.getAttribute('role')).toBe('status');
    });
    test(`theme_confirm: ${theme.id} tokens, confirm/cancel/backdrop/Escape Promise results`, async () => {
        applyThemeToDOM(theme);
        for (const action of ['Confirm', 'Cancel', 'backdrop', 'Escape']) {
            const result = notices.showConfirm('Keep exact <message>?');
            const overlay = document.body.lastElementChild;
            const dialog = overlay.firstElementChild;
            expect(overlay.style.background).toBe('var(--backdrop)');
            expect(dialog.style.background).toBe('var(--surface)');
            expect(dialog.querySelector('p').textContent).toBe('Keep exact <message>?');
            expect(dialog.querySelector('p').style.color).toBe('var(--text-secondary)');
            if (action === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: action }));
            else if (action === 'backdrop') overlay.click();
            else [...dialog.querySelectorAll('button')].find(button => button.textContent === action).click();
            await expect(result).resolves.toBe(action === 'Confirm');
            expect(overlay.isConnected).toBe(false);
        }
    });
    test(`theme_preview_pixels: ${theme.id} payload bytes/paths unchanged`, () => {
        applyThemeToDOM(theme);
        const image = 'data:image/png;base64,iVBORw0KGgo=';
        act(() => root.render(<PreviewModal payload={{ kind: 'Image', name: 'reference.png', data_uri: image, bytes: 8 }} />));
        expect(host.querySelector('img').getAttribute('src')).toBe(image);
        act(() => root.render(<PreviewModal payload={{ kind: 'Pdf', name: 'reference.pdf', data_uri: 'data:application/pdf;base64,JVBERi0=', bytes: 5 }} />));
        expect(host.querySelector('iframe').getAttribute('src')).toBe('data:application/pdf;base64,JVBERi0=');
        act(() => root.render(<PreviewModal payload={{ kind: 'Video', name: 'reference.webm', path: '/fixture/reference.webm' }} />));
        expect(host.querySelector('video').getAttribute('src')).toBe('asset:/fixture/reference.webm');
        expect(host.querySelector('video').controls).toBe(true);
        const text = '<script>not HTML</script>\n  exact whitespace Ω';
        act(() => root.render(<PreviewModal payload={{ kind: 'Text', name: 'reference.txt', text }} />));
        expect([...host.querySelectorAll('.preview-line-content')].map(node => node.textContent).join('\n')).toBe(text);
        expect(host.querySelector('script')).toBeNull();
    });
    test(`theme_loading_fallback: ${theme.id} real provider delays + App render error`, async () => {
        applyThemeToDOM(theme);
        invoke.mockImplementation(() => new Promise(() => {}));
        await act(async () => root.render(<SettingsProvider>not yet</SettingsProvider>));
        expect(host.textContent).toContain('Loading settings...');
        expect(host.firstElementChild.style.backgroundColor).toBe('var(--background)');
        invoke.mockImplementation(async command => {
            if (command === 'get_settings_snapshot') return { settings: { active_theme_id: theme.id }, loadError: null };
            if (command === 'get_theme_catalog') return new Promise(() => {});
            throw new Error(`Unexpected IPC ${command}`);
        });
        await act(async () => root.render(<SettingsProvider key="theme"><ThemeProvider>not yet</ThemeProvider></SettingsProvider>));
        expect(host.textContent).toContain('Loading theme...');
        expect(host.querySelector('.theme-loading').style.color).toBe('var(--text-secondary)');
        const failure = new Error('T5 expected render injection');
        // Real App boundary catches real provider render failure, outside ThemeProvider subtree.
        const caught = vi.spyOn(console, 'error').mockImplementation(() => {});
        window.matchMedia = () => { throw failure; };
        await act(async () => root.render(<App />));
        expect(host.textContent).toContain('The application could not be loaded properly.');
        expect(host.querySelector('button').style.color).toBe('var(--text-on-accent)');
        expect(caught.mock.calls.some(call => call.includes(failure))).toBe(true);
        expect(caught.mock.calls.length).toBeLessThanOrEqual(3);
    });
}

test('theme_peripheral_fixture_IPC: deny unknown commands/hosts/credentials', () => {
    preparePeripheral('network');
    expect(() => peripheralIPC('network', 'unknown', {}, EMBEDDED_THEMES)).toThrow('Unknown theme gallery IPC command: unknown');
    expect(() => peripheralIPC('network', 'load_dir', { host: 'outside.invalid', username: 'fixture', password: '' }, EMBEDDED_THEMES)).toThrow('Fixture SFTP only; no credentials permitted');
    expect(() => peripheralIPC('network', 'load_dir', { host: 'fixture.invalid', username: 'fixture', password: 'synthetic-denied' }, EMBEDDED_THEMES)).toThrow('Fixture SFTP only; no credentials permitted');
    expect(JSON.parse(peripheralIPC('network', 'load_dir', { host: 'fixture.invalid', username: 'fixture', password: '' }, EMBEDDED_THEMES))).toEqual({ files: ['./reference.txt'], directories: [] });
});

test('theme_template_file_types: owned icon tints use semantic file tokens', () => {
    const css = readFileSync('src/components/templates/templates.css', 'utf8');
    for (const [kind, token] of Object.entries({ folder: 'folder', file: 'file-text', image: 'file-image', video: 'file-video', audio: 'file-audio', code: 'file-code', archive: 'file-archive', pdf: 'file-pdf' })) {
        expect(css).toContain(`.template-icon .icon-${kind} { color: var(--${token}); }`);
    }
});

test('theme_peripheral_owned_sources: no literal/fallback/legacy color consumers or content filters', () => {
    const paths = ['src/utils/NotificationSystem.js', 'src/components/sidebar/AddSftpConnectionView.jsx', 'src/components/common/PermissionHelper.jsx',
        ...['search', 'network', 'templates', 'preview'].flatMap(dir => readdirSync(`src/components/${dir}`).filter(name => /\.(css|jsx)$/.test(name)).map(name => `src/components/${dir}/${name}`))];
    const violations = [];
    for (const path of paths) {
        const source = readFileSync(path, 'utf8');
        for (const [index, line] of source.split('\n').entries()) {
            if (/#[\da-f]{3,8}\b|%23[\da-f]{3,8}\b|rgba?\(\s*\d|(?:color|background):\s*['"]?(?:white|black)\b|var\(--(?:danger|info-bg|info-border|warning-bg|warning-border|warning-text|success-hover|border-subtle)(?:[,)]|\b)/i.test(line)) violations.push(`${path}:${index + 1}: ${line.trim()}`);
        }
        if (path.includes('/preview/')) expect(source).not.toMatch(/(?:^|[;{\s])filter\s*:\s*(?:invert|brightness|contrast|hue-rotate|sepia)/m);
    }
    expect(violations).toEqual([]);
});
