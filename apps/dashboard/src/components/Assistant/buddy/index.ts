import { routeWithJev } from '../../../services/assistantRouteService';
import { voiceDebug } from '../../../services/VoiceInput/voiceDebug';
import {
  CHANGES_DATA,
  FINISHES_FORM,
  HIGHLIGHT,
  LIMITS,
  MESSAGES,
  OPENS_UI,
  OWN_PANEL_TRACKS,
  SELECTORS,
  TIMING,
  WORKSPACE_PREFIX,
} from './constants';
import { decide } from './decide';
import { groupControls } from './options';

// Buddy reads the tracked controls on screen, lets Jev pick the one the user asked for, and
// clicks it when it only opens something, or highlights it when it would change data.

interface Control {
  id: string;
  el: HTMLElement;
  track: string;
  /** What Buddy calls it to the user. */
  text: string;
  /** What Jev reads. */
  label: string;
  href?: string;
  use: 'click' | 'point';
}

/** Returned for a request that a newer one or Stop replaced: handled, nothing to say. */
const STOPPED = '';

const log = (step: string, detail = '', data?: unknown): void =>
  voiceDebug.log('route', `Buddy: ${step}`, detail, data === undefined ? {} : { data });

const traceOf = ({ id, use, label, track }: Control): Partial<Control> => ({
  id,
  use,
  label,
  track,
});

/** `CREATE_NEW_CHANNEL`, `createChannelOpen` → `create new channel`, `create channel open`. */
const humanize = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();

const clip = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.textLength);

/** Its aria-label, title, or first line of text. */
const textOf = (el: HTMLElement): string => {
  const firstLine = (el.innerText || '').split('\n').find(line => line.trim()) ?? '';
  return clip(el.getAttribute('aria-label') || el.title || firstLine);
};

const isField = (el: HTMLElement): boolean =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement ||
  el.isContentEditable;

function isUsable(el: HTMLElement): boolean {
  if (el.closest(SELECTORS.hidden) || (el as HTMLButtonElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.type === 'password') return false;
  if (OWN_PANEL_TRACKS.has(el.getAttribute('data-track-name') ?? '')) return false;
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

/** What it says, its row, where it goes and its area; the track name only when it shows no text. */
function labelOf(el: HTMLElement, text: string, name: string): string {
  const row = rowOf(el);
  const path = pathOf(el);
  const area = humanize(el.getAttribute('data-track-category') ?? '');
  return [
    kindOf(el, name),
    text ? `"${text}"` : name,
    row && `in "${row}"`,
    path && `(goes to ${path})`,
    area && `(${area})`,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, LIMITS.labelLength);
}

/** An open dialog, else the page. */
const scope = (): ParentNode =>
  [...document.querySelectorAll<HTMLElement>(SELECTORS.openDialog)].filter(isUsable).pop() ??
  document;

function toControl(el: HTMLElement, index: number): Control {
  const track = el.getAttribute('data-track-name') ?? '';
  const name = humanize(track);
  const text = textOf(el);
  const path = pathOf(el);
  return {
    id: `c${index}`,
    el,
    track,
    text: text || name,
    label: labelOf(el, text, name),
    ...(path !== null && { href: path + (el as HTMLAnchorElement).search }),
    use: isField(el) || changesData(el, text, name) ? 'point' : 'click',
  };
}

function readScreen(): Control[] {
  const found = [...scope().querySelectorAll<HTMLElement>(SELECTORS.tracked)].filter(isUsable);
  const controls = found.slice(0, LIMITS.controls).map(toControl);
  return controls.filter((control, i) => controls.findIndex(c => c.label === control.label) === i);
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

interface Snapshot {
  path: string;
  dialog: boolean;
  popups: number;
  shown: Set<string>;
}

const snapshot = (): Snapshot => ({
  path: window.location.pathname + window.location.search,
  dialog: scope() !== document,
  popups: document.querySelectorAll(SELECTORS.popup).length,
  shown: new Set(
    [...document.querySelectorAll<HTMLElement>(SELECTORS.tracked)]
      .filter(isUsable)
      .map(el => `${el.getAttribute('data-track-name') ?? ''}|${textOf(el)}`),
  ),
});

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

async function click(control: Control, signal: AbortSignal): Promise<string> {
  const clear = highlight(control.el, control.text);
  await pause(TIMING.showBeforeClickMs);
  if (signal.aborted) {
    clear();
    log('stopped', 'before the click');
    return STOPPED;
  }
  const before = snapshot();
  press(control.el);
  await settle();
  clear();
  log('clicked', `${control.id} "${control.text}"`);
  return outcomeOf(control, before, snapshot());
}

function point(control: Control, signal: AbortSignal): string {
  holdRings([highlight(control.el, control.text)], signal);
  control.el.focus({ preventScroll: true });
  log('pointed at', `${control.id} "${control.text}": it changes data, so not clicked`);
  return MESSAGES.pointAt(control.text);
}

function ask(a: Control, b: Control, signal: AbortSignal): string {
  holdRings([highlight(a.el, a.text), highlight(b.el, b.text)], signal);
  log('asked', `${a.id} "${a.text}" or ${b.id} "${b.text}"`);
  return MESSAGES.whichOne(a.text, b.text);
}

let running: AbortController | null = null;
let lastDecision = '';

/** What to say, null to let Ask AI answer, or STOPPED. */
async function answer(request: string): Promise<string | null> {
  running?.abort();
  running = new AbortController();
  const { signal } = running;
  log('heard', `“${request}”`);

  const controls = readScreen();
  log('read screen', `${controls.length} controls`, controls.map(traceOf));
  if (controls.length === 0) {
    lastDecision = 'no tracked controls on screen';
    log('not handled', lastDecision);
    return null;
  }

  const groups = groupControls(controls);
  const options = groups.map(({ id, description }) => ({ id, description }));
  log('asked Jev', `${options.length} options for ${controls.length} controls`);
  const result = await routeWithJev(request, options, signal, 'screen');
  if (signal.aborted) {
    lastDecision = 'stopped';
    log('stopped', 'while Jev was answering');
    return STOPPED;
  }
  log('Jev answered', result.route, result);

  const controlOf = (id: string): Control | undefined => groups.find(g => g.id === id)?.members[0];
  const decision = decide(result, id => controlOf(id)?.text ?? id);
  lastDecision = decision.why;

  if (decision.kind === 'ask') {
    const [a, b] = decision.ids.map(controlOf);
    if (a && b) return ask(a, b, signal);
  }
  const chosen = decision.kind === 'act' ? controlOf(decision.id) : undefined;
  if (!chosen) {
    log('not handled', `${lastDecision}, so Ask AI answers`);
    return null;
  }
  log('chose', `${chosen.id} → ${chosen.use}: ${chosen.label}`);
  return chosen.use === 'click' ? click(chosen, signal) : point(chosen, signal);
}

function cancel(): void {
  running?.abort();
  running = null;
}

const explain = (): string => lastDecision;

export const buddy = { answer, cancel, explain };
