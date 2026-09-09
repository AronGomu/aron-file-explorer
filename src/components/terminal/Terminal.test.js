import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as session from './terminalSession.js';

// Execute the actual component/effects/handlers; only React host, xterm and IPC are fakes.
function terminalFixture() {
    const hooks = [];
    const calls = [];
    const channels = [];
    let cursor = 0;
    let effects = [];
    let tree;
    let resolveClose;
    let rejectClose;
    const closing = new Promise((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
    const host = { clientWidth: 800, clientHeight: 240, addEventListener() {}, removeEventListener() {} };
    const React = {
        createElement(type, props, ...children) {
            if (props?.ref) props.ref.current = host;
            return { type, props: { ...props, children } };
        },
        useRef(value) {
            const index = cursor++;
            return hooks[index] ??= { current: value };
        },
        useState(value) {
            const index = cursor++;
            hooks[index] ??= { value };
            return [hooks[index].value, next => {
                hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next;
            }];
        },
        useEffect(effect, deps) {
            const index = cursor++;
            const previous = hooks[index];
            if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
            effects.push(() => {
                previous?.cleanup?.();
                hooks[index] = { deps, cleanup: effect() };
            });
        },
    };
    const disposable = () => ({ dispose() {} });
    class Xterm {
        cols = 80;
        rows = 24;
        parser = { registerOscHandler: disposable };
        loadAddon() {}
        open() {}
        onData = disposable;
        onBinary = disposable;
        onResize = disposable;
        attachCustomKeyEventHandler() {}
        focus() {}
        dispose() {}
    }
    const core = {
        Channel: class { constructor() { channels.push(this); } },
        invoke: async (name, args) => {
            calls.push([name, args]);
            if (name === 'terminal_create') return { id: calls.length, shell: 'posix' };
            if (name === 'terminal_close') return closing;
        },
    };
    const modules = {
        react: React,
        '@tauri-apps/api/core': core,
        '@xterm/xterm': { Terminal: Xterm },
        '@xterm/addon-fit': { FitAddon: class { fit() {} } },
        '@xterm/addon-webgl': { WebglAddon: class { onContextLoss = disposable; dispose() {} } },
        '../../providers/HistoryProvider': { useHistory: () => ({ currentPath: '/tmp' }) },
        '../../providers/FileSystemProvider': { useFileSystem: () => ({ selectedItems: [] }) },
        '../../providers/SettingsProvider': { useSettings: () => ({ settings: {} }) },
        './terminalSession.js': session,
    };
    const module = { exports: {} };
    const source = readFileSync(new URL('./Terminal.jsx', import.meta.url), 'utf8');
    runInNewContext(transformSync(source, { loader: 'jsx', format: 'cjs' }).code, {
        module, exports: module.exports,
        require: name => {
            if (name.endsWith('.css')) return {};
            assert.ok(modules[name], `unexpected import ${name}`);
            return modules[name];
        },
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        ResizeObserver: class { observe() {} disconnect() {} },
    });
    const Component = module.exports.default;
    const render = () => {
        cursor = 0;
        effects = [];
        tree = Component({ isOpen: true, onToggle() {} });
        effects.forEach(effect => effect());
    };
    const nodes = (node = tree) => node && typeof node === 'object'
        ? [node, ...node.props.children.flatMap(child => nodes(child))] : [];
    return {
        calls, channels, resolveClose, rejectClose,
        async flush() {
            for (let i = 0; i < 3; i++) {
                render();
                await new Promise(resolve => setImmediate(resolve));
            }
        },
        click(label) {
            const button = nodes().find(node => node.type === 'button' && node.props.children.includes(label));
            assert.ok(button, `missing ${label} button`);
            button.props.onClick();
        },
        notice: () => nodes().find(node => node.props.className === 'terminal-notice')?.props.children.join(''),
        unmount: () => hooks.forEach(hook => hook.cleanup?.()),
    };
}

test('New shell waits for deferred native close before replacement create', async () => {
    const f = terminalFixture();
    await f.flush();
    f.channels[0].onmessage({ event: 'exit', code: 0 });
    await f.flush();
    f.click('New shell');
    await f.flush();
    const createdEarly = f.calls.filter(([name]) => name === 'terminal_create').length;
    const closes = f.calls.filter(([name]) => name === 'terminal_close').length;
    f.resolveClose();
    await f.flush();
    f.unmount();
    assert.equal(closes, 1);
    assert.equal(createdEarly, 1, 'replacement created before terminal_close finished');
    assert.equal(f.calls.filter(([name]) => name === 'terminal_create').length, 2);
});

test('New shell surfaces native close failure without creating replacement', async () => {
    const f = terminalFixture();
    await f.flush();
    f.channels[0].onmessage({ event: 'exit', code: 0 });
    await f.flush();
    f.click('New shell');
    await f.flush();
    f.rejectClose(new Error('close failed'));
    await f.flush();
    const notice = f.notice();
    f.unmount();
    assert.equal(f.calls.filter(([name]) => name === 'terminal_create').length, 1);
    assert.match(notice || '', /close failed/);
});

test('New shell retries do not bypass a failed cleanup barrier', async () => {
    const f = terminalFixture();
    await f.flush();
    f.channels[0].onmessage({ event: 'exit', code: 0 });
    await f.flush();
    f.click('New shell');
    await f.flush();
    f.rejectClose(new Error('close failed'));
    await f.flush();
    f.click('New shell');
    await f.flush();
    f.unmount();
    assert.equal(f.calls.filter(([name]) => name === 'terminal_create').length, 1);
    assert.match(f.notice() || '', /close failed/);
});

test('output truncation notice survives the following shell exit event', async () => {
    const f = terminalFixture();
    await f.flush();
    f.channels[0].onmessage({ event: 'error', message: 'Terminal output drain timed out after shell exit; output truncated' });
    f.channels[0].onmessage({ event: 'exit', code: 0 });
    await f.flush();
    f.resolveClose();
    f.unmount();
    assert.match(f.notice() || '', /output truncated/);
});

test('Stop reports pending cleanup and does not offer New shell until close completes', async () => {
    const f = terminalFixture();
    await f.flush();
    f.click('Stop');
    f.click('Stop');
    await f.flush();
    assert.throws(() => f.click('New shell'), /missing New shell button/);
    assert.equal(f.calls.filter(([name]) => name === 'terminal_close').length, 1);
    f.resolveClose();
    await f.flush();
    f.click('New shell');
    await f.flush();
    f.unmount();
    assert.equal(f.calls.filter(([name]) => name === 'terminal_create').length, 2);
});

test('Stop surfaces close failure and New shell cannot bypass it', async () => {
    const f = terminalFixture();
    await f.flush();
    f.click('Stop');
    f.rejectClose(new Error('close failed'));
    await f.flush();
    assert.match(f.notice() || '', /close failed/);
    f.click('New shell');
    await f.flush();
    f.unmount();
    assert.equal(f.calls.filter(([name]) => name === 'terminal_create').length, 1);
    assert.match(f.notice() || '', /close failed/);
});
