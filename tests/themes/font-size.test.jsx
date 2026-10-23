import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import SettingsProvider, { useSettings } from '../../src/providers/SettingsProvider';
import SettingsPanel from '../../src/components/settings/SettingsPanel';
import SettingsApplier from '../../src/utils/SettingsApplier';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn() }));
vi.mock('../../src/providers/ThemeProvider', () => ({ useTheme: () => ({ activeThemeId: 'system', themes: [], isLoading: false }) }));
let root, host, disk, context;
function Probe() { context = useSettings(); return <><SettingsApplier /><SettingsPanel isOpen onClose={() => {}} /></>; }
const mount = async () => { await act(async () => root.render(<SettingsProvider><Probe /></SettingsProvider>)); };
const select = () => document.querySelector('select[aria-label="Font size (px)"]');
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); disk = { font_size: 12 };
    document.documentElement.style.removeProperty('--item-font-size');
    invoke.mockImplementation(async (command, args) => {
        if (command === 'get_settings_snapshot') return { settings: structuredClone(disk), loadError: null };
        if (command === 'update_settings_field') { disk[args.key] = args.value; return JSON.stringify(disk); }
        throw new Error(`Unexpected IPC ${command}`);
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.style.removeProperty('--item-font-size'); });

test('font setting selects explicit pixel values and persists a number across remounts', async () => {
    await mount();
    expect(select()).not.toBeNull();
    expect(select().value).toBe('12');
    expect([...select().options].map(option => option.textContent)).toEqual(Array.from({ length: 25 }, (_, i) => `${i + 8} px`));
    await act(async () => { select().value = '13'; select().dispatchEvent(new Event('change', { bubbles: true })); });
    expect(invoke).toHaveBeenCalledWith('update_settings_field', { key: 'font_size', value: 13 });
    expect(context.settings.font_size).toBe(13);
    expect(document.documentElement.style.getPropertyValue('--item-font-size')).toBe('13px');
    await act(async () => root.unmount()); root = createRoot(host); await mount();
    expect(select().value).toBe('13');
    expect(document.documentElement.style.getPropertyValue('--item-font-size')).toBe('13px');
});

test.each([['Small', 10], ['Medium', 12], ['Large', 14]])('legacy %s is read as %i pixels', async (legacy, pixels) => {
    disk = { font_size: legacy, extra: { keep: true } };
    await mount();
    expect(context.settings.font_size).toBe(pixels);
    expect(context.settings.extra).toEqual({ keep: true });
    expect(select().value).toBe(String(pixels));
    expect(document.documentElement.style.getPropertyValue('--item-font-size')).toBe(`${pixels}px`);
    expect(invoke.mock.calls.every(([command]) => command === 'get_settings_snapshot')).toBe(true);
});

test('default is 12px and a failed save retains the applied font size', async () => {
    disk = {}; await mount();
    expect(context.settings.font_size).toBe(12);
    invoke.mockRejectedValueOnce(new Error('Could not save'));
    await act(async () => { select().value = '20'; select().dispatchEvent(new Event('change', { bubbles: true })); });
    expect(select().value).toBe('12');
    expect(document.documentElement.style.getPropertyValue('--item-font-size')).toBe('12px');
    expect(context.error).toContain('Could not save');
});
