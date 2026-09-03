import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: crypto.ScryptOptions,
) => Promise<Buffer>;

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const PASSWORD_UPPERCASE_REGEX = /[A-Z]/;
const PASSWORD_DIGIT_REGEX = /\d/;
const PASSWORD_SPECIAL_CHARACTER_REGEX = /[^A-Za-z0-9]/;
const CLIENT_PASSWORD_HASH_REGEX = /^[a-f0-9]{64}$/i;

export const PASSWORD_COMPLEXITY_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters and include at least one uppercase letter, one number, and one special character`;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const N = 2 ** 14;
  const r = 8;
  const p = 1;
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, { N, r, p })) as Buffer;
  return `$scrypt$ln=14,r=8,p=1$${salt}$${derivedKey.toString('hex')}`;
}

// A syntactically valid scrypt hash in the SAME modular-crypt format and with the
// SAME work parameters as hashPassword (ln=14, r=8, p=1). The email-login path
// verifies against this when no account (or no password) is found, so that branch
// runs a full scrypt derivation and takes as long as verifying a real stored hash,
// keeping verification time constant. Keep these parameters equal to hashPassword.
// Not a credential: it is never compared for a real match, only for timing.
export const DUMMY_PASSWORD_HASH =
  '$scrypt$ln=14,r=8,p=1$e1b76c97154e03fcc330cda38be6e271776fdbf1cecadad84b94f5671f55b3fb$46a2d60a74a198809db3674f5e93fc7458114f61232e660d9f9f4c14647801d4c3a9e4f7e635bc95d55c658f9672dcfd6aa22542f37ac64bf6c6767b8b20e3a6';

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  let salt: string;
  let key: string;
  let N: number;
  let r: number;
  let p: number;

  // Modular crypt format: $scrypt$ln=16,r=8,p=1$<salt>$<key>
  const parts = hash.split('$');
  if (parts.length !== 5) return false;

  const paramMatch = parts[2].match(/ln=(\d+),r=(\d+),p=(\d+)/);
  if (!paramMatch) return false;

  N = 2 ** parseInt(paramMatch[1], 10);
  r = parseInt(paramMatch[2], 10);
  p = parseInt(paramMatch[3], 10);
  salt = parts[3];
  key = parts[4];

  if (!salt || !key) return false;
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, { N, r, p })) as Buffer;
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
}

export function generateSixDigitCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function isClientPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_PASSWORD_HASH_REGEX.test(value);
}

export function normalizeClientPasswordHash(value: string): string {
  return value.toLowerCase();
}

export function hashPasswordForAuth(password: string): string {
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex');
}

export async function verifyEmailPassword(password: string, storedHash: string): Promise<boolean> {
  if (isClientPasswordHash(storedHash)) {
    const matches = crypto.timingSafeEqual(
      Buffer.from(hashPasswordForAuth(password), 'hex'),
      Buffer.from(normalizeClientPasswordHash(storedHash), 'hex'),
    );
    // Stored hashes are a mix of this fast (sha256) form and the slow scrypt form
    // (passwords set via reset/change). Run one scrypt derivation here too so the
    // verification cost is the same regardless of which form an account uses,
    // keeping login time constant.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return matches;
  }

  return verifyPassword(password, storedHash);
}

export function validatePasswordComplexity(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return PASSWORD_COMPLEXITY_MESSAGE;
  }

  if (!PASSWORD_UPPERCASE_REGEX.test(password)) {
    return PASSWORD_COMPLEXITY_MESSAGE;
  }

  if (!PASSWORD_DIGIT_REGEX.test(password)) {
    return PASSWORD_COMPLEXITY_MESSAGE;
  }

  if (!PASSWORD_SPECIAL_CHARACTER_REGEX.test(password)) {
    return PASSWORD_COMPLEXITY_MESSAGE;
  }

  return null;
}
