import { expenseReport } from '../../domain/reports.js';
import { h } from '../dom.js';
import { app, M, periodBar, rangeNow, pageTop, empty } from '../ctx.js';
import { hbars } from '../charts.js';
import { txItem } from './transactions.js';

let scope = 'personal';
export const toNum = (v) => Number(v) / 1e8;

export function render() {
  const { book } = app; const r = rangeNow(); const rep = expenseReport(book, r);
  const cats = [...rep.byCategory[scope].entries()].map(([id, v]) => ({ label: book.categories.get(id)?.name || '—', value: toNum(v), text: M(v).textContent })).sort((a, b) => b.value - a.value);
  const list = book.txList().filter((t) => t.type === 'expense_' + scope && t.status === 'completed' && t.occurredAt >= r.from && t.occurredAt < r.to);
  return h('div', { class: 'stack' },
    pageTop('المصاريف', h('a', { class: 'btn sm primary', href: '#/new/expense_' + scope }, '+ مصروف')),
    h('div', { class: 'tabs', role: 'tablist' }, h('button', { role: 'tab', 'aria-selected': String(scope === 'personal'), onClick: () => { scope = 'personal'; app.rerender(); } }, 'شخصية'), h('button', { role: 'tab', 'aria-selected': String(scope === 'business'), onClick: () => { scope = 'business'; app.rerender(); } }, 'عمل')),
    periodBar(),
    h('div', { class: 'card' }, h('div', { class: 'muted' }, scope === 'personal' ? 'إجمالي المصاريف الشخصية' : 'إجمالي مصاريف العمل'), h('div', { style: { fontSize: '1.8rem', fontWeight: '800' } }, M(scope === 'personal' ? rep.personal : rep.business))),
    h('div', { class: 'sect' }, h('h2', null, 'حسب التصنيف'), hbars(cats)),
    h('div', { class: 'sect' }, h('h2', null, 'العمليات'), list.length ? h('div', { class: 'list' }, list.map(txItem)) : empty('لا توجد مصاريف في هذه الفترة.')));
}
