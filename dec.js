// Fixed-point decimal arithmetic on BigInt (8 fractional digits). No floating point anywhere in money math.
export const ONE = 10n ** 8n;
const RE = /^[+-]?\d+(\.\d+)?$/;

/** Parse a decimal string/number into a scaled BigInt. */
export function D(x) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new Error('رقم غير صالح');
    x = Math.abs(x) < 1e-6 || Math.abs(x) >= 1e15 ? x.toFixed(8) : String(x);
  }
  if (typeof x !== 'string') throw new Error('رقم غير صالح');
  x = x.trim().replace(/,/g, '');
  if (!RE.test(x)) throw new Error('رقم غير صالح: ' + x);
  const neg = x[0] === '-';
  x = x.replace(/^[+-]/, '');
  const [i, f = ''] = x.split('.');
  let v = BigInt(i) * ONE + BigInt((f + '00000000').slice(0, 8));
  if (f.length > 8 && f.charCodeAt(8) >= 53) v += 1n; // round half up on the first dropped digit
  return neg ? -v : v;
}

export function rdiv(n, d) {
  if (d === 0n) throw new Error('قسمة على صفر');
  const neg = (n < 0n) !== (d < 0n);
  if (n < 0n) n = -n;
  if (d < 0n) d = -d;
  let q = n / d;
  if ((n % d) * 2n >= d) q += 1n;
  return neg ? -q : q;
}
export const mul = (a, b) => rdiv(a * b, ONE);
export const div = (a, b) => rdiv(a * ONE, b);
export const abs = (a) => (a < 0n ? -a : a);

/** Round to `dp` decimals (result stays scaled). */
export function q(v, dp = 6) {
  const f = 10n ** BigInt(8 - dp);
  return rdiv(v, f) * f;
}

/** Canonical string, up to `dp` decimals, trailing zeros trimmed. */
export function S(v, dp = 6) {
  v = q(v, dp);
  const neg = v < 0n;
  if (neg) v = -v;
  const i = v / ONE;
  const f = (v % ONE).toString().padStart(8, '0').slice(0, dp).replace(/0+$/, '');
  return (neg && (i > 0n || f) ? '-' : '') + i.toString() + (f ? '.' + f : '');
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
/** Normalise user-typed numbers (Arabic-Indic digits, Arabic separators, spaces). */
export function normalizeNumber(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)))
    .replace(/[٫]/g, '.')
    .replace(/[٬،,\s]/g, '')
    .trim();
}

const CRYPTO = new Set(['USDT', 'BTC', 'ETH', 'USDC']);
/** Display format, e.g. 1,250.00 EGP */
export function fmt(str, ccy = 'EGP', { hideDecimals = false } = {}) {
  const v = typeof str === 'bigint' ? str : D(str || '0');
  const dp = hideDecimals ? 0 : CRYPTO.has(ccy) ? 4 : 2;
  const r = q(v, dp);
  const neg = r < 0n;
  const a = neg ? -r : r;
  const int = (a / ONE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = dp ? (a % ONE).toString().padStart(8, '0').slice(0, dp) : '';
  return (neg ? '-' : '') + int + (dp ? '.' + frac : '') + (ccy ? ' ' + ccy : '');
}
