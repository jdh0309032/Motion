import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { useStore, fileText } from '../store.js';
import { loadFile, editFile, addLayer } from '../engine/actions.js';
import { hasParams } from '../engine/codeparams.js';
import * as WS from '../engine/workspace.js';
import { cx } from './ui.jsx';
import { FileCode2, FileText, Folder, Braces } from 'lucide-react';

const S = () => useStore.getState();
const TEXT = /\.(html?|m?js|css|json|glsl|frag|vert|txt|md|svg)$/i;
const lang = (p) => (/\.html?$/i.test(p) ? html() : /\.css$/i.test(p) ? css() : /\.(m?js|json)$/i.test(p) ? javascript() : []);

/** Project files + code editor. Edits are undoable, written to disk and hot-reloaded into the preview. */
export default function CodeEditor() {
  const ws = useStore((s) => s.project.workspace);
  const [files, setFiles] = useState([]);
  const [open, setOpen] = useState(null);
  const host = useRef(null), view = useRef(null), applying = useRef(false);
  const text = useStore((s) => (open ? fileText(s, open) : null));
  const dirty = useStore((s) => s.project.files);

  useEffect(() => { if (ws) WS.tree(ws.id).then((r) => { setFiles(r.files); setOpen((o) => o || r.files.find((f) => /main\.m?js$/.test(f.path))?.path || ws.entry); }); }, [ws?.id]); // eslint-disable-line
  useEffect(() => { if (open) loadFile(open); }, [open]);

  // (re)create the editor when the file changes
  useEffect(() => {
    if (!host.current || !open || text == null) return;
    view.current?.destroy();
    let timer;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [basicSetup, lang(open), oneDark, EditorView.theme({ '&': { height: '100%', fontSize: '12.5px' }, '.cm-scroller': { fontFamily: 'JetBrains Mono, ui-monospace, monospace' } }),
          keymap.of([{ key: 'Mod-s', run: () => { clearTimeout(timer); editFile(open, view.current.state.doc.toString()); S().toast('저장됨 → 미리보기 갱신'); return true; } }]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || applying.current) return;
            clearTimeout(timer);
            timer = setTimeout(() => editFile(open, u.state.doc.toString(), 'code-' + open), 600);
          })],
      }),
    });
    return () => { clearTimeout(timer); };
  }, [open, text == null]); // eslint-disable-line

  // external changes (param edits, undo) → editor
  useEffect(() => {
    const v = view.current; if (!v || text == null) return;
    const cur = v.state.doc.toString();
    if (cur !== text) { applying.current = true; v.dispatch({ changes: { from: 0, to: cur.length, insert: text } }); applying.current = false; }
  }, [text]);

  if (!ws) return <div className="grid h-full place-items-center text-mute">코드 편집은 폴더 프로젝트에서 사용할 수 있습니다 (파일 → 폴더 열기)</div>;
  const dirs = {};
  for (const f of files) { const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''; (dirs[d] ||= []).push(f); }
  const codeLayerFor = (p) => S().project.layers.find((l) => l.type === 'code' && l.content.file === p);
  return (
    <div className="flex h-full min-h-0">
      <div className="w-[220px] shrink-0 overflow-y-auto border-r border-line bg-panel py-1 text-[12px]">
        {Object.keys(dirs).sort().map((d) => (
          <div key={d}>
            {d && <div className="flex items-center gap-1 px-2 pt-1.5 text-[11px] text-mute"><Folder size={12} /> {d}</div>}
            {dirs[d].map((f) => {
              const name = f.path.split('/').pop(), editable = TEXT.test(name);
              return (
                <div key={f.path} onClick={() => editable && setOpen(f.path)} title={f.path}
                  className={cx('flex items-center gap-1.5 truncate py-0.5 pr-2', d ? 'pl-5' : 'pl-2', editable ? 'cursor-pointer hover:bg-white/5' : 'text-mute/60', open === f.path && 'bg-acc/20 text-fg')}>
                  {/\.(m?js|html?|css)$/i.test(name) ? <FileCode2 size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
                  <span className="truncate">{name}</span>
                  {dirty?.[f.path] != null && <span className="ml-auto text-key">●</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2 text-[11px] text-mute">
          <span className="font-mono text-fg">{open}</span>
          <span>· 입력 0.6초 후 자동 저장 · Ctrl+S 즉시 · Ctrl+Z 되돌리기는 에디터 밖에서도 가능</span>
          <span className="flex-1" />
          {open && /\.m?js$/.test(open) && text && hasParams(text) && !codeLayerFor(open) && (
            <button className="flex items-center gap-1 rounded bg-violet-500/20 px-2 py-0.5 text-violet-200 hover:bg-violet-500/30"
              onClick={() => addLayer('code', { name: open.split('/').pop(), content: { file: open } })}><Braces size={12} /> 타임라인에 코드 레이어로 추가</button>
          )}
        </div>
        <div ref={host} className="min-h-0 flex-1 overflow-hidden" onKeyDown={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}
