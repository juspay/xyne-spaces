import { app, nativeImage, session } from 'electron';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { Logger } from './logger/Logger';

const execFileAsync = promisify(execFile);

const BROWSER_TABS_PARTITION = 'persist:browser-tabs';
const KDF_SALT = 'saltysalt';
const KDF_ITERATIONS = 1003;
const KDF_KEY_LENGTH = 16;
const AES_IV = Buffer.alloc(16, ' ');
const V10_PREFIX = 'v10';
const DOMAIN_HASH_LENGTH = 32;
/** From this cookie database version on, Chromium prefixes each value with a hash of
 *  its domain before encrypting it. */
const DOMAIN_HASH_DB_VERSION = 24;
const CHROME_EPOCH_OFFSET_SECONDS = 11644473600;
/** Safari counts from 2001-01-01. */
const MAC_EPOCH_OFFSET_SECONDS = 978307200;
const SQLITE_BIN = '/usr/bin/sqlite3';
const SAFARI_COOKIES = path.join(
  os.homedir(),
  'Library',
  'Containers',
  'com.apple.Safari',
  'Data',
  'Library',
  'Cookies',
  'Cookies.binarycookies',
);

export interface BrowserImportResult {
  imported: number;
  skipped: number;
  hosts: number;
}

/** A browser installed on this computer, found without opening any of its data. */
export interface BrowserImportBrowser {
  browser: string;
  browserName: string;
  /** The browser's own app icon, as a PNG data URL; null when its app isn't found. */
  icon: string | null;
}

/** One of a browser's profiles, read once macOS has let the app into its data. */
export interface BrowserImportProfile {
  /** `browser:profile`, as an import asks for it. */
  id: string;
  /** The profile's own name: "Person 1", "Work". */
  profile: string;
  /** The account the profile is signed in to the browser with, when it is. */
  account: string | null;
}

/** Where each browser's app is, for its icon: its usual name in Applications, and its
 *  bundle id for Spotlight to find it anywhere else. */
const BROWSER_APPS: Record<string, { app: string; bundleId: string }> = {
  chrome: { app: 'Google Chrome', bundleId: 'com.google.Chrome' },
  arc: { app: 'Arc', bundleId: 'company.thebrowser.Browser' },
  brave: { app: 'Brave Browser', bundleId: 'com.brave.Browser' },
  edge: { app: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac' },
  vivaldi: { app: 'Vivaldi', bundleId: 'com.vivaldi.Vivaldi' },
  opera: { app: 'Opera', bundleId: 'com.operasoftware.Opera' },
  chromium: { app: 'Chromium', bundleId: 'org.chromium.Chromium' },
  firefox: { app: 'Firefox', bundleId: 'org.mozilla.firefox' },
  safari: { app: 'Safari', bundleId: 'com.apple.Safari' },
};
/** Drawn at 32px, so twice that for a sharp one on a Retina screen. */
const ICON_SIZE = 64;
const icons = new Map<string, Promise<string | null>>();

async function findApp(browser: string): Promise<string | null> {
  const known = BROWSER_APPS[browser];
  if (!known) return null;
  for (const candidate of [
    path.join('/Applications', `${known.app}.app`),
    path.join(os.homedir(), 'Applications', `${known.app}.app`),
  ]) {
    if (await exists(candidate)) return candidate;
  }
  try {
    const { stdout } = await execFileAsync('mdfind', [`kMDItemCFBundleIdentifier == "${known.bundleId}"`]);
    return stdout.split('\n').find(line => line.endsWith('.app')) ?? null;
  } catch {
    return null;
  }
}

/** A browser's app icon, once per browser: what Finder and the Dock show for it. */
function browserIcon(browser: string): Promise<string | null> {
  let icon = icons.get(browser);
  if (!icon) {
    icon = (async () => {
      const appPath = await findApp(browser);
      if (!appPath) return null;
      try {
        const image = await nativeImage.createThumbnailFromPath(appPath, {
          width: ICON_SIZE,
          height: ICON_SIZE,
        });
        if (!image.isEmpty()) return image.toDataURL();
      } catch {
        // No thumbnail: the system's file icon will do.
      }
      try {
        const image = await app.getFileIcon(appPath, { size: 'normal' });
        return image.isEmpty() ? null : image.toDataURL();
      } catch {
        return null;
      }
    })();
    icons.set(browser, icon);
  }
  return icon;
}

/** Why an import didn't happen, for the reader. */
export class BrowserImportError extends Error {
  constructor(
    readonly reason: 'needs-access' | 'keychain-denied' | 'unknown-source' | 'unsupported-platform',
  ) {
    super(reason);
  }
}

interface ChromiumBrowser {
  id: string;
  name: string;
  /** Under ~/Library/Application Support. */
  dir: string;
  keychainService: string;
  keychainAccount: string;
}

/** The Chromium-family browsers: one cookie format, each with its own keychain key. */
const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  { id: 'chrome', name: 'Google Chrome', dir: 'Google/Chrome', keychainService: 'Chrome Safe Storage', keychainAccount: 'Chrome' },
  { id: 'arc', name: 'Arc', dir: 'Arc/User Data', keychainService: 'Arc Safe Storage', keychainAccount: 'Arc' },
  { id: 'brave', name: 'Brave', dir: 'BraveSoftware/Brave-Browser', keychainService: 'Brave Safe Storage', keychainAccount: 'Brave' },
  { id: 'edge', name: 'Microsoft Edge', dir: 'Microsoft Edge', keychainService: 'Microsoft Edge Safe Storage', keychainAccount: 'Microsoft Edge' },
  { id: 'vivaldi', name: 'Vivaldi', dir: 'Vivaldi', keychainService: 'Vivaldi Safe Storage', keychainAccount: 'Vivaldi' },
  { id: 'opera', name: 'Opera', dir: 'com.operasoftware.Opera', keychainService: 'Opera Safe Storage', keychainAccount: 'Opera' },
  { id: 'chromium', name: 'Chromium', dir: 'Chromium', keychainService: 'Chromium Safe Storage', keychainAccount: 'Chromium' },
];

