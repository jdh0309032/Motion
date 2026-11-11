import { useStore, targetOf, draftTarget } from '../store.js';
import { TRANSFORM, LAYER_TYPES, EFFECTS, BLEND_MODES, getValue, setValue, toggleStopwatch, setBase, paramDef } from '../engine/project.js';
import { removeEffect, setParent } from '../engine/actions.js';
import { getRT } from '../engine/bridge.js';
import { ScrubNumber, Stopwatch, Section, ColorInput, Select, TextIn, Slider, IconBtn, cx } from './ui.jsx';
import { Trash2, Power, ChevronUp, ChevronDown } from 'lucide-react';

const S = () => useStore.getState();

function PropRow({ t, path, def }) {
  const time = useStore((s) => s.time);
  const animated = !!t.tracks?.[path]?.length;
  const v = getValue(t, path, time);
  const set = (val) => S().mutate((d) => setValue(draftTarget(d, t.id), path, val, S().time, d.fps), { merge: 'insp-' + t.id + path });
  const watch = () => S().mutate((d) => toggleStopwatch(draftTarget(d, t.id), path, S().time, d.fps), { structure: true });
  const showSlider = def.min != null && def.max != null && def.max - def.min <= 1000;
  return (
    <div className="flex min-h-[24px] items-center gap-1.5">
      {!def.type && !def.noAnim ? <Stopwatch on={animated} onClick={watch} /> : <span className="w-[17px]" />}
      <span className="w-[108px] shrink-0 truncate text-mute">{def.label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {def.type === 'color' ? <ColorInput value={v} onChange={(c) => S().mutate((d) => setBase(draftTarget(d, t.id), path, c), { merge: 'col' + path })} />
          : def.type === 'bool' ? <input type="checkbox" checked={!!v} onChange={(e) => S().mutate((d) => setBase(draftTarget(d, t.id), path, e.target.checked))} />
          : def.type === 'textarea' ? <textarea defaultValue={v} key={t.id + path} rows={2} className="min-w-0 flex-1 rounded border border-line bg-app px-1 outline-none focus:border-acc" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => S().mutate((d) => setBase(draftTarget(d, t.id), path, e.target.value), { merge: 'txt' + t.id, structure: true })} />
          : def.type === 'text' ? <TextIn defaultValue={v} key={t.id + path} className="min-w-0 flex-1" onBlur={(e) => S().mutate((d) => setBase(draftTarget(d, t.id), path, e.target.value), { structure: true })} />
          : def.type === 'asset' ? <AssetPick kind={def.kind} value={v} onChange={(a) => S().mutate((d) => setBase(draftTarget(d, t.id), path, a), { structure: true })} />
          : <>
            <ScrubNumber value={v} step={def.step ?? 1} min={def.min} max={def.max} unit={def.unit || ''} animated={animated} onChange={set} />
            {showSlider && <Slider value={v} min={def.min} max={def.max} step={def.step} onChange={set} />}
          </>}
      </div>
    </div>
  );
}

function AssetPick({ kind, value, onChange }) {
  const assets = useStore((s) => s.assets);
  const opts = [{ value: '', label: '— none —' }, ...Object.values(assets).filter((a) => a.kind === kind).map((a) => ({ value: a.id, label: a.name }))];
  return <Select value={value || ''} options={opts} onChange={(v) => onChange(v || null)} className="min-w-0 flex-1" />;
}

function EffectBlock({ t, fx, i }) {
  const def = EFFECTS[fx.type];
  const up = (dir) => S().mutate((d) => { const e = draftTarget(d, t.id).effects; const j = i + dir; if (j < 0 || j >= e.length) return; [e[i], e[j]] = [e[j], e[i]]; });
  return (
    <div className={cx('mb-2 rounded border border-line bg-panel2/60 p-1.5', !fx.enabled && 'opacity-50')}>
      <div className="mb-1 flex items-center gap-1">
        <IconBtn size={13} icon={Power} active={fx.enabled} title="fx 켜기/끄기" onClick={() => S().mutate((d) => { const e = draftTarget(d, t.id).effects.find((e) => e.id === fx.id); e.enabled = !e.enabled; })} />
        <span className="flex-1 font-semibold">{def.label}</span>
        <IconBtn size={13} icon={ChevronUp} title="위로" onClick={() => up(-1)} />
        <IconBtn size={13} icon={ChevronDown} title="아래로" onClick={() => up(1)} />
        <IconBtn size={13} icon={Trash2} title="삭제" onClick={() => removeEffect(t.id, fx.id)} />
      </div>
      {def.params.map((p) => <PropRow key={p.key} t={t} path={`fx.${fx.id}.${p.key}`} def={p} />)}
    </div>
  );
}

