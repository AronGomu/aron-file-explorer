import { getFileName } from './pathUtils.js';

// Use the copied-files text format so Explorer and chooser processes can exchange items.
export function encodeFileClipboard(items, operation) {
    if (items.some(item => !item.path.startsWith('/'))) return items.map(item => item.path).join('\n');
    return [operation, ...items.map(item => 'file://' + item.path.split('/').map(encodeURIComponent).join('/'))].join('\n');
}

export function decodeFileClipboard(text) {
    const [operation, ...uris] = (text || '').split('\n');
    if (!['copy', 'cut'].includes(operation) || !uris.length) return null;
    try {
        const items = uris.map(uri => {
            const url = new URL(uri);
            if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash) throw new Error('Not a local file');
            const path = decodeURIComponent(url.pathname);
            if (path === '/' || path.includes('\0')) throw new Error('Not a file item');
            return { path, name: getFileName(path) };
        });
        return { items, operation };
    } catch { return null; }
}
