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

// Reading the screen: which controls are there, what each is called and what it does.

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

/** How it shows when its row is hovered, if a hover class is what hides it. */
export const hoverDisplayOf = (el: Element): string | undefined =>
  SHOWN_ON_HOVER.exec(el.getAttribute('class') ?? '')?.[1];

/** Whether it is one of these elements; unlike `instanceof`, this holds in a frame too. */
const isTag = (el: Element, ...tags: string[]): boolean => tags.includes(el.tagName);

/** Its style, from its own window, which a frame's element needs. */
export const styleOf = (el: Element): CSSStyleDeclaration =>
  (el.ownerDocument.defaultView ?? window).getComputedStyle(el);

/** The text of the elements an aria attribute points to by id. */
const textAt = (el: HTMLElement, attribute: string): string =>
  (el.getAttribute(attribute)?.split(/\s+/) ?? [])
    .map(id => el.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

/** Its accessible description: aria-description, else the text aria-describedby points to. */
const descriptionOf = (el: HTMLElement): string =>
  (el.getAttribute('aria-description') || textAt(el, 'aria-describedby'))
    .replace(/\s+/g, ' ')
    .trim();

/** A field's own <label> text. */
const labelTextOf = (el: HTMLElement): string =>
  [...((el as Partial<HTMLInputElement>).labels ?? [])].map(label => label.innerText).join(' ');

/**
 * Its aria-label or aria-labelledby, title, <label> or first line of text; an icon button, its
 * description (tooltip).
 */
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

/** What Buddy calls it to the user: its text, else its track name. */
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
 * Hidden only until its row is hovered, as row menus are: what hides it shows on hover, and the
 * row around it is on screen. Other hidden controls (another layout's, a closed panel's) stay out.
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

/** A link's path without the workspace id. */
const pathOf = (el: HTMLElement): string | null =>
  isTag(el, 'A') ? (el as HTMLAnchorElement).pathname.replace(WORKSPACE_PREFIX, '') : null;

function kindOf(el: HTMLElement, name: string): string {
  if (isTag(el, 'A')) return 'link';
  if (isField(el)) return 'field';
  if (el.getAttribute('role') === 'tab' || /\btab\b/.test(name)) return 'tab';
  return 'button';
}

function changesData(el: HTMLElement, text: string, name: string): boolean {
  const { type, form } = el as HTMLButtonElement;
  if (isTag(el, 'BUTTON') && type === 'submit' && form) return true;
  if (isTag(el, 'A') || OPENS_UI.test(name.toLowerCase())) return false;
  // One that says it opens a menu or dialog only opens it: what the dialog does is asked there.
  const opens = el.getAttribute('aria-haspopup');
  if (opens !== null && opens !== 'false') return false;
  const inForm = el.closest(SELECTORS.form) !== null;
  return [text.toLowerCase(), name.toLowerCase()].some(
    word => CHANGES_DATA.test(word) || (inForm && FINISHES_FORM.test(word)),
  );
}

/** The rest of the row it sits in, which tells row buttons apart. */
function rowOf(el: HTMLElement): string {
  const row = el.closest<HTMLElement>(SELECTORS.row);
  return row ? clip(row.innerText.replace(el.innerText, '')) : '';
}

/**
 * What it says and what it holds, its row, where it goes, its area and whether it is where the
 * user is; the track name only when it shows no text.
 */
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
    ...(isOpener(el, use) && { opens: true }),
  };
}

/**
 * What is read as a control in a document: in one where nothing is tracked (another package's UI
 * in a frame), also what assistive tech can act on.
 */
const controlsOfDocument = (doc: Document): string =>
  [...doc.querySelectorAll<HTMLElement>('[data-track-name]')].some(isAllowed)
    ? SELECTORS.control
    : `${SELECTORS.control}, ${SELECTORS.named}`;

/** The controls on screen with a name or track, then those their rows show on hover. */
function controlsIn(root: ParentNode): HTMLElement[] {
  const selector = controlsOfDocument((root as Node).ownerDocument ?? (root as Document));
  const all = [...root.querySelectorAll<HTMLElement>(selector)].filter(
    el => trackOf(el) || textOf(el),
  );
  return [...all.filter(isUsable), ...all.filter(showsOnHover)];
}

/** The first item of each key, in order. */
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
 * Up to LIMITS.controls, in screen order: navigation first in line, so a long page (a busy
 * channel's messages) cuts its own controls, not the site map after them. A list that repeats one
 * control for every row (chats, messages) is cut to a few rows first, so the page's own controls
 * after it are still read.
 */
function capped(found: HTMLElement[]): HTMLElement[] {
  if (found.length <= LIMITS.controls) return found;
  const navigation = new Set(found.filter(el => el.closest(SELECTORS.navigation)));
  const own = new Set(
    fewOfEach(
      found.filter(el => !navigation.has(el)),
      el => trackOf(el) || textOf(el),
      LIMITS.perKind,
    ),
  );
  const kept = found.filter(el => navigation.has(el) || own.has(el));
  let room = LIMITS.controls - navigation.size;
  return kept.filter(el => navigation.has(el) || room-- > 0).slice(0, LIMITS.controls);
}

function controlsOf(found: HTMLElement[]): Control[] {
  const controls = capped(found).map((el, i) => toControl(el, `c${i}`));
  return uniqueBy(controls, control => control.label);
}

/** The documents of the same-origin frames on screen (another origin's read as null). */
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

/** The page and the frames on it, the one Buddy runs in among them. */
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

/** What the user can reach: a dialog on the page, else the page and its frames. */
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
 * A 'click' control that says it opens a menu, popover or dialog and does nothing else: a toggle or
 * a tab that also opens one (a filter's choices, say) would change something when peeked into.
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

/** The popup or dialog that opened since `before`, if any. */
export const newPopup = (before: Snapshot): HTMLElement | undefined =>
  overlays()
    .filter(el => !before.overlays.has(el))
    .pop();
