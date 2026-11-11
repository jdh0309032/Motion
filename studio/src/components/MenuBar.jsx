import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store.js';
import { LAYER_TYPES } from '../engine/project.js';
import { addLayer, saveProject, importFiles, newProject, duplicateLayers, deleteSelection, copyKeys, pasteKeys, setEaseSelected, download } from '../engine/actions.js';
import { exportDocument } from '../engine/document.js';
import { EASE_PRESETS } from '../engine/bezier.js';
import { IconBtn, fmtTime, cx } from './ui.jsx';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Undo2, Redo2, Clapperboard, Repeat } from 'lucide-react';

const S = () => useStore.getState();

function Menu({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!open) return; const f = (e) => !ref.current?.contains(e.target) && setOpen(false); addEventListener('pointerdown', f); return () => removeEventListener('pointerdown', f); }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className={cx('rounded px-2 py-1 hover:bg-white/5', open && 'bg-white/10')} onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[230px] rounded-md border border-line bg-panel py-1 shadow-2xl">
          {items.map((it, i) => it === '-' ? <div key={i} className="my-1 border-t border-line" /> : (
            <button key={i} className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-acc/20" onClick={() => { setOpen(false); it.do(); }}>
              <span>{it.label}</span><span className="text-[11px] text-mute">{it.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MenuBar({ onRender, onComp }) {
  const time = useStore((s) => s.time), fps = useStore((s) => s.project.fps), dur = useStore((s) => s.project.duration);
  const playing = useStore((s) => s.playing), name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0), canRedo = useStore((s) => s.future.length > 0);
  const loop = useStore((s) => s.ui.loop !== false);
  const open = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.html,.htm'; i.onchange = () => importFiles([...i.files]); i.click(); };
  const exportHtml = () => { const { project, assets } = S(); download(new Blob([exportDocument(project, assets)], { type: 'text/html' }), `${project.name}.html`); };
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <div className="mr-2 flex items-center gap-1.5 font-semibold"><Clapperboard size={16} className="text-acc" /> Motion Studio</div>
      <Menu label="파일" items={[
        { label: 'HTML 모션그래픽 열기…', key: 'Ctrl+O', do: open },
        { label: '새 컴포지션', key: '', do: () => newProject() },
        '-',
        { label: '프로젝트 저장 (.motion.html)', key: 'Ctrl+S', do: saveProject },
        { label: '재생용 HTML 내보내기', key: '', do: exportHtml },
        '-',
        { label: '렌더 (MP4 / WebM / ProRes / GIF)…', key: 'Ctrl+M', do: onRender },
      ]} />
      <Menu label="편집" items={[
        { label: '실행 취소', key: 'Ctrl+Z', do: () => S().undo() },
        { label: '다시 실행', key: 'Ctrl+Shift+Z', do: () => S().redo() },
        '-',
        { label: '키프레임 복사', key: 'Ctrl+C', do: copyKeys },
        { label: '키프레임 붙여넣기 (현재 시간)', key: 'Ctrl+V', do: pasteKeys },
        { label: '레이어 복제', key: 'Ctrl+D', do: duplicateLayers },
        { label: '삭제', key: 'Delete', do: deleteSelection },
      ]} />
      <Menu label="레이어" items={[
        ...['text', 'rect', 'ellipse', 'solid', 'null'].map((t) => ({ label: `새 ${LAYER_TYPES[t].label}`, key: t === 'text' ? 'Ctrl+T' : '', do: () => addLayer(t) })),
      ]} />
      <Menu label="애니메이션" items={[
        { label: 'Easy Ease', key: 'F9', do: () => setEaseSelected(EASE_PRESETS.easyEase) },
        { label: 'Easy Ease In', key: 'Shift+F9', do: () => setEaseSelected([0.33, 0, 1, 1]) },
        { label: 'Easy Ease Out', key: 'Ctrl+Shift+F9', do: () => setEaseSelected([0, 0, 0.67, 1]) },
        { label: 'Linear', key: '', do: () => setEaseSelected(EASE_PRESETS.linear) },
        { label: 'Hold (정지 키프레임)', key: 'Ctrl+Alt+H', do: () => setEaseSelected([0, 0, 1, 1], true) },
      ]} />
      <Menu label="컴포지션" items={[{ label: '컴포지션 설정…', key: 'Ctrl+K', do: onComp }]} />

      <div className="mx-auto flex items-center gap-0.5">
        <IconBtn icon={Undo2} title="실행 취소" disabled={!canUndo} onClick={() => S().undo()} />
        <IconBtn icon={Redo2} title="다시 실행" disabled={!canRedo} onClick={() => S().redo()} />
        <span className="mx-2 h-5 border-l border-line" />
        <IconBtn icon={SkipBack} title="처음 (Home)" onClick={() => S().setTime(0)} />
        <IconBtn icon={StepBack} title="이전 프레임 (PgUp)" onClick={() => S().setTime(time - 1 / fps)} />
        <IconBtn icon={playing ? Pause : Play} size={18} title="재생/정지 (Space)" active={playing} onClick={() => S().setPlaying(!playing)} />
        <IconBtn icon={StepForward} title="다음 프레임 (PgDn)" onClick={() => S().setTime(time + 1 / fps)} />
        <IconBtn icon={SkipForward} title="끝 (End)" onClick={() => S().setTime(dur)} />
        <IconBtn icon={Repeat} title="반복 재생" active={loop} onClick={() => S().setUi({ loop: !loop })} />
        <span className="num ml-2 w-[86px] text-acc">{fmtTime(time, fps)}</span>
      </div>
      <span className="mr-2 max-w-[200px] truncate text-mute">{name}</span>
      <button onClick={onRender} className="rounded bg-acc px-3 py-1 font-semibold text-white hover:brightness-110">렌더</button>
    </div>
  );
}
