import { setUserPreference, userPreferencesSnapshot } from '../../machines/userPreferencesMachine';
import {
  keepsBrowserStateSecurely,
  readSecureBrowserState,
  writeSecureBrowserState,
} from '../../utils/browserSecureState';
import { ask } from './ask';
import type { WebviewElement } from './BrowserWebview';

/** Chrome's zoom steps. */
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/**
 * Each site's zoom, as kept encrypted by the desktop app; null until it has been
 * read, and for good where the desktop app can't keep it — the app's preferences
 * hold it then, as they did.
 */
let siteZoom: Record<string, number> | null = null;

const siteOf = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.host : '';
  } catch {
    return '';
  }
};

/** A stored record of zooms, taken only as sites and sensible factors. */
function zoomsFrom(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && entry[1] >= 0.25 && entry[1] <= 5,
    ),
  );
}

/**
 * Reads the sites' zoom from the desktop app. Zoom kept in the app's preferences
 * before is moved over once and goes from there. Called once preferences are in.
 */
export async function loadSiteZoom(): Promise<void> {
  if (!(await keepsBrowserStateSecurely())) return;
  const stored = zoomsFrom(await readSecureBrowserState('zoom'));
  const local = userPreferencesSnapshot().browserZoom;
  const moving = Object.keys(stored).length === 0 && Object.keys(local).length > 0;
  siteZoom = moving ? zoomsFrom(local) : stored;
  if (moving) writeSecureBrowserState('zoom', siteZoom);
  if (Object.keys(local).length > 0) setUserPreference('browserZoom', {});
}

/** A site's zoom, as it was last set here; 1 for one never zoomed. */
export function zoomFor(url: string): number {
  const site = siteOf(url);
  if (!site) return 1;
  return (siteZoom ?? userPreferencesSnapshot().browserZoom)[site] ?? 1;
}

export type ZoomStep = 'in' | 'out' | 'reset';

function stepped(current: number, step: ZoomStep): number {
  if (step === 'reset') return 1;
  if (step === 'in') return STEPS.find(level => level > current + 0.001) ?? current;
  return [...STEPS].reverse().find(level => level < current - 0.001) ?? current;
}

/**
 * Zooms a page a step in or out, or back to 100%, and remembers it for the site:
 * its other pages, and the next visit, open at the same zoom.
 */
export function zoomPage(view: WebviewElement, step: ZoomStep): number {
  const url = ask(() => view.getURL(), '');
  const next = stepped(
    ask(() => view.getZoomFactor(), 1),
    step,
  );
  ask(() => view.setZoomFactor(next), undefined);
  const site = siteOf(url);
  if (!site) return next;
  // Rebuilt from its entries, the host being a key from outside; 100% isn't kept.
  const rebuilt = (zooms: Record<string, number>): Record<string, number> => {
    const kept = Object.entries(zooms).filter(([host]) => host !== site);
    return Object.fromEntries(next === 1 ? kept : [...kept, [site, next]]);
  };
  if (siteZoom !== null) {
    siteZoom = rebuilt(siteZoom);
    writeSecureBrowserState('zoom', siteZoom);
  } else {
    setUserPreference('browserZoom', rebuilt(userPreferencesSnapshot().browserZoom));
  }
  return next;
}
