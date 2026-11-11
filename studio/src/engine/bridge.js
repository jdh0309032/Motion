// Holds the live runtime of the composition viewer (inside its iframe).
let rt = null;
const subs = new Set();
export const getRT = () => rt;
export const setRT = (r) => { rt = r; subs.forEach((f) => f(r)); };
export const onRT = (f) => { subs.add(f); return () => subs.delete(f); };
