import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { expect, test } from 'vitest';
import { TOKEN_NAMES, TOKEN_TO_CSS, validateThemeDefinition, resolveThemeId } from '../../src/themes/themeContract';
import { applyThemeToDOM, bootstrapTheme } from '../../src/themes/applyTheme';
import schema from '../../src-tauri/resources/themes/theme.schema.json';
import latte from '../../src-tauri/resources/themes/catppuccin-latte.theme.json';
import mocha from '../../src-tauri/resources/themes/catppuccin-mocha.theme.json';
import corpus from './fixtures/theme-definitions/cases.json';

const ajv = new Ajv().compile(schema);
for (const fixture of corpus) {
    test(`theme_schema_parity: ${fixture.name}`, () => {
        let input;
        try { input = JSON.parse(fixture.json); }
        catch { expect(fixture.reason).toBe('invalid JSON'); return; }
        if (fixture.decoderBoundary) {
            // Approved decoder-domain divergences: unpaired surrogates / overflowing numbers.
            // Rust is the authoritative file decoder; exact reason parity starts after decoding.
            expect(ajv(input)).toBe(fixture.ajvAccepted);
            expect(validateThemeDefinition(input).reason ?? null).toBe(fixture.jsReason);
            expect(fixture.reason).toBe('invalid JSON');
            if (fixture.decoderBoundary === 'unicode-scalar') {
                expect([...input.name]).toHaveLength(1);
                expect(input.name.charCodeAt(0)).toBeGreaterThanOrEqual(0xd800);
                expect(input.name.charCodeAt(0)).toBeLessThanOrEqual(0xdfff);
            } else {
                expect(fixture.decoderBoundary).toBe('number-range');
                expect(input.schemaVersion).toBe(Infinity);
                expect(validateThemeDefinition(input).ok).toBe(false);
            }
            return;
        }
        expect(ajv(input), JSON.stringify(ajv.errors)).toBe(fixture.reason === null);
        const result = validateThemeDefinition(input);
        expect(result.ok).toBe(fixture.reason === null);
        expect(result.reason ?? null).toBe(fixture.reason);
    });
}

test('theme_dom_preserves_geometry', () => {
    const root = document.documentElement;
    root.style.setProperty('--font-size-md', '19px');
    root.style.setProperty('--space-lg', '17px');
    root.style.setProperty('--terminal-height', '321px');
    root.classList.add('reduce-motion', 'font-size-large');
    for (const theme of [mocha, latte]) {
        applyThemeToDOM(theme);
        expect(TOKEN_NAMES).toHaveLength(36);
        for (const name of TOKEN_NAMES) expect(root.style.getPropertyValue(TOKEN_TO_CSS[name])).toBe(theme.tokens[name]);
        expect(root.dataset.theme).toBe(theme.id);
        expect(root.dataset.appearance).toBe(theme.appearance);
        expect(root.style.colorScheme).toBe(theme.appearance);
        expect(root.style.getPropertyValue('--font-size-md')).toBe('19px');
        expect(root.style.getPropertyValue('--space-lg')).toBe('17px');
        expect(root.style.getPropertyValue('--terminal-height')).toBe('321px');
        expect(root.classList.contains('reduce-motion')).toBe(true);
        expect(document.body.style.getPropertyValue('--background')).toBe('');
    }
    expect(root.style.getPropertyValue('--accent-rgb')).toBe('136, 57, 239');
});

test('theme_bootstrap_no_legacy_flash: root initialized before render', () => {
    for (const dark of [false, true]) {
        window.matchMedia = () => ({ matches: dark });
        bootstrapTheme();
        expect(document.documentElement.dataset.theme).toBe(dark ? mocha.id : latte.id);
    }
    const source = readFileSync('src/main.jsx', 'utf8');
    expect(source.indexOf('bootstrapTheme();')).toBeLessThan(source.indexOf('ReactDOM.createRoot'));
    expect(resolveThemeId('system', false)).toBe(latte.id);
    expect(resolveThemeId('system', true)).toBe(mocha.id);
    expect(resolveThemeId('custom', true)).toBe('custom');
});

const luminance = hex => {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
for (const theme of [latte, mocha]) {
    test(`theme_shipped_AA_pairs: ${theme.id}`, () => {
        const t = theme.tokens;
        for (const text of ['textPrimary', 'textSecondary', 'textTertiary']) {
            for (const surface of ['background', 'surface', 'surfaceHover', 'surfaceActive']) {
                expect(contrast(t[text], t[surface]), `${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
            }
        }
        expect(contrast(t.textPrimary, t.accentSurface)).toBeGreaterThanOrEqual(4.5);
        for (const accent of ['accent', 'accentHover']) expect(contrast(t.textOnAccent, t[accent])).toBeGreaterThanOrEqual(4.5);
        for (const surface of ['background', 'surfaceHover', 'surfaceActive']) {
            expect(contrast(t.borderStrong, t[surface])).toBeGreaterThanOrEqual(3);
            expect(contrast(t.focusRing, t[surface])).toBeGreaterThanOrEqual(3);
        }
    });
}
