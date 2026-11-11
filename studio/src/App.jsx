import { useEffect, useRef, useState } from 'react';
import { useStore } from './store.js';
import MenuBar from './components/MenuBar.jsx';
import Viewer from './components/Viewer.jsx';
import Timeline from './components/Timeline.jsx';
import Inspector, { CompFields } from './components/Inspector.jsx';
import SidePanel from './components/SidePanel.jsx';
import RenderDialog from './components/RenderDialog.jsx';
import { Modal, Btn } from './components/ui.jsx';
import { importFiles, saveProject, deleteSelection, duplicateLayers, copyKeys, pasteKeys, setEaseSelected, addLayer, importHtmlText, moveLayer } from './engine/actions.js';
import { playAudio, stopAudio } from './engine/audio.js';
import { EASE_PRESETS } from './engine/bezier.js';
import { Loader2 } from 'lucide-react';

const S = () => useStore.getState();

function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) { stopAudio(); return; }
    let raf, t0 = performance.now(), from = S().time;
    const { project, assets } = S();
    if (from >= project.duration - 1e-3) from = 0;
    const audio = assets[project.audio.assetId];
    playAudio(audio, from, project.audio.offset || 0, project.audio.volume ?? 1);
    const tick = (now) => {
      const P = S().project;
      let t = from + (now - t0) / 1000;
      if (t >= P.duration) {
        if (S().ui.loop === false) { S().setTime(P.duration); S().setPlaying(false); return; }
        from = 0; t0 = now; t = 0; playAudio(audio, 0, P.audio.offset || 0, P.audio.volume ?? 1);
      }
      S().setTime(Math.round(t * P.fps) / P.fps);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); stopAudio(); };
  }, [playing]);
}

function useShortcuts(open) {
  useEffect(() => {
    const k = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const c = e.ctrlKey || e.metaKey, st = S(), fps = st.project.fps;
      const hit = (cond, fn) => { if (cond) { e.preventDefault(); fn(); return true; } return false; };
      hit(e.code === 'Space', () => st.setPlaying(!st.playing)) ||
      hit(c && e.key.toLowerCase() === 'z' && !e.shiftKey, () => st.undo()) ||
      hit(c && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)), () => st.redo()) ||
      hit(c && e.key.toLowerCase() === 's', saveProject) ||
      hit(c && e.key.toLowerCase() === 'o', () => open.html()) ||
      hit(c && e.key.toLowerCase() === 'm', () => open.render()) ||
      hit(c && e.key.toLowerCase() === 'k', () => open.comp()) ||
      hit(c && e.key.toLowerCase() === 'd', duplicateLayers) ||
      hit(c && e.key.toLowerCase() === 'c', copyKeys) ||
      hit(c && e.key.toLowerCase() === 'v', pasteKeys) ||
      hit(c && e.key.toLowerCase() === 't', () => addLayer('text')) ||
      hit(c && (e.key === ']' || e.key === '['), () => st.sel.layers.forEach((id) => moveLayer(id, e.key === ']' ? -1 : 1))) ||
      hit(c && e.altKey && e.key.toLowerCase() === 'h', () => setEaseSelected([0, 0, 1, 1], true)) ||
      hit(e.key === 'F9', () => setEaseSelected(e.shiftKey && c ? [0, 0, 0.67, 1] : e.shiftKey ? [0.33, 0, 1, 1] : EASE_PRESETS.easyEase)) ||
      hit(e.key === 'F3' && e.shiftKey, () => st.setUi({ graph: !st.ui.graph })) ||
      hit(e.key === 'Delete' || e.key === 'Backspace', deleteSelection) ||
      hit(e.key === 'Home', () => st.setTime(0)) ||
      hit(e.key === 'End', () => st.setTime(st.project.duration)) ||
      hit(e.key === 'PageUp' || (e.key === 'ArrowLeft' && !c), () => st.setTime(st.time - (e.shiftKey ? 10 : 1) / fps)) ||
      hit(e.key === 'PageDown' || (e.key === 'ArrowRight' && !c), () => st.setTime(st.time + (e.shiftKey ? 10 : 1) / fps)) ||
      hit(e.key === 'u' || e.key === 'U', () => st.setUi((u) => ({ expanded: Object.fromEntries([...Object.keys(u.expanded), ...st.sel.layers].map((id) => [id, !st.sel.layers.length ? false : true])) }))) ||
      hit(e.key === 'j' || e.key === 'k', () => {
        const ts = [...new Set(st.project.layers.filter((l) => !st.sel.layers.length || st.sel.layers.includes(l.id)).flatMap((l) => Object.values(l.tracks).flat().map((x) => x.t)))].sort((a, b) => a - b);
        const n = e.key === 'k' ? ts.find((x) => x > st.time + 1e-4) : [...ts].reverse().find((x) => x < st.time - 1e-4);
        if (n != null) st.setTime(n);
      });
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open]);
}

