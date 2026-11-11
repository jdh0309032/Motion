import { create } from 'zustand';
import { createProject } from './engine/project.js';

const clone = (x) => structuredClone(x);
let lastMerge = { key: null, at: 0 };

export const useStore = create((set, get) => ({
  project: createProject(),
  assets: {},                 // id → { id, name, kind: image|audio, url (data URL), meta }
  past: [], future: [],
  time: 0, playing: false,
  sel: { layers: [], keys: [], path: null },   // keys: "target|path|keyId"; path: {target, path}
  ui: { graph: false, expanded: {}, pxPerSec: 140, scrollX: 0, snap: true, beatSnap: false, viewZoom: 'fit', guides: true, panel: 'project' },
  status: '', busy: null, rev: 0, structureRev: 0,

  /** Apply an edit with undo. opts.merge coalesces rapid edits (slider drags). opts.structure → runtime re-sync. */
  mutate(fn, opts = {}) {
    const { project, past } = get();
    const draft = clone(project);
    fn(draft);
    const now = performance.now();
    const merge = opts.merge && lastMerge.key === opts.merge && now - lastMerge.at < 800;
    lastMerge = { key: opts.merge || null, at: now };
    set((s) => ({
      project: draft, future: [],
      past: merge ? past : [...past.slice(-99), project],
      rev: s.rev + 1, structureRev: opts.structure ? s.structureRev + 1 : s.structureRev,
    }));
  },
  undo() {
    const { past, project, future } = get(); if (!past.length) return;
    set((s) => ({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], rev: s.rev + 1, structureRev: s.structureRev + 1 }));
  },
  redo() {
    const { past, project, future } = get(); if (!future.length) return;
    set((s) => ({ project: future[0], future: future.slice(1), past: [...past, project], rev: s.rev + 1, structureRev: s.structureRev + 1 }));
  },
  loadProject(project, assets = {}) {
    set((s) => ({ project, assets, past: [], future: [], time: 0, playing: false, sel: { layers: [], keys: [], path: null }, rev: s.rev + 1, structureRev: s.structureRev + 1, sourceRev: (s.sourceRev || 0) + 1 }));
  },
  addAsset(a) { set((s) => ({ assets: { ...s.assets, [a.id]: a } })); },
  removeAsset(id) { set((s) => { const a = { ...s.assets }; delete a[id]; return { assets: a }; }); },
  setTime(t) { const { project } = get(); set({ time: Math.max(0, Math.min(project.duration, t)) }); },
  setPlaying(p) { set({ playing: p }); },
  select(sel) { set((s) => ({ sel: { ...s.sel, ...sel } })); },
  setUi(u) { set((s) => ({ ui: { ...s.ui, ...(typeof u === 'function' ? u(s.ui) : u) } })); },
  toast(status) { set({ status }); clearTimeout(get()._tt); set({ _tt: setTimeout(() => set({ status: '' }), 3500) }); },
  setBusy(busy) { set({ busy }); },
}));

export const targetOf = (project, id) => (id === 'comp' ? { ...project.comp, id: 'comp', type: 'comp', name: 'Composition', props: {} } : project.layers.find((l) => l.id === id));
/** Mutable target inside a draft project. */
export const draftTarget = (draft, id) => (id === 'comp' ? draft.comp : draft.layers.find((l) => l.id === id));
