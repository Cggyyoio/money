// Backup files: plain JSON, or AES-256-GCM encrypted with a password (PBKDF2-derived key).
import { sha256Hex } from '../domain/sha256.js';
import { canonical, AppError } from '../domain/util.js';
import { validateDump } from '../domain/book.js';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 250000;

async function key(password, salt, iter, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function buildBackup(book, password) {
  const data = book.dump();
  const plain = JSON.stringify({ format: 'moneyflow-backup', version: 1, exportedAt: new Date().toISOString(), checksum: sha256Hex(canonical(data)), data });
  if (!password) return plain;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt, ITER, ['encrypt']), enc.encode(plain));
  return JSON.stringify({ format: 'moneyflow-backup-encrypted', version: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) });
}

export function isEncrypted(text) { try { return JSON.parse(text).format === 'moneyflow-backup-encrypted'; } catch { return false; } }

/** Returns the validated dump object, or throws AppError. */
export async function parseBackup(text, password) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new AppError('الملف ليس نسخة احتياطية صالحة'); }
  if (obj.format === 'moneyflow-backup-encrypted') {
    if (!password) throw new AppError('النسخة مشفرة — أدخل كلمة السر');
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, await key(password, unb64(obj.salt), obj.iter, ['decrypt']), unb64(obj.ct));
      obj = JSON.parse(dec.decode(pt));
    } catch { throw new AppError('كلمة السر غير صحيحة أو الملف تالف'); }
  }
  if (obj.format !== 'moneyflow-backup' || !obj.data) throw new AppError('الملف ليس نسخة احتياطية صالحة');
  if (sha256Hex(canonical(obj.data)) !== obj.checksum) throw new AppError('الملف تالف أو تم تعديله (فشل فحص السلامة)');
  validateDump(obj.data);
  return obj.data;
}
