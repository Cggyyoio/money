import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { D, S, fmt } from '../js/domain/dec.js';
import { sha256Hex } from '../js/domain/sha256.js';
import { totalMoney, profitReport, expenseReport, walletsReport, summaryReport, dashboard, netWorth, searchTx, partyStats } from '../js/domain/reports.js';
import { verifyBook } from '../js/domain/integrity.js';
import { verifyAuditChain } from '../js/domain/audit.js';
import { rangeFor } from '../js/domain/util.js';
import { newBook, spec, bal } from './helpers.js';

const ALL = { from: '1970-01-01T00:00:00.000Z', to: '9999-12-31T23:59:59.999Z' };
const ok = (book) => { const v = verifyBook(book); assert.deepEqual(v.problems, []); };
const cat = (book, scope, name) => [...book.categories.values()].find((c) => c.scope === scope && c.name === name);

test('decimal math is exact and formats as spec', () => {
  assert.equal(S(D('0.1') + D('0.2')), '0.3');
  assert.equal(S(D('1,250.5')), '1250.5');
  assert.equal(fmt('1250', 'EGP'), '1,250.00 EGP');
  assert.equal(fmt('1250.6', 'EGP', { hideDecimals: true }), '1,251 EGP');
  assert.equal(fmt('-5', 'EGP'), '-5.00 EGP');
  assert.throws(() => D('abc'));
});

test('sha256 matches node crypto', () => {
  for (const s of ['', 'abc', 'مرحبا', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)])
    assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'));
});

test('SPEC FINAL EXAMPLE: trade + personal expense', async () => {
  const { book, vf, cash, bank } = await spec();
  assert.equal(S(totalMoney(book)), '55000');
  const tx = await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  assert.equal(tx.status, 'completed');
  const p = profitReport(book, ALL);
  assert.deepEqual([S(p.volume), S(p.gross), S(p.commission), S(p.net)], ['1000', '30', '10', '20']);
  assert.equal(S(totalMoney(book)), '55020');
  await book.createTx({ type: 'expense_personal', amount: '150', accountId: cash.id, categoryId: cat(book, 'personal', 'أكل').id });
  // NOTE: the written spec says 54,850 but 55,000 + 20 profit − 150 = 54,870.
  assert.equal(S(totalMoney(book)), '54870');
  assert.equal(S(bal(book, vf)), '18990');   // 20000 − 1010
  assert.equal(S(bal(book, cash)), '5880');  // 5000 + 1030 − 150
  assert.equal(S(bal(book, bank)), '30000');
  const e = expenseReport(book, ALL);
  assert.deepEqual([S(e.personal), S(e.business)], ['150', '0']);
  const net = summaryReport(book, ALL);
  assert.equal(net.balanced, true);
  assert.equal(S(net.end), '54870');
  ok(book);
});

test('1) internal transfer is not profit / expense / income', async () => {
  const { book, vf, cash } = await spec();
  await book.createTx({ type: 'internal_transfer', fromAccountId: vf.id, toAccountId: cash.id, amount: '5000' });
  assert.equal(S(bal(book, vf)), '15000'); assert.equal(S(bal(book, cash)), '10000');
  assert.equal(S(totalMoney(book)), '55000');
  const d = dashboard(book, ALL);
  assert.equal(S(d.profit.net), '0'); assert.equal(S(d.expenses.total), '0'); assert.equal(S(d.income.income), '0'); assert.equal(S(d.change), '0');
  const w = walletsReport(book, ALL).find((r) => r.account.id === vf.id);
  assert.deepEqual([S(w.opening), S(w.in), S(w.out), S(w.transfers), S(w.closing)], ['0', '20000', '0', '-5000', '15000']);
  await assert.rejects(book.createTx({ type: 'internal_transfer', fromAccountId: vf.id, toAccountId: vf.id, amount: '1' }), /نفس الحساب/);
  ok(book);
});

