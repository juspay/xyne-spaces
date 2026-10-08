import type { JsonValue } from '@openfeature/server-sdk';
import { logger } from '@/utils/logger';
import { config as envConfig } from '@/config/env';
import { superpositionClient } from '@/services/superpositionClient';
import { ASSISTANT_NAVIGATE_NONE_ID as NONE_ID } from '@/validators/assistantNavigateValidator';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
  type JevNoulQuestion,
  type JevQuestion,
} from '@/services/queryIntent/jevClient';

export interface NavigateCandidate {
  id: string;
  description: string;
}

export interface NavigateStepInput {
  goal: string;
  page: { url: string; title: string; headings: string[] };
  history: { url: string; clicked: string; urlAfter: string; changed: boolean }[];
  candidates: NavigateCandidate[];
}

export type NavigateStepResult =
  | { status: 'reached'; reached: number }
  | { status: 'click'; id: string; confidence: number; reached: number }
  | { status: 'stuck'; reason: 'none' | 'low_confidence' | 'no_candidates'; reached: number }
  | { status: 'unavailable' };

interface NavigateContext {
  userId: string;
  workspaceId: string;
}

// Overrides `enabled` and the thresholds without a deploy.
const CONFIG_KEY = 'assistant_navigate_config';

// First guesses; re-tune from the `assistant navigate step` logs whenever JEV_MODEL changes.
const REACHED_THRESHOLD = 0.8;
// The best element's share of the probability left over after `none`, not its raw score:
// `none` soaks up a varying share depending on the model and screen, and a raw cutoff then
// rejects a clear favourite (seen on jev-latest: none 0.62, Xyne AI 0.21, next best 0.08 —
// Xyne AI holds 55% of the real-element mass).
const CLICK_THRESHOLD = 0.5;
// `none` only ends the run when it clearly wins. On a multi-click route the first step rarely
// looks like the goal itself, so `none` takes a large share even when one element is plainly
// the way in (seen: none 0.52 against the right element at 0.39).
const NONE_THRESHOLD = 0.7;

const TIMEOUT_MS = 4000;

const REACHED_QUESTION: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'Is `current_page` the place the user asked to go to in `goal`? Judge by its url, title ' +
    'and headings. Yes only when the user would consider themselves already there.',
  criteria: {
    true: 'The current page is where the user wants to be',
    false: 'The user still has to go somewhere else',
  },
};

const NEXT_INSTRUCTIONS =
  'The user wants to get to `goal` in this app and is on `current_page`, after `steps_taken`. ' +
  'Which element should be clicked next? The goal may be several clicks away: pick the element ' +
  'most likely to be the next step on the way, such as the section, app, tab or menu that ' +
  'would contain it, even when it is not the goal itself. Prefer navigation (sidebar, tabs, ' +
  'menus) over actions. A step in `steps_taken` with changed false did nothing: do not ' +
  'pick that element again.';

const NONE_DESCRIPTION =
  'None: no element on this screen is even plausibly a step toward the goal.';

interface NavigateConfig {
  enabled: boolean;
  reachedThreshold: number;
  clickThreshold: number;
  noneThreshold: number;
}

const DEFAULT_CONFIG: NavigateConfig = {
  enabled: true,
  reachedThreshold: REACHED_THRESHOLD,
  clickThreshold: CLICK_THRESHOLD,
  noneThreshold: NONE_THRESHOLD,
};

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1;

// Same rules as assistantRoute: null when Superposition never initialised, and remote fields
// are checked one by one so a mistyped value cannot flip the kill switch.
const getConfig = async (ctx: NavigateContext): Promise<NavigateConfig | null> => {
  if (!superpositionClient.isReady()) return null;
  const remote = await superpositionClient.getObjectValue(
    CONFIG_KEY,
    DEFAULT_CONFIG as unknown as JsonValue,
    { userId: ctx.userId, workspaceId: ctx.workspaceId }
  );
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return DEFAULT_CONFIG;
  const { enabled, reachedThreshold, clickThreshold, noneThreshold } = remote as Record<
    string,
    unknown
  >;
  return {
    enabled: enabled === undefined ? DEFAULT_CONFIG.enabled : enabled === true,
    reachedThreshold: isProbability(reachedThreshold)
      ? reachedThreshold
      : DEFAULT_CONFIG.reachedThreshold,
    clickThreshold: isProbability(clickThreshold) ? clickThreshold : DEFAULT_CONFIG.clickThreshold,
    noneThreshold: isProbability(noneThreshold) ? noneThreshold : DEFAULT_CONFIG.noneThreshold,
  };
};

const shuffle = <T>(items: T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};

/** Why a step came back `unavailable`, for the dev debug payload. */
type UnavailableReason = 'not_configured' | 'disabled' | 'jev_failed' | 'jev_unusable';

