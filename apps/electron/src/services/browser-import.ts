import { app, session } from 'electron';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { Logger } from './logger/Logger';

const execFileAsync = promisify(execFile);

const BROWSER_TABS_PARTITION = 'persist:browser-tabs';
const KEYCHAIN_SERVICE = 'Chrome Safe Storage';
const KEYCHAIN_ACCOUNT = 'Chrome';
const KDF_SALT = 'saltysalt';
const KDF_ITERATIONS = 1003;
const KDF_KEY_LENGTH = 16;
const AES_IV = Buffer.alloc(16, ' ');
const V10_PREFIX = 'v10';
const DOMAIN_HASH_LENGTH = 32;
const CHROME_EPOCH_OFFSET_SECONDS = 11644473600;
const SQLITE_BIN = '/usr/bin/sqlite3';

export interface BrowserImportResult {
  imported: number;
  skipped: number;
  hosts: number;
}

interface ChromeCookieRow {
  host_key: string;
  name: string;
  path: string;
  is_secure: number;
  is_httponly: number;
  expires_utc: number;
  samesite: number;
  encrypted_hex: string;
}

function chromeProfileDir(profile: string): string {
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    profile,
  );
}

export async function chromeProfileAvailable(profile = 'Default'): Promise<boolean> {
  try {
    await fs.access(path.join(chromeProfileDir(profile), 'Cookies'));
    return true;
  } catch {
    return false;
  }
}

async function readSafeStorageKey(): Promise<Buffer> {
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-wa',
    KEYCHAIN_ACCOUNT,
    '-s',
    KEYCHAIN_SERVICE,
  ]);
  const secret = stdout.trim();
  if (!secret) {
    throw new Error('empty-safe-storage-key');
  }
  return crypto.pbkdf2Sync(secret, KDF_SALT, KDF_ITERATIONS, KDF_KEY_LENGTH, 'sha1');
}

export function decryptCookieValue(encrypted: Buffer, key: Buffer): string | null {
  if (encrypted.length === 0) return null;
  if (encrypted.subarray(0, V10_PREFIX.length).toString('utf8') !== V10_PREFIX) {
    return encrypted.toString('utf8');
  }
  const body = encrypted.subarray(V10_PREFIX.length);
  if (body.length === 0 || body.length % 16 !== 0) return null;

  const decipher = crypto.createDecipheriv('aes-128-cbc', key, AES_IV);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  const padding = plain[plain.length - 1];
  if (padding === undefined || padding < 1 || padding > 16 || padding > plain.length) return null;
  const unpadded = plain.subarray(0, plain.length - padding);
  const value =
    unpadded.length >= DOMAIN_HASH_LENGTH ? unpadded.subarray(DOMAIN_HASH_LENGTH) : unpadded;
  return value.toString('utf8');
}

async function readCookieRows(profile: string): Promise<ChromeCookieRow[]> {
  const source = path.join(chromeProfileDir(profile), 'Cookies');
  const scratch = await fs.mkdtemp(path.join(app.getPath('temp'), 'xyne-cookie-import-'));
  const copy = path.join(scratch, 'Cookies');
  try {
    await fs.copyFile(source, copy);
    const { stdout } = await execFileAsync(
      SQLITE_BIN,
      [
        '-json',
        copy,
        'SELECT host_key, name, path, is_secure, is_httponly, expires_utc, samesite, hex(encrypted_value) AS encrypted_hex FROM cookies',
      ],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    return trimmed ? (JSON.parse(trimmed) as ChromeCookieRow[]) : [];
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sameSiteOf(value: number): 'no_restriction' | 'lax' | 'strict' {
  if (value === 2) return 'strict';
  if (value === 1) return 'lax';
  return 'no_restriction';
}

function expirationOf(expiresUtc: number): number | undefined {
  if (!expiresUtc) return undefined;
  const seconds = expiresUtc / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS;
  return seconds > Date.now() / 1000 ? seconds : undefined;
}

function cookieUrl(row: ChromeCookieRow): string {
  const host = row.host_key.startsWith('.') ? row.host_key.slice(1) : row.host_key;
  const scheme = row.is_secure ? 'https' : 'http';
  return `${scheme}://${host}${row.path || '/'}`;
}

export async function importChromeCookies(profile = 'Default'): Promise<BrowserImportResult> {
  const key = await readSafeStorageKey();
  const rows = await readCookieRows(profile);
  const target = session.fromPartition(BROWSER_TABS_PARTITION);

  let imported = 0;
  let skipped = 0;
  const hosts = new Set<string>();

  for (const row of rows) {
    const expirationDate = expirationOf(row.expires_utc);
    if (row.expires_utc && expirationDate === undefined) {
      skipped += 1;
      continue;
    }

    let value: string | null = null;
    try {
      value = decryptCookieValue(Buffer.from(row.encrypted_hex || '', 'hex'), key);
    } catch {
      value = null;
    }
    if (value === null) {
      skipped += 1;
      continue;
    }

    try {
      await target.cookies.set({
        url: cookieUrl(row),
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path || '/',
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        sameSite: sameSiteOf(row.samesite),
        ...(expirationDate === undefined ? {} : { expirationDate }),
      });
      imported += 1;
      hosts.add(row.host_key);
    } catch {
      skipped += 1;
    }
  }

  Logger.info('browser-import.chrome.completed', {
    imported,
    skipped,
    hosts: hosts.size,
  });

  return { imported, skipped, hosts: hosts.size };
}
