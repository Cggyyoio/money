// Password / PIN hashing with WebCrypto (PBKDF2-SHA256). Note: this gates the UI; it does not encrypt data at rest.
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const ITER = 210000;

async function derive(secret, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: iter }, key, 256));
}
export async function makeSecret(secret) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: ITER, hash: await derive(secret, salt, ITER) };
}
export async function verifySecret(secret, rec) {
  if (!rec) return false;
  const h = await derive(secret, rec.salt, rec.iter);
  let diff = h.length ^ rec.hash.length;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ (rec.hash.charCodeAt(i) || 0);
  return diff === 0;
}
