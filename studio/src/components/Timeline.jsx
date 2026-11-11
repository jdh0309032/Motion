import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, targetOf, draftTarget, fileText } from '../store.js';
import { propertyGroups, pathLabel, paramDef, getValue, setValue, toggleStopwatch, addKeyHere, EFFECTS, BLEND_MODES } from '../engine/project.js';
import { keyAt, sortKeys } from '../engine/keyframes.js';
import { setParent, removeEffect, runBeatDetection, pulseOnBeats, snapKeysToBeats, audioToKeys, moveLayer, setCodeParam, audioKey, activeAudio } from '../engine/actions.js';
import { parseParams, isTimeLike, isTimeSpan } from '../engine/codeparams.js';
import { onRT } from '../engine/bridge.js';
import * as WS from '../engine/workspace.js';
import { getRT } from '../engine/bridge.js';
import { peaks, decode, bufferOf } from '../engine/audio.js';
import { ScrubNumber, Stopwatch, IconBtn, Select, cx, fmtTime } from './ui.jsx';
import GraphEditor from './GraphEditor.jsx';
import { Eye, EyeOff, Lock, Unlock, ChevronRight, ChevronLeft, Diamond, LineChart, Magnet, Music, Trash2, Power, Link2, Braces, Cpu, VolumeX } from 'lucide-react';

export const ROW = 22, LEFT = 380, RULER = 26;
const S = () => useStore.getState();

/** Flatten layers → visible rows. */
/** Code layer → parameter rows (tree, depth ≤ 3). evals: evaluated exports for computed values. */
function codeRows(t, text, evals, expanded, duration) {
  const out = [];
  const { params, error } = parseParams(text || '');
  if (error) { out.push({ kind: 'param', id: t.id, error }); return out; }
  const walk = (p, depth, label) => {
    const key = t.id + ':' + p.path.join('.');
    const numArr = p.kind === 'array' && p.children.length && p.children.every((c) => c.kind === 'number');
    if (p.kind === 'computed') {
      const ev = p.path.reduce((o, k) => (o == null ? o : o[k]), evals);
      if (Array.isArray(ev) && ev.length && ev.every((v) => typeof v === 'number')) out.push({ kind: 'param', id: t.id, p, depth, label, computed: ev, time: ev.every((v) => v >= 0 && v <= duration * 1.5) });
      else if (typeof ev === 'number' || typeof ev === 'string') out.push({ kind: 'param', id: t.id, p, depth, label, computed: ev });
      return;
    }
    const group = p.kind === 'object' || p.kind === 'array';
    out.push({ kind: 'param', id: t.id, p, depth, label, key, group });
    if (group && (expanded[key] ?? depth < 1) && !(numArr && p.children.length > 6) && !isTimeSpan(p, duration) && depth < 3) {
      for (const c of p.children) {
        const first = c.kind === 'object' && c.children.find((x) => x.kind === 'string');
        walk(c, depth + 1, p.kind === 'array' ? `[${c.name}]${first ? ' ' + first.value : ''}` : c.name);
      }
    }
  };
  for (const p of params) walk(p, 0, p.name);
  return out;
}

function buildRows(project, expanded, animOnly, files, evals) {
  const rows = [];
  const addTarget = (t, idx) => {
    rows.push({ kind: 'layer', id: t.id, idx });
    if (!expanded[t.id]) return;
    if (t.type === 'code') { rows.push(...codeRows(t, files(t.content.file), evals[t.content.file] || {}, expanded, project.duration)); return; }
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
  const fileCache = useStore((s) => s.fileCache);
  const evals = useEvaluated(project);
  const rows = useMemo(() => buildRows(project, ui.expanded, animOnly, (f) => project.files?.[f] ?? fileCache[f], evals), [project, ui.expanded, animOnly, fileCache, evals]);
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
              <Row key={row.kind + row.id + (row.path || row.name || (row.p ? row.p.path.join('.') : '') || row.error || '')} row={row} i={i} project={project} sel={sel} time={time}
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
      <AudioRow project={project} />
    </div>
  );
}

