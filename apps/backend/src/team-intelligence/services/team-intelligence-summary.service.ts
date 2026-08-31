import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceAiUsageInput,
  TeamIntelligencePullRequestInput,
  TeamIntelligenceCommitInput,
} from '../types';
import { TeamIntelligenceLLMUnavailableError } from '../errors';
import {
  compactForPriorSections,
  getTeamIntelligenceSectionConcurrency,
  mapWithConcurrency,
  parseLlmJson,
  runSectionWithFallback,
  withTeamIntelligenceLlmSlot,
} from '../llm-utils';
import { pruneInvalidArrayItemsForRetry } from '../validation-utils';
import {
  TeamIntelligenceUserSummarySchema,
  type TeamIntelligenceTeamAggregationPayload,
  type TeamIntelligenceUserSummary,
} from '../user-summary.schema';
import { createTeamIntelligenceLlmClient } from './team-intelligence-llm-client';
import {
  teamIntelligenceUserEvidenceService,
  type TeamIntelligenceUserEvidence,
} from './team-intelligence-user-evidence.service';

export interface TeamIntelligenceGeneratedSummary {
  pullRequests: Prisma.InputJsonValue;
  soloCommits: Prisma.InputJsonValue;
  employeeSummary: string[];
  userSummary: TeamIntelligenceUserSummary;
  teamAggregationPayload: TeamIntelligenceTeamAggregationPayload;
  sourceData: Prisma.InputJsonValue;
  summaryMetadata: Prisma.InputJsonValue;
}

interface GenerateUserSummaryInput {
  batchId: string;
  userIngestionId: string;
  pullRequests: unknown;
  soloCommits: unknown;
  aiUsage: unknown;
  userEmail: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  source: string;
  orgId?: string | null;
  reportDate: Date;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

interface LlmGenerateOptions {
  purpose: string;
}

interface EvidenceChunk {
  chunkId: string;
  sourceType: string;
  sourceKey: string;
  itemCount: number;
  charLength: number;
  sourceData: Record<string, unknown>;
}

interface PromptSourceDataResult {
  sourceData: Record<string, unknown>;
  profile: Record<string, unknown>;
}

interface UserPromptSection {
  name: string;
  instructions: string[];
  outputShape: Record<string, unknown>;
  priorSections?: Record<string, unknown>;
}

interface UserGeneratedSections {
  whoIsDoingWhat: TeamIntelligenceUserSummary['whoIsDoingWhat'];
  needsUnblocking: TeamIntelligenceUserSummary['needsUnblocking'];
  criticalAndMoving: TeamIntelligenceUserSummary['criticalAndMoving'];
  momentumAndDirection: TeamIntelligenceUserSummary['momentumAndDirection'];
  decisionsAndAlignment: TeamIntelligenceUserSummary['decisionsAndAlignment'];
  peopleLoadFocusAndGaps: TeamIntelligenceUserSummary['peopleLoadFocusAndGaps'];
  upcomingAndAtRisk: TeamIntelligenceUserSummary['upcomingAndAtRisk'];
  managerAttention: TeamIntelligenceUserSummary['managerAttention'];
  teamSignals: TeamIntelligenceUserSummary['teamSignals'];
  unknowns: TeamIntelligenceUserSummary['unknowns'];
  overallConfidence: TeamIntelligenceUserSummary['overallConfidence'];
  executiveSummary: TeamIntelligenceUserSummary['executiveSummary'];
  managerSummaryBullets: TeamIntelligenceUserSummary['managerSummaryBullets'];
}

type UserSourceKey =
  | 'pullRequests'
  | 'soloCommits'
  | 'aiUsage'
  | 'tickets'
  | 'conversations'
  | 'calls'
  | 'canvases';

type UserDigestFactKey =
  | 'activeWorkFacts'
  | 'blockerFacts'
  | 'decisionFacts'
  | 'riskFacts'
  | 'loadFocusFacts'
  | 'directionalSignals'
  | 'dependencies'
  | 'unknowns';

interface UserSectionSourceConfig {
  sourceKeys: UserSourceKey[];
  digestFactKeys: UserDigestFactKey[];
}

const USER_SOURCE_KEYS: UserSourceKey[] = [
  'pullRequests',
  'soloCommits',
  'aiUsage',
  'tickets',
  'conversations',
  'calls',
  'canvases',
];

const USER_SECTION_SOURCE_CONFIG: Record<string, UserSectionSourceConfig> = {
  'who-is-doing-what': {
    sourceKeys: ['pullRequests', 'soloCommits', 'aiUsage', 'tickets', 'conversations', 'calls'],
    digestFactKeys: ['activeWorkFacts'],
  },
  'needs-unblocking': {
    sourceKeys: ['tickets', 'conversations', 'calls'],
    digestFactKeys: ['blockerFacts', 'dependencies'],
  },
  'critical-and-moving': {
    sourceKeys: ['pullRequests', 'soloCommits', 'aiUsage', 'tickets', 'conversations', 'calls'],
    digestFactKeys: ['activeWorkFacts', 'blockerFacts', 'riskFacts', 'directionalSignals'],
  },
  'momentum-and-direction': {
    sourceKeys: ['pullRequests', 'soloCommits', 'aiUsage', 'tickets', 'conversations', 'calls'],
    digestFactKeys: [
      'activeWorkFacts',
      'blockerFacts',
      'riskFacts',
      'directionalSignals',
      'dependencies',
    ],
  },
  'decisions-and-alignment': {
    sourceKeys: ['tickets', 'conversations', 'calls'],
    digestFactKeys: ['decisionFacts'],
  },
  'people-load-focus-and-gaps': {
    sourceKeys: ['aiUsage', 'tickets', 'conversations', 'calls'],
    digestFactKeys: ['loadFocusFacts', 'blockerFacts', 'dependencies'],
  },
  'upcoming-and-at-risk': {
    sourceKeys: ['tickets', 'conversations', 'calls'],
    digestFactKeys: ['riskFacts', 'dependencies'],
  },
  'manager-attention': {
    sourceKeys: ['tickets', 'conversations', 'calls'],
    digestFactKeys: ['blockerFacts', 'riskFacts', 'decisionFacts', 'dependencies'],
  },
  'team-signals': {
    sourceKeys: ['pullRequests', 'soloCommits', 'aiUsage', 'tickets', 'conversations', 'calls'],
    digestFactKeys: ['activeWorkFacts', 'directionalSignals', 'dependencies'],
  },
  unknowns: {
    sourceKeys: [],
    digestFactKeys: ['unknowns'],
  },
  'final-dependent-summary': {
    sourceKeys: [],
    digestFactKeys: [],
  },
};

const RAW_PROMPT_SOURCE_CHAR_LIMIT = 160_000;
const EVIDENCE_CHUNK_CHAR_LIMIT = 70_000;
const LARGE_TEXT_SEGMENT_CHARS = 45_000;

async function llmGenerate(
  llmClient: LLMClient,
  prompt: string,
  options: LlmGenerateOptions
): Promise<string> {
  const startedAt = Date.now();
  logger.info('[TEAM-INTEL-SUMMARY] LLM call started', {
    purpose: options.purpose,
    promptChars: prompt.length,
  });

  try {
    return await withTeamIntelligenceLlmSlot(
      { scope: 'user', purpose: options.purpose, promptChars: prompt.length },
      async () => {
        const response = await llmClient.generateStream({
          model: appConfig.teamIntelligence.model,
          messages: [createUserMessage(prompt)],
        });
        const finalMessagePromise = response.finalMessage.catch((error) => {
          logger.warn('[TEAM-INTEL-SUMMARY] Streaming final message accumulation failed', {
            purpose: options.purpose,
            error,
          });
          return null;
        });
        let chunkCount = 0;
        let contentChunkCount = 0;
        let thinkingChunkCount = 0;
        let streamedThinkingChars = 0;
        let finalFinishReason: string | undefined;
        let streamedContent = '';
        let streamError: unknown = null;
        try {
          for await (const chunk of response.stream) {
            chunkCount += 1;
            if (chunk.type === 'content' && chunk.content) {
              contentChunkCount += 1;
              streamedContent += chunk.content;
            }
            if (chunk.type === 'thinking' && chunk.thinking) {
              thinkingChunkCount += 1;
              streamedThinkingChars += chunk.thinking.length;
            }
            if (chunk.metadata?.finishReason) {
              finalFinishReason = chunk.metadata.finishReason;
            }
            if (chunk.type === 'error' && chunk.error) {
              throw new Error(chunk.error);
            }
          }
        } catch (error) {
          streamError = error;
        }
        const finalMessage = await finalMessagePromise;
        const content = (finalMessage?.content || streamedContent).trim();
        if (streamError && content) {
          logger.warn('[TEAM-INTEL-SUMMARY] Using streamed content after stream error', {
            purpose: options.purpose,
            durationMs: Date.now() - startedAt,
            responseChars: content.length,
            error: streamError,
          });
        }
        if (streamError && !content) {
          throw streamError;
        }
        if (!content) {
          throw new Error(
            `LLM returned an empty response (chunks=${chunkCount}, contentChunks=${contentChunkCount}, thinkingChunks=${thinkingChunkCount}, thinkingChars=${streamedThinkingChars}, finishReason=${finalFinishReason ?? 'unknown'})`
          );
        }
        logger.info('[TEAM-INTEL-SUMMARY] LLM call completed', {
          purpose: options.purpose,
          durationMs: Date.now() - startedAt,
          chunkCount,
          contentChunkCount,
          thinkingChunkCount,
          finishReason: finalFinishReason,
          responseChars: content.length,
        });
        return content;
      }
    );
  } catch (error) {
    logger.error(
      '[TEAM-INTEL-SUMMARY] LLM call failed; section fallback will decide whether to retry, use text, or blank the section',
      {
        purpose: options.purpose,
        durationMs: Date.now() - startedAt,
        promptChars: prompt.length,
        error,
      }
    );
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM summary generation failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

function normalizeCodeEvidence(
  pullRequestsInput: unknown,
  soloCommitsInput: unknown,
  aiUsageInput: unknown
): {
  pullRequests: Array<TeamIntelligencePullRequestInput & { evidenceId: string }>;
  soloCommits: Array<TeamIntelligenceCommitInput & { evidenceId: string }>;
  aiUsage: (TeamIntelligenceAiUsageInput & { evidenceId: string }) | null;
} {
  const pullRequests = asArray<TeamIntelligencePullRequestInput>(pullRequestsInput).map((pr) => ({
    evidenceId: `pull-request:${pr.source}:${pr.prId}`,
    ...pr,
    commits: asArray<TeamIntelligenceCommitInput>(pr.commits).map((commit) => ({
      evidenceId: `commit:${commit.commitId}`,
      ...commit,
    })),
  }));
  const soloCommits = asArray<TeamIntelligenceCommitInput>(soloCommitsInput).map((commit) => ({
    evidenceId: `commit:${commit.commitId}`,
    ...commit,
  }));
  const aiUsage =
    aiUsageInput && typeof aiUsageInput === 'object' && !Array.isArray(aiUsageInput)
      ? {
          evidenceId: 'ai-usage:report-date',
          ...(aiUsageInput as TeamIntelligenceAiUsageInput),
        }
      : null;

  return { pullRequests, soloCommits, aiUsage };
}

function jsonCharLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function omitKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.has(key)));
}

