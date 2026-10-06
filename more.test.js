import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { D, S } from '../js/domain/dec.js';
import { Book } from '../js/domain/book.js';
import { MemoryDriver } from '../js/data/memory-driver.js';
import { buildBackup, parseBackup, isEncrypted } from '../js/data/backup.js';
import { makeSecret, verifySecret } from '../js/data/security.js';
import { toCSV, toXlsx } from '../js/data/export.js';
import { totalMoney, searchTx, dashboard, netWorthSeries, goalProgress, monthlyProfit, partyStats, profitReport } from '../js/domain/reports.js';
import { notifications } from '../js/domain/notify.js';
import { verifyBook } from '../js/domain/integrity.js';
import { rangeFor } from '../js/domain/util.js';
import { newBook, spec } from './helpers.js';

const cat = (book, scope, name) => [...book.categories.values()].find((c) => c.scope === scope && c.name === name);
const ok = (book) => assert.deepEqual(verifyBook(book).problems, []);

test('backup: plain + encrypted round trip, tamper detection, restore', async () => {
  const { book, vf, cash } = await spec();
  await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  const plain = await buildBackup(book);
  assert.equal(isEncrypted(plain), false);
  const enc = await buildBackup(book, 'سر-123');
  assert.equal(isEncrypted(enc), true);
  assert.ok(!enc.includes('Vodafone'));
  await assert.rejects(parseBackup(enc, ''), /مشفرة/);
  await assert.rejects(parseBackup(enc, 'غلط'), /غير صحيحة/);
  const data = await parseBackup(enc, 'سر-123');
  assert.equal(data.ledger.length, book.ledger.length);

  const bad = JSON.parse(plain); bad.data.ledger[0].amount = '999999';
  await assert.rejects(parseBackup(JSON.stringify(bad)), /فحص السلامة/);
  // attacker fixes the checksum but removes a ledger row → sequence gap
  const gap = JSON.parse(plain); gap.data.ledger.splice(1, 1);
  const { sha256Hex } = await import('../js/domain/sha256.js'); const { canonical } = await import('../js/domain/util.js');
  gap.checksum = sha256Hex(canonical(gap.data));
  await assert.rejects(parseBackup(JSON.stringify(gap)), /غير متسلسل/);
  // …or edits an audit row
  const aud = JSON.parse(plain); aud.data.audit[2].reason = 'x'; aud.checksum = sha256Hex(canonical(aud.data));
  await assert.rejects(parseBackup(JSON.stringify(aud)), /التلاعب/);

  const target = new MemoryDriver();
  const b2 = await new Book(target, { now: book.now }).init();
  await b2.replaceAll(data);
  assert.equal(S(totalMoney(b2)), S(totalMoney(book)));
  assert.equal(b2.audit.at(-1).action, 'backup.restore');
  ok(b2);
});

test('security: PBKDF2 secret verify', async () => {
  const r = await makeSecret('1234');
  assert.equal(await verifySecret('1234', r), true);
  assert.equal(await verifySecret('1235', r), false);
  assert.equal(await verifySecret('1234', null), false);
});

test('export: csv and xlsx are well formed', async () => {
  assert.equal(toCSV(['a', 'b'], [['x,y', 'q"z']]), '﻿a,b\r\n"x,y","q""z"');
  const u8 = toXlsx([{ name: 'عمليات', headers: ['رقم', 'مبلغ'], rows: [['T-1', '1250.5'], ['T-2 <&>', '3']] }]);
  assert.equal(u8[0], 0x50); assert.equal(u8[1], 0x4b);
  const dir = mkdtempSync(join(tmpdir(), 'mf-'));
  writeFileSync(join(dir, 'x.xlsx'), u8);
  console.log('XLSX_PATH=' + join(dir, 'x.xlsx'));
});

