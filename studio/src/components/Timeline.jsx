import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, targetOf, draftTarget } from '../store.js';
import { propertyGroups, pathLabel, paramDef, getValue, setValue, toggleStopwatch, addKeyHere, EFFECTS, BLEND_MODES } from '../engine/project.js';
import { keyAt, sortKeys } from '../engine/keyframes.js';
import { setParent, removeEffect, runBeatDetection, pulseOnBeats, snapKeysToBeats, audioToKeys, moveLayer } from '../engine/actions.js';
import { getRT } from '../engine/bridge.js';
import { peaks, decode, bufferOf } from '../engine/audio.js';
import { ScrubNumber, Stopwatch, IconBtn, Select, cx, fmtTime } from './ui.jsx';
import GraphEditor from './GraphEditor.jsx';
import { Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronLeft, Diamond, LineChart, Magnet, Music, Trash2, Power, Link2 } from 'lucide-react';

export const ROW = 22, LEFT = 380, RULER = 26;
const S = () => useStore.getState();

/** Flatten layers → visible rows. */
function buildRows(project, expanded, animOnly) {
  const rows = [];
  const addTarget = (t, idx) => {
    rows.push({ kind: 'layer', id: t.id, idx });
    if (!expanded[t.id]) return;
    for (const g of propertyGroups(t, t.id === 'comp')) {
      const paths = animOnly ? g.paths.filter((p) => t.tracks?.[p]?.length) : g.paths;
      if (!paths.length && (animOnly || !g.fx)) continue;
      rows.push({ kind: 'group', id: t.id, name: g.name, fx: g.fx });
      for (const p of paths) rows.push({ kind: 'prop', id: t.id, path: p });
    }
  };
  const comp = targetOf(project, 'comp');
  if (comp.effects.length || Object.keys(comp.tracks || {}).length) addTarget(comp, 0);
  project.layers.forEach((l, i) => addTarget(l, i + 1));
  return rows;
}

