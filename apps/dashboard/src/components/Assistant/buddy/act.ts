import { voiceDebug } from '../../../services/VoiceInput/voiceDebug';
import { HIGHLIGHT, MESSAGES, SELECTORS, STOPPED, TIMING } from './constants';
import type { HiddenTarget, Peeked } from './paths';
import type { Used } from './walk';
import {
  documents,
  findControl,
  newPopup,
  readPopup,
  snapshot,
  hoverDisplayOf,
  styleOf,
  topDocument,
  type Control,
  type Snapshot,
} from './screen';

export const log = (step: string, detail = '', data?: unknown): void =>
  voiceDebug.log('route', `Buddy: ${step}`, detail, data === undefined ? {} : { data });

export interface Choice {
  id: string;
  text: string;
  el: HTMLElement;
}

interface Pressed {
  before: Snapshot;
  after: Snapshot;
  popup: HTMLElement | undefined;
}

function layer(css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const page = topDocument();
  const el = page.createElement('div');
  Object.assign(
    el.style,
    { position: 'fixed', pointerEvents: 'none', zIndex: HIGHLIGHT.layer },
    css,
  );
  page.body.appendChild(el);
  return el;
}

/** Shows what a hover class hides, as hovering its row would; returns the undo. */
export function unhide(el: HTMLElement): () => void {
  const hidden: [HTMLElement, string, string][] = [];
  for (let node: HTMLElement | null = el; node?.getClientRects().length === 0; ) {
    const shown = hoverDisplayOf(node);
    if (shown && styleOf(node).display === 'none') hidden.push([node, node.style.display, shown]);
    node = node.parentElement;
  }
  hidden.forEach(([node, , shown]) => (node.style.display = shown));
  return () => hidden.forEach(([node, display]) => (node.style.display = display));
}

const viewOf = (el: Element): typeof window => el.ownerDocument.defaultView ?? window;

function boxOf(el: Element): { top: number; left: number; width: number; height: number } {
  const { top, left, width, height } = el.getBoundingClientRect();
  const frame = viewOf(el).frameElement;
  if (!frame) return { top, left, width, height };
  const outer = boxOf(frame);
  return {
    top: top + outer.top + frame.clientTop,
    left: left + outer.left + frame.clientLeft,
    width,
    height,
  };
}

function highlight(target: HTMLElement, caption: string): () => void {
  const hide = unhide(target);
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = boxOf(target);
  const pad = HIGHLIGHT.padding;
  const ring = layer({
    top: `${box.top - pad}px`,
    left: `${box.left - pad}px`,
    width: `${box.width + pad * 2}px`,
    height: `${box.height + pad * 2}px`,
    borderRadius: '8px',
    border: '2px solid hsl(var(--primary, 0 97% 71%))',
    boxShadow: '0 0 0 4px hsl(var(--primary, 0 97% 71%) / 0.25)',
  });
  const label = layer({
    top: `${Math.max(box.top - 30, 4)}px`,
    left: `${box.left}px`,
    padding: '4px 10px',
    borderRadius: '6px',
    font: '500 12px/1.4 system-ui, sans-serif',
    background: 'hsl(var(--primary, 0 97% 71%))',
    color: 'hsl(var(--primary-foreground, 0 0% 100%))',
  });
  label.textContent = caption;
  return () => {
    ring.remove();
    label.remove();
    hide();
  };
}

function holdRings(erasers: (() => void)[], signal: AbortSignal): void {
  const clear = (): void => erasers.forEach(erase => erase());
  const timer = window.setTimeout(clear, TIMING.pointMs);
  signal.addEventListener('abort', () => {
    window.clearTimeout(timer);
    clear();
  });
}

const pause = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms));

/** Resolves once the page has been still for `quietMs`, after a cap, or once stopped. */
export const settle = (
  quietMs: number = TIMING.settleQuietMs,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise(resolve => {
    const done = (): void => {
      observer.disconnect();
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    signal?.addEventListener('abort', done);
    let quiet = window.setTimeout(done, quietMs);
    const observer = new MutationObserver(() => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(done, quietMs);
    });
    documents().forEach(doc =>
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true }),
    );
    const cap = window.setTimeout(done, TIMING.settleMaxMs);
  });

/** Pointer and mouse events, then a click, so both kinds of menu trigger respond. */
function press(el: HTMLElement): void {
  const view = viewOf(el);
  const pointer = (type: string): PointerEvent =>
    new view.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerType: 'mouse',
      isPrimary: true,
    });
  const mouse = (type: string): MouseEvent =>
    new view.MouseEvent(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(pointer('pointerdown'));
  el.dispatchEvent(mouse('mousedown'));
  // A menu trigger that opens on press is open now: a click after it can toggle it shut again.
  if (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-expanded') === 'true') {
    el.dispatchEvent(pointer('pointerup'));
    el.dispatchEvent(mouse('mouseup'));
    return;
  }
  el.dispatchEvent(pointer('pointerup'));
  el.dispatchEvent(mouse('mouseup'));
  el.click();
}

/** A menu trigger the press left shut (some open only on a real pointer): opened with Enter, which every menu trigger answers to. */
async function openByKey(el: HTMLElement): Promise<void> {
  const popup = el.getAttribute('aria-haspopup');
  if (popup === null || popup === 'false' || el.getAttribute('aria-expanded') !== 'false') return;
  const view = viewOf(el);
  const key = (type: string): KeyboardEvent =>
    new view.KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  el.focus({ preventScroll: true });
  el.dispatchEvent(key('keydown'));
  el.dispatchEvent(key('keyup'));
  await settle();
}

const movedOn = (before: Snapshot, after: Snapshot): boolean =>
  after.path !== before.path || (after.dialog && !before.dialog);

