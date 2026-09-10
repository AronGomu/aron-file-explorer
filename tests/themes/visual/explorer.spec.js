import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const evidence = 'artifacts/theme-validation/t4-integration/browser';
const cases = ['explorer-grid', 'explorer-list', 'explorer-details', 'sidebar-tabs', 'breadcrumb', 'context-menu', 'controls', 'this-pc', 'settings'];
mkdirSync(evidence, { recursive: true });

// Actual computed colors, ancestor backgrounds, alpha, group opacity. No token-only AA proxy.
async function pair(locator, kind = 'text') {
    return locator.evaluate((element, kind) => {
        const rgba = value => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
            return [r / 255, g / 255, b / 255, a / 255];
        };
        const over = (a, b) => {
            const alpha = a[3] + b[3] * (1 - a[3]);
            return alpha ? [...a.slice(0, 3).map((v, i) => (v * a[3] + b[i] * b[3] * (1 - a[3])) / alpha), alpha] : [0, 0, 0, 0];
        };
        const paint = (start, node) => {
            let color = start;
            for (; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                color = over(color, rgba(style.backgroundColor));
                color[3] *= Number(style.opacity);
            }
            return over(color, [1, 1, 1, 1]);
        };
        const style = getComputedStyle(element);
        const value = kind === 'border' ? style.borderTopColor : kind === 'focus' ? style.outlineColor : style.color;
        const outside = kind === 'focus' && parseFloat(style.outlineOffset) >= 0;
        const background = paint([0, 0, 0, 0], outside ? element.parentElement : element);
        const foreground = paint(rgba(value), outside ? element.parentElement : element);
        const luminance = color => color.slice(0, 3).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const a = luminance(foreground), b = luminance(background);
        return { selector: element.className, text: element.textContent?.trim(), kind, value, background, foreground, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, opacity: style.opacity };
    }, kind);
}

