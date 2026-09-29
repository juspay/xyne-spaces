/**
 * Ticket duplicate detection agent — Framework LLM Client
 */

import { z } from 'zod';
import { LLMClient, createUserMessage } from '@framework';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { AgentsConfig } from '../config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
import { config as envConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  askJev,
  isJevConfigured,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4000;

const AGENT_NAME = 'TicketDuplicate';

// Jev answers the whole candidate batch in one call; generous so a cold connection on
// the worker still gets an answer, while staying well under the LLM's latency.
const JEV_TIMEOUT_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Schema & Constants
// ============================================================================

const TicketDuplicateOutputSchema = z.object({
  isDuplicate: z.boolean(),
  duplicateTicketId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

const SYSTEM_INSTRUCTIONS = `You are a support triage assistant. Determine whether the new ticket is a duplicate of any candidate tickets.
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
- Do not include reasoning, analysis, or thinking tags.
- In the reason, do not mention ticket IDs or any candidate identifiers; refer only to the issue details (title/description).`;

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
  const sanitized = content.replace(/<thinking>[\s\S]*?<\/think>/gi, '').trim();
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

// ============================================================================
// Jev
// ============================================================================

/**
 * Same bar as SYSTEM_INSTRUCTIONS. Calibrated together with the CAC threshold — keep
 * the wording and ticket_duplicate_jev_threshold in step when changing either.
 */
const jevSameIssueInstructions = (key: string): string =>
  `Is \`candidates.${key}\` a duplicate of \`new_ticket\` — the same issue with effectively ` +
  'the same root cause, reported again? Ignore differences in wording and tone.' +
  ' A related but different problem, or a different symptom, is not a duplicate.';

/**
 * Desk tickets carry customer email, so like radar they only go to a Jev that was
 * pointed at explicitly (JEV_URL), never jevClient's public default endpoint.
 */
const isJevAvailable = (): boolean => isJevConfigured() && Boolean(envConfig.jev.url);

/**
 * One Jev call: each candidate is its own yes/no question against a single state, and
 * the best-scoring candidate is the duplicate when it clears the threshold. Null when
 * Jev can't answer — the caller falls back to the LLM. Never throws.
 */
async function scoreWithJev(
  input: TicketDuplicateInput,
  threshold: number,
): Promise<TicketDuplicateOutput | null> {
  // Keys, not ticket ids, so nothing internal goes into the state.
  const keys = input.candidates.map((_, i) => `c${i}`);
  const state = {
    new_ticket: {
      title: normalizePromptText(input.title, MAX_TITLE_LENGTH),
      description: normalizePromptText(input.description, MAX_DESCRIPTION_LENGTH),
    },
    candidates: Object.fromEntries(
      input.candidates.map((candidate, i) => [
        keys[i],
        {
          title: normalizePromptText(candidate.title, MAX_TITLE_LENGTH),
          description: normalizePromptText(candidate.description || '', MAX_DESCRIPTION_LENGTH),
          ...(candidate.status ? { status: candidate.status } : {}),
        },
      ]),
    ),
  };
  const questions = Object.fromEntries(
    keys.map((key): [string, JevNoulQuestion] => [
      key,
      {
        type: 'noul',
        instructions: jevSameIssueInstructions(key),
        criteria: { true: 'same issue (duplicate)', false: 'different issue' },
      },
    ]),
  );

  // askJev, not askJevNouls: the questions point into the state with backticked paths,
  // which needs the state as an object. All-or-nothing, so every candidate is scored.
  const answers = await askJev(state, questions, JEV_TIMEOUT_MS);
  if (!answers) return null;
  const scores = keys.map(key => {
    const answer = answers[key];
    return answer?.type === 'noul' ? answer.noul : 0;
  });

  let best = 0;
  scores.forEach((score, i) => {
    if (score > scores[best]) best = i;
  });
  const probability = scores[best];
  const isDuplicate = probability >= threshold;

  return {
    isDuplicate,
    duplicateTicketId: isDuplicate ? input.candidates[best].id : null,
    confidence: probability,
    reason: isDuplicate
      ? `Rated as the same issue as an existing ticket (score ${probability.toFixed(2)}).`
      : `No similar ticket was rated as the same issue (best score ${probability.toFixed(2)}).`,
  };
}

// ============================================================================
// Execution Function
// ============================================================================

export async function analyzeTicketDuplicates(
  input: TicketDuplicateInput,
  context: TicketDuplicateContext,
  _onEvent?: unknown, // Kept for API compatibility, not used with direct calls
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

  // Jev first when CAC turns it on; the LLM below is the fallback only for when Jev is
  // unconfigured or can't answer. An answer is final either way: a "no" under the
  // threshold does not go on to the LLM — that is what saves the LLM call.
  // `source` is logged so Jev and LLM verdicts can be compared when tuning the threshold.
  if (cacConfig.ticketDuplicateJevEnabled && isJevAvailable()) {
    const jevResult = await scoreWithJev(input, cacConfig.ticketDuplicateJevThreshold);
    if (jevResult) {
      logger.info(`[${AGENT_NAME}] Verdict`, {
        source: 'jev',
        model: envConfig.jev.model,
        threshold: cacConfig.ticketDuplicateJevThreshold,
        isDuplicate: jevResult.isDuplicate,
        confidence: jevResult.confidence,
        candidateCount: input.candidates.length,
      });
      return jevResult;
    }
    logger.warn(`[${AGENT_NAME}] Jev gave no answer, falling back to the LLM`, { source: 'jev' });
  }

  const modelName = cacConfig.ticketDuplicateModelName;
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
