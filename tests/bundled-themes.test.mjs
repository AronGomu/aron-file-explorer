import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { validateThemeDefinition } from '../src/themes/themeContract.js';

const root = new URL('../src-tauri/resources/themes/', import.meta.url);
const definitions = readdirSync(root).filter(name => name.endsWith('.theme.json'))
    .map(name => JSON.parse(readFileSync(new URL(name, root))));
const luminance = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255)
    .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05)
    / (Math.min(luminance(a), luminance(b)) + 0.05);

test('approved catalog contains 26 unique, attributed variants', () => {
    assert.equal(definitions.length, 26);
    assert.equal(new Set(definitions.map(t => t.id)).size, 26);
    const sources = JSON.parse(readFileSync(new URL('sources.json', root)));
    assert.deepEqual(sources.flatMap(s => s.themes).sort(), definitions.map(t => t.id).sort());
    for (const source of sources) {
        assert.match(source.revision, /^[0-9a-f]{40}$/);
        assert.ok(readFileSync(new URL(source.licenseFile, root)).length > 100);
    }
});

const validate = new Ajv().compile(JSON.parse(readFileSync(new URL('theme.schema.json', root))));
for (const theme of definitions) {
    test(`${theme.id}: schema and readable controls`, () => {
        assert.ok(validate(theme), JSON.stringify(validate.errors));
        assert.ok(validateThemeDefinition(theme).ok);
        const t = theme.tokens;
        for (const text of ['textPrimary', 'textSecondary', 'textTertiary']) {
            for (const surface of ['background', 'surface', 'surfaceHover', 'surfaceActive']) {
                assert.ok(contrast(t[text], t[surface]) >= 4.5, `${text}/${surface}`);
            }
        }
        assert.ok(contrast(t.textPrimary, t.accentSurface) >= 4.5);
        for (const accent of ['accent', 'accentHover']) assert.ok(contrast(t.textOnAccent, t[accent]) >= 4.5);
        for (const surface of ['background', 'surfaceHover', 'surfaceActive']) {
            for (const edge of ['borderStrong', 'focusRing']) assert.ok(contrast(t[edge], t[surface]) >= 3, `${edge}/${surface}`);
        }
    });
}
