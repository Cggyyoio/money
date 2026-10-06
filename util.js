export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
export const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
export class AppError extends Error {}

// ---- dates (local time) ----
const pad = (n) => String(n).padStart(2, '0');
export const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const localMonth = (iso) => localDay(iso).slice(0, 7);
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const ALL_FROM = '1970-01-01T00:00:00.000Z';
export const ALL_TO = '9999-12-31T23:59:59.999Z';

/** Named reporting periods → {from,to} ISO (to exclusive). */
export function rangeFor(key, now = new Date(), custom = {}) {
  const today = startOfDay(now);
  let from, to;
  switch (key) {
    case 'today': from = today; to = addDays(today, 1); break;
    case 'yesterday': from = addDays(today, -1); to = today; break;
    case 'last7': from = addDays(today, -6); to = addDays(today, 1); break;
    case 'month': from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 1); break;
    case 'lastMonth': from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case 'year': from = new Date(today.getFullYear(), 0, 1); to = new Date(today.getFullYear() + 1, 0, 1); break;
    case 'custom': from = startOfDay(custom.from || today); to = addDays(startOfDay(custom.to || today), 1); break;
    default: return { from: ALL_FROM, to: ALL_TO, key };
  }
  return { from: from.toISOString(), to: to.toISOString(), key };
}
