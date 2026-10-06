// All reports are derived from the ledger (+ transaction/debt docs). Nothing here is stored.
import { D, S, mul, div, q, abs, ONE } from './dec.js';
import { BASE, KIND, TX, isTrade } from './constants.js';
import { localDay, localMonth, addDays, startOfDay } from './util.js';

const inR = (e, r) => e.at >= r.from && e.at < r.to;
const moneyEntries = (book) => book.ledger.filter((e) => e.accountId);
const add = (m, k, v) => m.set(k, (m.get(k) || 0n) + v);
const sumBase = (arr) => arr.reduce((s, e) => s + D(e.base), 0n);

export function totalMoney(book) {
  let t = 0n;
  for (const a of book.accounts.values()) t += book.valueBig(a.id);
  return t;
}
export function debtTotals(book) {
  let rec = 0n, pay = 0n;
  for (const d of book.debts.values()) {
    if (book.debtStatus(d) !== 'open') continue;
    const v = q(mul(book.debtRemainingBig(d), book.rateNow(d.currency)));
    if (d.direction === 'receivable') rec += v; else pay += v;
  }
  return { receivable: rec, payable: pay };
}
export function netWorth(book) {
  const m = totalMoney(book), { receivable, payable } = debtTotals(book);
  return { money: m, receivable, payable, net: m + receivable - payable };
}

export function profitReport(book, r) {
  const memo = book.ledger.filter((e) => KIND[e.kind] === 'memo' && inR(e, r));
  let volume = 0n, gross = 0n, commission = 0n, count = 0;
  const groups = { service: new Map(), provider: new Map(), customer: new Map() };
  const daily = new Map();
  for (const e of memo) {
    const v = D(e.base);
    const slot = e.kind === 'memo_volume' ? 'volume' : e.kind === 'memo_gross' ? 'gross' : 'commission';
    if (slot === 'volume') { volume += v; count += e.reversesId ? -1 : 1; }
    else if (slot === 'gross') gross += v; else commission += v;
    for (const [g, key] of [['service', e.serviceId], ['provider', e.providerId], ['customer', e.partyId]]) {
      const m = groups[g]; const k = key || '—';
      if (!m.has(k)) m.set(k, { volume: 0n, gross: 0n, commission: 0n });
      m.get(k)[slot] += v;
    }
    if (slot !== 'volume') add(daily, localDay(e.at), slot === 'gross' ? v : -v);
  }
  const fin = (o) => ({ ...o, net: o.gross - o.commission });
  const list = (m) => [...m.entries()].map(([id, o]) => ({ id, ...fin(o) })).sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));
  return { volume, gross, commission, net: gross - commission, count, byService: list(groups.service), byProvider: list(groups.provider), byCustomer: list(groups.customer), daily };
}

export function expenseReport(book, r) {
  const rows = book.ledger.filter((e) => e.kind === 'expense' && inR(e, r));
  const scope = { personal: 0n, business: 0n };
  const byCategory = { personal: new Map(), business: new Map() };
  const byAccount = new Map(), byDay = new Map(), byMonth = new Map();
  for (const e of rows) {
    const v = -D(e.base);
    scope[e.scope] += v;
    add(byCategory[e.scope], e.categoryId || '—', v);
    add(byAccount, e.accountId, v);
    add(byDay, localDay(e.at), v); add(byMonth, localMonth(e.at), v);
  }
  return { personal: scope.personal, business: scope.business, total: scope.personal + scope.business, byCategory, byAccount, byDay, byMonth };
}

export function incomeReport(book, r) {
  let income = 0n, deposits = 0n, withdrawals = 0n;
  for (const e of book.ledger) {
    if (!e.accountId || !inR(e, r)) continue;
    if (e.kind === 'income') income += D(e.base);
    else if (e.kind === 'deposit') deposits += D(e.base);
    else if (e.kind === 'withdrawal') withdrawals += -D(e.base);
  }
  return { income, deposits, withdrawals };
}

