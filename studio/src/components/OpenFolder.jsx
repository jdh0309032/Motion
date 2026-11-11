import { useEffect, useState } from 'react';
import * as WS from '../engine/workspace.js';
import { openWorkspace, uploadAndOpen } from '../engine/actions.js';
import { Modal, Btn, cx } from './ui.jsx';
import { Folder, FolderOpen, FileCode2, ArrowUp, Upload, Star } from 'lucide-react';

/** Browse folders on the machine running the dev server (local disk or Codespace) and open one. */
export default function OpenFolder({ onClose }) {
  const [dir, setDir] = useState(null), [err, setErr] = useState(null);
  const go = (p) => WS.browse(p).then(setDir).catch((e) => setErr(e.message));
  useEffect(() => { go(); }, []);
  const upload = () => {
    const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true;
    i.onchange = () => {
      const files = [...i.files].map((f) => ({ path: f.webkitRelativePath.split('/').slice(1).join('/'), file: f }));
      const name = i.files[0]?.webkitRelativePath.split('/')[0] || 'project';
      onClose(); uploadAndOpen(name, files);
    };
    i.click();
  };
  return (
    <Modal title="폴더 프로젝트 열기" onClose={onClose} width={620}>
      {err && <div className="mb-2 rounded bg-red-500/10 p-2 text-red-300">{err} — <code>npm run dev</code>로 실행 중인지 확인하세요.</div>}
      {dir && <>
        <div className="mb-2 flex items-center gap-2">
          <Btn disabled={!dir.parent} onClick={() => go(dir.parent)}><ArrowUp size={13} /></Btn>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute" title={dir.path}>{dir.path}</span>
        </div>
        <div className="h-[340px] overflow-y-auto rounded border border-line bg-app py-1">
          {dir.entries.map((e) => (
            <div key={e.name} className={cx('flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-white/5')}
              onDoubleClick={() => (e.dir ? go(dir.path + '/' + e.name) : (onClose(), openWorkspace(dir.id, e.name)))}
              onClick={() => e.dir && e.project && (onClose(), openWorkspace(WS_ID(dir.path + '/' + e.name)))}>
              {e.dir ? (e.project ? <FolderOpen size={14} className="text-acc" /> : <Folder size={14} className="text-mute" />) : <FileCode2 size={14} className="text-mute" />}
              <span className="flex-1 truncate">{e.name}</span>
              {e.project && <span className="flex items-center gap-1 rounded bg-acc/15 px-1.5 text-[10px] text-acc"><Star size={10} /> 프로젝트 · 클릭해서 열기</span>}
              {e.html && <span className="text-[10px] text-mute">더블클릭: 이 HTML로 열기</span>}
            </div>
          ))}
          {!dir.entries.length && <div className="p-3 text-mute">비어 있음</div>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Btn onClick={upload}><span className="flex items-center gap-1.5"><Upload size={13} /> 내 컴퓨터 폴더 업로드…</span></Btn>
          <span className="flex-1 text-[11px] text-mute">index.html이 있는 폴더 = 프로젝트. 폴더를 창에 끌어다 놓아도 됩니다.</span>
          <Btn onClick={onClose}>취소</Btn>
          <Btn primary disabled={!dir.hasIndex && !dir.hasProject} onClick={() => { onClose(); openWorkspace(dir.id); }}>이 폴더 열기</Btn>
        </div>
      </>}
    </Modal>
  );
}
const WS_ID = (p) => btoa(unescape(encodeURIComponent(p))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
