// Independent self-check. Re-derives everything from raw ledger rows and compares with the reports.
import { D } from './dec.js';
import { KIND, isTrade } from './constants.js';
import { verifyAuditChain } from './audit.js';
import { summaryReport, profitReport, totalMoney } from './reports.js';

export function verifyBook(book) {
  const problems = [];
  const bad = (m) => problems.push(m);
  const L = book.ledger;

  // 1. No gaps / reordering in the ledger (detects deleted rows)
  L.forEach((e, i) => { if (e.seq !== i + 1) bad(`فجوة في تسلسل الحركات عند ${e.seq}`); });

  // 2. Every kind has a bucket
  for (const e of L) if (!KIND[e.kind]) bad(`نوع حركة غير معروف: ${e.kind}`);

  // 3. Reversals negate their originals, and each entry is reversed at most once
  const byId = new Map(L.map((e) => [e.id, e]));
  const seen = new Set();
  for (const e of L) {
    if (!e.reversesId) continue;
    const o = byId.get(e.reversesId);
    if (!o) { bad(`قيد عكسي بلا أصل: ${e.id}`); continue; }
    if (seen.has(o.id)) bad(`قيد معكوس مرتين: ${o.id}`);
    seen.add(o.id);
    if (D(o.amount) + D(e.amount) !== 0n || D(o.base) + D(e.base) !== 0n || o.accountId !== e.accountId || o.kind !== e.kind) bad(`القيد العكسي ${e.id} لا يطابق الأصل`);
  }

  // 4. Per-transaction effect rules
  for (const tx of book.txs.values()) {
    const all = book.entriesByTx.get(tx.id) || [];
    const net = (f) => all.filter(f).reduce((s, e) => s + D(e.base), 0n);
    const money = all.filter((e) => e.accountId);
    if (tx.status === 'pending' || tx.status === 'failed') { if (all.length) bad(`${tx.number}: عملية ${tx.status} لها أثر مالي`); continue; }
    if (tx.status === 'cancelled' || tx.status === 'refunded') {
      if (net(() => true) !== 0n) bad(`${tx.number}: أثر العملية الملغاة/المستردة غير مصفّر`);
      for (const a of new Set(money.map((e) => e.accountId))) {
        if (money.filter((e) => e.accountId === a).reduce((s, e) => s + D(e.amount), 0n) !== 0n) bad(`${tx.number}: رصيد الحساب غير مصفّر بعد العكس`);
      }
      continue;
    }
    const act = book.activeEntries(tx.id);
    if (isTrade(tx.type)) {
      const m = (k) => act.filter((e) => e.kind === k).reduce((s, e) => s + D(e.base), 0n);
      const netMoney = m('trade_in') + m('trade_out');
      if (netMoney !== m('memo_gross') - m('memo_commission')) bad(`${tx.number}: الربح الصافي لا يطابق حركة الأموال`);
    }
    if (tx.type === 'internal_transfer' && act.reduce((s, e) => s + D(e.base), 0n) !== 0n) bad(`${tx.number}: التحويل الداخلي غير متوازن`);
  }
  const transfers = L.filter((e) => KIND[e.kind] === 'transfer').reduce((s, e) => s + D(e.base), 0n);
  if (transfers !== 0n) bad('مجموع التحويلات الداخلية لا يساوي صفرًا');

  // 5. Cached balances == sum of ledger rows
  const sums = new Map();
  for (const e of L) if (e.accountId) sums.set(e.accountId, (sums.get(e.accountId) || 0n) + D(e.amount));
  for (const a of book.accounts.values()) if ((sums.get(a.id) || 0n) !== book.balanceBig(a.id)) bad(`رصيد ${a.name} لا يطابق الحركات`);

  // 6. The comprehensive statement must add up for all time
  const all = { from: '1970-01-01T00:00:00.000Z', to: '9999-12-31T23:59:59.999Z' };
  const s = summaryReport(book, all);
  if (!s.balanced) bad('التقرير المالي الشامل غير متوازن');
  const p = profitReport(book, all);
  if (p.net !== s.parts.profit) bad('صافي الربح في التقرير لا يطابق أثره على الأموال');

  // 7. Debts
  for (const d of book.debts.values()) {
    const rem = book.debtRemainingBig(d);
    if (rem < 0n || rem > D(d.principal)) bad(`دين غير متسق: ${d.id}`);
  }

  // 8. Audit chain
  const chain = verifyAuditChain(book.audit);
  if (!chain.ok) bad(`سجل التدقيق تم التلاعب به عند السجل ${chain.brokenAt}`);

  return { ok: problems.length === 0, problems, total: totalMoney(book) };
}