function Splitter({ onDrag, vertical }) {
  const down = (e) => { const m = (ev) => onDrag(ev); const u = () => { removeEventListener('pointermove', m); removeEventListener('pointerup', u); }; addEventListener('pointermove', m); addEventListener('pointerup', u); e.preventDefault(); };
  return <div onPointerDown={down} className={vertical ? 'w-1 shrink-0 cursor-col-resize bg-line/60 hover:bg-acc' : 'h-1 shrink-0 cursor-row-resize bg-line/60 hover:bg-acc'} />;
}

export default function App() {
  const [render, setRender] = useState(false), [comp, setComp] = useState(false);
  const [tlH, setTlH] = useState(330), [leftW, setLeftW] = useState(250), [rightW, setRightW] = useState(330);
  const busy = useStore((s) => s.busy), status = useStore((s) => s.status), hasLayers = useStore((s) => s.project.layers.length > 0);
  const [drag, setDrag] = useState(false);
  const openRef = useRef({});
  openRef.current = {
    html: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.html,.htm'; i.onchange = () => importFiles([...i.files]); i.click(); },
    render: () => setRender(true), comp: () => setComp(true),
  };
  usePlayback();
  useShortcuts(openRef.current);
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } };
    const leave = (e) => { if (!e.relatedTarget) setDrag(false); };
    const drop = (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); importFiles([...e.dataTransfer.files]); };
    addEventListener('dragover', over); addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  }, []);
  const loadDemo = () => fetch('/examples/claude-intro.html').then((r) => r.text()).then((t) => importHtmlText(t, 'claude-intro.html'));

  return (
    <div className="flex h-full flex-col">
      <MenuBar onRender={() => setRender(true)} onComp={() => setComp(true)} />
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-line bg-panel" style={{ width: leftW }}><SidePanel /></div>
        <Splitter vertical onDrag={(e) => setLeftW(Math.max(180, Math.min(500, e.clientX)))} />
        <div className="relative min-w-0 flex-1">
          <Viewer />
          {!hasLayers && !busy && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto rounded-lg border border-line bg-panel/95 px-4 py-3 text-center shadow-xl">
                <div className="mb-1 font-semibold">Claude Code로 만든 HTML 모션그래픽을 끌어다 놓으세요</div>
                <div className="mb-2 text-mute">CSS · Web Animations · GSAP 애니메이션이 레이어와 키프레임으로 변환됩니다</div>
                <div className="flex justify-center gap-2"><Btn primary onClick={() => openRef.current.html()}>HTML 열기</Btn><Btn onClick={loadDemo}>데모 열기</Btn></div>
              </div>
            </div>
          )}
        </div>
        <Splitter vertical onDrag={(e) => setRightW(Math.max(260, Math.min(600, innerWidth - e.clientX)))} />
        <div className="shrink-0 border-l border-line bg-panel" style={{ width: rightW }}><Inspector /></div>
      </div>
      <Splitter onDrag={(e) => setTlH(Math.max(150, Math.min(innerHeight - 220, innerHeight - e.clientY)))} />
      <div className="shrink-0" style={{ height: tlH }}><Timeline /></div>

      {render && <RenderDialog onClose={() => setRender(false)} />}
      {comp && <Modal title="Composition Settings" onClose={() => setComp(false)}><CompFields /><div className="mt-3 flex justify-end"><Btn primary onClick={() => setComp(false)}>확인</Btn></div></Modal>}
      {busy && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50"><div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-5 py-4"><Loader2 className="animate-spin text-acc" /> {busy}</div></div>}
      {drag && <div className="pointer-events-none fixed inset-0 z-40 border-4 border-dashed border-acc bg-acc/10" />}
      {status && <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-panel px-3 py-2 shadow-xl">{status}</div>}
    </div>
  );
}