/**
 * Only outside production: the exact request sent to Jev and its answers, so the dashboard
 * console can show why a step went the way it did. Never logged, never sent in production:
 * it carries the goal and page content.
 */
interface NavigateStepDebug {
  jevRequest?: { url: string; model: string; state: unknown; questions: unknown };
  jevAnswers?: unknown;
  jevFailure?: JevFailure;
  thresholds?: NavigateConfig;
  pNone?: number;
  unavailableReason?: UnavailableReason;
  latencyMs: number;
}

const DEBUG = envConfig.env !== 'production';

/**
 * One step of "take me to X": asks Jev, in a single request, whether the current page already
 * is the goal and, if not, which of the clickable elements to click next. The browser owns the
 * loop (it has the DOM); this stays stateless, so `history` is the whole memory Jev gets.
 */
export const navigateStep = async (
  input: NavigateStepInput,
  ctx: NavigateContext,
  signal?: AbortSignal
): Promise<NavigateStepResult & { debug?: NavigateStepDebug }> => {
  const started = Date.now();
  const debug: Omit<NavigateStepDebug, 'latencyMs'> = {};
  const finish = (result: NavigateStepResult, top?: [string, number][]) => {
    const latencyMs = Date.now() - started;
    // Never the goal, urls or descriptions: they are user content.
    logger.info('assistant navigate step', {
      status: result.status,
      ...('reached' in result ? { reached: result.reached } : {}),
      ...(result.status === 'click' ? { confidence: result.confidence } : {}),
      ...(top ? { top: top.map(([id, p]) => `${id}:${p.toFixed(3)}`) } : {}),
      ...(debug.unavailableReason ? { unavailableReason: debug.unavailableReason } : {}),
      step: input.history.length,
      candidates: input.candidates.length,
      latencyMs,
    });
    return DEBUG ? { ...result, debug: { ...debug, latencyMs } } : result;
  };
  const unavailable = (reason: UnavailableReason) => {
    debug.unavailableReason = reason;
    return finish({ status: 'unavailable' });
  };

  if (!isJevConfigured()) return unavailable('not_configured');
  const config = await getConfig(ctx);
  if (!config?.enabled) return unavailable('disabled');
  debug.thresholds = config;

  const state = {
    goal: input.goal.trim(),
    current_page: input.page,
    steps_taken: input.history,
  };

  // Built with fromEntries, not `criteria[id] =`: ids come from the request.
  const criteria: Record<string, string> = Object.fromEntries([
    ...shuffle(input.candidates).map((c) => [c.id, c.description]),
    [NONE_ID, NONE_DESCRIPTION],
  ]);
  const questions: Record<string, JevQuestion> = { reached: REACHED_QUESTION };
  if (input.candidates.length > 0) {
    questions.next = {
      type: 'choice',
      instructions: NEXT_INSTRUCTIONS,
      criteria,
    } satisfies JevChoiceQuestion;
  }
  if (DEBUG) {
    debug.jevRequest = { url: envConfig.jev.url, model: envConfig.jev.model, state, questions };
  }

  const answers = await askJev(state, questions, TIMEOUT_MS, signal, {
    onFailure: (failure) => {
      debug.jevFailure = failure;
    },
  });
  if (DEBUG) debug.jevAnswers = answers;
  if (!answers) return unavailable('jev_failed');
  const reachedAnswer = answers.reached;
  if (!reachedAnswer || reachedAnswer.type !== 'noul') return unavailable('jev_unusable');
  const reached = reachedAnswer.noul;

  if (reached >= config.reachedThreshold) return finish({ status: 'reached', reached });
  if (input.candidates.length === 0) {
    return finish({ status: 'stuck', reason: 'no_candidates', reached });
  }

  const next = answers.next;
  if (!next || next.type !== 'choice') return unavailable('jev_unusable');

  const ranked = Object.entries(next.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 3);
  const pNone = next.probabilities[NONE_ID] ?? (next.choice === NONE_ID ? 1 : 0);
  debug.pNone = pNone;
  if (pNone >= config.noneThreshold) {
    return finish({ status: 'stuck', reason: 'none', reached }, top);
  }

  // The best real element, even when `none` edged it out, scored by its share of the
  // real-element mass.
  const best = ranked.find(
    ([id]) => id !== NONE_ID && Object.prototype.hasOwnProperty.call(criteria, id)
  );
  const confidence = best && pNone < 1 ? Math.min(1, best[1] / (1 - pNone)) : 0;
  if (!best || confidence < config.clickThreshold) {
    return finish({ status: 'stuck', reason: 'low_confidence', reached }, top);
  }
  return finish({ status: 'click', id: best[0], confidence, reached }, top);
};

export interface NavigateChooseInput {
  goal: string;
  kind: 'destination' | 'item';
  itemType?: string;
  currentPage?: { url: string; title: string };
  options: NavigateCandidate[];
}

