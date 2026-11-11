import { useState } from 'react';
import { useStore } from '../store.js';
import { EFFECTS, PRESETS } from '../engine/project.js';
import { addEffect, presetToSelection, importFiles, addImageLayer, setAudio } from '../engine/actions.js';
import { cx, IconBtn } from './ui.jsx';
import { Image, Music, Trash2, Upload, Sparkles, Wand2, Plus } from 'lucide-react';

const S = () => useStore.getState();

export default function SidePanel() {
  const panel = useStore((s) => s.ui.panel);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-line text-[11px] font-semibold uppercase tracking-wide">
        {[['project', 'Project'], ['effects', 'Effects & Presets']].map(([k, n]) => (
          <button key={k} onClick={() => S().setUi({ panel: k })} className={cx('flex-1 py-2', panel === k ? 'text-fg shadow-[inset_0_-2px_#4f9dff]' : 'text-mute hover:text-fg')}>{n}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{panel === 'project' ? <ProjectPanel /> : <EffectsPanel />}</div>
    </div>
  );
}

function ProjectPanel() {
  const assets = useStore((s) => s.assets);
  const audioId = useStore((s) => s.project.audio.assetId);
  const layers = useStore((s) => s.project.layers.length);
  const pick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'image/*,audio/*,.html,.htm'; i.onchange = () => importFiles([...i.files]); i.click(); };
  return (
    <div className="p-2">
      <button onClick={pick} className="mb-2 flex w-full items-center justify-center gap-2 rounded border border-dashed border-line py-4 text-mute hover:border-acc hover:text-fg">
        <Upload size={15} /> 파일 가져오기 / 끌어다 놓기
      </button>
      <div className="mb-2 text-[11px] text-mute">HTML(모션그래픽) · 이미지 · 오디오. 이미지를 컴포지션으로 끌어다 놓으면 레이어가 됩니다. 레이어 {layers}개.</div>
      {Object.values(assets).map((a) => (
        <div key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData('motion/asset', a.id)}
          className="group mb-1 flex items-center gap-2 rounded px-1.5 py-1 hover:bg-white/5" onDoubleClick={() => (a.kind === 'image' ? addImageLayer(a.id) : setAudio(a.id))}>
          {a.kind === 'image' ? <img src={a.url} className="h-8 w-10 rounded object-cover" alt="" /> : <span className="grid h-8 w-10 place-items-center rounded bg-emerald-500/15 text-emerald-400"><Music size={15} /></span>}
          <div className="min-w-0 flex-1">
            <div className="truncate">{a.name}</div>
            <div className="text-[10px] text-mute">{a.kind === 'image' ? `${a.meta.width}×${a.meta.height}` : `${a.meta.duration?.toFixed(1)}s${audioId === a.id ? ' · comp audio' : ''}`}</div>
          </div>
          <span className="hidden gap-0.5 group-hover:flex">
            {a.kind === 'image' ? <IconBtn size={13} icon={Plus} title="레이어로 추가" onClick={() => addImageLayer(a.id)} /> : <IconBtn size={13} icon={Music} title="컴포지션 오디오로" onClick={() => setAudio(a.id)} />}
            <IconBtn size={13} icon={Trash2} title="삭제" onClick={() => S().removeAsset(a.id)} />
          </span>
        </div>
      ))}
    </div>
  );
}

function EffectsPanel() {
  const [q, setQ] = useState('');
  const cats = {};
  for (const [k, e] of Object.entries(EFFECTS)) if (e.label.toLowerCase().includes(q.toLowerCase())) (cats[e.cat] ||= []).push([k, e]);
  const presets = Object.entries(PRESETS).filter(([, p]) => p.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="p-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="검색…" className="mb-2 w-full rounded border border-line bg-app px-2 py-1 outline-none focus:border-acc" />
      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-mute"><Wand2 size={12} /> Animation Presets</div>
      {presets.map(([k, p]) => (
        <div key={k} className="cursor-pointer rounded px-2 py-1 hover:bg-white/5" title="선택한 레이어에 현재 시간부터 적용 (더블클릭)" onDoubleClick={() => presetToSelection(k)}>{p.label}</div>
      ))}
      {Object.entries(cats).map(([cat, list]) => (
        <div key={cat} className="mt-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-mute"><Sparkles size={12} /> {cat === 'Comp' ? 'Comp Adjustment' : cat}</div>
          {list.map(([k, e]) => <div key={k} className="cursor-pointer rounded px-2 py-1 hover:bg-white/5" title={e.compOnly ? '컴포지션 전체에 적용 (더블클릭)' : '선택 레이어에 적용, 없으면 컴포지션 전체 (더블클릭)'} onDoubleClick={() => addEffect(k)}>{e.label}</div>)}
        </div>
      ))}
      <div className="mt-3 text-[11px] text-mute">더블클릭으로 적용. 레이어를 선택하지 않으면 컴포지션 전체(조정 레이어처럼)에 적용됩니다.</div>
    </div>
  );
}
