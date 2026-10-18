import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainSelection, selectionPaths, initialChoices } from '../src/chooser/selection.js';
const file = { path: '/a.txt', isDirectory: false };
const folder = { path: '/folder', isDirectory: true };
test('single selection cannot be widened by drag, Ctrl, or range selection', () => {
    assert.deepEqual(constrainSelection([file, folder], { mode: 'OpenFile', multiple: false }), [folder]);
});
test('multi file request deduplicates and never returns navigation folders', () => {
    const request = { mode: 'OpenFile', multiple: true, directory: false };
    assert.deepEqual(selectionPaths(constrainSelection([file, file, folder], request), request, '/'), ['/a.txt']);
});
test('folder request selects a folder or falls back to current directory', () => {
    const request = { mode: 'OpenFile', directory: true };
    assert.deepEqual(selectionPaths([folder], request, '/'), ['/folder']);
    assert.deepEqual(selectionPaths([], request, '/'), ['/']);
});
test('application choices get valid defaults without modifying requests', () => {
    assert.deepEqual(initialChoices([['encoding', 'Encoding', [['utf8', 'UTF-8']], ''], ['readonly', 'Read only', [], '']]), { encoding: 'utf8', readonly: 'false' });
});

test('parent navigation never becomes a returned file, folder, or batch destination', () => {
    const parent = { name: '..', path: '/', isDirectory: true, isParentNavigation: true };
    for (const request of [{ mode: 'OpenFile', multiple: true }, { mode: 'OpenFile', directory: true }, { mode: 'SaveFiles' }]) {
        assert.deepEqual(constrainSelection([parent], request), []);
        assert.deepEqual(selectionPaths([parent], request, '/current'), request.directory ? ['/current'] : []);
    }
});

test('parent stays visible when hidden files are off or search has no matches; root has no parent', async () => {
    const { chooserListing } = await import('../src/chooser/selection.js');
    const data = { directories: [{ name: '.hidden', path: '/folder/.hidden' }], files: [{ name: 'visible.txt', path: '/folder/visible.txt' }] };
    const request = { mode: 'OpenFile' };
    assert.deepEqual(chooserListing(data, request, '/folder', false, 'missing').directories,
        [{ name: '..', path: '/', isDirectory: true, isParentNavigation: true }]);
    assert.equal(chooserListing(data, request, '/', false, '').directories.length, 0);
    assert.equal(chooserListing(data, request, '/folder', true, '').directories.length, 2);
    assert.equal(chooserListing(data, { directory: true }, '/folder', false, '').files.length, 0);
});
