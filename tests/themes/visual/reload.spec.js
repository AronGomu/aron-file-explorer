import { expect, test } from '@playwright/test';
import latte from '../../../src-tauri/resources/themes/catppuccin-latte.theme.json' with { type: 'json' };
import mocha from '../../../src-tauri/resources/themes/catppuccin-mocha.theme.json' with { type: 'json' };

for (const selected of [latte, mocha]) {
    test(`theme_reload_gallery: ${selected.id} event updates root without remount`, async ({ page }) => {
        const failures = [];
        page.on('pageerror', error => failures.push(error.message));
        await page.goto(`/?case=reload&theme=${selected.id}`, { waitUntil: 'networkidle' });
        const selector = page.getByLabel('Theme', { exact: true });
        await expect(selector).toHaveValue(selected.id);
        await page.evaluate(() => { window.retainedSelector = document.querySelector('#theme-selection'); });
        const edit = { ...selected, tokens: { ...selected.tokens, background: '#203040' } };
        const themes = [latte, mocha].map(theme => theme.id === edit.id ? edit : theme);
        const publish = async (revision, definitions, issues = []) => page.evaluate(catalog => window.themeReload(catalog), {
            revision, directory: '/fixture/config/com.explr.app/themes', themes: definitions, issues,
        });
        await publish(2, themes);
        await expect.poll(() => page.locator('html').evaluate(root => root.style.getPropertyValue('--background'))).toBe('#203040');
        expect(await page.evaluate(() => window.retainedSelector === document.querySelector('#theme-selection'))).toBe(true);
        await publish(3, themes, [{ code: 'invalid', file: 'active.theme.json', id: null, reason: 'invalid JSON', fingerprint: 'a'.repeat(64) }]);
        await expect(page.getByText(`Invalid theme file "active.theme.json": invalid JSON. Keeping "${selected.name}".`)).toBeVisible();
        await page.screenshot({ path: `artifacts/theme-validation/visual/${selected.id}-reload-invalid.png` });
        await publish(4, [...themes, { ...latte, id: 'copy', name: 'Copy' }]);
        await expect(selector.locator('option[value="copy"]')).toHaveText('Copy');
        await publish(5, themes.filter(theme => theme.id !== selected.id));
        await expect(selector.locator(`option[value="${selected.id}"]`)).toBeDisabled();
        await expect(selector).toHaveValue(selected.id);
        expect(await page.locator('html').evaluate(root => root.style.getPropertyValue('--background'))).toBe('#203040');
        await publish(6, themes);
        await expect(selector.locator(`option[value="${selected.id}"]`)).toBeEnabled();
        await page.screenshot({ path: `artifacts/theme-validation/visual/${selected.id}-reload-recovered.png` });
        expect(failures).toEqual([]);
    });
}