function splitText(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) {
    return [value];
  }

  const segments: string[] = [];
  for (let start = 0; start < value.length; start += maxChars) {
    segments.push(value.slice(start, start + maxChars));
  }
  return segments;
}

function chunkItemsBySize<T>(
  items: T[],
  buildSourceData: (chunkItems: T[]) => Record<string, unknown>,
  maxChars: number
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];

  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && jsonCharLength(buildSourceData(candidate)) > maxChars) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function splitConversationForChunks(item: unknown): unknown[] {
  const record = asRecord(item);
  const messages = asArray(record.messages);
  if (messages.length === 0) {
    return [item];
  }

  const base = omitKeys(record, ['messages']);
  const messageGroups = chunkItemsBySize(
    messages,
    (group) => ({ conversations: [{ ...base, messages: group }] }),
    EVIDENCE_CHUNK_CHAR_LIMIT
  );

  return messageGroups.map((messagesInWindow, index) => ({
    ...base,
    messageWindow: {
      windowIndex: index + 1,
      totalWindows: messageGroups.length,
      totalMessages: messages.length,
    },
    messages: messagesInWindow,
  }));
}

function splitTicketForChunks(item: unknown): unknown[] {
  const record = asRecord(item);
  const activities = asArray(record.activities);
  const description = typeof record.description === 'string' ? record.description : null;
  const chunks: unknown[] = [];

  if (description && description.length > LARGE_TEXT_SEGMENT_CHARS) {
    const base = {
      ...record,
      activities: [],
    };
    const segments = splitText(description, LARGE_TEXT_SEGMENT_CHARS);
    chunks.push(
      ...segments.map((segment, index) => ({
        ...base,
        description: segment,
        descriptionSegment: {
          segmentIndex: index + 1,
          totalSegments: segments.length,
          originalCharLength: description.length,
        },
      }))
    );
  }

  if (activities.length > 0) {
    const base = {
      ...omitKeys(record, ['activities']),
      ...(description && description.length > LARGE_TEXT_SEGMENT_CHARS
        ? { description: '[description split into descriptionSegment chunks]' }
        : {}),
    };
    const activityGroups = chunkItemsBySize(
      activities,
      (group) => ({ tickets: [{ ...base, activities: group }] }),
      EVIDENCE_CHUNK_CHAR_LIMIT
    );
    chunks.push(
      ...activityGroups.map((activitiesInWindow, index) => ({
        ...base,
        activityWindow: {
          windowIndex: index + 1,
          totalWindows: activityGroups.length,
          totalActivities: activities.length,
        },
        activities: activitiesInWindow,
      }))
    );
  }

  return chunks.length > 0 ? chunks : [item];
}

function splitCallForChunks(item: unknown): unknown[] {
  const record = asRecord(item);
  const transcript = typeof record.transcript === 'string' ? record.transcript : null;
  const aiSummary = typeof record.aiSummary === 'string' ? record.aiSummary : null;
  const chunks: unknown[] = [];

  if (transcript && transcript.length > LARGE_TEXT_SEGMENT_CHARS) {
    const segments = splitText(transcript, LARGE_TEXT_SEGMENT_CHARS);
    chunks.push(
      ...segments.map((segment, index) => ({
        ...record,
        transcript: segment,
        ...(aiSummary && aiSummary.length > LARGE_TEXT_SEGMENT_CHARS
          ? { aiSummary: '[aiSummary split into aiSummarySegment chunks]' }
          : {}),
        transcriptSegment: {
          segmentIndex: index + 1,
          totalSegments: segments.length,
          originalCharLength: transcript.length,
        },
      }))
    );
  }

  if (aiSummary && aiSummary.length > LARGE_TEXT_SEGMENT_CHARS) {
    const segments = splitText(aiSummary, LARGE_TEXT_SEGMENT_CHARS);
    chunks.push(
      ...segments.map((segment, index) => ({
        ...record,
        ...(transcript && transcript.length > LARGE_TEXT_SEGMENT_CHARS
          ? { transcript: '[transcript split into transcriptSegment chunks]' }
          : {}),
        aiSummary: segment,
        aiSummarySegment: {
          segmentIndex: index + 1,
          totalSegments: segments.length,
          originalCharLength: aiSummary.length,
        },
      }))
    );
  }

  return chunks.length > 0 ? chunks : [item];
}

function splitCanvasVersionForChunks(item: unknown): unknown[] {
  const record = asRecord(item);
  const content = typeof record.content === 'string' ? record.content : null;
  if (!content || content.length <= LARGE_TEXT_SEGMENT_CHARS) {
    return [item];
  }

  const segments = splitText(content, LARGE_TEXT_SEGMENT_CHARS);
  return segments.map((segment, index) => ({
    ...record,
    content: segment,
    contentSegment: {
      segmentIndex: index + 1,
      totalSegments: segments.length,
      originalCharLength: content.length,
    },
  }));
}

function splitCanvasForChunks(item: unknown): unknown[] {
  const record = asRecord(item);
  const versions = asArray(record.versions).flatMap((version) =>
    splitCanvasVersionForChunks(version)
  );
  const content = typeof record.content === 'string' ? record.content : null;
  const chunks: unknown[] = [];

  if (content && content.length > LARGE_TEXT_SEGMENT_CHARS) {
    const base = omitKeys(record, ['versions']);
    const segments = splitText(content, LARGE_TEXT_SEGMENT_CHARS);
    chunks.push(
      ...segments.map((segment, index) => ({
        ...base,
        content: segment,
        contentSegment: {
          segmentIndex: index + 1,
          totalSegments: segments.length,
          originalCharLength: content.length,
        },
        versions: [],
      }))
    );
  }

  if (versions.length > 0) {
    const base = {
      ...omitKeys(record, ['versions']),
      ...(content && content.length > LARGE_TEXT_SEGMENT_CHARS
        ? { content: '[content split into contentSegment chunks]' }
        : {}),
    };
    const versionGroups = chunkItemsBySize(
      versions,
      (group) => ({ canvases: [{ ...base, versions: group }] }),
      EVIDENCE_CHUNK_CHAR_LIMIT
    );
    chunks.push(
      ...versionGroups.map((versionsInWindow, index) => ({
        ...base,
        versionWindow: {
          windowIndex: index + 1,
          totalWindows: versionGroups.length,
          totalVersions: versions.length,
        },
        versions: versionsInWindow,
      }))
    );
  }

  return chunks.length > 0 ? chunks : [item];
}

function splitEvidenceItemForChunks(sourceKey: string, item: unknown): unknown[] {
  const fullSize = jsonCharLength({ [sourceKey]: [item] });
  if (fullSize <= EVIDENCE_CHUNK_CHAR_LIMIT) {
    return [item];
  }

  switch (sourceKey) {
    case 'tickets':
      return splitTicketForChunks(item);
    case 'conversations':
      return splitConversationForChunks(item);
    case 'calls':
      return splitCallForChunks(item);
    case 'canvases':
      return splitCanvasForChunks(item);
    default:
      return [item];
  }
}

function buildEvidenceChunks(sourceData: Record<string, unknown>): EvidenceChunk[] {
  const chunks: EvidenceChunk[] = [];
  const sourceConfigs = [
    { sourceKey: 'pullRequests', sourceType: 'PULL_REQUEST' },
    { sourceKey: 'soloCommits', sourceType: 'COMMIT' },
    { sourceKey: 'tickets', sourceType: 'TICKET' },
    { sourceKey: 'conversations', sourceType: 'CONVERSATION' },
    { sourceKey: 'calls', sourceType: 'CALL' },
    { sourceKey: 'canvases', sourceType: 'CANVAS' },
  ];

  if (sourceData.aiUsage) {
    const chunkSourceData = { aiUsage: sourceData.aiUsage };
    chunks.push({
      chunkId: 'aiUsage-1',
      sourceType: 'AI_USAGE',
      sourceKey: 'aiUsage',
      itemCount: 1,
      charLength: jsonCharLength(chunkSourceData),
      sourceData: chunkSourceData,
    });
  }

  for (const { sourceKey, sourceType } of sourceConfigs) {
    const items = asArray(sourceData[sourceKey]).flatMap((item) =>
      splitEvidenceItemForChunks(sourceKey, item)
    );
    if (items.length === 0) {
      continue;
    }

    const itemGroups = chunkItemsBySize(
      items,
      (group) => ({ [sourceKey]: group }),
      EVIDENCE_CHUNK_CHAR_LIMIT
    );

    itemGroups.forEach((group, index) => {
      const chunkSourceData = { [sourceKey]: group };
      chunks.push({
        chunkId: `${sourceKey}-${index + 1}`,
        sourceType,
        sourceKey,
        itemCount: group.length,
        charLength: jsonCharLength(chunkSourceData),
        sourceData: chunkSourceData,
      });
    });
  }

  return chunks;
}

function collectSourceCounts(sourceData: Record<string, unknown>): Record<string, number> {
  return {
    pullRequests: asArray(sourceData.pullRequests).length,
    soloCommits: asArray(sourceData.soloCommits).length,
    tickets: asArray(sourceData.tickets).length,
    conversations: asArray(sourceData.conversations).length,
    calls: asArray(sourceData.calls).length,
    canvases: asArray(sourceData.canvases).length,
    aiUsage: sourceData.aiUsage ? 1 : 0,
  };
}

function parseChunkDigest(raw: string, chunk: EvidenceChunk): Record<string, unknown> {
  try {
    const parsed = parseLlmJson(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        chunkId: chunk.chunkId,
        sourceType: chunk.sourceType,
        sourceKey: chunk.sourceKey,
        itemCount: chunk.itemCount,
        ...(parsed as Record<string, unknown>),
      };
    }
  } catch {
    // Keep the raw chunk digest below; the final synthesis prompt can still use it.
  }

  return {
    chunkId: chunk.chunkId,
    sourceType: chunk.sourceType,
    sourceKey: chunk.sourceKey,
    itemCount: chunk.itemCount,
    rawDigest: raw,
  };
}

