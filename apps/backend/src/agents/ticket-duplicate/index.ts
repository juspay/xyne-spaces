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
import { superpositionClient } from '@/services/superpositionClient';
import {
  askJev,
  isPrivateJevConfigured,
  type JevQuestion,
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
  readonly ticketId?: string;
}

export interface TicketDuplicateCandidateInput {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status?: string;
}

export type TicketDuplicateRelation = 'duplicate' | 'regression' | 'related' | 'unrelated';

export type TicketDuplicateTier = 'likely' | 'similar';

export interface TicketDuplicateMatch {
  readonly id: string;
  readonly tier: TicketDuplicateTier;
  readonly score: number;
  readonly relation?: TicketDuplicateRelation;
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
  readonly matches?: readonly TicketDuplicateMatch[];
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
  const sanitized = content.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '').trim();
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

const JEV_CONFIG_KEY = 'ticket_duplicate_jev_config';

interface TicketDuplicateJevConfig {
  similarThreshold: number;
  shadow: boolean;
}

const DEFAULT_JEV_CONFIG: TicketDuplicateJevConfig = {
  similarThreshold: 0.5,
  shadow: false,
};

const LLM_MIN_CONFIDENCE = 0.7;
const JEV_CANDIDATE_DESCRIPTION_LENGTH = 1200;
const JEV_NEW_TICKET_DESCRIPTION_LENGTH = 2000;
const JEV_MAX_CANDIDATES = 32;

const getJevConfig = async (): Promise<TicketDuplicateJevConfig> => {
  try {
    const remote = (await superpositionClient.getObjectValue(JEV_CONFIG_KEY, {}, {})) as Partial<TicketDuplicateJevConfig> | null;
    return { ...DEFAULT_JEV_CONFIG, ...remote };
  } catch {
    return DEFAULT_JEV_CONFIG;
  }
};

/**
 * Same bar as SYSTEM_INSTRUCTIONS. Re-tune ticket_duplicate_jev_threshold and
 * ticket_duplicate_jev_config.similarThreshold whenever this wording or RELATION_CRITERIA changes.
 */
const SAME_ISSUE_INSTRUCTIONS =
  'Is this existing ticket the same issue as `new_ticket` — the same problem with effectively ' +
  'the same root cause, reported again? Ignore differences in wording, tone and who reported it.' +
  ' A related but different problem, a different symptom, or another bug in the same feature is not a duplicate.';

const RELATION_CRITERIA: Record<TicketDuplicateRelation, string> = {
  duplicate: 'The same problem, reported again.',
  regression:
    'The same problem, but the existing ticket was already fixed or closed and `new_ticket` reports it happening again.',
  related: 'The same feature or area, but a different problem.',
  unrelated: 'A different subject, even if some words match.',
};

const RELATIONS = new Set<string>(Object.keys(RELATION_CRITERIA));
const SAME_ISSUE_RELATIONS = new Set<TicketDuplicateRelation>(['duplicate', 'regression']);

const quoteCandidate = (candidate: TicketDuplicateCandidateInput): string => {
  const text = [
    `Title: ${normalizePromptText(candidate.title, MAX_TITLE_LENGTH)}`,
    candidate.status ? `Status: ${candidate.status}` : '',
    `Description: ${normalizePromptText(candidate.description || '', JEV_CANDIDATE_DESCRIPTION_LENGTH)}`,
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/"{3,}/g, '"')
    .replace(/`/g, "'");
  return `Existing ticket:\n"""\n${text}\n"""`;
};

const tierOf = (
  score: number,
  relation: TicketDuplicateRelation | undefined,
  thresholds: { likely: number; similar: number },
): TicketDuplicateTier | null => {
  const sameIssue = relation !== undefined && SAME_ISSUE_RELATIONS.has(relation);
  if (score >= thresholds.likely && sameIssue) return 'likely';
  if (sameIssue) return 'similar';
  if (score >= thresholds.similar && relation !== 'unrelated') return 'similar';
  return null;
};

/**
 * Only to a Jev that was pointed at explicitly: desk tickets carry customer email, so
 * they never go to the public default endpoint.
 */
const isJevAvailable = (): boolean => isPrivateJevConfigured();

export const isJevScoringEnabled = async (agentsConfig?: AgentsConfig): Promise<boolean> =>
  isJevAvailable() && (agentsConfig ?? (await AgentsConfig.fetch())).ticketDuplicateJevEnabled;

/**
 * One Jev call with two questions per candidate: whether it is the same issue, and how it
 * relates (duplicate, regression, related, unrelated). "Likely" needs both to agree;
 * "similar" is anything worth a glance. Null when Jev can't answer. Never throws.
 */
async function scoreWithJev(
  input: TicketDuplicateInput,
  thresholds: { likely: number; similar: number },
  allowPartial: boolean,
): Promise<TicketDuplicateOutput | null> {
  const candidates = input.candidates.slice(0, JEV_MAX_CANDIDATES);
  const state = {
    new_ticket: {
      title: normalizePromptText(input.title, MAX_TITLE_LENGTH),
      description: normalizePromptText(input.description, JEV_NEW_TICKET_DESCRIPTION_LENGTH),
    },
  };
  const questions: Record<string, JevQuestion> = {};
  candidates.forEach((candidate, i) => {
    const quoted = quoteCandidate(candidate);
    questions[`same${i}`] = {
      type: 'noul',
      instructions: `${quoted}\n${SAME_ISSUE_INSTRUCTIONS}`,
      criteria: { true: 'same issue (duplicate)', false: 'different issue' },
    };
    questions[`relation${i}`] = {
      type: 'choice',
      instructions: `${quoted}\nHow does this existing ticket relate to \`new_ticket\`?`,
      criteria: RELATION_CRITERIA,
    };
  });

  const answers = await askJev(state, questions, JEV_TIMEOUT_MS, undefined, { partial: allowPartial });
  if (!answers) return null;

  const scored = candidates.flatMap((candidate, i) => {
    const same = answers[`same${i}`];
    if (same?.type !== 'noul') return [];
    const relationAnswer = answers[`relation${i}`];
    const relation =
      relationAnswer?.type === 'choice' && RELATIONS.has(relationAnswer.choice)
        ? (relationAnswer.choice as TicketDuplicateRelation)
        : undefined;
    return [{ id: candidate.id, score: same.noul, ...(relation ? { relation } : {}) }];
  });
  if (scored.length === 0) return null;

  const matches = scored
    .flatMap((verdict): TicketDuplicateMatch[] => {
      const tier = tierOf(verdict.score, verdict.relation, thresholds);
      return tier ? [{ ...verdict, tier }] : [];
    })
    .sort((a, b) => (a.tier === b.tier ? b.score - a.score : a.tier === 'likely' ? -1 : 1));
  const top = matches[0];
  const best = Math.max(...scored.map(verdict => verdict.score));
  const isDuplicate = top?.tier === 'likely';

  return {
    isDuplicate,
    duplicateTicketId: isDuplicate ? top.id : null,
    confidence: isDuplicate ? top.score : best,
    reason: isDuplicate
      ? `Rated as the same issue as an existing ticket (score ${top.score.toFixed(2)}).`
      : `No similar ticket was rated as the same issue (best score ${best.toFixed(2)}).`,
    matches,
  };
}

