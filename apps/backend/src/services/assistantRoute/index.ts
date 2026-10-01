import type { JsonValue } from '@openfeature/server-sdk';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';
import { ASSISTANT_ROUTE_NONE_ID as NONE_ID } from '@/validators/assistantRouteValidator';
import { askJev, isJevConfigured, type JevChoiceQuestion } from '@/services/queryIntent/jevClient';

export interface AssistantRouteAction {
  id: string;
  description: string;
}

type AssistantRouteResult =
  | { route: 'actions'; actionIds: string[]; confidence: number }
  | { route: 'ask_ai'; reason: 'none' | 'low_confidence' }
  | { route: 'unavailable' };

interface AssistantRouteContext {
  userId: string;
  workspaceId: string;
}

// Overrides `enabled` and the thresholds without a deploy.
const CONFIG_KEY = 'assistant_route_config';

// Tuned on jev-latest; re-tune when JEV_MODEL changes. ACTION_THRESHOLD applies to
// 1 - p(none), not the top option: a sentence naming several actions splits the mass between them.
const ACTION_THRESHOLD = 0.9;
const ALSO_THRESHOLD = 0.1;

const TIMEOUT_MS = 2500;

const NONE_DESCRIPTION =
  'None of these: a general question, or a request about something else, for the AI assistant to answer.';

const INSTRUCTIONS =
  'Which of these is the user asking to do, or asking how to do? Pick none when the ' +
  'message is about something else or is a general question.';

interface AssistantRouteConfig {
  enabled: boolean;
  actionThreshold: number;
  alsoThreshold: number;
}

const DEFAULT_CONFIG: AssistantRouteConfig = {
  enabled: true,
  actionThreshold: ACTION_THRESHOLD,
  alsoThreshold: ALSO_THRESHOLD,
};

const getConfig = async (ctx: AssistantRouteContext): Promise<AssistantRouteConfig> => {
  const remote = (await superpositionClient.getObjectValue(
    CONFIG_KEY,
    DEFAULT_CONFIG as unknown as JsonValue,
    { userId: ctx.userId, workspaceId: ctx.workspaceId }
  )) as Partial<AssistantRouteConfig> | null;
  return { ...DEFAULT_CONFIG, ...remote };
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
      ...(chosen ? { chosen } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      actions: actions.length,
      latencyMs: Date.now() - started,
    });
    return result;
  };

  if (!isJevConfigured()) return finish({ route: 'unavailable' });
  const config = await getConfig(ctx);
  if (!config.enabled) return finish({ route: 'unavailable' });

  // Shuffled against position bias.
  const criteria: Record<string, string> = {};
  for (const action of shuffle(actions)) criteria[action.id] = action.description;
  criteria[NONE_ID] = NONE_DESCRIPTION;
  const question: JevChoiceQuestion = { type: 'choice', instructions: INSTRUCTIONS, criteria };

  const answers = await askJev({ text: text.trim() }, { action: question }, TIMEOUT_MS, signal);
  const answer = answers?.action;
  if (!answer || answer.type !== 'choice') return finish({ route: 'unavailable' });

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
