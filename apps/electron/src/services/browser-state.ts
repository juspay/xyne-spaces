import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main';

/**
 * What the in-app browser keeps between runs besides its history — its open tabs
 * and each site's zoom — on this computer only, encrypted with the system's key (the
 * Keychain on a Mac), as the history is. Where no such key is available it is kept
 * in memory only, never written in the clear.
 */

const FILE_NAME = 'browser-state.bin';
const STORE_VERSION = 1;
const KEYS = ['tabs', 'zoom'] as const;
export type BrowserStateKey = (typeof KEYS)[number];
/** The most a value may take, written out: tabs and zoom are small. */
const MAX_VALUE_LENGTH = 512 * 1024;
const SAVE_DELAY_MS = 1000;

let state: Partial<Record<BrowserStateKey, unknown>> = {};
let loaded: Promise<void> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const storePath = (): string => path.join(app.getPath('userData'), FILE_NAME);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether the state is kept on disk, encrypted: not where no system key is available. */
export function keepsBrowserStateOnDisk(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export const isBrowserStateKey = (value: unknown): value is BrowserStateKey =>
  typeof value === 'string' && (KEYS as readonly string[]).includes(value);

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const sealed = await fs.readFile(storePath());
      const stored: unknown = JSON.parse(safeStorage.decryptString(sealed));
      if (!isRecord(stored) || stored['version'] !== STORE_VERSION) return;
      for (const key of KEYS) {
        // Anything written since the file was read stays.
        if (key in stored && !(key in state)) state[key] = stored[key];
      }
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return;
      log.warn('[BrowserState] Could not read the stored state; starting afresh', error);
    }
  })();
  return loaded;
}

async function save(): Promise<void> {
  try {
    const sealed = safeStorage.encryptString(JSON.stringify({ version: STORE_VERSION, ...state }));
    // Written aside, then moved over: a crash mid-write never leaves half a file.
    const target = storePath();
    const pending = `${target}.tmp`;
    await fs.writeFile(pending, sealed, { mode: 0o600 });
    await fs.rename(pending, target);
  } catch (error) {
    log.warn('[BrowserState] Could not save the state', error);
  }
}

export async function readBrowserState(key: BrowserStateKey): Promise<unknown> {
  await ensureLoaded();
  return state[key] ?? null;
}

/** Keeps a value; false for one too big to be what it says it is. */
export async function writeBrowserState(key: BrowserStateKey, value: unknown): Promise<boolean> {
  await ensureLoaded();
  const written = JSON.stringify(value);
  if (written === undefined || written.length > MAX_VALUE_LENGTH) return false;
  state = { ...state, [key]: JSON.parse(written) };
  if (!safeStorage.isEncryptionAvailable()) return true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save();
  }, SAVE_DELAY_MS);
  return true;
}
