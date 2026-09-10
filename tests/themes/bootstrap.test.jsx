import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import App from '../../src/App.jsx';
import { bootstrapTheme } from '../../src/themes/applyTheme';

test('theme_bootstrap_no_legacy_flash: fatal error renders root colors outside providers', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = () => ({ matches: true });
    bootstrapTheme();
    const boundary = new App({});
    boundary.state = App.getDerivedStateFromError(new Error('fixture fatal error'));
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(boundary.render()));
        expect(container.textContent).toContain('The application could not be loaded properly.');
        expect(document.documentElement.dataset.theme).toBe('catppuccin-mocha');
        expect(container.firstElementChild.style.backgroundColor).toBe('var(--background)');
        expect(container.firstElementChild.style.color).toBe('var(--text-primary)');
        expect(container.querySelector('button').style.color).toBe('var(--text-on-accent)');
        for (const element of container.querySelectorAll('[style]')) {
            expect(element.getAttribute('style')).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
        }
    } finally {
        act(() => root.unmount()); container.remove();
    }
});
