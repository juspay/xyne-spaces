/**
 * Ticket duplicate detection agent using JAF (Juspay Agent Framework)
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

export interface TicketDuplicateContext {
  readonly userId: string;
  readonly projectId: string;
}

export interface TicketDuplicateCandidateInput {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status?: string;
}

export interface TicketDuplicateInput {
  readonly title: string;
  readonly description: string;
  readonly candidates: readonly TicketDuplicateCandidateInput[];
}

export interface TicketDuplicateOutput {
  readonly isDuplicate: boolean;
  readonly duplicateTicketId: string | null;
  readonly confidence: number;
  readonly reason: string;
}

const TicketDuplicateOutputSchema = z.object({
  isDuplicate: z.boolean(),
  duplicateTicketId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const ticketDuplicateAgent: Agent<TicketDuplicateContext, TicketDuplicateOutput> = {
  name: 'TicketDuplicateDetector',
  instructions: () => {
    return `You are a support triage assistant. Determine whether the new ticket is a duplicate of any candidate tickets.
Only mark as duplicate if the issue and root cause are effectively the same.

Return ONLY valid JSON with this exact schema:
{
  "isDuplicate": boolean,
  "duplicateTicketId": string | null,
  "confidence": number,
  "reason": string
}

Rules:
- Use duplicateTicketId only from the candidate list.
- Set confidence between 0.0 and 1.0.
- Keep reason concise and specific.
- Output JSON only, no extra text.
- Do not include reasoning, analysis, or <think> tags.
- In the reason, do not mention ticket IDs or any candidate identifiers; refer only to the issue details (title/description).`;
  },
  modelConfig: {
    temperature: 0.2,
  },
};

export const ticketDuplicateAgentRegistry = new Map<string, Agent<TicketDuplicateContext, any>>([
  ['TicketDuplicateDetector', ticketDuplicateAgent],
]);

export function createModelProvider() {
  if (!LITELLM_BASE_URL || !LITELLM_API_KEY) {
    throw new Error('LiteLLM configuration is missing for ticket duplicate detection.');
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

const formatCandidateList = (candidates: readonly TicketDuplicateCandidateInput[]): string =>
  candidates
    .map((candidate, index) => {
      const title = normalizePromptText(candidate.title, MAX_TITLE_LENGTH);
      const description = normalizePromptText(candidate.description || '', MAX_DESCRIPTION_LENGTH);
      return [
        `<candidate index="${index + 1}">`,
        ` <id>${candidate.id}</id>`,
        ` <title>${title}</title>`,
        ` <description>${description}</description>`,
        candidate.status ? ` <status>${candidate.status}</status>` : undefined,
        `</candidate>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

const buildPrompt = (input: TicketDuplicateInput): string => {
  const formattedTitle = normalizePromptText(input.title, MAX_TITLE_LENGTH);
  const formattedDescription = normalizePromptText(input.description, MAX_DESCRIPTION_LENGTH);
  const candidateList = formatCandidateList(input.candidates);

  return `Analyze the new ticket provided below to determine if it is a duplicate of any of the candidate tickets.

<new_ticket>
 <title>${formattedTitle}</title>
 <description>${formattedDescription}</description>
</new_ticket>

<candidate_tickets>
${candidateList}
</candidate_tickets>`;
};

const extractJson = (content: string): string | null => {
  const sanitized = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const match = sanitized.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
};

function parseAgentOutput(content: string): TicketDuplicateOutput {
  const jsonContent = extractJson(content);
  if (!jsonContent) {
    throw new Error('No JSON payload found in duplicate analysis response.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonContent);
  } catch (error) {
    throw new Error('Failed to parse JSON from agent response.');
  }

  const parsed = TicketDuplicateOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `Duplicate analysis response failed validation: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export async function analyzeTicketDuplicates(
  input: TicketDuplicateInput,
  context: TicketDuplicateContext,
  onEvent?: (event: TraceEvent) => void,
  agentsConfig?: AgentsConfig,
): Promise<TicketDuplicateOutput> {
  if (!input.candidates || input.candidates.length === 0) {
    return {
      isDuplicate: false,
      duplicateTicketId: null,
      confidence: 0,
      reason: 'No similar tickets found in this project.',
    };
  }

  // Use model name from CAC config if provided, otherwise fetch or use default
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.ticketDuplicateModelName;

  const modelProvider = createModelProvider();
  const prompt = buildPrompt(input);

  const runConfig: RunConfig<TicketDuplicateContext> = {
    agentRegistry: ticketDuplicateAgentRegistry,
    modelProvider: modelProvider as RunConfig<TicketDuplicateContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: modelName,
    onEvent,
  };

  const initialState: RunState<TicketDuplicateContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    currentAgentName: 'TicketDuplicateDetector',
    context,
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      return parseAgentOutput(output);
    }
    return output as TicketDuplicateOutput;
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Ticket duplicate analysis failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Ticket duplicate analysis was interrupted.');
}
