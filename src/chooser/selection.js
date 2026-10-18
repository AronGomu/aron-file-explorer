// Shared chooser policy: every input method goes through the same rules.
export function eligible(items, request) {
    const directories = request.mode !== 'OpenFile' || request.directory;
    return items.filter(item => !item.isParentNavigation && Boolean(item.isDirectory) === Boolean(directories));
}

export function constrainSelection(items, request) {
    // Keep directories focusable for navigation when choosing files.
    const unique = [...new Map(items.filter(item => !item.isParentNavigation).map(item => [item.path, item])).values()];
    return request.mode === 'OpenFile' && request.multiple ? unique : unique.slice(-1);
}

export function selectionPaths(items, request, folder) {
    const paths = eligible(items, request).map(item => item.path);
    return request.directory && !paths.length && folder ? [folder] : paths;
}

export function initialChoices(choices) {
    return Object.fromEntries(choices.map(([id, , options, value]) =>
        [id, value || (options.length ? options[0][0] : 'false')]));
}

export function chooserListing(data, request, path, hidden, query) {
    if (!data) return null;
    const visible = item => (hidden || !item.name.startsWith('.')) &&
        (!query || item.name.toLowerCase().includes(query.toLowerCase()));
    const parentPath = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
    const parent = path !== '/' ? [{ name: '..', path: parentPath, isDirectory: true,
        isParentNavigation: true }] : [];
    return { ...data, directory: path,
        directories: [...parent, ...data.directories.filter(visible)],
        files: request.directory || request.mode === 'SaveFiles' ? [] : data.files.filter(visible) };
}
