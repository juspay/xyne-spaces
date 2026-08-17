/**
 * Webhook capability-secret service for agent-automations.
 *
 * Mirrors xyne-spaces' `webhook-secret.service.ts`: a 32-byte base64url secret
 * is issued ONCE at activation, embedded in the automation's unique URL, and
 * stored ENCRYPTED at rest (AES-256-GCM via the shared `crypto.ts` helpers,
 * keyed by `CONFIG.encryptionKey`). Verification decrypts and does a
 * length-checked, timing-safe comparison so the endpoint cannot be probed by
 * timing. Secrets are rotatable; rotation invalidates the old URL immediately.
 *
 * The plaintext is returned to the caller exactly once (at issue/rotate) and is
 * never persisted or logged.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt, type EncryptedPayload } from "../crypto.js";
import { CONFIG } from "../config.js";

/** Opaque encrypted-at-rest secret record, JSON-serialisable for the DB column. */
export type StoredSecret = EncryptedPayload;

export interface IssuedSecret {
  /** Show ONCE to the user; goes in the webhook URL. Never persisted. */
  plaintext: string;
  /** Encrypted blob to store in `AgentAutomation.secret`. */
  stored: StoredSecret;
}

/** Generate a fresh URL-safe secret and its encrypted-at-rest form. */
export function issueSecret(): IssuedSecret {
  const plaintext = randomBytes(32).toString("base64url");
  const stored = encrypt(plaintext, CONFIG.encryptionKey);
  return { plaintext, stored };
}

/** Serialise the encrypted secret for a JSON/`Json` column. */
export function serializeStoredSecret(stored: StoredSecret): string {
  return JSON.stringify(stored);
}

export function parseStoredSecret(raw: string): StoredSecret {
  const p = JSON.parse(raw) as Partial<StoredSecret>;
  if (!p || typeof p.ciphertext !== "string" || typeof p.iv !== "string" || typeof p.authTag !== "string") {
    throw new Error("parseStoredSecret: malformed stored secret");
  }
  return { ciphertext: p.ciphertext, iv: p.iv, authTag: p.authTag };
}

/**
 * Constant-time check that `candidate` (from the request URL) equals the stored
 * secret. Returns false on any decrypt/length failure — never throws to the
 * caller, so the handler responds with a uniform 401.
 */
export function storedSecretMatches(candidate: string, storedRaw: string): boolean {
  let expected: string;
  try {
    const stored = parseStoredSecret(storedRaw);
    expected = decrypt(stored.ciphertext, stored.iv, stored.authTag, CONFIG.encryptionKey);
  } catch {
    return false;
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return timingSafeEqual(a, b);
}
