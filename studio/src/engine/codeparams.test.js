import test from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, setParam, findLeaf, isTimeLike, isTimeSpan, compMeta } from './codeparams.js';

const SRC = `// header
export const DURATION = 15;
export const BEAT = 60 / 120;
export const SCENES = { spark: [0, 3], expand: [3, 7] };
export const T = { burst: 2.85, drop: 7.0, neg: -1.5 };
export const KEYWORDS = [{ text: '우주 도시', appear: 3.0, y: 2.35 }, { text: "it's", appear: 4.25, y: 0.05 }];
export const KICKS = [...range(3, 6, 0.5)];
const FOV = 50;
export function f() { return 1; }
`;

test('extracts literal params with ranges', () => {
  const { params, error } = parseParams(SRC);
  assert.equal(error, null);
  const names = params.map((p) => p.name);
  assert.deepEqual(names, ['DURATION', 'BEAT', 'SCENES', 'T', 'KEYWORDS', 'KICKS', 'FOV']);
  assert.equal(params.find((p) => p.name === 'BEAT').kind, 'computed');
  assert.equal(findLeaf(SRC, ['T', 'neg']).value, -1.5);
  assert.equal(findLeaf(SRC, ['KEYWORDS', 1, 'text']).value, "it's");
  assert.equal(compMeta(SRC).duration, 15);
});

test('rewrites only the literal', () => {
  let s = setParam(SRC, findLeaf(SRC, ['T', 'drop']), 6.5);
  assert.ok(s.includes('drop: 6.5,'));
  s = setParam(s, findLeaf(s, ['KEYWORDS', 0, 'text']), '새 "문구"');
  assert.ok(s.includes(`text: '새 "문구"'`));
  s = setParam(s, findLeaf(s, ['KEYWORDS', 1, 'text']), "it's ok");
  assert.equal(findLeaf(s, ['KEYWORDS', 1, 'text']).value, "it's ok");
  s = setParam(s, findLeaf(s, ['SCENES', 'spark', 1]), 3.25);
  assert.equal(findLeaf(s, ['SCENES', 'spark', 1]).value, 3.25);
  assert.equal(s.replace(/6\.5|3\.25|새 "문구"|it's ok|it\\'s ok/g, '').length > 0, true);
  assert.equal(parseParams(s).error, null);
});

test('time heuristics', () => {
  assert.ok(isTimeLike(findLeaf(SRC, ['T', 'burst']), 15));
  assert.ok(isTimeLike(findLeaf(SRC, ['KEYWORDS', 0, 'appear']), 15));
  assert.ok(!isTimeLike(findLeaf(SRC, ['KEYWORDS', 0, 'y']), 15));
  assert.ok(isTimeSpan(findLeaf(SRC, ['SCENES', 'spark']), 15));
});
