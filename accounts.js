import { ACCOUNT_TYPES, TX } from '../../domain/constants.js';
import { D, S, fmt, normalizeNumber } from '../../domain/dec.js';
import { toCSV, toXlsx } from '../../data/export.js';
import { h, field, select, sheet, download, confirmBox } from '../dom.js';
import { app, M, SM, hd, go, attempt, requirePin, askReason, pageTop, empty, dt, accName, txLabel, KIND_LABEL, accOptions } from '../ctx.js';
import { txTitle } from './transactions.js';

export function render(parts) {
  if (parts[0]) return detail(parts[0]);
  const { book } = app;
  const list = [...book.accounts.values()].filter((a) => !a.archived);
  return h('div', { class: 'stack' },
    pageTop('الحسابات والمحافظ', h('button', { class: 'btn sm primary', onClick: () => addSheet() }, '+ حساب')),
    list.length ? h('div', { class: 'list' }, list.map((a) => h('a', { class: 'item', href: '#/accounts/' + a.id, style: a.active ? null : { opacity: '.6' } },
      h('div', { class: 'ic', 'aria-hidden': 'true' }, { wallet: '📱', bank: '🏦', cash: '💵', crypto: '🪙', other: '👛' }[a.type] || '👛'),
      h('div', { class: 'main' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, ACCOUNT_TYPES[a.type] + (a.active ? '' : '  (متوقف)') + '  ' + a.currency)),
      h('div', { class: 'amt' }, M(book.balanceBig(a.id), a.currency), a.currency !== 'EGP' ? h('small', null, '≈ ', M(book.valueBig(a.id))) : null))))
      : empty('لا توجد حسابات. أضف محافظك وحساباتك برصيدها الحالي.', h('button', { class: 'btn primary', onClick: () => addSheet() }, '+ حساب جديد')));
}

