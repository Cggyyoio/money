// Pure financial rules: validation and posting plans. No storage here.
import { D, mul, div, q, ONE } from './dec.js';
import { BASE, TX, isTrade } from './constants.js';
import { AppError } from './util.js';

export function rateOf(ratesByCcy, ccy, at) {
  if (ccy === BASE) return ONE;
  const list = ratesByCcy.get(ccy);
  if (!list || !list.length) throw new AppError(`لا يوجد سعر صرف للعملة ${ccy} — أضفه من الإعدادات أولًا`);
  let best = list[0]; // before the first known rate we use the earliest one
  for (const r of list) { if (r.at <= at) best = r; else break; }
  return best.rateBig;
}

const SINGLE_SIGN = { income: 1, expense_personal: -1, expense_business: -1, deposit: 1, withdrawal: -1 };
const SINGLE_KIND = { income: 'income', expense_personal: 'expense', expense_business: 'expense', deposit: 'deposit', withdrawal: 'withdrawal' };

/**
 * Returns the ledger entry drafts for a transaction.
 * ctx: { accounts:Map, debts:Map, rateOf(ccy, at), at }
 */
export function planEntries(tx, ctx) {
  const { at } = ctx;
  const R = (c) => ctx.rateOf(c, at);
  const baseOf = (c, v) => q(mul(v, R(c)));
  const acct = (id) => { const a = ctx.accounts.get(id); if (!a) throw new AppError('حساب غير موجود'); return a; };
  const meta = {};
  for (const k of ['partyId', 'serviceId', 'providerId', 'categoryId']) if (tx[k]) meta[k] = tx[k];
  const out = [];

  const leg = (accountId, kind, value, base, extra = {}) => {
    if (value === 0n && base === 0n) return;
    const a = acct(accountId);
    const amount = a.currency === tx.currency ? value : q(div(base, R(a.currency)));
    out.push({ accountId, kind, amount, currency: a.currency, rate: R(a.currency), base, ...meta, ...extra });
  };
  const memo = (kind, base) => { if (base !== 0n) out.push({ accountId: null, kind, amount: base, currency: BASE, rate: ONE, base, ...meta }); };

  const type = tx.type;
  if (isTrade(type)) {
    const vol = D(tx.amount), cp = D(tx.customerPaid), pc = D(tx.providerCharged);
    const volB = baseOf(tx.currency, vol), cpB = baseOf(tx.currency, cp), pcB = baseOf(tx.currency, pc);
    if (cp > 0n) leg(tx.receiveAccountId, 'trade_in', cp, cpB);
    if (pc > 0n) leg(tx.payAccountId, 'trade_out', -pc, -pcB);
    memo('memo_volume', volB);
    memo('memo_gross', cpB - volB);        // ربح العملية
    memo('memo_commission', pcB - volB);   // عمولة الشركة
  } else if (SINGLE_SIGN[type]) {
    const s = SINGLE_SIGN[type] === 1 ? 1n : -1n;
    const v = D(tx.amount);
    leg(tx.accountId, SINGLE_KIND[type], s * v, s * baseOf(tx.currency, v),
      type.startsWith('expense') ? { scope: type === 'expense_personal' ? 'personal' : 'business' } : {});
  } else if (type === 'internal_transfer') {
    const from = acct(tx.fromAccountId), to = acct(tx.toAccountId);
    const A = D(tx.amount);
    const fromB = baseOf(from.currency, A);
    out.push({ accountId: from.id, kind: 'transfer_out', amount: -A, currency: from.currency, rate: R(from.currency), base: -fromB });
    out.push({ accountId: to.id, kind: 'transfer_in', amount: D(tx.toAmount), currency: to.currency, rate: R(to.currency), base: fromB });
  } else if (type === 'debt_to_me') {
    if (tx.accountId) { const v = D(tx.amount); leg(tx.accountId, 'loan_out', -v, -baseOf(tx.currency, v)); }
  } else if (type === 'debt_on_me') {
    if (tx.accountId) { const v = D(tx.amount); leg(tx.accountId, 'borrow_in', v, baseOf(tx.currency, v)); }
  } else if (type === 'debt_payment') {
    const debt = ctx.debts.get(tx.debtId);
    if (!debt) throw new AppError('الدين غير موجود');
    const v = D(tx.amount), b = baseOf(tx.currency, v);
    if (debt.direction === 'receivable') leg(tx.accountId, 'loan_repaid_in', v, b);
    else leg(tx.accountId, 'borrow_repaid_out', -v, -b);
  } else if (type === 'adjustment') {
    const d = D(tx.diff);
    out.push({ accountId: tx.accountId, kind: 'adjustment', amount: d, currency: tx.currency, rate: R(tx.currency), base: baseOf(tx.currency, d) });
  } else if (type === 'opening') {
    const v = D(tx.amount);
    out.push({ accountId: tx.accountId, kind: 'opening', amount: v, currency: tx.currency, rate: R(tx.currency), base: baseOf(tx.currency, v) });
  } else throw new AppError('نوع عملية غير معروف');
  return out;
}

