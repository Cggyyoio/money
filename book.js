// The Book: in-memory state + all financial commands. Every command is atomic (one driver commit)
// and append-only for ledger / events / audit / rates.
import { D, S, normalizeNumber, q, mul } from './dec.js';
import { BASE, DEFAULT_CURRENCIES, DEFAULT_CATEGORIES, TX, STATUS, TRANSITIONS, isTrade } from './constants.js';
import { planEntries, validateTx, rateOf } from './engine.js';
import { auditHash, verifyAuditChain, GENESIS } from './audit.js';
import { AppError, deepFreeze, uid, localDay } from './util.js';

export const MUTABLE = ['accounts', 'parties', 'services', 'categories', 'txs', 'debts', 'recurring', 'goals'];
export const APPEND_ONLY = ['ledger', 'events', 'audit', 'rates'];
export const ALL = [...MUTABLE, ...APPEND_ONLY, 'settings', 'meta'];

const pad = (n, w = 6) => String(n).padStart(w, '0');
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; return o; };
const num = (v, label = 'القيمة') => { try { return S(D(normalizeNumber(v))); } catch { throw new AppError(`${label} غير صالحة`); } };
const need = (v, msg) => { if (!String(v ?? '').trim()) throw new AppError(msg); return String(v).trim(); };
const iso = (v, fallback) => { if (!v) return fallback; const d = new Date(v); if (isNaN(d)) throw new AppError('التاريخ غير صالح'); return d.toISOString(); };

const FIELDS = {
  trade: ['amount', 'customerPaid', 'providerCharged', 'receiveAccountId', 'payAccountId', 'partyId', 'serviceId', 'providerId', 'note', 'occurredAt', 'currency'],
  single: ['amount', 'accountId', 'categoryId', 'partyId', 'note', 'occurredAt'],
  internal: ['amount', 'toAmount', 'fromAccountId', 'toAccountId', 'note', 'occurredAt'],
  debt: ['amount', 'accountId', 'partyId', 'note', 'occurredAt', 'dueDate'],
  debt_payment: ['amount', 'accountId', 'note', 'occurredAt'],
};
const fieldsOf = (type) => (isTrade(type) ? FIELDS.trade : type === 'debt_payment' ? FIELDS.debt_payment : FIELDS[TX[type]?.family]) || [];

class Batch {
  constructor(book) {
    this.book = book;
    this.ops = [];
    this.overlay = {};
    this.staged = { ledger: [], events: [], audit: [], rates: [] };
    this.meta = { ...book.meta };
    this.nowISO = book.now().toISOString();
    this.lastAudit = book.audit[book.audit.length - 1];
    this.reversedNow = new Set();
  }
  get(c, id) { return this.overlay[c]?.get(id) ?? this.book[c].get(id); }
  put(c, doc) { (this.overlay[c] ||= new Map()).set(doc.id, doc); this.ops.push({ op: 'put', c, doc }); return doc; }
  add(c, doc) { this.staged[c].push(doc); this.ops.push({ op: 'add', c, doc }); return doc; }
  next(name) { this.meta[name] = (this.meta[name] || 0) + 1; return this.meta[name]; }
  entriesOf(txId) { return [...(this.book.entriesByTx.get(txId) || []), ...this.staged.ledger.filter((e) => e.txId === txId)]; }
  isReversed(id) { return this.book.reversedIds.has(id) || this.reversedNow.has(id); }

  post(txId, drafts, at) {
    for (const d of drafts) {
      const seq = this.next('ledger');
      const e = { id: 'E' + seq, seq, txId, accountId: d.accountId, kind: d.kind, amount: S(d.amount), currency: d.currency, rate: S(d.rate, 8), base: S(d.base), at, createdAt: this.nowISO };
      for (const k of ['scope', 'categoryId', 'serviceId', 'providerId', 'partyId']) if (d[k]) e[k] = d[k];
      this.add('ledger', e);
    }
  }
  /** Reverse every still-active entry of a tx. mode 'orig' keeps the original effective date, 'now' dates it today. */
  reverse(txId, mode) {
    for (const e of this.entriesOf(txId)) {
      if (e.reversesId || this.isReversed(e.id)) continue;
      const seq = this.next('ledger');
      this.add('ledger', { ...e, id: 'E' + seq, seq, amount: S(-D(e.amount)), base: S(-D(e.base)), reversesId: e.id, at: mode === 'orig' ? e.at : this.nowISO, createdAt: this.nowISO });
      this.reversedNow.add(e.id);
    }
  }
  event(txId, type, data, reason) {
    const seq = this.next('event');
    this.add('events', clean({ id: 'V' + seq, seq, txId, type, at: this.nowISO, data, reason }));
  }
  audit(action, entity, entityId, oldV, newV, reason) {
    const seq = this.next('audit');
    const prev = this.lastAudit?.hash ?? GENESIS;
    const e = { id: 'A' + seq, seq, at: this.nowISO, action, entity, entityId: entityId ?? null, old: oldV ?? null, new: newV ?? null, reason: reason || null, device: this.book.device, prevHash: prev };
    e.hash = auditHash(prev, e);
    this.lastAudit = e;
    this.add('audit', e);
  }
}

