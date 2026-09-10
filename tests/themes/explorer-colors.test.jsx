import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import postcss from 'postcss';
import FileIcon from '../../src/components/explorer/FileIcon.jsx';
import Button from '../../src/components/common/Button.jsx';
import Icon from '../../src/components/common/Icon.jsx';
import { getFileIconType } from '../../src/utils/icons.js';
import { applyThemeToDOM, EMBEDDED_THEMES } from '../../src/themes/applyTheme.js';
import { TOKEN_TO_CSS } from '../../src/themes/themeContract.js';
import { explorerCases, explorerIPC } from './gallery/explorer.jsx';

const css = path => postcss.parse(readFileSync(path, 'utf8'));
function declaration(path, selector, prop) {
    let value;
    css(path).walkRules(selector, rule => rule.walkDecls(prop, decl => { value = decl.value; }));
    return value;
}
let root, container;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });
async function render(node) {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container); await act(async () => root.render(node));
    return container;
}

test.each(EMBEDDED_THEMES)('theme_file_semantics: $id actual SVG/labels use declared roles', async theme => {
    applyThemeToDOM(theme);
    const kinds = ['image', 'video', 'audio', 'code', 'archive', 'pdf', 'text'];
    const names = ['image.png', 'video.mp4', 'audio.mp3', 'code.js', 'archive.zip', 'document.pdf', 'notes.txt'];
    const view = await render(<>{names.map(name => <div key={name}><FileIcon filename={name} /><span>{name}</span></div>)}<FileIcon filename="Projects" isDirectory /></>);
    kinds.forEach((kind, i) => {
        expect(getFileIconType(names[i])).toBe(kind);
        expect(view.querySelector(`.file-icon-${kind} svg`)).not.toBeNull();
        expect(view.textContent).toContain(names[i]);
        expect(declaration('src/components/explorer/fileItem.css', `.file-icon-${kind}`, 'color')).toBe(`var(--file-${kind})`);
    });
    expect(declaration('src/components/explorer/fileItem.css', '.file-item.directory .file-icon', 'color')).toBe('var(--folder)');
});

test('theme_breadcrumb: current and hovered labels never use textOnAccent on surfaces', () => {
    for (const selector of ['.segment-button', '.segment-button:hover', '.segment-button.current']) {
        expect(declaration('src/components/explorer/pathBreadcrumb.css', selector, 'color')).toBe('var(--text-primary)');
    }
});

test('theme_control_states: actual Button props and Icon color API preserved', async () => {
    let clicks = 0;
    const view = await render(<><Button onClick={() => clicks++}>Open</Button><Button disabled>Disabled</Button><Icon name="copy" color="var(--text-primary)" /></>);
    view.querySelector('button').click();
    expect(clicks).toBe(1);
    expect(view.querySelectorAll('button')[1].disabled).toBe(true);
    expect(view.querySelector('.icon-copy').style.color).toBe('var(--text-primary)');
    for (const path of ['src/styles/components.css', 'src/components/common/common.css']) {
        expect(declaration(path, '.btn-primary', 'color')).toBe('var(--text-on-accent)');
        expect(declaration(path, '.btn-danger', 'color')).toBe('var(--text-primary)');
    }
});

test('theme_explorer_views: fixture inventory and unknown IPC rejection', () => {
    expect(explorerCases).toEqual(['explorer-grid', 'explorer-list', 'explorer-details', 'sidebar-tabs', 'breadcrumb', 'context-menu', 'controls', 'this-pc']);
    expect(() => explorerIPC('execute_command', { command: 'unsafe' })).toThrow('Unknown theme gallery IPC command: execute_command');
    expect(() => explorerIPC('open_directory', { path: '/home/host' })).toThrow('Unknown theme gallery IPC command: open_directory');
});

test('theme_icons: owned monochrome sources use masks, never media inversion', () => {
    const source = readFileSync('src/styles/components.css', 'utf8');
    expect(declaration('src/styles/components.css', '.icon-file', 'mask')).toContain('data:image/svg+xml');
    expect(declaration('src/styles/components.css', '.icon-file', 'background-color')).toBe('currentColor');
    expect(source).not.toMatch(/(?:img|video)[^{]*\{[^}]*filter\s*:/);
    expect(readFileSync('src/components/explorer/createFileButton.css', 'utf8')).not.toContain('filter: invert');
});

test('theme_control_states: ignored React event props removed without replacement listeners', () => {
    for (const path of ['src/components/explorer/FileItem.jsx', 'src/components/tabs/TabManager.jsx', 'src/components/sidebar/SidebarItem.jsx']) {
        const source = readFileSync(path, 'utf8');
        expect(source).not.toContain('onSelectStart');
        expect(source).not.toContain('handleSelectStart');
        expect(source).toContain('onMouseDown={handleMouseDown}');
    }
});

test('theme_explorer_views: owned CSS has no unknown vars, legacy color aliases, or literal paints', () => {
    const known = new Set([...Object.values(TOKEN_TO_CSS), '--background-rgb', '--border-rgb', '--accent-rgb', '--x', '--y']);
    css('src/styles/variables.css').walkDecls(decl => { if (decl.prop.startsWith('--')) known.add(decl.prop); });
    const paths = ['src/styles/global.css', 'src/styles/components.css', 'src/styles/modern.css', 'src/styles/layouts/mainLayout.css', 'src/layouts/detailsLayout.css', 'src/components/common/common.css'];
    for (const dir of ['explorer', 'contextMenu', 'sidebar', 'tabs', 'settings', 'thisPc']) {
        for (const name of readdirSync(`src/components/${dir}`).filter(name => name.endsWith('.css'))) paths.push(`src/components/${dir}/${name}`);
    }
    for (const path of paths) css(path).walkDecls(decl => {
        for (const [, variable] of decl.value.matchAll(/var\((--[\w-]+)/g)) {
            expect(known.has(variable), `${path}:${decl.source.start.line} ${variable}`).toBe(true);
            expect(variable).not.toMatch(/^--(?:color-white|color-black|accent-color|hover-color|text-color|danger|border-subtle|background-breadcrumb|info-bg|warning-bg|warning-text|success-hover)$/);
        }
        if (/color|background|shadow|border|outline|fill|stroke/.test(decl.prop) && !decl.value.includes('data:image')) {
            expect(decl.value, `${path}:${decl.source.start.line}`).not.toMatch(/#[\da-f]{3,8}\b|\b(?:black|white|purple)\b|rgba?\(\s*\d/i);
        }
    });
});