function buildEvidenceChunkPrompt(input: {
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  source: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  chunk: EvidenceChunk;
}): string {
  const llmInput = {
    schemaVersion: '1.0',
    scope: 'USER_DAILY_EVIDENCE_CHUNK',
    request: {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      source: input.source,
      reportDate: input.reportDate,
    },
    user: {
      id: input.evidence.user.id,
      email: input.evidence.user.email,
      name: input.userName || input.evidence.user.name,
      role: input.evidence.user.role,
      teamId: input.teamId,
      teamName: input.teamName,
    },
    chunk: {
      chunkId: input.chunk.chunkId,
      sourceType: input.chunk.sourceType,
      sourceKey: input.chunk.sourceKey,
      itemCount: input.chunk.itemCount,
      charLength: input.chunk.charLength,
    },
    sourceData: input.chunk.sourceData,
  };

  return [
    'You are extracting detailed, evidence-backed facts from one chunk of raw daily Team Intelligence data.',
    'This is NOT the final manager brief. Preserve enough concrete detail for later synthesis, but only for facts that pass the importance gate below.',
    '',
    'Rules:',
    '- Use only the supplied chunk.',
    '- Every extracted fact must cite exact evidenceId values from the chunk.',
    '- Preserve concrete names, projects, statuses, dates, blockers, decisions, dependencies, risks, and next steps only when they could materially change a manager decision or understanding.',
    '- Optimize for signal, not coverage. Large input volume must not produce a long inventory of routine activity.',
    '- Keep only candidate facts involving a meaningful outcome, goal movement, material change, blocker, risk, decision, dependency, ownership/load concern, or required action.',
    '- Omit routine updates, raw activity counts, minor implementation detail, social chatter, repeated evidence, and facts whose absence would not change a manager action or conclusion.',
    '- Never use PR numbers, commit hashes, ticket IDs, file counts, or line addition/deletion tallies as the substance of a fact. Describe what was built or decided, not artifact metadata.',
    '- Rank candidates by impact, urgency, and evidence strength. Return at most 5 items in each fact array; fewer or none is preferred when evidence is not important.',
    '- Do not judge performance. Describe visible work state and evidence.',
    '- If the chunk has no useful manager signal, return empty arrays rather than filler.',
    '',
    'Return one valid JSON object only with this shape:',
    JSON.stringify({
      chunkId: input.chunk.chunkId,
      sourceType: input.chunk.sourceType,
      activeWorkFacts: [
        {
          title: 'string',
          detail: 'string',
          status: 'PLANNED|IN_PROGRESS|BLOCKED|COMPLETED|UNKNOWN',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      blockerFacts: [
        {
          title: 'string',
          detail: 'string',
          severity: 'CRITICAL|HIGH|MEDIUM|LOW',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      decisionFacts: [
        {
          decision: 'string',
          context: 'string',
          impact: 'string',
          participants: ['string'],
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      riskFacts: [
        {
          title: 'string',
          detail: 'string',
          expectedDate: 'ISO-8601 string or null',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      loadFocusFacts: [
        {
          detail: 'string',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      directionalSignals: [
        {
          signal: 'string',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      dependencies: [
        {
          description: 'string',
          status: 'OPEN|BLOCKED|AT_RISK|RESOLVED|UNCLEAR',
          dependsOn: 'string or null',
          evidenceRefs: [
            {
              evidenceId: 'exact input evidenceId',
              sourceType: input.chunk.sourceType,
              reason: 'string',
            },
          ],
        },
      ],
      unknowns: [{ question: 'string', reason: 'string' }],
    }),
    '',
    'INPUT:',
    JSON.stringify(llmInput),
  ].join('\n');
}

function buildDigestMergePrompt(input: {
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  round: number;
  batchIndex: number;
  batchCount: number;
  digests: Record<string, unknown>[];
}): string {
  const llmInput = {
    schemaVersion: '1.0',
    scope: 'USER_DAILY_EVIDENCE_DIGEST_MERGE',
    request: {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      reportDate: input.reportDate,
    },
    user: {
      id: input.evidence.user.id,
      email: input.evidence.user.email,
      name: input.userName || input.evidence.user.name,
      role: input.evidence.user.role,
      teamId: input.teamId,
      teamName: input.teamName,
    },
    merge: {
      round: input.round,
      batchIndex: input.batchIndex,
      batchCount: input.batchCount,
      digestCount: input.digests.length,
    },
    digests: input.digests,
  };

  return [
    'You are merging detailed Team Intelligence evidence digests so a final manager brief can fit in one prompt.',
    'Preserve only decision-relevant concrete facts and their exact evidenceId references: material outcomes, goal movement, blockers, decisions, dependencies, risks, ownership/load concerns, and required next steps.',
    'Remove duplicates only when they clearly describe the same underlying evidence-backed fact.',
    'Do not introduce any evidenceId that is not present in the supplied digests.',
    'Optimize for signal, not coverage. Rank by impact, urgency, and evidence strength; retain at most 5 items per fact array and drop routine, low-impact, stale, weak, or redundant facts.',
    'Never surface facts framed as PR numbers, commit hashes, ticket IDs, file counts, or line addition/deletion tallies. Keep what was built, decided, or changed and why it matters, not artifact metadata.',
    '',
    'Return one valid JSON object only with this shape:',
    JSON.stringify({
      mergeId: `round_${input.round}_batch_${input.batchIndex}`,
      activeWorkFacts: [],
      blockerFacts: [],
      decisionFacts: [],
      riskFacts: [],
      loadFocusFacts: [],
      directionalSignals: [],
      dependencies: [],
      unknowns: [],
    }),
    '',
    'INPUT:',
    JSON.stringify(llmInput),
  ].join('\n');
}

async function reduceDigestsForFinalPrompt(input: {
  llmClient: LLMClient;
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  digests: Record<string, unknown>[];
  makeSourceData: (
    digests: Record<string, unknown>[],
    reductionRounds: number
  ) => Record<string, unknown>;
}): Promise<{ digests: Record<string, unknown>[]; reductionRounds: number }> {
  let digests = input.digests;
  let reductionRounds = 0;

  while (
    jsonCharLength(input.makeSourceData(digests, reductionRounds)) > RAW_PROMPT_SOURCE_CHAR_LIMIT &&
    digests.length > 1 &&
    reductionRounds < 2
  ) {
    reductionRounds += 1;
    const digestGroups = chunkItemsBySize(
      digests,
      (group) => ({ digests: group }),
      EVIDENCE_CHUNK_CHAR_LIMIT
    );

    logger.info('[TEAM-INTEL-SUMMARY] Merging chunk digests to fit final prompt budget', {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      reductionRounds,
      previousDigestCount: digests.length,
      mergeBatchCount: digestGroups.length,
    });

    const mergedDigests = await mapWithConcurrency(
      Array.from(digestGroups.entries()),
      3,
      async (entry) => {
        const [index, group] = entry;
        const rawDigest = await llmGenerate(
          input.llmClient,
          buildDigestMergePrompt({
            ...input,
            round: reductionRounds,
            batchIndex: index + 1,
            batchCount: digestGroups.length,
            digests: group,
          }),
          {
            purpose: `user-evidence-digest-merge:round-${reductionRounds}:batch-${index + 1}`,
          }
        );
        return parseChunkDigest(rawDigest, {
          chunkId: `digest-merge-${reductionRounds}-${index + 1}`,
          sourceType: 'MERGED_DIGEST',
          sourceKey: 'digests',
          itemCount: group.length,
          charLength: jsonCharLength({ digests: group }),
          sourceData: { digests: group },
        });
      }
    );

    digests = mergedDigests;
  }

  return { digests, reductionRounds };
}

async function buildPromptSourceData(input: {
  llmClient: LLMClient;
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  source: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  sourceData: Record<string, unknown>;
}): Promise<PromptSourceDataResult> {
  const rawSourceChars = jsonCharLength(input.sourceData);
  const sourceCounts = collectSourceCounts(input.sourceData);
  if (rawSourceChars <= RAW_PROMPT_SOURCE_CHAR_LIMIT) {
    return {
      sourceData: input.sourceData,
      profile: {
        mode: 'RAW_SOURCE_DATA',
        rawSourceChars,
        sourceCounts,
      },
    };
  }

  const chunks = buildEvidenceChunks(input.sourceData);
  logger.info('[TEAM-INTEL-SUMMARY] Raw evidence exceeds prompt budget; extracting chunk digests', {
    batchId: input.batchId,
    userIngestionId: input.userIngestionId,
    rawSourceChars,
    chunkCount: chunks.length,
    sourceCounts,
  });

  const digests = await mapWithConcurrency(chunks, 3, async (chunk) => {
    const rawDigest = await llmGenerate(
      input.llmClient,
      buildEvidenceChunkPrompt({ ...input, chunk }),
      {
        purpose: `user-evidence-chunk:${chunk.chunkId}`,
      }
    );
    return parseChunkDigest(rawDigest, chunk);
  });

  const makeChunkedSourceData = (
    currentDigests: Record<string, unknown>[],
    reductionRounds: number
  ) => ({
    mode: 'CHUNKED_EVIDENCE_DIGEST',
    notice:
      'Raw evidence was too large for one prompt. The full raw sourceData is stored with the generated summary; this prompt input contains detailed chunk-level extracted facts with original evidenceId references.',
    originalSourceCounts: sourceCounts,
    rawSourceChars,
    chunkCount: chunks.length,
    reductionRounds,
    chunks: currentDigests,
  });

  const reduced = await reduceDigestsForFinalPrompt({
    ...input,
    digests,
    makeSourceData: makeChunkedSourceData,
  });
  const chunkedSourceData = makeChunkedSourceData(reduced.digests, reduced.reductionRounds);

  return {
    sourceData: chunkedSourceData,
    profile: {
      mode: 'CHUNKED_EVIDENCE_DIGEST',
      rawSourceChars,
      promptSourceChars: jsonCharLength(chunkedSourceData),
      chunkCount: chunks.length,
      digestCount: reduced.digests.length,
      reductionRounds: reduced.reductionRounds,
      sourceCounts,
    },
  };
}

const NON_SIGNAL_STRINGS = new Set([
  '',
  'UNKNOWN',
  'UNCLEAR',
  'INSUFFICIENT_EVIDENCE',
  'INSUFFICIENT_BASELINE',
]);

function hasPromptSignal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return !NON_SIGNAL_STRINGS.has(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some((item) => hasPromptSignal(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => hasPromptSignal(item));
  }
  return false;
}

function buildUserSectionSource(
  sourceData: Record<string, unknown>,
  sectionName: string
): Record<string, unknown> {
  const config = USER_SECTION_SOURCE_CONFIG[sectionName] ?? {
    sourceKeys: USER_SOURCE_KEYS,
    digestFactKeys: [
      'activeWorkFacts',
      'blockerFacts',
      'decisionFacts',
      'riskFacts',
      'loadFocusFacts',
      'directionalSignals',
      'dependencies',
      'unknowns',
    ],
  };
  const originalSourceCounts =
    sourceData.originalSourceCounts &&
    typeof sourceData.originalSourceCounts === 'object' &&
    !Array.isArray(sourceData.originalSourceCounts)
      ? sourceData.originalSourceCounts
      : collectSourceCounts(sourceData);
  const sourceMode = typeof sourceData.mode === 'string' ? sourceData.mode : 'RAW_SOURCE_DATA';
  const sourceSelection: Record<string, unknown> = {
    sectionName,
    sourceMode,
    includedSourceKeys: config.sourceKeys,
    includedDigestFactKeys: config.digestFactKeys,
    originalSourceCounts,
  };

  if (sourceMode === 'CHUNKED_EVIDENCE_DIGEST') {
    const chunks = asArray<Record<string, unknown>>(sourceData.chunks)
      .map((chunk) => {
        const selectedChunk: Record<string, unknown> = {
          chunkId: chunk.chunkId,
          sourceType: chunk.sourceType,
          sourceKey: chunk.sourceKey,
          itemCount: chunk.itemCount,
        };
        let hasSelectedFacts = false;
        for (const factKey of config.digestFactKeys) {
          const value = chunk[factKey];
          if (hasPromptSignal(value)) {
            selectedChunk[factKey] = value;
            hasSelectedFacts = true;
          }
        }
        const rawChunkSourceKey = typeof chunk.sourceKey === 'string' ? chunk.sourceKey : '';
        const rawDigestMatchesSource =
          rawChunkSourceKey !== 'digests' &&
          config.sourceKeys.includes(rawChunkSourceKey as UserSourceKey);
        if (!hasSelectedFacts && rawDigestMatchesSource && hasPromptSignal(chunk.rawDigest)) {
          selectedChunk.rawDigest = chunk.rawDigest;
          hasSelectedFacts = true;
        }
        return hasSelectedFacts ? selectedChunk : null;
      })
      .filter((chunk): chunk is Record<string, unknown> => chunk !== null);

    sourceSelection.includedChunks = chunks.length;
    sourceSelection.omittedChunksWithoutRelevantSignals =
      asArray(sourceData.chunks).length - chunks.length;

    return {
      mode: 'CHUNKED_EVIDENCE_DIGEST_SECTION_SOURCE',
      notice:
        'This sourceData is filtered for one section. Other source groups are intentionally omitted from this prompt.',
      sourceSelection,
      rawSourceChars: sourceData.rawSourceChars,
      chunkCount: sourceData.chunkCount,
      chunks,
    };
  }

  const selectedSource: Record<string, unknown> = {
    sourceSelection,
  };
  let includedSourceItemGroups = 0;
  for (const sourceKey of config.sourceKeys) {
    const value = sourceData[sourceKey];
    if (hasPromptSignal(value)) {
      selectedSource[sourceKey] = value;
      includedSourceItemGroups += 1;
    }
  }
  sourceSelection.includedSourceItemGroups = includedSourceItemGroups;
  sourceSelection.omittedSourceKeys = USER_SOURCE_KEYS.filter(
    (sourceKey) => !config.sourceKeys.includes(sourceKey)
  );
  return selectedSource;
}

function collectEvidenceIds(value: unknown, evidenceIds = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceIds(item, evidenceIds);
    }
    return evidenceIds;
  }
  if (!value || typeof value !== 'object') {
    return evidenceIds;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.evidenceId === 'string' && record.evidenceId.trim()) {
    evidenceIds.add(record.evidenceId);
  }
  for (const child of Object.values(record)) {
    collectEvidenceIds(child, evidenceIds);
  }
  return evidenceIds;
}

function collectSummaryEvidenceReferences(summary: TeamIntelligenceUserSummary): string[] {
  const refs = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.evidenceId === 'string' &&
      typeof record.sourceType === 'string' &&
      typeof record.reason === 'string'
    ) {
      refs.add(record.evidenceId);
    }
    Object.values(record).forEach(visit);
  };
  visit(summary);
  return [...refs];
}

function assertEvidenceReferences(
  summary: TeamIntelligenceUserSummary,
  sourceData: Record<string, unknown>
): void {
  const availableEvidenceIds = collectEvidenceIds(sourceData);
  const unknownEvidenceIds = collectSummaryEvidenceReferences(summary).filter(
    (evidenceId) => !availableEvidenceIds.has(evidenceId)
  );
  if (unknownEvidenceIds.length > 0) {
    logger.warn(
      '[TEAM-INTEL-SUMMARY] Ignoring invalid generated user summary evidence references',
      {
        batchId: summary.batchId,
        userIngestionId: summary.userIngestionId,
        userEmail: summary.user.email,
        unknownEvidenceIds,
      }
    );
  }
}

function assertSummaryIdentity(
  summary: TeamIntelligenceUserSummary,
  expected: {
    batchId: string;
    userIngestionId: string;
    reportDate: string;
    userId: string;
    userEmail: string;
    userName: string;
    teamId: string | null;
    teamName: string | null;
  }
): void {
  const matches =
    summary.batchId === expected.batchId &&
    summary.userIngestionId === expected.userIngestionId &&
    summary.reportDate === expected.reportDate &&
    summary.user.id === expected.userId &&
    summary.user.email.toLowerCase() === expected.userEmail.toLowerCase() &&
    summary.user.name === expected.userName &&
    summary.user.teamId === expected.teamId &&
    summary.user.teamName === expected.teamName;
  if (!matches) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM user summary changed immutable batch, date, or user identity fields'
    );
  }
}

function buildUserSectionPrompt(input: {
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  source: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  sourceData: Record<string, unknown>;
  section: UserPromptSection;
}): string {
  const llmInput = {
    schemaVersion: '1.0',
    scope: 'USER_DAILY_SUMMARY',
    request: {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      source: input.source,
      reportDate: input.reportDate,
      timezone: 'UTC',
      periodStart: `${input.reportDate}T00:00:00.000Z`,
      periodEnd: `${input.reportDate}T23:59:59.999Z`,
    },
    user: {
      id: input.evidence.user.id,
      email: input.evidence.user.email,
      name: input.userName || input.evidence.user.name,
      role: input.evidence.user.role,
      teamId: input.teamId,
      teamName: input.teamName,
      workspaceId: input.evidence.user.workspaceId,
      organizationId: input.evidence.user.organizationId,
    },
    sourceData: input.sourceData,
  };

  return [
    'You are producing one focused section of a daily, evidence-backed manager brief for exactly one person.',
    'This is a stateless request scoped only to INPUT.request.batchId, INPUT.request.userIngestionId, and INPUT.user.',
    'Do not use memory, prior chat/session context, or data from another user, team, organization, or batch.',
    'The person may be an engineer, product manager, designer, operator, or another non-coding role.',
    'Pull requests and commits may be empty. Empty code arrays never imply inactivity.',
    'Use every supplied source type when it contains useful evidence: pull requests, commits, AI usage, tickets, ticket activity, conversations, messages, calls, canvases, and canvas versions.',
    'INPUT.sourceData may be raw source data or CHUNKED_EVIDENCE_DIGEST. When it is CHUNKED_EVIDENCE_DIGEST, use the chunk facts as detailed evidence extracted from the full raw sourceData and cite the original evidenceId values contained in those facts.',
    '',
    'Evidence and safety rules:',
    '- Base every factual insight only on the supplied input.',
    '- Prefer simple qualitative content: title/text/description/priority/status. Evidence IDs are optional; when provided, they must be exact evidenceId values from the input.',
    '- Never invent an evidenceId, deadline, blocker, owner, decision, participant, priority, or project.',
    '- Do not equate no commits with no work, low productivity, light load, or idleness.',
    '- Use INSUFFICIENT_EVIDENCE where the input cannot support an assessment.',
    '- Distinguish completed work from current work and planned work.',
    '- Avoid judging individual performance. Describe visible work state, load, focus, dependencies, and risk.',
    '- All arrays must be empty when unsupported; never add placeholder objects.',
    '- Apply a mandatory importance gate: include an insight only when omitting it could cause the manager to miss a material outcome, meaningful goal movement, significant change, blocker, risk, unresolved decision, dependency, ownership/load concern, or concrete action.',
    '- Optimize for decision value, not coverage. Input volume must never increase output volume by itself.',
    '- Exclude routine status updates, ordinary completed tasks, raw activity counts, minor implementation details, duplicated signals, stale context with no current consequence, and weak inference.',
    '- Never describe work using PR numbers, commit hashes, ticket IDs, file counts, or line addition/deletion tallies. These are artifact identifiers, not insights.',
    '- Write about what was built, decided, or resolved and why it matters. Avoid phrases like "Merged PR #N", "N additions across M files", or "commit X". Instead describe the outcome: what capability was shipped, what problem was solved, what decision was made.',
    '- Completed work is important only when it creates a material outcome, advances a meaningful goal, changes risk, unlocks others, or requires recognition/leadership awareness; a PR, commit, ticket, call, or message is not important merely because it exists.',
    '- Treat missing data as one consolidated insight only when it materially changes confidence or requires corrective action. Never generate multiple bullets from the same visibility gap.',
    '- Rank candidates by impact, urgency, evidence strength, and actionability. Return only the strongest non-overlapping insights.',
    '- Unless this section explicitly requires fewer, return at most 3 top-level insight items per array. This cap does not apply to evidenceRefs/evidenceIds or identity/reference arrays inside a selected insight.',
    '- Empty or short output is correct when nothing crosses the importance threshold. Never fill space for completeness or symmetry.',
    '- Do not include immutable identity fields or unrelated sections in this fragment.',
    '',
    `SECTION: ${input.section.name}`,
    ...input.section.instructions,
    '',
    'Return one valid JSON object only. Do not use markdown fences or add prose.',
    'The first character must be { and the last character must be }.',
    'Return exactly the requested fragment fields using this shape and enum vocabulary:',
    JSON.stringify(input.section.outputShape),
    ...(input.section.priorSections
      ? [
          '',
          'Already generated section context for this same user only. Use these stable IDs when this section needs to reference prior generated items:',
          JSON.stringify(input.section.priorSections),
        ]
      : []),
    '',
    'INPUT:',
    JSON.stringify(llmInput),
  ].join('\n');
}

function buildUserIdentityFields(input: {
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
}): Pick<
  TeamIntelligenceUserSummary,
  'schemaVersion' | 'scope' | 'batchId' | 'userIngestionId' | 'reportDate' | 'user'
> {
  return {
    schemaVersion: '1.0',
    scope: 'USER_DAILY_SUMMARY',
    batchId: input.batchId,
    userIngestionId: input.userIngestionId,
    reportDate: input.reportDate,
    user: {
      id: input.evidence.user.id,
      email: input.evidence.user.email,
      name: input.userName || input.evidence.user.name,
      role: input.evidence.user.role,
      teamId: input.teamId,
      teamName: input.teamName,
    },
  };
}

type UserEvidenceRef =
  TeamIntelligenceUserSummary['whoIsDoingWhat'][number]['evidenceRefs'][number];
type UserWorkItem = TeamIntelligenceUserSummary['whoIsDoingWhat'][number];
type UserBlocker = TeamIntelligenceUserSummary['needsUnblocking'][number];
type UserCriticalWork = TeamIntelligenceUserSummary['criticalAndMoving'][number];
type UserDecision = TeamIntelligenceUserSummary['decisionsAndAlignment']['decisions'][number];
type UserGap = TeamIntelligenceUserSummary['peopleLoadFocusAndGaps']['gaps'][number];
type UserUpcomingRisk = TeamIntelligenceUserSummary['upcomingAndAtRisk'][number];
type UserDirectionalSignal =
  TeamIntelligenceUserSummary['teamSignals']['directionalSignals'][number];
type UserCapabilitySignal = TeamIntelligenceUserSummary['teamSignals']['capabilitySignals'][number];
type UserDependencySignal = TeamIntelligenceUserSummary['teamSignals']['dependencies'][number];

const USER_IMPORTANCE = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const USER_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const;
const USER_WORK_STATUS = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN'] as const;
const USER_BLOCKER_STATUS = ['OPEN', 'RESOLVED', 'UNCLEAR'] as const;
const USER_MOVEMENT = [
  'PROGRESSING',
  'PROGRESSING_WITH_RISK',
  'STALLED',
  'REGRESSING',
  'UNCLEAR',
] as const;
const USER_MOMENTUM = [
  'FORWARD',
  'FORWARD_WITH_BLOCKERS',
  'FLAT',
  'REGRESSING',
  'INSUFFICIENT_EVIDENCE',
] as const;
const USER_DIRECTION = [
  'TOWARD_STATED_GOALS',
  'MIXED_OR_UNCLEAR',
  'AWAY_FROM_STATED_GOALS',
  'INSUFFICIENT_EVIDENCE',
] as const;
const USER_ALIGNMENT = [
  'ALIGNED',
  'PARTIALLY_ALIGNED',
  'MISALIGNED',
  'INSUFFICIENT_EVIDENCE',
] as const;
const USER_LOAD = ['OVERLOADED', 'HIGH', 'BALANCED', 'LIGHT', 'INSUFFICIENT_EVIDENCE'] as const;
const USER_FOCUS = [
  'FOCUSED',
  'MOSTLY_FOCUSED',
  'FRAGMENTED',
  'HIGHLY_FRAGMENTED',
  'INSUFFICIENT_EVIDENCE',
] as const;
const USER_CONTEXT_RISK = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE'] as const;
const USER_GAP_TYPES = [
  'EXTERNAL_DEPENDENCY',
  'OWNERSHIP',
  'CAPACITY',
  'KNOWLEDGE',
  'DECISION',
  'VISIBILITY',
  'OTHER',
] as const;
const USER_SIGNAL_TYPES = [
  'DECLARED_GOAL',
  'INFERRED_DIRECTION',
  'TECHNICAL_WAVE',
  'BUSINESS_WAVE',
  'CUSTOMER_PROBLEM',
  'DIFFERENTIATION',
  'SUCCESS_MEASURE',
] as const;
const USER_CAPABILITY_TYPES = [
  'DEMONSTRATED',
  'DEVELOPING',
  'NEEDED',
  'MISSING',
  'INSUFFICIENT_EVIDENCE',
] as const;
const USER_DEPENDENCY_TYPES = [
  'TEAM_MEMBER',
  'EXTERNAL_TEAM',
  'PROCESS',
  'PLATFORM',
  'DECISION',
  'UNKNOWN',
] as const;
const USER_DEPENDENCY_STATUS = ['OPEN', 'BLOCKED', 'AT_RISK', 'RESOLVED', 'UNCLEAR'] as const;

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))];
  }
  const single = cleanString(value);
  return single ? [single] : [];
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  const normalized = cleanString(value).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function simpleRecords(
  value: unknown,
  keys: string[] = ['items', 'facts']
): Record<string, unknown>[] {
  const record = asRecord(value);
  for (const key of keys) {
    const items = asArray(record[key]).filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function userEvidenceSourceTypeFromId(evidenceId: string): UserEvidenceRef['sourceType'] | null {
  if (evidenceId.startsWith('pull-request:')) return 'PULL_REQUEST';
  if (evidenceId.startsWith('commit:')) return 'COMMIT';
  if (evidenceId.startsWith('ai-usage:')) return 'AI_USAGE';
  if (evidenceId.startsWith('ticket-activity:')) return 'TICKET_ACTIVITY';
  if (evidenceId.startsWith('ticket:')) return 'TICKET';
  if (evidenceId.startsWith('conversation:')) return 'CONVERSATION';
  if (evidenceId.startsWith('message:')) return 'MESSAGE';
  if (evidenceId.startsWith('call:')) return 'CALL';
  if (evidenceId.startsWith('canvas-version:')) return 'CANVAS_VERSION';
  if (evidenceId.startsWith('canvas:')) return 'CANVAS';
  return null;
}

function evidenceIdsFromFact(fact: Record<string, unknown>): string[] {
  const explicitIds = cleanStringArray(fact.evidenceIds);
  const nestedIds = asArray(fact.evidenceRefs)
    .map((ref) => cleanString(asRecord(ref).evidenceId))
    .filter(Boolean);
  const single = cleanString(fact.evidenceId);
  return [...new Set([...explicitIds, ...nestedIds, ...(single ? [single] : [])])];
}

function userEvidenceRefsFromFact(
  fact: Record<string, unknown>,
  availableEvidenceIds: Set<string>,
  fallbackReason: string
): UserEvidenceRef[] {
  return evidenceIdsFromFact(fact)
    .filter((evidenceId) => availableEvidenceIds.has(evidenceId))
    .map((evidenceId) => {
      const sourceType = userEvidenceSourceTypeFromId(evidenceId);
      if (!sourceType) {
        return null;
      }
      const nestedRef = asArray(fact.evidenceRefs)
        .map(asRecord)
        .find((ref) => cleanString(ref.evidenceId) === evidenceId);
      return {
        evidenceId,
        sourceType,
        reason: cleanString(nestedRef?.reason, cleanString(fact.reason, fallbackReason)),
      };
    })
    .filter((ref): ref is UserEvidenceRef => ref !== null);
}

function userEvidenceRefsFromIds(evidenceIds: string[], fallbackReason: string): UserEvidenceRef[] {
  return [...new Set(evidenceIds)]
    .map((evidenceId) => {
      const sourceType = userEvidenceSourceTypeFromId(evidenceId);
      if (!sourceType) {
        return null;
      }
      return {
        evidenceId,
        sourceType,
        reason: fallbackReason,
      };
    })
    .filter((ref): ref is UserEvidenceRef => ref !== null);
}

function buildUserSectionFallbackRefs(
  sectionSourceData: Record<string, unknown>,
  availableEvidenceIds: Set<string>
): UserEvidenceRef[] {
  return userEvidenceRefsFromIds(
    Array.from(collectEvidenceIds(sectionSourceData))
      .filter((evidenceId) => availableEvidenceIds.has(evidenceId))
      .slice(0, 5),
    'Source evidence from this user section payload'
  );
}

function existingIds(values: unknown, allowedIds: Set<string>): string[] {
  return cleanStringArray(values).filter((id) => allowedIds.has(id));
}

function idsMatchingTitles(
  titles: string[],
  items: Array<{ id: string; title: string }>
): string[] {
  const normalizedTitles = new Set(titles.map((title) => title.toLowerCase()));
  return items
    .filter((item) => normalizedTitles.has(item.title.toLowerCase()))
    .map((item) => item.id);
}

function userWorkRefsFromFact(fact: Record<string, unknown>, workItems: UserWorkItem[]): string[] {
  const workIds = new Set(workItems.map((item) => item.id));
  const direct = existingIds(
    fact.workIds ?? fact.relatedWorkIds ?? fact.blockedWorkIds ?? fact.affectedWorkIds,
    workIds
  );
  if (direct.length > 0) {
    return direct;
  }
  return idsMatchingTitles(
    cleanStringArray(
      fact.workTitles ?? fact.relatedWorkTitles ?? fact.affectedWorkTitles ?? fact.affectedWorkTitle
    ),
    workItems
  );
}

/** Maximum member-brief bullets kept after generation. Prevents a per-activity
 * firehose — only the most important person-specific takeaways should survive. */
const MAX_USER_SUMMARY_BULLETS = 7;

function compactBullets(value: unknown, fallback: string): string[] {
  const record = asRecord(value);
  const rawItems = record.managerSummaryBullets ?? record.bullets ?? record.items;
  const bullets = (
    Array.isArray(rawItems)
      ? rawItems.map((item) =>
          typeof item === 'string'
            ? item
            : cleanString(asRecord(item).text ?? asRecord(item).summary ?? asRecord(item).title)
        )
      : cleanStringArray(rawItems)
  )
    .map((bullet) => bullet.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_USER_SUMMARY_BULLETS);
  return bullets.length > 0 ? bullets : [fallback];
}

async function generateUserSummarySections(input: {
  llmClient: LLMClient;
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  source: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  evidence: TeamIntelligenceUserEvidence;
  sourceData: Record<string, unknown>;
}): Promise<UserGeneratedSections> {
  const promptInput = {
    batchId: input.batchId,
    userIngestionId: input.userIngestionId,
    reportDate: input.reportDate,
    source: input.source,
    userName: input.userName,
    teamId: input.teamId,
    teamName: input.teamName,
    evidence: input.evidence,
    sourceData: input.sourceData,
  };
  const availableEvidenceIds = collectEvidenceIds(input.sourceData);
  const sourceFallbackEvidenceRefs = userEvidenceRefsFromIds(
    Array.from(availableEvidenceIds).slice(0, 5),
    'Source evidence from user payload'
  );
  const sectionFallbackEvidenceRefs = new Map<string, UserEvidenceRef[]>();
  const fallbackRefsFor = (sectionName: string): UserEvidenceRef[] =>
    sectionFallbackEvidenceRefs.get(sectionName) ?? [];
  const refsFromFact = (
    fact: Record<string, unknown>,
    fallbackReason: string,
    sectionName?: string
  ): UserEvidenceRef[] => {
    const refs = userEvidenceRefsFromFact(fact, availableEvidenceIds, fallbackReason);
    if (refs.length > 0) {
      return refs;
    }
    const fallbackRefs = sectionName ? fallbackRefsFor(sectionName) : sourceFallbackEvidenceRefs;
    return fallbackRefs.slice(0, 3).map((ref) => ({
      ...ref,
      reason: fallbackReason,
    }));
  };
  const runSection = async <T>(section: UserPromptSection): Promise<T> => {
    const startedAt = Date.now();
    const sectionSourceData = buildUserSectionSource(input.sourceData, section.name);
    sectionFallbackEvidenceRefs.set(
      section.name,
      buildUserSectionFallbackRefs(sectionSourceData, availableEvidenceIds)
    );
    const logContext = {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      userEmail: input.evidence.user.email,
      userName: input.userName || input.evidence.user.name,
      section: section.name,
      sourceChars: jsonCharLength(sectionSourceData),
      sourceSelection: asRecord(sectionSourceData.sourceSelection),
    };
    logger.info('[TEAM-INTEL-SUMMARY] User section started', logContext);
    try {
      const result = await runSectionWithFallback<T>({
        llmCall: (prompt, purpose) => llmGenerate(input.llmClient, prompt, { purpose }),
        jsonPrompt: buildUserSectionPrompt({
          ...promptInput,
          sourceData: sectionSourceData,
          section,
        }),
        outputShape: section.outputShape,
        purpose: `user-section-${section.name}`,
        label: `LLM user ${section.name} section response`,
        logTag: '[TEAM-INTEL-SUMMARY]',
      });
      logger.info('[TEAM-INTEL-SUMMARY] User section completed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error('[TEAM-INTEL-SUMMARY] User section failed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };
  const runSectionWave = async (
    waveName: string,
    sections: Record<string, UserPromptSection>
  ): Promise<Record<string, Record<string, unknown>>> => {
    const startedAt = Date.now();
    const sectionNames = Object.values(sections).map((section) => section.name);
    const concurrency = getTeamIntelligenceSectionConcurrency('user', sectionNames.length);
    logger.info('[TEAM-INTEL-SUMMARY] User section wave started', {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      userEmail: input.evidence.user.email,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
    });
    const entries = await mapWithConcurrency(
      Object.entries(sections),
      concurrency,
      async ([key, section]) => [key, await runSection<Record<string, unknown>>(section)] as const
    );
    logger.info('[TEAM-INTEL-SUMMARY] User section wave completed', {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      userEmail: input.evidence.user.email,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
      durationMs: Date.now() - startedAt,
    });
    return Object.fromEntries(entries);
  };

  const qualitativeItemShape = {
    title: 'string',
    description: 'rich qualitative detail, not just a label',
    status: 'PLANNED|IN_PROGRESS|BLOCKED|COMPLETED|UNKNOWN',
    importance: 'CRITICAL|HIGH|MEDIUM|LOW',
    progress: 'qualitative progress and current state',
    projects: ['string'],
    evidenceIds: ['exact input evidenceId'],
  };
  const extractionRaw = await runSectionWave('source-extraction', {
    whoIsDoingWhat: {
      name: 'who-is-doing-what',
      instructions: [
        '- Return only an items array of visible work facts; do not create final schema IDs or nested evidenceRefs.',
        '- Capture the person’s actual current work, status, importance, progress, projects, and qualitative detail.',
        '- Distinguish completed work from current work and planned work.',
      ],
      outputShape: { items: [qualitativeItemShape] },
    },
    needsUnblocking: {
      name: 'needs-unblocking',
      instructions: [
        '- Return only an items array of real blocker facts; do not create final schema IDs or nested evidenceRefs.',
        '- Include qualitative blocker detail, needed action, who/what is needed, related work title when known, and optional evidenceIds.',
        '- Distinguish explicit blockers from dependencies, unanswered questions, and ordinary coordination.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            description: 'rich qualitative blocker detail',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            status: 'OPEN|RESOLVED|UNCLEAR',
            relatedWorkTitles: ['string'],
            needsActionFrom: ['string'],
            recommendedAction: 'string',
            evidenceIds: ['exact input evidenceId'],
          },
        ],
      },
    },
    criticalAndMoving: {
      name: 'critical-and-moving',
      instructions: [
        '- Return only an items array of critical moving-work facts; do not create final schema IDs or nested evidenceRefs.',
        '- Separate critical/high-stakes work from ordinary work.',
        '- Include why it is critical, qualitative movement, progress description, risk level, and optional evidenceIds.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            whyCritical: 'string',
            movement: 'PROGRESSING|PROGRESSING_WITH_RISK|STALLED|REGRESSING|UNCLEAR',
            progressDescription: 'string',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            evidenceIds: ['exact input evidenceId'],
          },
        ],
      },
    },
    momentumAndDirection: {
      name: 'momentum-and-direction',
      instructions: [
        '- Return one simple qualitative assessment object; do not create nested evidenceRefs.',
        '- Distinguish meaningful progress from activity volume.',
        '- Use only this user source data.',
      ],
      outputShape: {
        momentum: 'FORWARD|FORWARD_WITH_BLOCKERS|FLAT|REGRESSING|INSUFFICIENT_EVIDENCE',
        direction:
          'TOWARD_STATED_GOALS|MIXED_OR_UNCLEAR|AWAY_FROM_STATED_GOALS|INSUFFICIENT_EVIDENCE',
        assessment: 'qualitative assessment',
        progressMade: ['string'],
        concerns: ['string'],
        evidenceIds: ['exact input evidenceId'],
      },
    },
    decisionsAndAlignment: {
      name: 'decisions-and-alignment',
      instructions: [
        '- Return simple decision facts and qualitative alignment notes; do not create final schema IDs or nested evidenceRefs.',
        '- Capture decisions separately from discussion, open questions, and unresolved options.',
        '- Never invent participants or decisions.',
      ],
      outputShape: {
        alignmentStatus: 'ALIGNED|PARTIALLY_ALIGNED|MISALIGNED|INSUFFICIENT_EVIDENCE',
        decisions: [
          {
            decision: 'string',
            context: 'string',
            impact: 'string',
            participants: ['string'],
            evidenceIds: ['exact input evidenceId'],
          },
        ],
        alignmentConcerns: ['string'],
        openQuestions: ['string'],
      },
    },
    peopleLoadFocusAndGaps: {
      name: 'people-load-focus-and-gaps',
      instructions: [
        '- Return one simple qualitative load/focus assessment plus a gaps array; do not create final schema IDs or nested evidenceRefs.',
        '- Assess visible load, focus, context switching, dependencies, ownership, capacity, and knowledge gaps.',
        '- Do not judge individual performance.',
      ],
      outputShape: {
        loadAssessment: 'OVERLOADED|HIGH|BALANCED|LIGHT|INSUFFICIENT_EVIDENCE',
        focusAssessment:
          'FOCUSED|MOSTLY_FOCUSED|FRAGMENTED|HIGHLY_FRAGMENTED|INSUFFICIENT_EVIDENCE',
        primaryFocus: ['string'],
        secondaryFocus: ['string'],
        contextSwitchingRisk: 'HIGH|MEDIUM|LOW|INSUFFICIENT_EVIDENCE',
        assessment: 'qualitative assessment',
        gaps: [
          {
            type: 'EXTERNAL_DEPENDENCY|OWNERSHIP|CAPACITY|KNOWLEDGE|DECISION|VISIBILITY|OTHER',
            description: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            evidenceIds: ['exact input evidenceId'],
          },
        ],
        evidenceIds: ['exact input evidenceId'],
      },
    },
    upcomingAndAtRisk: {
      name: 'upcoming-and-at-risk',
      instructions: [
        '- Return only an items array of upcoming commitments and risks; do not create final schema IDs or nested evidenceRefs.',
        '- Surface deadlines, near-term risks, required next steps, and dependencies only when supported.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            description: 'rich qualitative detail',
            expectedDate: 'ISO-8601 string or null',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            requiredNextSteps: ['string'],
            dependencies: ['string'],
            evidenceIds: ['exact input evidenceId'],
          },
        ],
      },
    },
    managerAttention: {
      name: 'manager-attention',
      instructions: [
        '- Return only an items array of manager actions; do not create final schema IDs.',
        '- Keep actions concrete and tied to blockers, risks, or decisions from the source data when possible.',
        '- Include blocker or risk titles when an action relates to them.',
      ],
      outputShape: {
        items: [
          {
            priority: 'CRITICAL|HIGH|MEDIUM|LOW',
            action: 'string',
            reason: 'string',
            relatedBlockerTitles: ['string'],
            relatedRiskTitles: ['string'],
          },
        ],
      },
    },
    teamSignals: {
      name: 'team-signals',
      instructions: [
        '- Return simple arrays for directionalSignals, capabilitySignals, and dependencies; do not create final schema IDs or nested evidenceRefs.',
        '- directionalSignals should capture explicit goals and defensible technical, business, customer, differentiation, or success-measure signals. Do not invent strategy.',
        '- capabilitySignals describes capabilities visibly demonstrated, developing, or needed by the work. It must not rate the person’s talent or performance.',
        '- dependencies identifies observable dependencies and current state. Do not label a person a gatekeeper.',
      ],
      outputShape: {
        directionalSignals: [
          {
            signal: 'string',
            signalType:
              'DECLARED_GOAL|INFERRED_DIRECTION|TECHNICAL_WAVE|BUSINESS_WAVE|CUSTOMER_PROBLEM|DIFFERENTIATION|SUCCESS_MEASURE',
            relatedWorkTitles: ['string'],
            confidence: 'HIGH|MEDIUM|LOW',
            evidenceIds: ['exact input evidenceId'],
          },
        ],
        capabilitySignals: [
          {
            capability: 'string',
            signalType: 'DEMONSTRATED|DEVELOPING|NEEDED|MISSING|INSUFFICIENT_EVIDENCE',
            description: 'string',
            confidence: 'HIGH|MEDIUM|LOW',
            evidenceIds: ['exact input evidenceId'],
          },
        ],
        dependencies: [
          {
            description: 'string',
            dependencyType: 'TEAM_MEMBER|EXTERNAL_TEAM|PROCESS|PLATFORM|DECISION|UNKNOWN',
            status: 'OPEN|BLOCKED|AT_RISK|RESOLVED|UNCLEAR',
            dependsOn: 'string or null',
            affectedWorkTitles: ['string'],
            evidenceIds: ['exact input evidenceId'],
          },
        ],
      },
    },
    unknowns: {
      name: 'unknowns',
      instructions: [
        '- Return only an items array of important unknowns; do not create final schema IDs.',
        '- Include questions that materially affect management interpretation and cannot be answered from the supplied evidence.',
      ],
      outputShape: { items: [{ question: 'string', reason: 'string' }] },
    },
  });
  const whoIsDoingWhatRaw = extractionRaw.whoIsDoingWhat;
  const whoIsDoingWhat = simpleRecords(whoIsDoingWhatRaw)
    .map((fact, index): UserWorkItem | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for visible work', 'who-is-doing-what');
      if (evidenceRefs.length === 0) return null;
      const title = cleanString(fact.title, `Work item ${index + 1}`);
      return {
        id: `work_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        status: enumValue(fact.status, USER_WORK_STATUS, 'UNKNOWN'),
        importance: enumValue(fact.importance ?? fact.priority, USER_IMPORTANCE, 'MEDIUM'),
        progress: cleanString(
          fact.progress ?? fact.progressDescription,
          cleanString(fact.description, title)
        ),
        projects: cleanStringArray(fact.projects ?? fact.projectNames),
        evidenceRefs,
      };
    })
    .filter((item): item is UserWorkItem => item !== null);

  const needsUnblockingRaw = extractionRaw.needsUnblocking;
  const needsUnblocking = simpleRecords(needsUnblockingRaw)
    .map((fact, index): UserBlocker | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for blocker', 'needs-unblocking');
      if (evidenceRefs.length === 0) return null;
      const title = cleanString(fact.title, `Blocker ${index + 1}`);
      return {
        id: `blocker_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        severity: enumValue(fact.severity ?? fact.priority, USER_IMPORTANCE, 'MEDIUM'),
        status: enumValue(fact.status, USER_BLOCKER_STATUS, 'OPEN'),
        blockedWorkIds: userWorkRefsFromFact(fact, whoIsDoingWhat),
        needsActionFrom: cleanStringArray(fact.needsActionFrom),
        recommendedAction: cleanString(
          fact.recommendedAction ?? fact.nextStep,
          'Clarify the next unblock action.'
        ),
        evidenceRefs,
      };
    })
    .filter((item): item is UserBlocker => item !== null);

  const criticalAndMovingRaw = extractionRaw.criticalAndMoving;
  const criticalAndMoving = simpleRecords(criticalAndMovingRaw)
    .map((fact, index): UserCriticalWork | null => {
      const evidenceRefs = refsFromFact(
        fact,
        'Evidence for critical movement',
        'critical-and-moving'
      );
      if (evidenceRefs.length === 0) return null;
      const title = cleanString(fact.title, `Critical work ${index + 1}`);
      return {
        id: `critical_${index + 1}`,
        title,
        whyCritical: cleanString(fact.whyCritical ?? fact.description, title),
        movement: enumValue(fact.movement, USER_MOVEMENT, 'UNCLEAR'),
        progressDescription: cleanString(
          fact.progressDescription ?? fact.progress ?? fact.description,
          title
        ),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, USER_IMPORTANCE, 'MEDIUM'),
        evidenceRefs,
      };
    })
    .filter((item): item is UserCriticalWork => item !== null);

  const momentumAndDirectionRaw = extractionRaw.momentumAndDirection;
  const momentumAndDirectionRecord = asRecord(
    momentumAndDirectionRaw.momentumAndDirection ?? momentumAndDirectionRaw
  );
  const momentumAndDirection: TeamIntelligenceUserSummary['momentumAndDirection'] = {
    momentum: enumValue(
      momentumAndDirectionRecord.momentum,
      USER_MOMENTUM,
      'INSUFFICIENT_EVIDENCE'
    ),
    direction: enumValue(
      momentumAndDirectionRecord.direction,
      USER_DIRECTION,
      'INSUFFICIENT_EVIDENCE'
    ),
    assessment: cleanString(
      momentumAndDirectionRecord.assessment,
      'Insufficient evidence to assess momentum confidently.'
    ),
    progressMade: cleanStringArray(momentumAndDirectionRecord.progressMade),
    concerns: cleanStringArray(momentumAndDirectionRecord.concerns),
    evidenceRefs: refsFromFact(
      momentumAndDirectionRecord,
      'Evidence for momentum assessment',
      'momentum-and-direction'
    ),
  };

  const decisionsAndAlignmentRaw = extractionRaw.decisionsAndAlignment;
  const decisionsAndAlignmentRecord = asRecord(
    decisionsAndAlignmentRaw.decisionsAndAlignment ?? decisionsAndAlignmentRaw
  );
  const decisions = simpleRecords(decisionsAndAlignmentRecord, ['decisions', 'items'])
    .map((fact, index): UserDecision | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for decision', 'decisions-and-alignment');
      if (evidenceRefs.length === 0) return null;
      const decision = cleanString(fact.decision ?? fact.title, `Decision ${index + 1}`);
      return {
        id: `decision_${index + 1}`,
        decision,
        context: cleanString(fact.context ?? fact.description, decision),
        impact: cleanString(fact.impact, 'Impact not fully specified in evidence.'),
        participants: cleanStringArray(fact.participants),
        evidenceRefs,
      };
    })
    .filter((item): item is UserDecision => item !== null);
  const decisionsAndAlignment: TeamIntelligenceUserSummary['decisionsAndAlignment'] = {
    alignmentStatus: enumValue(
      decisionsAndAlignmentRecord.alignmentStatus,
      USER_ALIGNMENT,
      'INSUFFICIENT_EVIDENCE'
    ),
    decisions,
    alignmentConcerns: cleanStringArray(
      decisionsAndAlignmentRecord.alignmentConcerns ?? decisionsAndAlignmentRecord.concerns
    ),
    openQuestions: cleanStringArray(decisionsAndAlignmentRecord.openQuestions),
  };

  const peopleLoadFocusAndGapsRaw = extractionRaw.peopleLoadFocusAndGaps;
  const peopleRecord = asRecord(
    peopleLoadFocusAndGapsRaw.peopleLoadFocusAndGaps ?? peopleLoadFocusAndGapsRaw
  );
  const gaps = simpleRecords(peopleRecord, ['gaps', 'items'])
    .map((fact, index): UserGap | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for gap', 'people-load-focus-and-gaps');
      if (evidenceRefs.length === 0) return null;
      return {
        id: `gap_${index + 1}`,
        type: enumValue(fact.type, USER_GAP_TYPES, 'OTHER'),
        description: cleanString(fact.description ?? fact.detail, `Gap ${index + 1}`),
        severity: enumValue(fact.severity ?? fact.priority, USER_IMPORTANCE, 'MEDIUM'),
        evidenceRefs,
      };
    })
    .filter((item): item is UserGap => item !== null);
  const peopleLoadFocusAndGaps: TeamIntelligenceUserSummary['peopleLoadFocusAndGaps'] = {
    loadAssessment: enumValue(peopleRecord.loadAssessment, USER_LOAD, 'INSUFFICIENT_EVIDENCE'),
    focusAssessment: enumValue(peopleRecord.focusAssessment, USER_FOCUS, 'INSUFFICIENT_EVIDENCE'),
    primaryFocus: cleanStringArray(peopleRecord.primaryFocus),
    secondaryFocus: cleanStringArray(peopleRecord.secondaryFocus),
    contextSwitchingRisk: enumValue(
      peopleRecord.contextSwitchingRisk,
      USER_CONTEXT_RISK,
      'INSUFFICIENT_EVIDENCE'
    ),
    assessment: cleanString(
      peopleRecord.assessment,
      'Insufficient evidence to assess load and focus confidently.'
    ),
    gaps,
    evidenceRefs: refsFromFact(
      peopleRecord,
      'Evidence for load and focus assessment',
      'people-load-focus-and-gaps'
    ),
  };

  const upcomingAndAtRiskRaw = extractionRaw.upcomingAndAtRisk;
  const upcomingAndAtRisk = simpleRecords(upcomingAndAtRiskRaw)
    .map((fact, index): UserUpcomingRisk | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for upcoming risk', 'upcoming-and-at-risk');
      if (evidenceRefs.length === 0) return null;
      const title = cleanString(fact.title, `Risk ${index + 1}`);
      return {
        id: `risk_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        expectedDate: nullableString(fact.expectedDate),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, USER_IMPORTANCE, 'MEDIUM'),
        requiredNextSteps: cleanStringArray(fact.requiredNextSteps ?? fact.nextSteps),
        dependencies: cleanStringArray(fact.dependencies),
        evidenceRefs,
      };
    })
    .filter((item): item is UserUpcomingRisk => item !== null);

  const managerAttentionRaw = extractionRaw.managerAttention;
  const blockerIds = new Set(needsUnblocking.map((item) => item.id));
  const riskIds = new Set(upcomingAndAtRisk.map((item) => item.id));
  const managerAttention = simpleRecords(managerAttentionRaw).map((fact, index) => ({
    id: `attention_${index + 1}`,
    priority: enumValue(fact.priority, USER_IMPORTANCE, 'MEDIUM'),
    action: cleanString(fact.action, `Review manager action ${index + 1}.`),
    reason: cleanString(
      fact.reason ?? fact.description,
      'Evidence indicates manager attention may help.'
    ),
    relatedBlockerIds: existingIds(fact.relatedBlockerIds, blockerIds).concat(
      idsMatchingTitles(cleanStringArray(fact.relatedBlockerTitles), needsUnblocking)
    ),
    relatedRiskIds: existingIds(fact.relatedRiskIds, riskIds).concat(
      idsMatchingTitles(cleanStringArray(fact.relatedRiskTitles), upcomingAndAtRisk)
    ),
  }));

  const teamSignalsRaw = extractionRaw.teamSignals;
  const teamSignalsRecord = asRecord(teamSignalsRaw.teamSignals ?? teamSignalsRaw);
  const directionalSignals = simpleRecords(teamSignalsRecord, ['directionalSignals'])
    .map((fact, index): UserDirectionalSignal | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for directional signal', 'team-signals');
      if (evidenceRefs.length === 0) return null;
      return {
        id: `direction_${index + 1}`,
        signal: cleanString(fact.signal ?? fact.description, `Directional signal ${index + 1}`),
        signalType: enumValue(fact.signalType, USER_SIGNAL_TYPES, 'INFERRED_DIRECTION'),
        relatedWorkIds: userWorkRefsFromFact(fact, whoIsDoingWhat),
        confidence: enumValue(fact.confidence, USER_CONFIDENCE, 'MEDIUM'),
        evidenceRefs,
      };
    })
    .filter((item): item is UserDirectionalSignal => item !== null);
  const capabilitySignals = simpleRecords(teamSignalsRecord, ['capabilitySignals'])
    .map((fact, index): UserCapabilitySignal | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for capability signal', 'team-signals');
      if (evidenceRefs.length === 0) return null;
      const capability = cleanString(fact.capability ?? fact.title, `Capability ${index + 1}`);
      return {
        id: `capability_${index + 1}`,
        capability,
        signalType: enumValue(fact.signalType, USER_CAPABILITY_TYPES, 'INSUFFICIENT_EVIDENCE'),
        description: cleanString(fact.description ?? fact.detail, capability),
        confidence: enumValue(fact.confidence, USER_CONFIDENCE, 'MEDIUM'),
        evidenceRefs,
      };
    })
    .filter((item): item is UserCapabilitySignal => item !== null);
  const dependencies = simpleRecords(teamSignalsRecord, ['dependencies'])
    .map((fact, index): UserDependencySignal | null => {
      const evidenceRefs = refsFromFact(fact, 'Evidence for dependency signal', 'team-signals');
      if (evidenceRefs.length === 0) return null;
      return {
        id: `dependency_${index + 1}`,
        description: cleanString(fact.description ?? fact.detail, `Dependency ${index + 1}`),
        dependencyType: enumValue(fact.dependencyType, USER_DEPENDENCY_TYPES, 'UNKNOWN'),
        status: enumValue(fact.status, USER_DEPENDENCY_STATUS, 'UNCLEAR'),
        dependsOn: nullableString(fact.dependsOn),
        affectedWorkIds: userWorkRefsFromFact(fact, whoIsDoingWhat),
        evidenceRefs,
      };
    })
    .filter((item): item is UserDependencySignal => item !== null);
  const teamSignals: TeamIntelligenceUserSummary['teamSignals'] = {
    directionalSignals,
    capabilitySignals,
    dependencies,
  };

  const unknownsRaw = extractionRaw.unknowns;
  const unknowns = simpleRecords(unknownsRaw).map((fact, index) => ({
    id: `unknown_${index + 1}`,
    question: cleanString(fact.question ?? fact.title, `Unknown ${index + 1}`),
    reason: cleanString(fact.reason ?? fact.description, 'The supplied evidence is insufficient.'),
  }));

  const finalSummaryRaw = await runSection<Record<string, unknown>>({
    name: 'final-dependent-summary',
    instructions: [
      '- Return one final dependent summary object only.',
      '- Base overallConfidence on evidence breadth, recency, specificity, and consistency across the generated sections.',
      '- Synthesize the generated sections and the full input without adding unsupported facts.',
      '- executiveSummary must be one concise, concrete, neutral, manager-ready string of at most 100 words. Lead with the single most important conclusion and omit source-by-source narration.',
      '- managerSummaryBullets must contain only the 3 to 5 most important, non-overlapping, manager-ready takeaways for this person — facts whose omission could change the manager’s understanding or action. Drop routine updates and merge related points. Return fewer than 3 when the evidence does not justify them; never exceed 5.',
    ],
    outputShape: {
      overallConfidence: 'HIGH|MEDIUM|LOW',
      executiveSummary: 'string',
      managerSummaryBullets: ['string'], // max 5 — only decision-relevant person-specific takeaways
    },
    priorSections: compactForPriorSections({
      whoIsDoingWhat,
      needsUnblocking,
      criticalAndMoving,
      momentumAndDirection,
      decisionsAndAlignment,
      peopleLoadFocusAndGaps,
      upcomingAndAtRisk,
      managerAttention,
      teamSignals,
      unknowns,
    }) as Record<string, unknown>,
  });
  const finalSummaryRecord = asRecord(finalSummaryRaw);
  const overallConfidence = enumValue(
    finalSummaryRecord.overallConfidence ??
      finalSummaryRecord.confidence ??
      finalSummaryRecord.value,
    USER_CONFIDENCE,
    'MEDIUM'
  );
  const executiveSummary = cleanString(
    finalSummaryRecord.executiveSummary ?? finalSummaryRecord.summary ?? finalSummaryRecord.text,
    'No evidence-backed executive summary could be produced.'
  );
  const managerSummaryBullets = compactBullets(finalSummaryRecord, executiveSummary);

  return {
    whoIsDoingWhat,
    needsUnblocking,
    criticalAndMoving,
    momentumAndDirection,
    decisionsAndAlignment,
    peopleLoadFocusAndGaps,
    upcomingAndAtRisk,
    managerAttention,
    teamSignals,
    unknowns,
    overallConfidence,
    executiveSummary,
    managerSummaryBullets,
  };
}

class TeamIntelligenceSummaryService {
  private getLlmClient(): LLMClient {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence'
      );
    }
    return llmClient;
  }

  async generate(input: GenerateUserSummaryInput): Promise<TeamIntelligenceGeneratedSummary> {
    const evidence = await teamIntelligenceUserEvidenceService.collect(
      input.userEmail,
      input.userName,
      input.reportDate,
      input.orgId
    );
    const codeEvidence = normalizeCodeEvidence(
      input.pullRequests,
      input.soloCommits,
      input.aiUsage
    );
    const sourceData: Record<string, unknown> = {
      pullRequests: codeEvidence.pullRequests,
      soloCommits: codeEvidence.soloCommits,
      aiUsage: codeEvidence.aiUsage,
      tickets: evidence.tickets,
      conversations: evidence.conversations,
      calls: evidence.calls,
      canvases: evidence.canvases,
    };
    const reportDate = input.reportDate.toISOString().slice(0, 10);
    const llmClient = this.getLlmClient();
    const promptSource = await buildPromptSourceData({
      llmClient,
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      reportDate,
      source: input.source,
      userName: input.userName,
      teamId: input.teamId,
      teamName: input.teamName,
      evidence,
      sourceData,
    });
    const sections = await generateUserSummarySections({
      llmClient,
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      reportDate,
      source: input.source,
      userName: input.userName,
      teamId: input.teamId,
      teamName: input.teamName,
      evidence,
      sourceData: promptSource.sourceData,
    });
    const parsed: unknown = {
      ...buildUserIdentityFields({
        batchId: input.batchId,
        userIngestionId: input.userIngestionId,
        reportDate,
        userName: input.userName,
        teamId: input.teamId,
        teamName: input.teamName,
        evidence,
      }),
      executiveSummary: sections.executiveSummary,
      managerSummaryBullets: sections.managerSummaryBullets,
      whoIsDoingWhat: sections.whoIsDoingWhat,
      needsUnblocking: sections.needsUnblocking,
      criticalAndMoving: sections.criticalAndMoving,
      momentumAndDirection: sections.momentumAndDirection,
      decisionsAndAlignment: sections.decisionsAndAlignment,
      peopleLoadFocusAndGaps: sections.peopleLoadFocusAndGaps,
      upcomingAndAtRisk: sections.upcomingAndAtRisk,
      managerAttention: sections.managerAttention,
      teamSignals: sections.teamSignals,
      unknowns: sections.unknowns,
      overallConfidence: sections.overallConfidence,
    };

    let validation = TeamIntelligenceUserSummarySchema.safeParse(parsed);
    if (!validation.success) {
      const pruned = pruneInvalidArrayItemsForRetry(parsed, validation.error.issues);
      if (pruned.prunedCount > 0) {
        logger.warn(
          '[TEAM-INTEL-SUMMARY] Pruned invalid user summary array items before validation retry',
          {
            prunedCount: pruned.prunedCount,
            prunedPaths: pruned.prunedPaths,
            error: validation.error.message,
          }
        );
        validation = TeamIntelligenceUserSummarySchema.safeParse(parsed);
      }
    }
    if (!validation.success) {
      throw new TeamIntelligenceLLMUnavailableError(
        `LLM user summary response did not match the required schema: ${validation.error.message}`
      );
    }
    assertSummaryIdentity(validation.data, {
      batchId: input.batchId,
      userIngestionId: input.userIngestionId,
      reportDate,
      userId: evidence.user.id,
      userEmail: evidence.user.email,
      userName: input.userName || evidence.user.name,
      teamId: input.teamId,
      teamName: input.teamName,
    });
    assertEvidenceReferences(validation.data, sourceData);

    const teamAggregationPayload: TeamIntelligenceTeamAggregationPayload = {
      userIngestionId: input.userIngestionId,
      reportDate,
      user: validation.data.user,
      summary: validation.data.executiveSummary,
      activeWork: validation.data.whoIsDoingWhat,
      blockers: validation.data.needsUnblocking,
      criticalWork: validation.data.criticalAndMoving,
      momentumAndDirection: validation.data.momentumAndDirection,
      decisionsAndAlignment: validation.data.decisionsAndAlignment,
      loadAndFocus: validation.data.peopleLoadFocusAndGaps,
      upcomingCommitments: validation.data.upcomingAndAtRisk,
      directionalSignals: validation.data.teamSignals.directionalSignals,
      capabilitySignals: validation.data.teamSignals.capabilitySignals,
      dependencies: validation.data.teamSignals.dependencies,
      managerAttention: validation.data.managerAttention,
      unknowns: validation.data.unknowns,
      confidence: validation.data.overallConfidence,
    };

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-user-evidence-llm-v1',
      generatedAt: new Date().toISOString(),
      model: appConfig.teamIntelligence.model,
      sourceCounts: {
        pullRequests: codeEvidence.pullRequests.length,
        soloCommits: codeEvidence.soloCommits.length,
        tickets: evidence.tickets.length,
        conversations: evidence.conversations.length,
        calls: evidence.calls.length,
        canvases: evidence.canvases.length,
      },
      userId: evidence.user.id,
      workspaceId: evidence.user.workspaceId,
      organizationId: evidence.user.organizationId,
      workspaceUserResolved: evidence.user.resolvedInWorkspace,
      llmInputProfile: promptSource.profile as Prisma.InputJsonValue,
      llmPipeline: {
        mode: 'sectioned-v1',
        saveMode: 'final-payload-only',
        repairMode: 'json-repair-on-parse-failure',
        sections: [
          'who-is-doing-what',
          'needs-unblocking',
          'critical-and-moving',
          'momentum-and-direction',
          'decisions-and-alignment',
          'people-load-focus-and-gaps',
          'upcoming-and-at-risk',
          'manager-attention',
          'team-signals',
          'unknowns',
          'final-dependent-summary',
        ],
      },
    };

    return {
      pullRequests: codeEvidence.pullRequests as unknown as Prisma.InputJsonValue,
      soloCommits: codeEvidence.soloCommits as unknown as Prisma.InputJsonValue,
      employeeSummary: validation.data.managerSummaryBullets,
      userSummary: validation.data,
      teamAggregationPayload,
      sourceData: sourceData as Prisma.InputJsonValue,
      summaryMetadata,
    };
  }
}

export const teamIntelligenceSummaryService = new TeamIntelligenceSummaryService();