/** Waits for the page a click went to, so the next look sees it and not the old one; or until stopped. */
async function turnOver(before: Snapshot, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < TIMING.pageMaxMs && !signal.aborted) {
    await settle(TIMING.pageQuietMs, signal);
    const busy = documents().some(doc => doc.querySelector(SELECTORS.busy));
    if (!busy && turnedOver(before, snapshot())) return;
  }
}

export const turnedOver = (before: Snapshot, now: Snapshot): boolean =>
  now.path !== before.path ||
  now.shown.size !== before.shown.size ||
  [...now.shown].some(key => !before.shown.has(key));

function outcomeOf(control: Control, before: Snapshot, after: Snapshot): string {
  const opened =
    after.path !== before.path ||
    (after.dialog && !before.dialog) ||
    after.popups > before.popups ||
    control.el.getAttribute('aria-expanded') === 'true';
  if (opened) return MESSAGES.opened(control.text);
  return turnedOver(before, after) ? MESSAGES.done(control.text) : MESSAGES.clicked(control.text);
}

/** The same control as it is now; a re-render may have replaced it. */
const live = (control: Control): Control | undefined =>
  control.el.isConnected ? control : findControl(control, control.id);

async function show(control: Control, signal: AbortSignal): Promise<Pressed | null> {
  const clear = highlight(control.el, control.text);
  let before: Snapshot;
  try {
    await pause(TIMING.showBeforeClickMs);
    if (signal.aborted) {
      log('stopped', 'before the click');
      return null;
    }
    before = snapshot();
    press(control.el);
    await settle(TIMING.settleQuietMs, signal);
    if (signal.aborted) return null;
    await openByKey(control.el);
  } finally {
    clear();
  }
  log('clicked', `${control.id} "${control.text}"`);
  // A link elsewhere moves on even when the address changes only once the page has loaded.
  const leaving =
    !!control.href && !topDocument().location.pathname.endsWith(control.href.split('?')[0] ?? '');
  if (leaving || movedOn(before, snapshot())) await turnOver(before, signal);
  return { before, after: snapshot(), popup: newPopup(before) };
}

async function click(control: Control, signal: AbortSignal): Promise<Used> {
  const target = live(control);
  if (!target) return { reply: MESSAGES.gone(control.text), acted: false };
  const pressed = await show(target, signal);
  return pressed
    ? { reply: outcomeOf(target, pressed.before, pressed.after), acted: true }
    : { reply: STOPPED, acted: false };
}

function point(control: Control, signal: AbortSignal): string {
  const { el } = live(control) ?? control;
  holdRings([highlight(el, control.text)], signal);
  el.focus({ preventScroll: true });
  log('pointed at', `${control.id} "${control.text}": it changes data, so not clicked`);
  return MESSAGES.pointAt(control.text);
}

export function ask(choices: Choice[], signal: AbortSignal): string {
  holdRings(
    choices.map(c => highlight(c.el, c.text)),
    signal,
  );
  log('asked', choices.map(c => `${c.id} "${c.text}"`).join(' or '));
  return MESSAGES.whichOne(choices.map(c => c.text));
}

const popups = new WeakMap<Control, HTMLElement | undefined>();

/** Escape first, as a person would, then the opener again if the popup stayed. */
export async function close({ opener }: Peeked<Control>): Promise<void> {
  const popup = popups.get(opener);
  const isOpen = (): boolean =>
    popup?.isConnected === true || opener.el.getAttribute('aria-expanded') === 'true';
  if (!isOpen()) return;
  const view = viewOf(opener.el);
  const escape = (): KeyboardEvent =>
    new view.KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
  // Sent to the menu, not to whatever has focus: the voice stage stops the turn on Escape.
  (popup?.isConnected ? popup : opener.el).dispatchEvent(escape());
  await settle();
  if (!isOpen()) return;
  press(opener.el);
  await settle();
}

/** Opens a menu and reads what is in it, leaving it open; never clicks inside. */
export async function peek(opener: Control): Promise<Peeked<Control>> {
  const current = live(opener) ?? opener;
  const before = snapshot();
  const hide = unhide(current.el);
  press(current.el);
  await settle();
  await openByKey(current.el);
  hide();
  const popup = newPopup(before);
  popups.set(current, popup);
  const items = popup ? readPopup(popup) : [];
  log(
    'peeked',
    `${current.id} "${current.text}": ${items.length} controls`,
    items.map(i => i.label),
  );
  return { opener: current, items };
}

async function reveal(
  target: HiddenTarget<Control>,
  signal: AbortSignal,
): Promise<Control | null | undefined> {
  const opener = live(target.opener);
  if (!opener) return undefined;
  const pressed = await show(opener, signal);
  if (!pressed) return null;
  if (signal.aborted) {
    log('stopped', `after opening "${opener.text}"`);
    return null;
  }
  const item = pressed.popup && findControl(target, target.id, pressed.popup);
  if (!item) log('not found', `"${target.text}" in "${opener.text}"`);
  return item;
}

/** Uses the item in its menu: found live when the menu is still open, else after opening it again. */
export async function openHidden(
  target: HiddenTarget<Control>,
  signal: AbortSignal,
): Promise<Used> {
  const item = findControl(target, target.id) ?? (await reveal(target, signal));
  if (item === null) return { reply: STOPPED, acted: false };
  if (!item) return { reply: MESSAGES.notFound(target.text, target.opener.text), acted: false };
  return actOn(item, signal);
}

/** Clicks it, or points at it when it changes data. */
export async function actOn(control: Control, signal: AbortSignal): Promise<Used> {
  return control.use === 'click'
    ? click(control, signal)
    : { reply: point(control, signal), acted: true };
}
