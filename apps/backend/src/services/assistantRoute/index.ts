import type { JsonValue } from '@openfeature/server-sdk';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';
import { ASSISTANT_ROUTE_NONE_ID as NONE_ID } from '@/validators/assistantRouteValidator';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
} from '@/services/queryIntent/jevClient';

export interface AssistantRouteAction {
  id: string;
  description: string;
}

// Returned to the client and logged: without it an `unavailable` can't be told apart on prod.
type UnavailableReason =
  | 'jev_not_configured'
  | 'config_unavailable'
  | 'disabled'
  | 'jev_timeout'
  | 'jev_network'
  | 'jev_status'
  | 'jev_unusable'
  | 'cancelled';

type AssistantRouteResult =
  | { route: 'actions'; actionIds: string[]; confidence: number }
  | { route: 'ask_ai'; reason: 'none' | 'low_confidence' }
  | { route: 'unavailable'; reason: UnavailableReason; status?: number };

interface AssistantRouteContext {
  userId: string;
  workspaceId: string;
}

// Overrides `enabled`, the thresholds and the Jev timeout without a deploy.
const CONFIG_KEY = 'assistant_route_config';

// Tuned on jev-latest; re-tune when JEV_MODEL changes. ACTION_THRESHOLD applies to
// 1 - p(none), not the top option: a sentence naming several actions splits the mass between them.
const ACTION_THRESHOLD = 0.85;
const ALSO_THRESHOLD = 0.1;

const TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 7000;

const NONE_DESCRIPTION =
  'None of these: a general question, or a request about something else, for the AI assistant to answer.';

const INSTRUCTIONS =
  'Which of these is the user asking to do, or asking how to do? Pick none when the ' +
  'message is about something else or is a general question.';

interface AssistantRouteConfig {
  enabled: boolean;
  actionThreshold: number;
  alsoThreshold: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: AssistantRouteConfig = {
  enabled: true,
  actionThreshold: ACTION_THRESHOLD,
  alsoThreshold: ALSO_THRESHOLD,
  timeoutMs: TIMEOUT_MS,
};

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1;

const isTimeout = (value: unknown): value is number =>
  typeof value === 'number' && value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS;

const failureResult = (
  failure: JevFailure | undefined,
  signal?: AbortSignal
): AssistantRouteResult => {
  switch (failure?.kind) {
    case 'timeout':
      return { route: 'unavailable', reason: 'jev_timeout' };
    case 'network':
      return { route: 'unavailable', reason: 'jev_network' };
    case 'status':
      return { route: 'unavailable', reason: 'jev_status', status: failure.status };
    default:
      return { route: 'unavailable', reason: signal?.aborted ? 'cancelled' : 'jev_unusable' };
  }
};

// Null when Superposition never initialised: retrying its init here would hold the request for
// its full network timeout. Remote fields are checked one by one, so a mistyped value cannot turn
// the kill switch off or make every message match.
const getConfig = async (ctx: AssistantRouteContext): Promise<AssistantRouteConfig | null> => {
  if (!superpositionClient.isReady()) return null;
  const remote = await superpositionClient.getObjectValue(
    CONFIG_KEY,
    DEFAULT_CONFIG as unknown as JsonValue,
    { userId: ctx.userId, workspaceId: ctx.workspaceId }
  );
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return DEFAULT_CONFIG;
  const { enabled, actionThreshold, alsoThreshold, timeoutMs } = remote as Record<string, unknown>;
  return {
    enabled: enabled === undefined ? DEFAULT_CONFIG.enabled : enabled === true,
    actionThreshold: isProbability(actionThreshold)
      ? actionThreshold
      : DEFAULT_CONFIG.actionThreshold,
    alsoThreshold: isProbability(alsoThreshold) ? alsoThreshold : DEFAULT_CONFIG.alsoThreshold,
    timeoutMs: isTimeout(timeoutMs) ? timeoutMs : DEFAULT_CONFIG.timeoutMs,
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

export const routeAssistantMessage = async (
  text: string,
  actions: AssistantRouteAction[],
  ctx: AssistantRouteContext,
  signal?: AbortSignal
): Promise<AssistantRouteResult> => {
  const started = Date.now();
  const finish = (result: AssistantRouteResult, chosen?: string, confidence?: number) => {
    // Never the text or the action descriptions: they are user content.
    logger.info('assistant route', {
      route: result.route,
      ...(result.route === 'unavailable' ? { reason: result.reason } : {}),
      ...(result.route === 'unavailable' && result.status !== undefined
        ? { status: result.status }
        : {}),
      ...(chosen ? { chosen } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      actions: actions.length,
      latencyMs: Date.now() - started,
    });
    return result;
  };

  if (!isJevConfigured()) return finish({ route: 'unavailable', reason: 'jev_not_configured' });
  const config = await getConfig(ctx);
  if (!config) return finish({ route: 'unavailable', reason: 'config_unavailable' });
  if (!config.enabled) return finish({ route: 'unavailable', reason: 'disabled' });

  // Shuffled against position bias. Built with fromEntries, not `criteria[id] =`: ids come from
  // the request, and fromEntries defines own keys without going through prototype setters.
  const criteria: Record<string, string> = Object.fromEntries([
    ...shuffle(actions).map((action) => [action.id, action.description]),
    [NONE_ID, NONE_DESCRIPTION],
  ]);
  const question: JevChoiceQuestion = { type: 'choice', instructions: INSTRUCTIONS, criteria };

  let failure: JevFailure | undefined;
  const answers = await askJev(
    { text: text.trim() },
    { action: question },
    config.timeoutMs,
    signal,
    {
      onFailure: (f) => {
        failure = f;
      },
    }
  );
  const answer = answers?.action;
  if (!answer || answer.type !== 'choice') return finish(failureResult(failure, signal));

  if (answer.choice === NONE_ID) return finish({ route: 'ask_ai', reason: 'none' }, NONE_ID);

  const scored = Object.entries(answer.probabilities)
    .filter(([id]) => id !== NONE_ID && Object.prototype.hasOwnProperty.call(criteria, id))
    .sort((a, b) => b[1] - a[1]);
  const confidence =
    scored.length > 0
      ? Math.min(
          1,
          scored.reduce((sum, [, p]) => sum + p, 0)
        )
      : answer.confidence;
  if (confidence === undefined || confidence < config.actionThreshold) {
    return finish({ route: 'ask_ai', reason: 'low_confidence' }, answer.choice, confidence);
  }

  const offered = scored.filter(([, p]) => p >= config.alsoThreshold).map(([id]) => id);
  const actionIds = offered.length > 0 ? offered : [answer.choice];

  return finish({ route: 'actions', actionIds, confidence }, actionIds[0], confidence);
};
