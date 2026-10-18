import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFileClipboard, decodeFileClipboard } from '../src/utils/fileClipboard.js';

test('copy and cut file payloads survive spaces, unicode, percent signs and newlines between processes', () => {
    const items = [{ path: '/tmp/été # 100%\n.txt' }, { path: '/tmp/folder' }];
    for (const operation of ['copy', 'cut']) {
        const decoded = decodeFileClipboard(encodeFileClipboard(items, operation));
        assert.equal(decoded.operation, operation);
        assert.deepEqual(decoded.items.map(item => item.path), items.map(item => item.path));
    }
});

test('ordinary clipboard text, remote URLs, roots and malformed URI data are not file operations', () => {
    for (const text of ['', 'hello', 'copy\nhttps://example.com/file', 'cut\nfile://server/file', 'cut\nfile:///', 'copy\nfile:///bad%ZZ']) {
        assert.equal(decodeFileClipboard(text), null);
    }
});