export default function Timeline() {
  const project = useStore((s) => s.project);
  const assets = useStore((s) => s.assets);
  const time = useStore((s) => s.time);
  const sel = useStore((s) => s.sel);
  const ui = useStore((s) => s.ui);
  const [animOnly, setAnimOnly] = useState(false);
  const [marquee, setMarquee] = useState(null);
  const bodyRef = useRef(null), laneRef = useRef(null);
  const [laneW, setLaneW] = useState(800);
  const { pxPerSec: pps, scrollX } = ui;
  const fps = project.fps;
  const rows = useMemo(() => buildRows(project, ui.expanded, animOnly), [project, ui.expanded, animOnly]);
  const xOf = (t) => t * pps - scrollX;
  const tOf = (x) => (x + scrollX) / pps;
  const snapFrame = (t) => Math.round(t * fps) / fps;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setLaneW(e.contentRect.width)); ro.observe(laneRef.current); return () => ro.disconnect();
  }, []);
  // keep playhead visible while playing
  const playing = useStore((s) => s.playing);
  useEffect(() => { if (playing && (xOf(time) > laneW - 40 || xOf(time) < 0)) S().setUi({ scrollX: Math.max(0, time * pps - 40) }); }, [time, playing]); // eslint-disable-line

  const onWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = laneRef.current.getBoundingClientRect(), mx = e.clientX - r.left, tAtMouse = tOf(mx);
      const np = Math.min(2000, Math.max(10, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      S().setUi({ pxPerSec: np, scrollX: Math.max(0, tAtMouse * np - mx) });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      S().setUi({ scrollX: Math.max(0, scrollX + (e.deltaX || e.deltaY)) });
    }
  };
  useEffect(() => { const el = bodyRef.current?.parentElement; if (!el) return; el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel); });

  // ── snapping ──
  const snapT = (t, exclude = new Set()) => {
    t = snapFrame(Math.max(0, t));
    if (!ui.snap) return t;
    const cands = [time, 0, project.duration, ...(ui.beatSnap || project.audio.beats?.length ? project.audio.beats || [] : [])];
    for (const r of rows) if (r.kind === 'prop') for (const k of targetOf(project, r.id)?.tracks?.[r.path] || []) if (!exclude.has(k.id)) cands.push(k.t);
    let best = t, bd = 7 / pps;
    for (const c of cands) if (Math.abs(c - t) < bd) { bd = Math.abs(c - t); best = c; }
    return best;
  };

  // ── scrub ──
  const scrub = (e) => {
    const r = laneRef.current.getBoundingClientRect();
    const go = (ev) => S().setTime(snapFrame(tOf(ev.clientX - r.left)));
    go(e);
    const up = () => { removeEventListener('pointermove', go); removeEventListener('pointerup', up); };
    addEventListener('pointermove', go); addEventListener('pointerup', up);
  };

  // ── key drag ──
  const keyDown = (e, ref) => {
    e.stopPropagation();
    let keys = sel.keys;
    if (e.shiftKey || e.ctrlKey || e.metaKey) keys = keys.includes(ref) ? keys.filter((k) => k !== ref) : [...keys, ref];
    else if (!keys.includes(ref)) keys = [ref];
    const [tid, path] = ref.split('|');
    S().select({ keys, path: { target: tid, path } });
    const P = S().project;
    const orig = new Map(keys.map((r) => { const [a, p, k] = r.split('|'); return [r, targetOf(P, a)?.tracks?.[p]?.find((x) => x.id === k)?.t]; }));
    const anchor = orig.get(ref), x0 = e.clientX, ids = new Set(keys.map((r) => r.split('|')[2]));
    const move = (ev) => {
      if (anchor == null) return;
      const dt = snapT(anchor + (ev.clientX - x0) / pps, ids) - anchor;
      S().mutate((d) => {
        for (const [r, t0] of orig) {
          const [a, p, k] = r.split('|'), ks = draftTarget(d, a)?.tracks?.[p];
          const key = ks?.find((x) => x.id === k); if (key) key.t = +Math.max(0, t0 + dt).toFixed(5);
          if (ks) sortKeys(ks);
        }
      }, { merge: 'keydrag' });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  // ── layer bar drag (move / trim) ──
  const barDown = (e, id, mode) => {
    e.stopPropagation();
    if (!sel.layers.includes(id)) S().select({ layers: [id], keys: [] });
    const l0 = structuredClone(targetOf(S().project, id)), x0 = e.clientX;
    const move = (ev) => {
      const raw = (ev.clientX - x0) / pps;
      S().mutate((d) => {
        const l = draftTarget(d, id);
        if (mode === 'move') {
          const dt = snapT(l0.inPoint + raw) - l0.inPoint;
          l.inPoint = +(l0.inPoint + dt).toFixed(5); l.outPoint = +(l0.outPoint + dt).toFixed(5);
          for (const [p, ks] of Object.entries(l0.tracks)) l.tracks[p] = ks.map((k) => ({ ...k, t: +(k.t + dt).toFixed(5) }));
        } else if (mode === 'in') l.inPoint = Math.min(l0.outPoint - 1 / d.fps, Math.max(0, snapT(l0.inPoint + raw)));
        else l.outPoint = Math.max(l0.inPoint + 1 / d.fps, snapT(l0.outPoint + raw));
      }, { merge: 'bar-' + mode });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  // ── marquee key selection ──
  const laneDown = (e) => {
    if (e.button !== 0) return;
    const r = bodyRef.current.getBoundingClientRect();
    const p0 = { x: e.clientX - r.left - LEFT, y: e.clientY - r.top + bodyRef.current.scrollTop };
    const add = e.shiftKey ? sel.keys : [];
    let moved = false;
    const move = (ev) => {
      const p = { x: ev.clientX - r.left - LEFT, y: ev.clientY - r.top + bodyRef.current.scrollTop };
      if (Math.hypot(p.x - p0.x, p.y - p0.y) > 3) moved = true;
      const rect = { x0: Math.min(p0.x, p.x), x1: Math.max(p0.x, p.x), y0: Math.min(p0.y, p.y), y1: Math.max(p0.y, p.y) };
      setMarquee(rect);
      const hits = [];
      rows.forEach((row, i) => {
        if (row.kind !== 'prop') return;
        const cy = i * ROW + ROW / 2; if (cy < rect.y0 || cy > rect.y1) return;
        for (const k of targetOf(S().project, row.id)?.tracks?.[row.path] || []) { const x = xOf(k.t); if (x >= rect.x0 && x <= rect.x1) hits.push(`${row.id}|${row.path}|${k.id}`); }
      });
      S().select({ keys: [...new Set([...add, ...hits])] });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); setMarquee(null); if (!moved && !e.shiftKey) S().select({ keys: [] }); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const toggle = (id) => S().setUi((u) => ({ expanded: { ...u.expanded, [id]: !u.expanded[id] } }));
  const selectLayer = (e, id) => {
    const cur = sel.layers;
    S().select({ layers: e.shiftKey || e.ctrlKey || e.metaKey ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id] });
  };

  // ruler ticks
  const ticks = [];
  const step = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 30].find((s) => s * pps >= 60) || 30;
  for (let t = Math.floor(tOf(0) / step) * step; t <= Math.min(project.duration, tOf(laneW)); t += step) ticks.push(+t.toFixed(6));

  const audioAsset = assets[project.audio.assetId];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* header */}
      <div className="flex shrink-0 border-b border-line" style={{ height: RULER + 4 }}>
        <div className="flex shrink-0 items-center gap-1 border-r border-line px-2" style={{ width: LEFT }}>
          <span className="num text-[15px] text-acc">{fmtTime(time, fps)}</span>
          <span className="num ml-1 text-mute">{Math.round(time * fps)}f · {fps}fps</span>
          <span className="flex-1" />
          <IconBtn icon={Diamond} title="키가 있는 속성만 보기 (U)" active={animOnly} onClick={() => setAnimOnly(!animOnly)} />
          <IconBtn icon={Magnet} title="스냅 (프레임·플레이헤드·키·비트)" active={ui.snap} onClick={() => S().setUi({ snap: !ui.snap })} />
          <IconBtn icon={LineChart} title="그래프 에디터 (Shift+F3)" active={ui.graph} onClick={() => S().setUi({ graph: !ui.graph })} />
        </div>
        <div ref={laneRef} className="relative min-w-0 flex-1 cursor-ew-resize overflow-hidden" onPointerDown={scrub}>
          {ticks.map((t) => (
            <div key={t} className="absolute top-0 h-full border-l border-line/70 pl-1 text-[10px] text-mute num" style={{ left: xOf(t) }}>
              {step < 1 ? (Math.abs(t - Math.round(t)) < 1e-6 ? `${Math.round(t)}s` : `${Math.round(t * fps) % fps}f`) : `${t}s`}
            </div>
          ))}
          {(project.audio.beats || []).map((b, i) => <div key={i} className="absolute bottom-0 h-1.5 w-px bg-pink-400/70" style={{ left: xOf(b) }} />)}
          <div className="absolute top-0 h-full bg-black/30" style={{ left: xOf(project.duration), right: 0 }} />
          <div className="pointer-events-none absolute top-0 z-10 h-full" style={{ left: xOf(time) - 6 }}>
            <div className="h-3 w-3 rounded-b-sm bg-acc" style={{ marginLeft: 0.5 }} />
          </div>
        </div>
      </div>

      {/* body */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={bodyRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden">
          <div className="relative" style={{ height: Math.max(rows.length * ROW, 40) }}>
            {rows.map((row, i) => (
              <Row key={row.kind + row.id + (row.path || row.name || '')} row={row} i={i} project={project} sel={sel} time={time}
                xOf={xOf} pps={pps} keyDown={keyDown} barDown={barDown} laneDown={laneDown} toggle={toggle} selectLayer={selectLayer} graph={ui.graph} expanded={ui.expanded} />
            ))}
            {!rows.length && <div className="p-4 text-mute">레이어가 없습니다. HTML 파일을 열거나 [레이어] 메뉴에서 추가하세요.</div>}
            {marquee && <div className="pointer-events-none absolute border border-acc bg-acc/10" style={{ left: LEFT + marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }} />}
          </div>
        </div>
        {ui.graph && <div className="absolute bottom-0 right-0 top-0 border-l border-line bg-app" style={{ left: LEFT }}><GraphEditor xOf={xOf} tOf={tOf} snapT={snapT} /></div>}
        <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-acc" style={{ left: LEFT + xOf(time), display: xOf(time) < 0 ? 'none' : undefined }} />
      </div>

      {/* audio track */}
      <AudioRow project={project} asset={audioAsset} xOf={xOf} pps={pps} laneW={laneW} scrollX={scrollX} />
    </div>
  );
}

function Row({ row, i, project, sel, time, xOf, pps, keyDown, barDown, laneDown, toggle, selectLayer, graph, expanded }) {
  const t = targetOf(project, row.id);
  if (!t) return null;
  const style = { top: i * ROW, height: ROW };
  const isSel = sel.layers.includes(row.id);
  const fps = project.fps;

  if (row.kind === 'layer') {
    const isComp = row.id === 'comp';
    const parentOpts = [{ value: '', label: 'None' }, ...project.layers.filter((l) => l.id !== t.id).map((l) => ({ value: l.id, label: `${project.layers.indexOf(l) + 1}. ${l.name}` }))];
    const allKeys = Object.values(t.tracks || {}).flat();
    return (
      <div className={cx('absolute left-0 right-0 flex border-b border-line/60', isSel ? 'bg-sel/60' : 'hover:bg-white/[0.02]')} style={style}>
        <div className="flex shrink-0 items-center gap-1 border-r border-line pr-1" style={{ width: LEFT }} onPointerDown={(e) => !isComp && selectLayer(e, t.id)}>
          <button className="w-4 text-mute" onClick={(e) => { e.stopPropagation(); toggle(t.id); }}><ChevronRight size={13} className={cx('transition-transform', expanded[t.id] && 'rotate-90')} /></button>
          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: isComp ? '#888' : t.label }} />
          <span className="num w-5 text-right text-mute">{isComp ? '' : row.idx}</span>
          {!isComp && <>
            <IconBtn size={13} icon={t.visible === false ? EyeOff : Eye} title="표시" onClick={(e) => { e.stopPropagation(); S().mutate((d) => { const l = draftTarget(d, t.id); l.visible = l.visible === false; }); }} />
            <IconBtn size={13} icon={t.locked ? Lock : Unlock} title="잠금" onClick={(e) => { e.stopPropagation(); S().mutate((d) => { const l = draftTarget(d, t.id); l.locked = !l.locked; }); }} />
          </>}
          <Name t={t} isComp={isComp} />
          {!isComp && <>
            <Link2 size={12} className="shrink-0 text-mute" />
            <span onPointerDown={(e) => e.stopPropagation()}><Select className="w-[92px] text-[11px]" value={t.parent || ''} options={parentOpts} onChange={(v) => setParent(t.id, v, getRT())} /></span>
          </>}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden" onPointerDown={laneDown}>
          {!isComp && !graph && (
            <div className="absolute top-[4px] h-[14px] rounded-sm" onPointerDown={(e) => barDown(e, t.id, 'move')}
              style={{ left: xOf(t.inPoint), width: Math.max(2, (t.outPoint - t.inPoint) * pps), background: t.label + (isSel ? '99' : '55'), outline: isSel ? `1px solid ${t.label}` : 'none' }}>
              <div className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" onPointerDown={(e) => barDown(e, t.id, 'in')} />
              <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" onPointerDown={(e) => barDown(e, t.id, 'out')} />
            </div>
          )}
          {!expanded[t.id] && !graph && allKeys.map((k) => <div key={k.id} className="pointer-events-none absolute top-[9px] h-1 w-1 rounded-full bg-key/70" style={{ left: xOf(k.t) - 2 }} />)}
        </div>
      </div>
    );
  }

  if (row.kind === 'group') {
    const fx = row.fx && t.effects.find((e) => e.id === row.fx);
    return (
      <div className="absolute left-0 right-0 flex border-b border-line/40" style={style}>
        <div className="flex shrink-0 items-center gap-1 border-r border-line pl-9 pr-1 text-[11px] font-semibold text-mute" style={{ width: LEFT }}>
          {fx && <IconBtn size={12} icon={Power} active={fx.enabled} title="이펙트 켜기/끄기" onClick={() => S().mutate((d) => { const e = draftTarget(d, t.id).effects.find((e) => e.id === fx.id); e.enabled = !e.enabled; })} />}
          <span className="flex-1 truncate">{row.name}</span>
          {fx && <IconBtn size={12} icon={Trash2} title="이펙트 삭제" onClick={() => removeEffect(t.id, fx.id)} />}
        </div>
        <div className="flex-1" onPointerDown={laneDown} />
      </div>
    );
  }

  // property row
  const keys = t.tracks?.[row.path] || [];
  const animated = keys.length > 0;
  const def = paramDef(t, row.path) || {};
  const v = getValue(t, row.path, time);
  const isPathSel = sel.path?.target === row.id && sel.path?.path === row.path;
  const set = (val) => S().mutate((d) => setValue(draftTarget(d, t.id), row.path, val, S().time, d.fps), { merge: 'tl-' + t.id + row.path });
  const prev = [...keys].reverse().find((k) => k.t < time - 0.5 / fps), next = keys.find((k) => k.t > time + 0.5 / fps), here = keyAt(keys, time, fps);
  const loop = t.loops?.[row.path];
  return (
    <div className={cx('absolute left-0 right-0 flex border-b border-line/30', isPathSel && 'bg-white/[0.04]')} style={style}>
      <div className="flex shrink-0 items-center gap-1 border-r border-line pl-11 pr-1" style={{ width: LEFT }} onPointerDown={() => S().select({ path: { target: row.id, path: row.path } })}>
        {!row.path.startsWith('css.') ? <Stopwatch on={animated} onClick={() => S().mutate((d) => toggleStopwatch(draftTarget(d, t.id), row.path, S().time, d.fps), { structure: true })} /> : <span className="w-[17px]" />}
        <span className={cx('min-w-0 flex-1 truncate', isPathSel ? 'text-fg' : 'text-mute')} title={pathLabel(t, row.path)}>{row.path.startsWith('fx.') ? def.label : pathLabel(t, row.path)}</span>
        {loop && <span className="rounded bg-white/10 px-1 text-[10px] text-mute" title="loopOut">{loop === 'cycle' ? '⟳' : '⇄'}</span>}
        {typeof v === 'number'
          ? <ScrubNumber value={v} step={def.step ?? 1} min={def.min} max={def.max} unit={def.unit || ''} animated={animated} onChange={set} />
          : <span className="num max-w-[110px] truncate text-[11px] text-key" title={String(v)}>{String(v ?? '')}</span>}
        <div className="flex items-center">
          <button disabled={!prev} className="text-mute disabled:opacity-20" onClick={() => S().setTime(prev.t)}><ChevronLeft size={12} /></button>
          <button className={cx(here ? 'text-key' : 'text-mute')} title="현재 시간에 키 추가/삭제" onClick={() => S().mutate((d) => addKeyHere(draftTarget(d, t.id), row.path, S().time, d.fps), { structure: true })}><Diamond size={10} fill={here ? 'currentColor' : 'none'} /></button>
          <button disabled={!next} className="text-mute disabled:opacity-20" onClick={() => S().setTime(next.t)}><ChevronRight size={12} /></button>
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden" onPointerDown={laneDown}>
        {!graph && keys.map((k, j) => {
          const ref = `${row.id}|${row.path}|${k.id}`, on = sel.keys.includes(ref);
          const lin = !k.hold && (!k.ease || (k.ease[0] === 0 && k.ease[1] === 0 && k.ease[2] === 1 && k.ease[3] === 1));
          return (
            <div key={k.id} onPointerDown={(e) => keyDown(e, ref)} onDoubleClick={() => S().setTime(k.t)} title={`${k.t.toFixed(3)}s · ${typeof k.v === 'number' ? +k.v.toFixed(3) : k.v}`}
              className={cx('absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 cursor-pointer border',
                k.hold ? 'rounded-none' : lin ? 'rotate-45' : 'rotate-45 rounded-[3px]',
                on ? 'border-white bg-acc' : 'border-black/60 bg-key')}
              style={{ left: xOf(k.t) }} />
          );
        })}
        {!graph && keys.length > 1 && <div className="pointer-events-none absolute top-1/2 h-px bg-key/25" style={{ left: xOf(keys[0].t), width: (keys[keys.length - 1].t - keys[0].t) * pps }} />}
      </div>
    </div>
  );
}

