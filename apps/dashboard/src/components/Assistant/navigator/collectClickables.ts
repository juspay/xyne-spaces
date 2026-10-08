import { NAV_ITEMS as AI_NAV_ITEMS } from '../../AIScreen/AISidebar';

// Marks the navigator's own UI so it never offers itself as a click target.
export const NAVIGATOR_ROOT_ATTR = 'data-navigator-root';

const CLICKABLE_SELECTOR = [
  '[data-track-name]',
  'a[href]',
  'button',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
].join(',');

const NAV_CONTAINER_SELECTOR =
  'nav, aside, [role="navigation"], [role="tablist"], [role="menu"], [data-sidebar]';

// The navigator only moves around the app; it must never act on the user's behalf. That covers
// creating things too: "New Canvas" made a fresh canvas on every click until this listed it.
const ACTS_ON_DATA =
  /\b(delete|remove|log ?out|sign ?out|send|submit|pay|archive|leave|discard|revoke|deactivate|kick|ban|block|reset|clear|unsubscribe|uninstall|disconnect|confirm|new|create|add|start|schedule|invite|upload|import|duplicate|copy|share|join|call|record|compose|generate|publish|save|post|reply|react|pin|unpin|star|unstar|bookmark|mute|unmute|follow|unfollow|subscribe|approve|reject|assign|rename|edit|move|restore|retry|run|install|connect|enable|disable)\b/i;

// `\b` treats `_` as part of a word, so "Create_Canvas" never matched "create"; split
// snake_case, kebab-case and camelCase into plain words before testing.
const asWords = (text: string): string =>
  text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./]+/g, ' ');

const actsOnData = (label: string, trackName: string): boolean =>
  ACTS_ON_DATA.test(asWords(label)) || ACTS_ON_DATA.test(asWords(trackName));

// The navigator can click but not type, so a text field is a dead end: clicking one only
// focuses it. Search boxes are often a wrapper div around the field, hence the label check.
const TYPING_FIELD_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), ' +
  'textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]';
const SEARCH_FIELD = /\bsearch\b.*\b(input|field|box|bar)\b|\b(input|field)\b.*\bsearch\b/i;

const isTypingField = (element: HTMLElement, label: string, trackName: string): boolean =>
  element.matches(TYPING_FIELD_SELECTOR) ||
  element.querySelector(TYPING_FIELD_SELECTOR) !== null ||
  SEARCH_FIELD.test(label) ||
  SEARCH_FIELD.test(trackName.replace(/_/g, ' '));

const MAX_CANDIDATES = 150;
const MAX_LABEL_CHARS = 80;

// What a top-level section holds, keyed by its first path segment after the workspace id.
// Jev only sees this screen, so without it nothing says "Agent Hub" lives under "Xyne AI".
const SECTION_CONTENTS: Record<string, readonly string[]> = {
  ai: ['Ask AI chat', ...AI_NAV_ITEMS.map(item => item.label)],
};

const sectionContents = (path: string | null): string | null => {
  if (!path) return null;
  const segments = path.split('?')[0]?.split('/').filter(Boolean) ?? [];
  // Only links to a section's root: /<workspaceId>/<section>.
  if (segments.length !== 2 || !segments[1]) return null;
  const contents = SECTION_CONTENTS[segments[1]];
  return contents ? `contains ${contents.join(', ')}` : null;
};

export interface Clickable {
  id: string;
  description: string;
  element: HTMLElement;
}

export interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
}

const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const metadataLabel = (element: HTMLElement): string => {
  const raw = element.getAttribute('data-track-metadata');
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const { label, name, title } = parsed as Record<string, unknown>;
      const value = [label, name, title].find(v => typeof v === 'string');
      return typeof value === 'string' ? clean(value) : '';
    }
  } catch {
    // Not JSON: ignore it, the other signals are enough.
  }
  return '';
};

const labelOf = (element: HTMLElement): string => {
  const firstLine = clean(element.innerText?.split('\n').find(line => line.trim()));
  const iconAlt = element.querySelector('img[alt]')?.getAttribute('alt');
  return truncate(
    clean(element.getAttribute('aria-label')) ||
      firstLine ||
      clean(element.getAttribute('title')) ||
      metadataLabel(element) ||
      clean(iconAlt),
    MAX_LABEL_CHARS,
  );
};

const isVisible = (element: HTMLElement): boolean => {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom <= 0 || rect.right <= 0) return false;
  if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
};

const isDisabled = (element: HTMLElement): boolean =>
  element.hasAttribute('disabled') ||
  element.getAttribute('aria-disabled') === 'true' ||
  element.closest('[aria-hidden="true"], [inert]') !== null;