function Row(props) {
  const { row, i, project, sel, time, xOf, pps, keyDown, barDown, laneDown, toggle, selectLayer, graph, expanded } = props;
  const t = targetOf(project, row.id);
  if (!t) return null;
  const style = { top: i * ROW, height: ROW };
  if (row.kind === 'param') return <ParamRow {...props} t={t} style={style} />;
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
          {t.type === 'code' && <Braces size={12} className="shrink-0 text-violet-300" />}
          {t.type === 'script' && <Cpu size={12} className="shrink-0 text-amber-300" />}
          {t.type === 'audio' && (t.content.mute ? <VolumeX size={12} className="shrink-0 text-mute" /> : <Music size={12} className="shrink-0 text-emerald-400" />)}
          <Name t={t} isComp={isComp} />
          {!isComp && t.type !== 'audio' && t.type !== 'code' && <>
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
          {t.type === 'audio' && !graph && <AudioWave layer={t} xOf={xOf} pps={pps} />}
          {t.type === 'code' && !expanded[t.id] && !graph && <CodeTicks t={t} project={project} xOf={xOf} />}
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

function AudioRow({ project }) {
  const au = project.audio, l = activeAudio();
  return (
    <div className="flex h-[28px] shrink-0 items-center gap-1.5 border-t border-line bg-panel2/50 px-2 text-[11px]">
      <Music size={13} className="text-emerald-400" />
      <span className="max-w-[220px] truncate">{l ? l.name : <span className="text-mute">오디오 레이어 없음 — 오디오 파일을 끌어다 놓으세요</span>}</span>
      {l && <>
        <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" onClick={runBeatDetection}>비트 감지</button>
        {au.bpm ? <span className="num text-mute">{au.bpm}BPM · {au.beats.length}</span> : null}
        <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택 레이어에 비트마다 스케일 펄스" onClick={() => pulseOnBeats('scale', 12)}>펄스</button>
        <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택 키프레임을 가장 가까운 비트로" onClick={snapKeysToBeats}>키→비트</button>
        <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" title="선택한 속성을 오디오 진폭으로 키프레임화" onClick={() => { const r = prompt('진폭 0 → 값, 진폭 1 → 값 (예: 100,140)', '100,140'); if (r) { const [a, b] = r.split(',').map(Number); audioToKeys(a, b); } }}>오디오→키</button>
        {au.beats?.length > 0 && <button className="rounded bg-white/5 px-1.5 hover:bg-white/10" onClick={() => S().mutate((d) => { d.audio.beats = []; d.audio.bpm = 0; })}>비트 지우기</button>}
      </>}
    </div>
  );
}

/** Waveform drawn inside an audio layer's bar. */
function AudioWave({ layer, xOf, pps }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(0);
  const key = audioKey(layer);
  useEffect(() => { if (key && !bufferOf(key.id)) decode(key).then(() => setReady((r) => r + 1)).catch(() => {}); }, [key?.id]); // eslint-disable-line
  const buf = key && bufferOf(key.id);
  const x0 = xOf((layer.inPoint || 0) - (layer.content.trim || 0)), clipL = xOf(layer.inPoint || 0), clipR = xOf(layer.outPoint);
  const w = buf ? buf.duration * pps : 0;
  useEffect(() => {
    const c = ref.current; if (!c || !buf) return;
    const L = Math.max(clipL, 0), R = Math.min(clipR, x0 + w, 4000), W = Math.max(1, R - L), H = ROW - 4, dpr = devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; c.style.left = L + 'px';
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = layer.content.mute ? '#6b7280' : '#5eead4';
    const pk = peaks(buf, Math.max(1, Math.min(20000, Math.floor(w))));
    const n = pk.length / 2, vol = Math.min(1.5, layer.content.volume ?? 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + (i / n) * w - L; if (x < 0 || x > W) continue;
      const hi = pk[i * 2 + 1] * vol, lo = pk[i * 2] * vol;
      g.fillRect(x, H / 2 - hi * (H / 2), Math.max(1, w / n), Math.max(1, (hi - lo) * (H / 2)));
    }
  }, [buf, ready, x0, w, clipL, clipR, layer.content.mute, layer.content.volume]);
  if (!buf) return null;
  return <canvas ref={ref} className="pointer-events-none absolute top-[2px] opacity-80" />;
}

/** Evaluated exports of every code layer's module, read from the running page (for computed values). */
function useEvaluated(project) {
  const [evals, setEvals] = useState({});
  const files = project.layers.filter((l) => l.type === 'code').map((l) => l.content.file).join('|');
  useEffect(() => onRT(async (rt) => {
    const ws = S().project.workspace; if (!rt || !ws) return;
    const win = document.querySelector('iframe[title=composition]')?.contentWindow; if (!win) return;
    const out = {};
    for (const f of files.split('|').filter(Boolean)) {
      try {
        const mod = await new win.Function('u', 'return import(u)')(location.origin + WS.fileUrl(ws.id, f));
        out[f] = JSON.parse(JSON.stringify(mod, (k, v) => (typeof v === 'function' ? undefined : v)));
      } catch (e) { out[f] = {}; }
    }
    setEvals(out);
  }), [files]);
  return evals;
}

/** Collapsed code layer: small ticks for every time-like literal. */
function CodeTicks({ t, project, xOf }) {
  const text = useStore((s) => fileText(s, t.content.file));
  const ticks = [];
  const walk = (p) => { if (isTimeLike(p, project.duration)) ticks.push(p.value); (p.children || []).forEach(walk); };
  parseParams(text || '').params.forEach(walk);
  return ticks.map((v, i) => <div key={i} className="pointer-events-none absolute top-[8px] h-[6px] w-[2px] rounded bg-violet-300/80" style={{ left: xOf(v) - 1 }} />);
}

/** One code parameter: inline value editor + timeline marker / span when it is a time. */
function ParamRow({ row, t, style, project, xOf, pps, laneDown, graph }) {
  const [ghost, setGhost] = useState(null);
  const file = t.content.file, fps = project.fps;
  if (row.error) return <div className="absolute left-0 right-0 flex items-center border-b border-line/30 pl-11 text-[11px] text-red-300" style={style}>구문 오류: {row.error}</div>;
  const p = row.p, dur = project.duration;
  const toggleKey = () => S().setUi((u) => ({ expanded: { ...u.expanded, [row.key]: !(u.expanded[row.key] ?? row.depth < 1) } }));
  const open = row.group && (S().ui.expanded[row.key] ?? row.depth < 1);
  const timeLeaf = !row.group && !row.computed && isTimeLike(p, dur);
  const span = row.group && isTimeSpan(p, dur);
  const numArr = row.group && p.kind === 'array' && p.children.length > 0 && p.children.every((c) => c.kind === 'number' && isTimeLike(c, dur));

  const drag = (e, leaves, mode) => {
    e.stopPropagation();
    const x0 = e.clientX, v0 = leaves.map((l) => l.value);
    const calc = (ev) => { const dt = (ev.clientX - x0) / pps; return v0.map((v) => Math.max(0, Math.round((v + dt) * fps) / fps)); };
    const move = (ev) => setGhost({ mode, vals: calc(ev) });
    const up = (ev) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); setGhost(null);
      const vals = calc(ev); if (vals.every((v, i) => Math.abs(v - v0[i]) < 1e-6)) return;
      leaves.forEach((l, i) => setCodeParam(file, l.path, +vals[i].toFixed(4), 'mk-' + Date.now() + i));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const Marker = ({ v, leaf, ro, i }) => (
    <div onPointerDown={ro ? undefined : (e) => drag(e, [leaf], i)} title={`${row.label}${leaf ? '' : ''} = ${(+v).toFixed(3)}s${ro ? ' (코드에서 계산됨 — 코드 탭에서 수정)' : ' · 드래그해서 시간 변경'}`}
      className={cx('absolute top-1/2 h-[12px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-sm border', ro ? 'border-black/40 bg-violet-300/40' : 'cursor-ew-resize border-black/60 bg-violet-400')}
      style={{ left: xOf(v) }} />
  );
  let lane = null;
  if (!graph) {
    if (timeLeaf) lane = <Marker v={ghost ? ghost.vals[0] : p.value} leaf={p} i={0} />;
    else if (span) {
      const [a, b] = ghost ? ghost.vals : p.children.map((c) => c.value);
      lane = (
        <div className="absolute top-[5px] h-[12px] cursor-grab rounded-sm bg-violet-500/40 outline outline-1 outline-violet-400" style={{ left: xOf(a), width: Math.max(2, (b - a) * pps) }} onPointerDown={(e) => drag(e, p.children, 'span')}>
          <div className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-violet-300" onPointerDown={(e) => drag(e, [p.children[0]], 'a')} />
          <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-violet-300" onPointerDown={(e) => drag(e, [p.children[1]], 'b')} />
          <span className="pointer-events-none absolute left-2 top-[-1px] text-[10px] text-violet-100">{row.label}</span>
        </div>
      );
    } else if (numArr && !open) lane = p.children.map((c, i) => <Marker key={i} v={c.value} leaf={c} i={i} />);
    else if (row.computed && row.time) lane = row.computed.map((v, i) => <Marker key={i} v={v} ro i={i} />);
  }
  const edit = (v) => setCodeParam(file, p.path, v);
  return (
    <div className="absolute left-0 right-0 flex border-b border-line/30" style={style}>
      <div className="flex shrink-0 items-center gap-1 border-r border-line pr-1" style={{ width: LEFT, paddingLeft: 30 + row.depth * 12 }}>
        {row.group ? <button className="w-3 text-mute" onClick={toggleKey}><ChevronRight size={11} className={cx(open && 'rotate-90')} /></button> : <span className="w-3" />}
        <span className={cx('min-w-0 flex-1 truncate font-mono text-[11px]', row.computed != null ? 'text-mute' : 'text-violet-200')} title={p.path.join('.')}>{row.label}</span>
        {row.computed != null && <span className="text-[10px] text-mute">{Array.isArray(row.computed) ? `${row.computed.length}개 · 계산됨` : String(row.computed)}</span>}
        {!row.group && row.computed == null && p.kind === 'number' && <ScrubNumber value={p.value} step={timeLeaf ? 1 / fps : Math.abs(p.value) >= 10 ? 1 : 0.01} onChange={edit} unit={timeLeaf ? 's' : ''} decimals={timeLeaf || Math.abs(p.value) < 10 ? 3 : 1} />}
        {!row.group && row.computed == null && p.kind === 'string' && <input key={p.value} defaultValue={p.value} className="w-[150px] rounded border border-line bg-app px-1 text-[11px] outline-none focus:border-acc" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }} onBlur={(e) => e.target.value !== p.value && edit(e.target.value)} />}
        {!row.group && row.computed == null && p.kind === 'bool' && <input type="checkbox" checked={p.value} onChange={(e) => edit(e.target.checked)} />}
        {row.group && <span className="text-[10px] text-mute">{p.kind === 'array' ? `[${p.children.length}]` : '{…}'}</span>}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden" onPointerDown={laneDown}>{lane}</div>
    </div>
  );
}
