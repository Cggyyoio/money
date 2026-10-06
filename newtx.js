import { TX, isTrade } from '../../domain/constants.js';
import { D, S, fmt, normalizeNumber } from '../../domain/dec.js';
import { h, field, select, sheet, clear } from '../dom.js';
import { app, M, SM, hd, go, attempt, requirePin, askReason, localInput, pageTop, txIcon, accOptions, empty } from '../ctx.js';
import { reconcileSheet } from './accounts.js';
import { txItem } from './transactions.js';

const PICKER = ['sell', 'buy', 'transfer', 'topup', 'cashout', 'income', 'expense_personal', 'expense_business', 'deposit', 'withdrawal', 'debt_to_me', 'debt_on_me', 'refund', 'adjustment', 'internal_transfer'];
const LABELS = { refund: 'استرداد', adjustment: 'تعديل / تسوية' };
const HINTS = { sell: 'عملية بيع بعمولة', buy: 'عملية شراء بعمولة', transfer: 'تحويل لعميل', topup: 'شحن رصيد', cashout: 'سحب لعميل', income: 'راتب أو دخل آخر', expense_personal: 'أكل، مواصلات…', expense_business: 'VPS، إعلانات…', deposit: 'فلوس تدخل من برا', withdrawal: 'فلوس تخرج لك', debt_to_me: 'أقرضت شخصًا', debt_on_me: 'اقترضت من شخص', refund: 'ارجع عملية سابقة', adjustment: 'اضبط الرصيد الفعلي', internal_transfer: 'نقل بين محافظك' };

export function render(parts) {
  const [type, txId] = parts;
  if (!type) return picker();
  if (type === 'refund') return refundPicker();
  if (type === 'adjustment') { queueMicrotask(() => reconcileSheet().then(() => go('#/accounts'))); return h('div', null, pageTop('تسوية رصيد'), empty('اختر الحساب من النافذة…')); }
  if (!TX[type]) return picker();
  return form(type, txId);
}

function picker() {
  return h('div', { class: 'stack' }, pageTop('عملية جديدة'),
    h('div', { class: 'list' }, PICKER.map((k) => h('a', { class: 'item', href: '#/new/' + k }, h('div', { class: 'ic', 'aria-hidden': 'true' }, txIcon(k === 'refund' ? 'cashout' : k)), h('div', { class: 'main' }, h('div', { class: 't' }, LABELS[k] || TX[k].label), h('div', { class: 's' }, HINTS[k]))))));
}
function refundPicker() {
  const list = app.book.txList().filter((t) => isTrade(t.type) && t.status === 'completed');
  return h('div', { class: 'stack' }, pageTop('استرداد عملية', h('a', { class: 'btn sm', href: '#/new' }, 'رجوع')), h('p', { class: 'muted' }, 'اختر العملية المكتملة التي تريد استردادها، ثم اضغط "استرداد" في صفحتها.'),
    list.length ? h('div', { class: 'list' }, list.slice(0, 60).map(txItem)) : empty('لا توجد عمليات تجارية مكتملة.'));
}

// ---------- reusable controls ----------
const money = (v = '') => h('input', { class: 'money', inputmode: 'decimal', autocomplete: 'off', value: v, placeholder: '0' });
const balLabel = (a) => `${a.name} — ${fmt(app.book.balanceBig(a.id), a.currency, hd())}`;
const acctSelect = (value, withEmpty) => select([...(withEmpty ? [['', withEmpty]] : []), ...[...app.book.accounts.values()].filter((a) => !a.archived && (a.active || a.id === value)).map((a) => [a.id, balLabel(a)])], value);

