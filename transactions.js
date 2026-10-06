import { searchTx, txNet } from '../../domain/reports.js';
import { TX, STATUS, isTrade } from '../../domain/constants.js';
import { D, S, fmt } from '../../domain/dec.js';
import { toCSV, toXlsx } from '../../data/export.js';
import { h, clear, field, select, download, confirmBox, sheet } from '../dom.js';
import { app, M, SM, hd, accName, partyName, txLabel, txIcon, statusBadge, dt, dShort, go, attempt, requirePin, askReason, KIND_LABEL, pageTop, empty, accOptions } from '../ctx.js';

/** signed cash effect on the user's money (for list display) */
function cashEffect(t) {
  const { book } = app;
  const a = D(t.amount || '0');
  switch (t.type) {
    case 'income': case 'deposit': case 'opening': return a;
    case 'expense_personal': case 'expense_business': case 'withdrawal': return -a;
    case 'debt_to_me': return t.accountId ? -a : 0n;
    case 'debt_on_me': return t.accountId ? a : 0n;
    case 'debt_payment': return book.debts.get(t.debtId)?.direction === 'receivable' ? a : -a;
    case 'adjustment': return D(t.diff);
    default: return null;
  }
}

export function txTitle(t) {
  const { book } = app;
  if (isTrade(t.type)) return `${txLabel(t)}${t.serviceId ? ' — ' + (book.services.get(t.serviceId)?.name || '') : ''}`;
  if (t.type === 'internal_transfer') return `${accName(t.fromAccountId)} ← ${accName(t.toAccountId)}`.replace('←', '→');
  if (t.categoryId) return `${txLabel(t)} — ${book.categories.get(t.categoryId)?.name || ''}`;
  if (t.type === 'debt_payment') return `${txLabel(t)} — ${partyName(t.partyId)}`;
  if (t.type === 'debt_to_me' || t.type === 'debt_on_me') return `${txLabel(t)} — ${partyName(t.partyId)}`;
  if (t.accountId) return `${txLabel(t)} — ${accName(t.accountId)}`;
  return txLabel(t);
}

export function txItem(t) {
  const dead = t.status === 'failed' || t.status === 'cancelled' || t.status === 'refunded';
  let amt, sub;
  if (isTrade(t.type)) { amt = SM(txNet(t), t.currency); sub = 'قيمة ' + fmt(t.amount, t.currency, hd()); }
  else if (t.type === 'internal_transfer') { amt = M(t.amount, t.currency); sub = ''; }
  else { const c = cashEffect(t); amt = c === null ? M(t.amount, t.currency) : SM(c, t.currency); sub = ''; }
  return h('a', { class: 'item', href: '#/tx/' + t.id, style: dead ? { opacity: '.62' } : null },
    h('div', { class: 'ic', 'aria-hidden': 'true' }, txIcon(t.type)),
    h('div', { class: 'main' }, h('div', { class: 't' }, txTitle(t)), h('div', { class: 's' }, [t.partyId && isTrade(t.type) ? partyName(t.partyId) + '  ' : '', dShort(t.occurredAt), '  ', t.number, '  ', t.status !== 'completed' ? statusBadge(t.status) : ''])),
    h('div', { class: 'amt' }, amt, sub ? h('small', null, sub) : null));
}

// ---------- list ----------
const filters = { q: '', type: '', status: '', accountId: '', partyId: '', from: '', to: '', minAmount: '', maxAmount: '', minProfit: '', maxProfit: '' };
let limit = 40;

function currentFilter() {
  const f = { ...filters };
  for (const k of Object.keys(f)) if (f[k] === '') delete f[k];
  if (f.from) f.from = new Date(f.from + 'T00:00:00').toISOString();
  if (f.to) f.to = new Date(new Date(f.to + 'T00:00:00').getTime() + 86400000).toISOString();
  return f;
}
function rowsFor(list) {
  return list.map((t) => [t.number, new Date(t.occurredAt).toLocaleString('sv-SE'), txLabel(t), STATUS[t.status].label, t.amount, t.currency, isTrade(t.type) ? S(D(t.customerPaid) - D(t.amount)) : '', isTrade(t.type) ? S(D(t.providerCharged) - D(t.amount)) : '', isTrade(t.type) ? S(txNet(t)) : '',
    accName(t.receiveAccountId || t.toAccountId || t.accountId), accName(t.payAccountId || t.fromAccountId), partyName(t.partyId), app.book.services.get(t.serviceId)?.name || '', app.book.categories.get(t.categoryId)?.name || '', t.note || '']);
}
const HEAD = ['رقم العملية', 'التاريخ', 'النوع', 'الحالة', 'القيمة', 'العملة', 'ربح العملية', 'عمولة الشركة', 'الربح الصافي', 'حساب الاستلام', 'حساب الدفع', 'العميل', 'الخدمة', 'التصنيف', 'ملاحظات'];