function Name({ t, isComp }) {
  const [edit, setEdit] = useState(false);
  if (edit && !isComp)
    return <input autoFocus defaultValue={t.name} className="min-w-0 flex-1 rounded bg-app px-1 outline outline-1 outline-acc"
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEdit(false); }}
      onBlur={(e) => { const v = e.target.value.trim(); if (v) S().mutate((d) => { draftTarget(d, t.id).name = v; }); setEdit(false); }} />;
  return <span className="min-w-0 flex-1 truncate" title={t.selector || t.name} onDoubleClick={() => setEdit(true)}>{isComp ? 'Composition (Adjustment)' : t.name}</span>;
}

function AudioRow({ project, asset, xOf, pps, laneW, scrollX }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(0);
  const au = project.audio;
  useEffect(() => { if (asset && !bufferOf(asset.id)) decode(asset).then(() => setReady((r) => r + 1)).catch(() => {}); }, [asset]);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = devicePixelRatio || 1, w = laneW, h = 44;
    c.width = w * dpr; c.height = h * dpr; c.style.width = w + 'px'; c.style.height = h + 'px';
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const buf = asset && bufferOf(asset.id);
    if (buf) {
      const x0 = xOf(au.offset || 0), bw = buf.duration * pps, n = Math.max(1, Math.floor(bw));
      const pk = peaks(buf, Math.min(n, 20000));
      g.fillStyle = '#3fb98a';
      for (let i = 0; i < pk.length / 2; i++) {
        const x = x0 + (i / (pk.length / 2)) * bw; if (x < -2 || x > w) continue;
        const lo = pk[i * 2], hi = pk[i * 2 + 1];
        g.fillRect(x, h / 2 - hi * (h / 2 - 2), Math.max(1, bw / (pk.length / 2)), Math.max(1, (hi - lo) * (h / 2 - 2)));
      }
    }
    g.fillStyle = '#ff6fb5';
    for (const b of au.beats || []) { const x = xOf(b); if (x >= 0 && x <= w) g.fillRect(x, 0, 1, h); }
  }, [asset, ready, pps, scrollX, laneW, au.offset, au.beats]); // eslint-disable-line

  const dragOffset = (e) => {
    const x0 = e.clientX, o0 = au.offset || 0;
    const move = (ev) => S().mutate((d) => { d.audio.offset = +(o0 + (ev.clientX - x0) / pps).toFixed(3); }, { merge: 'audio-offset' });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return (
    <div className="flex h-[46px] shrink-0 border-t border-line bg-panel2/50">
      <div className="flex shrink-0 flex-col justify-center gap-0.5 border-r border-line px-2" style={{ width: LEFT }}>
        <div className="flex items-center gap-1.5">
          <Music size={13} className="text-emerald-400" />
          <span className="min-w-0 flex-1 truncate">{asset ? asset.name : <span className="text-mute">오디오 없음 — Project 패널에서 오디오를 추가하세요</span>}</span>
          {asset && <>vol <ScrubNumber value={au.volume ?? 1} step={0.01} min={0} max={2} onChange={(v) => S().mutate((d) => { d.audio.volume = v; }, { merge: 'vol' })} /></>}
        </div>
        {asset && <div className="flex items-center gap-1 text-[11px]">
          <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" onClick={runBeatDetection}>비트 감지</button>
          {au.bpm ? <span className="num text-mute">{au.bpm}BPM · {au.beats.length}</span> : null}
          <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택 레이어에 비트마다 스케일 펄스" onClick={() => pulseOnBeats('scale', 12)}>펄스</button>
          <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택 키프레임을 가장 가까운 비트로" onClick={snapKeysToBeats}>키→비트</button>
          <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택한 속성을 오디오 진폭으로 키프레임화" onClick={() => { const r = prompt('진폭 0 → 값, 진폭 1 → 값 (예: 100,140)', '100,140'); if (r) { const [a, b] = r.split(',').map(Number); audioToKeys(a, b); } }}>오디오→키</button>
        </div>}
      </div>
      <div className="relative min-w-0 flex-1 cursor-grab overflow-hidden" onPointerDown={asset ? dragOffset : undefined} title="드래그해서 오디오 시작점 이동">
        <canvas ref={ref} className="absolute left-0 top-0" />
      </div>
    </div>
  );
}