const hrefPath = (element: HTMLElement): string | null => {
  const anchor = element.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  try {
    const url = new URL(anchor.href, window.location.href);
    // Leaving the app or opening a new tab is out of scope.
    if (url.origin !== window.location.origin || anchor.target === '_blank') return '';
    return url.pathname + url.search;
  } catch {
    return '';
  }
};

// When a modal is open only its contents are reachable, so only offer those.
const scopeRoot = (): ParentNode => {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'),
  ).filter(dialog => !dialog.closest(`[${NAVIGATOR_ROOT_ATTR}]`) && isVisible(dialog));
  return dialogs.at(-1) ?? document;
};

/** The visible, safe-to-click elements on screen, each with a description Jev can read. */
export function collectClickables(): Clickable[] {
  const seen = new Set<string>();
  const nav: Omit<Clickable, 'id'>[] = [];
  const rest: Omit<Clickable, 'id'>[] = [];

  for (const element of scopeRoot().querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)) {
    if (element.closest(`[${NAVIGATOR_ROOT_ATTR}]`)) continue;
    if (isDisabled(element) || !isVisible(element)) continue;
    // A clickable wrapping another clickable: keep the inner one, it carries the real handler.
    if (element.querySelector(CLICKABLE_SELECTOR)) {
      const inner = element.querySelector<HTMLElement>(CLICKABLE_SELECTOR);
      if (inner && isVisible(inner) && labelOf(inner) === labelOf(element)) continue;
    }
    if (element instanceof HTMLButtonElement && element.type === 'submit' && element.form) {
      continue;
    }

    const label = labelOf(element);
    const trackName = element.getAttribute('data-track-name') ?? '';
    const trackCategory = element.getAttribute('data-track-category') ?? '';
    if (!label && !trackName) continue;
    if (actsOnData(label, trackName)) continue;
    if (isTypingField(element, label, trackName)) continue;

    const path = hrefPath(element);
    if (path === '') continue;

    const inNav = element.closest(NAV_CONTAINER_SELECTOR) !== null;
    const role = element.getAttribute('role');
    const contents = sectionContents(path);
    const parts = [label || trackName.toLowerCase().replace(/_/g, ' ')];
    if (path) parts.push(`link to ${path}`);
    else if (role === 'tab') parts.push('tab');
    else if (role === 'menuitem') parts.push('menu item');
    else parts.push('button');
    if (trackCategory || trackName) {
      parts.push(`(${[trackCategory, trackName].filter(Boolean).join(' / ')})`);
    }
    if (contents) parts.push(contents);
    if (inNav) parts.push('[navigation]');
    if (
      element.getAttribute('aria-current') === 'page' ||
      element.getAttribute('aria-selected') === 'true'
    ) {
      parts.push('[currently selected]');
    }
    const description = parts.join(' — ');

    if (seen.has(description)) continue;
    seen.add(description);
    (inNav || path ? nav : rest).push({ description, element });
  }

  return [...nav, ...rest]
    .slice(0, MAX_CANDIDATES)
    .map((clickable, index) => ({ ...clickable, id: `c${index}` }));
}

/** What Jev reads to decide whether the user has arrived. */
export function snapshotPage(): PageSnapshot {
  const visibleText = (selector: string): string[] =>
    Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(el => !el.closest(`[${NAVIGATOR_ROOT_ATTR}]`) && isVisible(el))
      .map(el => truncate(clean(el.innerText), 120))
      .filter(Boolean);

  const headings = [
    ...visibleText('h1, h2'),
    ...visibleText('[aria-current="page"]').map(text => `selected nav: ${text}`),
    ...visibleText('[role="tab"][aria-selected="true"]').map(text => `selected tab: ${text}`),
  ];

  return {
    url: window.location.pathname + window.location.search,
    title: truncate(clean(document.title), 200),
    headings: Array.from(new Set(headings)).slice(0, 20),
  };
}

// Spinners, progress bars and skeletons: the screen is still filling in while one is showing.
const LOADING_SELECTOR =
  '[aria-busy="true"], [role="progressbar"], [data-loading="true"], .animate-spin, .animate-pulse';

/**
 * A short description of the first visible loading indicator, or null when there is none.
 * `animate-pulse` also drives small status dots that pulse forever, so it only counts at
 * skeleton size.
 */
export function findLoadingIndicator(): string | null {
  for (const element of document.querySelectorAll<HTMLElement>(LOADING_SELECTOR)) {
    if (element.closest(`[${NAVIGATOR_ROOT_ATTR}]`) || !isVisible(element)) continue;
    if (element.classList.contains('animate-pulse')) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 8) continue;
    }
    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('role') ||
      element.getAttribute('class')?.split(' ').slice(0, 3).join(' ') ||
      element.tagName.toLowerCase();
    return truncate(clean(label), 80);
  }
  return null;
}
