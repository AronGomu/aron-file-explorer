import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test.use({ channel: 'chromium' });

const themes = ['catppuccin-latte', 'catppuccin-mocha'];
const cases = ['search', 'network', 'sftp-form', 'dialogs', 'permissions', 'toasts', 'confirm', 'loading', 'error-fallback'];
// Only T5-owned declarations; shared Modal/Button/input/Icon colors are T4's gate.
const ownedText = {
    search: '.search-input-field, .result-name-container, .result-path-container, .suggestion-item span',
    network: '.network-view-title, .network-view-subtitle, .connection-name, .connection-address, .connect-button, .add-connection-button, .empty-connections p',
    permissions: '.permission-content h3, .permission-content p, .instructions h4, .instructions h5, .instructions li',
    toasts: '#notification-container > div', confirm: 'body > div:last-child h3, body > div:last-child p, body > div:last-child button',
    loading: 'main div[style] > div:last-of-type', 'error-fallback': 'main h1, main p, main button',
};

async function visit(page, caseId, theme, suffix = '') {
    await page.emulateMedia({ colorScheme: theme === 'catppuccin-mocha' ? 'dark' : 'light' });
    const errors = [];
    page.removeAllListeners('pageerror'); page.removeAllListeners('console');
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`/?case=${caseId}&theme=${theme}${suffix}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await expect(page.locator('main')).toHaveAttribute('data-theme-case', caseId);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    return errors;
}

async function contrast(page, selector, name, property = 'color', minimum = 4.5) {
    const pairs = await page.locator(selector).evaluateAll((nodes, property) => {
        const parse = value => {
            const v = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
            return [v[0], v[1], v[2], v[3] ?? 1];
        };
        const over = (a, b) => {
            const alpha = a[3] + b[3] * (1 - a[3]);
            return [...a.slice(0, 3).map((c, i) => alpha ? (c * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0), alpha];
        };
        const lum = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
        return nodes.filter(node => node.getBoundingClientRect().width && node.getBoundingClientRect().height && (node.textContent.trim() || node.value || node.title)).map(node => {
            const style = getComputedStyle(node);
            let bg = property === 'outlineColor' ? [0, 0, 0, 0] : parse(style.backgroundColor);
            let fg = over(parse(style[property]), bg);
            let current = node;
            while (current) {
                const opacity = Number(getComputedStyle(current).opacity);
                bg[3] *= opacity; fg[3] *= opacity;
                current = current.parentElement;
                if (current) {
                    const parent = parse(getComputedStyle(current).backgroundColor);
                    bg = over(bg, parent); fg = over(fg, parent);
                }
            }
            if (bg[3] !== 1) throw new Error('Unresolved composited background');
            const a = lum(fg), b = lum(bg);
            return { text: (node.textContent.trim() || node.value || node.title).slice(0, 100), fg, bg, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
        });
    }, property);
    writeFileSync(`artifacts/theme-validation/visual/${name}-contrast.json`, JSON.stringify(pairs, null, 2));
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) expect(pair.ratio, `${name}: ${pair.text}`).toBeGreaterThanOrEqual(minimum);
}

for (const theme of themes) {
    for (const caseId of cases) {
        test(`theme_peripheral_screenshots ${theme} ${caseId}`, async ({ page }) => {
            const errors = await visit(page, caseId, theme);
            if (caseId === 'search') {
                await page.locator('.search-input-field').fill('reference');
                await page.getByRole('button', { name: 'Search (Enter)', exact: true }).click();
                await expect(page.locator('.result-name-container').first()).toContainText('reference');
            }
            if (caseId === 'error-fallback') {
                await expect(page.getByText('The application could not be loaded properly. Try refreshing the page.')).toBeVisible();
                expect(errors.length).toBeGreaterThan(0); expect(errors.length).toBeLessThanOrEqual(3);
                for (const error of errors) expect(error).toContain('T5 expected render injection');
            } else expect(errors).toEqual([]);
            if (ownedText[caseId]) await contrast(page, ownedText[caseId], `${theme}-${caseId}`);
            await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-${caseId}.png`, fullPage: true });
        });
    }
    test(`theme_search_network ${theme} populated empty loading error`, async ({ page }) => {
        for (const state of ['empty', 'loading', 'error']) {
            const errors = await visit(page, 'search', theme, `&state=${state}`);
            if (state === 'loading') await expect(page.getByText('Indexing Files...', { exact: true }).first()).toBeVisible();
            else {
                await page.locator('.search-input-field').fill('reference');
                await page.getByRole('button', { name: 'Search (Enter)', exact: true }).click();
                await expect(page.getByText('No results found', { exact: false }).first()).toBeVisible();
            }
            if (state === 'error') {
                expect(errors.length).toBeGreaterThan(0); expect(errors.length).toBeLessThanOrEqual(2);
                for (const error of errors) expect(error).toContain('T5 injected fixture failure');
            } else expect(errors).toEqual([]);
            await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-search-${state}.png` });
        }
        await visit(page, 'network', theme, '&state=empty');
        await expect(page.getByText('No SFTP connections', { exact: true })).toBeVisible();
        await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-network-empty.png` });
        const errors = await visit(page, 'network', theme, '&state=error');
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('Failed to connect to Synthetic server');
        expect(errors).toHaveLength(1); expect(errors[0]).toContain('T5 injected fixture failure');
    });
    test(`theme_dialogs_permissions ${theme} SFTP status callbacks hash rename`, async ({ page }) => {
        for (const state of ['normal', 'loading', 'error']) {
            const errors = await visit(page, 'sftp-form', theme, `&state=${state}`);
            await page.locator('#sftp-host').fill('fixture.invalid');
            await page.locator('#sftp-username').fill('fixture');
            await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
            if (state === 'loading') await expect(page.getByRole('button', { name: 'Testing...' })).toBeDisabled();
            else {
                const role = state === 'error' ? 'alert' : 'status';
                await expect(page.getByRole(role)).toContainText(state === 'error' ? 'T5 injected fixture failure' : 'Connection successful!');
                await contrast(page, `[role=${role}]`, `${theme}-sftp-${state}`);
            }
            expect(errors).toEqual([]);
            await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-sftp-${state}.png` });
        }
        await visit(page, 'dialogs', theme);
        await page.locator('#new-name').fill('renamed.txt');
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        await expect(page.getByLabel('callback result')).toHaveText('/fixture/reference.txt → renamed.txt');
        for (const variant of ['compare', 'hash-file', 'hash-display']) {
            const errors = await visit(page, 'dialogs', theme, `&variant=${variant}`);
            await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-dialogs-${variant}.png` });
            if (variant === 'compare') {
                await page.locator('#hash-value').fill('a'.repeat(64));
                await page.getByRole('button', { name: 'Compare Hash', exact: true }).click();
                await expect(page.locator('#notification-container [role=status]')).toHaveText('✓ Hash matches! File integrity verified.');
            } else if (variant === 'hash-file') {
                await page.getByRole('button', { name: 'Generate Hash', exact: true }).click();
                await expect(page.locator('#notification-container [role=status]')).toContainText('Hash generated and saved to reference.txt.hash:');
            } else await expect(page.locator('#hash-display')).toHaveValue('a'.repeat(64));
            expect(errors).toEqual([]);
        }
        await visit(page, 'permissions', theme, '&state=loading');
        await expect(page.getByRole('button', { name: 'Checking...' })).toBeDisabled();
        await visit(page, 'permissions', theme, '&state=success');
        await expect(page.getByText('Access Granted!', { exact: true })).toBeVisible();
        await contrast(page, '.success-message h3', `${theme}-permissions-success`);
    });
    test(`theme_peripheral_controls ${theme} real borders focus hover`, async ({ page }) => {
        await visit(page, 'search', theme);
        await page.locator('.search-input-field').fill('re');
        await page.locator('.modal-header').click();
        await contrast(page, '.search-input-field', `${theme}-search-border`, 'borderTopColor', 3);
        await page.locator('.search-input-field').focus();
        await contrast(page, '.search-input-field', `${theme}-search-focus`, 'outlineColor', 3);
        await page.getByRole('button', { name: 'Search filters and options' }).click();
        await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-search-controls.png` });
        await visit(page, 'network', theme);
        await contrast(page, '.connect-button', `${theme}-network-border`, 'outlineColor', 3);
        await page.locator('.connect-button').hover();
        await contrast(page, '.connect-button', `${theme}-network-hover`);
        await visit(page, 'toasts', theme);
        await contrast(page, '#notification-container > div', `${theme}-toast-border`, 'borderTopColor', 3);
    });
    test(`theme_search_mask_ink ${theme} survives pointer entry and leave`, async ({ page }) => {
        const errors = await visit(page, 'search', theme);
        const receipts = [];
        for (const selector of ['.search-btn > span', '.filter-toggle-btn > .icon-filter']) {
            const icon = page.locator(selector);
            const box = await icon.boundingBox();
            for (const state of ['before', 'enter', 'leave']) {
                await page.mouse.move(state === 'enter' ? box.x + box.width / 2 : 20, state === 'enter' ? box.y + box.height / 2 : 20);
                const style = await icon.evaluate(node => {
                    const ink = getComputedStyle(node), button = getComputedStyle(node.parentElement);
                    return { ink: ink.backgroundColor, color: ink.color, intended: button.color, mask: ink.maskImage };
                });
                const image = await icon.screenshot({ path: `artifacts/theme-validation/visual/${theme}-${selector.includes('filter') ? 'filter' : 'search'}-${state}.png` });
                const colors = await page.evaluate(async base64 => {
                    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
                    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
                    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
                    return new Set(Array.from({ length: pixels.length / 4 }, (_, i) => [...pixels.slice(i * 4, i * 4 + 4)].join(','))).size;
                }, image.toString('base64'));
                receipts.push({ selector, state, ...style, colors });
                expect.soft(style.mask, `${selector} ${state} mask`).not.toBe('none');
                expect.soft(style.ink, `${selector} ${state} nontransparent ink`).not.toBe('rgba(0, 0, 0, 0)');
                expect.soft(style.ink, `${selector} ${state} intended text ink`).toBe(style.intended);
                expect.soft(style.color, `${selector} ${state} inherited text`).toBe(style.intended);
                expect.soft(colors, `${selector} ${state} nonblank pixels`).toBeGreaterThan(1);
            }
        }
        writeFileSync(`artifacts/theme-validation/visual/${theme}-search-mask-ink.json`, JSON.stringify(receipts, null, 2));
        await page.locator('.search-input-field').fill('reference');
        await page.getByRole('button', { name: 'Search (Enter)', exact: true }).click();
        await expect(page.locator('.result-name-container').first()).toContainText('reference');
        const filters = page.getByRole('button', { name: 'Search filters and options' });
        await filters.click();
        await expect(page.locator('.search-controls-dropdown')).toBeVisible();
        await filters.click();
        await expect(page.locator('.search-controls-dropdown')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
    test(`theme_search_button_focus ${theme} visible after real Tab`, async ({ page }) => {
        const errors = await visit(page, 'search', theme);
        await page.locator('.search-input-field').click();
        await page.keyboard.press('Tab');
        const button = page.getByRole('button', { name: 'Search (Enter)', exact: true });
        await expect(button).toBeFocused();
        const focus = await button.evaluate(node => {
            const style = getComputedStyle(node);
            return { visible: node.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor, offset: style.outlineOffset };
        });
        writeFileSync(`artifacts/theme-validation/visual/${theme}-search-button-focus.json`, JSON.stringify(focus, null, 2));
        await page.screenshot({ path: `artifacts/theme-validation/visual/${theme}-search-button-focus.png` });
        expect.soft(focus.visible).toBe(true);
        expect.soft(focus.outline).toBe('solid');
        expect.soft(focus.width).toBe('2px');
        await contrast(page, '.search-btn', `${theme}-search-button-focus`, 'outlineColor', 3);
        expect(errors).toEqual([]);
    });
    test(`theme_confirm ${theme} existing promise outcomes`, async ({ page }) => {
        for (const action of ['Cancel', 'Confirm']) {
            await visit(page, 'confirm', theme);
            await page.getByRole('button', { name: action, exact: true }).click();
            await expect(page.getByLabel('callback result')).toHaveText(String(action === 'Confirm'));
        }
    });
}
