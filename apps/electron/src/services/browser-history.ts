import { app, safeStorage, session, type WebContents } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log/main';

/**
 * Where the in-app browsers have been, for the address bar to suggest from: the
 * pages visited and the searches made, kept on this computer only.
 *
 * Recorded here, from each page's own navigations, rather than by the app's
 * windows: every in-app browser — a folder's, the browser panel, a popped-out
 * window's — is one writer, and nothing a page or a window says is taken as a
 * visit. Read back only as suggestions for what is being typed, never whole.
 *
 * Stored encrypted with the system's key (the Keychain on a Mac). Where no such
 * key is available it is kept in memory only, never written in the clear.
 */

const BROWSER_TABS_PARTITION = 'persist:browser-tabs';
const FILE_NAME = 'browser-history.bin';
const STORE_VERSION = 1;
const MAX_VISITS = 5000;
const MAX_SEARCHES = 500;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 2000;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 300;
const MAX_QUERY_LENGTH = 300;

interface Visit {
  url: string;
  title: string;
  favicon: string;
  visits: number;
  lastVisit: number;
}

interface Search {
  query: string;
  count: number;
  last: number;
}

export interface HistoryPage {
  url: string;
  title: string;
  favicon: string;
}

export interface HistorySuggestions {
  searches: string[];
  pages: HistoryPage[];
}

let visits = new Map<string, Visit>();
let searches = new Map<string, Search>();
let loaded: Promise<void> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
/** Bumped by a clear, so a save already under way doesn't put the old file back. */
let generation = 0;
/** The address each page last recorded, so a reload or a fragment isn't a new visit. */
const lastRecorded = new Map<number, string>();

const storePath = (): string => path.join(app.getPath('userData'), FILE_NAME);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readVisit(value: unknown): Visit | null {
  if (!isRecord(value)) return null;
  const { url, title, favicon, visits: count, lastVisit } = value;
  if (typeof url !== 'string' || typeof lastVisit !== 'number') return null;
  return {
    url,
    title: typeof title === 'string' ? title : '',
    favicon: typeof favicon === 'string' ? favicon : '',
    visits: typeof count === 'number' && count > 0 ? count : 1,
    lastVisit,
  };
}

function readSearch(value: unknown): Search | null {
  if (!isRecord(value)) return null;
  const { query, count, last } = value;
  if (typeof query !== 'string' || typeof last !== 'number') return null;
  return { query, count: typeof count === 'number' && count > 0 ? count : 1, last };
}

function ensureLoaded(): Promise<void> {
  loaded ??= (async () => {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const sealed = await fs.readFile(storePath());
      const stored: unknown = JSON.parse(safeStorage.decryptString(sealed));
      if (!isRecord(stored) || stored['version'] !== STORE_VERSION) return;
      const now = Date.now();
      // Merged under anything recorded while the file was being read.
      for (const entry of Array.isArray(stored['visits']) ? stored['visits'] : []) {
        const visit = readVisit(entry);
        if (visit && now - visit.lastVisit < MAX_AGE_MS && !visits.has(visit.url)) {
          visits.set(visit.url, visit);
        }
      }
      for (const entry of Array.isArray(stored['searches']) ? stored['searches'] : []) {
        const search = readSearch(entry);
        const key = search?.query.toLowerCase();
        if (search && key && now - search.last < MAX_AGE_MS && !searches.has(key)) {
          searches.set(key, search);
        }
      }
    } catch (error) {
      if (isRecord(error) && error['code'] === 'ENOENT') return;
      log.warn('[BrowserHistory] Could not read the stored history; starting afresh', error);
    }
  })();
  return loaded;
}

/** The newest `limit` of a list, by when each was last seen. */
function newest<T>(entries: Iterable<T>, at: (entry: T) => number, limit: number): T[] {
  return [...entries].sort((a, b) => at(b) - at(a)).slice(0, limit);
}

function scheduleSave(): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save();
  }, SAVE_DELAY_MS);
}

async function save(): Promise<void> {
  await ensureLoaded();
  const started = generation;
  const cutoff = Date.now() - MAX_AGE_MS;
  const keptVisits = newest(
    [...visits.values()].filter(visit => visit.lastVisit >= cutoff),
    visit => visit.lastVisit,
    MAX_VISITS,
  );
  const keptSearches = newest(
    [...searches.values()].filter(search => search.last >= cutoff),
    search => search.last,
    MAX_SEARCHES,
  );
  visits = new Map(keptVisits.map(visit => [visit.url, visit]));
  searches = new Map(keptSearches.map(search => [search.query.toLowerCase(), search]));
  try {
    const sealed = safeStorage.encryptString(
      JSON.stringify({ version: STORE_VERSION, visits: keptVisits, searches: keptSearches }),
    );
    // Written aside, then moved over: a crash mid-write never leaves half a file.
    const target = storePath();
    const pending = `${target}.tmp`;
    await fs.writeFile(pending, sealed, { mode: 0o600 });
    if (started !== generation) {
      await fs.rm(pending, { force: true });
      return;
    }
    await fs.rename(pending, target);
  } catch (error) {
    log.warn('[BrowserHistory] Could not save the history', error);
  }
}

