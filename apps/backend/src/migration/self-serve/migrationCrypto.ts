/**
 * Envelope encryption for migration-bucket objects: per-object DEK encrypts bytes
 * (AES-256-GCM), wrapped by the active KEK (id stored per object) so rotation re-wraps
 * DEKs, not data. Keep old KEKs in MIGRATION_ENC_KEYS for reads; MIGRATION_ENC_ACTIVE = new one.
 *
 * Layout: ["XME1"|ver|keyIdLen|keyId|wrapIv(12)|wrapTag(16)|wrappedDek(32)|dataIv(12)][ciphertext][tag(16)]
 */
import { Transform, Readable } from 'stream';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '@/config/env';

const MAGIC = Buffer.from('XME1');
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32;
const WRAPPED_DEK_LEN = 32;

// ── Key store (parsed once from env) ────────────────────────────────────────
let cachedStore: Map<string, Buffer> | null = null;

function keyStore(): Map<string, Buffer> {
  if (cachedStore) return cachedStore;
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(config.migrationEncryption.keys || '{}');
  } catch {
    throw new Error('MIGRATION_ENC_KEYS is not valid JSON (expected {"k1":"<64-hex>", ...})');
  }
  const store = new Map<string, Buffer>();
  for (const [id, hex] of Object.entries(parsed)) {
    const key = Buffer.from(hex, 'hex');
    if (key.length !== DEK_LEN) {
      throw new Error(`MIGRATION_ENC_KEYS["${id}"] must be 32 bytes (64 hex chars), got ${key.length}`);
    }
    store.set(id, key);
  }
  cachedStore = store;
  return store;
}

function activeKek(): { keyId: string; kek: Buffer } {
  const keyId = config.migrationEncryption.activeKeyId;
  if (!keyId) throw new Error('MIGRATION_ENC_ACTIVE is not set — migration encryption requires an active key');
  const kek = keyStore().get(keyId);
  if (!kek) throw new Error(`MIGRATION_ENC_ACTIVE="${keyId}" is not present in MIGRATION_ENC_KEYS`);
  return { keyId, kek };
}

function lookupKek(keyId: string): Buffer {
  const kek = keyStore().get(keyId);
  if (!kek) throw new Error(`migration crypto: KEK "${keyId}" not in MIGRATION_ENC_KEYS (retired but still referenced?)`);
  return kek;
}

/** True once a valid active key is configured — lets callers fail fast at submit time. */
export function isMigrationEncryptionConfigured(): boolean {
  try { activeKek(); return true; } catch { return false; }
}

// ── Header codec ────────────────────────────────────────────────────────────
/** Fresh DEK + IVs, wrapped by the active KEK → the header that precedes the ciphertext. */
function seal(): { header: Buffer; dek: Buffer; dataIv: Buffer } {
  const { keyId, kek } = activeKek();
  const dek = randomBytes(DEK_LEN);
  const wrapIv = randomBytes(IV_LEN);
  const dataIv = randomBytes(IV_LEN);

  const wrap = createCipheriv('aes-256-gcm', kek, wrapIv);
  const wrappedDek = Buffer.concat([wrap.update(dek), wrap.final()]);
  const wrapTag = wrap.getAuthTag();

  const idBuf = Buffer.from(keyId, 'utf8');
  if (idBuf.length > 255) throw new Error('migration crypto: keyId too long');
  const header = Buffer.concat([
    MAGIC, Buffer.from([VERSION, idBuf.length]), idBuf, wrapIv, wrapTag, wrappedDek, dataIv,
  ]);
  return { header, dek, dataIv };
}

/** Parse a header buffer and unwrap the DEK using the referenced KEK. */
function open(buf: Buffer): { dek: Buffer; dataIv: Buffer; headerLen: number } {
  if (buf.length < 6 || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('migration crypto: bad magic (object not encrypted with this scheme?)');
  }
  if (buf[4] !== VERSION) throw new Error(`migration crypto: unsupported version ${buf[4]}`);
  const keyIdLen = buf[5];
  const headerLen = 6 + keyIdLen + IV_LEN + TAG_LEN + WRAPPED_DEK_LEN + IV_LEN;
  if (buf.length < headerLen) throw new Error('migration crypto: truncated header');

  let o = 6;
  const keyId = buf.subarray(o, o + keyIdLen).toString('utf8'); o += keyIdLen;
  const wrapIv = buf.subarray(o, o + IV_LEN); o += IV_LEN;
  const wrapTag = buf.subarray(o, o + TAG_LEN); o += TAG_LEN;
  const wrappedDek = buf.subarray(o, o + WRAPPED_DEK_LEN); o += WRAPPED_DEK_LEN;
  const dataIv = buf.subarray(o, o + IV_LEN); o += IV_LEN;

  const unwrap = createDecipheriv('aes-256-gcm', lookupKek(keyId), wrapIv);
  unwrap.setAuthTag(wrapTag);
  const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);
  return { dek, dataIv, headerLen };
}

