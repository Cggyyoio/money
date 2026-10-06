import { verifyBook } from '../../domain/integrity.js';
import { verifyAuditChain } from '../../domain/audit.js';
import { buildBackup, parseBackup, isEncrypted } from '../../data/backup.js';
import { makeSecret, verifySecret } from '../../data/security.js';
import { toCSV } from '../../data/export.js';
import { normalizeNumber, fmt } from '../../domain/dec.js';
import { h, field, select, sheet, download, confirmBox, toast } from '../dom.js';
import { app, pageTop, dt, requirePin, attempt, localInput, noteFail, waitLeft } from '../ctx.js';

const card = (title, ...kids) => h('section', { class: 'card stack' }, h('h2', null, title), ...kids);
const msg = () => h('div', { class: 'err hidden' });
const showErr = (el, m) => { el.textContent = m; el.classList.remove('hidden'); };

function passwordSheet() {
  return sheet('تغيير كلمة السر', (close) => {
    const cur = h('input', { type: 'password' }), n1 = h('input', { type: 'password', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', autocomplete: 'new-password' }), err = msg();
    const ok = async () => {
      if (waitLeft()) return showErr(err, `انتظر ${waitLeft()} ثانية`);
      const good = await verifySecret(cur.value, app.book.settings.lock); noteFail(good);
      if (!good) return showErr(err, 'كلمة السر الحالية غير صحيحة');
      if (n1.value.length < 6) return showErr(err, 'كلمة السر 6 أحرف على الأقل'); if (n1.value !== n2.value) return showErr(err, 'غير متطابقتين');
      await app.book.setSecurity({ lock: await makeSecret(n1.value) }, 'password'); close(true); toast('تم تغيير كلمة السر');
    };
    return h('div', null, field('كلمة السر الحالية', cur), field('الجديدة', n1), field('تأكيد الجديدة', n2), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'حفظ'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}
function pinSheet() {
  return sheet(app.book.settings.pin ? 'تغيير / إلغاء الـPIN' : 'تعيين PIN', (close) => {
    const pw = h('input', { type: 'password' }), pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: '4–8 أرقام' }), err = msg();
    const run = async (remove) => {
      if (waitLeft()) return showErr(err, `انتظر ${waitLeft()} ثانية`);
      const good = await verifySecret(pw.value, app.book.settings.lock); noteFail(good);
      if (!good) return showErr(err, 'كلمة السر غير صحيحة');
      if (!remove && !/^\d{4,8}$/.test(pin.value)) return showErr(err, 'الـPIN يجب أن يكون 4 إلى 8 أرقام');
      await app.book.setSecurity({ pin: remove ? null : await makeSecret(pin.value) }, 'pin'); close(true); toast(remove ? 'تم إلغاء الـPIN' : 'تم حفظ الـPIN');
    };
    return h('div', null, field('كلمة السر (للتأكيد)', pw), field('PIN الجديد', pin), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: () => run(false) }, 'حفظ'), app.book.settings.pin ? h('button', { class: 'btn danger', onClick: () => run(true) }, 'إلغاء الـPIN') : null, h('button', { class: 'btn', onClick: () => close(false) }, 'رجوع')));
  });
}
function rateSheet() {
  const { book } = app;
  return sheet('سعر صرف جديد', (close) => {
    const ccy = select(book.settings.currencies.filter((c) => c !== 'EGP').map((c) => [c, c]), 'USD'), rate = h('input', { class: 'money', inputmode: 'decimal', placeholder: 'كم جنيه = 1 وحدة' }), when = h('input', { type: 'datetime-local', value: localInput() }), note = h('input'), err = msg();
    const ok = async () => { try { await book.addRate({ ccy: ccy.value, rate: normalizeNumber(rate.value), at: new Date(when.value).toISOString(), note: note.value }); close(true); toast('تمت إضافة السعر'); } catch (e) { showErr(err, e.message); } };
    return h('div', null, field('العملة', ccy), field('السعر بالجنيه المصري', rate, 'العمليات القديمة لا تتغير — السعر الجديد يسري على ما بعده وعلى تقييم الأرصدة الحالية'), field('ساري من', when), field('ملاحظة', note), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'إضافة'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}
function addSimple(title, label, fn) {
  return sheet(title, (close) => { const i = h('input'), err = msg(); const ok = async () => { try { await fn(i.value); close(true); } catch (e) { showErr(err, e.message); } }; return h('div', null, field(label, i), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'إضافة'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء'))); });
}
function catSheet() {
  return sheet('تصنيف جديد', (close) => {
    const scope = select([['personal', 'مصروف شخصي'], ['business', 'مصروف عمل'], ['income', 'دخل']], 'personal'), name = h('input'), err = msg();
    const ok = async () => { try { await app.book.addCategory({ scope: scope.value, name: name.value }); close(true); } catch (e) { showErr(err, e.message); } };
    return h('div', null, field('النوع', scope), field('الاسم', name), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'إضافة'), h('button', { class: 'btn', onClick: () => close(false) }, 'إلغاء')));
  });
}

async function exportBackup(encrypt) {
  if (!(await requirePin('تصدير نسخة احتياطية'))) return;
  let pw = '';
  if (encrypt) {
    pw = await sheet('كلمة سر النسخة', (close) => { const a = h('input', { type: 'password' }), b = h('input', { type: 'password' }), err = msg(); const ok = () => { if (a.value.length < 6) return showErr(err, '6 أحرف على الأقل'); if (a.value !== b.value) return showErr(err, 'غير متطابقتين'); close(a.value); };
      return h('div', null, h('p', { class: 'muted' }, 'احفظ كلمة السر — بدونها لا يمكن فتح النسخة أبدًا.'), field('كلمة السر', a), field('تأكيدها', b), err, h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: ok }, 'تصدير'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء'))); });
    if (!pw) return;
  }
  const text = await buildBackup(app.book, pw);
  download(`moneyflow-backup-${new Date().toISOString().slice(0, 10)}${encrypt ? '.enc' : ''}.json`, text, 'application/json');
  await app.book.noteBackup(); toast('تم تنزيل النسخة الاحتياطية');
}
async function importBackup(file) {
  if (!file) return;
  const text = await file.text(); let pw = '';
  if (isEncrypted(text)) { pw = await sheet('النسخة مشفرة', (close) => { const a = h('input', { type: 'password' }); return h('div', null, field('كلمة سر النسخة', a), h('div', { class: 'btns' }, h('button', { class: 'btn primary', onClick: () => close(a.value) }, 'فتح'), h('button', { class: 'btn', onClick: () => close(null) }, 'إلغاء'))); }); if (pw === null || pw === undefined) return; }
  let data; try { data = await parseBackup(text, pw); } catch (e) { return toast(e.message, true); }
  const ok = await confirmBox('استعادة نسخة احتياطية', `سيتم استبدال كل بيانات هذا الجهاز بمحتوى النسخة (${data.ledger.length} حركة مالية، ${data.txs.length} عملية). لا يمكن التراجع — خد نسخة من بياناتك الحالية أولًا لو محتاج.`, 'استبدال واستعادة', true);
  if (!ok || !(await requirePin('استعادة نسخة احتياطية'))) return;
  if (await attempt(() => app.book.replaceAll(data), 'تمت الاستعادة')) { app.lock(); }
}

function integrityCard() {
  const out = h('div');
  return card('فحص سلامة الحسابات', h('p', { class: 'muted' }, 'يعيد حساب كل شيء من الدفتر ويقارنه بالأرصدة والتقارير وسجل التدقيق.'),
    h('button', { class: 'btn', onClick: () => { const v = verifyBook(app.book); out.replaceChildren(v.ok ? h('div', { class: 'okbox' }, `✅ كل شيء متطابق (${app.book.ledger.length} حركة، ${app.book.txs.size} عملية).`) : h('div', { class: 'err' }, v.problems.map((p) => h('div', null, p)))); } }, 'تشغيل الفحص'), out);
}
function auditCard() {
  const { book } = app; const chain = verifyAuditChain(book.audit);
  return card('سجل التدقيق', chain.ok ? h('div', { class: 'okbox' }, `✅ السلسلة سليمة (${book.audit.length} سجل). لا يمكن حذف أو تعديل أي سجل.`) : h('div', { class: 'err' }, `السجل رقم ${chain.brokenAt} تم التلاعب به`),
    h('details', null, h('summary', null, 'عرض آخر 100 سجل'), h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, ['الوقت', 'الإجراء', 'السبب', 'الجهاز'].map((x) => h('th', null, x)))), h('tbody', null, book.audit.slice(-100).reverse().map((a) => h('tr', null, h('td', null, dt(a.at)), h('td', null, a.action, a.old || a.new ? h('div', { class: 'muted small' }, JSON.stringify(a.old) + ' ← ' + JSON.stringify(a.new)) : null), h('td', null, a.reason || ''), h('td', null, a.device))))))),
    h('button', { class: 'btn sm', onClick: async () => { if (await requirePin('تصدير سجل التدقيق')) download('audit-log.csv', toCSV(['#', 'الوقت', 'الإجراء', 'الكيان', 'القيمة القديمة', 'القيمة الجديدة', 'السبب', 'الجهاز', 'Hash'], book.audit.map((a) => [a.seq, a.at, a.action, a.entity, JSON.stringify(a.old), JSON.stringify(a.new), a.reason, a.device, a.hash])), 'text/csv;charset=utf-8'); } }, 'تصدير CSV'));
}

export async function render() {
  const { book } = app; const s = book.settings;
  const lastB = s.lastBackupAt ? dt(s.lastBackupAt) : 'لم تُؤخذ نسخة بعد';
  let storage = ''; try { const est = await navigator.storage?.estimate?.(); const per = await navigator.storage?.persisted?.(); storage = `${per ? 'تخزين دائم ✓' : 'تخزين عادي (قد يمسحه المتصفح عند ضيق المساحة)'}${est ? ` — مستخدم ${(est.usage / 1048576).toFixed(1)} MB` : ''}`; } catch {}
  const autoSel = select([['0', 'بدون'], ['1', 'بعد دقيقة'], ['5', 'بعد 5 دقائق'], ['15', 'بعد 15 دقيقة'], ['60', 'بعد ساعة']], String(s.autoLockMin ?? 5));
  autoSel.addEventListener('change', () => book.updateSettings({ autoLockMin: Number(autoSel.value) }));
  const dec = h('input', { type: 'checkbox', checked: s.hideDecimals }); dec.addEventListener('change', () => book.updateSettings({ hideDecimals: dec.checked }));
  const theme = select([['auto', 'حسب الجهاز'], ['light', 'فاتح'], ['dark', 'داكن']], s.theme || 'auto'); theme.addEventListener('change', () => book.updateSettings({ theme: theme.value }));
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' }); file.addEventListener('change', () => { importBackup(file.files[0]); file.value = ''; });
  const rates = [...book.ratesList].reverse().slice(0, 10);
  return h('div', { class: 'stack' }, pageTop('الإعدادات'),
    card('النسخ الاحتياطي', h('p', { class: 'muted' }, 'بياناتك محفوظة على هذا الجهاز فقط. آخر نسخة: ' + lastB), h('p', { class: 'hint' }, storage),
      h('div', { class: 'inline', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn primary', onClick: () => exportBackup(false) }, 'تنزيل نسخة'), h('button', { class: 'btn', onClick: () => exportBackup(true) }, 'نسخة مشفرة بكلمة سر'), h('button', { class: 'btn', onClick: () => file.click() }, 'استعادة من ملف')), file),
    card('الأمان', h('div', { class: 'inline', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn', onClick: passwordSheet }, 'تغيير كلمة السر'), h('button', { class: 'btn', onClick: pinSheet }, s.pin ? 'تغيير / إلغاء الـPIN' : 'تعيين PIN'), h('button', { class: 'btn', onClick: () => app.lock() }, '🔒 قفل الآن')),
      field('القفل التلقائي', autoSel), h('p', { class: 'hint' }, 'الـPIN مطلوب لـ: التعديل، الإلغاء، الاسترداد، التسوية، التصدير، الاستعادة. القفل يحمي الواجهة، لكنه لا يشفّر بيانات المتصفح — استخدم قفل الجهاز أيضًا.')),
    card('العرض', h('label', { class: 'inline' }, dec, h('span', null, 'إخفاء الكسور (1,250 بدل 1,250.00)')), field('المظهر', theme)),
    card('العملات وأسعار الصرف', h('div', { class: 'muted' }, 'العملات: ' + s.currencies.join('، ') + ' (الأساسية EGP)'),
      h('div', { class: 'inline', style: { flexWrap: 'wrap' } }, h('button', { class: 'btn', onClick: rateSheet }, '+ سعر صرف'), h('button', { class: 'btn', onClick: () => addSimple('عملة جديدة', 'رمز العملة (مثال: SAR)', (v) => book.addCurrency(v)) }, '+ عملة')),
      rates.length ? h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, ['العملة', 'السعر', 'ساري من'].map((x) => h('th', null, x)))), h('tbody', null, rates.map((r) => h('tr', null, h('td', null, r.ccy), h('td', null, h('span', { class: 'num' }, fmt(r.rate, 'EGP'))), h('td', null, dt(r.at))))))) : h('p', { class: 'hint' }, 'لم تُضف أسعار صرف. أضفها قبل إنشاء حسابات بعملة غير الجنيه.')),
    card('التصنيفات', h('div', { class: 'muted small' }, `${[...book.categories.values()].filter((c) => c.scope === 'personal').length} شخصي، ${[...book.categories.values()].filter((c) => c.scope === 'business').length} عمل، ${[...book.categories.values()].filter((c) => c.scope === 'income').length} دخل`), h('button', { class: 'btn', onClick: catSheet }, '+ تصنيف')),
    integrityCard(), auditCard(),
    h('p', { class: 'hint' }, 'MoneyFlow — تطبيق يعمل بالكامل داخل المتصفح بدون خادم. الإصدار 1.0'));
}