test('2) trade with commission and company fee', async () => {
  const { book, vf, cash } = await spec();
  const tx = await book.createTx({ type: 'sell', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  assert.equal(S(bal(book, cash)), '6030'); assert.equal(S(bal(book, vf)), '18990');
  assert.equal(S(totalMoney(book) - D('55000')), '20');
  assert.equal(book.activeEntries(tx.id).filter((e) => e.accountId).length, 2);
  ok(book);
});

test('3,4) personal and business expenses stay separate', async () => {
  const { book, vf, bank } = await spec();
  await book.createTx({ type: 'expense_personal', amount: '150', accountId: vf.id, categoryId: cat(book, 'personal', 'أكل').id });
  await book.createTx({ type: 'expense_business', amount: '500', accountId: bank.id, categoryId: cat(book, 'business', 'VPS').id });
  const e = expenseReport(book, ALL);
  assert.deepEqual([S(e.personal), S(e.business)], ['150', '500']);
  assert.equal(S(profitReport(book, ALL).net), '0'); // business expense is not subtracted from trade profit
  assert.equal(S(totalMoney(book)), '54350');
  await assert.rejects(book.createTx({ type: 'expense_business', amount: '5', accountId: bank.id, categoryId: cat(book, 'personal', 'أكل').id }), /التصنيف/);
  ok(book);
});

test('5) refund reverses effect, keeps the original', async () => {
  const { book, clock, vf, cash } = await spec();
  const tx = await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  const n = book.ledger.length;
  clock.tick();
  await assert.rejects(book.refundTx(tx.id, ''), /سبب/);
  await book.refundTx(tx.id, 'العميل ألغى');
  assert.equal(book.txs.get(tx.id).status, 'refunded');
  assert.equal(S(totalMoney(book)), '55000'); assert.equal(S(bal(book, cash)), '5000'); assert.equal(S(bal(book, vf)), '20000');
  assert.ok(book.ledger.length > n); // original rows still there
  const p = profitReport(book, ALL);
  assert.deepEqual([S(p.volume), S(p.net), p.count], ['0', '0', 0]);
  await assert.rejects(book.refundTx(tx.id, 'again'), /لا يمكن/);
  await assert.rejects(book.cancelTx(tx.id, 'again'), /لا يمكن/);
  ok(book);
});

test('6) failed transaction has no financial effect', async () => {
  const { book, vf, cash } = await spec();
  const tx = await book.createTx({ type: 'transfer', status: 'pending', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  assert.equal(tx.status, 'pending'); assert.equal(S(totalMoney(book)), '55000');
  await book.failTx(tx.id, 'الشركة رفضت');
  assert.equal(book.txs.get(tx.id).status, 'failed'); assert.equal(S(totalMoney(book)), '55000');
  assert.equal(book.entriesByTx.get(tx.id), undefined);
  await assert.rejects(book.completeTx(tx.id), /لا يمكن/);
  ok(book);
});

test('pending → completed posts at completion time', async () => {
  const { book, clock, vf, cash } = await spec();
  const tx = await book.createTx({ type: 'transfer', status: 'pending', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  clock.tick(3600000);
  await book.completeTx(tx.id);
  assert.equal(S(totalMoney(book)), '55020');
  ok(book);
});

test('7) debt with partial repayment', async () => {
  const { book, cash } = await spec();
  const mo = await book.addParty({ kind: 'customer', name: 'محمد' });
  const debt = await book.createDebt({ direction: 'receivable', partyId: mo.id, amount: '2000', accountId: cash.id });
  assert.equal(S(bal(book, cash)), '3000');
  assert.equal(S(netWorth(book).net), '55000'); // lending doesn't change net worth
  await book.payDebt(debt.id, { amount: '500', accountId: cash.id });
  assert.equal(S(book.debtRemainingBig(debt)), '1500'); assert.equal(S(bal(book, cash)), '3500');
  assert.equal(S(netWorth(book).receivable), '1500');
  await assert.rejects(book.payDebt(debt.id, { amount: '1600', accountId: cash.id }), /أكبر/);
  const st = partyStats(book, mo.id);
  assert.equal(S(st.owesMe), '1500');
  await book.payDebt(debt.id, { amount: '1500', accountId: cash.id });
  assert.equal(book.debtStatus(book.debts.get(debt.id)), 'paid');
  assert.equal(S(totalMoney(book)), '55000');
  ok(book);
});

test('7b) payable debt and record-only debt', async () => {
  const { book, bank } = await spec();
  const co = await book.addParty({ kind: 'supplier', name: 'شركة X' });
  const d = await book.createDebt({ direction: 'payable', partyId: co.id, amount: '3000', accountId: bank.id });
  assert.equal(S(bal(book, bank)), '33000'); assert.equal(S(netWorth(book).net), '55000');
  await book.payDebt(d.id, { amount: '1000', accountId: bank.id });
  assert.equal(S(netWorth(book).payable), '2000'); assert.equal(S(bal(book, bank)), '32000');
  const d2 = await book.createDebt({ direction: 'receivable', partyId: co.id, amount: '400' }); // no cash movement
  assert.equal(d2.noCash, true); assert.equal(S(netWorth(book).receivable), '400');
  ok(book);
});

test('cancelling a debt with payments is blocked; cancelling payment restores it', async () => {
  const { book, cash } = await spec();
  const p = await book.addParty({ kind: 'customer', name: 'علي' });
  const d = await book.createDebt({ direction: 'receivable', partyId: p.id, amount: '1000', accountId: cash.id });
  const pay = await book.payDebt(d.id, { amount: '300', accountId: cash.id });
  await assert.rejects(book.cancelTx(d.originTxId, 'خطأ'), /مدفوعات/);
  await book.cancelTx(pay.id, 'خطأ في الإدخال');
  assert.equal(S(book.debtRemainingBig(d)), '1000');
  await book.cancelTx(d.originTxId, 'خطأ');
  assert.equal(book.debtStatus(book.debts.get(d.id)), 'cancelled'); assert.equal(S(bal(book, cash)), '5000');
  ok(book);
});

test('8) reconciliation creates a documented adjustment that cannot be removed', async () => {
  const { book, cash } = await spec();
  await book.createTx({ type: 'expense_personal', amount: '200', accountId: cash.id, categoryId: cat(book, 'personal', 'أكل').id });
  assert.equal(S(bal(book, cash)), '4800');
  const adj = await book.reconcile(cash.id, '5000', 'فلوس نسيتها', 'جرد');
  assert.deepEqual([adj.computed, adj.actual, adj.diff], ['4800', '5000', '200']);
  assert.equal(S(bal(book, cash)), '5000');
  await assert.rejects(book.reconcile(cash.id, '5000', 'x'), /مطابق/);
  await assert.rejects(book.reconcile(cash.id, '4000', ''), /سبب/);
  await assert.rejects(book.cancelTx(adj.id, 'x'), /تسوية|نظام/);
  await assert.rejects(book.amendTx(adj.id, { note: 'x' }, 'x'), /تسوية|نظام/);
  ok(book);
});

test('9) multi-currency: rates frozen per entry, valuation uses latest', async () => {
  const { book, clock, cash } = await spec();
  await assert.rejects(book.createAccount({ name: 'USD', currency: 'USD', opening: '100' }), /سعر صرف/);
  await book.addRate({ ccy: 'USD', rate: '50' });
  const usd = await book.createAccount({ name: 'USD Wallet', currency: 'USD', opening: '100' });
  assert.equal(S(totalMoney(book)), '60000'); // 55000 + 100*50
  clock.tick(86400000);
  await book.addRate({ ccy: 'USD', rate: '55' });
  assert.equal(S(totalMoney(book)), '60500'); // revalued at the new rate
  const e = book.ledger.find((x) => x.accountId === usd.id);
  assert.equal(e.base, '5000'); assert.equal(e.rate, '50'); // old entry frozen
  await book.createTx({ type: 'income', amount: '10', accountId: usd.id, categoryId: cat(book, 'income', 'دخل آخر').id });
  const inc = book.ledger.find((x) => x.kind === 'income');
  assert.equal(inc.base, '550');
  // trade in EGP paid out of USD account: converted at the tx-time rate
  const tx = await book.createTx({ type: 'transfer', currency: 'EGP', amount: '550', customerPaid: '550', providerCharged: '0', receiveAccountId: usd.id, payAccountId: cash.id });
  assert.equal(S(bal(book, usd)), '120'); // 110 + 550/55
  // cross-currency internal transfer: base cancels exactly
  await book.createTx({ type: 'internal_transfer', fromAccountId: usd.id, toAccountId: cash.id, amount: '20', toAmount: '1090' });
  assert.equal(S(book.ledger.filter((l) => l.kind.startsWith('transfer')).reduce((s, l) => s + D(l.base), 0n)), '0');
  assert.equal(S(bal(book, usd)), '100');
  assert.equal(summaryReport(book, ALL).balanced, true);
  // 100 USD × (55 − 50) = +500, minus the 10 EGP spread I typed in the cross-currency transfer (1100 expected, 1090 received)
  assert.equal(S(summaryReport(book, ALL).revaluation), '490');
  ok(book);
});

test('amend creates reversal + new entries, audited with old/new/reason', async () => {
  const { book, clock, cash } = await spec();
  const tx = await book.createTx({ type: 'income', amount: '1000', accountId: cash.id, categoryId: cat(book, 'income', 'راتب').id });
  clock.tick();
  await assert.rejects(book.amendTx(tx.id, { amount: '1200' }, ''), /سبب/);
  await book.amendTx(tx.id, { amount: '1200' }, 'كان المبلغ خطأ');
  assert.equal(S(bal(book, cash)), '6200');
  assert.equal(book.txs.get(tx.id).amount, '1200'); assert.equal(book.txs.get(tx.id).version, 2);
  const a = book.audit.filter((x) => x.action === 'tx.amend').at(-1);
  assert.deepEqual([a.old.amount, a.new.amount, a.reason], ['1000', '1200', 'كان المبلغ خطأ']);
  assert.equal(book.eventsOf(tx.id).at(-1).type, 'amended');
  await assert.rejects(book.amendTx(tx.id, { amount: '1200' }, 'same'), /لا توجد تغييرات/);
  ok(book);
});

test('amend a trade changes profit consistently', async () => {
  const { book, clock, vf, cash } = await spec();
  const tx = await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  clock.tick();
  await book.amendTx(tx.id, { customerPaid: '1050' }, 'العميل دفع أكتر');
  const p = profitReport(book, ALL);
  assert.deepEqual([S(p.gross), S(p.commission), S(p.net), p.count], ['50', '10', '40', 1]);
  assert.equal(S(totalMoney(book)), '55040');
  ok(book);
});

test('cancel completed tx removes its effect from its own period', async () => {
  const { book, clock, cash } = await spec();
  const tx = await book.createTx({ type: 'expense_personal', amount: '150', accountId: cash.id, categoryId: cat(book, 'personal', 'أكل').id, occurredAt: '2026-10-01T09:00:00.000Z' });
  clock.tick(86400000 * 3);
  await book.cancelTx(tx.id, 'سجلتها بالغلط');
  const r = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' };
  assert.equal(S(expenseReport(book, r).personal), '0');
  assert.equal(S(bal(book, cash)), '5000');
  ok(book);
});

test('validation: inactive account, bad numbers, future date', async () => {
  const { book, cash } = await spec();
  const c = cat(book, 'personal', 'أكل').id;
  await assert.rejects(book.createTx({ type: 'expense_personal', amount: '0', accountId: cash.id, categoryId: c }), /أكبر من صفر/);
  await assert.rejects(book.createTx({ type: 'expense_personal', amount: 'abc', accountId: cash.id, categoryId: c }), /غير صالح/);
  await assert.rejects(book.createTx({ type: 'expense_personal', amount: '5', accountId: cash.id, categoryId: c, occurredAt: '2030-01-01T00:00:00Z' }), /المستقبل/);
  await book.updateAccount(cash.id, { active: false });
  await assert.rejects(book.createTx({ type: 'expense_personal', amount: '5', accountId: cash.id, categoryId: c }), /موقوف/);
  await assert.rejects(book.createTx({ type: 'opening', amount: '5', accountId: cash.id }), /نوع/);
  ok(book);
});

test('ledger / audit / events are append-only and frozen', async () => {
  const { book, driver, cash } = await spec();
  await book.createTx({ type: 'income', amount: '10', accountId: cash.id, categoryId: cat(book, 'income', 'راتب').id });
  const e = book.ledger[0];
  assert.throws(() => { e.amount = '999'; }, TypeError);
  assert.throws(() => book.ledger[0].base = '1', TypeError);
  await assert.rejects(driver.commit([{ op: 'put', c: 'ledger', doc: { ...e, amount: '999' } }]), /append-only/);
  await assert.rejects(driver.commit([{ op: 'add', c: 'ledger', doc: e }]), /duplicate/);
  await assert.rejects(driver.commit([{ op: 'put', c: 'audit', doc: { ...book.audit[0], reason: 'x' } }]), /append-only/);
  assert.equal(book.ledger[0].amount, e.amount);
  // atomic: a failing op rolls back the whole commit
  const before = (await driver.load()).accounts.length;
  await assert.rejects(driver.commit([{ op: 'put', c: 'accounts', doc: { id: 'zzz' } }, { op: 'put', c: 'ledger', doc: e }]));
  assert.equal((await driver.load()).accounts.length, before);
});

test('audit hash chain detects tampering', async () => {
  const { book, cash } = await spec();
  await book.createTx({ type: 'income', amount: '10', accountId: cash.id, categoryId: cat(book, 'income', 'راتب').id });
  assert.equal(verifyAuditChain(book.audit).ok, true);
  const copy = JSON.parse(JSON.stringify(book.audit));
  copy[3].new.amount = '1';
  assert.equal(verifyAuditChain(copy).ok, false);
  const missing = copy.slice(); missing.splice(2, 1);
  assert.equal(verifyAuditChain(book.audit.filter((_, i) => i !== 2)).ok, false);
});

test('book reloads identically from the driver (persistence round trip)', async () => {
  const { book, driver, vf, cash } = await spec();
  await book.createTx({ type: 'transfer', amount: '1000', customerPaid: '1030', providerCharged: '1010', receiveAccountId: cash.id, payAccountId: vf.id });
  const { Book } = await import('../js/domain/book.js');
  const b2 = await new Book(driver, { now: book.now }).init();
  assert.equal(S(totalMoney(b2)), S(totalMoney(book)));
  assert.equal(b2.ledger.length, book.ledger.length);
  ok(b2);
});

test('recurring: remind mode confirms once; auto mode is idempotent and catches up', async () => {
  const { book, clock, cash } = await spec();
  clock.set('2026-10-05T10:00:00.000Z');
  const vps = cat(book, 'business', 'VPS').id;
  const rule = await book.saveRecurring({ name: 'VPS', amount: '500', accountId: cash.id, categoryId: vps, frequency: 'monthly', day: 1, mode: 'remind', startDate: '2026-08-01' });
  assert.equal(rule.nextDue, '2026-08-01');
  assert.equal(book.dueRecurring().length, 1);
  await book.confirmRecurring(rule.id);
  assert.equal(book.recurring.get(rule.id).nextDue, '2026-09-01');
  const auto = await book.saveRecurring({ name: 'نت', amount: '600', accountId: cash.id, categoryId: cat(book, 'personal', 'إنترنت').id, frequency: 'monthly', day: 31, mode: 'auto', startDate: '2026-08-01' });
  assert.equal(await book.runRecurring(), 2); // Aug 31 and Sep 30 (day clamped); Oct 31 is still in the future
  assert.equal(await book.runRecurring(), 0);  // idempotent
  assert.equal(book.recurring.get(auto.id).nextDue, '2026-10-31');
  assert.equal(S(expenseReport(book, ALL).personal), '1200');
  ok(book);
});
