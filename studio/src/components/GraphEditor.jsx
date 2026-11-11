import { useEffect, useRef, useState } from 'react';
import { useStore, targetOf, draftTarget } from '../store.js';
import { pathLabel } from '../engine/project.js';
import { valueAt, sortKeys } from '../engine/keyframes.js';
import { EASE_PRESETS } from '../engine/bezier.js';
import { setEaseSelected } from '../engine/actions.js';
import { cx } from './ui.jsx';

const S = () => useStore.getState();
const PRESET_BTNS = [
  ['Linear', EASE_PRESETS.linear], ['Easy Ease', EASE_PRESETS.easyEase], ['Ease In', EASE_PRESETS.easeIn], ['Ease Out', EASE_PRESETS.easeOut],
  ['Expo Out', EASE_PRESETS.expoOut], ['Back Out', EASE_PRESETS.backOut], ['Anticipate', EASE_PRESETS.anticipate],
];

/** Value graph of the selected property with draggable keys and bezier handles (AE Graph Editor). */
export default function GraphEditor({ xOf, tOf, snapT }) {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.sel);
  const time = useStore((s) => s.time);
  const boxRef = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 200 });
  useEffect(() => { const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(boxRef.current); return () => ro.disconnect(); }, []);

  const p = sel.path, tgt = p && targetOf(project, p.target), keys = tgt?.tracks?.[p.path] || [];
  const numeric = keys.length > 0 && keys.every((k) => typeof k.v === 'number');
  const loop = tgt?.loops?.[p?.path];

  // y range from the real curve (includes overshoot)
  const { w, h } = size, PAD = 24;
  let lo = Infinity, hi = -Infinity;
  if (numeric) {
    const t0 = keys[0].t, t1 = keys[keys.length - 1].t;
    for (let i = 0; i <= 200; i++) { const v = valueAt(keys, t0 + ((t1 - t0) * i) / 200); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const k of keys) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
  }
  if (!(hi > lo)) { lo = (lo === Infinity ? 0 : lo) - 1; hi = lo + 2; }
  const span = hi - lo; lo -= span * 0.12; hi += span * 0.12;
  const yOf = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (h - PAD * 2);
  const vOf = (y) => lo + (1 - (y - PAD) / (h - PAD * 2)) * (hi - lo);

  const refOf = (k) => `${p.target}|${p.path}|${k.id}`;
  const local = (e) => { const r = boxRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const dragKey = (e, k) => {
    e.stopPropagation();
    const ref = refOf(k);
    let keysSel = sel.keys.includes(ref) ? sel.keys : e.shiftKey ? [...sel.keys, ref] : [ref];
    S().select({ keys: keysSel });
    const P = S().project, t0 = targetOf(P, p.target).tracks[p.path];
    const orig = new Map(t0.filter((x) => keysSel.includes(refOf(x))).map((x) => [x.id, { t: x.t, v: x.v }]));
    const m0 = local(e), ids = new Set(orig.keys());
    const move = (ev) => {
      const m = local(ev); let dx = m.x - m0.x, dy = m.y - m0.y;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const a = orig.get(k.id), dt = snapT(tOf(xOf(a.t) + dx), ids) - a.t, dv = vOf(yOf(a.v) + dy) - a.v;
      S().mutate((d) => {
        const ks = draftTarget(d, p.target).tracks[p.path];
        for (const x of ks) { const o = orig.get(x.id); if (o) { x.t = +Math.max(0, o.t + dt).toFixed(5); x.v = +(o.v + dv).toFixed(4); } }
        sortKeys(ks);
      }, { merge: 'graph-key' });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /** Drag the out-handle (which=0 → x1,y1) or in-handle (which=1 → x2,y2) of segment a→b. */
  const dragHandle = (e, i, which) => {
    e.stopPropagation();
    const move = (ev) => {
      const m = local(ev);
      S().mutate((d) => {
        const ks = draftTarget(d, p.target).tracks[p.path], a = ks[i], b = ks[i + 1]; if (!a || !b) return;
        const dt = b.t - a.t || 1e-6, dv = b.v - a.v;
        const hx = Math.min(1, Math.max(0, (tOf(m.x) - a.t) / dt));
        const hy = Math.abs(dv) < 1e-9 ? (which ? 1 : 0) : (vOf(m.y) - a.v) / dv;
        a.ease = [...(a.ease || [0, 0, 1, 1])];
        if (which === 0) { a.ease[0] = +hx.toFixed(4); a.ease[1] = +hy.toFixed(4); } else { a.ease[2] = +hx.toFixed(4); a.ease[3] = +hy.toFixed(4); }
        delete a.hold;
      }, { merge: 'graph-handle' });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  // curve path
  let path = '';
  if (numeric) {
    const tStart = Math.max(0, tOf(0)), tEnd = tOf(w);
    for (let x = Math.max(0, xOf(tStart)); x <= w; x += 2) { const v = valueAt(keys, tOf(x), loop); path += (path ? 'L' : 'M') + x.toFixed(1) + ',' + yOf(v).toFixed(1); }
    void tEnd;
  }
  const gridVals = [];
  if (numeric) { const st = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) gridVals.push(+v.toFixed(6)); }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px]">
        <span className="mr-2 truncate text-fg">{p && tgt ? `${tgt.name} › ${pathLabel(tgt, p.path)}` : '타임라인 왼쪽에서 속성을 선택하세요'}</span>
        <span className="flex-1" />
        {PRESET_BTNS.map(([n, e]) => <button key={n} className="rounded bg-white/5 px-1.5 py-0.5 hover:bg-white/10" onClick={() => setEaseSelected(e)}>{n}</button>)}
        <button className="rounded bg-white/5 px-1.5 py-0.5 hover:bg-white/10" onClick={() => setEaseSelected([0, 0, 1, 1], true)}>Hold</button>
        {tgt && keys.length > 1 && <select className="rounded border border-line bg-app px-1" value={loop || ''} title="loopOut"
          onChange={(e) => S().mutate((d) => { const t = draftTarget(d, p.target); t.loops ||= {}; if (e.target.value) t.loops[p.path] = e.target.value; else delete t.loops[p.path]; })}>
          <option value="">No loop</option><option value="cycle">loopOut(cycle)</option><option value="pingpong">loopOut(pingpong)</option>
        </select>}
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden" onPointerDown={() => S().select({ keys: [] })}>
        <svg width={w} height={h} className="absolute inset-0">
          {gridVals.map((v) => <g key={v}><line x1="0" x2={w} y1={yOf(v)} y2={yOf(v)} stroke="#ffffff0d" /><text x="4" y={yOf(v) - 2} fill="#8b90a1" fontSize="10" className="num">{v}</text></g>)}
          <line x1={xOf(time)} x2={xOf(time)} y1="0" y2={h} stroke="#4f9dff55" />
          {!numeric && <text x="16" y="28" fill="#8b90a1" fontSize="12">{keys.length ? '이 속성은 숫자가 아니어서 그래프로 표시할 수 없습니다.' : '키프레임이 있는 속성을 선택하세요.'}</text>}
          {numeric && <path d={path} fill="none" stroke="#f2c94c" strokeWidth="1.6" />}
          {numeric && keys.map((a, i) => {
            const b = keys[i + 1]; if (!b || a.hold) return null;
            const show = sel.keys.includes(refOf(a)) || sel.keys.includes(refOf(b)) || keys.length <= 6;
            if (!show) return null;
            const e = a.ease || [0, 0, 1, 1], dt = b.t - a.t, dv = b.v - a.v;
            const h1 = { x: xOf(a.t + e[0] * dt), y: yOf(a.v + e[1] * dv) }, h2 = { x: xOf(a.t + e[2] * dt), y: yOf(a.v + e[3] * dv) };
            return (
              <g key={'h' + a.id}>
                <line x1={xOf(a.t)} y1={yOf(a.v)} x2={h1.x} y2={h1.y} stroke="#4f9dff" />
                <line x1={xOf(b.t)} y1={yOf(b.v)} x2={h2.x} y2={h2.y} stroke="#4f9dff" />
                <circle cx={h1.x} cy={h1.y} r="4.5" fill="#16171c" stroke="#4f9dff" className="cursor-move" onPointerDown={(ev) => dragHandle(ev, i, 0)} />
                <circle cx={h2.x} cy={h2.y} r="4.5" fill="#16171c" stroke="#4f9dff" className="cursor-move" onPointerDown={(ev) => dragHandle(ev, i, 1)} />
              </g>
            );
          })}
          {numeric && keys.map((k) => {
            const on = sel.keys.includes(refOf(k));
            return <rect key={k.id} x={xOf(k.t) - 4.5} y={yOf(k.v) - 4.5} width="9" height="9" transform={`rotate(45 ${xOf(k.t)} ${yOf(k.v)})`}
              className={cx('cursor-pointer')} fill={on ? '#4f9dff' : '#f2c94c'} stroke={on ? '#fff' : '#000a'} onPointerDown={(e) => dragKey(e, k)}>
              <title>{`${k.t.toFixed(3)}s = ${+k.v.toFixed(3)}`}</title></rect>;
          })}
        </svg>
      </div>
    </div>
  );
}