export class Book {
  constructor(driver, { now = () => new Date(), device = 'device' } = {}) {
    this.driver = driver; this.now = now; this.device = device;
    this._q = Promise.resolve(); this._subs = new Set();
  }

  // ---------- lifecycle ----------
  async init() {
    this._hydrate(await this.driver.load());
    if (!this.meta) await this._seed();
    return this;
  }
  async reload() { this._hydrate(await this.driver.load()); this._emit(); }
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _emit() { for (const f of this._subs) { try { f(); } catch (e) { console.error(e); } } }

  _hydrate(data) {
    for (const c of MUTABLE) this[c] = new Map((data[c] || []).map((d) => [d.id, deepFreeze(d)]));
    const bySeq = (a, b) => a.seq - b.seq;
    this.ledger = (data.ledger || []).map(deepFreeze).sort(bySeq);
    this.events = (data.events || []).map(deepFreeze).sort(bySeq);
    this.audit = (data.audit || []).map(deepFreeze).sort(bySeq);
    this.ratesList = (data.rates || []).map(deepFreeze).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    this.settings = data.settings?.[0] ? deepFreeze(data.settings[0]) : null;
    this.meta = data.meta?.[0] ? deepFreeze(data.meta[0]) : null;
    this.entriesByTx = new Map(); this.reversedIds = new Set(); this.bal = new Map();
    for (const e of this.ledger) this._indexEntry(e);
    this._indexRates();
  }
  _indexEntry(e) {
    let l = this.entriesByTx.get(e.txId); if (!l) this.entriesByTx.set(e.txId, (l = []));
    l.push(e);
    if (e.reversesId) this.reversedIds.add(e.reversesId);
    if (e.accountId) this.bal.set(e.accountId, (this.bal.get(e.accountId) || 0n) + D(e.amount));
  }
  _indexRates() {
    this.ratesByCcy = new Map();
    for (const r of this.ratesList) {
      let l = this.ratesByCcy.get(r.ccy); if (!l) this.ratesByCcy.set(r.ccy, (l = []));
      l.push({ at: r.at, rateBig: D(r.rate), id: r.id });
    }
  }

  async _seed() {
    await this._run((b) => {
      b.meta = { id: 'meta', schema: 1, ledger: 0, tx: 0, event: 0, audit: 0, rate: 0, seq: 0 };
      b.put('settings', { id: 'settings', baseCurrency: BASE, currencies: DEFAULT_CURRENCIES, hideDecimals: false, dismissed: [], lastBackupAt: null, autoLockMin: 5, theme: 'auto', lock: null, pin: null, createdAt: b.nowISO });
      for (const [scope, names] of Object.entries(DEFAULT_CATEGORIES)) for (const name of names) b.put('categories', { id: uid(), scope, name, archived: false });
      b.audit('system.init', 'system', null, null, { schema: 1 }, null);
    });
  }

  /** Serialised atomic command: build a batch synchronously, persist it, then apply to memory. */
  _run(fn) {
    const p = this._q.then(async () => {
      const b = new Batch(this);
      const result = fn(b);
      b.ops.push({ op: 'put', c: 'meta', doc: { ...b.meta, id: 'meta' } });
      await this.driver.commit(b.ops);
      this._apply(b);
      this._emit();
      return result;
    });
    this._q = p.catch(() => {});
    return p;
  }
  _apply(b) {
    for (const { op, c, doc } of b.ops) {
      deepFreeze(doc);
      if (c === 'settings') this.settings = doc;
      else if (c === 'meta') this.meta = doc;
      else if (MUTABLE.includes(c)) this[c].set(doc.id, doc);
      else if (c === 'ledger') { this.ledger.push(doc); this._indexEntry(doc); }
      else if (c === 'rates') { this.ratesList.push(doc); this._indexRates(); }
      else this[c].push(doc);
    }
  }
  _ctx(at) {
    return { accounts: this.accounts, debts: this.debts, parties: this.parties, categories: this.categories, currencies: this.settings.currencies, rateOf: (c, a) => rateOf(this.ratesByCcy, c, a), now: this.now(), at };
  }

