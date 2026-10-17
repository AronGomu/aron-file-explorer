import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowSelection } from '../src/utils/fileSelection.js';

for (const columns of [1, 3]) {
  test(`Shift+Arrow expands, shrinks and crosses fixed anchor (${columns} columns)`, () => {
    const move = (current, anchor, key) => arrowSelection({ current, anchor, key, columns, count: 8 });
    assert.deepEqual(move(3, 3, 'ArrowRight'), { index: 4, anchor: 3, start: 3, end: 4 });
    assert.deepEqual(move(4, 3, 'ArrowLeft'), { index: 3, anchor: 3, start: 3, end: 3 });
    assert.deepEqual(move(3, 3, 'ArrowLeft'), { index: 2, anchor: 3, start: 2, end: 3 });
    assert.equal(move(3, 3, 'ArrowDown').index, 3 + columns);
    assert.equal(move(3, 3, 'ArrowUp').index, 3 - columns);
  });
}
test('arrows stop at boundaries; missing focus starts at first item', () => {
  const move = (current, key, anchor = -1) => arrowSelection({ current, anchor, key, columns: 3, count: 5 });
  assert.equal(move(0, 'ArrowUp').index, 0);
  assert.equal(move(4, 'ArrowDown').index, 4);
  assert.deepEqual(move(-1, 'ArrowDown'), { index: 0, anchor: 0, start: 0, end: 0 });
  assert.deepEqual(move(2, 'ArrowRight'), { index: 3, anchor: 2, start: 2, end: 3 });
});
