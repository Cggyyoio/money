import { D, fmt } from './dec.js';
import { localDay } from './util.js';
import { goalProgress } from './reports.js';
import { TX } from './constants.js';

/** Notifications are derived from current data (nothing to sync); dismissals are stored in settings. */
export function notifications(book, now = book.now()) {
  const today = localDay(now.toISOString());
  const out = [];
  const push = (key, level, title, body, link) => out.push({ key, level, title, body, link });
  const name = (id) => book.parties.get(id)?.name || '';
  const hd = { hideDecimals: book.settings.hideDecimals };

  for (const a of book.accounts.values()) {
    if (!a.active || a.archived || !a.lowBalanceAlert) continue;
    if (book.balanceBig(a.id) < D(a.lowBalanceAlert)) push(`low:${a.id}:${today}`, 'warn', `رصيد منخفض: ${a.name}`, `الرصيد ${fmt(book.balanceBig(a.id), a.currency, hd)} أقل من الحد ${fmt(a.lowBalanceAlert, a.currency, hd)}`, '#/accounts');
  }
  for (const d of book.debts.values()) {
    if (book.debtStatus(d) !== 'open' || !d.dueDate || d.dueDate > today) continue;
    const rem = fmt(book.debtRemainingBig(d), d.currency, hd);
    push(`debt:${d.id}:${d.dueDate}`, 'warn', d.direction === 'receivable' ? `دين مستحق لك عند ${name(d.partyId)}` : `دين مستحق عليك لـ ${name(d.partyId)}`, `المتبقي ${rem} — الاستحقاق ${d.dueDate}`, '#/debts');
  }
  for (const r of book.dueRecurring(today)) {
    if (r.mode === 'auto') continue;
    push(`rec:${r.id}:${r.nextDue}`, 'info', `مصروف متكرر مستحق: ${r.name}`, `${fmt(r.amount, book.accounts.get(r.accountId)?.currency, hd)} — ${r.nextDue}`, '#/recurring');
  }
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  for (const t of book.txs.values()) {
    if (t.status === 'failed' && t.createdAt >= weekAgo) push(`fail:${t.id}`, 'bad', `عملية فاشلة ${t.number}`, `${TX[t.type].label} بقيمة ${fmt(t.amount, t.currency, hd)}`, `#/tx/${t.id}`);
    if (t.status === 'pending') push(`pend:${t.id}`, 'info', `عملية معلقة ${t.number}`, `${TX[t.type].label} بقيمة ${fmt(t.amount, t.currency, hd)}`, `#/tx/${t.id}`);
    if (t.type === 'adjustment' && t.createdAt >= weekAgo) push(`adj:${t.id}`, 'info', `فرق تسوية ${t.number}`, `${book.accounts.get(t.accountId)?.name}: ${fmt(t.diff, t.currency, hd)}`, `#/tx/${t.id}`);
  }
  for (const g of book.goals.values()) {
    if (g.archived) continue;
    if (goalProgress(book, g).reached) push(`goal:${g.id}`, 'good', `تحقق الهدف: ${g.name}`, `وصلت إلى ${fmt(g.target, 'EGP', hd)}`, '#/goals');
  }
  const last = book.settings.lastBackupAt;
  if (book.ledger.length && (!last || now - new Date(last) > 7 * 86400000)) {
    const wk = localDay(new Date(Math.floor(now.getTime() / (7 * 86400000)) * 7 * 86400000).toISOString());
    push(`backup:${wk}`, 'warn', 'خُد نسخة احتياطية', last ? 'مرّ أكثر من 7 أيام على آخر نسخة. البيانات محفوظة على هذا الجهاز فقط.' : 'لم تأخذ نسخة احتياطية بعد. البيانات محفوظة على هذا الجهاز فقط.', '#/settings');
  }
  const dismissed = new Set(book.settings.dismissed || []);
  return out.filter((n) => !dismissed.has(n.key));
}