/** Returns a list of Arabic error messages (empty = valid). ctx: {accounts, debts, currencies, rateOf, now} */
export function validateTx(tx, ctx) {
  const e = [];
  const amountOk = (v, label, zero = false) => {
    try { const x = D(v); if (x < 0n || (!zero && x === 0n)) e.push(`${label} يجب أن يكون ${zero ? 'صفرًا أو أكثر' : 'أكبر من صفر'}`); return true; }
    catch { e.push(`${label} غير صالح`); return false; }
  };
  const acct = (id, label) => {
    const a = ctx.accounts.get(id);
    if (!id || !a) { e.push(`اختر ${label}`); return null; }
    if (!a.active) e.push(`الحساب "${a.name}" موقوف`);
    return a;
  };
  const date = new Date(tx.occurredAt);
  if (isNaN(date)) e.push('التاريخ غير صالح');
  else if (date.getTime() > ctx.now.getTime() + 86400000) e.push('التاريخ في المستقبل');
  if (!ctx.currencies.includes(tx.currency)) e.push('عملة غير مدعومة');
  else { try { ctx.rateOf(tx.currency, new Date().toISOString()); } catch (er) { e.push(er.message); } }

  const type = tx.type;
  if (isTrade(type)) {
    const okA = amountOk(tx.amount, 'قيمة العملية');
    const okC = amountOk(tx.customerPaid, 'المبلغ الذي دفعه العميل', true);
    const okP = amountOk(tx.providerCharged, 'المبلغ الذي خصمته الشركة', true);
    if (okA && okC && okP) {
      if (D(tx.customerPaid) > 0n) acct(tx.receiveAccountId, 'محفظة الاستلام');
      if (D(tx.providerCharged) > 0n) acct(tx.payAccountId, 'محفظة الدفع');
      if (D(tx.customerPaid) === 0n && D(tx.providerCharged) === 0n) e.push('أدخل المبلغ الذي دفعه العميل أو الذي خصمته الشركة');
    }
  } else if (SINGLE_SIGN[type]) {
    amountOk(tx.amount, 'المبلغ');
    const a = acct(tx.accountId, 'الحساب');
    if (a && a.currency !== tx.currency) e.push('عملة العملية يجب أن تطابق عملة الحساب');
    if (type.startsWith('expense') || type === 'income') {
      const c = ctx.categories?.get(tx.categoryId);
      if (!c) e.push('اختر التصنيف');
      else if ((type === 'expense_personal' && c.scope !== 'personal') || (type === 'expense_business' && c.scope !== 'business') || (type === 'income' && c.scope !== 'income')) e.push('التصنيف لا يناسب نوع العملية');
    }
    if (type === 'withdrawal' || type.startsWith('expense')) {
      // negative balances are allowed (wallets can be overdrawn in practice) but flagged by the UI
    }
  } else if (type === 'internal_transfer') {
    amountOk(tx.amount, 'المبلغ');
    const f = acct(tx.fromAccountId, 'حساب المصدر'), t = acct(tx.toAccountId, 'حساب الوجهة');
    if (f && t) {
      if (f.id === t.id) e.push('لا يمكن التحويل إلى نفس الحساب');
      if (f.currency !== tx.currency) e.push('عملة العملية يجب أن تطابق عملة حساب المصدر');
      if (f.currency === t.currency) { if (tx.toAmount !== tx.amount) e.push('مبلغ الاستلام يجب أن يساوي المبلغ لنفس العملة'); }
      else amountOk(tx.toAmount, 'المبلغ المستلم');
    }
  } else if (type === 'debt_to_me' || type === 'debt_on_me') {
    amountOk(tx.amount, 'المبلغ');
    if (!tx.partyId || !ctx.parties?.get(tx.partyId)) e.push('اختر الشخص / الجهة');
    if (tx.accountId) acct(tx.accountId, 'الحساب');
  } else if (type === 'debt_payment') {
    amountOk(tx.amount, 'المبلغ');
    acct(tx.accountId, 'الحساب');
  } else if (type === 'adjustment') {
    amountOk(tx.diff === '0' ? '0' : String(tx.diff).replace('-', ''), 'فرق التسوية');
  }
  return e;
}
