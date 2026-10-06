import { h } from '../dom.js';
import { app, pageTop } from '../ctx.js';
import { NAV } from '../app.js';

export function render() {
  return h('div', { class: 'stack' }, pageTop('المزيد'),
    h('div', { class: 'list' }, NAV.filter(([k]) => !['', 'tx', 'accounts'].includes(k)).map(([k, l, i]) => h('a', { class: 'item', href: '#/' + k }, h('div', { class: 'ic', 'aria-hidden': 'true' }, i), h('div', { class: 'main' }, h('div', { class: 't' }, l))))),
    h('button', { class: 'btn block', onClick: () => app.lock() }, '🔒 قفل التطبيق'));
}
