import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

// Chromium fixture evidence only. Native disk/watch/restart use isolated packaged scripts.
test.use({ channel: 'chromium' });
const directory = 'artifacts/theme-validation/visual/integration';
const cases = ['settings', 'explorer-grid', 'explorer-list', 'explorer-details', 'sidebar-tabs', 'breadcrumb', 'context-menu', 'controls', 'this-pc', 'search', 'network', 'sftp-form', 'templates', 'preview-image', 'preview-video', 'preview-text', 'preview-error', 'dialogs', 'permissions', 'toasts', 'confirm', 'loading', 'error-fallback'];
const themes = ['catppuccin-latte', 'catppuccin-mocha'];

async function readings(page) {
    return page.evaluate(() => {
        const rgba = value => {
            const parts = value.match(/[\d.]+/g)?.map(Number);
            if (!parts || parts.length < 3) throw new Error(`Unresolved computed color: ${value}`);
            return [parts[0], parts[1], parts[2], parts[3] ?? 1];
        };
        const over = (a, b) => {
            const alpha = a[3] + b[3] * (1 - a[3]);
            return [...a.slice(0, 3).map((v, i) => alpha ? (v * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0), alpha];
        };
        const paint = (foreground, element) => {
            let color = foreground;
            for (let node = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                color = over(color, rgba(style.backgroundColor));
                color[3] *= Number(style.opacity);
            }
            if (color[3] < .999) throw new Error('Unresolved composited background');
            return color;
        };
        const lum = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const pair = (color, node) => {
            const fg = paint(rgba(color), node), bg = paint([0, 0, 0, 0], node);
            const a = lum(fg), b = lum(bg);
            return { fg, bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        };
        const visible = node => {
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.visibility === 'visible' && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        };
        const output = [];
        for (const node of document.body.querySelectorAll('*')) {
            if (!visible(node) || node.closest('svg, video, iframe, option, script, style')) continue;
            const text = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent.trim()).filter(Boolean).join(' ') || (node.matches('input, textarea, select') ? node.value || node.placeholder : '');
            if (!text) continue;
            const style = getComputedStyle(node);
            const disabled = node.closest(':disabled, [aria-disabled="true"], .disabled');
            const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.667 && Number(style.fontWeight) >= 700);
            output.push({ element: node.tagName.toLowerCase(), selector: node.id ? `#${node.id}` : String(node.className), text: text.slice(0, 100), minimum: large ? 3 : 4.5, exception: disabled ? 'WCAG inactive control; text/shape retained' : null, ...pair(style.color, node) });
        }
        const focused = document.activeElement;
        if (focused && focused !== document.body && visible(focused)) {
            const style = getComputedStyle(focused);
            if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) output.push({ element: focused.tagName.toLowerCase(), selector: String(focused.className), text: 'focus outline', minimum: 3, exception: null, ...pair(style.outlineColor, parseFloat(style.outlineOffset) >= 0 ? focused.parentElement : focused) });
        }
        return output;
    });
}

test('theme_full_surface_matrix / theme_aa_composited: 23 cases × 2 palettes', async ({ page }) => {
    test.setTimeout(240_000);
    mkdirSync(directory, { recursive: true });
    // Each fixture starts clean; peripheral history must not leak into explorer cases.
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
    const manifestPath = 'artifacts/theme-validation/visual/manifest.json';
    const manifest = themes.flatMap(themeId => cases.map(caseId => ({ caseId, themeId, screenshot: `${directory}/${themeId}-${caseId}.png`, states: [], contrastArtifact: `${directory}/${themeId}-${caseId}-contrast.json`, status: 'not-run' })));
    const persist = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    persist();
    const failures = [];
    for (const entry of manifest) {
        const errors = [], samples = [];
        const onError = error => errors.push(error.message);
        const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
        page.on('pageerror', onError); page.on('console', onConsole);
        try {
            await page.emulateMedia({ colorScheme: entry.themeId === 'catppuccin-mocha' ? 'dark' : 'light' });
            await page.goto(`/?case=${entry.caseId}&theme=${entry.themeId}`, { waitUntil: 'networkidle' });
            await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
            await expect(page.locator('main')).toHaveAttribute('data-theme-case', entry.caseId);
            await expect(page.locator('html')).toHaveAttribute('data-theme', entry.themeId);
            if (entry.caseId === 'preview-image') await expect(page.locator('.preview-image')).toHaveJSProperty('naturalWidth', 128);
            if (entry.caseId === 'preview-video') await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
            if (entry.caseId === 'search') {
                await page.locator('.search-input-field').fill('reference');
                await page.getByRole('button', { name: 'Search (Enter)', exact: true }).click();
                await expect(page.locator('.result-name-container').first()).toBeVisible();
            }
            if (entry.caseId === 'context-menu') await page.locator('.file-item').first().click({ button: 'right' });
            await page.screenshot({ path: entry.screenshot, fullPage: true });
            samples.push({ state: 'default', pairs: await readings(page) });
            const control = page.locator('button:visible:enabled, input:visible:enabled, select:visible:enabled').first();
            if (await control.count()) {
                for (const state of ['hover', 'focus']) {
                    if (state === 'hover') await control.hover(); else await control.focus();
                    const screenshot = `${directory}/${entry.themeId}-${entry.caseId}-${state}.png`;
                    await page.screenshot({ path: screenshot, fullPage: true });
                    entry.states.push({ name: state, screenshot });
                    samples.push({ state, pairs: await readings(page) });
                }
            }
            if (entry.caseId === 'error-fallback') {
                expect(errors.length).toBeGreaterThan(0);
                for (const error of errors) expect(error).toContain('T5 expected render injection');
            } else expect(errors).toEqual([]);
            for (const sample of samples) {
                expect(sample.pairs.length, `${entry.caseId} ${sample.state} visible text coverage`).toBeGreaterThan(0);
                for (const pair of sample.pairs) if (!pair.exception) expect(pair.ratio, `${entry.themeId}/${entry.caseId}/${sample.state}: ${pair.selector} ${pair.text}`).toBeGreaterThanOrEqual(pair.minimum);
            }
            entry.status = 'pass';
        } catch (error) {
            entry.status = 'fail'; failures.push(`${entry.themeId}/${entry.caseId}: ${error.message}`);
            if (!existsSync(entry.screenshot)) await page.screenshot({ path: entry.screenshot, fullPage: true });
        } finally {
            page.off('pageerror', onError); page.off('console', onConsole);
            writeFileSync(entry.contrastArtifact, JSON.stringify({ samples, errors, boundary: 'Chromium fixture only; user media/native controls excluded; disabled text exceptions explicit. Focus readings only where rendered outline exists; no missing-focus success claim. Full control/focus checks remain owning explorer/peripheral specs.' }, null, 2));
            persist();
        }
    }
    expect(manifest).toHaveLength(46);
    expect(new Set(manifest.map(entry => `${entry.caseId}/${entry.themeId}`)).size).toBe(46);
    for (const entry of manifest) for (const path of [entry.screenshot, entry.contrastArtifact, ...entry.states.map(state => state.screenshot)]) expect(existsSync(path), path).toBe(true);
    expect(failures).toEqual([]);
});
