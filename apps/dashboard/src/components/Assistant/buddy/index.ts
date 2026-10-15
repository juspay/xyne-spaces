import { routeWithJev } from '../../../services/assistantRouteService';
import { ask, close, log, openHidden, peek, settle, actOn, type Choice } from './act';
import {
  CHECK_OPTIONS,
  ASKS_A_QUESTION,
  ASKS_FOR_A_WAY,
  MESSAGES,
  MIN_PROBABILITY,
  STOPPED,
  TIMING,
  WORKSPACE_PREFIX,
} from './constants';
import { controlKey, looping, normalise, remember, tried, turnOf, type Turn } from './history';
import type { JevResult } from './decide';
import { readScreen, topDocument, type Control } from './screen';
import { runSteps, type Option, type Used, type WalkEnv } from './walk';

const choiceOf = (option: Option<Control>): Choice =>
  'opener' in option ? { id: option.id, text: option.text, el: option.opener.el } : option;

const use = (option: Option<Control>, signal: AbortSignal): Promise<Used> =>
  'opener' in option ? openHidden(option, signal) : actOn(option, signal);

/** Asks Jev whether the control is what was asked: 'same', 'leads' or 'other'. */
const check = (request: string, label: string, signal: AbortSignal): Promise<JevResult> =>
  routeWithJev(
    `The user asked: "${request}". The control: ${label}`,
    CHECK_OPTIONS,
    signal,
    'check',
  );

interface Doing {
  offered: Option<Control>[];
  used?: Option<Control>;
}

function currentPage(): string {
  const { pathname, search } = topDocument().location;
  return pathname.replace(WORKSPACE_PREFIX, '') + search;
}

const liveScreen = (
  signal: AbortSignal,
  doing: Doing,
  triedHere: ReadonlySet<string>,
  askedAbout: ReadonlySet<string>,
): WalkEnv<Control> => ({
  readScreen,
  peek,
  close,
  route: (request, options) => routeWithJev(request, options, signal, 'screen'),
  check: (request, label) => check(request, label, signal),
  here: currentPage,
  use: async (option): Promise<Used> => {
    const used = await use(option, signal);
    if (used.acted) doing.used = option;
    return used;
  },
  ask: (options): Promise<string> => {
    doing.offered = options;
    return Promise.resolve(ask(options.map(choiceOf), signal));
  },
  log,
  aborted: () => signal.aborted,
  settle: () => settle(TIMING.lateQuietMs, signal),
  tried: triedHere,
  askedAbout,
});

let running: AbortController | null = null;
/** The walk under way, so the next one starts only once it has stopped and tidied up. */
let walking: Promise<unknown> = Promise.resolve();
let hearing: string | undefined;
let lastDecision = '';
/** The last "Did you mean…?" and the steps it holds up, the first being the one asked about. */
interface Question {
  options: Option<Control>[];
  steps: string[];
}
let asked: Question | undefined;
let turns: Turn[] = [];

/** A whole short reply to "Did you mean…?": yes or the first takes the first, the second or other the second. */
const ANSWER_TO_ASK =
  /^\s*(?:(yes|yeah|yep|sure|ok(?:ay)?|that(?: one)?|the first(?: one)?)|(the (?:second|other)(?: one)?))(?: please)?\s*[.!?,]*\s*$/i;

/** A new command, not an answer to the last question. */
const NEW_COMMAND =
  /^\s*(?:open|go to|take me|show|start|create|archive|close|delete|send|find|search)\b/i;

/**
 * The option a reply picks from the last "Did you mean…?": yes, first or second, or the request
 * said again when there was one option; else whichever Jev leans to in it. A question or a new
 * command picks nothing and is walked as new.
 */
async function pickedFromAsk(
  request: string,
  { options, steps }: Question,
  signal: AbortSignal,
): Promise<Option<Control> | undefined> {
  const [only] = options.length === 1 ? options : [];
  const match = ANSWER_TO_ASK.exec(request);
  if (match) return options[match[1] ? 0 : 1];
  const step = normalise(steps[0] ?? '');
  if (only && step && normalise(request.replace(ASKS_FOR_A_WAY, '')) === step) return only;
  if (NEW_COMMAND.test(request) || ASKS_A_QUESTION.test(request)) return undefined;
  const described = options.map(({ id, label }) => ({ id, description: label }));
  const result = await routeWithJev(request, described, signal, 'screen');
  if (result.route === 'unavailable' || (result.probability ?? 0) < MIN_PROBABILITY)
    return undefined;
  return options.find(option => option.id === result.chosen);
}

async function walkFrom(request: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return STOPPED;
  const question = asked;
  asked = undefined;
  const picked = question && (await pickedFromAsk(request, question, signal));
  const page = currentPage();
  const loop = !picked && looping(turns, request, page);
  if (loop) {
    lastDecision = `"${loop.used?.text}" was tried twice for this`;
    return null;
  }
  const doing: Doing = { offered: [] };
  const tries = picked ? new Set<string>() : tried(turns, request, page);
  // A question about the option ("what does it do?") is not a yes to it.
  const sayingAgain = !picked && !ASKS_A_QUESTION.test(request);
  const askedAbout = new Set(sayingAgain ? (question?.options.map(controlKey) ?? []) : []);
  const screen = liveScreen(signal, doing, tries, askedAbout);
  const { reply, why, left } = picked
    ? await runSteps(request, screen, { confirmed: picked, steps: question.steps })
    : await runSteps(request, screen);
  if (signal.aborted) return reply;
  if (left) asked = { options: doing.offered, steps: left };
  turns = remember(turns, turnOf(request, currentPage(), doing.used, !!left));
  lastDecision = why;
  const [last] = [...tries];
  const before = last && turns.find(turn => turn.used?.key === last)?.used?.text;
  return before && reply ? `${MESSAGES.triedBefore(before)} ${reply}` : reply;
}

/** What to say, null to let Ask AI answer, or STOPPED. Walks never overlap: each waits its turn. */
function walkTo(request: string): Promise<string | null> {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  const walk = walking.catch(() => undefined).then(() => walkFrom(request, controller.signal));
  walking = walk;
  return walk;
}

/** As walkTo, but the same words heard again while they are walked are not walked again. */
async function answer(request: string): Promise<string | null> {
  const heard = request.trim().toLowerCase();
  if (heard === hearing) return STOPPED;
  hearing = heard;
  try {
    return await walkTo(request);
  } catch (error) {
    log('failed', String(error));
    return null;
  } finally {
    if (hearing === heard) hearing = undefined;
  }
}

function cancel(): void {
  running?.abort();
  running = null;
  hearing = undefined;
  asked = undefined;
}

const explain = (): string => lastDecision;

export const buddy = { answer, cancel, explain };
