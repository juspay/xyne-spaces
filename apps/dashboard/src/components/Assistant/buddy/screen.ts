import {
  CHANGES_DATA,
  FINISHES_FORM,
  LIMITS,
  OPENS_UI,
  OWN_PANEL_TRACKS,
  SELECTORS,
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

/** Its accessible description: aria-description, else the text aria-describedby points to. */
const descriptionOf = (el: HTMLElement): string => {
  const ids = el.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
  const described = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ');
  return (el.getAttribute('aria-description') || described).replace(/\s+/g, ' ').trim();
};

/** A field's own <label> text. */
const labelTextOf = (el: HTMLElement): string =>
  'labels' in el && el.labels instanceof NodeList
    ? [...el.labels].map(label => (label as HTMLElement).innerText).join(' ')
    : '';

/**
 * Its aria-label, title, <label> or first line of text; an icon button, its description
 * (tooltip).
 */
const textOf = (el: HTMLElement): string => {
  const firstLine = (el.innerText || '').split('\n').find(line => line.trim()) ?? '';
  return clip(
    el.getAttribute('aria-label') || el.title || labelTextOf(el) || firstLine || descriptionOf(el),
  );
};

/** What Buddy calls it to the user: its text, else its track name. */
const shownTextOf = (el: HTMLElement): string => textOf(el) || humanize(trackOf(el));

const isField = (el: HTMLElement): boolean =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  el.isContentEditable;

function isUsable(el: HTMLElement): boolean {
  if (el.closest(SELECTORS.hidden) || el.matches(SELECTORS.presentational)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.type === 'password') return false;
  if (OWN_PANEL_TRACKS.has(trackOf(el))) return false;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** A link's path without the workspace id. */
const pathOf = (el: HTMLElement): string | null =>
  el instanceof HTMLAnchorElement ? el.pathname.replace(WORKSPACE_PREFIX, '') : null;

function kindOf(el: HTMLElement, name: string): string {
  if (el instanceof HTMLAnchorElement) return 'link';
  if (isField(el)) return 'field';
  if (el.getAttribute('role') === 'tab' || /\btab\b/.test(name)) return 'tab';
  return 'button';
}

function changesData(el: HTMLElement, text: string, name: string): boolean {
  if (el instanceof HTMLButtonElement && el.type === 'submit' && el.form) return true;
  if (el instanceof HTMLAnchorElement || OPENS_UI.test(name)) return false;
  const inForm = el.closest(SELECTORS.form) !== null;
  return [text.toLowerCase(), name].some(
    word => CHANGES_DATA.test(word) || (inForm && FINISHES_FORM.test(word)),
  );
}

/** The rest of the row it sits in, which tells row buttons apart. */
function rowOf(el: HTMLElement): string {
  const row = el.closest<HTMLElement>(SELECTORS.row);
  return row ? clip(row.innerText.replace(el.innerText, '')) : '';
}

/**
 * What it says and what it holds, its row, where it goes and its area; the track name only when
 * it shows no text.
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
  return {
    id,
    el,
    track,
    text: text || name,
    label: labelOf(el, text, name),
    ...(path !== null && { href: path + (el as HTMLAnchorElement).search }),
    use: isField(el) || changesData(el, text, name) ? 'point' : 'click',
  };
}

const controlsIn = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(SELECTORS.control)].filter(isUsable);

/** One control per label, in screen order. */
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

function controlsOf(found: HTMLElement[]): Control[] {
  const controls = found.slice(0, LIMITS.controls).map((el, i) => toControl(el, `c${i}`));
  return uniqueBy(controls, control => control.label);
}

const topDialog = (): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>(SELECTORS.openDialog)].filter(isUsable).pop();

/** An open dialog and the popups over it, which Radix portals outside it; else the page. */
function roots(): ParentNode[] {
  const dialog = topDialog();
  if (!dialog) return [document];
  const popups = [...document.querySelectorAll<HTMLElement>(SELECTORS.popup)].filter(
    popup => !dialog.contains(popup) && !popup.parentElement?.closest(SELECTORS.popup),
  );
  return [dialog, ...popups];
}

/** Open popups and dialogs that hold controls; tooltips share the popup wrapper but hold none. */
const overlays = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>(`${SELECTORS.popup}, ${SELECTORS.openDialog}`)].filter(
    el => isUsable(el) && el.querySelector(SELECTORS.control) !== null,
  );

/** The controls in a popup, leaving out times, counts and the like. */
export const readPopup = (popup: HTMLElement): Control[] =>
  controlsOf(controlsIn(popup)).filter(control => !VOLATILE_TEXT.test(control.text));

/** A 'click' control that says it opens a menu, popover or dialog; a bare toggle does not. */
function isOpener({ el, use }: Control): boolean {
  const popup = el.getAttribute('aria-haspopup');
  return use === 'click' && popup !== null && popup !== 'false';
}

/** Menus worth a peek, in screen order: one per track name, since row menus share one. */
function openersOf(controls: Control[]): Control[] {
  return uniqueBy(controls.filter(isOpener), opener => opener.track || opener.text);
}

/** The controls on screen, and the menus among them worth a peek. */
export function readScreen(): { controls: Control[]; openers: Control[] } {
  const controls = controlsOf(roots().flatMap(controlsIn));
  return { controls, openers: openersOf(controls) };
}

/**
 * The live control for a peeked one: by track name and text; inside its own menu, by track name
 * alone when only one has it.
 */
export function findControl(item: MenuItem, root: ParentNode, id: string): Control | undefined {
  const sameTrack = controlsIn(root).filter(el => trackOf(el) === item.track);
  const alone = root !== document && sameTrack.length === 1 ? sameTrack[0] : undefined;
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

export const snapshot = (): Snapshot => ({
  path: window.location.pathname + window.location.search,
  dialog: topDialog() !== undefined,
  popups: document.querySelectorAll(SELECTORS.popup).length,
  overlays: new Set(overlays()),
  shown: new Set(
    [...document.querySelectorAll<HTMLElement>(SELECTORS.control)]
      .filter(isUsable)
      .map(el => `${trackOf(el)}|${textOf(el)}`),
  ),
});

/** The popup or dialog that opened since `before`, if any. */
export const newPopup = (before: Snapshot): HTMLElement | undefined =>
  overlays()
    .filter(el => !before.overlays.has(el))
    .pop();
