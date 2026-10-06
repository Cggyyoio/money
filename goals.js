import { goalProgress } from '../../domain/reports.js';
import { normalizeNumber } from '../../domain/dec.js';
import { h, field, select, sheet } from '../dom.js';
import { app, M, pageTop, empty } from '../ctx.js';

function goalSheet(g) {
  const { book } = app;
  return sheet(g ? 'تعديل الهدف' : 'هدف جديد', (close) => {
    const name = h('input', { value: g?.name || '', placeholder: 'شراء شقة، سيارة، رأس مال، ادخار، طوارئ…' }), target = h('input', { class: 'money', inputmode: 'decimal', value: g?.target || '' });
    const mode = select([['total', 'إجمالي أموالي'], ['accounts', 'حسابات محددة'], ['manual', 'مبلغ أدخله بنفسي']], g?.mode || 'total');
    const manual = h('input', { class: 'money', inputmode: 'decimal', value: g?.manual || '' });
    const checks = [...book.accounts.values()].filter((a) => !a.archived).map((a) => ({ a, el: h('input', { type: 'checkbox', checked: (g?.accountIds || []).includes(a.id) }) }));
    const accBox = h('div', { class: 'field' }, h('span', { class: 'lab' }, 'الحسابات'), checks.map((c) => h('label', { class: 'inline', style: { margin: '.2rem 0' } }, c.el, h('span', null, c.a.name))));
    const sync = () => { accBox.classList.toggle('hidden', mode.value !== 'accounts'); manualW.classList.toggle('hidden', mode.value !== 'manual'); };
    const manualW = h('div', null, field('المبلغ الحالي', manual)); mode.addEventListener('change', sync); sync();
    const arch = h('input', { type: 'checkbox', checked: !!g?.archived }); const err = h('div', { class: 'err hidden' });
    const ok = async () => { try { await book.saveGoal({ id: g?.id, name: name.value, target: normalizeNumber(target.value), mode: mode.value, accountIds: checks.filter((c) => c.el.checked).map((c) => c.a.id), manual: normalizeNumber(manual.value), archived: arch.checked }); close(true); } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); } };
    return h('div', null, field('اسم الهدف', name), field('المبلغ المستهدف (EGP)', target), field('يُقاس بـ', mode), accBox, manualW, g ? h('label', { class: 'inline', style: { marginBottom: '.8rem' } }, arch, h('span', null, 'أرشفة الهدف')) : null, err,
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

export function render() {
  const goals = [...app.book.goals.values()].filter((g) => !g.archived);
  return h('div', { class: 'stack' }, pageTop('الأهداف المالية', h('button', { class: 'btn sm primary', onClick: () => goalSheet() }, '+ هدف')),
    goals.length ? goals.map((g) => { const p = goalProgress(app.book, g); return h('div', { class: 'card' }, h('div', { class: 'inline' }, h('b', null, g.name), h('button', { class: 'btn sm', onClick: () => goalSheet(g) }, 'تعديل')),
      h('div', { class: 'grid3', style: { margin: '.6rem 0' } }, h('div', null, h('div', { class: 'muted small' }, 'الهدف'), M(p.target)), h('div', null, h('div', { class: 'muted small' }, 'الحالي'), M(p.current)), h('div', null, h('div', { class: 'muted small' }, 'المتبقي'), M(p.remaining))),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(Math.round(p.pct)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': g.name }, h('i', { style: { width: p.pct + '%' } })), h('div', { class: 'small muted', style: { marginTop: '.3rem' } }, Math.round(p.pct * 10) / 10 + '%' + (p.reached ? '  تحقق الهدف 🎉' : ''))); })
      : empty('لا توجد أهداف. مثال: رأس مال 50,000.', h('button', { class: 'btn primary', onClick: () => goalSheet() }, '+ هدف جديد')));
}
