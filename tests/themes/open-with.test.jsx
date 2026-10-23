import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import ContextMenuProvider, { useContextMenu } from '../../src/providers/ContextMenuProvider';
import ContextMenu from '../../src/components/contextMenu/ContextMenu';
import { showError } from '../../src/utils/NotificationSystem';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn(async () => ''), writeText: vi.fn() }));
vi.mock('../../src/providers/FileSystemProvider', () => ({ useFileSystem: () => filesystem }));
vi.mock('../../src/providers/HistoryProvider', () => ({ useHistory: () => ({ currentPath: '/files' }) }));
vi.mock('../../src/providers/SftpProvider', () => ({ useSftp: () => sftp }));
vi.mock('../../src/utils/NotificationSystem', () => ({ showError: vi.fn(), showSuccess: vi.fn(), showNotification: vi.fn(), showConfirm: vi.fn() }));
const { filesystem, sftp } = vi.hoisted(() => ({
    filesystem: { selectedItems: [], loadDirectory: vi.fn(), clearSelection: vi.fn(), removeDeletedItems: vi.fn(),
        setFocusedItem: vi.fn(), selectMultiple: vi.fn(), openFile: vi.fn(), currentDirData: {} },
    sftp: { isSftpPath: path => path.startsWith('sftp://'), parseSftpPath: vi.fn(), downloadAndOpenSftpFile: vi.fn() },
}));
const apps = [{ id: 'editor.desktop', name: 'Text Editor', isDefault: true }, { id: 'other.desktop', name: 'Other Editor', isDefault: false }];
let root, host, menu;
function Probe() {
    menu = useContextMenu();
    return menu.isOpen && <ContextMenu position={menu.position} items={menu.items} onClose={menu.closeContextMenu} />;
}
const file = name => ({ name, path: `/files/${name}`, size_in_bytes: 24 });
const open = async item => { await act(async () => menu.openContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 }, item)); };
const openItem = () => menu.items.find(item => item.id === 'open');
async function mount(basicOnly = false) {
    await act(async () => root.render(<ContextMenuProvider basicOnly={basicOnly}><Probe /></ContextMenuProvider>));
}
beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); localStorage.clear(); filesystem.selectedItems = [];
    invoke.mockImplementation(async command => {
        if (command === 'get_open_with_applications') return apps;
        if (command === 'open_file_with_application') return;
        throw new Error(`Unexpected IPC ${command}`);
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test.each(['notes.txt', 'movie.mp4', 'photo.png', 'document.pdf', 'archive.zip', 'unknown.xyz'])('Open lists matching programs for %s', async name => {
    await mount(); await open(file(name));
    expect(invoke).toHaveBeenCalledWith('get_open_with_applications', { path: `/files/${name}` });
    expect(openItem().submenu.map(item => item.label)).toEqual(['Text Editor (default)', 'Other Editor']);
});

test.each([false, true])('choosing a program launches it once without a default launch or chooser acceptance (basicOnly=%s)', async basicOnly => {
    await mount(basicOnly); await open(file('quote # name.txt'));
    await act(async () => host.querySelector('.context-menu-item').click());
    await act(async () => host.querySelectorAll('.context-submenu .context-menu-item')[1].click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(invoke.mock.calls.filter(([command]) => command !== 'get_open_with_applications')).toEqual([
        ['open_file_with_application', { path: '/files/quote # name.txt', applicationId: 'other.desktop' }],
    ]);
    expect(filesystem.openFile).not.toHaveBeenCalled();
    expect(menu.isOpen).toBe(false);
});

test('remote files are matched by name, downloaded only after choosing a program and opened locally', async () => {
    sftp.downloadAndOpenSftpFile.mockResolvedValue('/tmp/download-notes.txt');
    await mount();
    await open({ name: 'notes.txt', path: 'sftp://host/notes.txt' });
    expect(invoke).toHaveBeenCalledWith('get_open_with_applications', { path: 'notes.txt' });
    expect(sftp.downloadAndOpenSftpFile).not.toHaveBeenCalled();
    await act(async () => openItem().submenu[0].action());
    expect(sftp.downloadAndOpenSftpFile).toHaveBeenCalledWith('sftp://host/notes.txt', false);
    expect(invoke).toHaveBeenCalledWith('open_file_with_application', { path: '/tmp/download-notes.txt', applicationId: 'editor.desktop' });
});

test('empty and failed application lookups provide disabled explanations', async () => {
    invoke.mockResolvedValueOnce([]);
    await mount(); await open(file('unknown.xyz'));
    expect(openItem().submenu[0]).toMatchObject({ label: 'No compatible applications installed.', disabled: true });
    invoke.mockRejectedValueOnce(new Error('lookup failed'));
    await open(file('other.xyz'));
    expect(openItem().submenu[0]).toMatchObject({ label: 'Could not load applications.', disabled: true });
});

test('stale lookups cannot replace the current file’s programs', async () => {
    let finish;
    invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await open(file('first.txt'));
    expect(openItem().submenu[0]).toMatchObject({ label: 'Loading applications…', disabled: true });
    await open(file('second.txt'));
    await act(async () => finish([{ id: 'stale.desktop', name: 'Stale app' }]));
    expect(openItem().submenu.map(item => item.label)).toEqual(['Text Editor (default)', 'Other Editor']);
});

test('launch errors are reported and folders retain direct navigation', async () => {
    await mount(); await open(file('notes.txt'));
    invoke.mockRejectedValueOnce(new Error('launch failed'));
    await act(async () => openItem().submenu[0].action());
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('launch failed'));
    invoke.mockClear();
    await open({ name: 'Folder', path: '/files/Folder', isDirectory: true });
    expect(openItem().submenu).toBeUndefined();
    await act(async () => openItem().action());
    expect(filesystem.loadDirectory).toHaveBeenCalledWith('/files/Folder');
    expect(invoke).not.toHaveBeenCalled();
});

test('a disabled Open item cannot expose executable program choices on hover', async () => {
    const first = file('first.txt');
    filesystem.selectedItems = [first, file('second.txt')];
    await mount(); await open(first);
    expect(openItem().disabled).toBe(true);
    await act(async () => host.querySelector('.context-menu-item').dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
    ));
    expect(host.querySelector('.context-submenu')).toBeNull();
});
