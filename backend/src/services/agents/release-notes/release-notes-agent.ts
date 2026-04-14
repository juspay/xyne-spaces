import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunState,
  type RunConfig,
  type TraceEvent,
} from '@juspay-jaf/jaf';
import { config } from '@/config/env';
import { getReleaseNotesSystemPrompt, buildReleaseNotesUserPrompt } from './prompts';
import { AgentsConfig } from '@/agents/config';
import { createAgentEventLogger, composeEventHandlers } from '@/agents/agentLogger';

const LITELLM_BASE_URL = config.litellm.baseUrl;
const LITELLM_API_KEY = config.litellm.apiKey;

export interface ReleaseNotesGeneratorContext {
  readonly userId?: string;
  readonly channelId?: string;
}

export interface ReleaseNotesGeneratorInput {
  releaseXyneId: string;
  releaseTitle: string;
  releaseDescription: string | null;
  prs: Array<{
    prId: number;
    title: string;
    description: string | null;
    hasPotVideo: boolean;
    ticketXyneId: string | null;
    ticketDescription: string | null;
    ticketTitle: string | null;
  }>;
  conversationMessages?: Array<{
    content: string;
    senderName: string;
    createdAt: string;
  }>;
  categoryFocus?: string;
  hotfixPRs?: Array<{
    prId: number;
    title: string;
    description: string | null;
    hasPotVideo: boolean;
    ticketXyneId: string | null;
    ticketDescription: string | null;
    ticketTitle: string | null;
  }>;
}

export type ReleaseNotesGeneratorOutput = string;

export const releaseNotesGeneratorAgent: Agent<ReleaseNotesGeneratorContext, string> = {
  name: 'ReleaseNotesGenerator',

  instructions: () => {
    return getReleaseNotesSystemPrompt();
  },

  modelConfig: {
    temperature: 0.7,
  },
};

export function createModelProvider() {
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
}

export const agentRegistry = new Map<string, Agent<ReleaseNotesGeneratorContext, any>>([
  ['ReleaseNotesGenerator', releaseNotesGeneratorAgent],
]);

export async function generateReleaseNotesContent(
  input: ReleaseNotesGeneratorInput,
  context: ReleaseNotesGeneratorContext,
  onEvent?: (event: TraceEvent) => void,
  agentsConfig?: AgentsConfig
): Promise<string> {
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.releaseNotesGeneratorModelName || 'glm-latest';

  const modelProvider = createModelProvider();
  const formattedPrompt = buildReleaseNotesUserPrompt(input);

  const agentLogger = createAgentEventLogger('ReleaseNotes', 'LITELLM_API_KEY');
  const composedOnEvent = onEvent ? composeEventHandlers(agentLogger, onEvent) : agentLogger;

  const runConfig: RunConfig<ReleaseNotesGeneratorContext> = {
    agentRegistry,
    modelProvider,
    maxTurns: 2,
    modelOverride: modelName,
    onEvent: composedOnEvent,
  };

  const initialState: RunState<ReleaseNotesGeneratorContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: formattedPrompt,
      },
    ],
    currentAgentName: 'ReleaseNotesGenerator',
    context,
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const rawOutput = result.outcome.output;
    if (typeof rawOutput === 'string') {
      return rawOutput;
    }
    return String(rawOutput);
  } else if (result.outcome.status === 'error') {
    throw new Error(`Release notes generation failed: ${result.outcome.error._tag}`);
  } else {
    throw new Error('Release notes generation was interrupted');
  }
}
