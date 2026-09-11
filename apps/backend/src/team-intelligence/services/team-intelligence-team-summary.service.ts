import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceTeamSummaryBullet,
  TeamIntelligenceTeamSummaryBulletContributor,
  TeamIntelligenceTeamSummaryOutput,
  TeamIntelligenceTeamSummaryProvenance,
} from '../types';
import type { TeamIntelligenceTeamAggregationPayload } from '../user-summary.schema';
import type { MettleTeamGoal } from '../../services/mettleTeamGoalsService';
import {
  TeamIntelligenceTeamLeadershipSummarySchema,
  type TeamIntelligenceContinuityState,
  type TeamIntelligenceOrgAggregationPayload,
  type TeamIntelligenceTeamLeadershipSummary,
  type TeamIntelligenceTeamProcessingCoverage,
} from '../team-leadership-summary.schema';
import { TeamIntelligenceLLMUnavailableError } from '../errors';
import {
  compactForPriorSections,
  getTeamIntelligenceSectionConcurrency,
  mapWithConcurrency,
  runSectionWithFallback,
  withTeamIntelligenceLlmSlot,
} from '../llm-utils';
import { pruneInvalidArrayItemsForRetry } from '../validation-utils';
import { createTeamIntelligenceLlmClient } from './team-intelligence-llm-client';

export interface TeamIntelligenceTeamLeadershipInput {
  batchId: string;
  teamSummaryId: string;
  reportDate: string;
  teamId: string;
  teamName: string;
  source: string;
  members: TeamIntelligenceTeamAggregationPayload[];
  teamGoals: MettleTeamGoal[];
  previousContinuityState: TeamIntelligenceContinuityState | null;
  processingCoverage: TeamIntelligenceTeamProcessingCoverage;
}

export interface TeamIntelligenceTeamLeadershipOutput extends TeamIntelligenceTeamSummaryOutput {
  teamSummary: TeamIntelligenceTeamLeadershipSummary;
  continuityState: TeamIntelligenceContinuityState;
  orgAggregationPayload: TeamIntelligenceOrgAggregationPayload;
}

interface LlmGenerateOptions {
  purpose: string;
}

interface TeamPromptSection {
  name: string;
  instructions: string[];
  outputShape: Record<string, unknown>;
  priorSections?: Record<string, unknown>;
  source?: TeamSectionSource;
}

interface TeamSectionSource {
  currentMemberSignals: Array<Record<string, unknown>>;
  previousContinuityState: Record<string, unknown> | null;
  sourceSelection: Record<string, unknown>;
}

type TeamOperationalSnapshot = TeamIntelligenceTeamLeadershipSummary['operationalSnapshot'];
type TeamLeadershipSnapshot = TeamIntelligenceTeamLeadershipSummary['leadershipSnapshot'];

interface TeamGeneratedSections {
  whoIsDoingWhat: TeamOperationalSnapshot['whoIsDoingWhat'];
  needsUnblocking: TeamOperationalSnapshot['needsUnblocking'];
  criticalAndMoving: TeamOperationalSnapshot['criticalAndMoving'];
  momentumAndDirection: TeamOperationalSnapshot['momentumAndDirection'];
  decisionsAndAlignment: TeamOperationalSnapshot['decisionsAndAlignment'];
  peopleLoadFocusAndGaps: TeamOperationalSnapshot['peopleLoadFocusAndGaps'];
  upcomingAndAtRisk: TeamOperationalSnapshot['upcomingAndAtRisk'];
  directionalBet: TeamLeadershipSnapshot['directionalBet'];
  capabilityMix: TeamLeadershipSnapshot['capabilityMix'];
  leadershipTouch: TeamLeadershipSnapshot['leadershipTouch'];
  bottlenecks: TeamLeadershipSnapshot['bottlenecks'];
  leadershipLeverage: TeamLeadershipSnapshot['leadershipLeverage'];
  nextLeap: TeamLeadershipSnapshot['nextLeap'];
  team10xGoal: TeamIntelligenceTeamLeadershipSummary['team10xGoal'];
  recommendedActions: TeamIntelligenceTeamLeadershipSummary['recommendedActions'];
  dataGaps: TeamIntelligenceTeamLeadershipSummary['dataGaps'];
  continuityState: TeamIntelligenceTeamLeadershipSummary['continuityState'];
  overallConfidence: TeamIntelligenceTeamLeadershipSummary['overallConfidence'];
  executiveSummary: TeamIntelligenceTeamLeadershipSummary['executiveSummary'];
  managerSummaryBullets: TeamIntelligenceTeamLeadershipSummary['managerSummaryBullets'];
}

