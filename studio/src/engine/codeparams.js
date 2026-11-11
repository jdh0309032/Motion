// Code parameters: literal values in a JS module's top-level `export const` / `const` declarations,
// with exact source ranges so the editor can rewrite just that literal (everything else untouched).
import { parse } from 'acorn';

const TIME_KEY = /^(t|time|times|at|start|end|in|out|delay|appear|shatter|drop|burst|hit|hits|kick|kicks|snare|snares|beat|beats|cue|cues|marker|markers|scene|scenes|zoomstart|converge|logo|chime|begin|until|from|to|onset|onsets|cut|cuts)$/i;
const TIME_CONST = /^(T|TIMES?|TIMING|SCENES?|CUES?|MARKERS?|EVENTS?|HITS|KICKS|SNARES|BEATS?|KEYS|CUTS)$/;
const META = { DURATION: 'duration', FPS: 'fps', WIDTH: 'width', HEIGHT: 'height' };

function node2param(n, src, path, name) {
  const base = { path, name, start: n.start, end: n.end, raw: src.slice(n.start, n.end) };
  if (n.type === 'Literal' && typeof n.value === 'number') return { ...base, kind: 'number', value: n.value };
  if (n.type === 'Literal' && typeof n.value === 'string') return { ...base, kind: 'string', value: n.value, quote: base.raw[0] };
  if (n.type === 'Literal' && typeof n.value === 'boolean') return { ...base, kind: 'bool', value: n.value };
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return { ...base, kind: 'number', value: -n.argument.value };
  if (n.type === 'TemplateLiteral' && !n.expressions.length) return { ...base, kind: 'string', value: n.quasis[0].value.cooked, quote: '`' };
  if (n.type === 'ArrayExpression') {
    const children = n.elements.map((e, i) => (e && e.type !== 'SpreadElement' ? node2param(e, src, [...path, i], String(i)) : { ...base, kind: 'computed', path: [...path, i], name: String(i) }));
    return { ...base, kind: 'array', children };
  }
  if (n.type === 'ObjectExpression') {
    const children = [];
    for (const p of n.properties) {
      if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method) continue;
      const key = p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
      children.push(node2param(p.value, src, [...path, key], key));
    }
    return { ...base, kind: 'object', children };
  }
  return { ...base, kind: 'computed' };
}

const cache = new Map();
/** → { params: [{name, exported, ...tree}], error } (memoised by text) */
export function parseParams(text) {
  if (cache.has(text)) return cache.get(text);
  let out;
  try {
    const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
    const params = [];
    for (const st of ast.body) {
      const decl = st.type === 'ExportNamedDeclaration' ? st.declaration : st.type === 'VariableDeclaration' ? st : null;
      if (!decl || decl.type !== 'VariableDeclaration') continue;
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier' || !d.init) continue;
        const p = node2param(d.init, text, [d.id.name], d.id.name);
        if (p.kind === 'computed' && !/^(ArrayExpression|ObjectExpression)$/.test(d.init.type)) { if (st.type !== 'ExportNamedDeclaration') continue; }
        params.push({ ...p, exported: st.type === 'ExportNamedDeclaration', decl: decl.kind });
      }
    }
    out = { params, error: null };
  } catch (e) { out = { params: [], error: e.message }; }
  if (cache.size > 200) cache.clear();
  cache.set(text, out);
  return out;
}

const fmtNum = (v) => String(+(+v).toFixed(4));
function fmtStr(v, q) {
  if (q === '`') return '`' + String(v).replace(/[`\\$]/g, (m) => '\\' + m) + '`';
  const j = JSON.stringify(String(v));
  return q === "'" ? "'" + j.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'" : j;
}
/** Replace one literal (leaf) in the source. */
export function setParam(text, leaf, value) {
  const lit = leaf.kind === 'number' ? fmtNum(value) : leaf.kind === 'string' ? fmtStr(value, leaf.quote) : leaf.kind === 'bool' ? String(!!value) : null;
  if (lit == null) return text;
  return text.slice(0, leaf.start) + lit + text.slice(leaf.end);
}
/** Apply several leaf edits at once (ranges from the same parse). */
export function setParams(text, edits) {
  for (const { leaf, value } of [...edits].sort((a, b) => b.leaf.start - a.leaf.start)) text = setParam(text, leaf, value);
  return text;
}
/** Find a leaf by its path in a fresh parse of text. */
export function findLeaf(text, path) {
  let list = parseParams(text).params, node = null;
  for (let i = 0; i < path.length; i++) {
    node = (i === 0 ? list : node?.children || []).find((p) => p.name === String(path[i]));
    if (!node) return null;
  }
  return node;
}

export const isTimeLike = (p, duration = 600) => {
  if (p.kind !== 'number' || p.value < 0 || p.value > duration * 1.5) return false;
  const names = p.path.map(String);
  return TIME_CONST.test(names[0]) || names.slice(1).some((n) => TIME_KEY.test(n));
};
/** [a, b] time pairs under a time-ish name → shown as bars. */
export const isTimeSpan = (p, duration) => p.kind === 'array' && p.children.length === 2 && p.children.every((c) => c.kind === 'number' && c.value >= 0 && c.value <= duration * 1.5) && p.children[0].value <= p.children[1].value && (TIME_CONST.test(String(p.path[0])) || TIME_KEY.test(String(p.path[p.path.length - 1])));

/** Composition settings declared in code (DURATION/FPS/WIDTH/HEIGHT). */
export function compMeta(text) {
  const m = {};
  for (const p of parseParams(text).params) if (META[p.name] && p.kind === 'number') m[META[p.name]] = p.value;
  return m;
}
export const hasParams = (text) => parseParams(text).params.some((p) => p.exported && p.kind !== 'computed');
