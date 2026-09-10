import { TOKEN_NAMES, TOKEN_TO_CSS } from './themeContract';
import latte from '../../src-tauri/resources/themes/catppuccin-latte.theme.json';
import mocha from '../../src-tauri/resources/themes/catppuccin-mocha.theme.json';

export const EMBEDDED_THEMES = Object.freeze([latte, mocha].map(theme => {
    Object.freeze(theme.tokens);
    return Object.freeze(theme);
}));
export const systemTheme = prefersDark => prefersDark ? mocha : latte;

export function applyThemeToDOM(theme, root = document.documentElement) {
    for (const name of TOKEN_NAMES) root.style.setProperty(TOKEN_TO_CSS[name], theme.tokens[name]);
    for (const name of ['background', 'border', 'accent']) {
        const hex = theme.tokens[name];
        root.style.setProperty(`--${name}-rgb`, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', '));
    }
    root.dataset.theme = theme.id;
    root.dataset.appearance = theme.appearance;
    root.style.colorScheme = theme.appearance;
}

export function bootstrapTheme() {
    const theme = systemTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyThemeToDOM(theme);
    return theme;
}