async function llmGenerate(
  llmClient: LLMClient,
  prompt: string,
  options: LlmGenerateOptions
): Promise<string> {
  const startedAt = Date.now();
  logger.info('[TEAM-INTEL-TEAM-SUMMARY] LLM call started', {
    purpose: options.purpose,
    promptChars: prompt.length,
  });
  try {
    return await withTeamIntelligenceLlmSlot(
      { scope: 'team', purpose: options.purpose, promptChars: prompt.length },
      async () => {
        const response = await llmClient.generateStream({
          model: appConfig.teamIntelligence.model,
          messages: [createUserMessage(prompt)],
        });
        const finalMessagePromise = response.finalMessage.catch((error) => {
          logger.warn('[TEAM-INTEL-TEAM-SUMMARY] Streaming final message accumulation failed', {
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
          logger.warn('[TEAM-INTEL-TEAM-SUMMARY] Using streamed content after stream error', {
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
        logger.info('[TEAM-INTEL-TEAM-SUMMARY] LLM call completed', {
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
      '[TEAM-INTEL-TEAM-SUMMARY] LLM call failed; section fallback will decide whether to retry, use text, or blank the section',
      {
        purpose: options.purpose,
        durationMs: Date.now() - startedAt,
        promptChars: prompt.length,
        error,
      }
    );
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM team summary generation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
}

function buildSectionPrompt(
  input: TeamIntelligenceTeamLeadershipInput,
  section: TeamPromptSection
): string {
  const sectionSource = section.source ?? buildTeamSectionSource(input, ['summary']);
  return [
    'You are producing one focused section of an evidence-backed founder and leadership snapshot for exactly one team.',
    'This is a stateless request scoped only to INPUT.batchId and INPUT.team.',
    'Do not use memory, prior chat/session context, or data from another team, organization, or batch.',
    'Your input contains a small team member directory, section-filtered already-summarized member signals for today, and compact previous continuity state when relevant.',
    'Some sections may also receive active team goals; use them only to assess whether supplied member signals indicate progress toward those goals.',
    'Do not ask for, infer from, or fabricate channel-to-team mappings. Team membership is authoritative only through the supplied teamId.',
    '',
    'Evidence rules:',
    '- Use only memberDirectory, currentMemberSignals, previousContinuityState, and externalTeamGoals supplied in INPUT.',
    '- currentMemberSignals is intentionally filtered to this section. Members with no relevant signals for this section may be omitted.',
    '- Prefer simple qualitative content: title/text/description/priority/status. memberSignalRefs are optional; when provided, they must use exact userIngestionId + signalId pairs from currentMemberSignals.',
    '- A provided memberSignalRef.signalId must be an exact id found inside that member payload.',
    '- Names and user IDs must exactly match supplied memberDirectory/currentMemberSignals.',
    '- Deduplicate the same work, blocker, decision, call-derived signal, or dependency reported by multiple members.',
    '- Do not equate missing commits or PRs with inactivity, low ability, or light load.',
    '- Do not call anyone idle, weak, a gatekeeper, or a poor performer.',
    '- Describe observable system conditions instead, such as concentrated approvals, missing ownership, fragmented focus, or insufficient visibility.',
    '- Use previousContinuityState only for change over time. If it is null, use INSUFFICIENT_BASELINE where comparison is not supported.',
    '- All arrays must be empty when unsupported; never add placeholder items.',
    '- This is a team rollup, not a per-member exhaustive report. Do not create one item for every member or every source signal.',
    '- Include only leadership-significant facts: CRITICAL/HIGH priority, BLOCKED/OPEN/STALLED/REGRESSING items, progressing work that meaningfully advances the team bet, unresolved decisions, dependencies, or manager-actionable risks.',
    '- Omit routine completed work, low-impact activity, duplicated member-level detail, and medium/low items unless they are required to explain a blocker, critical movement, ownership gap, or manager action.',
    '- Never describe work using PR numbers, commit hashes, ticket IDs, file counts, or line addition/deletion tallies. These are artifact identifiers, not insights.',
    '- Write about what was built, decided, or resolved and why it matters. Avoid phrases like "Merged PR #N", "N additions across M files", or "commit X". Instead describe the outcome: what capability was shipped, what problem was solved, what decision was made.',
    '- Apply a mandatory importance gate: include an insight only when omitting it could cause leadership to miss a material outcome, meaningful goal movement, significant change, blocker, risk, unresolved decision, cross-member dependency, ownership/load concern, or concrete manager action.',
    '- Optimize for decision value, not coverage. More members or more source data must not produce more output by itself.',
    '- Rank candidates by organizational impact, urgency, evidence strength, and actionability; merge overlapping member signals into one team-level insight.',
    '- Completed work is important only when it creates a material outcome, advances a meaningful goal, changes risk, unlocks others, or warrants leadership recognition; ordinary delivery activity is not automatically leadership-significant.',
    '- Treat missing data as one consolidated insight only when it materially changes confidence or requires corrective action. Never generate multiple bullets from the same visibility gap.',
    '- Unless this section explicitly requires fewer, return at most 3 top-level insight items per array. This cap does not apply to memberSignalRefs, contributor IDs, or other reference arrays inside a selected insight.',
    '- Empty or short output is correct when nothing crosses the importance threshold. Never fill space or represent every member for completeness.',
    '- Order every array by leadership urgency: CRITICAL/HIGH first, then BLOCKED/OPEN/STALLED/REGRESSING, then MEDIUM. LOW should usually be omitted.',
    '- Keep executive narrative under 120 words, lead with the most important conclusion, and keep each bullet/detail sentence concise.',
    '- Do not include immutable identity, processingCoverage, or unrelated sections in this fragment.',
    '',
    `SECTION: ${section.name}`,
    ...section.instructions,
    '',
    'Return one valid JSON object only. Do not use markdown fences or add prose.',
    'The first character must be { and the last character must be }.',
    'Return exactly the requested fragment fields using this shape and enum vocabulary:',
    JSON.stringify(section.outputShape),
    ...(section.priorSections
      ? [
          '',
          'Already generated section context for this same team only. Use these stable IDs when this section needs to reference prior generated items:',
          JSON.stringify(section.priorSections),
        ]
      : []),
    '',
    'INPUT:',
    JSON.stringify({
      schemaVersion: '1.0',
      scope: 'TEAM_LEADERSHIP_SNAPSHOT_INPUT',
      batchId: input.batchId,
      reportDate: input.reportDate,
      team: {
        id: input.teamId,
        name: input.teamName,
        memberCount: input.processingCoverage.expectedMembers,
      },
      memberDirectory: buildTeamMemberDirectory(input.members),
      processingCoverage: input.processingCoverage,
      currentMemberSignals: sectionSource.currentMemberSignals,
      externalTeamGoals: input.teamGoals.map((goal) => ({
        id: goal.id,
        teamId: goal.team_id ?? goal.teamId ?? input.teamId,
        subteamId: goal.subteam_id ?? goal.subteamId ?? null,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status ?? null,
        track: goal.track ?? null,
        visibility: goal.visibility ?? null,
        createdAt: goal.created_at ?? goal.createdAt ?? null,
      })),
      previousContinuityState: sectionSource.previousContinuityState,
      sourceSelection: sectionSource.sourceSelection,
    }),
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type TeamMemberSignalField = keyof TeamIntelligenceTeamAggregationPayload;
type TeamContinuityField = keyof TeamIntelligenceContinuityState;

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

function buildTeamMemberDirectory(members: TeamIntelligenceTeamAggregationPayload[]) {
  return members.map((member) => ({
    userIngestionId: member.userIngestionId,
    userId: member.user.id,
    userEmail: member.user.email,
    userName: member.user.name,
    role: member.user.role,
    teamId: member.user.teamId,
    teamName: member.user.teamName,
  }));
}

function buildTeamContinuitySubset(
  state: TeamIntelligenceContinuityState | null,
  fields: TeamContinuityField[]
): Record<string, unknown> | null {
  if (!state || fields.length === 0) return null;
  const subset: Record<string, unknown> = { window: state.window };
  for (const field of fields) {
    const value = state[field];
    if (hasPromptSignal(value)) {
      subset[field] = value;
    }
  }
  return Object.keys(subset).length > 1 ? subset : null;
}

function buildTeamSectionSource(
  input: TeamIntelligenceTeamLeadershipInput,
  signalFields: TeamMemberSignalField[],
  continuityFields: TeamContinuityField[] = []
): TeamSectionSource {
  const currentMemberSignals = input.members
    .map((member) => {
      const signal: Record<string, unknown> = {
        userIngestionId: member.userIngestionId,
        reportDate: member.reportDate,
        user: member.user,
      };
      let hasSelectedSignal = false;
      for (const field of signalFields) {
        const value = member[field];
        if (hasPromptSignal(value)) {
          signal[field] = value;
          hasSelectedSignal = true;
        }
      }
      return hasSelectedSignal ? signal : null;
    })
    .filter((signal): signal is Record<string, unknown> => signal !== null);

  return {
    currentMemberSignals,
    previousContinuityState: buildTeamContinuitySubset(
      input.previousContinuityState,
      continuityFields
    ),
    sourceSelection: {
      includedMemberSignalFields: signalFields,
      includedPreviousContinuityFields: continuityFields,
      includedMemberSignals: currentMemberSignals.length,
      omittedMembersWithoutRelevantSignals: input.members.length - currentMemberSignals.length,
    },
  };
}

type TeamMemberSignalRef =
  TeamOperationalSnapshot['whoIsDoingWhat'][number]['memberSignalRefs'][number];
type TeamWorkstream = TeamOperationalSnapshot['whoIsDoingWhat'][number];
type TeamBlocker = TeamOperationalSnapshot['needsUnblocking'][number];
type TeamCriticalItem = TeamOperationalSnapshot['criticalAndMoving'][number];
type TeamDecision = TeamOperationalSnapshot['decisionsAndAlignment']['decisions'][number];
type TeamPersonAssessment =
  TeamOperationalSnapshot['peopleLoadFocusAndGaps']['overloadedMembers'][number];
type TeamLeadershipItem = TeamLeadershipSnapshot['bottlenecks']['peopleOrOwnership'][number];
type TeamRisk = TeamOperationalSnapshot['upcomingAndAtRisk'][number];
type TeamGoalAlignment = TeamIntelligenceTeamLeadershipSummary['team10xGoal'][number];
type TeamEvidenceSourceType = TeamGoalAlignment['evidenceSourceTypes'][number];

function buildTeamSectionFallbackRefs(
  source: TeamSectionSource | undefined,
  validSignalIdsByIngestion: Map<string, Set<string>>
): TeamMemberSignalRef[] {
  if (!source) return [];
  return dedupeMemberSignalRefs(
    source.currentMemberSignals.flatMap((signal) => {
      const userIngestionId = cleanString(signal.userIngestionId);
      const validSignalIds = validSignalIdsByIngestion.get(userIngestionId) ?? new Set<string>();
      return Array.from(collectIds(signal))
        .filter((signalId) => validSignalIds.has(signalId))
        .slice(0, 3)
        .map((signalId) => ({
          userIngestionId,
          signalId,
          reason: 'Source evidence from section-filtered member summary',
        }));
    })
  );
}

const TEAM_PRIORITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const TEAM_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const;
const TEAM_WORK_STATUS = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN'] as const;
const TEAM_BLOCKER_STATUS = ['OPEN', 'RESOLVED', 'UNCLEAR'] as const;
const TEAM_MOVEMENT = [
  'PROGRESSING',
  'PROGRESSING_WITH_RISK',
  'STALLED',
  'REGRESSING',
  'UNCLEAR',
] as const;
const TEAM_MOMENTUM = [
  'FORWARD',
  'FORWARD_WITH_BLOCKERS',
  'MIXED',
  'FLAT',
  'REGRESSING',
  'INSUFFICIENT_BASELINE',
] as const;
const TEAM_DIRECTION = [
  'TOWARD_STATED_GOALS',
  'COHERENT_INFERRED_DIRECTION',
  'MIXED_OR_UNCLEAR',
  'AWAY_FROM_STATED_GOALS',
  'INSUFFICIENT_EVIDENCE',
] as const;
const TEAM_ALIGNMENT = [
  'ALIGNED',
  'PARTIALLY_ALIGNED',
  'MISALIGNED',
  'INSUFFICIENT_EVIDENCE',
] as const;
const TEAM_REVERSIBILITY = ['REVERSIBLE', 'IRREVERSIBLE', 'UNCLEAR'] as const;
const TEAM_TOUCH = ['HIGH_TOUCH', 'MEDIUM_TOUCH', 'LOW_TOUCH', 'INSUFFICIENT_EVIDENCE'] as const;
const TEAM_GOAL_TRACKS = ['2X', '5X', '10X', 'UNKNOWN'] as const;
const TEAM_GOAL_MATCH_STRENGTH = ['STRONG', 'PARTIAL', 'WEAK'] as const;
const TEAM_EVIDENCE_SOURCE_TYPES = [
  'PULL_REQUEST',
  'COMMIT',
  'AI_USAGE',
  'TICKET',
  'TICKET_ACTIVITY',
  'CONVERSATION',
  'MESSAGE',
  'CALL',
  'CANVAS',
  'CANVAS_VERSION',
  'UNKNOWN',
] as const;
const TEAM_BULLET_CATEGORIES = [
  'shipped',
  'achievement',
  'collaboration',
  'learning',
  'recognition',
  'learned',
  'helped',
  'milestone',
] as const;
/** Maximum team-brief bullets kept after generation. Prevents a per-member
 * firehose — only the most important team-wide takeaways should survive. */
const MAX_TEAM_SUMMARY_BULLETS = 8;
const TEAM_TIME_HORIZON = ['IMMEDIATE', 'THIS_WEEK', 'NEXT_TWO_WEEKS', 'LONGER_TERM'] as const;
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

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  const normalized = cleanString(value).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

/**
 * Case-insensitive category lookup that preserves the canonical (lowercase)
 * form stored in the schema. Bullet categories are lowercase, so a plain
 * `enumValue` (which uppercases the input) never matches and silently falls
 * back — making every bullet read "achievement". This normalizes both sides
 * to lowercase so the LLM-chosen category survives.
 */
function bulletCategoryValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  const normalized = cleanString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function priorityRank(value: unknown): number {
  const normalized = cleanString(value).toUpperCase();
  if (normalized === 'CRITICAL') return 0;
  if (normalized === 'HIGH') return 1;
  if (normalized === 'MEDIUM') return 2;
  if (normalized === 'LOW') return 3;
  return 4;
}

function statusRank(value: unknown): number {
  const normalized = cleanString(value).toUpperCase();
  if (['BLOCKED', 'OPEN', 'PENDING', 'CONFLICTING', 'AT_RISK'].includes(normalized)) return 0;
  if (['STALLED', 'REGRESSING'].includes(normalized)) return 1;
  if (['IN_PROGRESS', 'PLANNED'].includes(normalized)) return 2;
  if (['UNKNOWN', 'UNCLEAR'].includes(normalized)) return 3;
  if (['RESOLVED', 'COMPLETED', 'DECIDED'].includes(normalized)) return 4;
  return 5;
}

function movementRank(value: unknown): number {
  const normalized = cleanString(value).toUpperCase();
  if (['STALLED', 'REGRESSING'].includes(normalized)) return 0;
  if (normalized === 'PROGRESSING_WITH_RISK') return 1;
  if (normalized === 'PROGRESSING') return 2;
  if (normalized === 'UNCLEAR') return 3;
  return 4;
}

function timeHorizonRank(value: unknown): number {
  const normalized = cleanString(value).toUpperCase();
  if (normalized === 'IMMEDIATE') return 0;
  if (normalized === 'THIS_WEEK') return 1;
  if (normalized === 'NEXT_TWO_WEEKS') return 2;
  if (normalized === 'LONGER_TERM') return 3;
  return 4;
}

function leadershipRank(item: {
  priority?: unknown;
  severity?: unknown;
  riskLevel?: unknown;
  importance?: unknown;
  status?: unknown;
  movement?: unknown;
  timeHorizon?: unknown;
  needsLeadershipInput?: unknown;
}): number {
  return (
    priorityRank(item.priority ?? item.severity ?? item.riskLevel ?? item.importance) * 1000 +
    statusRank(item.status) * 100 +
    movementRank(item.movement) * 10 +
    timeHorizonRank(item.timeHorizon) -
    (item.needsLeadershipInput ? 25 : 0)
  );
}

function rankItems<
  T extends {
    priority?: unknown;
    severity?: unknown;
    riskLevel?: unknown;
    importance?: unknown;
    status?: unknown;
    movement?: unknown;
    timeHorizon?: unknown;
    needsLeadershipInput?: unknown;
  },
>(items: T[]): T[] {
  return [...items].sort((a, b) => leadershipRank(a) - leadershipRank(b));
}

function allStrings(values: string[]): string[] {
  return values;
}

function limitWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(' ') : value;
}

function isPlaceholderSummary(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('insufficient evidence to assess') ||
    normalized.includes('insufficient evidence to isolate') ||
    normalized.includes('no evidence-backed')
  );
}

function firstCleanString(values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned && !isPlaceholderSummary(cleaned)) {
      return cleaned;
    }
  }
  return '';
}

function simpleRecords(
  value: unknown,
  keys: string[] = ['items', 'facts']
): Record<string, unknown>[] {
  const record = asRecord(value);
  for (const key of keys) {
    const items = Array.isArray(record[key])
      ? (record[key] as unknown[]).filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
      : [];
    if (items.length > 0) {
      return items;
    }
  }
  return [];
}

function memberRefsFromFact(
  fact: Record<string, unknown>,
  validSignalIdsByIngestion: Map<string, Set<string>>,
  fallbackReason: string
): TeamMemberSignalRef[] {
  const rawRefs = [...asArray(fact.memberSignalRefs), ...asArray(fact.signalRefs)].map(asRecord);
  return rawRefs
    .map((ref) => {
      const userIngestionId = cleanString(ref.userIngestionId);
      const signalId = cleanString(ref.signalId);
      if (
        !userIngestionId ||
        !signalId ||
        !validSignalIdsByIngestion.get(userIngestionId)?.has(signalId)
      ) {
        return null;
      }
      return {
        userIngestionId,
        signalId,
        reason: cleanString(ref.reason, cleanString(fact.reason, fallbackReason)),
      };
    })
    .filter((ref): ref is TeamMemberSignalRef => ref !== null);
}

function dedupeMemberSignalRefs(refs: TeamMemberSignalRef[]): TeamMemberSignalRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.userIngestionId}:${ref.signalId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function userIdsFromFact(fact: Record<string, unknown>, userIds: Set<string>): string[] {
  return cleanStringArray(
    fact.userIds ?? fact.ownerUserIds ?? fact.affectedUserIds ?? fact.contributorUserIds
  ).filter((userId) => userIds.has(userId));
}

function workstreamIdsFromFact(
  fact: Record<string, unknown>,
  workstreams: TeamWorkstream[]
): string[] {
  const ids = new Set(workstreams.map((item) => item.id));
  const direct = cleanStringArray(fact.workstreamIds ?? fact.affectedWorkstreamIds).filter((id) =>
    ids.has(id)
  );
  if (direct.length > 0) {
    return direct;
  }
  const titles = new Set(
    cleanStringArray(fact.workstreamTitles ?? fact.relatedWorkTitles).map((title) =>
      title.toLowerCase()
    )
  );
  return workstreams.filter((item) => titles.has(item.title.toLowerCase())).map((item) => item.id);
}

function buildTeamLeadershipItems(
  facts: Record<string, unknown>[],
  prefix: string,
  validSignalIdsByIngestion: Map<string, Set<string>>,
  fallbackRefs: TeamMemberSignalRef[] = []
): TeamLeadershipItem[] {
  return facts.map((fact, index) => {
    const title = cleanString(fact.title, `${prefix} ${index + 1}`);
    const refs = memberRefsFromFact(fact, validSignalIdsByIngestion, `Evidence for ${title}`);
    return {
      id: `${prefix}_${index + 1}`,
      title,
      description: cleanString(fact.description ?? fact.detail, title),
      implication: cleanString(fact.implication, 'Leadership implication should be clarified.'),
      recommendedAction: cleanString(
        fact.recommendedAction ?? fact.action,
        'Clarify the next leadership action.'
      ),
      priority: enumValue(fact.priority ?? fact.severity, TEAM_PRIORITY, 'MEDIUM'),
      memberSignalRefs:
        refs.length > 0
          ? refs
          : fallbackRefs.slice(0, 3).map((ref) => ({ ...ref, reason: `Evidence for ${title}` })),
    };
  });
}

async function generateTeamSummarySectionsFromSimpleFacts(
  llmClient: LLMClient,
  input: TeamIntelligenceTeamLeadershipInput
): Promise<TeamGeneratedSections> {
  const validSignalIdsByIngestion = new Map(
    input.members.map((member) => [member.userIngestionId, collectIds(member)])
  );
  const memberByIngestionId = new Map(
    input.members.map((member) => [member.userIngestionId, member])
  );
  const memberByUserId = new Map(input.members.map((member) => [member.user.id, member]));
  const userIds = new Set(input.members.map((member) => member.user.id));
  const sourceFallbackRefs = dedupeMemberSignalRefs(
    input.members.flatMap((member) => {
      const validSignalIds =
        validSignalIdsByIngestion.get(member.userIngestionId) ?? new Set<string>();
      const prioritizedSignalIds = [
        ...member.activeWork.map((item) => item.id),
        ...member.criticalWork.map((item) => item.id),
        ...member.blockers.map((item) => item.id),
        ...member.upcomingCommitments.map((item) => item.id),
        ...member.decisionsAndAlignment.decisions.map((item) => item.id),
        ...member.managerAttention.map((item) => item.id),
        ...member.directionalSignals.map((item) => item.id),
        ...member.capabilitySignals.map((item) => item.id),
        ...member.dependencies.map((item) => item.id),
        ...member.unknowns.map((item) => item.id),
      ].filter((signalId) => validSignalIds.has(signalId));
      const signalIds = [
        ...new Set([...prioritizedSignalIds, ...Array.from(validSignalIds)]),
      ].slice(0, 3);
      return signalIds.map((signalId) => ({
        userIngestionId: member.userIngestionId,
        signalId,
        reason: 'Source evidence from completed user summary',
      }));
    })
  );
  const sectionFallbackRefs = new Map<string, TeamMemberSignalRef[]>();
  const fallbackRefsFor = (sectionName: string): TeamMemberSignalRef[] =>
    sectionFallbackRefs.get(sectionName) ?? [];
  const refsFromFact = (
    fact: Record<string, unknown>,
    fallbackReason: string,
    sectionName?: string
  ): TeamMemberSignalRef[] => {
    const refs = memberRefsFromFact(fact, validSignalIdsByIngestion, fallbackReason);
    if (refs.length > 0) {
      return refs;
    }
    const fallbackRefs = sectionName ? fallbackRefsFor(sectionName) : sourceFallbackRefs;
    return fallbackRefs.slice(0, 3).map((ref) => ({
      ...ref,
      reason: fallbackReason,
    }));
  };
  const runSection = async <T>(section: TeamPromptSection): Promise<T> => {
    const startedAt = Date.now();
    const logContext = {
      batchId: input.batchId,
      teamSummaryId: input.teamSummaryId,
      teamId: input.teamId,
      teamName: input.teamName,
      section: section.name,
      sourceMembers: section.source?.currentMemberSignals.length ?? input.members.length,
    };
    logger.info('[TEAM-INTEL-TEAM-SUMMARY] Team section started', logContext);
    try {
      const result = await runSectionWithFallback<T>({
        llmCall: (prompt, purpose) => llmGenerate(llmClient, prompt, { purpose }),
        jsonPrompt: buildSectionPrompt(input, section),
        outputShape: section.outputShape,
        purpose: `team-section-${section.name}`,
        label: `LLM team ${section.name} section response`,
        logTag: '[TEAM-INTEL-TEAM-SUMMARY]',
      });
      logger.info('[TEAM-INTEL-TEAM-SUMMARY] Team section completed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error('[TEAM-INTEL-TEAM-SUMMARY] Team section failed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };
  const runSectionWave = async (
    waveName: string,
    sections: Record<string, TeamPromptSection>
  ): Promise<Record<string, Record<string, unknown>>> => {
    const startedAt = Date.now();
    const sectionNames = Object.values(sections).map((section) => section.name);
    const concurrency = getTeamIntelligenceSectionConcurrency('team', sectionNames.length);
    logger.info('[TEAM-INTEL-TEAM-SUMMARY] Team section wave started', {
      batchId: input.batchId,
      teamSummaryId: input.teamSummaryId,
      teamId: input.teamId,
      teamName: input.teamName,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
    });
    for (const section of Object.values(sections)) {
      sectionFallbackRefs.set(
        section.name,
        buildTeamSectionFallbackRefs(section.source, validSignalIdsByIngestion)
      );
    }
    const entries = await mapWithConcurrency(
      Object.entries(sections),
      concurrency,
      async ([key, section]) => [key, await runSection<Record<string, unknown>>(section)] as const
    );
    logger.info('[TEAM-INTEL-TEAM-SUMMARY] Team section wave completed', {
      batchId: input.batchId,
      teamSummaryId: input.teamSummaryId,
      teamId: input.teamId,
      teamName: input.teamName,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
      durationMs: Date.now() - startedAt,
    });
    return Object.fromEntries(entries);
  };
  const itemShape = {
    title: 'string',
    description: 'rich qualitative detail',
    status: 'PLANNED|IN_PROGRESS|BLOCKED|COMPLETED|UNKNOWN',
    priority: 'CRITICAL|HIGH|MEDIUM|LOW',
    memberSignalRefs: [
      {
        userIngestionId: 'exact member userIngestionId',
        signalId: 'exact signal id from that member payload',
        reason: 'string',
      },
    ],
  };

  const extractionRaw = await runSectionWave('source-extraction', {
    who: {
      name: 'who-is-doing-what',
      source: buildTeamSectionSource(input, ['activeWork', 'criticalWork'], ['workstreams']),
      instructions: [
        '- Return an items array with every qualitative team workstream fact that meets the leadership-significance rules; do not create final schema IDs.',
        '- Include only work that is critical/high priority, blocked, moving with risk, or strategically meaningful for a manager. Do not enumerate every member task.',
        '- Prefer simple title, description/text, priority/importance, status, progress, and owner user IDs when supported. memberSignalRefs are optional.',
        '- Deduplicate the same work reported by multiple members.',
      ],
      outputShape: {
        items: [{ ...itemShape, progress: 'string', ownerUserIds: ['exact member user id'] }],
      },
    },
    needs: {
      name: 'needs-unblocking',
      source: buildTeamSectionSource(
        input,
        ['blockers', 'dependencies', 'managerAttention'],
        ['blockers', 'workstreams']
      ),
      instructions: [
        '- Return an items array with every real team blocker fact that needs manager attention; do not create final schema IDs.',
        '- Include only blockers needing manager attention, clear ownership, decisioning, dependency clearing, or escalation.',
        '- Include qualitative blocker detail, affected users/workstreams, and needed action. Do not invent firstSeen/daysOpen; the system will set report-date continuity fields.',
      ],
      outputShape: {
        items: [
          {
            ...itemShape,
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            affectedUserIds: ['exact member user id'],
            workstreamTitles: ['string'],
            needsActionFrom: ['string'],
            recommendedAction: 'string',
            firstSeen: 'omit or null; system-owned',
            daysOpen: 'omit or null; system-owned',
          },
        ],
      },
    },
    critical: {
      name: 'critical-and-moving',
      source: buildTeamSectionSource(
        input,
        ['criticalWork', 'activeWork', 'blockers'],
        ['workstreams', 'blockers']
      ),
      instructions: [
        '- Return an items array with every critical moving team fact; do not create final schema IDs.',
        '- Include only critical/high-value movement, blocked critical work, or progressing-with-risk work. Do not include routine progress.',
        '- Include why critical, movement, progress description, risk, and owner users. memberSignalRefs are optional.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            whyCritical: 'string',
            movement: 'PROGRESSING|PROGRESSING_WITH_RISK|STALLED|REGRESSING|UNCLEAR',
            progressDescription: 'string',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            ownerUserIds: ['exact member user id'],
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
      },
    },
    momentum: {
      name: 'momentum-and-direction',
      source: buildTeamSectionSource(
        input,
        ['momentumAndDirection', 'activeWork', 'criticalWork', 'blockers'],
        ['workstreams', 'directionalSignals']
      ),
      instructions: [
        '- Return one qualitative momentum assessment with simple arrays of related workstream titles.',
        '- Distinguish meaningful progress from activity volume.',
        '- Include only the most decision-relevant related titles, ranked by material impact; omit routine or redundant titles.',
      ],
      outputShape: {
        momentum: 'FORWARD|FORWARD_WITH_BLOCKERS|MIXED|FLAT|REGRESSING|INSUFFICIENT_BASELINE',
        direction:
          'TOWARD_STATED_GOALS|COHERENT_INFERRED_DIRECTION|MIXED_OR_UNCLEAR|AWAY_FROM_STATED_GOALS|INSUFFICIENT_EVIDENCE',
        assessment: 'string',
        progressingWorkstreamTitles: ['string'],
        stalledWorkstreamTitles: ['string'],
        busyButNotClearlyDirectional: ['string'],
        memberSignalRefs: itemShape.memberSignalRefs,
      },
    },
    decisions: {
      name: 'decisions-and-alignment',
      source: buildTeamSectionSource(
        input,
        ['decisionsAndAlignment', 'dependencies', 'managerAttention'],
        ['decisions']
      ),
      instructions: [
        '- Return qualitative alignment status plus simple decision facts; do not create final schema IDs.',
        '- Separate conflicts and open questions from decisions.',
        '- Include only the highest-impact decisions, prioritizing unresolved, irreversible, conflicting, or leadership-input decisions.',
      ],
      outputShape: {
        alignmentStatus: 'ALIGNED|PARTIALLY_ALIGNED|MISALIGNED|INSUFFICIENT_EVIDENCE',
        decisions: [
          {
            decision: 'string',
            context: 'string',
            impact: 'string',
            participants: ['string'],
            reversibility: 'REVERSIBLE|IRREVERSIBLE|UNCLEAR',
            needsLeadershipInput: false,
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
        conflicts: ['string'],
        openQuestions: ['string'],
      },
    },
    people: {
      name: 'people-load-focus-and-gaps',
      source: buildTeamSectionSource(
        input,
        ['loadAndFocus', 'managerAttention', 'unknowns'],
        ['loadSignals', 'capabilitySignals']
      ),
      instructions: [
        '- Return simple arrays for overloadedMembers, lowVisibilityMembers, contextSwitchingRisks, singlePointsOfFailure, ownershipGaps, and supportGaps.',
        '- Keep qualitative detail high and do not judge individual performance.',
        '- Include only the most consequential manager-actionable load, focus, ownership, or support concerns. Omit unsupported, routine, or lower-impact observations.',
      ],
      outputShape: {
        overloadedMembers: [
          {
            userId: 'exact member user id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
        lowVisibilityMembers: [
          {
            userId: 'exact member user id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
        contextSwitchingRisks: [
          {
            userId: 'exact member user id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
        singlePointsOfFailure: [
          {
            userId: 'exact member user id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
        ownershipGaps: [itemShape],
        supportGaps: [itemShape],
      },
    },
    upcoming: {
      name: 'upcoming-and-at-risk',
      source: buildTeamSectionSource(
        input,
        ['upcomingCommitments', 'dependencies', 'blockers'],
        ['workstreams', 'blockers']
      ),
      instructions: [
        '- Return an items array with every upcoming commitment or risk that a manager should actively track.',
        '- Include only at-risk commitments, critical deadlines, unowned dependencies, or risks a manager should actively track.',
        '- Include owners, dependencies, required next steps, and dates only when explicit. memberSignalRefs are optional.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            description: 'string',
            expectedDate: 'ISO-8601 string or null',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            ownerUserIds: ['exact member user id'],
            dependencies: ['string'],
            requiredNextSteps: ['string'],
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
      },
    },
    directional: {
      name: 'directional-bet',
      source: buildTeamSectionSource(
        input,
        ['directionalSignals', 'activeWork', 'criticalWork', 'dependencies'],
        ['directionalSignals', 'workstreams']
      ),
      instructions: [
        '- Return one qualitative directional bet assessment with technical/business waves and small things that can become big.',
        '- Separate explicit stated bets from inferred bets.',
        '- Include only the strongest genuinely strategic smallThingThatCanBecomeBig signals supported by the evidence.',
      ],
      outputShape: {
        statedBet: 'string or null',
        inferredBet: 'string or null',
        technicalWaves: ['string'],
        businessWaves: ['string'],
        smallThingThatCanBecomeBig: [itemShape],
        alignmentAssessment: 'ALIGNED|PARTIALLY_ALIGNED|MISALIGNED|INSUFFICIENT_EVIDENCE',
        assessment: 'string',
        confidence: 'HIGH|MEDIUM|LOW',
        memberSignalRefs: itemShape.memberSignalRefs,
      },
    },
    capability: {
      name: 'capability-mix',
      source: buildTeamSectionSource(
        input,
        ['capabilitySignals', 'loadAndFocus', 'managerAttention'],
        ['capabilitySignals', 'loadSignals']
      ),
      instructions: [
        '- Return qualitative capability mix arrays; capability signals are coverage/gap observations, not performance ratings.',
        '- Include only the most material capability signals. Prioritize missing capabilities, single-person dependencies, and strengths relevant to critical work.',
      ],
      outputShape: {
        observedStrengths: [itemShape],
        developingCapabilities: [itemShape],
        missingCapabilities: [itemShape],
        singlePersonDependencies: [itemShape],
        projectPhaseFit: [itemShape],
        assessment: 'string',
        confidence: 'HIGH|MEDIUM|LOW',
      },
    },
    leadershipTouch: {
      name: 'leadership-touch',
      source: buildTeamSectionSource(
        input,
        ['managerAttention', 'blockers', 'criticalWork', 'loadAndFocus', 'momentumAndDirection'],
        ['workstreams', 'blockers', 'loadSignals']
      ),
      instructions: [
        '- Return one qualitative leadership touch assessment.',
        '- Low-touch means less leadership intervention is required now; it never means unimportant.',
      ],
      outputShape: {
        currentObservedMode: 'HIGH_TOUCH|MEDIUM_TOUCH|LOW_TOUCH|INSUFFICIENT_EVIDENCE',
        recommendedMode: 'HIGH_TOUCH|MEDIUM_TOUCH|LOW_TOUCH|INSUFFICIENT_EVIDENCE',
        reasons: ['string'],
        interventionTriggers: ['string'],
        delegationSignals: ['string'],
        confidence: 'HIGH|MEDIUM|LOW',
        memberSignalRefs: itemShape.memberSignalRefs,
      },
    },
    bottlenecks: {
      name: 'bottlenecks',
      source: buildTeamSectionSource(
        input,
        ['blockers', 'dependencies', 'loadAndFocus', 'managerAttention', 'unknowns'],
        ['blockers', 'capabilitySignals', 'loadSignals']
      ),
      instructions: [
        '- Return qualitative bottleneck arrays separated into peopleOrOwnership, process, and platform.',
        '- Include only the highest-impact bottlenecks that can change team outcomes.',
      ],
      outputShape: { peopleOrOwnership: [itemShape], process: [itemShape], platform: [itemShape] },
    },
    leverage: {
      name: 'leadership-leverage',
      source: buildTeamSectionSource(
        input,
        [
          'managerAttention',
          'blockers',
          'criticalWork',
          'decisionsAndAlignment',
          'dependencies',
          'capabilitySignals',
        ],
        ['blockers', 'decisions', 'capabilitySignals']
      ),
      instructions: [
        '- Return qualitative leadership leverage arrays. Include only concrete leverage points tied to source evidence.',
        '- Include only the highest-leverage points tied to source evidence. Omit nice-to-know observations that do not change a manager decision.',
      ],
      outputShape: {
        irreversibleDecisions: [itemShape],
        budgetOrApprovalNeeds: [itemShape],
        momentumCorrections: [itemShape],
        connectionsNeeded: [itemShape],
        problemShapingNeeds: [itemShape],
        learningAndUpskilling: [itemShape],
        tradeoffs: [itemShape],
        alignmentCorrections: [itemShape],
      },
    },
    nextLeap: {
      name: 'next-leap',
      source: buildTeamSectionSource(
        input,
        [
          'summary',
          'criticalWork',
          'blockers',
          'directionalSignals',
          'capabilitySignals',
          'dependencies',
          'upcomingCommitments',
          'momentumAndDirection',
        ],
        ['workstreams', 'directionalSignals', 'capabilitySignals', 'blockers']
      ),
      instructions: [
        '- Return one qualitative next-leap assessment.',
        '- State what is wrong, what comes next, and the next meaningful leap without unsupported facts.',
        '- Include only the most decision-relevant people/process/platform/successSignal items supported by the evidence.',
      ],
      outputShape: {
        whatNext: 'string',
        whatIsWrong: 'string',
        theLeap: 'string',
        peopleChanges: ['string'],
        processChanges: ['string'],
        platformChanges: ['string'],
        successSignals: ['string'],
        memberSignalRefs: itemShape.memberSignalRefs,
      },
    },
    goals: {
      name: 'team-10x-goal-alignment',
      source: buildTeamSectionSource(
        input,
        [
          'summary',
          'activeWork',
          'criticalWork',
          'blockers',
          'momentumAndDirection',
          'decisionsAndAlignment',
          'directionalSignals',
          'dependencies',
          'upcomingCommitments',
          'managerAttention',
        ],
        ['workstreams', 'directionalSignals', 'blockers', 'decisions']
      ),
      instructions: [
        '- Return items only for externalTeamGoals that have a concrete match in currentMemberSignals.',
        '- If externalTeamGoals is empty, or if no supplied member signal shows progress/discussion/risk toward a goal, return {"items":[]}.',
        '- Treat 10X, 5X, and 2X tracks as valid; this section is named team10xGoal for product compatibility but should include matched goals from any supplied track.',
        '- Explain whether the team appears to be working toward the goal, what they are discussing/building/unblocking, and how the evidence matches the goal.',
        '- Prefer explicit directionalSignals and critical/active work; tickets, calls, conversations, and PRs may be inferred only from evidenceRefs.sourceType inside the supplied member signals.',
        '- Do not invent goals, owners, source types, dates, or progress. Use exact goalId values from externalTeamGoals and exact memberSignalRefs from currentMemberSignals.',
      ],
      outputShape: {
        items: [
          {
            goalId: 'exact externalTeamGoals id',
            matchStrength: 'STRONG|PARTIAL|WEAK',
            isTeamWorkingTowardsGoal: true,
            summary:
              'concise explanation of what the team is doing or discussing and how it maps to the goal',
            matchedSignals: ['short evidence-backed signal text'],
            evidenceSourceTypes: [
              'PULL_REQUEST|COMMIT|AI_USAGE|TICKET|TICKET_ACTIVITY|CONVERSATION|MESSAGE|CALL|CANVAS|CANVAS_VERSION|UNKNOWN',
            ],
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
      },
    },
    actions: {
      name: 'recommended-actions',
      source: buildTeamSectionSource(
        input,
        [
          'managerAttention',
          'blockers',
          'criticalWork',
          'upcomingCommitments',
          'decisionsAndAlignment',
          'dependencies',
        ],
        ['blockers', 'decisions', 'workstreams']
      ),
      instructions: [
        '- Return an items array with every concrete recommended leadership action that is supported by the evidence.',
        '- Prioritize CRITICAL/HIGH and IMMEDIATE/THIS_WEEK actions. Omit routine follow-ups.',
      ],
      outputShape: {
        items: [
          {
            priority: 'CRITICAL|HIGH|MEDIUM|LOW',
            timeHorizon: 'IMMEDIATE|THIS_WEEK|NEXT_TWO_WEEKS|LONGER_TERM',
            action: 'string',
            why: 'string',
            suggestedOwner: 'string or null',
            expectedOutcome: 'string',
            memberSignalRefs: itemShape.memberSignalRefs,
          },
        ],
      },
    },
    dataGaps: {
      name: 'data-gaps',
      source: buildTeamSectionSource(input, ['unknowns']),
      instructions: [
        '- Return only an items array of evidence/data gaps that limit interpretation.',
        '- Include only evidence/data gaps that materially change manager confidence or require corrective action.',
      ],
      outputShape: { items: [{ gap: 'string', impact: 'string' }] },
    },
  });
  const whoRaw = extractionRaw.who;
  const whoIsDoingWhat = simpleRecords(whoRaw)
    .map((fact, index): TeamWorkstream | null => {
      const refs = refsFromFact(fact, 'Evidence for team workstream', 'who-is-doing-what');
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Workstream ${index + 1}`);
      const ownerUserIds = userIdsFromFact(fact, userIds);
      const refOwnerIds = refs
        .map((ref) => memberByIngestionId.get(ref.userIngestionId)?.user.id)
        .filter((userId): userId is string => Boolean(userId));
      const owners = [...new Set([...ownerUserIds, ...refOwnerIds])]
        .map((userId) => memberByUserId.get(userId))
        .filter((member): member is TeamIntelligenceTeamAggregationPayload => Boolean(member))
        .map((member) => ({
          userId: member.user.id,
          userName: member.user.name,
          responsibility: cleanString(fact.responsibility, 'Visible contributor or owner'),
        }));
      return {
        id: `workstream_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        status: enumValue(fact.status, TEAM_WORK_STATUS, 'UNKNOWN'),
        importance: enumValue(fact.importance ?? fact.priority, TEAM_PRIORITY, 'MEDIUM'),
        progress: cleanString(fact.progress ?? fact.description, title),
        owners,
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamWorkstream => item !== null);
  const rankedWhoIsDoingWhat = rankItems(whoIsDoingWhat);

  const needsRaw = extractionRaw.needs;
  const needsUnblocking = simpleRecords(needsRaw)
    .map((fact, index): TeamBlocker | null => {
      const refs = refsFromFact(fact, 'Evidence for team blocker', 'needs-unblocking');
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Blocker ${index + 1}`);
      return {
        id: `blocker_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        severity: enumValue(fact.severity ?? fact.priority, TEAM_PRIORITY, 'MEDIUM'),
        status: enumValue(fact.status, TEAM_BLOCKER_STATUS, 'OPEN'),
        affectedUserIds: userIdsFromFact(fact, userIds),
        affectedWorkstreamIds: workstreamIdsFromFact(fact, rankedWhoIsDoingWhat),
        needsActionFrom: allStrings(cleanStringArray(fact.needsActionFrom)),
        recommendedAction: cleanString(
          fact.recommendedAction ?? fact.action,
          'Clarify the next unblock action.'
        ),
        firstSeen: input.reportDate,
        daysOpen: 1,
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamBlocker => item !== null);
  const rankedNeedsUnblocking = rankItems(needsUnblocking);

  const criticalRaw = extractionRaw.critical;
  const criticalAndMoving = simpleRecords(criticalRaw)
    .map((fact, index): TeamCriticalItem | null => {
      const refs = refsFromFact(fact, 'Evidence for critical team work', 'critical-and-moving');
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Critical item ${index + 1}`);
      return {
        id: `critical_${index + 1}`,
        title,
        whyCritical: cleanString(fact.whyCritical ?? fact.description, title),
        movement: enumValue(fact.movement, TEAM_MOVEMENT, 'UNCLEAR'),
        progressDescription: cleanString(
          fact.progressDescription ?? fact.progress ?? fact.description,
          title
        ),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, TEAM_PRIORITY, 'MEDIUM'),
        ownerUserIds: userIdsFromFact(fact, userIds),
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamCriticalItem => item !== null);
  const rankedCriticalAndMoving = rankItems(criticalAndMoving);

  const momentumRaw = extractionRaw.momentum;
  const momentumRecord = asRecord(momentumRaw.momentumAndDirection ?? momentumRaw);
  const momentumAndDirection: TeamOperationalSnapshot['momentumAndDirection'] = {
    momentum: enumValue(momentumRecord.momentum, TEAM_MOMENTUM, 'INSUFFICIENT_BASELINE'),
    direction: enumValue(momentumRecord.direction, TEAM_DIRECTION, 'INSUFFICIENT_EVIDENCE'),
    assessment: cleanString(
      momentumRecord.assessment,
      'Insufficient evidence to assess team momentum confidently.'
    ),
    progressingWorkstreamIds: workstreamIdsFromFact(
      { workstreamTitles: momentumRecord.progressingWorkstreamTitles },
      rankedWhoIsDoingWhat
    ),
    stalledWorkstreamIds: workstreamIdsFromFact(
      { workstreamTitles: momentumRecord.stalledWorkstreamTitles },
      rankedWhoIsDoingWhat
    ),
    busyButNotClearlyDirectional: allStrings(
      cleanStringArray(momentumRecord.busyButNotClearlyDirectional)
    ),
    memberSignalRefs: refsFromFact(
      momentumRecord,
      'Evidence for team momentum',
      'momentum-and-direction'
    ),
  };

  const decisionsRaw = extractionRaw.decisions;
  const decisionsRecord = asRecord(decisionsRaw.decisionsAndAlignment ?? decisionsRaw);
  const decisions = simpleRecords(decisionsRecord, ['decisions', 'items'])
    .map((fact, index): TeamDecision | null => {
      const refs = refsFromFact(fact, 'Evidence for team decision', 'decisions-and-alignment');
      if (refs.length === 0) return null;
      const decision = cleanString(fact.decision ?? fact.title, `Decision ${index + 1}`);
      return {
        id: `decision_${index + 1}`,
        decision,
        context: cleanString(fact.context ?? fact.description, decision),
        impact: cleanString(fact.impact, 'Impact not fully specified in evidence.'),
        participants: allStrings(cleanStringArray(fact.participants)),
        reversibility: enumValue(fact.reversibility, TEAM_REVERSIBILITY, 'UNCLEAR'),
        needsLeadershipInput: Boolean(fact.needsLeadershipInput),
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamDecision => item !== null);
  const rankedDecisions = rankItems(decisions);
  const decisionsAndAlignment: TeamOperationalSnapshot['decisionsAndAlignment'] = {
    alignmentStatus: enumValue(
      decisionsRecord.alignmentStatus,
      TEAM_ALIGNMENT,
      'INSUFFICIENT_EVIDENCE'
    ),
    decisions: rankedDecisions,
    conflicts: allStrings(cleanStringArray(decisionsRecord.conflicts)),
    openQuestions: allStrings(cleanStringArray(decisionsRecord.openQuestions)),
  };

  const peopleRaw = extractionRaw.people;
  const peopleRecord = asRecord(peopleRaw.peopleLoadFocusAndGaps ?? peopleRaw);
  const buildPeopleAssessments = (key: string, prefix: string): TeamPersonAssessment[] =>
    simpleRecords(peopleRecord, [key])
      .map((fact) => {
        const userId = cleanString(fact.userId);
        const member = memberByUserId.get(userId);
        const refs = refsFromFact(fact, `Evidence for ${prefix}`, 'people-load-focus-and-gaps');
        if (!member || refs.length === 0) return null;
        return {
          userId,
          userName: member.user.name,
          assessment: cleanString(
            fact.assessment ?? fact.description,
            `${prefix} for ${member.user.name}`
          ),
          severity: enumValue(fact.severity ?? fact.priority, TEAM_PRIORITY, 'MEDIUM'),
          memberSignalRefs: refs,
        };
      })
      .filter((item): item is TeamPersonAssessment => item !== null);
  const peopleLoadFocusAndGaps: TeamOperationalSnapshot['peopleLoadFocusAndGaps'] = {
    overloadedMembers: rankItems(buildPeopleAssessments('overloadedMembers', 'load signal')),
    lightOrInsufficientlyVisibleMembers: rankItems(
      buildPeopleAssessments('lowVisibilityMembers', 'visibility signal')
    ),
    contextSwitchingRisks: rankItems(
      buildPeopleAssessments('contextSwitchingRisks', 'context switching risk')
    ),
    singlePointsOfFailure: rankItems(
      buildPeopleAssessments('singlePointsOfFailure', 'single point of failure')
    ),
    ownershipGaps: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(peopleRecord, ['ownershipGaps']),
        'ownership_gap',
        validSignalIdsByIngestion,
        fallbackRefsFor('people-load-focus-and-gaps')
      )
    ),
    supportGaps: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(peopleRecord, ['supportGaps']),
        'support_gap',
        validSignalIdsByIngestion,
        fallbackRefsFor('people-load-focus-and-gaps')
      )
    ),
  };

  const upcomingRaw = extractionRaw.upcoming;
  const upcomingAndAtRisk = simpleRecords(upcomingRaw)
    .map((fact, index): TeamRisk | null => {
      const refs = refsFromFact(fact, 'Evidence for team risk', 'upcoming-and-at-risk');
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Risk ${index + 1}`);
      return {
        id: `risk_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        expectedDate: nullableString(fact.expectedDate),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, TEAM_PRIORITY, 'MEDIUM'),
        ownerUserIds: userIdsFromFact(fact, userIds),
        dependencies: allStrings(cleanStringArray(fact.dependencies)),
        requiredNextSteps: allStrings(cleanStringArray(fact.requiredNextSteps ?? fact.nextSteps)),
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamRisk => item !== null);
  const rankedUpcomingAndAtRisk = rankItems(upcomingAndAtRisk);

  const directionalRaw = extractionRaw.directional;
  const directionalRecord = asRecord(directionalRaw.directionalBet ?? directionalRaw);
  const directionalBet: TeamLeadershipSnapshot['directionalBet'] = {
    statedBet: nullableString(directionalRecord.statedBet),
    inferredBet: nullableString(directionalRecord.inferredBet),
    technicalWaves: allStrings(cleanStringArray(directionalRecord.technicalWaves)),
    businessWaves: allStrings(cleanStringArray(directionalRecord.businessWaves)),
    smallThingThatCanBecomeBig: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(directionalRecord, ['smallThingThatCanBecomeBig', 'items']),
        'small_bet',
        validSignalIdsByIngestion,
        fallbackRefsFor('directional-bet')
      )
    ),
    alignmentAssessment: enumValue(
      directionalRecord.alignmentAssessment,
      TEAM_ALIGNMENT,
      'INSUFFICIENT_EVIDENCE'
    ),
    assessment: cleanString(
      directionalRecord.assessment,
      'Insufficient evidence to assess directional bet confidently.'
    ),
    memberSignalRefs: refsFromFact(
      directionalRecord,
      'Evidence for directional bet',
      'directional-bet'
    ),
    confidence: enumValue(directionalRecord.confidence, TEAM_CONFIDENCE, 'MEDIUM'),
  };

  const capabilityRaw = extractionRaw.capability;
  const capabilityRecord = asRecord(capabilityRaw.capabilityMix ?? capabilityRaw);
  const capabilityMix: TeamLeadershipSnapshot['capabilityMix'] = {
    observedStrengths: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(capabilityRecord, ['observedStrengths']),
        'capability_strength',
        validSignalIdsByIngestion,
        fallbackRefsFor('capability-mix')
      )
    ),
    developingCapabilities: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(capabilityRecord, ['developingCapabilities']),
        'capability_developing',
        validSignalIdsByIngestion,
        fallbackRefsFor('capability-mix')
      )
    ),
    missingCapabilities: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(capabilityRecord, ['missingCapabilities']),
        'capability_missing',
        validSignalIdsByIngestion,
        fallbackRefsFor('capability-mix')
      )
    ),
    singlePersonDependencies: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(capabilityRecord, ['singlePersonDependencies']),
        'single_person_dependency',
        validSignalIdsByIngestion,
        fallbackRefsFor('capability-mix')
      )
    ),
    projectPhaseFit: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(capabilityRecord, ['projectPhaseFit']),
        'phase_fit',
        validSignalIdsByIngestion,
        fallbackRefsFor('capability-mix')
      )
    ),
    assessment: cleanString(
      capabilityRecord.assessment,
      'Insufficient evidence to assess capability mix confidently.'
    ),
    confidence: enumValue(capabilityRecord.confidence, TEAM_CONFIDENCE, 'MEDIUM'),
  };

  const touchRaw = extractionRaw.leadershipTouch;
  const touchRecord = asRecord(touchRaw.leadershipTouch ?? touchRaw);
  const leadershipTouch: TeamLeadershipSnapshot['leadershipTouch'] = {
    currentObservedMode: enumValue(
      touchRecord.currentObservedMode,
      TEAM_TOUCH,
      'INSUFFICIENT_EVIDENCE'
    ),
    recommendedMode: enumValue(touchRecord.recommendedMode, TEAM_TOUCH, 'INSUFFICIENT_EVIDENCE'),
    reasons: allStrings(cleanStringArray(touchRecord.reasons)),
    interventionTriggers: allStrings(cleanStringArray(touchRecord.interventionTriggers)),
    delegationSignals: allStrings(cleanStringArray(touchRecord.delegationSignals)),
    memberSignalRefs: refsFromFact(
      touchRecord,
      'Evidence for leadership touch',
      'leadership-touch'
    ),
    confidence: enumValue(touchRecord.confidence, TEAM_CONFIDENCE, 'MEDIUM'),
  };

  const bottlenecksRaw = extractionRaw.bottlenecks;
  const bottleneckRecord = asRecord(bottlenecksRaw.bottlenecks ?? bottlenecksRaw);
  const bottlenecks: TeamLeadershipSnapshot['bottlenecks'] = {
    peopleOrOwnership: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(bottleneckRecord, ['peopleOrOwnership']),
        'people_bottleneck',
        validSignalIdsByIngestion,
        fallbackRefsFor('bottlenecks')
      )
    ),
    process: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(bottleneckRecord, ['process']),
        'process_bottleneck',
        validSignalIdsByIngestion,
        fallbackRefsFor('bottlenecks')
      )
    ),
    platform: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(bottleneckRecord, ['platform']),
        'platform_bottleneck',
        validSignalIdsByIngestion,
        fallbackRefsFor('bottlenecks')
      )
    ),
  };

  const leverageRaw = extractionRaw.leverage;
  const leverageRecord = asRecord(leverageRaw.leadershipLeverage ?? leverageRaw);
  const leadershipLeverage: TeamLeadershipSnapshot['leadershipLeverage'] = {
    irreversibleDecisions: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['irreversibleDecisions']),
        'irreversible_decision',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    budgetOrApprovalNeeds: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['budgetOrApprovalNeeds']),
        'budget_need',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    momentumCorrections: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['momentumCorrections']),
        'momentum_correction',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    connectionsNeeded: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['connectionsNeeded']),
        'connection_needed',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    problemShapingNeeds: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['problemShapingNeeds']),
        'problem_shaping',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    learningAndUpskilling: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['learningAndUpskilling']),
        'learning_need',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    tradeoffs: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['tradeoffs']),
        'tradeoff',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    alignmentCorrections: rankItems(
      buildTeamLeadershipItems(
        simpleRecords(leverageRecord, ['alignmentCorrections']),
        'alignment_correction',
        validSignalIdsByIngestion,
        fallbackRefsFor('leadership-leverage')
      )
    ),
  };

  const nextLeapRaw = extractionRaw.nextLeap;
  const nextLeapRecord = asRecord(nextLeapRaw.nextLeap ?? nextLeapRaw);
  const nextLeap: TeamLeadershipSnapshot['nextLeap'] = {
    whatNext: cleanString(nextLeapRecord.whatNext, 'Clarify the next team step.'),
    whatIsWrong: cleanString(
      nextLeapRecord.whatIsWrong,
      'Insufficient evidence to isolate the core issue.'
    ),
    theLeap: cleanString(
      nextLeapRecord.theLeap,
      'Define the next meaningful leap with leadership.'
    ),
    peopleChanges: allStrings(cleanStringArray(nextLeapRecord.peopleChanges)),
    processChanges: allStrings(cleanStringArray(nextLeapRecord.processChanges)),
    platformChanges: allStrings(cleanStringArray(nextLeapRecord.platformChanges)),
    successSignals: allStrings(cleanStringArray(nextLeapRecord.successSignals)),
    memberSignalRefs: refsFromFact(nextLeapRecord, 'Evidence for next leap', 'next-leap'),
  };

  const goalsById = new Map(input.teamGoals.map((goal) => [goal.id, goal]));
  const goalsRaw = extractionRaw.goals;
  const team10xGoal = simpleRecords(goalsRaw)
    .map((fact): TeamGoalAlignment | null => {
      const goalId = cleanString(fact.goalId ?? fact.id);
      const goal = goalsById.get(goalId);
      if (!goal) return null;

      const refs = refsFromFact(
        fact,
        'Evidence for team goal alignment',
        'team-10x-goal-alignment'
      );
      if (refs.length === 0) return null;

      const evidenceSourceTypes: TeamEvidenceSourceType[] = cleanStringArray(
        fact.evidenceSourceTypes
      ).map((sourceType) => enumValue(sourceType, TEAM_EVIDENCE_SOURCE_TYPES, 'UNKNOWN'));
      const matchedSignals = allStrings(
        cleanStringArray(fact.matchedSignals ?? fact.signals ?? fact.evidence)
      );
      const normalizedEvidenceSourceTypes: TeamEvidenceSourceType[] = [
        ...new Set<TeamEvidenceSourceType>(
          evidenceSourceTypes.length > 0 ? evidenceSourceTypes : ['UNKNOWN']
        ),
      ];
      const summary = cleanString(
        fact.summary ?? fact.description,
        `Team activity has evidence that maps to ${goal.title}.`
      );

      return {
        goalId,
        title: goal.title,
        description: goal.description ?? null,
        track: enumValue(goal.track, TEAM_GOAL_TRACKS, 'UNKNOWN'),
        status: typeof goal.status === 'string' && goal.status.trim() ? goal.status.trim() : null,
        visibility:
          typeof goal.visibility === 'string' && goal.visibility.trim()
            ? goal.visibility.trim()
            : null,
        matchStrength: enumValue(fact.matchStrength, TEAM_GOAL_MATCH_STRENGTH, 'PARTIAL'),
        isTeamWorkingTowardsGoal: Boolean(fact.isTeamWorkingTowardsGoal ?? true),
        summary,
        matchedSignals,
        evidenceSourceTypes: normalizedEvidenceSourceTypes,
        memberSignalRefs: refs,
      };
    })
    .filter((item): item is TeamGoalAlignment => item !== null);

  const actionsRaw = extractionRaw.actions;
  const recommendedActions = simpleRecords(actionsRaw).map((fact, index) => ({
    id: `action_${index + 1}`,
    priority: enumValue(fact.priority, TEAM_PRIORITY, 'MEDIUM'),
    timeHorizon: enumValue(fact.timeHorizon, TEAM_TIME_HORIZON, 'THIS_WEEK'),
    action: cleanString(fact.action, `Review action ${index + 1}.`),
    why: cleanString(fact.why ?? fact.reason, 'Evidence indicates this action may help.'),
    suggestedOwner: nullableString(fact.suggestedOwner),
    expectedOutcome: cleanString(fact.expectedOutcome, 'Improved execution clarity.'),
    memberSignalRefs: refsFromFact(fact, 'Evidence for recommended action', 'recommended-actions'),
  }));
  const rankedRecommendedActions = rankItems(recommendedActions);

  const dataGapsRaw = extractionRaw.dataGaps;
  const dataGaps = simpleRecords(dataGapsRaw).map((fact) => ({
    gap: cleanString(fact.gap ?? fact.title, 'Unspecified data gap'),
    impact: cleanString(
      fact.impact ?? fact.description,
      'This limits confidence in the leadership snapshot.'
    ),
  }));

  const fallbackRefs = dedupeMemberSignalRefs([
    ...rankedWhoIsDoingWhat.flatMap((item) => item.memberSignalRefs),
    ...rankedCriticalAndMoving.flatMap((item) => item.memberSignalRefs),
    ...rankedNeedsUnblocking.flatMap((item) => item.memberSignalRefs),
    ...sourceFallbackRefs,
  ]);
  const finalSummaryRaw = await runSection<Record<string, unknown>>({
    name: 'final-dependent-summary',
    source: buildTeamSectionSource(input, ['summary', 'managerAttention', 'confidence']),
    instructions: [
      '- Return one final dependent summary object only.',
      '- Base overallConfidence on evidence breadth, member coverage, consistency, and data gaps.',
      '- Synthesize the generated sections and supplied compact member source without adding unsupported facts.',
      '- executiveSummary must be concise, qualitative, and manager-ready.',
      '- managerSummaryBullets must contain only the 3 to 5 most important, evidence-backed leadership takeaways for this team — facts whose omission could change a manager decision or understanding. Select material blockers, risks, outcomes, goal movement, unresolved decisions, and high-leverage actions. Do not emit one bullet per member or routine update; merge related points. Return fewer than 3 when evidence is weak and never exceed 5.',
    ],
    outputShape: {
      overallConfidence: 'HIGH|MEDIUM|LOW',
      executiveSummary: {
        narrative: 'string',
        momentum: 'FORWARD|FORWARD_WITH_BLOCKERS|MIXED|FLAT|REGRESSING|INSUFFICIENT_BASELINE',
        topSignals: ['string'],
        topBlockers: ['string'],
        topRisks: ['string'],
        immediateLeadershipActions: ['string'],
      },
      managerSummaryBullets: [
        {
          title: '3-8 word headline',
          text: 'one concise manager-ready sentence',
          category:
            'shipped|achievement|collaboration|learning|recognition|learned|helped|milestone',
          contributorUserIds: ['exact member user id'],
          memberSignalRefs: itemShape.memberSignalRefs,
        },
      ], // max 5 bullets — only decision-relevant manager-level takeaways
    },
    priorSections: compactForPriorSections({
      whoIsDoingWhat: rankedWhoIsDoingWhat,
      needsUnblocking: rankedNeedsUnblocking,
      criticalAndMoving: rankedCriticalAndMoving,
      momentumAndDirection,
      decisionsAndAlignment,
      peopleLoadFocusAndGaps,
      upcomingAndAtRisk: rankedUpcomingAndAtRisk,
      directionalBet,
      capabilityMix,
      leadershipTouch,
      bottlenecks,
      leadershipLeverage,
      nextLeap,
      team10xGoal,
      recommendedActions: rankedRecommendedActions,
      dataGaps,
    }) as Record<string, unknown>,
  });
  const finalSummaryRecord = asRecord(finalSummaryRaw);
  const overallConfidence = enumValue(
    finalSummaryRecord.overallConfidence ??
      finalSummaryRecord.confidence ??
      finalSummaryRecord.value,
    TEAM_CONFIDENCE,
    'MEDIUM'
  );
  const executiveRecord = asRecord(finalSummaryRecord.executiveSummary ?? finalSummaryRecord);
  const generatedNarrative = cleanString(executiveRecord.narrative ?? executiveRecord.summary);
  const reusedNarrative = firstCleanString([
    generatedNarrative,
    momentumAndDirection.assessment,
    directionalBet.assessment,
    nextLeap.theLeap,
    nextLeap.whatNext,
    rankedCriticalAndMoving[0]?.progressDescription,
    rankedCriticalAndMoving[0]?.whyCritical,
    rankedNeedsUnblocking[0]?.description,
    rankedUpcomingAndAtRisk[0]?.description,
    rankedRecommendedActions[0]?.action,
  ]);
  if (!reusedNarrative) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM team final summary did not produce an overall summary for team=${input.teamName}`
    );
  }
  const topSignals = cleanStringArray(executiveRecord.topSignals);
  const topBlockers = cleanStringArray(executiveRecord.topBlockers);
  const topRisks = cleanStringArray(executiveRecord.topRisks);
  const immediateLeadershipActions = cleanStringArray(executiveRecord.immediateLeadershipActions);
  const executiveSummary: TeamIntelligenceTeamLeadershipSummary['executiveSummary'] = {
    narrative: limitWords(reusedNarrative, 250),
    momentum: enumValue(executiveRecord.momentum, TEAM_MOMENTUM, momentumAndDirection.momentum),
    topSignals:
      topSignals.length > 0
        ? allStrings(topSignals)
        : allStrings(
            rankedCriticalAndMoving.map((item) => `${item.title}: ${item.progressDescription}`)
          ),
    topBlockers:
      topBlockers.length > 0
        ? allStrings(topBlockers)
        : allStrings(rankedNeedsUnblocking.map((item) => `${item.title}: ${item.description}`)),
    topRisks:
      topRisks.length > 0
        ? allStrings(topRisks)
        : allStrings(rankedUpcomingAndAtRisk.map((item) => `${item.title}: ${item.description}`)),
    immediateLeadershipActions:
      immediateLeadershipActions.length > 0
        ? allStrings(immediateLeadershipActions)
        : allStrings(rankedRecommendedActions.map((item) => item.action)),
  };
  let managerSummaryBullets = simpleRecords(finalSummaryRecord, [
    'managerSummaryBullets',
    'bullets',
    'items',
  ])
    .map((fact, index) => {
      const refs = refsFromFact(fact, 'Evidence for manager bullet');
      const memberSignalRefs = refs.length > 0 ? refs : fallbackRefs.slice(0, 3);
      const contributorUserIds = userIdsFromFact(fact, userIds);
      const refContributorIds = memberSignalRefs
        .map((ref) => memberByIngestionId.get(ref.userIngestionId)?.user.id)
        .filter((userId): userId is string => Boolean(userId));
      const contributors = [...new Set([...contributorUserIds, ...refContributorIds])];
      if (memberSignalRefs.length === 0 || contributors.length === 0) return null;
      const text = limitWords(
        cleanString(fact.text ?? fact.summary ?? fact.description, executiveSummary.narrative),
        55
      );
      return {
        id: `bullet_${index + 1}`,
        title: cleanString(fact.title, text.split(/\s+/).slice(0, 6).join(' ')),
        text,
        category: bulletCategoryValue(fact.category, TEAM_BULLET_CATEGORIES, 'achievement'),
        contributorUserIds: contributors,
        memberSignalRefs,
      };
    })
    .filter(
      (item): item is TeamIntelligenceTeamLeadershipSummary['managerSummaryBullets'][number] =>
        item !== null
    );
  // Hard cap: a team brief must surface only the most important takeaways,
  // never one-per-member routine updates. Keep at most MAX_TEAM_SUMMARY_BULLETS.
  managerSummaryBullets = managerSummaryBullets.slice(0, MAX_TEAM_SUMMARY_BULLETS);

  const continuityState: TeamIntelligenceContinuityState = {
    window: { from: input.reportDate, to: input.reportDate, daysRepresented: 1 },
    workstreams: rankedWhoIsDoingWhat.map((item) => ({
      id: item.id,
      title: item.title,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      currentStatus: item.status,
      importance: item.importance,
      ownerUserIds: item.owners.map((owner) => owner.userId),
      latestProgress: item.progress,
      daysWithoutVisibleProgress: item.status === 'BLOCKED' ? 1 : 0,
    })),
    blockers: rankedNeedsUnblocking.map((item) => ({
      id: item.id,
      title: item.title,
      firstSeen: item.firstSeen ?? input.reportDate,
      lastSeen: input.reportDate,
      status: item.status,
      affectedWorkstreamIds: item.affectedWorkstreamIds,
    })),
    decisions: decisions.map((item) => ({
      id: item.id,
      decision: item.decision,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      status: 'CURRENT',
    })),
    directionalSignals: [
      ...directionalBet.technicalWaves,
      ...directionalBet.businessWaves,
      ...(directionalBet.statedBet ? [directionalBet.statedBet] : []),
      ...(directionalBet.inferredBet ? [directionalBet.inferredBet] : []),
    ].map((signal) => ({
      signal,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      strength: 'UNCLEAR',
    })),
    capabilitySignals: [
      ...capabilityMix.observedStrengths.map((item) => ({
        capability: item.title,
        signalType: 'STRENGTH' as const,
      })),
      ...capabilityMix.developingCapabilities.map((item) => ({
        capability: item.title,
        signalType: 'DEVELOPING' as const,
      })),
      ...capabilityMix.missingCapabilities.map((item) => ({
        capability: item.title,
        signalType: 'GAP' as const,
      })),
    ].map((item) => ({
      ...item,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
    })),
    loadSignals: [
      ...peopleLoadFocusAndGaps.overloadedMembers.map((item) => ({
        userId: item.userId,
        assessment: 'OVERLOADED' as const,
      })),
      ...peopleLoadFocusAndGaps.lightOrInsufficientlyVisibleMembers.map((item) => ({
        userId: item.userId,
        assessment: 'INSUFFICIENT_EVIDENCE' as const,
      })),
    ].map((item) => ({ ...item, daysObserved: 1 })),
    upcomingCommitments: rankedUpcomingAndAtRisk.map((item) => ({
      id: item.id,
      title: item.title,
      expectedDate: item.expectedDate,
      riskLevel: item.riskLevel,
    })),
  };

  return {
    whoIsDoingWhat: rankedWhoIsDoingWhat,
    needsUnblocking: rankedNeedsUnblocking,
    criticalAndMoving: rankedCriticalAndMoving,
    momentumAndDirection,
    decisionsAndAlignment,
    peopleLoadFocusAndGaps,
    upcomingAndAtRisk: rankedUpcomingAndAtRisk,
    directionalBet,
    capabilityMix,
    leadershipTouch,
    bottlenecks,
    leadershipLeverage,
    nextLeap,
    team10xGoal,
    recommendedActions: rankedRecommendedActions,
    dataGaps,
    continuityState,
    overallConfidence,
    executiveSummary,
    managerSummaryBullets,
  };
}

async function generateTeamSummarySections(
  llmClient: LLMClient,
  input: TeamIntelligenceTeamLeadershipInput
): Promise<TeamGeneratedSections> {
  return generateTeamSummarySectionsFromSimpleFacts(llmClient, input);
}

function collectIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectIds(item, ids));
    return ids;
  }
  if (!value || typeof value !== 'object') {
    return ids;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string' && record.id.trim()) {
    ids.add(record.id);
  }
  Object.values(record).forEach((item) => collectIds(item, ids));
  return ids;
}

function validateOutputReferences(
  summary: TeamIntelligenceTeamLeadershipSummary,
  input: TeamIntelligenceTeamLeadershipInput
): void {
  const memberByIngestionId = new Map(
    input.members.map((member) => [member.userIngestionId, member])
  );
  const memberUserIds = new Set(input.members.map((member) => member.user.id));
  const signalIdsByIngestion = new Map(
    input.members.map((member) => [member.userIngestionId, collectIds(member)])
  );
  const invalidReferences: string[] = [];
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
      typeof record.userIngestionId === 'string' &&
      typeof record.signalId === 'string' &&
      typeof record.reason === 'string'
    ) {
      if (
        !memberByIngestionId.has(record.userIngestionId) ||
        !signalIdsByIngestion.get(record.userIngestionId)?.has(record.signalId)
      ) {
        invalidReferences.push(`${record.userIngestionId}:${record.signalId}`);
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(summary);

  const referencedUserIds: string[] = [];
  const collectUserIds = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => collectUserIds(item, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (
        (childKey === 'userId' ||
          childKey === 'ownerUserIds' ||
          childKey === 'affectedUserIds' ||
          childKey === 'contributorUserIds') &&
        typeof childValue === 'string'
      ) {
        referencedUserIds.push(childValue);
      } else if (
        (childKey === 'ownerUserIds' ||
          childKey === 'affectedUserIds' ||
          childKey === 'contributorUserIds') &&
        Array.isArray(childValue)
      ) {
        referencedUserIds.push(
          ...childValue.filter((item): item is string => typeof item === 'string')
        );
      }
      collectUserIds(childValue, childKey);
    }
  };
  collectUserIds(summary);
  const unknownUserIds = [
    ...new Set(referencedUserIds.filter((userId) => !memberUserIds.has(userId))),
  ];

  if (invalidReferences.length > 0 || unknownUserIds.length > 0) {
    logger.warn('[TEAM-INTEL-TEAM-SUMMARY] Ignoring invalid generated team summary references', {
      teamId: input.teamId,
      teamName: input.teamName,
      invalidReferences: [...new Set(invalidReferences)],
      unknownUserIds,
    });
  }
}

function validateOutputIdentity(
  summary: TeamIntelligenceTeamLeadershipSummary,
  input: TeamIntelligenceTeamLeadershipInput
): void {
  if (
    summary.batchId !== input.batchId ||
    summary.reportDate !== input.reportDate ||
    summary.team.id !== input.teamId ||
    summary.team.name !== input.teamName
  ) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM team summary changed immutable batch, date, or team identity fields'
    );
  }
  if (
    summary.processingCoverage.expectedMembers !== input.processingCoverage.expectedMembers ||
    summary.processingCoverage.completedUserSummaries !==
      input.processingCoverage.completedUserSummaries ||
    summary.processingCoverage.failedUserSummaries !== input.processingCoverage.failedUserSummaries
  ) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM team summary changed immutable processing coverage'
    );
  }
  if (
    JSON.stringify(summary.processingCoverage.missingMembers) !==
    JSON.stringify(input.processingCoverage.missingMembers)
  ) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM team summary changed immutable missing-member coverage'
    );
  }
}

function buildCompatibilityProvenance(
  input: TeamIntelligenceTeamLeadershipInput,
  summary: TeamIntelligenceTeamLeadershipSummary
): TeamIntelligenceTeamSummaryProvenance {
  const userById = new Map(input.members.map((member) => [member.user.id, member]));
  const bullets: TeamIntelligenceTeamSummaryBullet[] = summary.managerSummaryBullets.map(
    (bullet) => {
      const invalidContributorUserIds: string[] = [];
      const contributors: TeamIntelligenceTeamSummaryBulletContributor[] =
        bullet.contributorUserIds.flatMap((userId) => {
          const member = userById.get(userId);
          if (!member) {
            invalidContributorUserIds.push(userId);
            return [];
          }
          return [
            {
              userId: member.user.id,
              userEmail: member.user.email,
              userName: member.user.name,
              role: member.user.role,
              contributionNote: bullet.text,
            },
          ];
        });
      if (invalidContributorUserIds.length > 0) {
        logger.warn(
          '[TEAM-INTEL-TEAM-SUMMARY] Ignored invalid compatibility contributor references',
          {
            batchId: input.batchId,
            teamSummaryId: input.teamSummaryId,
            teamId: input.teamId,
            teamName: input.teamName,
            bulletId: bullet.id,
            invalidContributorUserIds: [...new Set(invalidContributorUserIds)],
          }
        );
      }

      return {
        bulletId: bullet.id,
        reportDate: input.reportDate,
        bulletTitle: bullet.title,
        bulletText: bullet.text,
        bulletCat: bullet.category,
        prIdsUsed: [],
        repoNames: [],
        contributors,
        confidence:
          summary.overallConfidence === 'HIGH'
            ? 0.9
            : summary.overallConfidence === 'MEDIUM'
              ? 0.7
              : 0.5,
      };
    }
  );

  return {
    reportDate: input.reportDate,
    teamId: input.teamId,
    teamName: input.teamName,
    source: input.source,
    generatedAt: new Date().toISOString(),
    bullets,
    prIndex: {},
  };
}

class TeamIntelligenceTeamSummaryService {
  private getLlmClient(): LLMClient {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence team summaries'
      );
    }
    return llmClient;
  }

  async generate(
    input: TeamIntelligenceTeamLeadershipInput
  ): Promise<TeamIntelligenceTeamLeadershipOutput> {
    if (input.members.length === 0) {
      throw new TeamIntelligenceLLMUnavailableError(
        `No completed member summaries available for team=${input.teamName} on ${input.reportDate}`
      );
    }

    const llmClient = this.getLlmClient();
    const sections = await generateTeamSummarySections(llmClient, input);
    const parsed: unknown = {
      schemaVersion: '1.0',
      scope: 'TEAM_LEADERSHIP_SNAPSHOT',
      batchId: input.batchId,
      reportDate: input.reportDate,
      team: { id: input.teamId, name: input.teamName },
      managerSummaryBullets: sections.managerSummaryBullets,
      executiveSummary: sections.executiveSummary,
      operationalSnapshot: {
        whoIsDoingWhat: sections.whoIsDoingWhat,
        needsUnblocking: sections.needsUnblocking,
        criticalAndMoving: sections.criticalAndMoving,
        momentumAndDirection: sections.momentumAndDirection,
        decisionsAndAlignment: sections.decisionsAndAlignment,
        peopleLoadFocusAndGaps: sections.peopleLoadFocusAndGaps,
        upcomingAndAtRisk: sections.upcomingAndAtRisk,
      },
      leadershipSnapshot: {
        directionalBet: sections.directionalBet,
        capabilityMix: sections.capabilityMix,
        leadershipTouch: sections.leadershipTouch,
        bottlenecks: sections.bottlenecks,
        leadershipLeverage: sections.leadershipLeverage,
        nextLeap: sections.nextLeap,
      },
      team10xGoal: sections.team10xGoal,
      recommendedActions: sections.recommendedActions,
      processingCoverage: input.processingCoverage,
      dataGaps: sections.dataGaps,
      continuityState: sections.continuityState,
      overallConfidence: sections.overallConfidence,
    };

    let validation = TeamIntelligenceTeamLeadershipSummarySchema.safeParse(parsed);
    if (!validation.success) {
      const pruned = pruneInvalidArrayItemsForRetry(parsed, validation.error.issues);
      if (pruned.prunedCount > 0) {
        logger.warn(
          '[TEAM-INTEL-TEAM-SUMMARY] Pruned invalid team summary array items before validation retry',
          {
            teamId: input.teamId,
            teamName: input.teamName,
            prunedCount: pruned.prunedCount,
            prunedPaths: pruned.prunedPaths,
            error: validation.error.message,
          }
        );
        validation = TeamIntelligenceTeamLeadershipSummarySchema.safeParse(parsed);
      }
    }
    if (!validation.success) {
      throw new TeamIntelligenceLLMUnavailableError(
        `LLM team leadership response did not match the required schema: ${validation.error.message}`
      );
    }
    validateOutputIdentity(validation.data, input);
    validateOutputReferences(validation.data, input);

    const provenance = buildCompatibilityProvenance(input, validation.data);
    const summaryText = validation.data.managerSummaryBullets.map(
      (bullet) => `**[${input.teamName}]:** ${bullet.text}`
    );
    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-team-leadership-llm-v1',
      generatedAt: provenance.generatedAt,
      reportDate: input.reportDate,
      teamId: input.teamId,
      teamName: input.teamName,
      source: input.source,
      metrics: {
        expectedMembers: input.processingCoverage.expectedMembers,
        completedUserSummaries: input.processingCoverage.completedUserSummaries,
        failedUserSummaries: input.processingCoverage.failedUserSummaries,
        workstreamCount: validation.data.operationalSnapshot.whoIsDoingWhat.length,
        blockerCount: validation.data.operationalSnapshot.needsUnblocking.length,
        criticalItemCount: validation.data.operationalSnapshot.criticalAndMoving.length,
        recommendedActionCount: validation.data.recommendedActions.length,
        teamGoalAlignmentCount: validation.data.team10xGoal.length,
      },
      previousContinuityAvailable: input.previousContinuityState !== null,
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
          'directional-bet',
          'capability-mix',
          'leadership-touch',
          'bottlenecks',
          'leadership-leverage',
          'next-leap',
          'team-10x-goal-alignment',
          'recommended-actions',
          'data-gaps',
          'final-dependent-summary',
        ],
        codeBuiltSections: ['continuity-state'],
      },
    };
    const orgAggregationPayload: TeamIntelligenceOrgAggregationPayload = {
      teamSummaryId: input.teamSummaryId,
      reportDate: input.reportDate,
      team: {
        id: input.teamId,
        name: input.teamName,
        memberCount: input.processingCoverage.expectedMembers,
      },
      members: input.members.map((member) => ({
        userId: member.user.id,
        userEmail: member.user.email,
        userName: member.user.name,
        role: member.user.role,
      })),
      summary: validation.data.executiveSummary.narrative,
      managerSummaryBullets: validation.data.managerSummaryBullets,
      primaryWorkstreams: validation.data.operationalSnapshot.whoIsDoingWhat,
      blockers: validation.data.operationalSnapshot.needsUnblocking,
      criticalWork: validation.data.operationalSnapshot.criticalAndMoving,
      momentumAndDirection: validation.data.operationalSnapshot.momentumAndDirection,
      decisionsAndAlignment: validation.data.operationalSnapshot.decisionsAndAlignment,
      capacityAndLoad: validation.data.operationalSnapshot.peopleLoadFocusAndGaps,
      upcomingRisks: validation.data.operationalSnapshot.upcomingAndAtRisk,
      directionalBet: validation.data.leadershipSnapshot.directionalBet,
      capabilityMix: validation.data.leadershipSnapshot.capabilityMix,
      leadershipTouch: validation.data.leadershipSnapshot.leadershipTouch,
      bottlenecks: validation.data.leadershipSnapshot.bottlenecks,
      leadershipLeverage: validation.data.leadershipSnapshot.leadershipLeverage,
      nextLeap: validation.data.leadershipSnapshot.nextLeap,
      team10xGoal: validation.data.team10xGoal,
      leadershipAsks: validation.data.recommendedActions,
      dataGaps: validation.data.dataGaps,
      confidence: validation.data.overallConfidence,
    };

    return {
      reportDate: input.reportDate,
      teamId: input.teamId,
      teamName: input.teamName,
      source: input.source,
      summaryText,
      summaryMetadata:
        summaryMetadata as unknown as TeamIntelligenceTeamSummaryOutput['summaryMetadata'],
      provenance,
      teamSummary: validation.data,
      continuityState: validation.data.continuityState,
      orgAggregationPayload,
    };
  }
}

export const teamIntelligenceTeamSummaryService = new TeamIntelligenceTeamSummaryService();
