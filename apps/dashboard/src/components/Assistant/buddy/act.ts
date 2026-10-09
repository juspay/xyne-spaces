import { voiceDebug } from '../../../services/VoiceInput/voiceDebug';
import { HIGHLIGHT, MESSAGES, STOPPED, TIMING } from './constants';
import type { HiddenTarget, Peeked } from './paths';
import { findControl, newPopup, readPopup, snapshot, type Control, type Snapshot } from './screen';

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
  const el = document.createElement('div');
  Object.assign(
    el.style,
    { position: 'fixed', pointerEvents: 'none', zIndex: HIGHLIGHT.layer },
    css,
  );
  document.body.appendChild(el);
  return el;
}

/** Rings the control with a caption; returns the eraser. */
function highlight(target: HTMLElement, caption: string): () => void {
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const box = target.getBoundingClientRect();
  const pad = HIGHLIGHT.padding;
  const ring = layer({
    top: `${box.top - pad}px`,
    left: `${box.left - pad}px`,
    width: `${box.width + pad * 2}px`,
    height: `${box.height + pad * 2}px`,
    borderRadius: '8px',
    border: '2px solid hsl(var(--primary))',
    boxShadow: '0 0 0 4px hsl(var(--primary) / 0.25)',
  });
  const label = layer({
    top: `${Math.max(box.top - 30, 4)}px`,
    left: `${box.left}px`,
    padding: '4px 10px',
    borderRadius: '6px',
    font: '500 12px/1.4 system-ui, sans-serif',
    background: 'hsl(var(--primary))',
    color: 'hsl(var(--primary-foreground))',
  });
  label.textContent = caption;
  return () => {
    ring.remove();
    label.remove();
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

/** Resolves once the page has been still for a moment, or after a cap. */
const settle = (): Promise<void> =>
  new Promise(resolve => {
    const done = (): void => {
      observer.disconnect();
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      resolve();
    };
    let quiet = window.setTimeout(done, TIMING.settleQuietMs);
    const observer = new MutationObserver(() => {
      window.clearTimeout(quiet);
      quiet = window.setTimeout(done, TIMING.settleQuietMs);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const cap = window.setTimeout(done, TIMING.settleMaxMs);
  });

/** Pointer and mouse events, then a click, so both kinds of menu trigger respond. */
function press(el: HTMLElement): void {
  const pointer = (type: string): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerType: 'mouse',
      isPrimary: true,
    });
  el.dispatchEvent(pointer('pointerdown'));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(pointer('pointerup'));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.click();
}

/** Opened something, changed the screen, or changed nothing. */
function outcomeOf(control: Control, before: Snapshot, after: Snapshot): string {
  const opened =
    after.path !== before.path ||
    (after.dialog && !before.dialog) ||
    after.popups > before.popups ||
    control.el.getAttribute('aria-expanded') === 'true';
  if (opened) return MESSAGES.opened(control.text);
  const changed =
    after.shown.size !== before.shown.size || [...after.shown].some(key => !before.shown.has(key));
  return changed ? MESSAGES.done(control.text) : MESSAGES.alreadyOpen(control.text);
}

/** The same control on the screen as it is now, which a re-render may have replaced. */
const live = (control: Control): Control | undefined =>
  control.el.isConnected ? control : findControl(control, document, control.id);

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
  await settle();
  clear();
  log('clicked', `${control.id} "${control.text}"`);
  return { before, after: snapshot(), popup: newPopup(before) };
}

export async function click(control: Control, signal: AbortSignal): Promise<string> {
  const target = live(control) ?? control;
  const pressed = await show(target, signal);
  return pressed ? outcomeOf(target, pressed.before, pressed.after) : STOPPED;
}

export function point(control: Control, signal: AbortSignal): string {
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
  const escape = (): KeyboardEvent =>
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
  document.activeElement?.dispatchEvent(escape());
  await settle();
  if (!isOpen()) return;
  press(opener.el);
  await settle();
}

/** Opens a menu and reads what is in it, leaving it open; never clicks inside. */
export async function peek(opener: Control): Promise<Peeked<Control>> {
  const before = snapshot();
  press(opener.el);
  await settle();
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
  const item = pressed.popup && findControl(target, pressed.popup, target.id);
  if (!item) log('not found', `"${target.text}" in "${opener.text}"`);
  return item;
}

/** Uses the item in its menu: found live when the menu is still open, else after opening it again. */
export async function openHidden(
  target: HiddenTarget<Control>,
  signal: AbortSignal,
): Promise<string> {
  const item = findControl(target, document, target.id) ?? (await reveal(target, signal));
  if (item === null) return STOPPED;
  if (!item) return MESSAGES.notFound(target.text, target.opener.text);
  return item.use === 'click' ? click(item, signal) : point(item, signal);
}
