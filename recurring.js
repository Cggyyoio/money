import { D, fmt, normalizeNumber } from '../../domain/dec.js';
import { h, field, select, sheet } from '../dom.js';
import { app, M, pageTop, empty, accOptions, attempt, accName, hd } from '../ctx.js';

const FREQ = [['weekly', 'أسبوعيًا'], ['monthly', 'شهريًا'], ['yearly', 'سنويًا']];

function ruleSheet(r) {
  const { book } = app;
  return sheet(r ? 'تعديل مصروف متكرر' : 'مصروف متكرر جديد', (close) => {
    const name = h('input', { value: r?.name || '', placeholder: 'مثال: VPS' }), amount = h('input', { class: 'money', inputmode: 'decimal', value: r?.amount || '' });
    const acc = select(accOptions(), r?.accountId);
    const cats = [...book.categories.values()].filter((c) => c.scope !== 'income' && !c.archived);
    const cat = select(cats.map((c) => [c.id, `${c.scope === 'personal' ? 'شخصي' : 'عمل'} — ${c.name}`]), r?.categoryId);
    const freq = select(FREQ, r?.frequency || 'monthly'), day = h('input', { type: 'number', min: '1', max: '31', value: r?.day || 1 }), month = h('input', { type: 'number', min: '1', max: '12', value: r?.month || 1 });
    const mode = select([['remind', 'نبّهني وأنا أؤكد'], ['auto', 'سجّل تلقائيًا']], r?.mode || 'remind'); const start = h('input', { type: 'date', value: '' });
    const active = h('input', { type: 'checkbox', checked: r ? r.active : true }); const err = h('div', { class: 'err hidden' });
    const monthWrap = h('div', { class: freq.value === 'yearly' ? '' : 'hidden' }, field('الشهر', month)); freq.addEventListener('change', () => monthWrap.classList.toggle('hidden', freq.value !== 'yearly'));
    const ok = async () => { try { await book.saveRecurring({ id: r?.id, name: name.value, amount: normalizeNumber(amount.value), accountId: acc.value, categoryId: cat.value, frequency: freq.value, day: day.value, month: month.value, mode: mode.value, active: active.checked, startDate: start.value || undefined }); close(true); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('الاسم', name), h('div', { class: 'row2' }, field('المبلغ', amount), field('من حساب', acc)), field('التصنيف (يحدد شخصي أو عمل)', cat),
      h('div', { class: 'row2' }, field('التكرار', freq), field('اليوم من الشهر', day)), monthWrap, field('ابدأ من تاريخ', start, r ? 'اتركه فارغًا للإبقاء على الموعد القادم' : 'اتركه فارغًا للبدء من اليوم'), field('التنفيذ', mode),
      h('label', { class: 'inline', style: { marginBottom: '.8rem' } }, active, h('span', null, 'فعّال')), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

export function render() {
  const { book } = app; const rules = [...book.recurring.values()]; const due = new Set(book.dueRecurring().map((r) => r.id));
  return h('div', { class: 'stack' }, pageTop('المصاريف المتكررة', h('button', { class: 'btn sm primary', onClick: () => ruleSheet() }, '+ جديد')),
    h('p', { class: 'muted small' }, 'القواعد التلقائية تُنفَّذ عند فتح التطبيق، وتُسجَّل كل الفترات الفائتة. لا تتكرر العملية أبدًا مرتين لنفس الموعد.'),
    rules.length ? h('div', { class: 'list' }, rules.map((r) => h('div', { class: 'item', style: r.active ? null : { opacity: '.6' } },
      h('div', { class: 'ic' }, r.scope === 'personal' ? '🧾' : '💼'),
      h('div', { class: 'main' }, h('div', { class: 't' }, r.name), h('div', { class: 's' }, `${FREQ.find((f) => f[0] === r.frequency)[1]}  القادم ${r.nextDue}  ${accName(r.accountId)}  ${r.mode === 'auto' ? 'تلقائي' : 'تنبيه'}`)),
      h('div', { class: 'amt' }, M(r.amount, book.accounts.get(r.accountId)?.currency), h('div', { class: 'inline', style: { marginTop: '.3rem' } },
        due.has(r.id) && r.mode === 'remind' && r.active ? h('button', { class: 'btn sm primary', onClick: async () => { if (await attempt(() => book.confirmRecurring(r.id), 'تم تسجيل المصروف')) app.rerender(); } }, 'تأكيد') : null,
        h('button', { class: 'btn sm', onClick: () => ruleSheet(r) }, 'تعديل')))))) : empty('لا توجد مصاريف متكررة. أضف VPS أو الإنترنت أو الدومين مرة واحدة.', h('button', { class: 'btn primary', onClick: () => ruleSheet() }, '+ إضافة')));
}
void D; void fmt; void hd;
