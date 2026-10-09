import { routeWithJev } from '../../../services/assistantRouteService';
import { ask, click, close, log, openHidden, peek, point, type Choice } from './act';
import { CHECK_OPTIONS, MIN_PROBABILITY, WORKSPACE_PREFIX } from './constants';
import { readScreen, type Control } from './screen';
import { runWalk, type Option, type WalkEnv } from './walk';

// Buddy: runs the walk on the live screen, with Jev behind the assistant route.

/** An item in a closed menu is shown by its opener. */
const choiceOf = (option: Option<Control>): Choice =>
  'opener' in option ? { id: option.id, text: option.text, el: option.opener.el } : option;

async function use(option: Option<Control>, signal: AbortSignal): Promise<string> {
  if ('opener' in option) return openHidden(option, signal);
  return option.use === 'click' ? click(option, signal) : point(option, signal);
}

/** Asks Jev whether the control is what was asked: 'same', 'leads' or 'other'. */
async function check(
  request: string,
  label: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const text = `The user asked: "${request}". The control: ${label}`;
  const result = await routeWithJev(text, CHECK_OPTIONS, signal, 'check');
  return result.route === 'unavailable' ? undefined : result.chosen;
}

/** The live screen, where every step gives up once the request is replaced or stopped. */
const liveScreen = (signal: AbortSignal, request: string): WalkEnv<Control> => ({
  readScreen,
  peek,
  close,
  route: (request, options) => routeWithJev(request, options, signal, 'screen'),
  check: (request, label) => check(request, label, signal),
  here: () => window.location.pathname.replace(WORKSPACE_PREFIX, '') + window.location.search,
  use: option => use(option, signal),
  ask: options => {
    asked = { request, options };
    return Promise.resolve(ask(options.map(choiceOf), signal));
  },
  log,
  aborted: () => signal.aborted,
});

let running: AbortController | null = null;
/** The walk under way, so the next one starts only once it has stopped and tidied up. */
let walking: Promise<unknown> = Promise.resolve();
let lastDecision = '';
/** The last "Did you mean…?": the request it was about and what it offered. */
let asked: { request: string; options: Option<Control>[] } | undefined;

/** A reply to "Did you mean…?": yes or that one takes the first, the second or other the second. */
const ANSWER_TO_ASK =
  /^\s*(?:(yes|yeah|yep|sure|ok(?:ay)?|that(?: one)?|the first(?: one)?)|(the (?:second|other)(?: one)?))\b/i;

/**
 * The option a reply picks from the last "Did you mean…?": yes or the first or second, else
 * whichever of them Jev hears in it ("roles", even misheard as "rules").
 */
async function pickedFromAsk(
  request: string,
  options: Option<Control>[],
  signal: AbortSignal,
): Promise<Option<Control> | undefined> {
  const match = ANSWER_TO_ASK.exec(request);
  if (match) return options[match[1] ? 0 : 1];
  const described = options.map(({ id, label }) => ({ id, description: label }));
  const result = await routeWithJev(request, described, signal, 'screen');
  if (result.route === 'unavailable' || (result.probability ?? 0) < MIN_PROBABILITY)
    return undefined;
  return options.find(option => option.id === result.chosen);
}

/** What to say, null to let Ask AI answer, or STOPPED. */
async function answer(request: string): Promise<string | null> {
  running?.abort();
  await walking.catch(() => undefined);
  const controller = new AbortController();
  running = controller;
  const question = asked;
  asked = undefined;
  const picked = question && (await pickedFromAsk(request, question.options, controller.signal));
  // A yes goes on with the request it answered, from the option chosen.
  const walk = picked
    ? runWalk(question.request, liveScreen(controller.signal, question.request), picked)
    : runWalk(request, liveScreen(controller.signal, request));
  walking = walk;
  const { reply, why } = await walk;
  lastDecision = why;
  return reply;
}

function cancel(): void {
  running?.abort();
  running = null;
}

const explain = (): string => lastDecision;

export const buddy = { answer, cancel, explain };
