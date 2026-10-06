// IndexedDB storage driver. One object store per collection; every commit is a single atomic transaction.
import { ALL, APPEND_ONLY } from '../domain/book.js';

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IdbDriver {
  constructor(name = 'moneyflow') { this.name = name; this.db = null; }
  async open() {
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => { for (const c of ALL) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB blocked'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async load() {
    const t = this.db.transaction(ALL, 'readonly');
    const out = {};
    await Promise.all(ALL.map(async (c) => { out[c] = await req(t.objectStore(c).getAll()); }));
    return out;
  }
  commit(ops) {
    return new Promise((res, rej) => {
      const names = [...new Set(ops.map((o) => o.c))];
      const t = this.db.transaction(names, 'readwrite');
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('transaction aborted'));
      try {
        for (const { op, c, doc } of ops) {
          const s = t.objectStore(c);
          if (op === 'add') s.add(doc);
          else if (APPEND_ONLY.includes(c)) throw new Error(`${c} is append-only`);
          else s.put(doc);
        }
      } catch (e) { try { t.abort(); } catch {} rej(e); }
    });
  }
  replaceAll(data) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(ALL, 'readwrite');
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
      for (const c of ALL) { const s = t.objectStore(c); s.clear(); for (const d of data[c] || []) s.add(d); }
    });
  }
}
