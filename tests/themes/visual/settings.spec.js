import { expect, test } from '@playwright/test';

for (const [theme, background] of [['catppuccin-latte', '#eff1f5'], ['catppuccin-mocha', '#1e1e2e']]) {
    test(`theme_settings_gallery: ${theme}`, async ({ page }) => {
        await page.goto(`/?case=settings&theme=${theme}`, { waitUntil: 'networkidle' });
        await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
        const selector = page.getByLabel('Theme', { exact: true });
        await expect(selector).toHaveValue(theme);
        await expect(selector.locator('option')).toHaveText(['System', 'Catppuccin Latte', 'Catppuccin Mocha']);
        await expect(page.locator('#theme-directory')).toHaveText('/fixture/config/com.explr.app/themes');
        await expect(page.locator('input[type=color]')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--background'))).toBe(background);
        await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-settings.png`, animations: 'disabled' });
        await selector.selectOption('system');
        await expect(selector).toHaveValue('system');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin-mocha');
        await selector.selectOption('catppuccin-latte');
        await page.emulateMedia({ colorScheme: 'light' });
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'catppuccin-latte');
    });
}
