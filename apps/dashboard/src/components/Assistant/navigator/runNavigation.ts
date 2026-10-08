import {
  navigateStepWithJev,
  type NavigateStepRequest,
} from '../../../services/assistantNavigateService';
import {
  collectClickables,
  findLoadingIndicator,
  openForms,
  snapshotPage,
  type Clickable,
  type CollectOptions,
} from './collectClickables';
import { logClick, logFallback, logRunEnd, logRunStart, logStep } from './navigatorDebug';
import type { Opener } from './destinations';
import { resolveGoal } from './resolveGoal';
import type { NavigatorItems } from './useNavigatorItems';

const MAX_STEPS = 8;
// How often the screen is re-read while waiting for it to finish rendering.
const POLL_MS = 250;
// The screen counts as ready once its clickables (and url) read the same this many times in a
// row, ~500 ms unchanged, with no spinner or skeleton showing...
const STABLE_READS = 3;
// ...after giving a click at least this long to start its work...
const AFTER_CLICK_MIN_MS = 200;
// ...and the loop moves on anyway after this long: some screens never stop changing.
const WAIT_MAX_MS = 6000;

export interface NavigationStep {
  /** `open`: went straight to a page or form; `click`: clicked an element on screen. */
  via: 'open' | 'click';
  url: string;
  /** For `open`, what was opened; for `click`, the clicked element's description. */
  clicked: string;
  urlAfter: string;
  /** False when the click changed neither the url nor what is clickable: a dead end. */
  changed: boolean;
  confidence: number;
}

export type NavigationStatus =
  | 'running'
  | 'reached'
  | 'stuck'
  | 'loop'
  | 'maxSteps'
  | 'unavailable'
  | 'cancelled';

export interface NavigationRun {
  goal: string;
  status: NavigationStatus;
  /** Why the run stopped, in a few words. */
  detail?: string | undefined;
  steps: NavigationStep[];
}

export interface NavigationDeps {
  /** Workspace-aware: takes a path like `/chat/canvas/<id>`. */
  navigate: (path: string) => void;
  /** Read at the start of the run, so it sees whatever has loaded by then. */
  getItems: () => NavigatorItems;
}

export interface ScreenWait {
  waitedMs: number;
  polls: number;
  /** True when WAIT_MAX_MS ran out before the screen settled. */
  timedOut: boolean;
  /** The loading indicator still showing at the last read, if any. */
  loader: string | null;
}

const currentUrl = (): string => window.location.pathname + window.location.search;

const screenSignature = (url: string, clickables: readonly Clickable[]): string =>
  `${url}\n${clickables.map(c => c.description).join('\n')}`;

const deadEndKey = (url: string, description: string): string => `${url}\n${description}`;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = window.setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });

/**
 * Waits until the screen has finished rendering, judged by what matters here: the set of
 * clickables and the url stop changing and no loading indicator is showing. A DOM-quiet timer
 * is not enough: a screen can sit still on a spinner while its data loads, and animations keep
 * the DOM busy on a screen that is long done. Returns the clickables from the final read.
 */
async function waitForStableScreen(
  signal: AbortSignal,
  minWaitMs: number,
  options: CollectOptions = {},
): Promise<{ clickables: Clickable[]; wait: ScreenWait }> {
  const started = performance.now();
  if (minWaitMs > 0) await sleep(minWaitMs, signal);

  let clickables = collectClickables(options);
  let loader = findLoadingIndicator();
  let signature = '';
  let sameReads = 0;
  let polls = 0;

  for (;;) {
    polls++;
    const next = `${currentUrl()}\n${clickables.map(c => c.description).join('\n')}`;
    sameReads = next === signature && !loader ? sameReads + 1 : 1;
    signature = next;

    const waitedMs = Math.round(performance.now() - started);
    if (signal.aborted || (sameReads >= STABLE_READS && !loader)) {
      return { clickables, wait: { waitedMs, polls, timedOut: false, loader } };
    }
    if (waitedMs >= WAIT_MAX_MS) {
      return { clickables, wait: { waitedMs, polls, timedOut: true, loader } };
    }

    await sleep(POLL_MS, signal);
    clickables = collectClickables(options);
    loader = findLoadingIndicator();
  }
}

// The full pointer sequence, not just click(): Radix menus and popovers open on pointerdown.
const activate = (element: HTMLElement): void => {
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const init = { bubbles: true, cancelable: true, view: window, button: 0 };
  element.dispatchEvent(
    new PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }),
  );
  element.dispatchEvent(new MouseEvent('mousedown', init));
  element.dispatchEvent(
    new PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }),
  );
  element.dispatchEvent(new MouseEvent('mouseup', init));
  element.click();
};

/** Opens a form through the event the app already listens for. */
async function runOpener(opener: Opener, signal: AbortSignal): Promise<void> {
  window.dispatchEvent(new CustomEvent(opener.name));
  await waitForStableScreen(signal, AFTER_CLICK_MIN_MS);
}

/**
 * Drives "take me to <goal>". First it tries to resolve the goal to a path without touching the
 * screen: Jev picks a destination from the app's map and, for a named item, the item itself;
 * code then navigates straight there. Only when that finds nothing does it fall back to the
 * click agent: each step waits for the screen to finish rendering, collects what can be
 * clicked, asks Jev whether we have arrived and if not what to click, and clicks it.
 */
