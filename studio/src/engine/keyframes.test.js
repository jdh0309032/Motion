import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { cubicBezier } from './bezier.js';
import { valueAt, upsertKey, lerpValue } from './keyframes.js';

test('bezier endpoints & shapes', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1);
  assert.equal(f(0), 0); assert.equal(f(1), 1);
  assert.ok(Math.abs(f(0.5) - 0.5) < 1e-5);
  assert.ok(cubicBezier(0.42, 0, 1, 1)(0.25) < 0.25);
  const back = cubicBezier(0.34, 1.56, 0.64, 1);
  assert.ok(Math.max(...Array.from({ length: 99 }, (_, i) => back(i / 100))) > 1);
});

test('valueAt clamps, interpolates, holds, loops', () => {
  const keys = [];
  upsertKey(keys, 1, 100, 30, [0, 0, 1, 1]);
  upsertKey(keys, 0, 0, 30, [0, 0, 1, 1]);
  assert.equal(valueAt(keys, -1), 0);
  assert.equal(valueAt(keys, 2), 100);
  assert.ok(Math.abs(valueAt(keys, 0.5) - 50) < 1e-6);
  assert.ok(Math.abs(valueAt(keys, 1.25, 'cycle') - 25) < 1e-6);
  assert.ok(Math.abs(valueAt(keys, 1.25, 'pingpong') - 75) < 1e-6);
  keys[0].hold = true;
  assert.equal(valueAt(keys, 0.9), 0);
  upsertKey(keys, 1.001, 200); assert.equal(keys.length, 2); assert.equal(keys[1].v, 200);
});

test('string / color interpolation', () => {
  assert.equal(lerpValue('rgb(0, 0, 0)', 'rgb(255, 100, 50)', 0.5), 'rgb(128, 50, 25)');
  assert.equal(lerpValue('10px', '20px', 0.5), '15px');
  assert.equal(lerpValue('none', 'block', 0.5), 'none');
});

test('editor valueAt is identical to the runtime valueAt', () => {
  const src = fs.readFileSync(new URL('../runtime/motion-runtime.js', import.meta.url), 'utf8');
  const fake = { requestAnimationFrame() {}, performance: { now: () => 0 }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, document: {}, location: { search: '' }, history: {}, addEventListener() {} };
  fake.window = fake;
  vm.runInNewContext(src.replace(/\}\)\(window\);\s*$/, '})(this.window);'), { window: fake, Date, Math: Object.create(Math), Map, Set, Promise, DOMMatrix: class {}, DOMPoint: class {} });
  const rt = fake.MotionRuntime.valueAt;
  const keys = [{ t: 0, v: 3, ease: [0.2, 0.8, 0.2, 1] }, { t: 0.7, v: -40, ease: [0.68, -0.6, 0.32, 1.6] }, { t: 1.9, v: 12, hold: true, ease: [0, 0, 1, 1] }, { t: 2.5, v: 90 }];
  for (const loop of [undefined, 'cycle', 'pingpong'])
    for (let t = -0.5; t < 7; t += 0.037) assert.equal(rt(keys, t, loop), valueAt(keys, t, loop));
});