export function render(parts) {
  if (parts[0]) return detail(parts[0]);
  const { book } = app;
  const listBox = h('div', { class: 'list' }), count = h('p', { class: 'muted small' });
  const paint = () => {
    const all = searchTx(book, currentFilter()); clear(listBox);
    count.textContent = `${all.length} عملية`;
    if (!all.length) listBox.append(empty(book.txs.size ? 'لا توجد عمليات مطابقة للبحث.' : 'لا توجد عمليات بعد.', h('a', { class: 'btn primary', href: '#/new' }, '+ عملية جديدة')));
    all.slice(0, limit).forEach((t) => listBox.append(txItem(t)));
    if (all.length > limit) listBox.append(h('button', { class: 'btn block', onClick: () => { limit += 40; paint(); } }, 'عرض المزيد'));
  };
  const bind = (key, el, ev = 'input') => { el.addEventListener(ev, () => { filters[key] = el.value; limit = 40; paint(); }); return el; };
  const search = bind('q', h('input', { type: 'search', placeholder: 'ابحث: رقم العملية، عميل، هاتف، محفظة، خدمة، شركة، تصنيف، مبلغ…', value: filters.q, 'aria-label': 'بحث' }));
  const types = [['', 'كل الأنواع'], ...Object.entries(TX).filter(([k]) => k !== 'opening').map(([k, v]) => [k, v.label])];
  const parties = [['', 'كل العملاء'], ...[...book.parties.values()].map((p) => [p.id, p.name])];
  const panel = h('div', { class: 'card hidden stack', id: 'flt' },
    h('div', { class: 'row2' }, field('النوع', bind('type', select(types, filters.type), 'change')), field('الحالة', bind('status', select([['', 'كل الحالات'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])], filters.status), 'change'))),
    h('div', { class: 'row2' }, field('الحساب', bind('accountId', select(accOptions(() => true, 'كل الحسابات'), filters.accountId), 'change')), field('العميل', bind('partyId', select(parties, filters.partyId), 'change'))),
    h('div', { class: 'row2' }, field('من تاريخ', bind('from', h('input', { type: 'date', value: filters.from }), 'change')), field('إلى تاريخ', bind('to', h('input', { type: 'date', value: filters.to }), 'change'))),
    h('div', { class: 'row2' }, field('أقل مبلغ', bind('minAmount', h('input', { class: 'money', inputmode: 'decimal', value: filters.minAmount }))), field('أكبر مبلغ', bind('maxAmount', h('input', { class: 'money', inputmode: 'decimal', value: filters.maxAmount })))),
    h('div', { class: 'row2' }, field('أقل ربح صافي', bind('minProfit', h('input', { class: 'money', inputmode: 'decimal', value: filters.minProfit }))), field('أكبر ربح صافي', bind('maxProfit', h('input', { class: 'money', inputmode: 'decimal', value: filters.maxProfit })))),
    h('button', { class: 'btn', onClick: () => { for (const k of Object.keys(filters)) filters[k] = ''; app.rerender(); } }, 'مسح الفلاتر'));
  const exp = async (kind) => {
    const list = searchTx(book, currentFilter());
    if (!(await requirePin('تصدير البيانات'))) return;
    if (kind === 'csv') download('moneyflow-transactions.csv', toCSV(HEAD, rowsFor(list)), 'text/csv;charset=utf-8');
    else download('moneyflow-transactions.xlsx', toXlsx([{ name: 'العمليات', headers: HEAD, rows: rowsFor(list) }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  paint();
  return h('div', { class: 'stack' },
    pageTop('العمليات', h('a', { class: 'btn sm primary', href: '#/new' }, '+ عملية جديدة')),
    search,
    h('div', { class: 'inline no-print' }, h('button', { class: 'btn sm', 'aria-controls': 'flt', onClick: () => panel.classList.toggle('hidden') }, 'تصفية'), h('button', { class: 'btn sm', onClick: () => exp('csv') }, 'CSV'), h('button', { class: 'btn sm', onClick: () => exp('xlsx') }, 'Excel')),
    panel, count, listBox);
}

// ---------- detail ----------
const EVENT_LABEL = { created: 'تم إنشاء العملية', completed: 'اكتملت', failed: 'فشلت', cancelled: 'أُلغيت', refunded: 'اُستردّت', amended: 'تم تعديلها' };
const FIELD_LABEL = { amount: 'القيمة', customerPaid: 'دفع العميل', providerCharged: 'خصم الشركة', receiveAccountId: 'حساب الاستلام', payAccountId: 'حساب الدفع', accountId: 'الحساب', fromAccountId: 'من', toAccountId: 'إلى', toAmount: 'المبلغ المستلم', categoryId: 'التصنيف', partyId: 'العميل', serviceId: 'الخدمة', providerId: 'الشركة', note: 'ملاحظات', occurredAt: 'التاريخ', currency: 'العملة', dueDate: 'الاستحقاق' };
function showVal(k, v) {
  if (v === null || v === undefined) return '—';
  const { book } = app;
  if (/AccountId$|^accountId$/.test(k)) return accName(v);
  if (k === 'partyId' || k === 'providerId') return partyName(v);
  if (k === 'serviceId') return book.services.get(v)?.name || v;
  if (k === 'categoryId') return book.categories.get(v)?.name || v;
  if (k === 'occurredAt') return dt(v);
  return String(v);
}

function detail(id) {
  const { book } = app; const t = book.txs.get(id);
  if (!t) return h('div', null, pageTop('العملية'), empty('العملية غير موجودة.', h('a', { class: 'btn', href: '#/tx' }, 'رجوع')));
  const a = book.actions(t); const trade = isTrade(t.type);
  const kv = [];
  const add = (k, v) => { if (v !== undefined && v !== null && v !== '') kv.push(h('dt', null, k), h('dd', null, v)); };
  add('رقم العملية', t.number); add('التاريخ', dt(t.occurredAt)); add('الحالة', statusBadge(t.status)); add('النوع', txLabel(t));
  if (t.partyId) add(t.type.startsWith('debt') ? 'الطرف' : 'العميل', partyName(t.partyId));
  if (t.providerId) add('الشركة / المزود', partyName(t.providerId));
  if (t.serviceId) add('الخدمة', book.services.get(t.serviceId)?.name);
  if (t.categoryId) add('التصنيف', book.categories.get(t.categoryId)?.name);
  if (trade) { add('الحساب المستلم', accName(t.receiveAccountId)); add('الحساب المستخدم للدفع', accName(t.payAccountId)); }
  else if (t.type === 'internal_transfer') { add('من حساب', accName(t.fromAccountId)); add('إلى حساب', accName(t.toAccountId)); add('المبلغ', fmt(t.amount, t.currency, hd())); if (t.toAmount !== t.amount) add('المستلم', fmt(t.toAmount, book.accounts.get(t.toAccountId)?.currency, hd())); }
  else if (t.accountId) add('الحساب', accName(t.accountId));
  if (t.type === 'adjustment') { add('الرصيد المحسوب', fmt(t.computed, t.currency, hd())); add('الرصيد الفعلي', fmt(t.actual, t.currency, hd())); add('الفرق', fmt(t.diff, t.currency, hd())); add('سبب التسوية', t.reason); }
  if (t.dueDate) add('الاستحقاق', t.dueDate);
  if (t.debtId) add('الدين', h('a', { href: '#/debts' }, 'فتح الدين'));
  add('ملاحظات', t.note);

  const profitBox = trade ? h('div', { class: 'formula', 'aria-label': 'تفاصيل الربح' },
    h('div', { class: 'r' }, h('span', null, 'قيمة العملية'), M(t.amount, t.currency)),
    h('div', { class: 'r' }, h('span', null, 'دفع العميل'), M(t.customerPaid, t.currency)),
    h('div', { class: 'r' }, h('span', null, 'خصم الشركة'), M(t.providerCharged, t.currency)),
    h('div', { class: 'r' }, h('span', null, 'ربح العملية'), SM(D(t.customerPaid) - D(t.amount), t.currency)),
    h('div', { class: 'r' }, h('span', null, 'عمولة الشركة'), SM(-(D(t.providerCharged) - D(t.amount)), t.currency)),
    h('div', { class: 'r total' }, h('span', null, 'الربح الصافي'), SM(txNet(t), t.currency))) : null;

  const act = async (fn, okMsg) => { if (await attempt(fn, okMsg)) app.rerender(); };
  const buttons = h('div', { class: 'inline no-print', style: { flexWrap: 'wrap' } },
    a.complete ? h('button', { class: 'btn primary', onClick: async () => { if (await confirmBox('إكمال العملية', 'سيتم تسجيل الأثر المالي على الحسابات الآن.', 'إكمال')) act(() => book.completeTx(t.id), 'اكتملت العملية'); } }, 'إكمال') : null,
    a.fail ? h('button', { class: 'btn', onClick: async () => { const r = await askReason('تحديد العملية كفاشلة', 'سبب الفشل'); if (r) act(() => book.failTx(t.id, r), 'تم التحديد كفاشلة'); } }, 'فشلت') : null,
    a.amend ? h('a', { class: 'btn', href: `#/new/${t.type === 'debt_to_me' || t.type === 'debt_on_me' ? t.type : t.type}/${t.id}` }, 'تعديل') : null,
    a.refund ? h('button', { class: 'btn', onClick: async () => { const r = await askReason('استرداد العملية', 'سبب الاسترداد'); if (r && (await requirePin('استرداد عملية'))) act(() => book.refundTx(t.id, r), 'تم الاسترداد'); } }, 'استرداد') : null,
    a.cancel ? h('button', { class: 'btn danger', onClick: async () => { const r = await askReason('إلغاء العملية', 'سبب الإلغاء'); if (r && (await requirePin('إلغاء عملية'))) act(() => book.cancelTx(t.id, r), 'تم الإلغاء'); } }, 'إلغاء') : null);

  const events = book.eventsOf(t.id);
  const timeline = h('ul', { class: 'timeline' }, events.map((e) => h('li', null, h('div', null, h('b', null, EVENT_LABEL[e.type] || e.type), '  ', h('span', { class: 'muted small' }, dt(e.at))),
    e.reason ? h('div', { class: 'small' }, 'السبب: ' + e.reason) : null,
    e.type === 'amended' ? h('div', { class: 'small muted' }, Object.keys(e.data.new).map((k) => h('div', null, `${FIELD_LABEL[k] || k}: `, h('s', null, showVal(k, e.data.old[k])), ' ← ', showVal(k, e.data.new[k])))) : null)));

  const entries = book.entriesByTx.get(t.id) || [];
  const ledger = entries.length ? h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, ['#', 'البند', 'الحساب', 'المبلغ', 'بالجنيه'].map((x, i) => h('th', { class: i > 2 ? 'n' : '' }, x)))),
    h('tbody', null, entries.map((e) => h('tr', { style: e.reversesId ? { opacity: '.7' } : null }, h('td', null, e.seq), h('td', null, (e.reversesId ? 'عكس: ' : '') + (KIND_LABEL[e.kind] || e.kind)), h('td', null, e.accountId ? accName(e.accountId) : '—'), h('td', { class: 'n' }, SM(e.amount, e.currency)), h('td', { class: 'n' }, e.accountId ? SM(e.base) : h('span', { class: 'muted' }, 'بيان')))))))
    : h('p', { class: 'muted' }, 'لا توجد حركات مالية لهذه العملية' + (t.status === 'pending' ? ' (معلقة)' : '') + '.');

  return h('div', { class: 'stack' },
    pageTop(txTitle(t), h('a', { class: 'btn sm', href: '#/tx' }, 'رجوع'), h('button', { class: 'btn sm no-print', onClick: () => window.print() }, 'طباعة / PDF')),
    h('div', { class: 'card' }, h('dl', { class: 'kv' }, kv)),
    profitBox, buttons, a.why ? h('p', { class: 'hint' }, a.why) : null,
    h('div', { class: 'sect' }, h('h2', null, 'سجل العملية'), timeline),
    h('div', { class: 'sect' }, h('h2', null, 'الحركات في الدفتر'), ledger));
}
void sheet; void go;
