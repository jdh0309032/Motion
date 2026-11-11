import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { exportDocument } from '../engine/document.js';
import { saveProject } from '../engine/actions.js';
import { Modal, Btn, Select, ScrubNumber } from './ui.jsx';

const S = () => useStore.getState();

export default function RenderDialog({ onClose }) {
  const p = useStore((s) => s.project);
  const [o, setO] = useState({ format: 'mp4', fps: p.fps, scale: 1, start: 0, end: p.duration, crf: 16 });
  const [server, setServer] = useState(null);
  const [job, setJob] = useState(null);
  const poll = useRef(0);
  useEffect(() => { fetch('/api/render').then((r) => r.json()).then(setServer).catch(() => setServer(false)); return () => clearInterval(poll.current); }, []);

  const start = async () => {
    const html = exportDocument(S().project, S().assets);
    const r = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...o, html, name: p.name }) }).then((r) => r.json());
    if (r.error) return setJob({ error: r.error });
    setJob({ id: r.id, frame: 0, total: 1 });
    poll.current = setInterval(async () => {
      const st = await fetch('/api/render/' + r.id).then((x) => x.json());
      setJob({ id: r.id, ...st });
      if (st.done || st.error) {
        clearInterval(poll.current);
        if (st.done) { const a = document.createElement('a'); a.href = `/api/render/${r.id}/file`; a.click(); }
      }
    }, 400);
  };
  const cancel = () => { if (job?.id) fetch('/api/render/' + job.id, { method: 'DELETE' }); clearInterval(poll.current); setJob(null); };
  const set = (k) => (v) => setO((x) => ({ ...x, [k]: v }));
  const frames = Math.round((o.end - o.start) * o.fps);
  const row = (l, el) => <div className="mb-2 grid grid-cols-[120px_1fr] items-center gap-2"><span className="text-mute">{l}</span>{el}</div>;
  return (
    <Modal title="Render Queue" onClose={onClose} width={500}>
      {row('Format', <Select value={o.format} onChange={set('format')} options={server?.formats ? Object.entries(server.formats).map(([value, label]) => ({ value, label })) : [{ value: 'mp4', label: 'H.264 MP4' }]} />)}
      {row('Frame Rate', <Select value={String(o.fps)} onChange={(v) => set('fps')(+v)} options={['24', '25', '30', '50', '60']} />)}
      {row('Resolution', <Select value={String(o.scale)} onChange={(v) => set('scale')(+v)} options={[{ value: '0.5', label: `Half (${p.width / 2}×${p.height / 2})` }, { value: '1', label: `Full (${p.width}×${p.height})` }, { value: '2', label: `2× (${p.width * 2}×${p.height * 2})` }]} />)}
      {row('Range', <span className="flex gap-3"><ScrubNumber value={o.start} step={1 / p.fps} min={0} max={o.end} unit="s" decimals={2} onChange={set('start')} /> → <ScrubNumber value={o.end} step={1 / p.fps} min={o.start} max={p.duration} unit="s" decimals={2} onChange={set('end')} /></span>)}
      {o.format !== 'mov' && o.format !== 'gif' && row('Quality (CRF)', <ScrubNumber value={o.crf} step={1} min={0} max={40} decimals={0} onChange={set('crf')} />)}
      <div className="mb-3 text-[11px] text-mute">헤드리스 Chromium이 {frames}개 프레임을 하나씩 정확한 시간으로 이동해 캡처하고 ffmpeg로 인코딩합니다. 오디오가 있으면 함께 들어갑니다.</div>

      {server === false && (
        <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[12px]">
          렌더 서버에 연결할 수 없습니다. <code>npm run dev</code>로 실행하거나, 프로젝트를 저장한 뒤 터미널에서:
          <pre className="mt-1 rounded bg-app p-1.5 font-mono text-[11px]">npm run render -- "{p.name}.motion.html" -o out.mp4</pre>
          <Btn className="mt-1" onClick={saveProject}>프로젝트 저장</Btn>
        </div>
      )}
      {job && !job.error && (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-[12px]"><span>{job.done ? '완료 — 다운로드됨' : `렌더링 ${job.frame}/${job.total || frames}`}</span><span className="num text-mute">{job.elapsed?.toFixed(1)}s</span></div>
          <div className="h-2 overflow-hidden rounded bg-app"><div className="h-full bg-acc transition-all" style={{ width: `${job.done ? 100 : ((job.frame || 0) / (job.total || frames)) * 100}%` }} /></div>
        </div>
      )}
      {job?.error && <div className="mb-3 whitespace-pre-wrap rounded border border-red-500/40 bg-red-500/10 p-2 text-[12px] text-red-300">{job.error}</div>}
      <div className="flex justify-end gap-2">
        {job && !job.done && !job.error ? <Btn onClick={cancel}>취소</Btn> : <Btn onClick={onClose}>닫기</Btn>}
        <Btn primary disabled={!server || (job && !job.done && !job.error)} onClick={start}>렌더 시작</Btn>
      </div>
    </Modal>
  );
}
