import type { BrowserImportBrowser, BrowserImportProfile } from '../types/electron';
import { setUserPreference, userPreferencesSnapshot } from '../machines/userPreferencesMachine';
import { isElectronApp } from './electronApp';

export type { BrowserImportBrowser, BrowserImportProfile };

/** Why an import couldn't go ahead, in terms a reader can act on. */
export type BrowserImportFailure =
  | 'needs-access'
  | 'keychain-denied'
  | 'unsupported-platform'
  | 'failed';

/** What the desktop app answers an import with. */
interface ImportResponse {
  success: boolean;
  imported?: number;
  skipped?: number;
  hosts?: number;
  error?: string;
}

const failureOf = (error: string | undefined): BrowserImportFailure =>
  error === 'needs-access' || error === 'keychain-denied' || error === 'unsupported-platform'
    ? error
    : 'failed';

/** Chrome alone, as a desktop app from before browser detection can import it. */
const LEGACY_CHROME: BrowserImportBrowser = {
  browser: 'chrome',
  browserName: 'Google Chrome',
  icon: null,
};
const LEGACY_CHROME_PROFILE: BrowserImportProfile = {
  id: 'chrome:Default',
  profile: 'Default',
  account: null,
};

/**
 * The browsers on this computer whose sign-ins can be brought into Xyne's browser,
 * found without opening their data — so no permission prompt just for looking.
 * Unsupported where importing isn't possible.
 */
export async function listImportBrowsers(): Promise<{
  supported: boolean;
  browsers: BrowserImportBrowser[];
}> {
  const api = window.electronAPI;
  if (!isElectronApp() || !api) return { supported: false, browsers: [] };
  if (api.browserImportBrowsers) {
    const result = await api.browserImportBrowsers().catch(() => null);
    return result ?? { supported: true, browsers: [] };
  }
  // A desktop app from before browser detection: Chrome's main profile, on a Mac.
  if (!/Mac/i.test(navigator.userAgent) || !api.browserImportAvailable) {
    return { supported: false, browsers: [] };
  }
  const result = await api.browserImportAvailable().catch(() => null);
  return { supported: true, browsers: result?.available ? [LEGACY_CHROME] : [] };
}

/**
 * A browser's profiles. Reading them opens the browser's data, which is when macOS
 * may ask the reader to let Xyne in.
 */
export async function listImportProfiles(
  browser: string,
): Promise<
  { ok: true; profiles: BrowserImportProfile[] } | { ok: false; reason: BrowserImportFailure }
> {
  const api = window.electronAPI;
  if (api?.browserImportProfiles) {
    const result = await api.browserImportProfiles(browser).catch(() => null);
    return result?.success
      ? { ok: true, profiles: result.profiles ?? [] }
      : { ok: false, reason: failureOf(result?.error) };
  }
  return browser === LEGACY_CHROME.browser && api?.importChromeCookies
    ? { ok: true, profiles: [LEGACY_CHROME_PROFILE] }
    : { ok: false, reason: 'failed' };
}

/**
 * Brings one profile's sign-ins — its cookies — into Xyne's browser, and notes when,
 * for Preferences to show. macOS asks for the keychain password first.
 */
export async function importBrowserSignIns(
  profileId: string,
): Promise<
  { ok: true; imported: number; sites: number } | { ok: false; reason: BrowserImportFailure }
> {
  const api = window.electronAPI;
  let result: ImportResponse | null = null;
  if (api?.browserImport) {
    result = await api.browserImport(profileId).catch(() => null);
  } else if (profileId === LEGACY_CHROME_PROFILE.id && api?.importChromeCookies) {
    result = await api.importChromeCookies().catch(() => null);
  } else {
    return { ok: false, reason: 'failed' };
  }
  if (!result?.success) return { ok: false, reason: failureOf(result?.error) };
  const sites = result.hosts ?? 0;
  // Rebuilt from its entries, the profile id being a key from outside.
  const previous = userPreferencesSnapshot().browserImports;
  setUserPreference(
    'browserImports',
    Object.fromEntries([
      ...Object.entries(previous).filter(([id]) => id !== profileId),
      [profileId, { at: Date.now(), sites }],
    ]),
  );
  return { ok: true, imported: result.imported ?? 0, sites };
}

/** Signs out of every outside site in Xyne's browser and deletes their data. */
export async function clearBrowserSiteData(): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.clearSiteData) return false;
  const result = await api.clearSiteData().catch(() => null);
  if (!result?.success) return false;
  // What was imported is gone with it.
  setUserPreference('browserImports', {});
  return true;
}

/**
 * System Settings where Xyne is let into a browser's data: Files & Folders, which
 * holds the access macOS asks for on import, or Full Disk Access for Safari, whose
 * data nothing else opens.
 */
export function openBrowserAccessSettings(browser: string): void {
  void window.electronAPI
    ?.openBrowserAccessSettings?.(browser === 'safari' ? 'full-disk' : 'app-data')
    .catch(() => undefined);
}
