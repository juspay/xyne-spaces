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

export const PASSWORD_COMPLEXITY_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters and include at least one uppercase letter, one number, and one special character`;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  const N = 2 ** 14;
  const r = 8;
  const p = 1;
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, { N, r, p })) as Buffer;
  return `$scrypt$ln=14,r=8,p=1$${salt}$${derivedKey.toString('hex')}`;
}

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