import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
  type TraceEvent,
} from '@xynehq/jaf';
import { config } from '../../config/env.js';

export type ActivityClassificationContext = {
  activityId?: string;
  jobType?: string;
  actorAction?: string | null;
};

export type ActivityClassificationOutput = {
  classification: 'ACTIONABLE' | 'FYI' | 'SKIP';
  confidence?: number;
};

const ACTIVITY_CLASSIFICATION_AGENT_NAME = 'ActivityClassification';
const DEFAULT_TIMEOUT_MS = config.llm?.requestTimeoutMs ?? 120000;
const DEFAULT_RETRIES = 2;

export const activityClassificationAgent: Agent<ActivityClassificationContext, string> = {
  name: ACTIVITY_CLASSIFICATION_AGENT_NAME,
  instructions: () => '',
  modelConfig: {
    temperature: 0.2,
  },
};

export const activityClassificationAgentRegistry = new Map<
  string,
  Agent<ActivityClassificationContext, any>
>([[ACTIVITY_CLASSIFICATION_AGENT_NAME, activityClassificationAgent]]);

export const createModelProvider = () => {
  if (!config.litellm.apiKey) {
    throw new Error('LiteLLM configuration is missing for activity classification.');
  }
  return makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });

const runWithRetries = async <T>(execute: () => Promise<T>, retries: number): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await execute();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown error'));
};

export type ActivityClassificationRunnerOptions = {
  modelOverride?: string;
  timeoutMs?: number;
  retries?: number;
  onEvent?: (event: TraceEvent) => void;
};

export async function runActivityClassification(
  prompt: string,
  context: ActivityClassificationContext,
  options: ActivityClassificationRunnerOptions = {}
): Promise<string> {
  const modelProvider = createModelProvider();

  const runConfig: RunConfig<ActivityClassificationContext> = {
    agentRegistry: activityClassificationAgentRegistry,
    modelProvider: modelProvider as RunConfig<ActivityClassificationContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: options.modelOverride,
    onEvent: options.onEvent,
  };

  const executeRun = async (): Promise<string> => {
    const initialState: RunState<ActivityClassificationContext> = {
      runId: generateRunId(),
      traceId: generateTraceId(),
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      currentAgentName: ACTIVITY_CLASSIFICATION_AGENT_NAME,
      context,
      turnCount: 0,
    };

    const result = await run(initialState, runConfig);

    if (result.outcome.status === 'completed') {
      const output = result.outcome.output;
      return typeof output === 'string' ? output : JSON.stringify(output);
    }

    if (result.outcome.status === 'error') {
      throw new Error(`Activity classification failed: ${result.outcome.error._tag}`);
    }

    throw new Error('Activity classification was interrupted.');
  };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  return runWithRetries(() => withTimeout(executeRun(), timeoutMs), retries);
}
