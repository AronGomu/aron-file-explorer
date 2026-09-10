export const TOKEN_NAMES = Object.freeze([
    'background', 'backgroundSecondary', 'backgroundTertiary', 'surface',
    'surfaceHover', 'surfaceActive', 'border', 'borderStrong', 'textPrimary',
    'textSecondary', 'textTertiary', 'textOnAccent', 'accent', 'accentHover',
    'accentSurface', 'focusRing', 'error', 'errorSurface', 'success',
    'successSurface', 'warning', 'warningSurface', 'info', 'infoSurface',
    'backdrop', 'shadow', 'folder', 'fileImage', 'fileVideo', 'fileAudio',
    'fileCode', 'fileArchive', 'filePdf', 'fileText',
    'previewCheckerboardLight', 'previewCheckerboardDark',
]);

export const TOKEN_TO_CSS = Object.freeze(Object.fromEntries(
    TOKEN_NAMES.map(name => [name, `--${name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`]),
));
const KEYS = ['$schema', 'schemaVersion', 'id', 'name', 'appearance', 'tokens'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));

export function validateThemeDefinition(input) {
    const invalid = reason => ({ ok: false, reason });
    if (!exactKeys(input, KEYS) || input.$schema !== './theme.schema.json') {
        return invalid('expected ThemeDefinition v1');
    }
    if (input.schemaVersion !== 1) return invalid('unsupported schemaVersion');
    if (typeof input.id !== 'string' || input.id.length > 64 || input.id === 'system'
        || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.id)
        || typeof input.name !== 'string' || [...input.name].length > 80 || !/\S/.test(input.name)
        || !['light', 'dark'].includes(input.appearance)) {
        return invalid('invalid theme metadata');
    }
    if (!exactKeys(input.tokens, TOKEN_NAMES)) return invalid('expected all 36 color tokens');
    for (const name of TOKEN_NAMES) {
        if (typeof input.tokens[name] !== 'string'
            || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(input.tokens[name])) {
            return invalid(`invalid color token: ${name}`);
        }
    }
    return { ok: true, theme: input };
}

export function resolveThemeId(selection, prefersDark) {
    return selection === 'system' ? (prefersDark ? 'catppuccin-mocha' : 'catppuccin-latte') : selection;
}
