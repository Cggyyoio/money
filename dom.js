// Tiny DOM helpers. Text is always inserted as text nodes (never innerHTML) → no XSS from stored data.
const BOOL = new Set(['checked', 'selected', 'disabled', 'hidden', 'readOnly', 'multiple', 'required']);
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (BOOL.has(k)) el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
  append(el, kids);
  return el;
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

export function toast(msg, bad = false) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  box.append(t);
  setTimeout(() => t.remove(), bad ? 5000 : 2600);
}

/** Bottom sheet. build(close) returns the content element(s). Resolves when closed. */
export function sheet(title, build) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title), build(close));
    const ov = h('div', { class: 'overlay', onClick: (e) => { if (e.target === ov) close(undefined); } }, box);
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    box.querySelector('input,select,textarea,button')?.focus();
  });
}

export function confirmBox(title, text, okLabel = 'تأكيد', danger = false) {
  return sheet(title, (close) => h('div', null, h('p', null, text),
    h('div', { class: 'btns' }, h('button', { class: 'btn' + (danger ? ' danger' : ' primary'), onClick: () => close(true) }, okLabel), h('button', { class: 'btn', onClick: () => close(false) }, 'رجوع')))).then(Boolean);
}

export function download(name, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const field = (label, input, hint) => h('div', { class: 'field' }, h('label', null, label, input), hint ? h('span', { class: 'hint' }, hint) : null);
// <label> wraps the control so tapping the text focuses it
export function select(options, value, props) {
  const el = h('select', props, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  el.value = value ?? options[0]?.[0] ?? '';
  return el;
}
