import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import FileItem from '../../src/components/explorer/FileItem.jsx';
import DetailsPanel from '../../src/components/explorer/DetailsPanel.jsx';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../src/providers/FileSystemProvider', () => ({ useFileSystem: () => ({ loadDirectory: vi.fn() }) }));
vi.mock('../../src/providers/HistoryProvider', () => ({ useHistory: () => ({ currentPath: '/files' }) }));
vi.mock('../../src/providers/ContextMenuProvider', () => ({ useContextMenu: () => ({
    clipboard: { operation: null, items: [] }, draggedItems: [], beginItemDrag: vi.fn(), endItemDrag: vi.fn(),
}) }));
const sftp = vi.hoisted(() => ({
    isSftpPath: path => path.startsWith('sftp:'),
    parseSftpPath: () => ({ connection: { host: 'host', port: 22, username: 'user' }, remotePath: 'song.mp3' }),
}));
vi.mock('../../src/providers/SftpProvider', () => ({ useSftp: () => sftp }));
vi.mock('../../src/hooks/useFileDropTarget', () => ({ default: () => () => ({}) }));
vi.mock('../../src/components/explorer/FileIcon', () => ({ default: () => <span /> }));
vi.mock('../../src/components/explorer/FileContentPreview', () => ({ default: () => <span>Preview</span> }));
let root, host;
const file = (name = 'notes.txt', revision = 'v1') => ({ name, path: `/files/${name}`, size_in_bytes: 123, last_modified: revision });
const mount = async node => { await act(async () => root.render(node)); };
const hover = async () => { await act(async () => host.querySelector('.file-item').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 40, clientY: 50 }))); };
const leave = async () => { await act(async () => host.querySelector('.file-item').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))); };
const durationCalls = () => invoke.mock.calls.filter(([command]) => command === 'get_media_duration');

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks(); localStorage.clear();
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    invoke.mockResolvedValue(65);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

test('hover shows file details immediately without timers, selection, or focus changes', async () => {
    const onClick = vi.fn();
    await mount(<><input /><FileItem item={file()} onClick={onClick} /></>);
    host.querySelector('input').focus();
    await hover();
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip.textContent).toContain('notes.txt');
    expect(tooltip.textContent).toContain('Size: 123 Bytes');
    expect(tooltip.textContent).toContain('Location: /files');
    expect(host.querySelector('.file-item').hasAttribute('title')).toBe(false);
    expect(host.querySelector('.file-item').getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(onClick).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await leave();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

test.each(['song.mp3', 'movie.mp4'])('hover and preview share the duration lookup for %s', async name => {
    const item = file(name);
    let resolve;
    invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
    await mount(<FileItem item={item} />);
    expect(invoke).not.toHaveBeenCalled();
    await hover();
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Duration: Loading…');
    await mount(<><FileItem item={item} /><DetailsPanel item={item} /></>);
    await act(async () => resolve(65));
    expect(durationCalls()).toHaveLength(1);
    await hover();
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Duration: 1:05');
    expect(host.querySelector('.details-panel-footer').textContent).toContain('Duration 1:05');
    await act(async () => host.querySelector('[aria-label="Show information"]').click());
    expect(host.querySelector('.details-information').textContent).toContain('Duration:1:05');
});

test('moving to another file cannot display a stale duration; revisions get new metadata', async () => {
    let finishFirst;
    invoke.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValue(125);
    await mount(<FileItem item={file('first.mp3')} />); await hover();
    await mount(<FileItem item={file('second.mp3')} />);
    await act(async () => finishFirst(999));
    await hover();
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Duration: 2:05');
    expect(document.querySelector('[role="tooltip"]').textContent).not.toContain('16:39');
    await mount(<FileItem item={file('second.mp3', 'v2')} />);
    await hover();
    expect(durationCalls()).toHaveLength(3);
});

test('unreadable media reports unavailable; hover dismissal does not affect the editor', async () => {
    invoke.mockRejectedValue(new Error('probe failed'));
    await mount(<FileItem item={file('broken.mp3')} />); await hover();
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Duration: Unavailable');
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

test('remote media uses its downloaded preview path for duration', async () => {
    invoke.mockImplementation(async command => command === 'download_and_open_sftp_file' ? '/cache/song.mp3' : 65);
    await mount(<FileItem item={{ ...file('remote.mp3'), path: 'sftp:host/song.mp3' }} />);
    await hover();
    expect(invoke).toHaveBeenCalledWith('get_media_duration', { path: '/cache/song.mp3' });
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Duration: 1:05');
});
