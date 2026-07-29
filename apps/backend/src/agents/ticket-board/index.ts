/**
 * Ticket board suggestion agent — Framework LLM Client
 */

import { z } from 'zod';
import { LLMClient, createUserMessage } from '@framework';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { AgentsConfig } from '../config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_BOARD_DESCRIPTION_LENGTH = 1000;

const AGENT_NAME = 'TicketBoard';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Schema & Constants
// ============================================================================

const TicketBoardOutputSchema = z.object({
  suggestedBoardId: z.string().nullable(),
  suggestedBoardName: z.string().nullable(),
});

const SYSTEM_INSTRUCTIONS = `You are a support triage assistant. Analyze the new ticket and suggest the most suitable board from the available candidates.

Return ONLY valid JSON with this exact schema:
{
  "suggestedBoardId": string | null,
  "suggestedBoardName": string | null
}

Rules:
- Use suggestedBoardId and suggestedBoardName only from the candidate list.
- If no suitable board is found, return null for both suggestedBoardId and suggestedBoardName.
- Output JSON only, no extra text.
- Do not include reasoning, analysis, or thinking tags.`;

// ============================================================================
// Helpers
// ============================================================================

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
  const sanitized = content.replace(/<thinking>[\s\S]*?<\/think>/gi, '').trim();
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

// ============================================================================
// Execution Function
// ============================================================================

export async function analyzeTicketBoard(
  input: TicketBoardInput,
  context: TicketBoardContext,
  _onEvent?: unknown, // Kept for API compatibility, not used with direct calls
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
  const credential =
    await orgLLMCredentialService.getCredentialByProjectId(
      context.projectId,
      OrgLLMServiceAccountPurpose.DEFAULT,
    ) ??
    await orgLLMCredentialService.getCredentialByUserId(
      context.userId,
      OrgLLMServiceAccountPurpose.DEFAULT,
    );

  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  // Initialize LLM client
  const llmClient = new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
      },
    },
    defaultModel: modelName,
  });

  const prompt = buildPrompt(input);

  // Log LLM call start
  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  try {
    // Generate response using framework LLM client
    const response = await llmClient.generate({
      messages: [
        createUserMessage(prompt)
      ],
      systemPrompt: SYSTEM_INSTRUCTIONS,
      parameters: {
        temperature: 0.2
      },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    });

    // Log success
    logLLMSuccess(AGENT_NAME, response.content);

    const result = parseAgentOutput(response.content);
    return result;
  } catch (error) {
    // Log error
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}