function addSheet() {
  const { book } = app;
  return sheet('حساب جديد', (close) => {
    const name = h('input', { autocomplete: 'off', placeholder: 'مثال: Vodafone Cash' });
    const type = select(Object.entries(ACCOUNT_TYPES), 'wallet');
    const ccy = select(book.settings.currencies.map((c) => [c, c]), 'EGP');
    const opening = h('input', { class: 'money', inputmode: 'decimal', placeholder: '0' });
    const low = h('input', { class: 'money', inputmode: 'decimal', placeholder: 'اختياري' });
    const notes = h('textarea'); const err = h('div', { class: 'err hidden' });
    const ok = async () => {
      try { await book.createAccount({ name: name.value, type: type.value, currency: ccy.value, opening: normalizeNumber(opening.value) || '0', lowBalanceAlert: normalizeNumber(low.value), notes: notes.value }); close(true); (await import('../dom.js')).toast('تمت إضافة الحساب'); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    };
    return h('div', null, field('اسم الحساب', name), h('div', { class: 'row2' }, field('النوع', type), field('العملة', ccy)),
      field('الرصيد الافتتاحي', opening, 'يُسجَّل كحركة افتتاحية في الدفتر — لا يمكن تعديله لاحقًا إلا بتسوية موثقة'), field('تنبيه عند انخفاض الرصيد عن', low), field('ملاحظات', notes), err,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'إضافة'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

export function reconcileSheet(accountId) {
  const { book } = app;
  return sheet('تسوية الرصيد', (close) => {
    const acc = select(accOptions(), accountId || accOptions()[0]?.[0]);
    const computed = h('div', { class: 'formula', 'aria-live': 'polite' });
    const actual = h('input', { class: 'money', inputmode: 'decimal', placeholder: 'الرصيد الفعلي في المحفظة' });
    const reason = h('input', { placeholder: 'مثال: عمولة غير مسجلة / جرد' }), note = h('textarea'); const err = h('div', { class: 'err hidden' });
    const upd = () => {
      const a = book.accounts.get(acc.value); if (!a) return;
      let diff = null; try { if (actual.value) diff = D(normalizeNumber(actual.value)) - book.balanceBig(a.id); } catch {}
      computed.replaceChildren(h('div', { class: 'r' }, h('span', null, 'الرصيد المحسوب'), M(book.balanceBig(a.id), a.currency)), diff !== null ? h('div', { class: 'r total' }, h('span', null, 'الفرق'), SM(diff, a.currency)) : null);
    };
    acc.addEventListener('change', upd); actual.addEventListener('input', upd); upd();
    const ok = async () => {
      if (!(await requirePin('تسوية رصيد'))) return;
      try { await book.reconcile(acc.value, normalizeNumber(actual.value), reason.value, note.value); close(true); (await import('../dom.js')).toast('تم تسجيل التسوية'); }
      catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    };
    return h('div', null, field('الحساب', acc), computed, field('الرصيد الفعلي', actual), field('سبب التسوية (إجباري)', reason), field('ملاحظات', note), err,
      h('p', { class: 'hint' }, 'التسوية تُسجَّل كحركة مستقلة بالفرق، ولا يمكن حذفها لاحقًا.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'تسجيل التسوية'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

function editSheet(a) {
  const { book } = app;
  return sheet('تعديل الحساب', (close) => {
    const name = h('input', { value: a.name }), type = select(Object.entries(ACCOUNT_TYPES), a.type), notes = h('textarea', null, a.notes || '');
    const low = h('input', { class: 'money', inputmode: 'decimal', value: a.lowBalanceAlert || '' });
    const active = h('input', { type: 'checkbox', checked: a.active }); const err = h('div', { class: 'err hidden' });
    const ok = async () => { try { await book.updateAccount(a.id, { name: name.value, type: type.value, notes: notes.value, lowBalanceAlert: normalizeNumber(low.value), active: active.checked }); close(true); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('الاسم', name), field('النوع', type), field('تنبيه انخفاض الرصيد', low), field('ملاحظات', notes), h('label', { class: 'inline', style: { marginBottom: '.8rem' } }, active, h('span', null, 'الحساب فعّال (الحساب المتوقف لا يقبل عمليات جديدة)')), err,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

function detail(id) {
  const { book } = app; const a = book.accounts.get(id);
  if (!a) return empty('الحساب غير موجود.', h('a', { class: 'btn', href: '#/accounts' }, 'رجوع'));
  const entries = book.ledger.filter((e) => e.accountId === id);
  let run = 0n; const rows = entries.map((e) => { run += D(e.amount); return { e, run }; }).reverse();
  const exp = async (kind) => {
    if (!(await requirePin('تصدير كشف الحساب'))) return;
    const head = ['التاريخ', 'البند', 'العملية', 'المبلغ', 'الرصيد بعدها'];
    const data = rows.slice().reverse().map(({ e, run: r }) => [new Date(e.at).toLocaleString('sv-SE'), (e.reversesId ? 'عكس: ' : '') + KIND_LABEL[e.kind], book.txs.get(e.txId)?.number, e.amount, S(r)]);
    if (kind === 'csv') download(`statement-${a.name}.csv`, toCSV(head, data), 'text/csv;charset=utf-8'); else download(`statement-${a.name}.xlsx`, toXlsx([{ name: 'كشف حساب', headers: head, rows: data }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  return h('div', { class: 'stack' },
    pageTop(a.name, h('a', { class: 'btn sm', href: '#/accounts' }, 'رجوع')),
    h('div', { class: 'card' }, h('div', { class: 'muted small' }, `${ACCOUNT_TYPES[a.type]} ${a.currency}` + (a.active ? '' : ' (متوقف)')), h('div', { class: 'big', style: { fontSize: '1.9rem', fontWeight: '800' } }, M(book.balanceBig(id), a.currency)),
      a.currency !== 'EGP' ? h('div', { class: 'muted' }, '≈ ', M(book.valueBig(id))) : null, a.notes ? h('p', { class: 'muted' }, a.notes) : null,
      h('div', { class: 'inline no-print', style: { marginTop: '.8rem', flexWrap: 'wrap' } }, h('button', { class: 'btn', onClick: () => reconcileSheet(id) }, 'تسوية الرصيد'), h('button', { class: 'btn', onClick: () => editSheet(a) }, 'تعديل'), h('a', { class: 'btn', href: '#/new/internal_transfer' }, 'تحويل'))),
    h('div', { class: 'sect' }, h('h2', null, 'كشف الحساب'), h('div', { class: 'inline no-print', style: { marginBottom: '.5rem' } }, h('button', { class: 'btn sm', onClick: () => exp('csv') }, 'CSV'), h('button', { class: 'btn sm', onClick: () => exp('xlsx') }, 'Excel'), h('button', { class: 'btn sm', onClick: () => window.print() }, 'PDF')),
      rows.length ? h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'التاريخ'), h('th', null, 'البند'), h('th', { class: 'n' }, 'المبلغ'), h('th', { class: 'n' }, 'الرصيد'))),
        h('tbody', null, rows.slice(0, 200).map(({ e, run: r }) => h('tr', { style: e.reversesId ? { opacity: '.7' } : null }, h('td', null, dt(e.at)), h('td', null, h('a', { href: '#/tx/' + e.txId }, (e.reversesId ? 'عكس: ' : '') + (KIND_LABEL[e.kind] || e.kind), ' ', h('span', { class: 'muted small' }, book.txs.get(e.txId)?.number || ''))), h('td', { class: 'n' }, SM(e.amount, a.currency)), h('td', { class: 'n' }, M(r, a.currency)))))), rows.length > 200 ? h('p', { class: 'muted small' }, 'تُعرض آخر 200 حركة — صدّر الكشف للحصول على الكل.') : null) : empty('لا توجد حركات.')));
}
void TX; void txLabel; void accName; void txTitle; void fmt; void go; void attempt; void askReason; void confirmBox;
