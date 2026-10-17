import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORY_SCROLL_KEY, readDirectoryScrollPositions, writeDirectoryScrollPositions } from '../src/utils/explorerSession.js';

test('folder scroll persists both axes without persisting selections', () => {
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const states = new Map([
        ['/first', { scrollTop: 950, scrollLeft: 123.5, selectedPaths: ['/first/private.txt'], focusedPath: '/first/private.txt' }],
        ['/second', { scrollTop: 400, scrollLeft: 0 }],
    ]);
    writeDirectoryScrollPositions(states);
    assert.deepEqual([...readDirectoryScrollPositions()], [
        ['/first', { scrollTop: 950, scrollLeft: 123.5 }],
        ['/second', { scrollTop: 400, scrollLeft: 0 }],
    ]);
    assert.equal(storage.get(DIRECTORY_SCROLL_KEY).includes('private.txt'), false);
});

test('missing, malformed and invalid saved scroll positions fall back safely', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
        for (const raw of [null, '{', 'null', '{}', '42', '[["/bad",null]]', '[["/bad",{"scrollTop":-1,"scrollLeft":0}]]', '[["/bad",{"scrollTop":"20","scrollLeft":0}]]']) {
            globalThis.localStorage = { getItem: () => raw };
            assert.equal(readDirectoryScrollPositions().size, 0, raw);
        }
        globalThis.localStorage = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('quota'); } };
        assert.equal(readDirectoryScrollPositions().size, 0);
        assert.doesNotThrow(() => writeDirectoryScrollPositions(new Map()));
    } finally {
        console.error = originalError;
    }
});

test('scroll storage retains the 100 most recently visited folders', () => {
    let raw;
    globalThis.localStorage = { getItem: () => raw, setItem: (_, value) => { raw = value; } };
    const states = new Map(Array.from({ length: 125 }, (_, i) => [`/folder-${i}`, { scrollTop: i, scrollLeft: 0 }]));
    states.delete('/folder-0');
    states.set('/folder-0', { scrollTop: 500, scrollLeft: 10 });
    writeDirectoryScrollPositions(states);
    const restored = readDirectoryScrollPositions();
    assert.equal(restored.size, 100);
    assert.equal(restored.has('/folder-1'), false);
    assert.deepEqual(restored.get('/folder-0'), { scrollTop: 500, scrollLeft: 10 });
});
