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
