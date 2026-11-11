import test from 'node:test';
import assert from 'node:assert/strict';
import { cubicBezier } from './bezier.js';
import { valueAt, upsertKey } from './keyframes.js';

test('bezier endpoints & linear', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1);
  assert.equal(f(0), 0); assert.equal(f(1), 1);
  assert.ok(Math.abs(f(0.5) - 0.5) < 1e-5);
  assert.ok(Math.abs(cubicBezier(0, 0, 1, 1)(0.3) - 0.3) < 1e-9);
  assert.ok(cubicBezier(0.42, 0, 1, 1)(0.25) < 0.25); // ease-in is slow at start
});
test('overshoot ease exceeds 1', () => {
  const f = cubicBezier(0.34, 1.56, 0.64, 1);
  assert.ok(Math.max(...Array.from({ length: 99 }, (_, i) => f(i / 100))) > 1);
});
test('valueAt clamps, interpolates, holds', () => {
  const keys = [];
  upsertKey(keys, 1, 100, 30, [0, 0, 1, 1]);
  upsertKey(keys, 0, 0, 30, [0, 0, 1, 1]);
  assert.equal(valueAt(keys, -1, 5), 0);
  assert.equal(valueAt(keys, 2, 5), 100);
  assert.ok(Math.abs(valueAt(keys, 0.5, 5) - 50) < 1e-6);
  keys[0].hold = true;
  assert.equal(valueAt(keys, 0.9, 5), 0);
  assert.equal(valueAt([], 0.5, 7), 7);
  upsertKey(keys, 1.001, 200); assert.equal(keys.length, 2); assert.equal(keys[1].v, 200);
});
