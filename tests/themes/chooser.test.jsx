import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import ChooserApp from '../../src/chooser/ChooserApp.jsx';
import { EMBEDDED_THEMES } from '../../src/themes/applyTheme';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: path => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true) }));
const { nativeWindow } = vi.hoisted(() => ({ nativeWindow: {
    isMaximized: vi.fn(async () => false), onResized: vi.fn(async () => () => {}),
    minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}),
} }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }));
vi.mock('../../src/components/explorer/FileContentPreview', () => ({ default: () => <div>Preview</div> }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn(), showSuccess: vi.fn(), showConfirm: vi.fn() }));
let root, container;
const request = { mode: 'OpenFile', currentFolder: '/home/test', title: 'Caller title', appId: '',
    multiple: true, directory: false, currentName: '', filters: [], currentFilter: null, choices: [], files: [] };
const directory = { name: 'folder', path: '/home/test/folder', isDirectory: true };
const file = { name: 'alpha.txt', path: '/home/test/alpha.txt', isDirectory: false, size_in_bytes: 12 };
const click = async element => { await act(async () => element.click()); };
const key = async (target, value, options = {}) => { await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }))); };
const button = label => document.querySelector(`button[aria-label="${label}"]`);
const pane = () => container.querySelector('.file-list-container');

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear(); sessionStorage.clear();
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    window.requestAnimationFrame = callback => setTimeout(callback, 0);
    window.cancelAnimationFrame = clearTimeout;
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    invoke.mockImplementation(async (command, args) => {
        if (command === 'get_settings_snapshot') return { settings: { active_theme_id: 'system' }, loadError: null };
        if (command === 'get_theme_catalog') return { revision: 1, themes: EMBEDDED_THEMES, issues: [], directory: '/chooser/themes' };
        if (command === 'set_active_theme_id') return { active_theme_id: args.id };
        if (command === 'get_system_volumes_information') return [{ volume_name: 'System (/)', mount_point: '/', is_mounted: true, size: 1024, available_space: 512 }, { volume_name: 'Data', device: '/dev/sda1', mount_point: '', is_mounted: false, size: 2048, drive_size: 2048 }];
        if (command === 'chooser_list') return { directories: [directory, { name: '.secret', path: '/home/test/.secret', isDirectory: true }], files: [file] };
        if (command === 'chooser_check') return { overwrite: [] };
        if (command === 'chooser_finish') return;
        throw new Error(`Unexpected IPC ${command}`);
    });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function mount(overrides = {}) {
    await act(async () => root.render(<ChooserApp request={{ ...request, ...overrides }} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}

test('chooser has one breadcrumb row, two view icons, pane toggles and no tabs or removed toolbar actions', async () => {
    await mount();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector('.chooser-heading, .chooser-tools, .chooser-tabs')).toBeNull();
    for (const label of ['Parent folder', 'Refresh', 'Copy current path', 'New tab']) expect(button(label)).toBeNull();
    expect(container.textContent).not.toContain('Caller title');
    expect(button('Icons view')).not.toBeNull(); expect(button('List view')).not.toBeNull();
    expect(container.textContent).toContain('System (/)'); expect(container.textContent).toContain('Data');
    expect(container.textContent).toContain('Not mounted');
    await click(button('Collapse sidebar')); expect(button('Expand sidebar')).not.toBeNull();
    await click(button('Collapse preview panel')); expect(button('Expand preview panel')).not.toBeNull();
    await click(button('Icons view')); expect(pane().classList.contains('view-mode-grid')).toBe(true);
});

test('first entry receives focus, arrows work after a chrome button, and parent stays first after reverse sort', async () => {
    await mount();
    expect(document.activeElement).toBe(pane());
    expect(container.querySelector('.file-item.focused').textContent).toContain('..');
    button('List view').focus();
    await key(button('List view'), 'ArrowDown');
    expect(document.activeElement).toBe(pane());
    expect(container.querySelector('.file-item.focused').textContent).toContain('folder');
    await click(container.querySelector('.file-column-sort'));
    expect(container.querySelector('.file-item').textContent).toContain('..');
});

test('parent Enter and breadcrumb clicks navigate; root omits parent and typing is not intercepted', async () => {
    await mount();
    await key(pane(), 'Enter');
    expect(invoke).toHaveBeenCalledWith('chooser_list', { path: '/home', filter: null });
    expect(button('System root').querySelector('svg')).not.toBeNull();
    await click(button('System root'));
    expect(invoke).toHaveBeenCalledWith('chooser_list', { path: '/', filter: null });
    expect(container.querySelector('.file-item').textContent).not.toContain('..');
    await key(pane(), 'l', { ctrlKey: true });
    const input = container.querySelector('[aria-label="Path input"]');
    expect(input.value).toBe('/');
    expect(document.activeElement).toBe(input);
    const focus = container.querySelector('.file-item.focused');
    await key(input, 'ArrowDown'); expect(container.querySelector('.file-item.focused')).toBe(focus);
    await key(input, 'Escape');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(pane());
    expect(invoke.mock.calls.some(([command]) => command === 'chooser_finish')).toBe(false);
});

test('settings own hidden files and theme; Escape closes only settings and restores item focus', async () => {
    await mount();
    expect(container.textContent).not.toContain('.secret');
    await click(button('File chooser settings'));
    const modal = document.querySelector('[role="dialog"]');
    expect(modal.textContent).toContain('Show hidden files and folders');
    await click(modal.querySelector('input[type="checkbox"]'));
    expect(container.textContent).toContain('.secret');
    const theme = modal.querySelector('select');
    await act(async () => { theme.value = EMBEDDED_THEMES[0].id; theme.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(invoke).toHaveBeenCalledWith('set_active_theme_id', { id: EMBEDDED_THEMES[0].id });
    await key(modal, 'Escape');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(pane());
    expect(invoke.mock.calls.some(([command]) => command === 'chooser_finish')).toBe(false);
    expect(JSON.parse(localStorage.getItem('chooserShowHidden'))).toBe(true);
});

test('unmounted drives use the explorer mount command before navigating', async () => {
    const existing = invoke.getMockImplementation();
    invoke.mockImplementation((command, args) => command === 'mount_volume'
        ? Promise.resolve('/run/media/test/Data') : existing(command, args));
    await mount();
    await click([...container.querySelectorAll('.sidebar-item')].find(element => element.textContent.startsWith('Data')));
    expect(invoke).toHaveBeenCalledWith('mount_volume', { device: '/dev/sda1' });
    expect(invoke).toHaveBeenCalledWith('chooser_list', { path: '/run/media/test/Data', filter: null });
});

test('pointer interactions with pane toggles return keyboard focus to the list', async () => {
    await mount();
    const toggle = button('Collapse sidebar');
    await act(async () => {
        toggle.focus();
        toggle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        toggle.click();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(pane());
});

test('integrated window close returns chooser cancellation to the calling app', async () => {
    await mount();
    expect(container.querySelector('.chooser-navigation[data-tauri-drag-region]')).not.toBeNull();
    expect(container.querySelector('.toolbar-drag-region[data-tauri-drag-region]')).not.toBeNull();
    await click(button('Minimize window'));
    expect(nativeWindow.minimize).toHaveBeenCalledOnce();
    await click(button('Close window'));
    expect(invoke).toHaveBeenCalledWith('chooser_finish', { selection: null, overwriteConfirmed: false });
    expect(nativeWindow.close).not.toHaveBeenCalled();
});
