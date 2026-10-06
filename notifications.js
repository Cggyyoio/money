import { notifications } from '../../domain/notify.js';
import { h } from '../dom.js';
import { app, pageTop, empty } from '../ctx.js';

export function render() {
  const list = notifications(app.book);
  return h('div', { class: 'stack' }, pageTop('الإشعارات', list.length ? h('button', { class: 'btn sm', onClick: async () => { for (const n of list) await app.book.dismiss(n.key); } }, 'إخفاء الكل') : null),
    list.length ? h('div', { class: 'list' }, list.map((n) => h('div', { class: 'item' }, h('div', { class: 'ic' }, { bad: '🔴', good: '🟢', warn: '🟡', info: 'ℹ️' }[n.level]),
      h('a', { class: 'main', href: n.link }, h('div', { class: 't', style: { whiteSpace: 'normal' } }, n.title), h('div', { class: 's', style: { whiteSpace: 'normal' } }, n.body)), h('button', { class: 'btn sm', 'aria-label': 'إخفاء', onClick: () => app.book.dismiss(n.key) }, '✕')))) : empty('لا توجد إشعارات. كل شيء تمام ✅'));
}