test('search: text, amount, party phone, status, profit filters', async () => {
  const { book, vf, cash } = await spec();
  const c = await book.addParty({ kind: 'customer', name: 'أحمد', phone: '01012345678' });
  const prov = await book.addParty({ kind: 'provider', name: 'فودافون' });
  const svc = await book.addService({ name: 'تحويل رصيد', providerId: prov.id });
  const t1 = await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id, partyId: c.id, serviceId: svc.id, providerId: prov.id });
  await book.createTx({ type: 'expense_personal', amount: '150', accountId: cash.id, categoryId: cat(book, 'personal', 'أكل').id, note: 'غدا' });
  assert.equal(searchTx(book, { q: '0101234' }).length, 1);
  assert.equal(searchTx(book, { q: 'فودافون' }).length, 1);
  assert.equal(searchTx(book, { q: t1.number })[0].id, t1.id);
  assert.equal(searchTx(book, { q: '150' }).length, 1);
  assert.equal(searchTx(book, { q: 'أكل' }).length, 1);
  assert.equal(searchTx(book, { accountId: vf.id }).length, 1);
  assert.equal(searchTx(book, { minProfit: '15' }).length, 1);
  assert.equal(searchTx(book, { minProfit: '25' }).length, 0);
  assert.equal(searchTx(book, { status: 'pending' }).length, 0);
  assert.equal(searchTx(book, { type: 'expense_personal' }).length, 1);
  const st = partyStats(book, c.id);
  assert.deepEqual([st.count, S(st.volume), S(st.profit)], [1, '1000', '20']);
});

test('dashboard periods, net worth series, goals, notifications', async () => {
  const { book, clock, vf, cash } = await spec();
  clock.set('2026-10-05T10:00:00.000Z');
  await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  clock.set('2026-10-06T10:00:00.000Z');
  await book.createTx({ type: 'expense_personal', amount: '150', accountId: cash.id, categoryId: cat(book, 'personal', 'أكل').id });
  const today = rangeFor('today', clock.now()), yest = rangeFor('yesterday', clock.now());
  assert.equal(S(dashboard(book, today).expenses.personal), '150'); assert.equal(S(dashboard(book, today).profit.net), '0');
  assert.equal(S(dashboard(book, yest).profit.net), '20'); assert.equal(S(dashboard(book, yest).change), '20');
  assert.equal(S(dashboard(book, rangeFor('month', clock.now())).change), '-130');
  assert.equal(S(dashboard(book, rangeFor('last7', clock.now())).change), '-130');
  assert.equal(S(monthlyProfit(book, 2026)[9].net), '20');
  const series = netWorthSeries(book, '2026-10-05T00:00:00.000Z', '2026-10-06T12:00:00.000Z');
  assert.deepEqual(series.map((p) => S(p.net)), ['55020', '54870']);

  const g = await book.saveGoal({ name: 'سيارة', target: '100000', mode: 'total' });
  assert.equal(goalProgress(book, g).pct, 54.87); assert.equal(S(goalProgress(book, g).remaining), '45130');
  const g2 = await book.saveGoal({ name: 'طوارئ', target: '5000', mode: 'accounts', accountIds: [cash.id] });
  assert.equal(goalProgress(book, g2).reached, true);

  await book.updateAccount(cash.id, { lowBalanceAlert: '10000' });
  const p = await book.addParty({ kind: 'customer', name: 'سيد' });
  await book.createDebt({ direction: 'receivable', partyId: p.id, amount: '100', dueDate: '2026-10-01' });
  const pend = await book.createTx({ type: 'transfer', status: 'pending', amount: '10', customerPaid: '12', providerCharged: '11', receiveAccountId: cash.id, payAccountId: vf.id });
  const n = notifications(book, clock.now());
  const titles = n.map((x) => x.title).join('|');
  assert.match(titles, /رصيد منخفض: Cash/); assert.match(titles, /دين مستحق لك عند سيد/); assert.match(titles, /عملية معلقة/); assert.match(titles, /تحقق الهدف: طوارئ/); assert.match(titles, /نسخة احتياطية/);
  await book.dismiss(n.find((x) => x.key.startsWith('pend:')).key);
  assert.ok(!notifications(book, clock.now()).some((x) => x.key.startsWith('pend:')));
  void pend;
});

// ---------- property test: random operation sequences keep every invariant ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function expectedEgpTotal(book) {
  // independent re-computation from transaction documents (EGP-only scenario)
  let t = 0n;
  for (const tx of book.txs.values()) {
    if (tx.status !== 'completed') continue;
    const a = D(tx.amount || '0');
    switch (tx.type) {
      case 'opening': case 'income': case 'deposit': t += a; break;
      case 'expense_personal': case 'expense_business': case 'withdrawal': t -= a; break;
      case 'debt_to_me': if (tx.accountId) t -= a; break;
      case 'debt_on_me': if (tx.accountId) t += a; break;
      case 'debt_payment': t += book.debts.get(tx.debtId).direction === 'receivable' ? a : -a; break;
      case 'adjustment': t += D(tx.diff); break;
      case 'internal_transfer': break;
      default: t += D(tx.customerPaid) - D(tx.providerCharged); // trades
    }
  }
  return t;
}

