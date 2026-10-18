import { topLevelItems } from './fileDeletion.js';

export const FILE_DRAG_TYPE = 'application/x-explr-selection';

export function dragSelection(item, selectedItems) {
    return topLevelItems(selectedItems.some(selected => selected.path === item.path) ? selectedItems : [item]);
}

function pathInfo(path, parseSftpPath) {
    if (typeof path !== 'string' || !path) return null;
    let scope = 'local';
    if (path.startsWith('sftp:')) {
        const parsed = parseSftpPath?.(path);
        if (!parsed?.connection) return null;
        scope = `sftp:${parsed.connection.name}`;
        path = parsed.remotePath || '.';
    }
    const windows = scope === 'local' && (/^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\'));
    if (windows) path = path.replace(/\\/g, '/').toLowerCase();
    const prefix = path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
    const parts = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
        else if (part === '..' && !prefix) parts.push(part);
        else if (part !== '..') parts.push(part);
    }
    return { scope, path: prefix + parts.join('/') || '.' };
}

export function canMoveSelection(items, destination, parseSftpPath) {
    const target = pathInfo(destination, parseSftpPath);
    if (!target || !items.length) return false;
    let changesFolder = false;
    for (const item of items) {
        const source = pathInfo(item.path, parseSftpPath);
        if (!source || source.scope !== target.scope || source.path === target.path) return false;
        if ((item.isDirectory || 'sub_file_count' in item) &&
            target.path.startsWith(source.path.replace(/\/$/, '') + '/')) return false;
        const slash = source.path.lastIndexOf('/');
        const parent = slash < 0 ? '.' : source.path.slice(0, slash) || '/';
        if (parent !== target.path) changesFolder = true;
    }
    return changesFolder;
}