/** select with an "add new…" entry that opens a small sheet. */
function quickSelect(items, value, addLabel, addFn, emptyLabel = '— بدون —') {
  const el = h('select');
  const fill = (sel) => { clear(el); el.append(h('option', { value: '' }, emptyLabel), ...items().map(([v, l]) => h('option', { value: v }, l)), h('option', { value: '__new' }, '＋ ' + addLabel)); el.value = sel || ''; };
  fill(value);
  let last = value || '';
  el.addEventListener('change', async () => {
    if (el.value !== '__new') { last = el.value; return; }
    const id = await addFn(); fill(id || last); last = el.value;
  });
  return el;
}
function addPartySheet(kind, title) {
  return sheet(title, (close) => {
    const name = h('input', { autocomplete: 'off' }), phone = h('input', { inputmode: 'tel', autocomplete: 'off' }); const err = h('div', { class: 'err hidden' });
    const ok = async () => { try { const p = await app.book.addParty({ kind, name: name.value, phone: phone.value }); close(p.id); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('الاسم', name), kind === 'customer' ? field('رقم الهاتف', phone) : null, err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء')));
  });
}
const partySel = (kind, value, label) => quickSelect(() => [...app.book.parties.values()].filter((p) => p.kind === kind && !p.archived).map((p) => [p.id, p.name]), value, 'إضافة ' + label, () => addPartySheet(kind, 'إضافة ' + label));
function serviceSel(value) {
  return quickSelect(() => [...app.book.services.values()].filter((s) => !s.archived).map((s) => [s.id, s.name]), value, 'إضافة خدمة', () => sheet('إضافة خدمة', (close) => {
    const name = h('input'), err = h('div', { class: 'err hidden' });
    const ok = async () => { try { close((await app.book.addService({ name: name.value })).id); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('اسم الخدمة', name), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء')));
  }));
}

// ---------- the form ----------
function form(type, amendId) {
  const { book } = app; const fam = TX[type].family;
  const old = amendId ? book.txs.get(amendId) : null;
  if (amendId && (!old || old.type !== type)) return empty('العملية غير موجودة.');
  if (old && !book.actions(old).amend) return h('div', null, pageTop('تعديل'), empty(book.actions(old).why || 'لا يمكن تعديل هذه العملية.', h('a', { class: 'btn', href: '#/tx/' + old.id }, 'رجوع')));
  if (![...book.accounts.values()].some((a) => a.active) && type !== 'refund') return h('div', null, pageTop(TX[type].label), empty('أنشئ حسابًا أولًا.', h('a', { class: 'btn primary', href: '#/accounts' }, 'إضافة حساب')));
  const v = old || {};
  const err = h('div', { class: 'err hidden', role: 'alert' });
  const fields = {};
  const when = h('input', { type: 'datetime-local', value: localInput(v.occurredAt), 'aria-label': 'التاريخ والوقت' });
  const note = h('textarea', { placeholder: 'اختياري' }, v.note || '');
  const body = [];
  const preview = h('div', { class: 'formula hidden', 'aria-live': 'polite' });
  const warn = h('div', { class: 'warn hidden' });

  if (fam === 'trade') {
    fields.amount = money(v.amount); fields.customerPaid = money(v.customerPaid); fields.providerCharged = money(v.providerCharged);
    fields.receiveAccountId = acctSelect(v.receiveAccountId, ''); fields.payAccountId = acctSelect(v.payAccountId, '');
    fields.currency = select(app.book.settings.currencies.map((c) => [c, c]), v.currency || 'EGP');
    if (!old) { const first = [...book.accounts.values()].find((a) => a.active); if (first) { fields.receiveAccountId.value = first.id; fields.payAccountId.value = first.id; fields.currency.value = first.currency; } }
    fields.partyId = partySel('customer', v.partyId, 'عميل'); fields.providerId = partySel('provider', v.providerId, 'شركة / مزود'); fields.serviceId = serviceSel(v.serviceId);
    if (!old) fields.status = select([['completed', '🟢 مكتملة'], ['pending', '🟡 معلقة']], 'completed');
    const upd = () => {
      let a, c, p;
      try { a = D(normalizeNumber(fields.amount.value) || '0'); c = D(normalizeNumber(fields.customerPaid.value) || '0'); p = D(normalizeNumber(fields.providerCharged.value) || '0'); } catch { preview.classList.add('hidden'); return; }
      const ccy = fields.currency.value;
      preview.classList.toggle('hidden', a === 0n);
      preview.replaceChildren(h('div', { class: 'r' }, h('span', null, 'قيمة العملية'), M(a, ccy)), h('div', { class: 'r' }, h('span', null, 'ربح العملية'), SM(c - a, ccy)), h('div', { class: 'r' }, h('span', null, 'عمولة الشركة'), SM(-(p - a), ccy)), h('div', { class: 'r total' }, h('span', null, 'الربح الصافي'), SM(c - p, ccy)));
      const bad = c - p < 0n;
      warn.classList.toggle('hidden', !bad); warn.textContent = bad ? 'تنبيه: الربح الصافي سالب — الشركة خصمت أكثر مما دفعه العميل.' : '';
    };
    for (const k of ['amount', 'customerPaid', 'providerCharged']) fields[k].addEventListener('input', upd);
    fields.currency.addEventListener('change', upd);
    fields.receiveAccountId.addEventListener('change', () => { const a = book.accounts.get(fields.receiveAccountId.value); if (a && !old) { fields.currency.value = a.currency; upd(); } });
    body.push(
      field('قيمة العملية', fields.amount), field('المبلغ الذي دفعه العميل لي', fields.customerPaid, 'ما استلمته من العميل (القيمة + عمولتك)'), field('المبلغ الذي خصمته الشركة مني', fields.providerCharged, 'ما خرج من محفظتك (القيمة + عمولة الشركة)'), preview, warn,
      field('دخلت إلى (استلام)', fields.receiveAccountId), field('خرجت من (دفع)', fields.payAccountId), field('عملة العملية', fields.currency),
      field('العميل', fields.partyId), h('div', { class: 'row2' }, field('الشركة / المزود', fields.providerId), field('الخدمة', fields.serviceId)));
    queueMicrotask(upd);
  } else if (fam === 'single') {
    const scope = type === 'expense_personal' ? 'personal' : type === 'expense_business' ? 'business' : type === 'income' ? 'income' : null;
    fields.amount = money(v.amount); fields.accountId = acctSelect(v.accountId);
    body.push(field('المبلغ', fields.amount), field(type === 'income' || type === 'deposit' ? 'يدخل إلى حساب' : 'يخرج من حساب', fields.accountId));
    if (scope) {
      fields.categoryId = select([['', 'اختر التصنيف'], ...[...book.categories.values()].filter((c) => c.scope === scope && !c.archived).map((c) => [c.id, c.name])], v.categoryId || '');
      body.push(field('التصنيف', fields.categoryId));
      const addc = h('button', { class: 'btn sm', type: 'button', onClick: async () => {
        const id = await sheet('تصنيف جديد', (close) => { const n = h('input'); const er = h('div', { class: 'err hidden' }); return h('div', null, field('الاسم', n), er, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: async () => { try { close((await book.addCategory({ scope, name: n.value })).id); } catch (e) { er.textContent = e.message; er.classList.remove('hidden'); } } }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء'))); });
        if (id) { fields.categoryId.append(h('option', { value: id }, book.categories.get(id).name)); fields.categoryId.value = id; }
      } }, '＋ تصنيف جديد');
      body.push(addc);
    }
    if (type === 'income') { fields.partyId = partySel('customer', v.partyId, 'عميل'); body.push(field('من (اختياري)', fields.partyId)); }
    if (['expense_personal', 'expense_business', 'withdrawal'].includes(type)) {
      const chk = () => { try { const a = D(normalizeNumber(fields.amount.value) || '0'); const acc = book.accounts.get(fields.accountId.value); const left = acc ? book.balanceBig(acc.id) - a + (old && old.accountId === acc.id && old.status === 'completed' ? D(old.amount) : 0n) : 0n; warn.classList.toggle('hidden', !(acc && a > 0n && left < 0n)); warn.textContent = acc ? `الرصيد لا يكفي — سيصبح ${fmt(left, acc.currency, hd())}. يمكنك المتابعة ثم عمل تسوية لاحقًا.` : ''; } catch { warn.classList.add('hidden'); } };
      fields.amount.addEventListener('input', chk); fields.accountId.addEventListener('change', chk); body.push(warn);
    }
  } else if (fam === 'internal') {
    fields.amount = money(v.amount); fields.toAmount = money(v.toAmount);
    fields.fromAccountId = acctSelect(v.fromAccountId); fields.toAccountId = acctSelect(v.toAccountId);
    const act = [...book.accounts.values()].filter((a) => a.active);
    if (!old && act.length > 1) fields.toAccountId.value = act[1].id;
    const cross = h('div', { class: 'hidden' }, field('المبلغ المستلم (بعملة الحساب المستلم)', fields.toAmount), h('p', { class: 'hint', 'data-rate': '' }));
    const upd = () => {
      const f = book.accounts.get(fields.fromAccountId.value), t = book.accounts.get(fields.toAccountId.value);
      const diff = f && t && f.currency !== t.currency; cross.classList.toggle('hidden', !diff);
      if (diff) { try { const a = D(normalizeNumber(fields.amount.value) || '0'), b = D(normalizeNumber(fields.toAmount.value) || '0'); cross.querySelector('[data-rate]').textContent = a > 0n && b > 0n ? `سعر التحويل الفعلي: 1 ${f.currency} = ${S((b * 100000000n) / a, 6)} ${t.currency}` : `${f.currency} ← ${t.currency}`; } catch {} }
    };
    for (const k of ['amount', 'toAmount']) fields[k].addEventListener('input', upd); for (const k of ['fromAccountId', 'toAccountId']) fields[k].addEventListener('change', upd);
    body.push(field('من', fields.fromAccountId), field('إلى', fields.toAccountId), field('المبلغ', fields.amount), cross, h('p', { class: 'hint' }, 'التحويل بين حساباتك لا يُحسب دخلًا ولا مصروفًا ولا ربحًا.'));
    queueMicrotask(upd);
  } else if (fam === 'debt') {
    const receivable = type === 'debt_to_me';
    fields.amount = money(v.amount); fields.partyId = quickSelect(() => [...book.parties.values()].filter((p) => !p.archived).map((p) => [p.id, p.name + (p.phone ? ` (${p.phone})` : '')]), v.partyId, 'إضافة شخص / جهة', () => addPartySheet('customer', 'إضافة شخص'), 'اختر…');
    fields.accountId = acctSelect(v.accountId, 'بدون حركة نقدية (دين قائم مسبقًا)');
    fields.currency = select(app.book.settings.currencies.map((c) => [c, c]), v.currency || 'EGP');
    fields.dueDate = h('input', { type: 'date', value: v.dueDate || '' });
    body.push(field(receivable ? 'مَن عليه الدين' : 'لمن الدين', fields.partyId), field('المبلغ', fields.amount), h('div', { class: 'row2' }, field('العملة', fields.currency), field('تاريخ الاستحقاق', fields.dueDate)),
      field(receivable ? 'خرجت الفلوس من' : 'دخلت الفلوس إلى', fields.accountId, 'اتركه فارغًا لو الدين موجود من قبل ولم تتحرك فلوس الآن'));
    fields.accountId.addEventListener('change', () => { const a = book.accounts.get(fields.accountId.value); if (a) fields.currency.value = a.currency; });
    if (old) fields.currency.disabled = true;
  }
  body.push(field('التاريخ والوقت', when), field('ملاحظات', note));

  const submit = async (btn) => {
    err.classList.add('hidden');
    const input = { type, occurredAt: when.value ? new Date(when.value).toISOString() : undefined, note: note.value };
    for (const [k, el] of Object.entries(fields)) input[k] = el.value;
    if (fam === 'debt') { input.direction = type === 'debt_to_me' ? 'receivable' : 'payable'; if (old) input.currency = old.currency; }
    btn.disabled = true;
    try {
      if (old) {
        const reason = await askReason('سبب التعديل', 'سبب التعديل (يُسجَّل في سجل التدقيق)');
        if (!reason) return;
        if (!(await requirePin('تعديل عملية'))) return;
        const patch = { ...input }; delete patch.type; delete patch.direction;
        await app.book.amendTx(old.id, patch, reason);
        (await import('../dom.js')).toast('تم حفظ التعديل'); go('#/tx/' + old.id);
      } else {
        const r = fam === 'debt' ? await app.book.createDebt(input) : await app.book.createTx(input);
        (await import('../dom.js')).toast('تم الحفظ'); go(fam === 'debt' ? '#/debts' : '#/tx/' + r.id);
      }
    } catch (e) {
      err.textContent = e?.constructor?.name === 'AppError' ? e.message : 'حدث خطأ: ' + (e?.message || e); err.classList.remove('hidden'); err.scrollIntoView({ block: 'center' });
      if (e?.constructor?.name !== 'AppError') console.error(e);
    } finally { btn.disabled = false; }
  };
  const saveBtn = h('button', { class: 'btn primary block', onClick: (e) => submit(e.currentTarget) }, old ? 'حفظ التعديل' : 'حفظ');
  return h('div', { class: 'stack' }, pageTop((old ? 'تعديل: ' : '') + TX[type].label, h('a', { class: 'btn sm', href: old ? '#/tx/' + old.id : '#/new' }, 'رجوع')),
    h('div', { class: 'card' }, ...body, fields.status ? field('حالة العملية', fields.status) : null, err, saveBtn));
}
void accOptions;