const appSupport = (...parts: string[]): string =>
  path.join(os.homedir(), 'Library', 'Application Support', ...parts);

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** macOS refusing the app another app's data — until it has Full Disk Access. */
const isPermissionError = (error: unknown): boolean =>
  isRecord(error) && (error['code'] === 'EPERM' || error['code'] === 'EACCES');

// ─── Detecting ───────────────────────────────────────────────────────────────

/** A Chromium profile's cookie database: in the profile, or (newer builds) its Network folder. */
async function chromiumCookieFile(profileDir: string): Promise<string | null> {
  for (const candidate of [path.join(profileDir, 'Network', 'Cookies'), path.join(profileDir, 'Cookies')]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

interface FirefoxProfile {
  name: string;
  dir: string;
}

/** Firefox's profiles, from its profiles.ini. */
async function firefoxProfiles(): Promise<FirefoxProfile[]> {
  const root = appSupport('Firefox');
  const ini = await fs.readFile(path.join(root, 'profiles.ini'), 'utf8').catch(() => '');
  const profiles: FirefoxProfile[] = [];
  let section: Record<string, string> | null = null;
  const flush = (): void => {
    if (!section?.['Path']) return;
    const dir = section['IsRelative'] === '0' ? section['Path'] : path.join(root, section['Path']);
    profiles.push({ name: section['Name'] ?? path.basename(dir), dir });
  };
  for (const line of ini.split(/\r?\n/)) {
    const header = /^\[(.+)\]$/.exec(line.trim());
    if (header) {
      flush();
      section = header[1]?.startsWith('Profile') ? {} : null;
      continue;
    }
    const pair = /^([^=]+)=(.*)$/.exec(line.trim());
    if (section && pair?.[1] !== undefined && pair[2] !== undefined) section[pair[1]] = pair[2];
  }
  flush();
  return profiles;
}

/** Whether a path is there, without opening it: no access prompt for a stat. */
async function present(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * The browsers on this computer, from where their data lives and their apps — never
 * by reading that data. Opening another app's data is what makes macOS ask the reader
 * for access, and that should happen when they choose to import, not when they open
 * Preferences.
 */
export async function listImportBrowsers(): Promise<{
  supported: boolean;
  browsers: BrowserImportBrowser[];
}> {
  if (process.platform !== 'darwin') return { supported: false, browsers: [] };
  const found: { browser: string; browserName: string }[] = [];
  for (const browser of CHROMIUM_BROWSERS) {
    // Its Local State is written once the browser has been used, so a folder left by
    // one never run doesn't count. A stat, which needs no access.
    if (await present(appSupport(browser.dir, 'Local State'))) {
      found.push({ browser: browser.id, browserName: browser.name });
    }
  }
  if (await present(appSupport('Firefox', 'profiles.ini'))) {
    found.push({ browser: 'firefox', browserName: 'Firefox' });
  }
  if (await present('/Applications/Safari.app')) {
    found.push({ browser: 'safari', browserName: 'Safari' });
  }
  const browsers = await Promise.all(
    found.map(async entry => ({ ...entry, icon: await browserIcon(entry.browser) })),
  );
  return { supported: true, browsers };
}

async function chromiumProfiles(browser: ChromiumBrowser): Promise<BrowserImportProfile[]> {
  const root = appSupport(browser.dir);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if (isPermissionError(error)) throw new BrowserImportError('needs-access');
    return [];
  }
  // Profiles by their folder, named as the browser names them; Opera keeps its one
  // profile in the root itself.
  const localState = await readJson(path.join(root, 'Local State'));
  const infoCache =
    isRecord(localState) && isRecord(localState['profile']) && isRecord(localState['profile']['info_cache'])
      ? localState['profile']['info_cache']
      : {};
  const dirs = new Set<string>(Object.keys(infoCache));
  for (const entry of entries) {
    if (entry === 'Default' || /^Profile \d+$/.test(entry)) dirs.add(entry);
  }
  if (dirs.size === 0) dirs.add('');

  const profiles: BrowserImportProfile[] = [];
  for (const dir of dirs) {
    if (!(await chromiumCookieFile(path.join(root, dir)))) continue;
    const info = isRecord(infoCache[dir]) ? infoCache[dir] : {};
    profiles.push({
      id: `${browser.id}:${dir}`,
      profile: typeof info['name'] === 'string' && info['name'] ? info['name'] : dir || 'Default',
      account: typeof info['user_name'] === 'string' && info['user_name'] ? info['user_name'] : null,
    });
  }
  return profiles;
}

/**
 * A browser's profiles, read from its own data. For a browser whose data macOS
 * guards, this is when it asks the reader to let Xyne in; refused, it throws
 * `needs-access`. Safari's data has no such prompt — only Full Disk Access opens it.
 */
export async function listBrowserProfiles(browser: string): Promise<BrowserImportProfile[]> {
  if (process.platform !== 'darwin') throw new BrowserImportError('unsupported-platform');
  const chromium = CHROMIUM_BROWSERS.find(candidate => candidate.id === browser);
  if (chromium) return chromiumProfiles(chromium);
  if (browser === 'firefox') {
    let profiles: FirefoxProfile[];
    try {
      await fs.readFile(appSupport('Firefox', 'profiles.ini'));
      profiles = await firefoxProfiles();
    } catch (error) {
      if (isPermissionError(error)) throw new BrowserImportError('needs-access');
      return [];
    }
    const found: BrowserImportProfile[] = [];
    for (const profile of profiles) {
      if (await exists(path.join(profile.dir, 'cookies.sqlite'))) {
        found.push({ id: `firefox:${profile.dir}`, profile: profile.name, account: null });
      }
    }
    return found;
  }
  if (browser === 'safari') {
    try {
      const handle = await fs.open(SAFARI_COOKIES, 'r');
      await handle.close();
    } catch (error) {
      if (isPermissionError(error)) throw new BrowserImportError('needs-access');
      return [];
    }
    return [{ id: 'safari:', profile: 'Safari', account: null }];
  }
  throw new BrowserImportError('unknown-source');
}

// ─── Reading ─────────────────────────────────────────────────────────────────

interface ImportedCookie {
  /** As the browser stores it: a leading dot for a domain cookie, none for a host-only one. */
  host: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  /** Seconds since the epoch; none for a session cookie. */
  expires: number | undefined;
}

/** Queries a copy of a browser's SQLite database, with its journal or WAL beside it,
 *  so the browser can keep it open and locked. */
async function querySqlite<T>(database: string, sql: string): Promise<T[]> {
  const scratch = await fs.mkdtemp(path.join(app.getPath('temp'), 'xyne-cookie-import-'));
  const copy = path.join(scratch, path.basename(database));
  try {
    try {
      await fs.copyFile(database, copy);
    } catch (error) {
      if (isPermissionError(error)) throw new BrowserImportError('needs-access');
      throw error;
    }
    for (const suffix of ['-journal', '-wal', '-shm']) {
      await fs.copyFile(`${database}${suffix}`, `${copy}${suffix}`).catch(() => undefined);
    }
    const { stdout } = await execFileAsync(SQLITE_BIN, ['-json', copy, sql], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const trimmed = stdout.trim();
    return trimmed ? (JSON.parse(trimmed) as T[]) : [];
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readSafeStorageKey(browser: ChromiumBrowser): Promise<Buffer> {
  let secret = '';
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-wa',
      browser.keychainAccount,
      '-s',
      browser.keychainService,
    ]);
    secret = stdout.trim();
  } catch {
    // Denied at the keychain prompt, or no key for this browser.
    throw new BrowserImportError('keychain-denied');
  }
  if (!secret) throw new BrowserImportError('keychain-denied');
  return crypto.pbkdf2Sync(secret, KDF_SALT, KDF_ITERATIONS, KDF_KEY_LENGTH, 'sha1');
}

export function decryptCookieValue(
  encrypted: Buffer,
  key: Buffer,
  hasDomainHash = true,
): string | null {
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
    hasDomainHash && unpadded.length >= DOMAIN_HASH_LENGTH
      ? unpadded.subarray(DOMAIN_HASH_LENGTH)
      : unpadded;
  return value.toString('utf8');
}

const chromiumSameSite = (value: number): ImportedCookie['sameSite'] =>
  value === 2 ? 'strict' : value === 1 ? 'lax' : value === 0 ? 'no_restriction' : 'unspecified';

interface ChromiumCookieRow {
  host_key: string;
  name: string;
  value: string;
  path: string;
  is_secure: number;
  is_httponly: number;
  expires_utc: number;
  samesite: number;
  encrypted_hex: string;
}

async function readChromium(browser: ChromiumBrowser, profileDir: string): Promise<ImportedCookie[]> {
  const database = await chromiumCookieFile(path.join(appSupport(browser.dir), profileDir));
  if (!database) return [];
  const key = await readSafeStorageKey(browser);
  const [meta] = await querySqlite<{ value: string }>(database, "SELECT value FROM meta WHERE key = 'version'");
  const hasDomainHash = Number(meta?.value ?? 0) >= DOMAIN_HASH_DB_VERSION;
  const rows = await querySqlite<ChromiumCookieRow>(
    database,
    'SELECT host_key, name, value, path, is_secure, is_httponly, expires_utc, samesite, hex(encrypted_value) AS encrypted_hex FROM cookies',
  );
  return rows.flatMap((row): ImportedCookie[] => {
    let value: string | null = row.value || null;
    if (row.encrypted_hex) {
      try {
        value = decryptCookieValue(Buffer.from(row.encrypted_hex, 'hex'), key, hasDomainHash);
      } catch {
        value = null;
      }
    }
    if (value === null) return [];
    return [
      {
        host: row.host_key,
        name: row.name,
        value,
        path: row.path || '/',
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        sameSite: chromiumSameSite(row.samesite),
        expires: row.expires_utc ? row.expires_utc / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS : undefined,
      },
    ];
  });
}

interface FirefoxCookieRow {
  host: string;
  name: string;
  value: string;
  path: string;
  expiry: number;
  isSecure: number;
  isHttpOnly: number;
  sameSite: number;
}

async function readFirefox(profileDir: string): Promise<ImportedCookie[]> {
  const rows = await querySqlite<FirefoxCookieRow>(
    path.join(profileDir, 'cookies.sqlite'),
    'SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies',
  );
  return rows.map(row => ({
    host: row.host,
    name: row.name,
    value: row.value,
    path: row.path || '/',
    secure: Boolean(row.isSecure),
    httpOnly: Boolean(row.isHttpOnly),
    sameSite: row.sameSite === 2 ? 'strict' : row.sameSite === 1 ? 'lax' : 'unspecified',
    // Newer Firefox keeps milliseconds here, older seconds.
    expires: row.expiry ? (row.expiry > 1e11 ? row.expiry / 1000 : row.expiry) : undefined,
  }));
}

/** Safari's Cookies.binarycookies: pages of cookie records, little-endian inside a
 *  big-endian page table. */
export function parseBinaryCookies(file: Buffer): ImportedCookie[] {
  if (file.subarray(0, 4).toString('ascii') !== 'cook') return [];
  const pageCount = file.readUInt32BE(4);
  const pageSizes = Array.from({ length: pageCount }, (_, index) => file.readUInt32BE(8 + index * 4));
  const cookies: ImportedCookie[] = [];
  let pageStart = 8 + pageCount * 4;
  const text = (record: number, offset: number, end: number): string => {
    const start = record + offset;
    const stop = file.indexOf(0, start);
    return file.subarray(start, stop === -1 || stop > end ? end : stop).toString('utf8');
  };
  for (const size of pageSizes) {
    const page = pageStart;
    pageStart += size;
    if (page + 8 > file.length) break;
    const cookieCount = file.readUInt32LE(page + 4);
    for (let index = 0; index < cookieCount; index += 1) {
      const record = page + file.readUInt32LE(page + 8 + index * 4);
      if (record + 56 > file.length) continue;
      const recordEnd = record + file.readUInt32LE(record);
      const flags = file.readUInt32LE(record + 8);
      const host = text(record, file.readUInt32LE(record + 16), recordEnd);
      const name = text(record, file.readUInt32LE(record + 20), recordEnd);
      const cookiePath = text(record, file.readUInt32LE(record + 24), recordEnd);
      const value = text(record, file.readUInt32LE(record + 28), recordEnd);
      const expires = file.readDoubleLE(record + 40) + MAC_EPOCH_OFFSET_SECONDS;
      if (!host || !name) continue;
      cookies.push({
        host,
        name,
        value,
        path: cookiePath || '/',
        secure: (flags & 1) !== 0,
        httpOnly: (flags & 4) !== 0,
        sameSite: 'unspecified',
        expires,
      });
    }
  }
  return cookies;
}

async function readSafari(): Promise<ImportedCookie[]> {
  let file: Buffer;
  try {
    file = await fs.readFile(SAFARI_COOKIES);
  } catch {
    throw new BrowserImportError('needs-access');
  }
  return parseBinaryCookies(file);
}

// ─── Importing ───────────────────────────────────────────────────────────────

/** Sets each cookie in the in-app browsers' jar for outside sites, skipping expired ones. */
async function store(cookies: readonly ImportedCookie[]): Promise<BrowserImportResult> {
  const target = session.fromPartition(BROWSER_TABS_PARTITION);
  const now = Date.now() / 1000;
  let imported = 0;
  let skipped = 0;
  const hosts = new Set<string>();
  for (const cookie of cookies) {
    if (cookie.expires !== undefined && cookie.expires <= now) {
      skipped += 1;
      continue;
    }
    const host = cookie.host.startsWith('.') ? cookie.host.slice(1) : cookie.host;
    try {
      await target.cookies.set({
        url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        // A host-only cookie stays one: given a domain, it would go to subdomains too.
        ...(cookie.host.startsWith('.') ? { domain: cookie.host } : {}),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        // "None" needs Secure; without it the cookie would be refused outright.
        sameSite: cookie.sameSite === 'no_restriction' && !cookie.secure ? 'unspecified' : cookie.sameSite,
        ...(cookie.expires === undefined ? {} : { expirationDate: cookie.expires }),
      });
      imported += 1;
      hosts.add(host);
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped, hosts: hosts.size };
}

/** Brings one browser profile's sign-ins — its cookies — into the in-app browsers. */
export async function importFromSource(id: string): Promise<BrowserImportResult> {
  if (process.platform !== 'darwin') throw new BrowserImportError('unsupported-platform');
  const split = id.indexOf(':');
  const browserId = split === -1 ? id : id.slice(0, split);
  const profile = split === -1 ? '' : id.slice(split + 1);

  let cookies: ImportedCookie[];
  const chromium = CHROMIUM_BROWSERS.find(browser => browser.id === browserId);
  if (chromium) {
    // A profile folder name, never a path: the id comes from the renderer.
    if (profile.includes('/') || profile.includes('..')) throw new BrowserImportError('unknown-source');
    cookies = await readChromium(chromium, profile);
  } else if (browserId === 'firefox') {
    // Only a profile Firefox itself lists.
    const known = (await firefoxProfiles()).some(candidate => candidate.dir === profile);
    if (!known) throw new BrowserImportError('unknown-source');
    cookies = await readFirefox(profile);
  } else if (browserId === 'safari') {
    cookies = await readSafari();
  } else {
    throw new BrowserImportError('unknown-source');
  }

  const result = await store(cookies);
  Logger.info('browser-import.completed', { browser: browserId, ...result });
  return result;
}

// ─── The earlier, Chrome-only calls, for dashboards that still make them ───────

export async function chromeProfileAvailable(profile = 'Default'): Promise<boolean> {
  return (await chromiumCookieFile(appSupport('Google/Chrome', profile))) !== null;
}

export async function importChromeCookies(profile = 'Default'): Promise<BrowserImportResult> {
  return importFromSource(`chrome:${profile}`);
}
