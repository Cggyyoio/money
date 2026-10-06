import { Book } from '../domain/book.js';
import { MemoryDriver } from '../data/memory-driver.js';
import { IdbDriver } from '../data/idb-driver.js';
import { makeSecret, verifySecret } from '../data/security.js';
import { notifications } from '../domain/notify.js';
import { h, clear, field, toast } from './dom.js';
import { app, noteFail, waitLeft, failState } from './ctx.js';

const PAGES = {
  '': () => import('./pages/dashboard.js'),
  tx: () => import('./pages/transactions.js'),
  new: () => import('./pages/newtx.js'),
  accounts: () => import('./pages/accounts.js'),
  parties: () => import('./pages/parties.js'),
  debts: () => import('./pages/debts.js'),
  expenses: () => import('./pages/expenses.js'),
  recurring: () => import('./pages/recurring.js'),
  reports: () => import('./pages/reports.js'),
  goals: () => import('./pages/goals.js'),
  networth: () => import('./pages/networth.js'),
  notifications: () => import('./pages/notifications.js'),
  settings: () => import('./pages/settings.js'),
  more: () => import('./pages/more.js'),
};
export const NAV = [['', 'الرئيسية', '🏠'], ['tx', 'العمليات', '📒'], ['accounts', 'الحسابات', '👛'], ['parties', 'العملاء والشركات', '👥'], ['debts', 'الديون', '🤝'], ['expenses', 'المصاريف', '🧾'], ['recurring', 'المتكررة', '🔄'], ['reports', 'التقارير', '📊'], ['goals', 'الأهداف', '🎯'], ['networth', 'صافي الثروة', '💎'], ['notifications', 'الإشعارات', '🔔'], ['settings', 'الإعدادات', '⚙️']];

const root = document.getElementById('app');
let unlocked = false, idleTimer = null, view = null;

function deviceId() {
  try { let d = localStorage.getItem('mf_device'); if (!d) { d = 'D-' + crypto.randomUUID().slice(0, 8); localStorage.setItem('mf_device', d); } return d; } catch { return 'D-nostore'; }
}