// ── Streaming ───────────────────────────────────────────────────────────────
/** Prepends the header, AES-256-GCM-encrypts the body, appends the tag last. */
class EncryptTransform extends Transform {
  private wroteHeader = false;
  constructor(private readonly header: Buffer, private readonly cipher: ReturnType<typeof createCipheriv>) { super(); }
  private ensureHeader(): void { if (!this.wroteHeader) { this.push(this.header); this.wroteHeader = true; } }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.ensureHeader();
    this.push(this.cipher.update(chunk));
    cb();
  }
  _flush(cb: (e?: Error | null) => void): void {
    this.ensureHeader();
    this.push(this.cipher.final());
    this.push((this.cipher as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer }).getAuthTag());
    cb();
  }
}

/** Reads the header, then decrypts — holding back a 16-byte tail so the trailing GCM tag applies at the end. */
class DecryptTransform extends Transform {
  private buf = Buffer.alloc(0);
  private decipher: ReturnType<typeof createDecipheriv> | null = null;
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    try {
      if (!this.decipher) {
        if (this.buf.length < 6) return cb();
        const keyIdLen = this.buf[5];
        const headerLen = 6 + keyIdLen + IV_LEN + TAG_LEN + WRAPPED_DEK_LEN + IV_LEN;
        if (this.buf.length < headerLen) return cb();
        const { dek, dataIv } = open(this.buf.subarray(0, headerLen));
        this.decipher = createDecipheriv('aes-256-gcm', dek, dataIv);
        this.buf = this.buf.subarray(headerLen);
      }
      // everything but the trailing TAG_LEN bytes is ciphertext we can decrypt now
      if (this.buf.length > TAG_LEN) {
        const body = this.buf.subarray(0, this.buf.length - TAG_LEN);
        this.buf = this.buf.subarray(this.buf.length - TAG_LEN);
        this.push(this.decipher.update(body));
      }
      cb();
    } catch (e) { cb(e as Error); }
  }
  _flush(cb: (e?: Error | null) => void): void {
    if (!this.decipher) return cb(new Error('migration crypto: object too small / missing header'));
    if (this.buf.length !== TAG_LEN) return cb(new Error('migration crypto: missing auth tag'));
    try {
      (this.decipher as ReturnType<typeof createDecipheriv> & { setAuthTag(t: Buffer): void }).setAuthTag(this.buf);
      this.push(this.decipher.final()); // throws on tamper / wrong key
      cb();
    } catch (e) { cb(e as Error); }
  }
}

/** Encrypt a stream: plaintext → [header][ciphertext][tag]. Bounded memory. */
export function encryptStream(plaintext: NodeJS.ReadableStream): Readable {
  const { header, dek, dataIv } = seal();
  const t = new EncryptTransform(header, createCipheriv('aes-256-gcm', dek, dataIv));
  plaintext.on('error', (e) => t.destroy(e as Error));
  return plaintext.pipe(t);
}

/** Decrypt a stream produced by encryptStream/encryptBuffer. Bounded memory. */
export function decryptStream(ciphertext: NodeJS.ReadableStream): Readable {
  const t = new DecryptTransform();
  ciphertext.on('error', (e) => t.destroy(e as Error));
  return ciphertext.pipe(t);
}

// ── Buffers (small JSON blobs) ──────────────────────────────────────────────
export function encryptBuffer(plain: Buffer): Buffer {
  const { header, dek, dataIv } = seal();
  const c = createCipheriv('aes-256-gcm', dek, dataIv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([header, body, c.getAuthTag()]);
}

export function decryptBuffer(enc: Buffer): Buffer {
  const { dek, dataIv, headerLen } = open(enc);
  const tag = enc.subarray(enc.length - TAG_LEN);
  const body = enc.subarray(headerLen, enc.length - TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', dek, dataIv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