export type NavigateChooseResult =
  | { status: 'chosen'; id: string; confidence: number }
  | { status: 'none'; pNone: number }
  | { status: 'unsure'; id: string; confidence: number }
  | { status: 'unavailable' };

const DESTINATION_INSTRUCTIONS =
  'The user typed `goal` to be taken somewhere in this app. Which of these destinations do ' +
  'they mean? Words may be shortened, misspelled or informal. When the goal names a specific ' +
  'item (a canvas, a person, a channel, an agent), pick the destination for that kind of item. ' +
  'Pick none when the goal is not about going to any of these places.';

const DESTINATION_NONE = 'None: the goal is not about going to any of these places.';

const itemInstructions = (itemType: string): string =>
  `The user typed \`goal\` to open one ${itemType}. Which of these does it mean? Names may be ` +
  'shortened, misspelled, lower-case, possessive ("oms" can mean Om Singh Thakur) or only part ' +
  'of the full name. Pick none when none of them matches.';

const itemNone = (itemType: string): string =>
  `None: the goal names a ${itemType} not listed here.`;

/**
 * One pick from a list the dashboard built (destinations in the app, or the user's own canvases,
 * DMs, channels…). Code, not Jev, then knows the path, so a whole route is one call instead of a
 * click per screen. Same scoring as a step: `none` must clearly win to end it, and the best
 * option is judged by its share of the mass left after `none`.
 */
export const navigateChoose = async (
  input: NavigateChooseInput,
  ctx: NavigateContext,
  signal?: AbortSignal
): Promise<NavigateChooseResult & { debug?: NavigateStepDebug }> => {
  const started = Date.now();
  const debug: Omit<NavigateStepDebug, 'latencyMs'> = {};
  const finish = (result: NavigateChooseResult, top?: [string, number][]) => {
    const latencyMs = Date.now() - started;
    // Never the goal or the option descriptions: they are user content.
    logger.info('assistant navigate choose', {
      kind: input.kind,
      status: result.status,
      ...('confidence' in result ? { confidence: result.confidence } : {}),
      ...(top ? { top: top.map(([id, p]) => `${id}:${p.toFixed(3)}`) } : {}),
      ...(debug.unavailableReason ? { unavailableReason: debug.unavailableReason } : {}),
      options: input.options.length,
      latencyMs,
    });
    return DEBUG ? { ...result, debug: { ...debug, latencyMs } } : result;
  };
  const unavailable = (reason: UnavailableReason) => {
    debug.unavailableReason = reason;
    return finish({ status: 'unavailable' });
  };

  if (!isJevConfigured()) return unavailable('not_configured');
  const config = await getConfig(ctx);
  if (!config?.enabled) return unavailable('disabled');
  debug.thresholds = config;

  const isItem = input.kind === 'item';
  const itemType = input.itemType ?? 'item';
  const criteria: Record<string, string> = Object.fromEntries([
    ...shuffle(input.options).map((o) => [o.id, o.description]),
    [NONE_ID, isItem ? itemNone(itemType) : DESTINATION_NONE],
  ]);
  const state = {
    goal: input.goal.trim(),
    ...(input.currentPage ? { current_page: input.currentPage } : {}),
  };
  const questions: Record<string, JevQuestion> = {
    pick: {
      type: 'choice',
      instructions: isItem ? itemInstructions(itemType) : DESTINATION_INSTRUCTIONS,
      criteria,
    } satisfies JevChoiceQuestion,
  };
  if (DEBUG) {
    debug.jevRequest = { url: envConfig.jev.url, model: envConfig.jev.model, state, questions };
  }

  const answers = await askJev(state, questions, TIMEOUT_MS, signal, {
    onFailure: (failure) => {
      debug.jevFailure = failure;
    },
  });
  if (DEBUG) debug.jevAnswers = answers;
  if (!answers) return unavailable('jev_failed');
  const pick = answers.pick;
  if (!pick || pick.type !== 'choice') return unavailable('jev_unusable');

  const ranked = Object.entries(pick.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 3);
  const pNone = pick.probabilities[NONE_ID] ?? (pick.choice === NONE_ID ? 1 : 0);
  debug.pNone = pNone;
  if (pNone >= config.noneThreshold) return finish({ status: 'none', pNone }, top);

  const best = ranked.find(
    ([id]) => id !== NONE_ID && Object.prototype.hasOwnProperty.call(criteria, id)
  );
  if (!best) return finish({ status: 'none', pNone }, top);
  const confidence = pNone < 1 ? Math.min(1, best[1] / (1 - pNone)) : 0;
  if (confidence < config.clickThreshold) {
    return finish({ status: 'unsure', id: best[0], confidence }, top);
  }
  return finish({ status: 'chosen', id: best[0], confidence }, top);
};