/** A search engine's results page: the search, rather than a page to suggest. */
function searchOf(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  const isResults =
    (/^google\.[a-z.]+$/.test(host) && url.pathname === '/search') ||
    (host === 'bing.com' && url.pathname === '/search') ||
    (host === 'duckduckgo.com' && url.pathname === '/');
  const query = isResults ? url.searchParams.get('q')?.trim() : null;
  return query ? query.slice(0, MAX_QUERY_LENGTH) : null;
}

/**
 * The address as history keeps it: web pages only, without their fragment, and
 * never one carrying a name or password in it.
 */
function keptAddress(raw: string): URL | null {
  if (raw.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function recordVisit(pageId: number, raw: string): void {
  const url = keptAddress(raw);
  if (!url) return;
  const address = url.href;
  const now = Date.now();
  const query = searchOf(url);
  if (query) {
    const key = query.toLowerCase();
    const existing = searches.get(key);
    searches.set(key, { query, count: (existing?.count ?? 0) + 1, last: now });
  } else {
    const existing = visits.get(address);
    const again = lastRecorded.get(pageId) === address;
    visits.set(address, {
      url: address,
      title: existing?.title ?? '',
      favicon: existing?.favicon ?? '',
      visits: (existing?.visits ?? 0) + (again ? 0 : 1),
      lastVisit: now,
    });
  }
  lastRecorded.set(pageId, address);
  scheduleSave();
}

function notePage(raw: string, change: { title?: string; favicon?: string }): void {
  const url = keptAddress(raw);
  const visit = url ? visits.get(url.href) : undefined;
  if (!visit) return;
  if (change.title !== undefined) visit.title = change.title.slice(0, MAX_TITLE_LENGTH);
  if (change.favicon !== undefined && /^https?:\/\//.test(change.favicon)) {
    visit.favicon = change.favicon.length <= MAX_URL_LENGTH ? change.favicon : '';
  }
  scheduleSave();
}

/**
 * Records where a webview of the in-app browsers goes. Pages of Xyne's own, in
 * their own partition, are not browsing and are left out.
 */
export function trackBrowserHistory(contents: WebContents): void {
  if (contents.session !== session.fromPartition(BROWSER_TABS_PARTITION)) return;
  const pageId = contents.id;
  contents.on('did-navigate', (_event, url, httpResponseCode) => {
    // An error page is nowhere to go back to.
    if (httpResponseCode >= 400) return;
    void ensureLoaded().then(() => recordVisit(pageId, url));
  });
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) void ensureLoaded().then(() => recordVisit(pageId, url));
  });
  contents.on('page-title-updated', (_event, title) => {
    notePage(contents.getURL(), { title });
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    const [favicon] = favicons;
    if (favicon) notePage(contents.getURL(), { favicon });
  });
  contents.once('destroyed', () => lastRecorded.delete(pageId));
}

/** How much a page or search counts for: often, and lately. */
function weight(count: number, last: number, now: number): number {
  const days = (now - last) / (24 * 60 * 60 * 1000);
  return Math.log2(1 + count) / (1 + days / 7);
}

/** Pages and searches that match what is typed, best first. */
export async function suggestFromHistory(
  typed: string,
  limit: number,
): Promise<HistorySuggestions> {
  await ensureLoaded();
  const text = typed.trim().toLowerCase();
  if (!text) return { searches: [], pages: [] };
  const words = text.split(/\s+/).filter(Boolean);
  const now = Date.now();

  const matchedSearches = [...searches.values()]
    .filter(search => words.every(word => search.query.toLowerCase().includes(word)))
    .map(search => ({
      search,
      score:
        weight(search.count, search.last, now) *
        (search.query.toLowerCase().startsWith(text) ? 3 : 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(3, limit))
    .map(entry => entry.search.query);

  const pages = [...visits.values()]
    .flatMap(visit => {
      const bare = visit.url.replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
      const haystack = `${bare} ${visit.title.toLowerCase()}`;
      if (!words.every(word => haystack.includes(word))) return [];
      // A site typed from its start counts most, as it would be in a browser's bar.
      const boost = bare.startsWith(text) ? 4 : visit.title.toLowerCase().startsWith(text) ? 2 : 1;
      return [{ visit, score: weight(visit.visits, visit.lastVisit, now) * boost }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ visit }) => ({ url: visit.url, title: visit.title, favicon: visit.favicon }));

  return { searches: matchedSearches, pages };
}

/** The sites visited most, one page each, for a new tab to offer. */
export async function topSites(limit: number): Promise<HistoryPage[]> {
  await ensureLoaded();
  const now = Date.now();
  const bySite = new Map<string, { visit: Visit; score: number }>();
  for (const visit of visits.values()) {
    const site = keptAddress(visit.url)?.hostname.replace(/^www\./, '');
    if (!site) continue;
    const score = weight(visit.visits, visit.lastVisit, now);
    const current = bySite.get(site);
    // A site's score is all of its pages'; the page shown is its most visited.
    if (!current) bySite.set(site, { visit, score });
    else {
      current.score += score;
      if (visit.visits > current.visit.visits) current.visit = visit;
    }
  }
  return [...bySite.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ visit }) => ({ url: visit.url, title: visit.title, favicon: visit.favicon }));
}

/** Forgets every page and search, here and on disk. */
export async function clearBrowserHistory(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  generation += 1;
  await ensureLoaded();
  visits = new Map();
  searches = new Map();
  lastRecorded.clear();
  await fs.rm(storePath(), { force: true }).catch(error => {
    log.warn('[BrowserHistory] Could not delete the stored history', error);
  });
}