export default function Inspector() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.sel);
  const id = sel.layers[0];
  const t = id ? targetOf(project, id) : targetOf(project, 'comp');
  if (!t) return null;
  const isComp = t.id === 'comp';
  const parentOpts = [{ value: '', label: 'None' }, ...project.layers.filter((l) => l.id !== t.id).map((l) => ({ value: l.id, label: l.name }))];
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-line px-2 py-2">
        <span className="h-3 w-3 rounded-sm" style={{ background: isComp ? '#888' : t.label }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{isComp ? 'Composition' : t.name}</span>
        <span className="text-mute">{isComp ? `${project.width}×${project.height}` : LAYER_TYPES[t.type]?.label}</span>
      </div>
      {sel.layers.length > 1 && <div className="px-2 py-1 text-[11px] text-amber-300">{sel.layers.length}개 선택됨 — 첫 번째 레이어 표시</div>}

      {!isComp && (
        <Section title="Layer">
          {t.selector && <div className="mb-1.5 break-all rounded bg-app px-1.5 py-1 font-mono text-[10px] text-mute" title="원본 HTML 요소">{t.selector}{t.sources?.length ? ` · from ${t.sources.join('+')}` : ''}</div>}
          <div className="mb-1 grid grid-cols-[108px_1fr] items-center gap-1.5 pl-[23px]"><span className="text-mute">Parent</span><Select value={t.parent || ''} options={parentOpts} onChange={(v) => setParent(t.id, v, getRT())} /></div>
          <div className="mb-1 grid grid-cols-[108px_1fr] items-center gap-1.5 pl-[23px]"><span className="text-mute">Blend Mode</span><Select value={t.blend || 'normal'} options={BLEND_MODES} onChange={(v) => S().mutate((d) => { draftTarget(d, t.id).blend = v; })} /></div>
          <div className="grid grid-cols-[108px_1fr] items-center gap-1.5 pl-[23px]"><span className="text-mute">In / Out</span>
            <span className="flex gap-2"><ScrubNumber value={t.inPoint} step={1 / project.fps} min={0} unit="s" decimals={2} onChange={(v) => S().mutate((d) => { draftTarget(d, t.id).inPoint = v; }, { merge: 'in' })} />
              <ScrubNumber value={t.outPoint} step={1 / project.fps} min={0} unit="s" decimals={2} onChange={(v) => S().mutate((d) => { draftTarget(d, t.id).outPoint = v; }, { merge: 'out' })} /></span></div>
        </Section>
      )}

      {t.type === 'audio' && (
        <Section title="Audio">
          <div className="mb-1.5 break-all rounded bg-app px-1.5 py-1 font-mono text-[10px] text-mute">{t.content.src || project.layers && (useStore.getState().assets[t.content.assetId]?.name ?? '—')}</div>
          <div className="mb-1 grid grid-cols-[108px_1fr] items-center gap-1.5 pl-[23px]"><span className="text-mute">Start (In)</span><ScrubNumber value={t.inPoint} step={1 / project.fps} unit="s" decimals={3} onChange={(v) => S().mutate((d) => { const l = draftTarget(d, t.id); const len = l.outPoint - l.inPoint; l.inPoint = +v.toFixed(4); l.outPoint = +(v + len).toFixed(4); }, { merge: 'ain' })} /></div>
        </Section>
      )}
      {t.type === 'code' && (
        <Section title="Code Parameters">
          <div className="mb-1.5 break-all rounded bg-app px-1.5 py-1 font-mono text-[11px] text-violet-200">{t.content.file}</div>
          <div className="text-[11px] leading-relaxed text-mute">타임라인에서 이 레이어를 펼치면 <b className="text-fg">export const</b> 값이 나옵니다. 숫자·문자열은 바로 수정, 시간 값은 보라색 마커/구간을 드래그하세요. 수정은 코드 파일에 그대로 기록되고(Ctrl+Z 가능) 미리보기가 다시 로드됩니다. 계산식으로 만든 값은 회색(읽기 전용) — Code 탭에서 수정합니다.</div>
        </Section>
      )}
      {t.type === 'script' && (
        <div className="border-b border-line px-2 py-1.5 text-[11px] text-mute">스크립트 레이어: 페이지 코드가 직접 그리는 캔버스. <span className="text-fg">window.renderAt(t)</span>가 있으면 임의 시점으로 정확히 이동하고, 없으면 가상 시계로 구동합니다. 레이어 시작(In) = 시간 오프셋, Time Stretch = 속도.</div>
      )}

      {!isComp && !LAYER_TYPES[t.type]?.noTransform && (
        <Section title="Transform">
          {TRANSFORM.map((p) => <PropRow key={p.key} t={t} path={p.key} def={p} />)}
        </Section>
      )}

      {!isComp && LAYER_TYPES[t.type]?.params.length > 0 && (
        <Section title={LAYER_TYPES[t.type].label}>
          {LAYER_TYPES[t.type].params.map((p) => <PropRow key={p.key} t={t} path={`c.${p.key}`} def={p} />)}
        </Section>
      )}

      {Object.keys(t.tracks || {}).some((p) => p.startsWith('css.')) && (
        <Section title="CSS (원본에서 가져온 트랙)" defaultOpen={false}>
          {Object.keys(t.tracks).filter((p) => p.startsWith('css.')).map((p) => <div key={p} className="flex justify-between py-0.5"><span className="text-mute">{p.slice(4)}</span><span className="num text-key">{t.tracks[p].length} keys</span></div>)}
        </Section>
      )}

      {!LAYER_TYPES[t.type]?.noTransform && <Section title={isComp ? 'Composition Effects (Adjustment)' : 'Effects'}>
        {t.effects.length === 0 && <div className="py-1 text-mute">왼쪽 Effects & Presets 패널에서 이펙트를 더블클릭해 적용하세요.</div>}
        {t.effects.map((fx, i) => <EffectBlock key={fx.id} t={t} fx={fx} i={i} />)}
      </Section>}

      {isComp && (
        <Section title="Composition">
          <CompFields />
        </Section>
      )}
    </div>
  );
}