export async function runNavigation(
  goal: string,
  signal: AbortSignal,
  onUpdate: (run: NavigationRun) => void,
  deps: NavigationDeps,
): Promise<NavigationRun> {
  const run: NavigationRun = { goal, status: 'running', steps: [] };
  const publish = (status: NavigationStatus, detail?: string): NavigationRun => {
    run.status = status;
    run.detail = detail;
    onUpdate({ ...run, steps: [...run.steps] });
    if (status !== 'running') logRunEnd(run);
    return run;
  };
  logRunStart(goal);
  publish('running');

  const resolution = await resolveGoal(goal, deps.getItems(), signal);
  if (signal.aborted) return publish('cancelled');

  // Set when the goal is a form behind a button: the click agent presses it and stops as soon
  // as the form is open.
  let formNote: string | null = null;
  if (resolution.kind !== 'fallback') {
    const found = resolution.kind === 'open';
    const label = found ? resolution.label : resolution.destination.title;
    const path = found ? resolution.path : resolution.destination.path;
    const url = currentUrl();
    if (found && resolution.opener) {
      await runOpener(resolution.opener, signal);
    } else if (path) {
      deps.navigate(path);
      await waitForStableScreen(signal, AFTER_CLICK_MIN_MS);
    }
    if (signal.aborted) return publish('cancelled');
    const urlAfter = currentUrl();
    if (path || !found || resolution.opener) {
      logClick(`opened ${label}`, url, urlAfter, true);
      run.steps.push({
        via: 'open',
        url,
        clicked: label,
        urlAfter,
        changed: true,
        confidence: found ? resolution.confidence : 0,
      });
    }
    if (!found) {
      return publish('stuck', `no ${resolution.itemType} matched, so opened ${label} instead`);
    }
    if (!resolution.finishByClicking) {
      return publish(
        'reached',
        resolution.note ? `Opened ${label}: ${resolution.note}.` : `Opened ${label}.`,
      );
    }
    formNote = resolution.note ?? 'fill it in';
    logFallback('the form opens from a button: letting Jev find it on screen');
  } else {
    logFallback(resolution.reason);
  }

  const formMode = formNote !== null;
  const collectOptions: CollectOptions = { allowFormOpeners: formMode };
  // Forms already open before any click, so only a newly opened one ends the run.
  const formsBefore = openForms();
  const formOpened = (): boolean => [...openForms()].some(form => !formsBefore.has(form));

  let screen = await waitForStableScreen(signal, 0, collectOptions);
  // Elements whose click changed nothing, per page: never offered again this run.
  const deadEnds = new Set<string>();

  for (let step = 1; step <= MAX_STEPS; step++) {
    if (signal.aborted) return publish('cancelled');

    const { wait } = screen;
    const url = currentUrl();
    const clickables = screen.clickables.filter(c => !deadEnds.has(deadEndKey(url, c.description)));
    const request: NavigateStepRequest = {
      goal,
      formMode,
      page: snapshotPage(),
      history: run.steps.map(({ url: from, clicked, urlAfter, changed }) => ({
        url: from,
        clicked,
        urlAfter,
        changed,
      })),
      candidates: clickables.map(({ id, description }) => ({ id, description })),
    };
    const requestStarted = performance.now();
    const response = await navigateStepWithJev(request, signal);
    if (signal.aborted) return publish('cancelled');
    logStep(step, wait, request, response, Math.round(performance.now() - requestStarted));

    if (response.status === 'reached') return publish('reached');
    if (response.status === 'unavailable') {
      return publish(
        'unavailable',
        response.debug?.unavailableReason ?? response.error ?? 'Jev did not answer',
      );
    }
    if (response.status === 'stuck') {
      const why: Record<typeof response.reason, string> = {
        none: 'Jev found nothing on this screen that leads there',
        // eslint-disable-next-line @typescript-eslint/naming-convention -- backend reason ids
        low_confidence: 'Jev was not sure enough about any element',
        // eslint-disable-next-line @typescript-eslint/naming-convention -- backend reason ids
        no_candidates: 'nothing clickable on screen',
      };
      return publish('stuck', why[response.reason]);
    }

    const target = clickables.find(c => c.id === response.id);
    if (!target || !target.element.isConnected) {
      return publish('stuck', `the chosen element ${response.id} left the page before the click`);
    }

    // The same element twice in one run is a circle, even when the url differs each time
    // (a button that opens a new item gets a fresh url per click).
    if (run.steps.some(s => s.clicked === target.description)) {
      return publish('loop', `would click "${target.description}" a second time`);
    }

    const before = screenSignature(url, screen.clickables);
    activate(target.element);
    screen = await waitForStableScreen(signal, AFTER_CLICK_MIN_MS, collectOptions);
    const urlAfter = currentUrl();
    const changed = screenSignature(urlAfter, screen.clickables) !== before;
    if (!changed) deadEnds.add(deadEndKey(url, target.description));
    logClick(target.description, url, urlAfter, changed);
    run.steps.push({
      via: 'click',
      url,
      clicked: target.description,
      urlAfter,
      changed,
      confidence: response.confidence,
    });
    // The form the user asked for is open: they fill it in and submit, never the navigator.
    if (formMode && formOpened()) {
      return publish('reached', `Opened the form: ${formNote}.`);
    }
    publish('running');
  }

  return publish('maxSteps', `${MAX_STEPS} clicks without arriving`);
}
