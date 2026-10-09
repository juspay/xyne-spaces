import { routeWithJev } from '../../../services/assistantRouteService';
import { ask, close, log, openHidden, peek, settle, actOn, type Choice } from './act';
import {
  CHECK_OPTIONS,
  MESSAGES,
  MIN_PROBABILITY,
  STOPPED,
  TIMING,
  WORKSPACE_PREFIX,
} from './constants';
import { choices, controlKey, looping, remember, tried, turnOf, type Turn } from './history';
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

const liveScreen = (
  signal: AbortSignal,
  doing: Doing,
  triedHere: ReadonlySet<string>,
): WalkEnv<Control> => ({
  readScreen,
  peek,
  close,
  route: (request, options) => routeWithJev(request, options, signal, 'screen'),
  check: (request, label) => check(request, label, signal),
  here: (): string => {
    const { pathname, search } = topDocument().location;
    return pathname.replace(WORKSPACE_PREFIX, '') + search;
  },
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
  chosenBefore: request => choicesHere().recall(request),
  tried: triedHere,
});

const workspaceChoices = new Map<string, ReturnType<typeof choices>>();
function choicesHere(): ReturnType<typeof choices> {
  const workspace = WORKSPACE_PREFIX.exec(topDocument().location.pathname)?.[0] ?? '';
  const kept =
    workspaceChoices.get(workspace) ?? choices(`buddy.choices${workspace}`, () => localStorage);
  workspaceChoices.set(workspace, kept);
  return kept;
}

let running: AbortController | null = null;
/** The walk under way, so the next one starts only once it has stopped and tidied up. */
let walking: Promise<unknown> = Promise.resolve();
let hearing: string | undefined;
let lastDecision = '';
let asked: { options: Option<Control>[]; steps: string[] } | undefined;
let turns: Turn[] = [];

const NOT_THAT = /^\s*(?:no|nope|not that|wrong|the other(?: one)?)\b/i;

/** A reply to "Did you mean…?": yes or that one takes the first, the second or other the second. */
const ANSWER_TO_ASK =
  /^\s*(?:(yes|yeah|yep|sure|ok(?:ay)?|that(?: one)?|the first(?: one)?)|(the (?:second|other)(?: one)?))\b/i;

/** A new command, not an answer to the last question. */
const NEW_COMMAND =
  /^\s*(?:open|go to|take me|show|start|create|archive|close|delete|send|find|search)\b/i;

/** The option a reply picks from the last "Did you mean…?": yes, first or second, else whichever Jev hears in it. */
async function pickedFromAsk(
  request: string,
  options: Option<Control>[],
  signal: AbortSignal,
): Promise<Option<Control> | undefined> {
  const match = ANSWER_TO_ASK.exec(request);
  if (match) return options[match[1] ? 0 : 1];
  if (NEW_COMMAND.test(request)) return undefined;
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
  const [previous] = turns.slice(-1);
  if (previous && NOT_THAT.test(request)) choicesHere().forget(previous.request);
  const picked = question && (await pickedFromAsk(request, question.options, signal));
  if (question && picked) choicesHere().keep(question.steps[0] ?? request, controlKey(picked));
  const loop = !picked && looping(turns, request);
  if (loop) {
    lastDecision = `"${loop.used?.text}" was tried twice for this`;
    return null;
  }
  const doing: Doing = { offered: [] };
  const tries = picked ? new Set<string>() : tried(turns, request);
  const screen = liveScreen(signal, doing, tries);
  const page = screen.here();
  const { reply, why, left } = picked
    ? await runSteps(request, screen, { confirmed: picked, steps: question.steps })
    : await runSteps(request, screen);
  if (signal.aborted) return reply;
  if (left) asked = { options: doing.offered, steps: left };
  turns = remember(turns, turnOf(request, page, reply, doing.used, !!left));
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
