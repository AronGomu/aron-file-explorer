// Shared chooser policy: every input method goes through the same rules.
export function eligible(items, request) {
    const directories = request.mode !== 'OpenFile' || request.directory;
    return items.filter(item => Boolean(item.isDirectory) === Boolean(directories));
}

export function constrainSelection(items, request) {
    // Keep directories focusable for navigation when choosing files.
    const unique = [...new Map(items.map(item => [item.path, item])).values()];
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
