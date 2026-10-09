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

// Doing things on screen: ringing, clicking, pointing, and peeking into menus.

export const log = (step: string, detail = '', data?: unknown): void =>
  voiceDebug.log('route', `Buddy: ${step}`, detail, data === undefined ? {} : { data });

/** Where to show a choice: the control, or the opener of the menu it is in. */
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

/**
 * Shows what a hover class hides around a control, with the display that class gives, as hovering
 * its row would; returns the undo. A menu trigger stays shown by itself while its menu is open.
 */
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

/** Where it is on the page, counting the frames it is in. */
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

/** Rings the control with a caption; returns the eraser. */
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

/** Keeps rings up for a while, or until the next request. */
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

/**
 * A menu trigger the press left shut: some open only on a real pointer, so it is opened as a
 * keyboard user would, with Enter, which every menu trigger answers to.
 */
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

/** Whether a click took the user to another page or opened a dialog, which may load a while. */
const movedOn = (before: Snapshot, after: Snapshot): boolean =>
  after.path !== before.path || (after.dialog && !before.dialog);

/**
 * Waits for the page a click went to, so the next look sees it and not the one before: until the
 * address or the controls shown are no longer the old ones, nothing says it is loading, and it
 * holds still; or until stopped.
 */
async function turnOver(before: Snapshot, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < TIMING.pageMaxMs && !signal.aborted) {
    await settle(TIMING.pageQuietMs, signal);
    const busy = documents().some(doc => doc.querySelector(SELECTORS.busy));
    if (!busy && turnedOver(before, snapshot())) return;
  }
}

/** The address or the controls shown are no longer what they were. */
export const turnedOver = (before: Snapshot, now: Snapshot): boolean =>
  now.path !== before.path ||
  now.shown.size !== before.shown.size ||
  [...now.shown].some(key => !before.shown.has(key));

/** Opened something, changed the screen, or changed nothing. */
function outcomeOf(control: Control, before: Snapshot, after: Snapshot): string {
  const opened =
    after.path !== before.path ||
    (after.dialog && !before.dialog) ||
    after.popups > before.popups ||
    control.el.getAttribute('aria-expanded') === 'true';
  if (opened) return MESSAGES.opened(control.text);
  return turnedOver(before, after)
    ? MESSAGES.done(control.text)
    : MESSAGES.alreadyOpen(control.text);
}

/** The same control on the screen as it is now, which a re-render may have replaced. */
const live = (control: Control): Control | undefined =>
  control.el.isConnected ? control : findControl(control, control.id);

/** Rings it, then presses it once the user has seen it; null when stopped first. */
async function show(control: Control, signal: AbortSignal): Promise<Pressed | null> {
  const clear = highlight(control.el, control.text);
  await pause(TIMING.showBeforeClickMs);
  if (signal.aborted) {
    clear();
    log('stopped', 'before the click');
    return null;
  }
  const before = snapshot();
  press(control.el);
  await settle(TIMING.settleQuietMs, signal);
  await openByKey(control.el);
  clear();
  log('clicked', `${control.id} "${control.text}"`);
  // A link elsewhere moves on even when the address changes only once the page has loaded.
  const leaving =
    !!control.href && !topDocument().location.pathname.endsWith(control.href.split('?')[0] ?? '');
  if (leaving || movedOn(before, snapshot())) await turnOver(before, signal);
  return { before, after: snapshot(), popup: newPopup(before) };
}

async function click(control: Control, signal: AbortSignal): Promise<string> {
  const target = live(control) ?? control;
  const pressed = await show(target, signal);
  return pressed ? outcomeOf(target, pressed.before, pressed.after) : STOPPED;
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

/** The popup each peeked menu opened, so it can be closed again. */
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
  opener.el.ownerDocument.activeElement?.dispatchEvent(escape());
  await settle();
  if (!isOpen()) return;
  press(opener.el);
  await settle();
}

/** Opens a menu and reads what is in it, leaving it open; never clicks inside. */
export async function peek(opener: Control): Promise<Peeked<Control>> {
  const before = snapshot();
  const hide = unhide(opener.el);
  press(opener.el);
  await settle();
  await openByKey(opener.el);
  hide();
  const popup = newPopup(before);
  popups.set(opener, popup);
  const items = popup ? readPopup(popup) : [];
  log(
    'peeked',
    `${opener.id} "${opener.text}": ${items.length} controls`,
    items.map(i => i.label),
  );
  return { opener, items };
}

/** Opens the item's menu and finds the item live in it; null when stopped. */
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
  const reply = control.use === 'click' ? await click(control, signal) : point(control, signal);
  return { reply, acted: reply !== STOPPED };
}