async function boot() {
  let driver;
  try { driver = await new IdbDriver().open(); }
  catch (e) { console.error(e); driver = new MemoryDriver(); app.memoryOnly = true; }
  const book = await new Book(driver, { device: deviceId() }).init();
  app.book = book;
  navigator.storage?.persist?.().catch(() => {});
  applyTheme();
  try {
    const bc = new BroadcastChannel('moneyflow'); let remote = false;
    book.subscribe(() => { if (!remote) bc.postMessage('changed'); });
    bc.onmessage = async () => { remote = true; try { await book.reload(); } finally { remote = false; } };
  } catch {}
  book.subscribe(() => { if (unlocked) { applyTheme(); renderRoute(); } });
  app.rerender = () => renderRoute();
  app.lock = lock;
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('hashchange', () => unlocked && renderRoute());
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, bumpIdle, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else if (unlocked && hiddenAt && autoMs() && Date.now() - hiddenAt > autoMs()) lock(); });
  if (!book.settings.lock) showSetup(); else showLock();
}
let hiddenAt = 0;
const autoMs = () => (app.book.settings.autoLockMin || 0) * 60000;
function bumpIdle() { if (!unlocked) return; clearTimeout(idleTimer); if (autoMs()) idleTimer = setTimeout(lock, autoMs()); }
function applyTheme() { const t = app.book.settings.theme; if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

function lock() { unlocked = false; clearTimeout(idleTimer); document.querySelectorAll('.overlay').forEach((o) => o.remove()); showLock(); }
function unlock() { unlocked = true; bumpIdle(); if (!location.hash) location.hash = '#/'; buildShell(); app.book.runRecurring().catch(() => {}); renderRoute(); }

function lockCard(title, sub, ...body) {
  clear(root).append(h('div', { class: 'lock' }, h('div', { class: 'card stack' }, h('h1', null, title), h('p', { class: 'muted' }, sub), ...body)));
}
function showSetup() {
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' }), p2 = h('input', { type: 'password', autocomplete: 'new-password' }), pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'اختياري — 4 إلى 8 أرقام' });
  const err = h('div', { class: 'err hidden' });
  const submit = async () => {
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (p1.value.length < 6) return fail('كلمة السر 6 أحرف على الأقل');
    if (p1.value !== p2.value) return fail('كلمتا السر غير متطابقتين');
    if (pin.value && !/^\d{4,8}$/.test(pin.value)) return fail('الـPIN يجب أن يكون 4 إلى 8 أرقام');
    await app.book.setSecurity({ lock: await makeSecret(p1.value), pin: pin.value ? await makeSecret(pin.value) : null }, 'setup');
    unlock();
  };
  lockCard('أهلًا بك في MoneyFlow', 'اختر كلمة سر لحماية التطبيق على هذا الجهاز.',
    field('كلمة السر', p1), field('تأكيد كلمة السر', p2), field('PIN للعمليات الحساسة (تعديل، إلغاء، استرداد، تسوية، استعادة نسخة)', pin), err,
    h('p', { class: 'hint' }, 'كلمة السر تقفل الواجهة فقط ولا تشفّر بيانات المتصفح. بياناتك محفوظة على هذا الجهاز — خد نسخة احتياطية من الإعدادات بانتظام.'),
    h('button', { class: 'btn primary block', onClick: submit }, 'ابدأ'));
  if (app.memoryOnly) root.querySelector('.card').prepend(h('div', { class: 'warn' }, 'المتصفح لا يسمح بحفظ البيانات (وضع خاص؟). البيانات ستضيع عند إغلاق الصفحة.'));
}
function showLock() {
  const inp = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'كلمة السر' });
  const err = h('div', { class: 'err hidden' });
  const submit = async () => {
    if (waitLeft()) { err.textContent = `محاولات كتير — انتظر ${waitLeft()} ثانية`; err.classList.remove('hidden'); return; }
    const ok = await verifySecret(inp.value, app.book.settings.lock);
    noteFail(ok);
    if (ok) unlock(); else { err.textContent = 'كلمة السر غير صحيحة'; err.classList.remove('hidden'); inp.value = ''; inp.focus(); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  lockCard('MoneyFlow', 'أدخل كلمة السر للمتابعة', field('كلمة السر', inp), err, h('button', { class: 'btn primary block', onClick: submit }, 'فتح'));
  inp.focus();
}

function buildShell() {
  const bell = h('a', { href: '#/notifications', class: 'no-print', 'aria-label': 'الإشعارات' });
  view = h('main', { id: 'view', tabindex: '-1' });
  const link = (k, l, i) => h('a', { href: '#/' + k, 'data-k': k }, h('span', { 'aria-hidden': 'true' }, i), ' ', l);
  const side = h('nav', { class: 'side', 'aria-label': 'التنقل' }, h('div', { class: 'brand' }, 'MoneyFlow'), NAV.map(([k, l, i]) => link(k, l, i)), h('a', { href: '#', onClick: (e) => { e.preventDefault(); lock(); } }, h('span', null, '🔒'), ' قفل التطبيق'));
  const tab = (k, l, i, cls) => h('a', { href: '#/' + k, 'data-k': k, class: cls }, h('span', { class: cls ? 'fab' : '', 'aria-hidden': 'true' }, i), h('span', null, l));
  const bottom = h('nav', { class: 'bottom', 'aria-label': 'التنقل' }, tab('', 'الرئيسية', '🏠'), tab('tx', 'العمليات', '📒'), tab('new', 'عملية', '＋', 'plus'), tab('accounts', 'الحسابات', '👛'), tab('more', 'المزيد', '☰'));
  clear(root).append(h('div', { class: 'shell' }, side, view, bottom));
  void bell;
}

async function renderRoute() {
  if (!view) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const key = parts[0] || '';
  const loader = PAGES[key] || PAGES[''];
  document.querySelectorAll('[data-k]').forEach((a) => { const on = a.dataset.k === (PAGES[key] ? key : ''); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  try {
    const mod = await loader();
    const node = await mod.render(parts.slice(1));
    clear(view).append(node);
    const n = notifications(app.book).length;
    const bellEl = view.querySelector('[data-bell]'); if (bellEl) { bellEl.querySelector('b')?.remove(); if (n) bellEl.append(h('b', null, n > 9 ? '9+' : n)); }
    if (view.dataset.last !== location.hash) { window.scrollTo(0, 0); view.dataset.last = location.hash; }
  } catch (e) { console.error(e); clear(view).append(h('div', { class: 'err' }, 'تعذر عرض الصفحة: ' + (e?.message || e))); }
}

boot().catch((e) => { console.error(e); root.textContent = 'تعذر تشغيل التطبيق: ' + (e?.message || e); });
void toast; void failState;
