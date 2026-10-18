import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveSelection, dragSelection } from '../src/utils/fileDrag.js';

const file = path => ({ path });
const folder = path => ({ path, isDirectory: true });

test('dragging a selected item moves the selection; an unselected item moves alone', () => {
    const a = file('/source/a'), b = file('/source/b'), c = file('/source/c');
    assert.deepEqual(dragSelection(a, [a, b]), [a, b]);
    assert.deepEqual(dragSelection(c, [a, b]), [c]);
    const directory = folder('/source/folder');
    assert.deepEqual(dragSelection(directory, [directory, file('/source/folder/child'), directory]), [directory]);
});

test('drops reject self, descendants and unchanged folders but accept siblings and ancestors', () => {
    const items = [folder('/source/folder'), file('/source/a')];
    for (const target of ['/source', '/source/folder', '/source/folder/child', '/source/folder/../folder/child']) {
        assert.equal(canMoveSelection(items, target), false, target);
    }
    for (const target of ['/', '/target', '/source/folder-other']) {
        assert.equal(canMoveSelection(items, target), true, target);
    }
    assert.equal(canMoveSelection([], '/target'), false);
    assert.equal(canMoveSelection(items, ''), false);
    assert.equal(canMoveSelection([file('/a'), file('/other/b')], '/'), true);
    assert.equal(canMoveSelection([file('/A/a')], '/a'), true, 'POSIX paths are case sensitive');
});

test('Windows drive and UNC drops compare separators and case', () => {
    assert.equal(canMoveSelection([file('C:\\source\\a')], 'c:/SOURCE/'), false);
    assert.equal(canMoveSelection([folder('C:\\source')], 'c:/source/child'), false);
    assert.equal(canMoveSelection([file('C:\\source\\a')], 'D:\\target'), true);
    assert.equal(canMoveSelection([file('\\\\server\\share\\a')], '\\\\SERVER\\share'), false);
});

test('remote drops allow only the same connection and protect remote folders', () => {
    const parse = path => {
        const match = /^sftp:(one|two):(.*)$/.exec(path);
        return match ? { connection: { name: match[1] }, remotePath: match[2] } : null;
    };
    assert.equal(canMoveSelection([file('sftp:one:/home/a')], 'sftp:one:/target', parse), true);
    assert.equal(canMoveSelection([file('sftp:one:./a')], 'sftp:one:.', parse), false);
    assert.equal(canMoveSelection([folder('sftp:one:/home')], 'sftp:one:/home/child', parse), false);
    assert.equal(canMoveSelection([file('sftp:one:/home/a')], 'sftp:two:/target', parse), false);
    assert.equal(canMoveSelection([file('/local/a')], 'sftp:one:/target', parse), false);
    assert.equal(canMoveSelection([file('sftp:one:/a')], '/local', parse), false);
    assert.equal(canMoveSelection([file('sftp:unknown:/a')], 'sftp:one:/target', parse), false);
});
