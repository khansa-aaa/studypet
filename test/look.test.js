const test = require('node:test');
const assert = require('node:assert');
const { lookIndex } = require('../src/look');

const c = { x: 500, y: 500 };

test('cardinal directions map to the Codex look frames', () => {
  assert.strictEqual(lookIndex(c, { x: 500, y: 100 }), 0); // up
  assert.strictEqual(lookIndex(c, { x: 900, y: 500 }), 4); // right (090)
  assert.strictEqual(lookIndex(c, { x: 500, y: 900 }), 8); // down (180)
  assert.strictEqual(lookIndex(c, { x: 100, y: 500 }), 12); // left (270)
});

test('diagonals and wrap-around', () => {
  assert.strictEqual(lookIndex(c, { x: 900, y: 100 }), 2); // up-right (045)
  assert.strictEqual(lookIndex(c, { x: 100, y: 900 }), 10); // down-left (225)
  assert.strictEqual(lookIndex(c, { x: 490, y: 100 }), 0); // just left of up rounds back to 000
});

test('no look when the cursor is on Hoot', () => {
  assert.strictEqual(lookIndex(c, { x: 520, y: 530 }), -1);
});
