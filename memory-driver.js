// In-memory storage driver (tests, and a fallback when IndexedDB is unavailable).
import { ALL, APPEND_ONLY } from '../domain/book.js';

export class MemoryDriver {
  constructor() { this.data = Object.fromEntries(ALL.map((c) => [c, new Map()])); }
  async load() { return Object.fromEntries(ALL.map((c) => [c, [...this.data[c].values()].map((d) => structuredClone(d))])); }
  async commit(ops) {
    const staged = new Map(); // atomic: validate against a staged view, then apply
    const view = (c) => staged.get(c) || staged.set(c, new Map(this.data[c])).get(c);
    for (const { op, c, doc } of ops) {
      if (!ALL.includes(c)) throw new Error('unknown collection ' + c);
      const m = view(c);
      if (op === 'add') { if (m.has(doc.id)) throw new Error(`duplicate key ${c}/${doc.id}`); }
      else if (op === 'put') { if (APPEND_ONLY.includes(c)) throw new Error(`${c} is append-only`); }
      else throw new Error('bad op');
      m.set(doc.id, structuredClone(doc));
    }
    for (const [c, m] of staged) this.data[c] = m;
  }
  async replaceAll(data) {
    this.data = Object.fromEntries(ALL.map((c) => [c, new Map((data[c] || []).map((d) => [d.id, structuredClone(d)]))]));
  }
}
