import {
  CHANGES_DATA,
  CURRENT,
  FINISHES_FORM,
  LIMITS,
  OPENS_UI,
  OWN_PANEL_TRACKS,
  SELECTORS,
  SHOWN_ON_HOVER,
  VOLATILE_TEXT,
  WORKSPACE_PREFIX,
} from './constants';
import type { MenuItem } from './paths';

export interface Control extends MenuItem {
  id: string;
  el: HTMLElement;
}

/** `CREATE_NEW_CHANNEL`, `createChannelOpen` → `create new channel`, `create channel open`. */
const humanize = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();

const clip = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.textLength);

const trackOf = (el: HTMLElement): string => el.getAttribute('data-track-name') ?? '';

export const hoverDisplayOf = (el: Element): string | undefined =>
  SHOWN_ON_HOVER.exec(el.getAttribute('class') ?? '')?.[1];

/** Whether it is one of these elements; unlike `instanceof`, this holds in a frame too. */
const isTag = (el: Element, ...tags: string[]): boolean => tags.includes(el.tagName);

/** Its style, from its own window, which a frame's element needs. */
export const styleOf = (el: Element): CSSStyleDeclaration =>
  (el.ownerDocument.defaultView ?? window).getComputedStyle(el);

const textAt = (el: HTMLElement, attribute: string): string =>
  (el.getAttribute(attribute)?.split(/\s+/) ?? [])
    .map(id => el.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

const descriptionOf = (el: HTMLElement): string =>
  (el.getAttribute('aria-description') || textAt(el, 'aria-describedby'))
    .replace(/\s+/g, ' ')
    .trim();

const labelTextOf = (el: HTMLElement): string =>
  [...((el as Partial<HTMLInputElement>).labels ?? [])].map(label => label.innerText).join(' ');

const textOf = (el: HTMLElement): string => {
  const firstLine = (el.innerText || '').split('\n').find(line => line.trim()) ?? '';
  return clip(
    el.getAttribute('aria-label') ||
      textAt(el, 'aria-labelledby') ||
      el.title ||
      labelTextOf(el) ||
      firstLine ||
      descriptionOf(el),
  );
};

const shownTextOf = (el: HTMLElement): string => textOf(el) || humanize(trackOf(el));

const isField = (el: HTMLElement): boolean =>
  isTag(el, 'INPUT', 'TEXTAREA', 'SELECT') || el.isContentEditable;

function isAllowed(el: HTMLElement): boolean {
  if (el.closest(SELECTORS.hidden) || el.matches(SELECTORS.presentational)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (isTag(el, 'INPUT') && (el as HTMLInputElement).type === 'password') return false;
  return !OWN_PANEL_TRACKS.has(trackOf(el));
}

/** Inside a panel collapsed to nothing, which clips it out of sight though it keeps its size. */
function inCollapsed(el: HTMLElement): boolean {
  const { body } = el.ownerDocument;
  for (let node = el.parentElement; node && node !== body; node = node.parentElement) {
    const { overflowX, overflowY } = styleOf(node);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return true;
  }
  return false;
}

function isUsable(el: HTMLElement): boolean {
  if (!isAllowed(el)) return false;
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0 || styleOf(el).visibility === 'hidden') {
    return false;
  }
  return !inCollapsed(el);
}

/**
 * Hidden only until its row is hovered, as row menus are; other hidden controls (another layout's,
 * a closed panel's) stay out.
 */
function showsOnHover(el: HTMLElement): boolean {
  if (!isAllowed(el)) return false;
  let node: HTMLElement | null = el;
  let hidden = false;
  for (; node && node.getClientRects().length === 0; node = node.parentElement) {
    if (styleOf(node).display !== 'none') continue;
    if (!hoverDisplayOf(node)) return false;
    hidden = true;
  }
  return hidden && node !== null && node !== el.ownerDocument.body && !inCollapsed(node);
}

/** A link that leaves the app or opens a new tab: Buddy neither follows nor walks into it. */
const leavesApp = (el: HTMLElement): boolean => {
  if (!isTag(el, 'A')) return false;
  const link = el as HTMLAnchorElement;
  if (!link.getAttribute('href')) return false;
  return link.origin !== el.ownerDocument.location.origin || link.target === '_blank';
};

const pathOf = (el: HTMLElement): string | null =>
  isTag(el, 'A') && !leavesApp(el)
    ? (el as HTMLAnchorElement).pathname.replace(WORKSPACE_PREFIX, '')
    : null;

function kindOf(el: HTMLElement, name: string): string {
  if (isTag(el, 'A')) return 'link';
  if (isField(el)) return 'field';
  if (el.getAttribute('role') === 'tab' || /\btab\b/.test(name)) return 'tab';
  return 'button';
}

function changesData(el: HTMLElement, text: string, name: string): boolean {
  const { type, form } = el as HTMLButtonElement;
  if (isTag(el, 'BUTTON') && type === 'submit' && form) return true;
  // Another site or a new tab is the user's to open.
  if (leavesApp(el)) return true;
  if (isTag(el, 'A') || OPENS_UI.test(name.toLowerCase())) return false;
  // One that says it opens a menu or dialog only opens it: what the dialog does is asked there.
  const opens = el.getAttribute('aria-haspopup');
  if (opens !== null && opens !== 'false') return false;
  const inForm = el.closest(SELECTORS.form) !== null;
  return [text.toLowerCase(), name.toLowerCase()].some(
    word => CHANGES_DATA.test(word) || (inForm && FINISHES_FORM.test(word)),
  );
}

function rowOf(el: HTMLElement): string {
  const row = el.closest<HTMLElement>(SELECTORS.row);
  return row ? clip(row.innerText.replace(el.innerText, '')) : '';
}

/** Text, row, destination, area and whether it is current; the track name only when it shows no text. */
function labelOf(el: HTMLElement, text: string, name: string): string {
  const about = descriptionOf(el);
  const row = rowOf(el);
  const path = pathOf(el);
  const area = humanize(el.getAttribute('data-track-category') ?? '');
  return [
    kindOf(el, name),
    text ? `"${text}"` : name,
    about && about !== text && `(${about})`,
    row && `in "${row}"`,
    path && `(goes to ${path})`,
    area && `(${area})`,
    el.closest(SELECTORS.current) && CURRENT,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, LIMITS.labelLength);
}

function toControl(el: HTMLElement, id: string): Control {
  const track = trackOf(el);
  const name = humanize(track);
  const text = textOf(el);
  const path = pathOf(el);
  const use = isField(el) || changesData(el, text, name) ? 'point' : 'click';
  return {
    id,
    el,
    track,
    text: text || name,
    label: labelOf(el, text, name),
    ...(path !== null && { href: path + (el as HTMLAnchorElement).search }),
    use,
    ...(isOpener(el, use) && {
      opens: el.getAttribute('aria-haspopup') === 'dialog' ? 'dialog' : 'menu',
    }),
    ...(el.matches(SELECTORS.selectable) && { toggles: true as const }),
  };
}

const controlsOfDocument = (doc: Document): string =>
  [...doc.querySelectorAll<HTMLElement>('[data-track-name]')].some(isAllowed)
    ? SELECTORS.control
    : `${SELECTORS.control}, ${SELECTORS.named}`;

function controlsIn(root: ParentNode): HTMLElement[] {
  const selector = controlsOfDocument((root as Node).ownerDocument ?? (root as Document));
  const all = [...root.querySelectorAll<HTMLElement>(selector)].filter(
    el => trackOf(el) || textOf(el),
  );
  return [...all.filter(isUsable), ...all.filter(showsOnHover)];
}

const uniqueBy = <T>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Keeps the first `most` of each kind, in order: what a long list repeats is cut, not what follows. */
export function fewOfEach<T>(items: T[], kindOf: (item: T) => string, most: number): T[] {
  const counts = new Map<string, number>();
  return items.filter(item => {
    const kind = kindOf(item);
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return count <= most;
  });
}

/**
 * The most rows of one kind that fit, cutting the largest kinds first so a long list of chats
 * gives way before the channel list or the page's own controls do.
 */
export function fairShare(counts: number[], room: number): number {
  for (let most = Math.max(0, ...counts); most > 1; most--) {
    if (counts.reduce((sum, count) => sum + Math.min(count, most), 0) <= room) return most;
  }
  return 1;
}

/**
 * Up to LIMITS.controls, in screen order, navigation first so a long page cannot cut the site map.
 * Past that, the longest lists repeating one control per row (chats, messages) are cut first.
 */
function capped(found: HTMLElement[]): HTMLElement[] {
  if (found.length <= LIMITS.controls) return found;
  const navigation = new Set(found.filter(el => el.closest(SELECTORS.navigation)));
  const own = found.filter(el => !navigation.has(el));
  const kindOf = (el: HTMLElement): string => trackOf(el) || textOf(el);
  const counts = new Map<string, number>();
  own.forEach(el => counts.set(kindOf(el), (counts.get(kindOf(el)) ?? 0) + 1));
  const room = LIMITS.controls - navigation.size;
  const kept = new Set(fewOfEach(own, kindOf, fairShare([...counts.values()], room)));
  return found.filter(el => navigation.has(el) || kept.has(el)).slice(0, LIMITS.controls);
}

function controlsOf(found: HTMLElement[]): Control[] {
  const controls = capped(found).map((el, i) => toControl(el, `c${i}`));
  return uniqueBy(controls, control => control.label);
}

function framesIn(doc: Document): Document[] {
  return [...doc.querySelectorAll('iframe')].flatMap(frame => {
    const inner = isUsable(frame) ? frame.contentDocument : null;
    return inner?.body ? [inner, ...framesIn(inner)] : [];
  });
}

/**
 * The page the user sees. Buddy may run inside one of its frames (a lane that ships its own Ask
 * AI), so it reads the top window's page when it may.
 */
export function topDocument(view: Pick<Window, 'top' | 'document'> = window): Document {
  try {
    return view.top?.document ?? view.document;
  } catch {
    return view.document; // the top window is from another origin
  }
}

export const documents = (): [Document, ...Document[]] => {
  const page = topDocument();
  return [page, ...framesIn(page)];
};

const topDialog = (doc: Document): HTMLElement | undefined =>
  [...doc.querySelectorAll<HTMLElement>(SELECTORS.openDialog)].filter(isUsable).pop();

/** An open dialog and the popups over it, which Radix portals outside it; else the document. */
function rootsIn(doc: Document): ParentNode[] {
  const dialog = topDialog(doc);
  if (!dialog) return [doc];
  const popups = [...doc.querySelectorAll<HTMLElement>(SELECTORS.popup)].filter(
    popup => !dialog.contains(popup) && !popup.parentElement?.closest(SELECTORS.popup),
  );
  return [dialog, ...popups];
}

function roots(): ParentNode[] {
  const [page, ...frames] = documents();
  const reachable = rootsIn(page);
  return reachable[0] === page ? [page, ...frames.flatMap(rootsIn)] : reachable;
}

/** Open popups and dialogs that hold controls; tooltips share the popup wrapper but hold none. */
const overlays = (): HTMLElement[] =>
  documents().flatMap(doc => {
    const controls = controlsOfDocument(doc);
    return [
      ...doc.querySelectorAll<HTMLElement>(`${SELECTORS.popup}, ${SELECTORS.openDialog}`),
    ].filter(el => isUsable(el) && el.querySelector(controls) !== null);
  });

/** The controls in a popup, leaving out times, counts and the like. */
export const readPopup = (popup: HTMLElement): Control[] =>
  controlsOf(controlsIn(popup)).filter(control => !VOLATILE_TEXT.test(control.text));

/**
 * An opener that does nothing else: a toggle or tab that also opens a menu (a filter's choices)
 * would change something when peeked into.
 */
function isOpener(el: HTMLElement, use: Control['use']): boolean {
  const popup = el.getAttribute('aria-haspopup');
  return (
    use === 'click' && popup !== null && popup !== 'false' && !el.matches(SELECTORS.selectable)
  );
}

/** The controls on screen, and the menus among them worth a peek. */
export function readScreen(): { controls: Control[]; openers: Control[] } {
  const controls = controlsOf(roots().flatMap(controlsIn));
  return { controls, openers: controls.filter(control => control.opens) };
}

/**
 * The live control for a peeked one, in `menu` or anywhere: by track name and text; inside its
 * own menu, by track name alone when only one has it.
 */
export function findControl(item: MenuItem, id: string, menu?: ParentNode): Control | undefined {
  const sameTrack = (menu ? [menu] : documents())
    .flatMap(controlsIn)
    .filter(el => trackOf(el) === item.track);
  const alone = menu && sameTrack.length === 1 ? sameTrack[0] : undefined;
  const el = sameTrack.find(e => shownTextOf(e) === item.text) ?? alone;
  return el && toControl(el, id);
}

export interface Snapshot {
  path: string;
  dialog: boolean;
  popups: number;
  overlays: Set<HTMLElement>;
  shown: Set<string>;
}

export const snapshot = (): Snapshot => {
  const docs = documents();
  return {
    path: docs.map(doc => doc.location.pathname + doc.location.search).join(' '),
    dialog: docs.some(doc => topDialog(doc) !== undefined),
    popups: docs.reduce((n, doc) => n + doc.querySelectorAll(SELECTORS.popup).length, 0),
    overlays: new Set(overlays()),
    shown: new Set(docs.flatMap(controlsIn).map(el => `${trackOf(el)}|${textOf(el)}`)),
  };
};

export const newPopup = (before: Snapshot): HTMLElement | undefined =>
  overlays()
    .filter(el => !before.overlays.has(el))
    .pop();