const scoresForLog = (result: TicketDuplicateOutput | null) =>
  result?.matches?.map(match => [match.id, Math.round(match.score * 100) / 100, match.relation ?? null, match.tier]) ?? [];

// ============================================================================
// Execution Function
// ============================================================================

export async function analyzeTicketDuplicates(
  input: TicketDuplicateInput,
  context: TicketDuplicateContext,
  _onEvent?: unknown, // Kept for API compatibility, not used with direct calls
  agentsConfig?: AgentsConfig,
  options: { jevOnly?: boolean } = {},
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
  const jevConfig = await getJevConfig();
  const thresholds = {
    likely: cacConfig.ticketDuplicateJevThreshold,
    similar: jevConfig.similarThreshold,
  };
  if (cacConfig.ticketDuplicateJevEnabled && isJevAvailable()) {
    const jevResult = await scoreWithJev(input, thresholds, options.jevOnly === true);
    if (jevResult) {
      logger.info(`[${AGENT_NAME}] Verdict`, {
        source: 'jev',
        model: envConfig.jev.model,
        ticketId: context.ticketId,
        thresholds,
        isDuplicate: jevResult.isDuplicate,
        confidence: jevResult.confidence,
        candidateCount: input.candidates.length,
        candidates: input.candidates.map(candidate => candidate.id),
        matches: scoresForLog(jevResult),
      });
      return jevResult;
    }
    logger.warn(`[${AGENT_NAME}] Jev gave no answer, falling back to the LLM`, { source: 'jev' });
  }

  if (options.jevOnly) {
    return {
      isDuplicate: false,
      duplicateTicketId: null,
      confidence: 0,
      reason: 'Duplicate scoring is not available.',
      matches: [],
    };
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

    const parsed = parseAgentOutput(response.content);
    const isDuplicate =
      parsed.isDuplicate && Boolean(parsed.duplicateTicketId) && parsed.confidence >= LLM_MIN_CONFIDENCE;
    const result: TicketDuplicateOutput = {
      ...parsed,
      isDuplicate,
      duplicateTicketId: isDuplicate ? parsed.duplicateTicketId : null,
      matches: parsed.duplicateTicketId
        ? [{ id: parsed.duplicateTicketId, tier: isDuplicate ? 'likely' : 'similar', score: parsed.confidence }]
        : [],
    };
    logger.info(`[${AGENT_NAME}] Verdict`, {
      source: 'llm',
      model: modelName,
      ticketId: context.ticketId,
      isDuplicate,
      confidence: parsed.confidence,
      candidateCount: input.candidates.length,
      candidates: input.candidates.map(candidate => candidate.id),
      pick: parsed.duplicateTicketId,
    });
    if (jevConfig.shadow && !cacConfig.ticketDuplicateJevEnabled && isJevAvailable()) {
      void scoreWithJev(input, thresholds, false).then(shadow => {
        logger.info(`[${AGENT_NAME}] Shadow`, {
          ticketId: context.ticketId,
          model: envConfig.jev.model,
          thresholds,
          llmPick: isDuplicate ? parsed.duplicateTicketId : null,
          jevPick: shadow?.isDuplicate ? shadow.duplicateTicketId : null,
          agree: (shadow?.isDuplicate ? shadow.duplicateTicketId : null) === (isDuplicate ? parsed.duplicateTicketId : null),
          answered: shadow !== null,
          candidates: input.candidates.map(candidate => candidate.id),
          matches: scoresForLog(shadow),
        });
      });
    }
    return result;
  } catch (error) {
    // Log error
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}