  // ---------- queries ----------
  balanceBig(accountId) { return this.bal.get(accountId) || 0n; }
  rateNow(ccy) { return rateOf(this.ratesByCcy, ccy, '9999'); }
  /** Current EGP valuation of an account (latest rate). */
  valueBig(accountId) { const a = this.accounts.get(accountId); return q(mul(this.balanceBig(accountId), this.rateNow(a.currency))); }
  activeEntries(txId) { return (this.entriesByTx.get(txId) || []).filter((e) => !e.reversesId && !this.reversedIds.has(e.id)); }
  txList() { return [...this.txs.values()].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.seq - a.seq)); }
  paymentsOf(debtId) { return [...this.txs.values()].filter((t) => t.type === 'debt_payment' && t.debtId === debtId && t.status === 'completed'); }
  debtRemainingBig(debt) { return D(debt.principal) - this.paymentsOf(debt.id).reduce((s, t) => s + D(t.amount), 0n); }
  debtStatus(debt) {
    const origin = this.txs.get(debt.originTxId);
    if (origin && origin.status !== 'completed') return 'cancelled';
    return this.debtRemainingBig(debt) <= 0n ? 'paid' : 'open';
  }
  eventsOf(txId) { return this.events.filter((e) => e.txId === txId); }
  /** What can be done with a transaction right now (drives the UI buttons). */
  actions(tx) {
    const fam = TX[tx.type]?.family;
    const sys = fam === 'system' || tx.type === 'adjustment';
    const a = { complete: false, fail: false, cancel: false, refund: false, amend: false, why: '' };
    if (sys) { a.why = 'عملية نظام لا يمكن حذفها أو تعديلها — استخدم تسوية جديدة عند الحاجة'; return a; }
    const next = TRANSITIONS[tx.status] || [];
    a.complete = next.includes('completed'); a.fail = next.includes('failed'); a.cancel = next.includes('cancelled');
    a.refund = next.includes('refunded') && isTrade(tx.type);
    a.amend = tx.status === 'pending' || tx.status === 'completed';
    if ((tx.type === 'debt_to_me' || tx.type === 'debt_on_me') && this.paymentsOf(tx.debtId).length) {
      a.cancel = false; a.amend = false; a.why = 'للدين مدفوعات — ألغِ المدفوعات أولًا';
    }
    return a;
  }

  // ---------- accounts / master data ----------
  createAccount(input) {
    return this._run((b) => {
      const name = need(input.name, 'اسم الحساب مطلوب');
      const currency = need(input.currency || BASE, 'العملة مطلوبة');
      if (!this.settings.currencies.includes(currency)) throw new AppError('عملة غير مدعومة');
      if ([...this.accounts.values()].some((a) => !a.archived && a.name.toLowerCase() === name.toLowerCase())) throw new AppError('يوجد حساب بنفس الاسم');
      const at = iso(input.openingAt, b.nowISO);
      const ctx = this._ctx(at);
      const rate = ctx.rateOf(currency, at); // throws if no rate
      const opening = num(input.opening || '0', 'الرصيد الافتتاحي');
      if (D(opening) < 0n) throw new AppError('الرصيد الافتتاحي لا يمكن أن يكون سالبًا');
      const acc = b.put('accounts', clean({
        id: uid(), name, type: input.type || 'wallet', currency, opening, openingAt: at, createdAt: b.nowISO, notes: (input.notes || '').trim(),
        active: true, archived: false, lowBalanceAlert: input.lowBalanceAlert ? num(input.lowBalanceAlert) : undefined,
      }));
      if (D(opening) > 0n) {
        const seq = b.next('tx');
        const tx = b.put('txs', { id: uid(), seq, number: 'T-' + pad(seq), type: 'opening', status: 'completed', accountId: acc.id, currency, amount: opening, occurredAt: at, createdAt: b.nowISO, completedAt: b.nowISO, version: 1 });
        b.post(tx.id, planEntries(tx, { ...ctx, accounts: new Map([[acc.id, acc]]) }), at);
        b.event(tx.id, 'created', { status: 'completed' });
      }
      void rate;
      b.audit('account.create', 'account', acc.id, null, { name, currency, opening }, null);
      return acc;
    });
  }
  updateAccount(id, patch) {
    return this._run((b) => {
      const old = this.accounts.get(id); if (!old) throw new AppError('الحساب غير موجود');
      const nw = { ...old };
      if ('name' in patch) {
        nw.name = need(patch.name, 'اسم الحساب مطلوب');
        if ([...this.accounts.values()].some((a) => a.id !== id && !a.archived && a.name.toLowerCase() === nw.name.toLowerCase())) throw new AppError('يوجد حساب بنفس الاسم');
      }
      if ('notes' in patch) nw.notes = (patch.notes || '').trim();
      if ('type' in patch) nw.type = patch.type;
      if ('active' in patch) nw.active = !!patch.active;
      if ('lowBalanceAlert' in patch) nw.lowBalanceAlert = patch.lowBalanceAlert ? num(patch.lowBalanceAlert) : undefined;
      clean(nw);
      b.put('accounts', nw);
      b.audit('account.update', 'account', id, pickChanged(old, nw), pickChanged(nw, old), patch.reason);
      return nw;
    });
  }
  addParty(input) {
    return this._run((b) => {
      const name = need(input.name, 'الاسم مطلوب');
      if (!['customer', 'supplier', 'provider'].includes(input.kind)) throw new AppError('نوع غير صالح');
      const p = b.put('parties', clean({ id: uid(), kind: input.kind, name, phone: (input.phone || '').trim(), notes: (input.notes || '').trim(), createdAt: b.nowISO, archived: false }));
      b.audit('party.create', 'party', p.id, null, { kind: p.kind, name }, null);
      return p;
    });
  }
  updateParty(id, patch) {
    return this._run((b) => {
      const old = this.parties.get(id); if (!old) throw new AppError('غير موجود');
      const nw = clean({ ...old, name: 'name' in patch ? need(patch.name, 'الاسم مطلوب') : old.name, phone: 'phone' in patch ? (patch.phone || '').trim() : old.phone, notes: 'notes' in patch ? (patch.notes || '').trim() : old.notes, archived: 'archived' in patch ? !!patch.archived : old.archived });
      b.put('parties', nw); b.audit('party.update', 'party', id, pickChanged(old, nw), pickChanged(nw, old), null);
      return nw;
    });
  }
  addService(input) {
    return this._run((b) => {
      const s = b.put('services', clean({ id: uid(), name: need(input.name, 'اسم الخدمة مطلوب'), providerId: input.providerId, archived: false }));
      b.audit('service.create', 'service', s.id, null, { name: s.name }, null); return s;
    });
  }
  addCategory(input) {
    return this._run((b) => {
      if (!['personal', 'business', 'income'].includes(input.scope)) throw new AppError('نوع التصنيف غير صالح');
      const c = b.put('categories', { id: uid(), scope: input.scope, name: need(input.name, 'اسم التصنيف مطلوب'), archived: false });
      b.audit('category.create', 'category', c.id, null, { scope: c.scope, name: c.name }, null); return c;
    });
  }
  addCurrency(code) {
    return this._run((b) => {
      code = String(code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new AppError('رمز العملة غير صالح (2–6 حروف/أرقام)');
      if (this.settings.currencies.includes(code)) throw new AppError('العملة موجودة');
      const nw = { ...this.settings, currencies: [...this.settings.currencies, code] };
      b.put('settings', nw); b.audit('currency.add', 'settings', 'settings', null, { code }, null);
    });
  }
  addRate(input) {
    return this._run((b) => {
      const ccy = String(input.ccy || '').toUpperCase();
      if (ccy === BASE || !this.settings.currencies.includes(ccy)) throw new AppError('اختر عملة غير العملة الأساسية');
      const rate = num(input.rate, 'سعر الصرف');
      if (D(rate) <= 0n) throw new AppError('سعر الصرف يجب أن يكون أكبر من صفر');
      const seq = b.next('rate');
      const r = b.add('rates', clean({ id: 'R' + pad(seq), ccy, rate, at: iso(input.at, b.nowISO), note: (input.note || '').trim(), createdAt: b.nowISO }));
      b.audit('rate.add', 'rate', r.id, null, { ccy, rate }, null);
      return r;
    });
  }

  // ---------- transactions ----------
  _normalize(input, type) {
    const t = { type };
    const f = TX[type].family;
    const txt = (k) => { if (input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== '') t[k] = String(input[k]).trim(); };
    t.occurredAt = iso(input.occurredAt, this.now().toISOString());
    txt('note');
    if (f === 'trade') {
      t.amount = num(input.amount, 'قيمة العملية');
      t.customerPaid = num(input.customerPaid ?? '0', 'المبلغ الذي دفعه العميل');
      t.providerCharged = num(input.providerCharged ?? '0', 'المبلغ الذي خصمته الشركة');
      ['receiveAccountId', 'payAccountId', 'partyId', 'serviceId', 'providerId'].forEach(txt);
      t.currency = input.currency || this.accounts.get(t.receiveAccountId)?.currency || this.accounts.get(t.payAccountId)?.currency || BASE;
    } else if (f === 'single') {
      t.amount = num(input.amount, 'المبلغ'); ['accountId', 'categoryId', 'partyId'].forEach(txt);
      t.currency = this.accounts.get(t.accountId)?.currency || BASE;
    } else if (f === 'internal') {
      t.amount = num(input.amount, 'المبلغ'); ['fromAccountId', 'toAccountId'].forEach(txt);
      const from = this.accounts.get(t.fromAccountId), to = this.accounts.get(t.toAccountId);
      t.currency = from?.currency || BASE;
      t.toAmount = from && to && from.currency === to.currency ? t.amount : num(input.toAmount ?? '0', 'المبلغ المستلم');
    } else if (f === 'debt') {
      t.amount = num(input.amount, 'المبلغ'); ['accountId', 'partyId', 'dueDate', 'debtId'].forEach(txt);
      t.currency = input.currency || this.accounts.get(t.accountId)?.currency || BASE;
    }
    return t;
  }
  _newTx(b, t, status) {
    const seq = b.next('tx');
    return { id: uid(), seq, number: 'T-' + pad(seq), status, createdAt: b.nowISO, version: 1, ...t };
  }
  _finalizeNew(b, tx) {
    const errs = validateTx(tx, this._ctx(tx.occurredAt));
    if (errs.length) throw new AppError(errs.join('، '));
    if (tx.status === 'completed') {
      tx = { ...tx, completedAt: b.nowISO };
      b.post(tx.id, planEntries(tx, this._ctx(tx.occurredAt)), tx.occurredAt);
    }
    b.put('txs', clean({ ...tx }));
    b.event(tx.id, 'created', { status: tx.status });
    if (tx.status === 'completed') b.event(tx.id, 'completed', {});
    b.audit('tx.create', 'tx', tx.id, null, { number: tx.number, type: tx.type, amount: tx.amount, status: tx.status }, null);
    return tx;
  }
  createTx(input) {
    return this._run((b) => {
      const type = input.type;
      if (!TX[type] || ['opening', 'adjustment', 'debt_payment', 'debt_to_me', 'debt_on_me'].includes(type)) throw new AppError('نوع عملية غير صالح');
      const status = input.status === 'pending' && isTrade(type) ? 'pending' : 'completed';
      return this._finalizeNew(b, this._newTx(b, this._normalize(input, type), status));
    });
  }
  completeTx(id) {
    return this._run((b) => {
      const tx = this._mustTx(id);
      if (!TRANSITIONS[tx.status].includes('completed')) throw new AppError('لا يمكن إكمال هذه العملية');
      const errs = validateTx(tx, this._ctx(b.nowISO));
      if (errs.length) throw new AppError(errs.join('، '));
      b.post(tx.id, planEntries(tx, this._ctx(b.nowISO)), b.nowISO); // money moves now
      const nw = { ...tx, status: 'completed', completedAt: b.nowISO };
      b.put('txs', nw); b.event(id, 'completed', {}); b.audit('tx.complete', 'tx', id, { status: tx.status }, { status: 'completed' }, null);
      return nw;
    });
  }
  failTx(id, reason) {
    return this._run((b) => {
      const tx = this._mustTx(id); reason = need(reason, 'اكتب سبب الفشل');
      if (!TRANSITIONS[tx.status].includes('failed')) throw new AppError('لا يمكن تحديد هذه العملية كفاشلة');
      b.put('txs', { ...tx, status: 'failed' }); b.event(id, 'failed', {}, reason); b.audit('tx.fail', 'tx', id, { status: tx.status }, { status: 'failed' }, reason);
    });
  }
  cancelTx(id, reason) {
    return this._run((b) => {
      const tx = this._mustTx(id); reason = need(reason, 'اكتب سبب الإلغاء');
      const a = this.actions(tx);
      if (!a.cancel) throw new AppError(a.why || 'لا يمكن إلغاء هذه العملية');
      if (tx.status === 'completed') b.reverse(id, 'orig'); // correction: effect removed from its own period
      b.put('txs', { ...tx, status: 'cancelled', cancelledAt: b.nowISO });
      b.event(id, 'cancelled', {}, reason); b.audit('tx.cancel', 'tx', id, { status: tx.status }, { status: 'cancelled' }, reason);
    });
  }
  refundTx(id, reason) {
    return this._run((b) => {
      const tx = this._mustTx(id); reason = need(reason, 'اكتب سبب الاسترداد');
      if (!this.actions(tx).refund) throw new AppError('لا يمكن استرداد هذه العملية');
      b.reverse(id, 'now'); // a refund is a real later event: dated today
      b.put('txs', { ...tx, status: 'refunded', refundedAt: b.nowISO });
      b.event(id, 'refunded', {}, reason); b.audit('tx.refund', 'tx', id, { status: tx.status }, { status: 'refunded' }, reason);
    });
  }
  amendTx(id, patch, reason) {
    return this._run((b) => {
      const tx = this._mustTx(id); reason = need(reason, 'اكتب سبب التعديل');
      if (!this.actions(tx).amend) throw new AppError(this.actions(tx).why || 'لا يمكن تعديل هذه العملية');
      const allowed = fieldsOf(tx.type);
      const merged = { ...tx };
      for (const k of Object.keys(patch)) if (allowed.includes(k)) merged[k] = patch[k];
      const norm = this._normalize({ ...merged, ...patch }, tx.type);
      if (tx.type === 'debt_payment') { norm.debtId = tx.debtId; norm.currency = tx.currency; norm.accountId = merged.accountId; }
      const nw = { ...tx, ...norm, type: tx.type, version: tx.version + 1 };
      for (const k of allowed) if (k in patch && (patch[k] === '' || patch[k] === null)) delete nw[k]; // allow clearing optional fields
      clean(nw);
      if (tx.type === 'debt_payment') {
        const debt = this.debts.get(tx.debtId);
        if (D(nw.amount) > this.debtRemainingBig(debt) + D(tx.amount)) throw new AppError('المبلغ أكبر من المتبقي على الدين');
      }
      const errs = validateTx(nw, this._ctx(nw.occurredAt));
      if (errs.length) throw new AppError(errs.join('، '));
      if (tx.status === 'completed') {
        b.reverse(id, 'orig');
        b.post(id, planEntries(nw, this._ctx(nw.occurredAt)), nw.occurredAt);
      }
      b.put('txs', nw);
      if (tx.type === 'debt_to_me' || tx.type === 'debt_on_me') {
        const d = this.debts.get(tx.debtId);
        b.put('debts', clean({ ...d, principal: nw.amount, partyId: nw.partyId, dueDate: nw.dueDate, currency: nw.currency }));
      }
      const diff = { old: {}, new: {} };
      for (const k of new Set([...Object.keys(tx), ...Object.keys(nw)])) {
        if (['version', 'completedAt'].includes(k)) continue;
        if (JSON.stringify(tx[k]) !== JSON.stringify(nw[k])) { diff.old[k] = tx[k] ?? null; diff.new[k] = nw[k] ?? null; }
      }
      if (!Object.keys(diff.new).length) throw new AppError('لا توجد تغييرات');
      b.event(id, 'amended', diff, reason);
      b.audit('tx.amend', 'tx', id, diff.old, diff.new, reason);
      return nw;
    });
  }
  /** Bring an account's balance to the real one with a documented adjustment. */
  reconcile(accountId, actual, reason, note) {
    return this._run((b) => {
      const acc = this.accounts.get(accountId); if (!acc) throw new AppError('الحساب غير موجود');
      reason = need(reason, 'سبب التسوية مطلوب');
      const computed = this.balanceBig(accountId);
      const diff = D(num(actual, 'الرصيد الفعلي')) - computed;
      if (diff === 0n) throw new AppError('الرصيد مطابق، لا توجد تسوية');
      const seq = b.next('tx');
      const tx = b.put('txs', clean({ id: uid(), seq, number: 'T-' + pad(seq), type: 'adjustment', status: 'completed', accountId, currency: acc.currency, computed: S(computed), actual: S(computed + diff), diff: S(diff), reason, note: (note || '').trim(), occurredAt: b.nowISO, createdAt: b.nowISO, completedAt: b.nowISO, version: 1 }));
      b.post(tx.id, planEntries(tx, this._ctx(b.nowISO)), b.nowISO);
      b.event(tx.id, 'created', { status: 'completed' }, reason);
      b.audit('account.reconcile', 'account', accountId, { balance: S(computed) }, { balance: S(computed + diff) }, reason);
      return tx;
    });
  }
  _mustTx(id) { const t = this.txs.get(id); if (!t) throw new AppError('العملية غير موجودة'); return t; }

  // ---------- debts ----------
  createDebt(input) {
    return this._run((b) => {
      if (!['receivable', 'payable'].includes(input.direction)) throw new AppError('اتجاه الدين غير صالح');
      const type = input.direction === 'receivable' ? 'debt_to_me' : 'debt_on_me';
      const t = this._normalize({ ...input, accountId: input.accountId || undefined }, type);
      const debtId = uid();
      const tx = this._newTx(b, { ...t, debtId }, 'completed');
      const out = this._finalizeNew(b, tx);
      const debt = b.put('debts', clean({ id: debtId, direction: input.direction, partyId: t.partyId, principal: t.amount, currency: t.currency, dueDate: t.dueDate, note: t.note, originTxId: out.id, noCash: !t.accountId, createdAt: b.nowISO }));
      return debt;
    });
  }
  payDebt(debtId, input) {
    return this._run((b) => {
      const debt = this.debts.get(debtId); if (!debt) throw new AppError('الدين غير موجود');
      if (this.debtStatus(debt) !== 'open') throw new AppError('الدين غير مفتوح');
      const amount = num(input.amount, 'المبلغ');
      if (D(amount) > this.debtRemainingBig(debt)) throw new AppError('المبلغ أكبر من المتبقي على الدين');
      const t = { type: 'debt_payment', debtId, amount, currency: debt.currency, accountId: String(input.accountId || ''), occurredAt: iso(input.occurredAt, b.nowISO), partyId: debt.partyId };
      if (input.note) t.note = String(input.note).trim();
      return this._finalizeNew(b, this._newTx(b, t, 'completed'));
    });
  }

  // ---------- recurring ----------
  saveRecurring(input) {
    return this._run((b) => {
      const acc = this.accounts.get(input.accountId); if (!acc) throw new AppError('اختر الحساب');
      const cat = this.categories.get(input.categoryId); if (!cat || cat.scope === 'income') throw new AppError('اختر التصنيف');
      const frequency = ['weekly', 'monthly', 'yearly'].includes(input.frequency) ? input.frequency : 'monthly';
      const day = Math.min(31, Math.max(1, parseInt(input.day, 10) || 1));
      const start = input.startDate || localDay(b.nowISO);
      const old = input.id ? this.recurring.get(input.id) : null;
      const rule = clean({
        id: old?.id || uid(), name: need(input.name, 'اسم المصروف مطلوب'), amount: num(input.amount, 'المبلغ'), accountId: acc.id, categoryId: cat.id,
        scope: cat.scope, frequency, day, month: frequency === 'yearly' ? Math.min(12, Math.max(1, parseInt(input.month, 10) || Number(start.slice(5, 7)))) : undefined,
        mode: input.mode === 'auto' ? 'auto' : 'remind', active: input.active !== false, nextDue: old && !input.startDate ? old.nextDue : firstDue({ frequency, day, month: input.month }, start),
        createdAt: old?.createdAt || b.nowISO,
      });
      if (D(rule.amount) <= 0n) throw new AppError('المبلغ يجب أن يكون أكبر من صفر');
      b.put('recurring', rule); b.audit(old ? 'recurring.update' : 'recurring.create', 'recurring', rule.id, old ? pickChanged(old, rule) : null, pickChanged(rule, old || {}), null);
      return rule;
    });
  }
  dueRecurring(today = localDay(this.now().toISOString())) {
    return [...this.recurring.values()].filter((r) => r.active && r.nextDue <= today).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
  }
  /** Post the oldest due occurrence of a rule (idempotent per rule+date) and advance it. */
  confirmRecurring(ruleId) { return this._run((b) => this._postOccurrence(b, ruleId)); }
  /** Auto rules: post everything that is due. Safe to call on every app start. */
  runRecurring() {
    return this._run((b) => {
      const today = localDay(b.nowISO); let n = 0;
      for (const r of this.recurring.values()) {
        if (!r.active || r.mode !== 'auto') continue;
        for (let i = 0; i < 36; i++) {
          const cur = b.get('recurring', r.id);
          if (!cur || cur.nextDue > today) break;
          try { this._postOccurrence(b, r.id); n++; } catch { break; }
        }
      }
      return n;
    });
  }
  _postOccurrence(b, ruleId) {
    const r = b.get('recurring', ruleId); if (!r) throw new AppError('القاعدة غير موجودة');
    const key = `${r.id}:${r.nextDue}`;
    const dup = [...this.txs.values(), ...(b.overlay.txs ? b.overlay.txs.values() : [])].find((t) => t.recurringKey === key && t.status !== 'cancelled');
    if (!dup) {
      const acc = this.accounts.get(r.accountId);
      const type = r.scope === 'personal' ? 'expense_personal' : 'expense_business';
      const t = { type, amount: r.amount, accountId: r.accountId, categoryId: r.categoryId, currency: acc.currency, note: r.name, occurredAt: iso(r.nextDue + 'T12:00:00'), recurringKey: key };
      this._finalizeNew(b, this._newTx(b, t, 'completed'));
    }
    b.put('recurring', { ...r, nextDue: advanceDue(r), lastRunAt: b.nowISO });
  }

  // ---------- goals ----------
  saveGoal(input) {
    return this._run((b) => {
      const old = input.id ? this.goals.get(input.id) : null;
      const mode = ['total', 'accounts', 'manual'].includes(input.mode) ? input.mode : 'total';
      const g = clean({
        id: old?.id || uid(), name: need(input.name, 'اسم الهدف مطلوب'), target: num(input.target, 'المبلغ المستهدف'), mode,
        accountIds: mode === 'accounts' ? [...(input.accountIds || [])] : undefined, manual: mode === 'manual' ? num(input.manual || '0') : undefined,
        archived: !!input.archived, createdAt: old?.createdAt || b.nowISO,
      });
      if (D(g.target) <= 0n) throw new AppError('المبلغ المستهدف يجب أن يكون أكبر من صفر');
      b.put('goals', g); b.audit(old ? 'goal.update' : 'goal.create', 'goal', g.id, old ? pickChanged(old, g) : null, pickChanged(g, old || {}), null);
      return g;
    });
  }

  // ---------- settings / security / backup ----------
  updateSettings(patch, { audit = true } = {}) {
    return this._run((b) => {
      const allowed = ['hideDecimals', 'autoLockMin', 'theme', 'dismissed', 'lastBackupAt'];
      const nw = { ...this.settings }; const o = {}, n = {};
      for (const k of allowed) if (k in patch && JSON.stringify(patch[k]) !== JSON.stringify(nw[k])) { o[k] = nw[k] ?? null; n[k] = patch[k]; nw[k] = patch[k]; }
      b.put('settings', nw);
      if (audit && Object.keys(n).length) b.audit('settings.update', 'settings', 'settings', o, n, null);
    });
  }
  dismiss(key) { return this.updateSettings({ dismissed: [...new Set([...(this.settings.dismissed || []), key])].slice(-300) }, { audit: false }); }
  setSecurity({ lock, pin }, what) {
    return this._run((b) => {
      const nw = { ...this.settings };
      if (lock !== undefined) nw.lock = lock;
      if (pin !== undefined) nw.pin = pin;
      b.put('settings', nw);
      b.audit('security.update', 'settings', 'settings', null, { changed: what || 'security' }, null);
    });
  }
  /** Plain-JSON dump of everything (for backup). */
  dump() {
    const out = {};
    for (const c of MUTABLE) out[c] = [...this[c].values()];
    out.ledger = this.ledger; out.events = this.events; out.audit = this.audit; out.rates = this.ratesList;
    out.settings = [this.settings]; out.meta = [this.meta];
    return JSON.parse(JSON.stringify(out));
  }
  async replaceAll(data) {
    const p = this._q.then(async () => {
      validateDump(data);
      await this.driver.replaceAll(data);
      this._hydrate(await this.driver.load());
      this._emit();
    });
    this._q = p.catch(() => {});
    await p;
    await this._run((b) => b.audit('backup.restore', 'system', null, null, { ledger: data.ledger.length, audit: data.audit.length }, null));
  }
  noteBackup() { return this._run((b) => { b.put('settings', { ...this.settings, lastBackupAt: b.nowISO }); b.audit('backup.export', 'system', null, null, null, null); }); }
}

