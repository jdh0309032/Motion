import { useRef, useState, useEffect } from 'react';
import { Timer } from 'lucide-react';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function IconBtn({ icon: Icon, title, onClick, active, disabled, size = 15, className = '' }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={cx('inline-flex items-center justify-center rounded p-1 transition-colors disabled:opacity-30',
        active ? 'bg-acc/25 text-acc' : 'text-mute hover:text-fg hover:bg-white/5', className)}>
      <Icon size={size} strokeWidth={1.8} />
    </button>
  );
}

export function Btn({ children, onClick, primary, className = '', title, disabled }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={cx('rounded px-2.5 py-1 text-[12px] border transition-colors disabled:opacity-40',
        primary ? 'bg-acc border-acc text-white hover:brightness-110' : 'bg-panel2 border-line hover:border-mute', className)}>
      {children}
    </button>
  );
}

/** After-Effects style scrubbable number: drag horizontally, click to type. Shift ×10, Ctrl ×0.1. */
export function ScrubNumber({ value, onChange, onCommit, step = 1, min = -Infinity, max = Infinity, unit = '', decimals, className = '', animated }) {
  const [edit, setEdit] = useState(null);
  const drag = useRef(null);
  const dec = decimals ?? (step < 0.1 ? 3 : step < 1 ? 2 : 1);
  const shown = typeof value === 'number' ? +value.toFixed(dec) : value ?? '—';
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const down = (e) => {
    if (e.button !== 0 || typeof value !== 'number') return;
    drag.current = { x: e.clientX, v: value, moved: false };
    const move = (ev) => {
      const d = drag.current; const dx = ev.clientX - d.x;
      if (Math.abs(dx) > 2) d.moved = true;
      if (!d.moved) return;
      const k = ev.shiftKey ? 10 : ev.ctrlKey || ev.metaKey ? 0.1 : 1;
      onChange(clamp(+(d.v + dx * step * k).toFixed(4)));
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!drag.current.moved) setEdit(String(shown)); else onCommit?.();
      drag.current = null;
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  if (edit !== null)
    return (
      <input autoFocus value={edit} onChange={(e) => setEdit(e.target.value)}
        onBlur={() => { const v = parseFloat(edit); if (!isNaN(v)) { onChange(clamp(v)); onCommit?.(); } setEdit(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEdit(null); e.stopPropagation(); }}
        className={cx('num w-16 rounded bg-app px-1 text-acc outline outline-1 outline-acc', className)} />
    );
  return (
    <span onPointerDown={down} title="드래그로 조절 · 클릭해서 입력 (Shift ×10, Ctrl ×0.1)"
      className={cx('num cursor-ew-resize whitespace-nowrap', animated ? 'text-key' : 'text-acc', className)}>
      {shown}{unit}
    </span>
  );
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1 }) {
  return (
    <input type="range" min={min} max={max} step={step} value={typeof value === 'number' ? value : 0}
      onChange={(e) => onChange(+e.target.value)} className="h-1 w-full accent-[#4f9dff]" />
  );
}

export function ColorInput({ value, onChange }) {
  return (
    <label className="relative inline-flex h-5 w-9 cursor-pointer overflow-hidden rounded border border-line" style={{ background: value }}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0" />
    </label>
  );
}

export function Stopwatch({ on, onClick }) {
  return (
    <button onClick={onClick} title={on ? '애니메이션 해제' : '키프레임 애니메이션 시작'}
      className={cx('shrink-0 rounded p-0.5', on ? 'text-key' : 'text-mute/60 hover:text-fg')}>
      <Timer size={13} strokeWidth={2} />
    </button>
  );
}

export function Section({ title, right, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <div className="flex cursor-pointer items-center gap-1 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute hover:text-fg" onClick={() => setOpen(!open)}>
        <span className={cx('inline-block transition-transform', open && 'rotate-90')}>▸</span>
        <span className="flex-1">{title}</span>
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 460 }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55" onPointerDown={onClose}>
      <div className="rounded-lg border border-line bg-panel shadow-2xl" style={{ width }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{title}</div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children }) => (
  <label className="mb-2 grid grid-cols-[110px_1fr] items-center gap-2">
    <span className="text-mute">{label}</span>{children}
  </label>
);
export const TextIn = (p) => <input {...p} onKeyDown={(e) => { e.stopPropagation(); p.onKeyDown?.(e); }} className={cx('rounded border border-line bg-app px-1.5 py-0.5 outline-none focus:border-acc', p.className)} />;
export const Select = ({ value, onChange, options, className = '' }) => (
  <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cx('rounded border border-line bg-app px-1 py-0.5 outline-none focus:border-acc', className)}>
    {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
  </select>
);

export const fmtTime = (t, fps) => {
  const f = Math.round(t * fps), s = Math.floor(f / fps), fr = f % fps;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
};
