import { partyStats } from '../../domain/reports.js';
import { D } from '../../domain/dec.js';
import { h, field, sheet, clear } from '../dom.js';
import { app, M, SM, pageTop, empty, dt, go } from '../ctx.js';
import { txItem } from './transactions.js';

const KINDS = [['customer', 'العملاء'], ['provider', 'الشركات'], ['supplier', 'الموردون']];
let tab = 'customer', q = '';

function partySheet(kind, p) {
  return sheet((p ? 'تعديل ' : 'إضافة ') + KINDS.find((k) => k[0] === kind)[1].replace(/^ال/, ''), (close) => {
    const name = h('input', { value: p?.name || '' }), phone = h('input', { inputmode: 'tel', value: p?.phone || '' }), notes = h('textarea', null, p?.notes || ''); const err = h('div', { class: 'err hidden' });
    const ok = async () => { try { if (p) await app.book.updateParty(p.id, { name: name.value, phone: phone.value, notes: notes.value }); else await app.book.addParty({ kind, name: name.value, phone: phone.value, notes: notes.value }); close(true); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('الاسم', name), field('رقم الهاتف', phone), field('ملاحظات', notes), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

export function render(parts) {
  if (parts[0]) return detail(parts[0]);
  const { book } = app; const box = h('div', { class: 'list' });
  const paint = () => {
    clear(box); const t = q.trim().toLowerCase();
    const l = [...book.parties.values()].filter((p) => p.kind === tab && !p.archived && (!t || (p.name + ' ' + (p.phone || '')).toLowerCase().includes(t)));
    if (!l.length) return box.append(empty(t ? 'لا نتائج.' : 'لا توجد بيانات بعد.'));
    for (const p of l) { const st = partyStats(book, p.id); box.append(h('a', { class: 'item', href: '#/parties/' + p.id }, h('div', { class: 'ic' }, '👤'), h('div', { class: 'main' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, p.phone || (st.count + ' عملية'))), h('div', { class: 'amt' }, p.kind === 'customer' ? SM(st.profit) : M(st.volume), st.owesMe > 0n ? h('small', null, 'مستحق لي ', M(st.owesMe)) : st.iOwe > 0n ? h('small', null, 'مستحق عليّ ', M(st.iOwe)) : null))); }
  };
  const search = h('input', { type: 'search', placeholder: 'بحث بالاسم أو رقم الهاتف', value: q, 'aria-label': 'بحث' }); search.addEventListener('input', () => { q = search.value; paint(); });
  paint();
  return h('div', { class: 'stack' }, pageTop('العملاء والشركات', h('button', { class: 'btn sm primary', onClick: () => partySheet(tab) }, '+ إضافة')),
    h('div', { class: 'tabs', role: 'tablist' }, KINDS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(tab === k), onClick: () => { tab = k; app.rerender(); } }, l))), search, box);
}

function detail(id) {
  const { book } = app; const p = book.parties.get(id);
  if (!p) return empty('غير موجود.', h('a', { class: 'btn', href: '#/parties' }, 'رجوع'));
  const st = partyStats(book, id); const kpi = (l, v) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));
  const debts = [...book.debts.values()].filter((d) => d.partyId === id && book.debtStatus(d) === 'open');
  return h('div', { class: 'stack' }, pageTop(p.name, h('a', { class: 'btn sm', href: '#/parties' }, 'رجوع'), h('button', { class: 'btn sm', onClick: () => partySheet(p.kind, p) }, 'تعديل')),
    h('div', { class: 'card' }, h('div', { class: 'muted' }, p.phone || 'بدون رقم هاتف'), p.notes ? h('p', null, p.notes) : null, h('div', { class: 'muted small' }, 'آخر تعامل: ' + (st.last ? dt(st.last) : '—'))),
    h('div', { class: 'grid3' }, kpi('إجمالي العمليات', st.count), kpi('إجمالي المبالغ', M(st.volume)), kpi('إجمالي الأرباح', SM(st.profit)), kpi('المستحق عليه لي', M(st.owesMe)), kpi('المستحق له عليّ', M(st.iOwe))),
    debts.length ? h('div', { class: 'sect' }, h('h2', null, 'ديون مفتوحة'), h('a', { class: 'btn block', href: '#/debts' }, 'فتح صفحة الديون')) : null,
    h('div', { class: 'sect' }, h('h2', null, 'سجل العمليات'), st.txs.length ? h('div', { class: 'list' }, st.txs.map(txItem)) : empty('لا توجد عمليات.')));
}
void D; void go;
