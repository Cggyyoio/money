import { h, s } from './dom.js';

const W = 320, H = 170, PAD = { l: 18, r: 18, t: 10, b: 22 };
const short = (n) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n)); };

/** data: [{label, value:number}] — signed bars. */
export function barChart(data, { title = '' } = {}) {
  if (!data.length) return h('div', { class: 'empty' }, 'لا توجد بيانات في هذه الفترة');
  const max = Math.max(...data.map((d) => d.value), 0), min = Math.min(...data.map((d) => d.value), 0);
  const span = max - min || 1, plotH = H - PAD.t - PAD.b, plotW = W - PAD.l - PAD.r;
  const y = (v) => PAD.t + plotH * (1 - (v - min) / span);
  const bw = plotW / data.length;
  const every = Math.ceil(data.length / 7);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title },
    s('line', { class: 'grid', x1: PAD.l, x2: W - PAD.r, y1: y(0), y2: y(0) }),
    s('text', { x: PAD.l, y: PAD.t + 2 }, short(max)),
    data.map((d, i) => {
      const x = PAD.l + i * bw + bw * 0.15, top = Math.min(y(d.value), y(0)), hh = Math.max(1, Math.abs(y(d.value) - y(0)));
      return [s('rect', { class: 'bar' + (d.value < 0 ? ' neg' : ''), x, y: top, width: bw * 0.7, height: hh, rx: 2 }, s('title', {}, `${d.label}: ${d.value.toLocaleString('en')}`)),
        i % every === 0 ? s('text', { x: x + bw * 0.35, y: H - 6, 'text-anchor': 'middle' }, d.label) : null];
    }));
  return svg;
}

/** points: [{label, value}] */
export function lineChart(points, { title = '' } = {}) {
  if (points.length < 2) return h('div', { class: 'empty' }, 'تحتاج يومين على الأقل لعرض المنحنى');
  const vals = points.map((p) => p.value);
  let max = Math.max(...vals), min = Math.min(...vals);
  if (max === min) { max += 1; min -= 1; }
  const plotH = H - PAD.t - PAD.b, plotW = W - PAD.l - PAD.r;
  const x = (i) => PAD.l + (plotW * i) / (points.length - 1), y = (v) => PAD.t + plotH * (1 - (v - min) / (max - min));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const every = Math.ceil(points.length / 6);
  return s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title },
    s('line', { class: 'grid', x1: PAD.l, x2: W - PAD.r, y1: y(min), y2: y(min) }),
    s('text', { x: PAD.l, y: PAD.t + 2 }, short(max)), s('text', { x: PAD.l, y: H - PAD.b - 3 }, short(min)),
    s('path', { class: 'area', d: `${d}L${x(points.length - 1)},${y(min)}L${x(0)},${y(min)}Z` }),
    s('path', { class: 'line', d }),
    points.map((p, i) => (i % every === 0 ? s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, p.label) : null)));
}

/** Horizontal ranked bars. rows: [{label, value:number, text}] */
export function hbars(rows) {
  if (!rows.length) return h('div', { class: 'empty' }, 'لا توجد بيانات في هذه الفترة');
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return h('div', { class: 'hbar' }, rows.map((r, i) => h('div', { class: 'r' }, h('span', null, r.label),
    h('div', { class: 'track' }, h('i', { class: 'c' + (i % 8), style: { width: Math.max(2, (Math.abs(r.value) / max) * 100) + '%' } })), h('span', { class: 'num' }, r.text))));
}

/** Proportional strip + legend rows (wallet distribution). */
export function shares(rows, { dark = false } = {}) {
  const total = rows.reduce((t, r) => t + Math.max(r.value, 0), 0);
  return h('div', null,
    h('div', { class: 'tape', 'aria-hidden': 'true' }, rows.map((r, i) => (r.value > 0 ? h('i', { class: 'c' + (i % 8), style: { flex: String(r.value / (total || 1)) } }) : null))),
    h('div', { class: 'legend' }, rows.map((r, i) => h('div', { class: 'r' }, h('span', { class: 'dot c' + (i % 8) }), h('span', null, r.label), h('span', { class: 'muted small' }, total ? Math.round((Math.max(r.value, 0) / total) * 100) + '%' : ''), h('b', { class: 'num' }, r.text)))));
}
