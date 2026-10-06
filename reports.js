import { profitReport, expenseReport, walletsReport, summaryReport, netWorthSeries, monthlyProfit, rank, incomeReport } from '../../domain/reports.js';
import { S, fmt } from '../../domain/dec.js';
import { toCSV, toXlsx } from '../../data/export.js';
import { h, download } from '../dom.js';
import { app, M, SM, hd, periodBar, rangeNow, pageTop, empty, requirePin, dShort } from '../ctx.js';
import { barChart, lineChart, hbars, shares } from '../charts.js';
import { localDay } from '../../domain/util.js';

let tab = 'profit';
const TABS = [['profit', 'الأرباح'], ['expenses', 'المصاريف'], ['wallets', 'المحافظ'], ['summary', 'تقرير شامل'], ['charts', 'رسوم بيانية']];
const num = (v) => Number(v) / 1e8;
const card = (title, ...kids) => h('div', { class: 'card' }, h('h3', { style: { marginBottom: '.6rem' } }, title), ...kids);

function exporter(name, head, rows) {
  return h('div', { class: 'inline no-print' },
    h('button', { class: 'btn sm', onClick: async () => { if (await requirePin('تصدير تقرير')) download(name + '.csv', toCSV(head, rows), 'text/csv;charset=utf-8'); } }, 'CSV'),
    h('button', { class: 'btn sm', onClick: async () => { if (await requirePin('تصدير تقرير')) download(name + '.xlsx', toXlsx([{ name: name.slice(0, 30), headers: head, rows }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } }, 'Excel'),
    h('button', { class: 'btn sm', onClick: () => window.print() }, 'PDF'));
}
const kpi = (l, v) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v));

function profitTab(r) {
  const { book } = app; const p = profitReport(book, r);
  const grp = (title, rows, label) => card(title, rows.length ? h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, h('th', null, ''), ['القيمة', 'ربح العملية', 'العمولة', 'الصافي'].map((x) => h('th', { class: 'n' }, x)))),
    h('tbody', null, rows.map((x) => h('tr', null, h('td', null, label(x.id)), h('td', { class: 'n' }, M(x.volume)), h('td', { class: 'n' }, M(x.gross)), h('td', { class: 'n' }, M(x.commission)), h('td', { class: 'n' }, SM(x.net))))))) : h('p', { class: 'muted' }, 'لا توجد بيانات.'));
  const rowsAll = [...p.byService.map((x) => ['خدمة', book.services.get(x.id)?.name || '—', S(x.volume), S(x.gross), S(x.commission), S(x.net)]), ...p.byProvider.map((x) => ['شركة', book.parties.get(x.id)?.name || '—', S(x.volume), S(x.gross), S(x.commission), S(x.net)]), ...p.byCustomer.map((x) => ['عميل', book.parties.get(x.id)?.name || '—', S(x.volume), S(x.gross), S(x.commission), S(x.net)])];
  return h('div', { class: 'stack' }, h('div', { class: 'grid3' }, kpi('إجمالي قيمة العمليات', M(p.volume)), kpi('إجمالي ربح العمليات', SM(p.gross)), kpi('إجمالي عمولات الشركات', SM(-p.commission)), kpi('صافي الربح', SM(p.net)), kpi('عدد العمليات', p.count)),
    h('div', { class: 'formula' }, h('div', { class: 'r' }, h('span', null, 'ربح العمليات'), SM(p.gross)), h('div', { class: 'r' }, h('span', null, '− عمولة الشركات'), SM(-p.commission)), h('div', { class: 'r total' }, h('span', null, 'الربح الصافي'), SM(p.net))),
    grp('حسب الخدمة', p.byService, (id) => book.services.get(id)?.name || 'بدون خدمة'), grp('حسب الشركة', p.byProvider, (id) => book.parties.get(id)?.name || 'بدون شركة'), grp('حسب العميل', p.byCustomer, (id) => book.parties.get(id)?.name || 'بدون عميل'),
    exporter('profit-report', ['البعد', 'الاسم', 'القيمة', 'ربح العملية', 'عمولة الشركة', 'الصافي'], rowsAll));
}
function expensesTab(r) {
  const { book } = app; const e = expenseReport(book, r);
  const cats = (scope) => [...e.byCategory[scope].entries()].map(([id, v]) => ({ label: book.categories.get(id)?.name || '—', value: num(v), text: fmt(v, 'EGP', hd()) })).sort((a, b) => b.value - a.value);
  const byAcc = [...e.byAccount.entries()].map(([id, v]) => ({ label: book.accounts.get(id)?.name || '—', value: num(v), text: fmt(v, 'EGP', hd()) })).sort((a, b) => b.value - a.value);
  const months = [...e.byMonth.entries()].sort().map(([m, v]) => ({ label: m.slice(2), value: num(v) }));
  const rows = [...['personal', 'business'].flatMap((sc) => [...e.byCategory[sc].entries()].map(([id, v]) => [sc === 'personal' ? 'شخصي' : 'عمل', book.categories.get(id)?.name || '—', S(v)]))];
  return h('div', { class: 'stack' }, h('div', { class: 'grid3' }, kpi('مصاريف شخصية', M(e.personal)), kpi('مصاريف العمل', M(e.business)), kpi('الإجمالي', M(e.total))),
    card('الشخصية حسب التصنيف', hbars(cats('personal'))), card('العمل حسب التصنيف', hbars(cats('business'))), card('حسب الحساب', hbars(byAcc)), card('حسب الشهر', barChart(months, { title: 'المصاريف الشهرية' })),
    exporter('expenses-report', ['النوع', 'التصنيف', 'المبلغ (EGP)'], rows));
}
function walletsTab(r) {
  const rows = walletsReport(app.book, r);
  return h('div', { class: 'stack' }, rows.length ? rows.map((x) => card(x.account.name + ' (' + x.account.currency + ')', h('dl', { class: 'kv' },
    h('dt', null, 'رصيد البداية'), h('dd', null, M(x.opening, x.account.currency)), h('dt', null, 'الأموال الداخلة'), h('dd', null, SM(x.in, x.account.currency)), h('dt', null, 'الأموال الخارجة'), h('dd', null, SM(x.out, x.account.currency)),
    h('dt', null, 'التحويلات'), h('dd', null, SM(x.transfers, x.account.currency)), h('dt', null, 'الرصيد النهائي'), h('dd', null, M(x.closing, x.account.currency))))) : empty('لا توجد حسابات.'),
    exporter('wallets-report', ['الحساب', 'العملة', 'رصيد البداية', 'الداخل', 'الخارج', 'التحويلات', 'الرصيد النهائي'], rows.map((x) => [x.account.name, x.account.currency, S(x.opening), S(x.in), S(x.out), S(x.transfers), S(x.closing)])));
}
function summaryTab(r) {
  const s = summaryReport(app.book, r); const p = s.parts;
  const line = (l, v, cls) => h('div', { class: 'r ' + (cls || '') }, h('span', null, l), typeof v === 'bigint' ? SM(v) : v);
  return h('div', { class: 'stack' },
    h('div', { class: 'formula' }, line('رصيد البداية', M(s.start)), line('+ أرصدة افتتاحية لحسابات جديدة', p.opening), line('+ الدخل', p.income), line('+ صافي ربح العمليات', p.profit), line('− المصاريف الشخصية', -expenseReport(app.book, r).personal), line('− مصاريف العمل', -expenseReport(app.book, r).business),
      line('+ إيداعات', p.deposit), line('− سحوبات', p.withdrawal), line('± الديون (إقراض/اقتراض/سداد)', p.debt), line('± التسويات', p.adjustment), line('± التحويلات الداخلية', p.transfer), line('= الرصيد في نهاية الفترة', M(s.end), 'total')),
    s.balanced ? h('div', { class: 'okbox' }, '✅ التقرير متطابق مع الدفتر حتى آخر قرش.') : h('div', { class: 'err' }, 'التقرير غير متطابق مع الدفتر! افتح الإعدادات ← فحص السلامة.'),
    h('div', { class: 'formula' }, line('إجمالي الأموال الآن (بأحدث الأسعار)', M(app.book.ledger.length ? s.end + s.revaluation : 0n)), line('فرق إعادة التقييم وتكلفة التحويل بين العملات', s.revaluation)),
    h('p', { class: 'hint' }, 'الأرقام أعلاه بأسعار الصرف وقت كل حركة. الفرق بينها وبين الأرصدة الحالية يظهر في سطر إعادة التقييم.'),
    exporter('summary-report', ['البند', 'القيمة (EGP)'], [['رصيد البداية', S(s.start)], ['افتتاحي', S(p.opening)], ['دخل', S(p.income)], ['صافي ربح', S(p.profit)], ['مصاريف', S(p.expense)], ['إيداعات', S(p.deposit)], ['سحوبات', S(p.withdrawal)], ['ديون', S(p.debt)], ['تسويات', S(p.adjustment)], ['تحويلات', S(p.transfer)], ['رصيد النهاية', S(s.end)]]));
}
function chartsTab(r) {
  const { book } = app; const p = profitReport(book, r), e = expenseReport(book, r);
  const daily = [...p.daily.entries()].sort().map(([d, v]) => ({ label: d.slice(5), value: num(v) }));
  const monthly = monthlyProfit(book, new Date(r.from).getFullYear() || book.now().getFullYear()).map((m) => ({ label: m.month.slice(5), value: num(m.net) }));
  const growth = netWorthSeries(book, r.from > '1971' ? r.from : (book.ledger[0]?.at || book.now().toISOString()), r.to > book.now().toISOString() ? book.now().toISOString() : r.to).map((x) => ({ label: dShort(x.day), value: num(x.cash) }));
  const cat = (scope) => [...e.byCategory[scope].entries()].map(([id, v]) => ({ label: book.categories.get(id)?.name || '—', value: num(v), text: fmt(v, 'EGP', hd()) })).sort((a, b) => b.value - a.value).slice(0, 8);
  const dist = [...book.accounts.values()].filter((a) => !a.archived).map((a) => ({ label: a.name, value: num(book.valueBig(a.id)), text: fmt(book.valueBig(a.id), 'EGP', hd()) }));
  const top = p.byService.filter((x) => x.id !== '—' || true).slice(0, 8).map((x) => ({ label: book.services.get(x.id)?.name || 'بدون خدمة', value: num(x.net), text: fmt(x.net, 'EGP', hd()) }));
  const allCats = [...e.byCategory.personal.entries(), ...e.byCategory.business.entries()].map(([id, v]) => ({ label: book.categories.get(id)?.name || '—', value: num(v), text: fmt(v, 'EGP', hd()) })).sort((a, b) => b.value - a.value).slice(0, 8);
  return h('div', { class: 'stack' }, card('الأرباح اليومية (صافي)', barChart(daily, { title: 'الأرباح اليومية' })), card('الأرباح الشهرية', barChart(monthly, { title: 'الأرباح الشهرية' })),
    card('المصاريف الشخصية', hbars(cat('personal'))), card('مصاريف العمل', hbars(cat('business'))), card('توزيع الأموال بين المحافظ', dist.length ? shares(dist) : empty('لا توجد حسابات')),
    card('نمو إجمالي الأموال', lineChart(growth, { title: 'نمو إجمالي الأموال' })), card('أعلى الخدمات ربحًا', hbars(top)), card('أعلى المصاريف', hbars(allCats)));
}

export function render() {
  const r = rangeNow();
  const body = { profit: profitTab, expenses: expensesTab, wallets: walletsTab, summary: summaryTab, charts: chartsTab }[tab](r);
  return h('div', { class: 'stack' }, pageTop('التقارير'), periodBar(),
    h('div', { class: 'tabs no-print', role: 'tablist', style: { overflowX: 'auto' } }, TABS.map(([k, l]) => h('button', { role: 'tab', style: { whiteSpace: 'nowrap' }, 'aria-selected': String(tab === k), onClick: () => { tab = k; app.rerender(); } }, l))), body);
}
void rank; void incomeReport; void localDay;
