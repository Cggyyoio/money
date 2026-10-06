// Shared UI state + helpers.
import { fmt, D } from '../domain/dec.js';
import { rangeFor } from '../domain/util.js';
import { TX, STATUS } from '../domain/constants.js';
import { verifySecret } from '../data/security.js';
import { h, sheet, field } from './dom.js';

export const app = { book: null, range: { key: 'month', from: '', to: '' }, rerender: () => {}, lock: () => {}, memoryOnly: false };

export const hd = () => ({ hideDecimals: !!app.book.settings.hideDecimals });
export const M = (v, ccy = 'EGP', cls = '') => h('span', { class: 'num ' + cls }, fmt(v, ccy, hd()));
/** signed money with +/− and colour */
export const SM = (v, ccy = 'EGP') => {
  const b = typeof v === 'bigint' ? v : D(v);
  return h('span', { class: 'num ' + (b === 0n ? '' : b < 0n ? 'neg' : 'pos') }, (b > 0n ? '+' : '') + fmt(b, ccy, hd()));
};
export const rangeNow = () => rangeFor(app.range.key, app.book.now(), { from: app.range.from, to: app.range.to });

const AR = 'ar-EG-u-nu-latn';
export const dt = (iso) => new Date(iso).toLocaleString(AR, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dShort = (iso) => new Date(iso).toLocaleDateString(AR, { day: 'numeric', month: 'short' });
export const localInput = (iso) => { const d = new Date(iso || Date.now()); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export const accName = (id) => app.book.accounts.get(id)?.name || '—';
export const partyName = (id) => app.book.parties.get(id)?.name || '';
export const txLabel = (t) => TX[t.type]?.label || t.type;
export const statusBadge = (st) => h('span', { class: 'badge ' + st }, STATUS[st]?.icon + ' ' + STATUS[st]?.label);

const TX_ICON = { sell: '🏷️', buy: '🛒', transfer: '🔁', topup: '⚡', cashout: '🏧', income: '💰', expense_personal: '🧾', expense_business: '💼', deposit: '⬇️', withdrawal: '⬆️', debt_to_me: '🤝', debt_on_me: '📌', debt_payment: '✅', internal_transfer: '↔️', adjustment: '⚖️', opening: '🏁' };
export const txIcon = (t) => TX_ICON[t] || '•';

export function go(hash) { if (location.hash === hash) app.rerender(); else location.hash = hash; }

// ---- PIN gate for sensitive actions ----
const FAIL_KEY = 'mf_fail';
export function failState() { try { return JSON.parse(localStorage.getItem(FAIL_KEY)) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } }
export function noteFail(ok) {
  try {
    if (ok) return localStorage.removeItem(FAIL_KEY);
    const f = failState(); f.n += 1; if (f.n >= 3) f.until = Date.now() + Math.min(300, 5 * 2 ** (f.n - 3)) * 1000;
    localStorage.setItem(FAIL_KEY, JSON.stringify(f));
  } catch {}
}
export const waitLeft = () => Math.max(0, Math.ceil((failState().until - Date.now()) / 1000));

/** Resolves true when the user passes the PIN check (or no PIN is set). */
export function requirePin(reason = 'عملية حساسة') {
  const rec = app.book.settings.pin;
  if (!rec) return Promise.resolve(true);
  return sheet(reason, (close) => {
    const inp = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', class: 'money', 'aria-label': 'PIN' });
    const err = h('div', { class: 'err hidden' });
    const go2 = async () => {
      if (waitLeft()) { err.textContent = `محاولات كتير — انتظر ${waitLeft()} ثانية`; err.classList.remove('hidden'); return; }
      const ok = await verifySecret(inp.value, rec);
      noteFail(ok);
      if (ok) close(true); else { err.textContent = 'الـPIN غير صحيح'; err.classList.remove('hidden'); inp.value = ''; inp.focus(); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go2(); });
    return h('div', null, field('أدخل الـPIN للمتابعة', inp), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: go2 }, 'تأكيد'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  }).then(Boolean);
}

/** Run an async action, toast errors in Arabic. Returns result or undefined. */
export async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) (await import('./dom.js')).toast(okMsg); return r ?? true; }
  catch (e) { (await import('./dom.js')).toast(e?.constructor?.name === 'AppError' ? e.message : 'حدث خطأ غير متوقع: ' + (e?.message || e), true); if (e?.constructor?.name !== 'AppError') console.error(e); return undefined; }
}

// ---- period selector ----
export const PERIODS = [['today', 'اليوم'], ['yesterday', 'أمس'], ['last7', 'آخر 7 أيام'], ['month', 'هذا الشهر'], ['lastMonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['custom', 'فترة مخصصة']];
export function periodBar() {
  const wrap = h('div', { class: 'stack no-print' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'الفترة' }, PERIODS.map(([k, l]) =>
    h('button', { class: 'chip', 'aria-pressed': String(app.range.key === k), onClick: () => { app.range.key = k; if (k === 'custom' && !app.range.from) { const t = app.book.now().toISOString().slice(0, 10); app.range.from = t; app.range.to = t; } app.rerender(); } }, l)));
  wrap.append(chips);
  if (app.range.key === 'custom') {
    const f = h('input', { type: 'date', value: app.range.from, 'aria-label': 'من' }), t = h('input', { type: 'date', value: app.range.to, 'aria-label': 'إلى' });
    const upd = () => { app.range.from = f.value; app.range.to = t.value || f.value; app.rerender(); };
    f.addEventListener('change', upd); t.addEventListener('change', upd);
    wrap.append(h('div', { class: 'row2' }, h('div', { class: 'field' }, h('label', null, 'من', f)), h('div', { class: 'field' }, h('label', null, 'إلى', t))));
  }
  return wrap;
}
export const pageTop = (title, ...actions) => h('div', { class: 'top' }, h('h1', null, title), h('div', { class: 'actions' }, actions));
export const empty = (text, action) => h('div', { class: 'empty' }, h('p', null, text), action || null);
export const accOptions = (filter = () => true, withEmpty) => [...(withEmpty ? [['', withEmpty]] : []), ...[...app.book.accounts.values()].filter((a) => !a.archived && filter(a)).map((a) => [a.id, `${a.name} (${a.currency})`])];

export const KIND_LABEL = { opening: 'رصيد افتتاحي', trade_in: 'استلام من العميل', trade_out: 'خصم الشركة', memo_volume: 'قيمة العملية (بيان)', memo_gross: 'ربح العملية (بيان)', memo_commission: 'عمولة الشركة (بيان)', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', income: 'دخل', expense: 'مصروف', deposit: 'إيداع', withdrawal: 'سحب', loan_out: 'إقراض', loan_repaid_in: 'سداد مستلم', borrow_in: 'اقتراض', borrow_repaid_out: 'سداد مدفوع', adjustment: 'تسوية' };

export const bellLink = () => h('a', { class: 'btn sm bell', 'data-bell': '', href: '#/notifications', 'aria-label': 'الإشعارات' }, '🔔');

/** Ask for a mandatory reason. Resolves to the text, or null if cancelled. */
export function askReason(title, label = 'السبب', required = true) {
  return sheet(title, (close) => {
    const t = h('textarea', { 'aria-label': label }); const err = h('div', { class: 'err hidden' });
    const ok = () => { if (required && !t.value.trim()) { err.textContent = 'السبب مطلوب'; err.classList.remove('hidden'); t.focus(); return; } close(t.value.trim()); };
    return h('div', null, field(label, t), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'متابعة'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء')));
  }).then((v) => (v === undefined ? null : v));
}
