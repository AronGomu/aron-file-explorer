import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quotePaths, sanitizePaste, createPtyClient } from './terminalSession.js';

test('paste cannot inject Enter, ESC, or terminal control bytes', () => {
    assert.equal(sanitizePaste('echo hi\r\nnext\targ\x1b[201~\x03\x7f'), 'echo hi next arg[201~');
});

test('paths are quoted for actual shell; control characters and unknown shells rejected', () => {
    assert.equal(quotePaths(["/tmp/a'b $(touch nope)"], 'posix'), "'/tmp/a'\\''b $(touch nope)'");
    assert.equal(quotePaths(["C:\\a'b"], 'powershell'), "'C:\\a''b'");
    assert.equal(quotePaths(["/a\\b'c"], 'fish'), "'/a\\\\b\\'c'");
    assert.throws(() => quotePaths(['/a\nb'], 'posix'));
    assert.throws(() => quotePaths(['/a'], 'unknown'));
});

function fixture() {
    const calls = [];
    const writes = [];
    let finishStart;
    const channel = {};
    const invoke = async (name, args) => {
        calls.push([name, args]);
        if (name === 'terminal_create') return new Promise(resolve => { finishStart = resolve; });
    };
    const client = createPtyClient({ invoke, channel, write: (data, done) => writes.push([data, done]), onExit() {}, onError() {} });
    return { client, calls, channel, writes, finish: value => finishStart(value) };
}

test('late create response after disposal closes session without activating input', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    f.client.dispose();
    f.finish({ id: 7, shell: 'posix' });
    await start;
    await f.client.input('must not execute');
    assert.deepEqual(f.calls.map(([name]) => name), ['terminal_create', 'terminal_close']);
});

test('output stays binary; consumed bytes acknowledged only after xterm parses them', async () => {
    const f = fixture();
    f.channel.onmessage({ event: 'output', id: 9, data: [0xe2, 0x82] });
    assert.deepEqual(f.writes[0][0], new Uint8Array([0xe2, 0x82]));
    assert.equal(f.calls.length, 0);
    f.writes[0][1]();
    assert.deepEqual(f.calls[0], ['terminal_ack', { id: 9, bytes: 2 }]);
});

test('input writes are ordered; queues stop after dispose', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    f.finish({ id: 1, shell: 'posix' });
    await start;
    await Promise.all([f.client.input('one'), f.client.input('two')]);
    assert.deepEqual(f.calls.filter(([n]) => n === 'terminal_write').map(([,a]) => a.data), ['one', 'two']);
    f.client.dispose();
    await f.client.input('three');
    assert.equal(f.calls.filter(([n]) => n === 'terminal_write').length, 2);
});

test('input queue rejects oversized paste rather than growing unbounded', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    f.finish({ id: 1, shell: 'posix' });
    await start;
    await assert.rejects(f.client.input('a'.repeat(262145)), /Input queue is full/);
});

test('input chunks preserve Unicode and legacy binary input flag', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    f.finish({ id: 1, shell: 'posix' });
    await start;
    const data = '😀'.repeat(1025);
    await f.client.input(data);
    const writes = f.calls.filter(([name]) => name === 'terminal_write');
    assert.equal(writes.length, 2);
    assert.equal(writes.map(([, args]) => args.data).join(''), data);
    await f.client.input('\xff', true);
    assert.deepEqual(f.calls.at(-1), ['terminal_write', { id: 1, generation: 0, data: '\xff', binary: true }]);
});

test('startup replies are queued until create returns, preserving order', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    const reply = f.client.input('\x1b[1;1R');
    const typed = f.client.input('typed');
    assert.equal(f.calls.filter(([name]) => name === 'terminal_write').length, 0);
    f.finish({ id: 3, shell: 'posix' });
    await start;
    await Promise.all([reply, typed]);
    assert.deepEqual(f.calls.filter(([name]) => name === 'terminal_write').map(([, args]) => args.data), ['\x1b[1;1R', 'typed']);
});

test('startup queue is bounded and disposal releases queued replies', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    await assert.rejects(f.client.input('a'.repeat(262145)), /Input queue is full/);
    const input = f.client.input('pending');
    f.client.dispose();
    await input;
    f.finish({ id: 3, shell: 'posix' });
    await start;
    assert.equal(f.calls.filter(([name]) => name === 'terminal_write').length, 0);
});

test('failed create releases startup queue without sending input', async () => {
    const calls = [];
    const client = createPtyClient({ channel: {}, write() {}, onExit() {}, onError() {}, invoke: async name => {
        calls.push(name);
        if (name === 'terminal_create') throw new Error('create failed');
    } });
    const reply = client.input('\x1b[1;1R');
    await assert.rejects(client.start('/missing', 80, 24), /create failed/);
    await reply;
    assert.deepEqual(calls, ['terminal_create']);
});

test('Ctrl+C bypasses stalled/full input queue and cancels pending paste chunks', async () => {
    const calls = [];
    let release;
    const client = createPtyClient({ channel: {}, write() {}, onExit() {}, onError() {}, invoke: async (name, args) => {
        calls.push([name, args]);
        if (name === 'terminal_create') return { id: 1, shell: 'posix' };
        if (name === 'terminal_write') await new Promise(resolve => { release = resolve; });
    } });
    await client.start('/tmp', 80, 24);
    const paste = client.input('a'.repeat(262144));
    await new Promise(resolve => setImmediate(resolve));
    const interrupt = client.input('\x03');
    await interrupt;
    assert.equal(calls.at(-1)[0], 'terminal_interrupt');
    release();
    await paste;
    assert.equal(calls.filter(([name]) => name === 'terminal_write').length, 1);
});