/** Per-account statement for a period, in each account's own currency. */
export function walletsReport(book, r) {
  const rows = [];
  for (const a of book.accounts.values()) {
    let open = 0n, inn = 0n, out = 0n, tr = 0n;
    for (const e of book.ledger) {
      if (e.accountId !== a.id) continue;
      const v = D(e.amount);
      if (e.at < r.from) open += v;
      else if (e.at < r.to) { if (KIND[e.kind] === 'transfer') tr += v; else if (v >= 0n) inn += v; else out += v; }
    }
    rows.push({ account: a, opening: open, in: inn, out, transfers: tr, closing: open + inn + out + tr, valueNow: book.valueBig(a.id) });
  }
  return rows;
}

/** The comprehensive statement (frozen EGP basis) — it must always add up exactly. */
export function summaryReport(book, r) {
  let start = 0n, end = 0n;
  const part = { opening: 0n, income: 0n, profit: 0n, expense: 0n, deposit: 0n, withdrawal: 0n, debt: 0n, adjustment: 0n, transfer: 0n };
  for (const e of moneyEntries(book)) {
    const v = D(e.base);
    if (e.at < r.from) start += v;
    if (e.at < r.to) end += v;
    if (inR(e, r)) part[KIND[e.kind]] += v;
  }
  const calc = start + Object.values(part).reduce((s, x) => s + x, 0n);
  return { start, parts: part, end, balanced: calc === end, revaluation: totalMoney(book) - sumBase(moneyEntries(book)) };
}

export function dashboard(book, r) {
  const accounts = [...book.accounts.values()].filter((a) => !a.archived).map((a) => ({ account: a, balance: book.balanceBig(a.id), egp: book.valueBig(a.id) }));
  const p = profitReport(book, r), ex = expenseReport(book, r), inc = incomeReport(book, r), debts = debtTotals(book);
  let change = 0n;
  for (const e of moneyEntries(book)) if (inR(e, r) && e.kind !== 'opening') change += D(e.base);
  const pending = [...book.txs.values()].filter((t) => t.status === 'pending').length;
  return { total: totalMoney(book), accounts, profit: p, expenses: ex, income: inc, receivable: debts.receivable, payable: debts.payable, change, pending };
}

// ---------- time series ----------
function debtsAt(book, dayEndISO) {
  let rec = 0n, pay = 0n;
  for (const d of book.debts.values()) {
    const o = book.txs.get(d.originTxId); if (!o) continue;
    const created = o.occurredAt;
    const cancelled = o.cancelledAt && o.status === 'cancelled' ? o.cancelledAt : null;
    if (created >= dayEndISO || (cancelled && cancelled < dayEndISO)) continue;
    let paid = 0n;
    for (const p of book.txs.values()) {
      if (p.type !== 'debt_payment' || p.debtId !== d.id || p.occurredAt >= dayEndISO) continue;
      if (p.status === 'cancelled' && p.cancelledAt < dayEndISO) continue;
      if (p.status === 'completed' || p.status === 'cancelled') paid += D(p.amount);
    }
    const principal = D(d.principal);
    const baseP = q(mul(principal, rateLookup(book, d.currency, created)));
    const remain = principal - paid;
    if (remain <= 0n || principal === 0n) continue;
    const v = q(div(mul(baseP, remain), principal));
    if (d.direction === 'receivable') rec += v; else pay += v;
  }
  return { rec, pay };
}
function rateLookup(book, ccy, at) {
  if (ccy === BASE) return ONE;
  const l = book.ratesByCcy.get(ccy); if (!l || !l.length) return ONE;
  let best = l[0]; for (const r of l) { if (r.at <= at) best = r; else break; } return best.rateBig;
}

/** Daily series of cash (frozen EGP), debts, and net worth between two dates (inclusive days). */
export function netWorthSeries(book, fromISO, toISO) {
  const entries = moneyEntries(book).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
  const days = [];
  let d = startOfDay(fromISO), end = startOfDay(toISO);
  if ((end - d) / 86400000 > 800) d = addDays(end, -800);
  let i = 0, cash = 0n;
  for (; d <= end; d = addDays(d, 1)) {
    const dayEnd = addDays(d, 1).toISOString();
    while (i < entries.length && entries[i].at < dayEnd) { cash += D(entries[i].base); i++; }
    const { rec, pay } = debtsAt(book, dayEnd);
    days.push({ day: localDay(d.toISOString()), cash, receivable: rec, payable: pay, net: cash + rec - pay });
  }
  return days;
}

