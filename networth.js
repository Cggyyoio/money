import { netWorth, netWorthSeries } from '../../domain/reports.js';
import { fmt } from '../../domain/dec.js';
import { h } from '../dom.js';
import { app, M, SM, hd, pageTop, dShort } from '../ctx.js';
import { lineChart } from '../charts.js';

let days = 30;
export function render() {
  const { book } = app; const n = netWorth(book);
  const now = book.now(); const from = days ? new Date(now.getTime() - days * 86400000) : new Date(book.ledger[0]?.at || now);
  const series = netWorthSeries(book, from.toISOString(), now.toISOString());
  const first = series[0], last = series[series.length - 1];
  const change = first && last ? last.net - first.net : 0n;
  return h('div', { class: 'stack' }, pageTop('صافي الثروة'),
    h('div', { class: 'hero' }, h('div', { class: 'l' }, 'صافي الثروة'), h('div', { class: 'big' }, h('span', { class: 'num' }, fmt(n.net, '', hd())), h('small', null, 'EGP'))),
    h('div', { class: 'formula' }, h('div', { class: 'r' }, h('span', null, 'إجمالي أموالي'), M(n.money)), h('div', { class: 'r' }, h('span', null, '+ المستحق لي'), M(n.receivable)), h('div', { class: 'r' }, h('span', null, '− المستحق عليّ'), M(n.payable)), h('div', { class: 'r total' }, h('span', null, '= صافي الثروة'), M(n.net))),
    h('div', { class: 'sect' }, h('h2', null, 'التطور بمرور الوقت'),
      h('div', { class: 'chips', role: 'group' }, [[30, '30 يومًا'], [90, '90 يومًا'], [365, 'سنة'], [0, 'الكل']].map(([d, l]) => h('button', { class: 'chip', 'aria-pressed': String(days === d), onClick: () => { days = d; app.rerender(); } }, l))),
      h('div', { class: 'card', style: { marginTop: '.6rem' } }, lineChart(series.map((p) => ({ label: dShort(p.day), value: Number(p.net) / 1e8 })), { title: 'صافي الثروة' }), h('p', { class: 'muted small' }, 'التغير في الفترة: ', SM(change)), h('p', { class: 'hint' }, 'المنحنى بأسعار الصرف وقت كل حركة؛ الرقم الكبير بأحدث الأسعار.'))));
}
