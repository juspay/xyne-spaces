/**
 * Ticket board suggestion agent using JAF (Juspay Agent Framework)
 */

import { z } from 'zod';
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
import { config } from '../../config/env.js';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { AgentsConfig } from '../config.js';

const LITELLM_BASE_URL = config.litellm.baseUrl;
const LITELLM_API_KEY = config.litellm.apiKey;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_BOARD_DESCRIPTION_LENGTH = 1000;

export interface TicketBoardContext {
  readonly userId: string;
  readonly projectId: string;
}

export interface TicketBoardCandidateInput {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly boardType?: string;
  readonly stageCount?: number;
}

export interface TicketBoardInput {
  readonly title: string;
  readonly description: string;
  readonly candidates: readonly TicketBoardCandidateInput[];
}

export interface TicketBoardOutput {
  readonly suggestedBoardId: string | null;
  readonly suggestedBoardName: string | null;
}

const TicketBoardOutputSchema = z.object({
  suggestedBoardId: z.string().nullable(),
  suggestedBoardName: z.string().nullable(),
});

export const ticketBoardAgent: Agent<TicketBoardContext, TicketBoardOutput> = {
  name: 'TicketBoardSuggester',
  instructions: () => {
    return `You are a support triage assistant. Analyze the new ticket and suggest the most suitable board from the available candidates.

Return ONLY valid JSON with this exact schema:
{
  "suggestedBoardId": string | null,
  "suggestedBoardName": string | null
}

Rules:
- Use suggestedBoardId and suggestedBoardName only from the candidate list.
- If no suitable board is found, return null for both suggestedBoardId and suggestedBoardName.
- Output JSON only, no extra text.
- Do not include reasoning, analysis, or  tags.`;
  },
  modelConfig: {
    temperature: 0.2,
  },
};

export const ticketBoardAgentRegistry = new Map<string, Agent<TicketBoardContext, any>>([
  ['TicketBoardSuggester', ticketBoardAgent],
]);

export function createModelProvider() {
  if (!LITELLM_BASE_URL || !LITELLM_API_KEY) {
    throw new Error('LiteLLM configuration is missing for ticket board suggestion.');
  }
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
}

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
};

const normalizePromptText = (value: string, maxLength: number): string =>
  truncateText(extractPlainTextFromHtml(value), maxLength);

const formatCandidateList = (candidates: readonly TicketBoardCandidateInput[]): string =>
  candidates
    .map((candidate, index) => {
      const name = candidate.name;
      const description = candidate.description
        ? normalizePromptText(candidate.description, MAX_BOARD_DESCRIPTION_LENGTH)
        : '';
      return [
        `<candidate index="${index + 1}">`,
        ` <id>${candidate.id}</id>`,
        ` <name>${name}</name>`,
        candidate.description ? ` <description>${description}</description>` : undefined,
        candidate.boardType ? ` <boardType>${candidate.boardType}</boardType>` : undefined,
        candidate.stageCount ? ` <stageCount>${candidate.stageCount}</stageCount>` : undefined,
        `</candidate>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

const buildPrompt = (input: TicketBoardInput): string => {
  const formattedTitle = normalizePromptText(input.title, MAX_TITLE_LENGTH);
  const formattedDescription = normalizePromptText(input.description, MAX_DESCRIPTION_LENGTH);
  const candidateList = formatCandidateList(input.candidates);

  return `Analyze the new ticket provided below and suggest the most suitable board from the available candidates.

<new_ticket>
 <title>${formattedTitle}</title>
 <description>${formattedDescription}</description>
</new_ticket>

<available_boards>
${candidateList}
</available_boards>`;
};

const extractJson = (content: string): string | null => {
  const sanitized = content.replace(/[\s\S]*?<\/think>/gi, '').trim();
  const match = sanitized.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
};

function parseAgentOutput(content: string): TicketBoardOutput {
  const jsonContent = extractJson(content);
  if (!jsonContent) {
    throw new Error('No JSON payload found in board analysis response.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonContent);
  } catch (error) {
    throw new Error('Failed to parse JSON from agent response.');
  }

  const parsed = TicketBoardOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `Board analysis response failed validation: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export async function analyzeTicketBoard(
  input: TicketBoardInput,
  context: TicketBoardContext,
  onEvent?: (event: TraceEvent) => void,
  agentsConfig?: AgentsConfig,
): Promise<TicketBoardOutput> {
  if (!input.candidates || input.candidates.length === 0) {
    return {
      suggestedBoardId: null,
      suggestedBoardName: null,
    };
  }

  // Use model name from CAC config if provided, otherwise fetch or use default
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.ticketBoardModelName;

  const modelProvider = createModelProvider();
  const prompt = buildPrompt(input);

  const runConfig: RunConfig<TicketBoardContext> = {
    agentRegistry: ticketBoardAgentRegistry,
    modelProvider: modelProvider as RunConfig<TicketBoardContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: modelName,
    onEvent,
  };

  const initialState: RunState<TicketBoardContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    currentAgentName: 'TicketBoardSuggester',
    context,
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      return parseAgentOutput(output);
    }
    return output as TicketBoardOutput;
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Ticket board analysis failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Ticket board analysis was interrupted.');
}