for (const theme of ['catppuccin-latte', 'catppuccin-mocha']) {
    for (const caseId of cases) {
        test(`theme_shell_screenshots: ${caseId} ${theme}`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await page.goto(`/?case=${caseId}&theme=${theme}`, { waitUntil: 'networkidle' });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            const readings = [];
            async function check(selector, kind = 'text', state = 'normal') {
                const item = page.locator(selector).first();
                await expect(item).toBeVisible();
                await item.evaluate(async element => {
                    const animations = [];
                    for (let node = element; node; node = node.parentElement) animations.push(...node.getAnimations());
                    await Promise.all(animations.filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished));
                });
                const result = { state, ...await pair(item, kind) };
                readings.push(result);
                writeFileSync(`${evidence}/${theme}-${caseId}.json`, JSON.stringify(readings, null, 2));
                if (kind === 'focus') {
                    expect(result.outlineStyle).not.toBe('none');
                    expect(parseFloat(result.outlineWidth)).toBeGreaterThanOrEqual(2);
                }
                expect(result.ratio, `${selector} ${state} ${kind}: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(kind === 'text' ? 4.5 : 3);
            }
            if (caseId === 'settings') {
                await expect(page.getByLabel('Theme', { exact: true })).toHaveValue(theme);
                await check('.settings-tab.active');
                await check('.settings-select');
                await check('.settings-select', 'border');
                await page.getByLabel('Theme', { exact: true }).focus();
                await check('.settings-select', 'focus', 'focus');
                await check('.btn-primary');
            } else if (caseId === 'controls') {
                for (const selector of ['.btn-primary:not(:disabled)', '.btn-secondary', '.btn-ghost', '.btn-danger', '.btn:disabled']) {
                    await check(selector, 'text', selector === '.btn:disabled' ? 'disabled' : 'normal');
                    if (!selector.endsWith('.btn:disabled')) {
                        await page.locator(selector).first().hover();
                        await page.waitForTimeout(180);
                        await check(selector, 'text', 'hover');
                    }
                }
                await page.getByRole('button', { name: 'Secondary', exact: true }).focus();
                await check('.btn-secondary', 'focus', 'focus');
                await check('.btn-secondary', 'border');
                await page.getByRole('button', { name: 'Actions', exact: true }).click();
                await check('.dropdown-item');
                await check('.dropdown-item.disabled', 'text', 'disabled');
                await page.getByRole('button', { name: 'Copy', exact: true }).hover();
                await expect(page.getByRole('tooltip')).toBeVisible();
                await check('.tooltip-content');
                await page.screenshot({ path: `${evidence}/${theme}-controls-hover-tooltip.png`, animations: 'disabled' });
                await page.getByRole('button', { name: 'Create new item' }).click();
                await page.getByRole('button', { name: 'Text File' }).click();
                await expect(page.getByRole('dialog', { name: 'Create New File' })).toBeVisible();
                await check('#item-name');
                await check('#item-name', 'border', 'focus');
                await check('.input-hint');
                await page.getByLabel('File name:').fill('');
                await check('.modal .btn:disabled', 'text', 'disabled');
                await page.getByLabel('File name:').fill('draft-retained.txt');
                await page.screenshot({ path: `${evidence}/${theme}-controls-modal.png`, animations: 'disabled' });
            } else {
                await expect(page.locator('.file-item').first().or(page.locator('.folder-item').first())).toBeVisible();
                await check('.segment-button.current');
                await page.locator('.segment-button').first().hover();
                await page.waitForTimeout(180);
                await check('.segment-button', 'text', 'hover');
                if (caseId === 'this-pc') {
                    await check('.folder-name'); await check('.folder-path'); await check('.storage-info');
                    await check('.folder-item', 'border');
                    await page.locator('.folder-item').first().hover(); await page.waitForTimeout(180);
                    await check('.folder-path', 'text', 'hover');
                } else {
                    await check('.file-name');
                    await page.locator('.file-item').nth(1).hover(); await page.waitForTimeout(180);
                    await check('.file-item:nth-child(2) .file-name', 'text', 'hover');
                    await page.locator('.file-item').nth(1).click();
                    await expect(page.locator('.file-item.selected')).toHaveCount(1);
                    await check('.file-item.selected .file-name', 'text', 'selected');
                    await check('.file-item.focused', 'focus', 'selected-focused');
                    if (caseId === 'explorer-list') await check('.file-item.selected .file-info', 'text', 'selected');
                    if (caseId === 'explorer-details') {
                        for (const column of ['type', 'size', 'modified']) await check(`.file-item.selected .column-${column}`, 'text', 'selected');
                    }
                    if (caseId === 'context-menu') {
                        await page.locator('.file-item.selected').click({ button: 'right' });
                        await check('.context-menu-label');
                        await page.locator('.context-menu-item').first().hover(); await page.waitForTimeout(180);
                        await check('.context-menu-label', 'text', 'hover');
                    }
                    if (caseId === 'sidebar-tabs') {
                        await page.locator('.new-tab-button button').click();
                        await expect(page.locator('.tab')).toHaveCount(2);
                        await check('.tab.active .tab-title'); await check('.sidebar-item-name');
                        await check('.sidebar-item.active .sidebar-item-info', 'text', 'active');
                    }
                    if (caseId === 'breadcrumb') {
                        await page.locator('.segment-button').first().focus();
                        await check('.segment-button', 'focus', 'focus');
                    }
                    const semantics = await page.locator('.file-icon').evaluateAll(elements => elements.slice(0, 8).map(el => {
                        const type = [...el.classList].find(name => /^file-icon-(folder|image|video|audio|code|archive|pdf|text)$/.test(name)).slice(10);
                        const token = type === 'folder' ? '--folder' : `--file-${type}`;
                        const probe = document.createElement('span'); probe.style.color = `var(${token})`; document.body.append(probe);
                        const expected = getComputedStyle(probe).color; probe.remove();
                        return { className: el.className, token, color: getComputedStyle(el).color, expected, filter: getComputedStyle(el).filter };
                    }));
                    for (const icon of semantics) { expect(icon.color).toBe(icon.expected); expect(icon.filter).toBe('none'); }
                    writeFileSync(`${evidence}/${theme}-${caseId}-icons.json`, JSON.stringify(semantics, null, 2));
                }
                const icon = page.locator('.nav-button:not(:disabled) .icon').first();
                expect(await icon.evaluate(el => getComputedStyle(el).maskImage)).not.toBe('none');
                expect(await icon.evaluate(el => getComputedStyle(el).filter)).toBe('none');
            }
            expect(errors).toEqual([]);
            await page.screenshot({ path: `${evidence}/${theme}-${caseId}.png`, animations: 'disabled' });
        });
    }

    test(`theme_selected_metadata_contrast: ${theme}`, async ({ page }) => {
        const readings = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        async function check(selector, state) {
            const item = page.locator(selector);
            await expect(item).toHaveCount(1);
            await expect(item).toBeVisible();
            const reading = { state, ...await pair(item) };
            readings.push(reading);
            writeFileSync(`${evidence}/${theme}-selected-metadata.json`, JSON.stringify(readings, null, 2));
            expect.soft(reading.ratio, `${selector} ${state}: ${JSON.stringify(reading)}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const view of ['list', 'details', 'grid']) {
            await page.goto(`/?case=explorer-${view}&theme=${theme}`, { waitUntil: 'networkidle' });
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            if (view === 'list') await check('.sidebar-item.active .sidebar-item-info', 'active-capacity');
            const file = page.locator('.file-item').filter({ has: page.locator('.file-name', { hasText: '01-image.png' }) });
            await expect(file).toHaveCount(1);
            await file.click();
            await expect(page.locator('.file-item.selected')).toHaveAttribute('data-path', '/fixture/home/Documents/01-image.png');
            await page.waitForTimeout(180);
            if (view === 'list') {
                await check('.file-item.selected .file-info', 'selected-list-info');
                await check('.file-item:not(.selected):nth-child(3) .file-info', 'ordinary-list-info');
            } else if (view === 'details') {
                for (const column of ['type', 'size', 'modified']) await check(`.file-item.selected .column-${column}`, `selected-details-${column}`);
            } else {
                await file.click({ button: 'right' });
                await page.locator('.context-menu-item').filter({ has: page.locator('.context-menu-label', { hasText: /^Cut$/ }) }).click();
                await expect(page.locator('.context-menu')).toHaveCount(0);
                await expect(page.locator('.file-item.selected.cut')).toHaveAttribute('data-path', '/fixture/home/Documents/01-image.png');
                await check('.file-item.selected.cut .file-name', 'selected-cut-grid-filename');
                expect(await page.locator('.file-item.selected.cut .file-icon-container').evaluate(el => getComputedStyle(el).opacity)).toBe('0.7');
            }
            await page.screenshot({ path: `${evidence}/${theme}-selected-metadata-${view}.png`, animations: 'disabled' });
        }
        expect(errors).toEqual([]);
    });

    test(`theme_explorer_state_survives: ${theme}`, async ({ page }) => {
        await page.goto(`/?case=explorer-list&theme=${theme}`, { waitUntil: 'networkidle' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.locator('.new-tab-button button').click();
        const activeTitle = await page.locator('.tab.active .tab-title').textContent();
        await expect(page.locator('.tab.active .tab-title')).toHaveText('Documents');
        await page.locator('.file-item').nth(8).click();
        const selected = await page.locator('.file-item.selected').getAttribute('data-path');
        const scroller = page.locator('.file-list-container');
        await scroller.evaluate(el => { el.scrollTop = 300; });
        const before = await scroller.evaluate(el => el.scrollTop);
        expect(before).toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Fixture Settings' }).click();
        const other = theme === 'catppuccin-latte' ? 'catppuccin-mocha' : 'catppuccin-latte';
        await page.getByLabel('Theme', { exact: true }).selectOption(other);
        await expect(page.locator('html')).toHaveAttribute('data-theme', other);
        await page.getByRole('button', { name: 'Close modal' }).click();
        await expect(page.locator('.tab.active .tab-title')).toHaveText(activeTitle);
        await expect(page.locator('.file-item.selected')).toHaveAttribute('data-path', selected);
        await expect(page.locator('.tab')).toHaveCount(2);
        expect(await scroller.evaluate(el => el.scrollTop)).toBe(before);
        await page.screenshot({ path: `${evidence}/${theme}-state-survives.png`, animations: 'disabled' });
        writeFileSync(`${evidence}/${theme}-state-survives.json`, JSON.stringify({ selected, scrollTop: before, tabs: 2, activeTitle, theme: await page.locator('html').getAttribute('data-theme') }));
        // Regression: click actual container padding → selection clears, not navigation.
        await scroller.click({ position: { x: 2, y: 100 } });
        await expect(page.locator('.file-item.selected')).toHaveCount(0);
        await page.locator('.tab').nth(1).click();
        await page.getByRole('button', { name: 'home', exact: true }).click();
        await expect(page.locator('.tab.active .tab-title')).toHaveText('home');
        // Handler-contract proof only; real pointer drag is separately expected-failing below.
        const transfer = await page.evaluateHandle(() => new DataTransfer());
        await page.locator('.tab.active').dispatchEvent('dragstart', { dataTransfer: transfer });
        await page.locator('.tab').first().dispatchEvent('dragover', { dataTransfer: transfer });
        await page.locator('.tab').first().dispatchEvent('drop', { dataTransfer: transfer });
        await expect(page.locator('.tab-title').first()).toHaveText('home');
        await page.locator('.sidebar-item').filter({ hasText: 'Fixture disk' }).click();
        await expect(page.locator('.segment-button.current')).toHaveText('Documents');
        await expect(page.locator('.sidebar-item.active')).toContainText('Fixture disk');
        await page.screenshot({ path: `${evidence}/${theme}-tab-handler-sidebar-navigation.png`, animations: 'disabled' });
    });

    test(`theme_tab_pointer_drag_baseline: ${theme}`, async ({ page }) => {
        // Same failure reproduced against full git-archived 2a804cf src, same fixture/input.
        // Do not claim pointer-drag success from synthetic DataTransfer dispatch.
        test.fail(true, 'Baseline pointer tab drag does not reorder; colors-only scope preserves behavior');
        await page.goto(`/?case=explorer-list&theme=${theme}`, { waitUntil: 'networkidle' });
        await page.locator('.new-tab-button button').click();
        await page.locator('.tab').nth(1).click();
        await page.getByRole('button', { name: 'home', exact: true }).click();
        await expect(page.locator('.tab.active .tab-title')).toHaveText('home');
        await page.locator('.tab.active').dragTo(page.locator('.tab').first());
        await expect(page.locator('.tab-title').first()).toHaveText('home');
    });
}

for (const theme of ['catppuccin-latte', 'catppuccin-mocha']) {
    test(`theme_icons_legacy_background_layer: ${theme}`, async ({ page }) => {
        await page.goto(`/?case=context-menu&theme=${theme}`, { waitUntil: 'networkidle' });
        // Actual unchanged peripheral styles also load in production MainLayout.
        await page.addStyleTag({ path: 'src/components/templates/templates.css' });
        await page.addStyleTag({ path: 'src/components/search/searchBar.css' });
        await page.locator('.file-item').nth(1).click({ button: 'right' });
        const icon = page.locator('.context-menu-icon.icon-delete');
        await expect(icon).toBeVisible();
        expect(await icon.evaluate(el => getComputedStyle(el).maskImage)).not.toBe('none');
        expect(await icon.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
        expect(await page.locator('.search-icon-btn .icon').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
        await page.screenshot({ path: `${evidence}/${theme}-icons-production-css.png`, animations: 'disabled' });
    });
}
