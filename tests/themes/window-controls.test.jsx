import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WindowControls from '../../src/components/common/WindowControls';

const { nativeWindow, unlisten } = vi.hoisted(() => ({
    nativeWindow: { isMaximized: vi.fn(), onResized: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn() }));
let root, host, maximized;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); maximized = false;
    nativeWindow.isMaximized.mockImplementation(async () => maximized);
    nativeWindow.onResized.mockResolvedValue(unlisten);
    nativeWindow.minimize.mockResolvedValue(); nativeWindow.close.mockResolvedValue();
    nativeWindow.toggleMaximize.mockImplementation(async () => { maximized = !maximized; });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const click = async label => { await act(async () => host.querySelector(`[aria-label="${label}"]`).click()); };

test('explorer controls invoke native minimize, maximize/restore and close', async () => {
    await act(async () => root.render(<WindowControls />));
    await click('Minimize window'); expect(nativeWindow.minimize).toHaveBeenCalledOnce();
    await click('Maximize window'); expect(nativeWindow.toggleMaximize).toHaveBeenCalledOnce();
    expect(host.querySelector('[aria-label="Restore window"]')).not.toBeNull();
    await click('Restore window'); expect(nativeWindow.toggleMaximize).toHaveBeenCalledTimes(2);
    await click('Close window'); expect(nativeWindow.close).toHaveBeenCalledOnce();
});

test('controls follow external maximize changes and release their resize listener', async () => {
    await act(async () => root.render(<WindowControls />));
    maximized = true;
    await act(async () => nativeWindow.onResized.mock.calls[0][0]());
    expect(host.querySelector('[aria-label="Restore window"]')).not.toBeNull();
    await act(async () => root.render(null)); expect(unlisten).toHaveBeenCalledOnce();
});

test('both native windows hide their title bar and grant the toolbar window actions', () => {
    for (const file of ['tauri.conf.json', 'tauri.chooser.conf.json']) {
        const config = JSON.parse(readFileSync(`src-tauri/${file}`, 'utf8'));
        expect(config.app.windows.find(window => window.label === 'main').decorations).toBe(false);
    }
    const { permissions } = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
    for (const action of ['minimize', 'toggle-maximize', 'close', 'start-dragging']) {
        expect(permissions).toContain(`core:window:allow-${action}`);
    }
});