for (const seed of [1, 2, 3, 42, 2026]) {
  test(`property: 250 random operations keep ledger, reports and balances consistent (seed ${seed})`, async () => {
    const { book, clock } = await newBook();
    const r = rng(seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const money = () => String(Math.floor(r() * 5000) / 4 + 1);
    const accs = [];
    for (const n of ['A', 'B', 'C']) accs.push(await book.createAccount({ name: n, currency: 'EGP', opening: String(Math.floor(r() * 20000)) }));
    const person = await book.addParty({ kind: 'customer', name: 'عميل' });
    const exp = [...book.categories.values()].filter((c) => c.scope === 'personal'), bexp = [...book.categories.values()].filter((c) => c.scope === 'business'), inc = [...book.categories.values()].filter((c) => c.scope === 'income');
    const types = ['sell', 'buy', 'transfer', 'topup', 'cashout', 'income', 'expense_personal', 'expense_business', 'deposit', 'withdrawal', 'internal_transfer', 'debt', 'pay', 'cancel', 'refund', 'amend', 'fail', 'complete', 'reconcile'];
    let done = 0;
    for (let i = 0; i < 250; i++) {
      clock.tick(Math.floor(r() * 7200000));
      const a = pick(accs), b = pick(accs), type = pick(types);
      const txs = [...book.txs.values()];
      try {
        if (['sell', 'buy', 'transfer', 'topup', 'cashout'].includes(type)) { const amt = Number(money()); await book.createTx({ type, status: r() < 0.25 ? 'pending' : 'completed', amount: String(amt), customerPaid: String(amt + Math.floor(r() * 40)), providerCharged: String(amt + Math.floor(r() * 25)), receiveAccountId: a.id, payAccountId: b.id, partyId: person.id }); }
        else if (type === 'income') await book.createTx({ type, amount: money(), accountId: a.id, categoryId: pick(inc).id });
        else if (type === 'expense_personal') await book.createTx({ type, amount: money(), accountId: a.id, categoryId: pick(exp).id });
        else if (type === 'expense_business') await book.createTx({ type, amount: money(), accountId: a.id, categoryId: pick(bexp).id });
        else if (type === 'deposit' || type === 'withdrawal') await book.createTx({ type, amount: money(), accountId: a.id });
        else if (type === 'internal_transfer') await book.createTx({ type, amount: money(), fromAccountId: a.id, toAccountId: b.id });
        else if (type === 'debt') await book.createDebt({ direction: r() < 0.5 ? 'receivable' : 'payable', partyId: person.id, amount: money(), accountId: r() < 0.8 ? a.id : undefined });
        else if (type === 'pay') { const d = pick([...book.debts.values()].filter((x) => book.debtStatus(x) === 'open')); if (d) await book.payDebt(d.id, { amount: S(book.debtRemainingBig(d) / (r() < 0.5 ? 2n : 1n)), accountId: a.id }); }
        else if (type === 'cancel') await book.cancelTx(pick(txs).id, 'اختبار');
        else if (type === 'refund') await book.refundTx(pick(txs).id, 'اختبار');
        else if (type === 'fail') await book.failTx(pick(txs).id, 'اختبار');
        else if (type === 'complete') await book.completeTx(pick(txs).id);
        else if (type === 'amend') { const t = pick(txs); await book.amendTx(t.id, { amount: money(), ...(t.type === 'internal_transfer' ? {} : {}) }, 'اختبار'); }
        else if (type === 'reconcile') await book.reconcile(a.id, S(book.balanceBig(a.id) + D(money())), 'جرد');
        done++;
      } catch (e) {
        if (e.constructor.name !== 'AppError') throw e; // only expected business-rule rejections allowed
      }
      const v = verifyBook(book);
      assert.deepEqual(v.problems, [], `op #${i} (${type})`);
      assert.equal(S(totalMoney(book)), S(expectedEgpTotal(book)), `independent total mismatch after op #${i} (${type})`);
    }
    assert.ok(done > 80, 'enough operations actually succeeded: ' + done);
    // everything survives a reload from storage
    const b2 = await new Book(book.driver, { now: book.now }).init();
    assert.equal(S(totalMoney(b2)), S(totalMoney(book)));
    ok(b2);
  });
}
