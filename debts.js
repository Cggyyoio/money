import { D, fmt } from '../../domain/dec.js';
import { h, field, select, sheet } from '../dom.js';
import { app, M, hd, pageTop, empty, accOptions, attempt, partyName, dt, localInput } from '../ctx.js';
import { normalizeNumber } from '../../domain/dec.js';

let tab = 'receivable', showClosed = false;

function paySheet(d) {
  const { book } = app; const rem = book.debtRemainingBig(d);
  return sheet(d.direction === 'receivable' ? 'تسجيل سداد مستلم' : 'تسجيل سداد مدفوع', (close) => {
    const amount = h('input', { class: 'money', inputmode: 'decimal', value: fmt(rem, '', { hideDecimals: false }).replace(/,/g, '').replace(/\.00$/, '') });
    const acc = select(accOptions(), accOptions()[0]?.[0]); const when = h('input', { type: 'datetime-local', value: localInput() }); const note = h('input'); const err = h('div', { class: 'err hidden' });
    const ok = async () => { try { await book.payDebt(d.id, { amount: normalizeNumber(amount.value), accountId: acc.value, occurredAt: new Date(when.value).toISOString(), note: note.value }); close(true); (await import('../dom.js')).toast('تم تسجيل السداد'); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, h('p', { class: 'muted' }, `${partyName(d.partyId)} — المتبقي `, M(rem, d.currency)), field(`المبلغ (${d.currency})`, amount), field(d.direction === 'receivable' ? 'يدخل إلى حساب' : 'يخرج من حساب', acc), field('التاريخ', when), field('ملاحظة', note), err,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'تسجيل'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

export function render() {
  const { book } = app;
  const all = [...book.debts.values()].filter((d) => d.direction === tab);
  const open = all.filter((d) => book.debtStatus(d) === 'open'), closed = all.filter((d) => book.debtStatus(d) !== 'open');
  const card = (d) => {
    const rem = book.debtRemainingBig(d), pr = D(d.principal), paid = pr - rem, st = book.debtStatus(d); const pct = pr > 0n ? Number((paid * 100n) / pr) : 0;
    const overdue = d.dueDate && st === 'open' && d.dueDate < new Date().toISOString().slice(0, 10);
    return h('div', { class: 'card' }, h('div', { class: 'inline' }, h('b', null, partyName(d.partyId)), st !== 'open' ? h('span', { class: 'badge ' + (st === 'paid' ? 'completed' : 'cancelled') }, st === 'paid' ? 'مسدد' : 'ملغي') : overdue ? h('span', { class: 'badge failed' }, 'متأخر') : null),
      h('div', { class: 'grid3', style: { margin: '.6rem 0' } }, h('div', null, h('div', { class: 'muted small' }, 'المستحق'), M(pr, d.currency)), h('div', null, h('div', { class: 'muted small' }, 'المدفوع'), M(paid, d.currency)), h('div', null, h('div', { class: 'muted small' }, 'المتبقي'), h('b', null, M(rem, d.currency)))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'muted small', style: { margin: '.4rem 0' } }, [d.dueDate ? 'الاستحقاق ' + d.dueDate + '  ' : '', d.noCash ? 'دين قائم مسبقًا (بدون حركة نقدية)  ' : '', d.note || '']),
      h('div', { class: 'inline no-print', style: { flexWrap: 'wrap' } }, st === 'open' ? h('button', { class: 'btn sm primary', onClick: () => paySheet(d) }, d.direction === 'receivable' ? 'استلمت سداد' : 'سددت') : null, h('a', { class: 'btn sm', href: '#/tx/' + d.originTxId }, 'تفاصيل'), h('a', { class: 'btn sm', href: '#/parties/' + d.partyId }, partyName(d.partyId))),
      paid > 0n ? h('details', { style: { marginTop: '.5rem' } }, h('summary', { class: 'small muted' }, 'المدفوعات'), h('div', { class: 'list', style: { marginTop: '.4rem' } }, book.paymentsOf(d.id).map((t) => h('a', { class: 'item', href: '#/tx/' + t.id }, h('div', { class: 'main' }, h('div', { class: 't' }, dt(t.occurredAt)), h('div', { class: 's' }, t.number)), h('div', { class: 'amt' }, M(t.amount, t.currency)))))) : null);
  };
  return h('div', { class: 'stack' },
    pageTop('الديون والمستحقات', h('a', { class: 'btn sm primary', href: '#/new/' + (tab === 'receivable' ? 'debt_to_me' : 'debt_on_me') }, '+ دين جديد')),
    h('div', { class: 'tabs', role: 'tablist' }, h('button', { role: 'tab', 'aria-selected': String(tab === 'receivable'), onClick: () => { tab = 'receivable'; app.rerender(); } }, 'لي عند الآخرين'), h('button', { role: 'tab', 'aria-selected': String(tab === 'payable'), onClick: () => { tab = 'payable'; app.rerender(); } }, 'عليّ للآخرين')),
    open.length ? h('p', { class: 'muted' }, `${open.length} دين مفتوح — المتبقي: `, h('span', null, [...new Set(open.map((d) => d.currency))].map((c) => h('span', { style: { marginInlineEnd: '.5rem' } }, M(open.filter((d) => d.currency === c).reduce((s, d) => s + book.debtRemainingBig(d), 0n), c))))) : null,
    open.length ? open.map(card) : empty(tab === 'receivable' ? 'لا توجد مبالغ مستحقة لك.' : 'لا توجد مبالغ مستحقة عليك.'),
    closed.length ? h('div', { class: 'sect' }, h('button', { class: 'btn sm', onClick: () => { showClosed = !showClosed; app.rerender(); } }, (showClosed ? 'إخفاء' : 'عرض') + ` المسددة والملغاة (${closed.length})`), showClosed ? h('div', { class: 'stack', style: { marginTop: '.7rem' } }, closed.map(card)) : null) : null);
}
void hd; void attempt;
