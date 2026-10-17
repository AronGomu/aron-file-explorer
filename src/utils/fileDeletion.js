// A selected directory already contains its descendants (for example in search results).
export function topLevelItems(items) {
    return items.filter((item, index) => items.findIndex(other => other.path === item.path) === index &&
        !items.some(other => other.path !== item.path && (other.isDirectory || 'sub_file_count' in other) &&
            item.path.startsWith(other.path.replace(/[\\/]+$/, '') + (other.path.includes('\\') ? '\\' : '/'))));
}

export async function deleteSelection(items, { invoke, confirm, isSftpPath, deleteSftpItem, reportError }) {
    if (!items.length) return [];
    if (items.length > 1 && !await confirm(`Move ${items.length} selected items to the trash?`, 'Move to Trash')) return [];
    items = topLevelItems(items);
    const removed = [];
    const local = items.filter(item => !isSftpPath(item.path));
    if (local.length) {
        const result = await invoke('trash_items', { paths: local.map(item => item.path) });
        removed.push(...result.trashed);
        for (const warning of result.undoErrors) reportError(warning);
        for (const [path] of result.failed) {
            const name = local.find(item => item.path === path)?.name || path;
            if (await confirm(`“${name}” could not be moved to the OS trash. It may be too large or trash may be unavailable.\n\nPermanently delete this item? It cannot be recovered, and Ctrl+Z cannot undo this action.`, 'Permanently Delete?')) {
                try {
                    await invoke('permanently_delete', { path });
                    removed.push(path);
                } catch (error) { reportError(`Failed to delete “${path}”: ${error.message || error}`); }
            }
        }
    }
    for (const item of items.filter(item => isSftpPath(item.path))) {
        if (!await confirm(`“${item.name}” is on an SFTP server and cannot be moved to the OS trash. Permanently delete it? It cannot be recovered, and Ctrl+Z cannot undo this action.`, 'Permanently Delete?')) continue;
        try {
            if (!await deleteSftpItem(item.path)) throw new Error('Server deletion failed');
            removed.push(item.path);
        } catch (error) { reportError(`Failed to delete “${item.name}”: ${error.message || error}`); }
    }
    return removed;
}