export function CompFields() {
  const p = useStore((s) => s.project);
  const set = (k, v, structure) => S().mutate((d) => { d[k] = v; if (k === 'duration') d.layers.forEach((l) => { if (l.outPoint > v || l.outPoint === p.duration) l.outPoint = v; }); }, { structure });
  const row = (label, el) => <div className="mb-1.5 grid grid-cols-[110px_1fr] items-center gap-2"><span className="text-mute">{label}</span>{el}</div>;
  return (
    <div>
      {row('Name', <TextIn defaultValue={p.name} key={p.name} onBlur={(e) => set('name', e.target.value)} />)}
      {row('Size', <span className="flex gap-2"><ScrubNumber value={p.width} step={2} min={16} decimals={0} unit="w" onChange={(v) => set('width', Math.round(v), true)} /><ScrubNumber value={p.height} step={2} min={16} decimals={0} unit="h" onChange={(v) => set('height', Math.round(v), true)} /></span>)}
      {row('Frame Rate', <Select value={String(p.fps)} options={['24', '25', '30', '50', '60']} onChange={(v) => set('fps', +v)} />)}
      {row('Duration', <ScrubNumber value={p.duration} step={0.1} min={0.5} unit="s" decimals={2} onChange={(v) => set('duration', +v.toFixed(2))} />)}
      {row('3D Perspective', <ScrubNumber value={p.perspective || 1600} step={10} min={100} unit="px" decimals={0} onChange={(v) => set('perspective', v)} />)}
    </div>
  );
}