export function validateDump(data) {
  if (!data || typeof data !== 'object') throw new AppError('ملف النسخة الاحتياطية غير صالح');
  for (const c of ALL) if (!Array.isArray(data[c])) throw new AppError(`النسخة الاحتياطية ناقصة: ${c}`);
  if (!data.settings[0] || !data.meta[0]) throw new AppError('النسخة الاحتياطية بدون إعدادات');
  const ledger = [...data.ledger].sort((a, b) => a.seq - b.seq);
  if (ledger.some((e, i) => e.seq !== i + 1)) throw new AppError('سجل الحركات المالية في النسخة غير متسلسل (محذوف منه شيء)');
  const chain = verifyAuditChain([...data.audit].sort((a, b) => a.seq - b.seq));
  if (!chain.ok) throw new AppError(`سجل التدقيق في النسخة تم التلاعب به عند السجل ${chain.brokenAt}`);
}

function pickChanged(a, b) {
  const o = {};
  for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) o[k] = a[k];
  return o;
}
const dim = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim(y, m))).padStart(2, '0')}`;
function firstDue(r, start) {
  const [y, m, d] = start.split('-').map(Number);
  if (r.frequency === 'weekly') return start;
  if (r.frequency === 'monthly') { const c = ymd(y, m, r.day); return c >= start ? c : (m === 12 ? ymd(y + 1, 1, r.day) : ymd(y, m + 1, r.day)); }
  const mm = Math.min(12, Math.max(1, parseInt(r.month, 10) || m)); const c = ymd(y, mm, r.day); return c >= start ? c : ymd(y + 1, mm, r.day);
}
function advanceDue(r) {
  const [y, m, d] = r.nextDue.split('-').map(Number);
  if (r.frequency === 'weekly') { const x = new Date(y, m - 1, d + 7); return ymd(x.getFullYear(), x.getMonth() + 1, x.getDate()); }
  if (r.frequency === 'monthly') return m === 12 ? ymd(y + 1, 1, r.day) : ymd(y, m + 1, r.day);
  return ymd(y + 1, r.month || m, r.day);
}