export function monthlyProfit(book, year) {
  const m = new Map();
  for (const e of book.ledger) {
    if (e.kind !== 'memo_gross' && e.kind !== 'memo_commission') continue;
    const k = localMonth(e.at); if (!k.startsWith(String(year))) continue;
    add(m, k, e.kind === 'memo_gross' ? D(e.base) : -D(e.base));
  }
  return Array.from({ length: 12 }, (_, i) => { const k = `${year}-${String(i + 1).padStart(2, '0')}`; return { month: k, net: m.get(k) || 0n }; });
}

export function goalProgress(book, g) {
  let cur = 0n;
  if (g.mode === 'total') cur = totalMoney(book);
  else if (g.mode === 'accounts') for (const id of g.accountIds || []) if (book.accounts.has(id)) cur += book.valueBig(id);
  else cur = D(g.manual || '0');
  const target = D(g.target);
  const pct = target > 0n ? Number((cur * 10000n) / target) / 100 : 0;
  return { current: cur, target, remaining: target > cur ? target - cur : 0n, pct: Math.max(0, Math.min(100, pct)), reached: cur >= target };
}

// ---------- search / customers ----------
export function txNet(tx) { return isTrade(tx.type) ? D(tx.customerPaid) - D(tx.providerCharged) : 0n; }

export function searchTx(book, f = {}) {
  const text = (f.q || '').trim().toLowerCase();
  const party = (id) => book.parties.get(id);
  const out = [];
  for (const t of book.txList()) {
    if (!f.includeSystem && t.type === 'opening') continue;
    if (f.type && t.type !== f.type) continue;
    if (f.status && t.status !== f.status) continue;
    if (f.partyId && t.partyId !== f.partyId) continue;
    if (f.accountId && ![t.accountId, t.fromAccountId, t.toAccountId, t.receiveAccountId, t.payAccountId].includes(f.accountId)) continue;
    if (f.from && t.occurredAt < f.from) continue;
    if (f.to && t.occurredAt >= f.to) continue;
    if (f.minAmount && D(t.amount) < D(f.minAmount)) continue;
    if (f.maxAmount && D(t.amount) > D(f.maxAmount)) continue;
    if (f.minProfit !== undefined && f.minProfit !== '' && txNet(t) < D(f.minProfit)) continue;
    if (f.maxProfit !== undefined && f.maxProfit !== '' && txNet(t) > D(f.maxProfit)) continue;
    if (text) {
      const hay = [t.number, t.amount, t.note, TX[t.type]?.label, party(t.partyId)?.name, party(t.partyId)?.phone, party(t.providerId)?.name,
        book.services.get(t.serviceId)?.name, book.categories.get(t.categoryId)?.name,
        ...[t.accountId, t.fromAccountId, t.toAccountId, t.receiveAccountId, t.payAccountId].map((id) => book.accounts.get(id)?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) continue;
    }
    out.push(t);
  }
  return out;
}

export function partyStats(book, id) {
  const txs = [...book.txs.values()].filter((t) => t.partyId === id && t.type !== 'opening');
  const done = txs.filter((t) => t.status === 'completed' && isTrade(t.type));
  let volume = 0n, profit = 0n;
  for (const e of book.ledger) {
    if (e.partyId !== id) continue;
    if (e.kind === 'memo_volume') volume += D(e.base);
    else if (e.kind === 'memo_gross') profit += D(e.base);
    else if (e.kind === 'memo_commission') profit -= D(e.base);
  }
  let owesMe = 0n, iOwe = 0n;
  for (const d of book.debts.values()) {
    if (d.partyId !== id || book.debtStatus(d) !== 'open') continue;
    const v = q(mul(book.debtRemainingBig(d), book.rateNow(d.currency)));
    if (d.direction === 'receivable') owesMe += v; else iOwe += v;
  }
  const last = txs.filter((t) => t.status !== 'cancelled' && t.status !== 'failed').reduce((m, t) => (t.occurredAt > m ? t.occurredAt : m), '');
  return { count: done.length, volume, profit, owesMe, iOwe, last, txs: txs.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)) };
}

/** Group a Map<id,BigInt> into labelled, sorted chart rows. */
export function rank(map, labelOf, limit = 8) {
  return [...map.entries()].map(([id, v]) => ({ id, label: labelOf(id), value: v })).sort((a, b) => (b.value > a.value ? 1 : -1)).slice(0, limit);
}
