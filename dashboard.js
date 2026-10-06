import { dashboard } from '../../domain/reports.js';
import { notifications } from '../../domain/notify.js';
import { D, fmt } from '../../domain/dec.js';
import { h } from '../dom.js';
import { app, M, SM, hd, periodBar, rangeNow, pageTop, bellLink, accName, empty } from '../ctx.js';
import { shares } from '../charts.js';
import { txItem } from './transactions.js';

export function render() {
  const { book } = app; const r = rangeNow(); const d = dashboard(book, r);
  const rows = d.accounts.filter((a) => a.account.active || a.balance !== 0n).map((a) => ({ label: a.account.name, value: Number(a.egp / 100000000n), text: fmt(a.balance, a.account.currency, hd()) + (a.account.currency !== 'EGP' ? ` ≈ ${fmt(a.egp, 'EGP', hd())}` : '') }));
  const nots = notifications(book).slice(0, 3);
  const kpi = (l, v) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));
  const hero = h('section', { class: 'hero', 'aria-label': 'إجمالي الأموال' },
    h('div', { class: 'l' }, 'إجمالي أموالي الآن'),
    h('div', { class: 'big' }, h('span', { class: 'num' }, fmt(d.total, '', hd())), h('small', null, 'EGP')),
    d.accounts.length ? shares(rows) : h('p', { class: 'l' }, 'أضف أول حساب لتبدأ.'),
    h('div', { class: 'foot' }, h('span', null, 'لي عند الآخرين ', M(d.receivable)), h('span', null, 'عليّ للآخرين ', M(d.payable)), d.pending ? h('span', null, `${d.pending} معلقة`) : null));
  return h('div', null,
    pageTop('الرئيسية', bellLink(), h('a', { class: 'btn sm primary', href: '#/new' }, '+ عملية جديدة')),
    hero,
    !book.accounts.size ? h('div', { class: 'card', style: { marginTop: '1rem' } }, h('h2', null, 'ابدأ من هنا'), h('p', { class: 'muted' }, 'أنشئ المحافظ والحسابات (فودافون كاش، إنستاباي، البنك، الكاش…) برصيدها الحالي، وبعدها سجّل عملياتك.'), h('a', { class: 'btn primary', href: '#/accounts' }, 'إضافة حساب')) : null,
    h('div', { class: 'sect' }, periodBar()),
    h('div', { class: 'grid3', style: { marginTop: '.75rem' } },
      kpi('صافي التغير المالي', SM(d.change)), kpi('ربح العمليات', SM(d.profit.gross)), kpi('عمولات الشركات', SM(-d.profit.commission)), kpi('صافي الربح', SM(d.profit.net)),
      kpi('مصاريف شخصية', M(d.expenses.personal)), kpi('مصاريف العمل', M(d.expenses.business)), kpi('دخل', M(d.income.income)), kpi('قيمة العمليات', M(d.profit.volume))),
    nots.length ? h('div', { class: 'sect' }, h('h2', null, 'تنبيهات'), h('div', { class: 'list' }, nots.map((n) => h('a', { class: 'item wrap', href: n.link }, h('div', { class: 'ic' }, n.level === 'bad' ? '🔴' : n.level === 'good' ? '🟢' : '🟡'), h('div', { class: 'main' }, h('div', { class: 't' }, n.title), h('div', { class: 's' }, n.body)))))) : null,
    h('div', { class: 'sect' }, h('h2', null, 'آخر العمليات'),
      (() => { const l = book.txList().filter((t) => t.type !== 'opening').slice(0, 6); return l.length ? h('div', { class: 'list' }, l.map(txItem), h('a', { class: 'btn block', href: '#/tx' }, 'كل العمليات')) : empty('لا توجد عمليات بعد.', h('a', { class: 'btn primary', href: '#/new' }, '+ عملية جديدة')); })()));
}
void D; void accName;
