import { sha256Hex } from './sha256.js';
import { canonical } from './util.js';

export const GENESIS = '0'.repeat(64);

export function auditHash(prevHash, e) {
  const { seq, at, action, entity, entityId, old, new: nw, reason, device } = e;
  return sha256Hex(prevHash + '|' + canonical({ seq, at, action, entity, entityId, old, new: nw, reason, device }));
}

/** Verifies the hash chain; returns {ok, brokenAt}. */
export function verifyAuditChain(list) {
  let prev = GENESIS;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.seq !== i + 1 || e.prevHash !== prev || e.hash !== auditHash(prev, e)) return { ok: false, brokenAt: e.seq ?? i + 1 };
    prev = e.hash;
  }
  return { ok: true };
}