test('overlapping interrupts stay ordered before fresh input without waiting for paste', async () => {
    const calls = [];
    const interrupts = [];
    const client = createPtyClient({ channel: {}, write() {}, onExit() {}, onError() {}, invoke: async (name, args) => {
        calls.push([name, args]);
        if (name === 'terminal_create') return { id: 1, shell: 'posix' };
        if (name === 'terminal_interrupt') await new Promise(resolve => interrupts.push(resolve));
    } });
    await client.start('/tmp', 80, 24);
    const first = client.input('\x03');
    const second = client.input('\x03');
    const fresh = client.input('fresh');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(interrupts.length, 1);
    interrupts[0]();
    await first;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(interrupts.length, 2);
    assert.equal(calls.filter(([name]) => name === 'terminal_write').length, 0);
    interrupts[1]();
    await Promise.all([second, fresh]);
    assert.deepEqual(calls.at(-1), ['terminal_write', { id: 1, generation: 2, data: 'fresh' }]);
});

test('fit host keeps spacing outside its measured box', () => {
    const css = readFileSync(new URL('./terminal.css', import.meta.url), 'utf8');
    const host = css.match(/\.terminal-screen\s*\{([^}]+)\}/)[1];
    assert.match(host, /margin:\s*6px 10px/);
    assert.doesNotMatch(host, /padding:\s*6px 10px/);
});

test('shell exit disables subsequent writes without losing queued output ACKs', async () => {
    const f = fixture();
    const start = f.client.start('/tmp', 80, 24);
    f.finish({ id: 1, shell: 'posix' });
    await start;
    f.channel.onmessage({ event: 'output', id: 1, data: [65] });
    f.channel.onmessage({ event: 'exit', id: 1, code: 0 });
    await f.client.input('ignored');
    f.writes[0][1]();
    assert.equal(f.calls.filter(([name]) => name === 'terminal_write').length, 0);
    assert.deepEqual(f.calls.at(-1), ['terminal_ack', { id: 1, bytes: 1 }]);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function closingFixture() {
    const closing = deferred();
    const creating = deferred();
    const calls = [];
    const client = createPtyClient({ channel: {}, write() {}, onExit() {}, onError() {}, invoke: (name, args) => {
        calls.push([name, args]);
        if (name === 'terminal_create') return creating.promise;
        if (name === 'terminal_close') return closing.promise;
        return Promise.resolve();
    } });
    return { client, closing, creating, calls };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('dispose waits for native close and returns the same completion to repeated callers', async () => {
    const f = closingFixture();
    f.creating.resolve({ id: 1, shell: 'posix' });
    await f.client.start('/tmp', 80, 24);
    const disposed = f.client.dispose();
    let complete = false;
    Promise.resolve(disposed).then(() => { complete = true; });
    await tick();
    const completedEarly = complete;
    assert.equal(f.client.dispose(), disposed);
    f.closing.resolve();
    await disposed;
    assert.equal(completedEarly, false, 'disposal completed before terminal_close');
    assert.equal(complete, true);
    assert.equal(f.calls.filter(([name]) => name === 'terminal_close').length, 1);
});

test('dispose waits for late create cleanup, not just the pending create response', async () => {
    const f = closingFixture();
    const starting = f.client.start('/tmp', 80, 24);
    const disposed = f.client.dispose();
    let complete = false;
    Promise.resolve(disposed).then(() => { complete = true; });
    await tick();
    const beforeCreate = complete;
    f.creating.resolve({ id: 2, shell: 'posix' });
    await tick();
    const beforeClose = complete;
    f.closing.resolve();
    assert.equal(await starting, null);
    await disposed;
    assert.equal(beforeCreate, false, 'disposal completed before late create');
    assert.equal(beforeClose, false, 'disposal completed before late terminal_close');
    assert.equal(complete, true);
});

test('dispose rejects on close failure so replacement cannot treat failure as cleanup', async () => {
    const f = closingFixture();
    f.creating.resolve({ id: 3, shell: 'posix' });
    await f.client.start('/tmp', 80, 24);
    const disposed = f.client.dispose();
    f.closing.reject(new Error('close failed'));
    await assert.rejects(Promise.resolve(disposed), /close failed/);
});

test('dispose before start prevents native creation and settles immediately', async () => {
    const f = closingFixture();
    await f.client.dispose();
    assert.equal(await f.client.start('/tmp', 80, 24), null);
    assert.deepEqual(f.calls, []);
});

test('dispose during failed creation settles without a native close', async () => {
    const f = closingFixture();
    const starting = assert.rejects(f.client.start('/tmp', 80, 24), /create failed/);
    const disposed = f.client.dispose();
    f.creating.reject(new Error('create failed'));
    await Promise.all([starting, disposed]);
    assert.deepEqual(f.calls.map(([name]) => name), ['terminal_create']);
});

test('late create close failure rejects both start and disposal completion', async () => {
    const f = closingFixture();
    const starting = assert.rejects(f.client.start('/tmp', 80, 24), /late close failed/);
    const disposed = assert.rejects(f.client.dispose(), /late close failed/);
    f.creating.resolve({ id: 4, shell: 'posix' });
    f.closing.reject(new Error('late close failed'));
    await Promise.all([starting, disposed]);
    assert.equal(f.calls.filter(([name]) => name === 'terminal_close').length, 1);
});
