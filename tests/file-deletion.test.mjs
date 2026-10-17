import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSelection, topLevelItems } from '../src/utils/fileDeletion.js';
const items = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }];
function setup({ confirm = true, failed = [], remote = false } = {}) {
    const calls = [], prompts = [], errors = [];
    return { calls, prompts, errors, ops: {
        invoke: async (command, args) => {
            calls.push([command, args]);
            return { trashed: args.paths?.filter(path => !failed.some(([failedPath]) => path === failedPath)) || [], failed, undoErrors: [] };
        },
        confirm: async (...args) => { prompts.push(args); return confirm; },
        isSftpPath: () => remote, deleteSftpItem: async path => { calls.push(['sftp', path]); return true; },
        reportError: error => errors.push(error),
    } };
}
test('single delete goes to trash; multiple delete asks before any IPC', async () => {
    const single = setup();
    assert.deepEqual(await deleteSelection(items.slice(0, 1), single.ops), ['/a']);
    assert.equal(single.prompts.length, 0);
    assert.equal(single.calls[0][0], 'trash_items');
    const canceled = setup({ confirm: false });
    assert.deepEqual(await deleteSelection(items, canceled.ops), []);
    assert.equal(canceled.calls.length, 0);
    const batch = setup();
    assert.deepEqual(await deleteSelection(items, batch.ops), ['/a', '/b']);
    assert.equal(batch.prompts.length, 1);
    assert.deepEqual(batch.calls[0], ['trash_items', { paths: ['/a', '/b'] }]);
});
test('trash failure never silently permanently deletes; warning explicitly states unrecoverable', async () => {
    const canceled = setup({ confirm: false, failed: [['/a', 'No space left']] });
    assert.deepEqual(await deleteSelection(items.slice(0, 1), canceled.ops), []);
    assert.deepEqual(canceled.calls.map(([command]) => command), ['trash_items']);
    assert.match(canceled.prompts[0][0], /cannot be recovered/);
    assert.match(canceled.prompts[0][0], /too large/);
    const accepted = setup({ failed: [['/a', 'No space left']] });
    assert.deepEqual(await deleteSelection(items, accepted.ops), ['/b', '/a']);
    assert.deepEqual(accepted.calls[1], ['permanently_delete', { path: '/a' }]);
});
test('remote deletion needs separate permanent deletion approval', async () => {
    const canceled = setup({ remote: true, confirm: false });
    assert.deepEqual(await deleteSelection(items.slice(0, 1), canceled.ops), []);
    assert.equal(canceled.calls.length, 0);
    assert.match(canceled.prompts[0][0], /SFTP/);
});
test('selected ancestors suppress descendants without matching adjacent names', () => {
    assert.deepEqual(topLevelItems([{ path: '/a', isDirectory: true }, { path: '/a/child' }, { path: '/ab' }, { path: '/ab' }]),
        [{ path: '/a', isDirectory: true }, { path: '/ab' }]);
});
