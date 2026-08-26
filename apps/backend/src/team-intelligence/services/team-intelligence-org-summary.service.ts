import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceOrgSummaryBullet,
  TeamIntelligenceOrgSummaryOutput,
  TeamIntelligenceOrgSummaryProvenance,
} from '../types';
import type { TeamIntelligenceOrgAggregationPayload } from '../team-leadership-summary.schema';
import {
  TeamIntelligenceOrgLeadershipSummarySchema,
  type TeamIntelligenceOrgContinuityState,
  type TeamIntelligenceOrgLeadershipSummary,
  type TeamIntelligenceOrgProcessingCoverage,
} from '../org-leadership-summary.schema';
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

export interface TeamIntelligenceOrgLeadershipInput {
  batchId: string;
  reportDate: string;
  source: string;
  organization: {
    id: string;
    name: string;
  };
  teams: TeamIntelligenceOrgAggregationPayload[];
  previousContinuityState: TeamIntelligenceOrgContinuityState | null;
  processingCoverage: TeamIntelligenceOrgProcessingCoverage;
}

export interface TeamIntelligenceOrgLeadershipOutput extends TeamIntelligenceOrgSummaryOutput {
  orgSummary: TeamIntelligenceOrgLeadershipSummary;
  continuityState: TeamIntelligenceOrgContinuityState;
}

interface LlmGenerateOptions {
  purpose: string;
}

interface OrgPromptSection {
  name: string;
  instructions: string[];
  outputShape: Record<string, unknown>;
  priorSections?: Record<string, unknown>;
  source?: OrgSectionSource;
}

interface OrgSectionSource {
  currentTeamSignals: Array<Record<string, unknown>>;
  previousContinuityState: Record<string, unknown> | null;
  sourceSelection: Record<string, unknown>;
}

type OrgOperationalSnapshot = TeamIntelligenceOrgLeadershipSummary['operationalSnapshot'];
type OrgFounderSnapshot = TeamIntelligenceOrgLeadershipSummary['founderSnapshot'];

interface OrgGeneratedSections {
  whoIsDoingWhat: OrgOperationalSnapshot['whoIsDoingWhat'];
  needsUnblocking: OrgOperationalSnapshot['needsUnblocking'];
  criticalAndMoving: OrgOperationalSnapshot['criticalAndMoving'];
  momentumAndDirection: OrgOperationalSnapshot['momentumAndDirection'];
  decisionsAndAlignment: OrgOperationalSnapshot['decisionsAndAlignment'];
  loadFocusAndGaps: OrgOperationalSnapshot['loadFocusAndGaps'];
  upcomingAndAtRisk: OrgOperationalSnapshot['upcomingAndAtRisk'];
  portfolioOfBets: OrgFounderSnapshot['portfolioOfBets'];
  organizationCapabilityMix: OrgFounderSnapshot['organizationCapabilityMix'];
  teamTouchPortfolio: OrgFounderSnapshot['teamTouchPortfolio'];
  cannotDeadlock: OrgFounderSnapshot['cannotDeadlock'];
  organizationBottlenecks: OrgFounderSnapshot['organizationBottlenecks'];
  decisionAgenda: OrgFounderSnapshot['decisionAgenda'];
  leadershipLeverage: OrgFounderSnapshot['leadershipLeverage'];
  organizationNextLeap: OrgFounderSnapshot['organizationNextLeap'];
  recommendedActions: TeamIntelligenceOrgLeadershipSummary['recommendedActions'];
  dataGaps: TeamIntelligenceOrgLeadershipSummary['dataGaps'];
  continuityState: TeamIntelligenceOrgLeadershipSummary['continuityState'];
  overallConfidence: TeamIntelligenceOrgLeadershipSummary['overallConfidence'];
  executiveSummary: TeamIntelligenceOrgLeadershipSummary['executiveSummary'];
  managerSummaryBullets: TeamIntelligenceOrgLeadershipSummary['managerSummaryBullets'];
}

async function llmGenerate(
  llmClient: LLMClient,
  prompt: string,
  options: LlmGenerateOptions
): Promise<string> {
  const startedAt = Date.now();
  logger.info('[TEAM-INTEL-ORG-SUMMARY] LLM call started', {
    purpose: options.purpose,
    promptChars: prompt.length,
  });
  try {
    return await withTeamIntelligenceLlmSlot(
      { scope: 'org', purpose: options.purpose, promptChars: prompt.length },
      async () => {
        const response = await llmClient.generateStream({
          model: appConfig.teamIntelligence.model,
          messages: [createUserMessage(prompt)],
        });
        const finalMessagePromise = response.finalMessage.catch((error) => {
          logger.warn('[TEAM-INTEL-ORG-SUMMARY] Streaming final message accumulation failed', {
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
          logger.warn('[TEAM-INTEL-ORG-SUMMARY] Using streamed content after stream error', {
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
        logger.info('[TEAM-INTEL-ORG-SUMMARY] LLM call completed', {
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
      '[TEAM-INTEL-ORG-SUMMARY] LLM call failed; section fallback will decide whether to retry, use text, or blank the section',
      {
        purpose: options.purpose,
        durationMs: Date.now() - startedAt,
        promptChars: prompt.length,
        error,
      }
    );
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM organization summary generation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
}

function buildSectionPrompt(
  input: TeamIntelligenceOrgLeadershipInput,
  section: OrgPromptSection
): string {
  const sectionSource = section.source ?? buildOrgSectionSource(input, ['summary']);
  const immutableIdentity = {
    schemaVersion: '1.0',
    scope: 'ORG_LEADERSHIP_SNAPSHOT',
    batchId: input.batchId,
    reportDate: input.reportDate,
    organization: {
      id: input.organization.id,
      name: input.organization.name,
      teamCount: input.processingCoverage.expectedTeams,
      memberCount: input.teams.reduce((sum, team) => sum + team.team.memberCount, 0),
    },
    processingCoverage: input.processingCoverage,
  };

  return [
    'You are producing one focused section of an evidence-backed founder and leadership snapshot for one organization.',
    'This is a stateless request scoped only to INPUT.batchId and INPUT.organization.',
    'Do not use memory, prior chat/session context, or data from another organization or batch.',
    'The input contains only compact, already-summarized team signals for today plus one compact previous organization continuity state.',
    'Do not request, reconstruct, or fabricate raw user, pull request, ticket, channel, message, call, transcript, or canvas data.',
    'Organization and team identity in INPUT are authoritative.',
    '',
    'Evidence and judgment rules:',
    '- Use only teamDirectory, currentTeamSignals, and previousContinuityState supplied in INPUT.',
    '- currentTeamSignals is intentionally filtered to this section. Teams with no relevant signals for this section may be omitted.',
    '- Prefer simple qualitative content: title/text/description/priority/status. teamSignalRefs are optional; when provided, they must use exact teamSummaryId + signalId pairs from currentTeamSignals.',
    '- A provided teamSignalRef.signalId must be an exact id found inside that team payload.',
    '- Every team ID and name must exactly match supplied teamDirectory/currentTeamSignals.',
    '- Deduplicate workstreams, blockers, decisions, dependencies, capabilities, and bets reported by multiple teams.',
    '- Separate explicit stated bets from inferred direction. Never present an inferred pattern as declared strategy.',
    '- Do not equate activity volume with impact, capability, or progress.',
    '- Do not call a team or person weak, idle, a gatekeeper, or a poor performer.',
    '- Describe observable system conditions: concentrated ownership, missing capability coverage, fragmented priorities, unclear delegation, or insufficient evidence.',
    '- Use previousContinuityState only for change over time. If it is null, use INSUFFICIENT_BASELINE where comparison is not supported.',
    '- All arrays must be empty when unsupported. Never create placeholder items.',
    '- This is a founder and organization rollup, not a per-team exhaustive report. Do not create one item for every team or every team signal.',
    '- Include only founder-significant facts: CRITICAL/HIGH priority, BLOCKED/OPEN/STALLED/REGRESSING items, progressing work that materially advances an organization bet, cross-team dependencies, unresolved decisions, cannot-deadlock risks, or leadership-actionable capability/load gaps.',
    '- Put team and person context directly inside the human-readable title/text/description/action/why fields. Do not rely on affectedTeamIds, contributorTeamIds, teams, or refs to explain who did the work or who is blocked.',
    '- Write naturally, for example: "Mettle/Pragati team is blocked on leadership taxonomy confirmation" or "Ananya Rao in Xyne shipped approval-card rendering". Do not use bracketed labels as the only team context.',
    '- When a supplied team payload includes member names, include the relevant individual name for ownership, achievement, blocker, or decision context. If no individual is clear, name the team.',
    '- Omit routine completed work, low-impact activity, duplicated team-level detail, and medium/low items unless they are required to explain a blocker, critical movement, ownership gap, dependency, or founder action.',
    '- Never describe work using PR numbers, commit hashes, ticket IDs, file counts, or line addition/deletion tallies. These are artifact identifiers, not insights.',
    '- Write about what was built, decided, or resolved and why it matters. Avoid phrases like "Merged PR #N", "N additions across M files", or "commit X". Instead describe the outcome: what capability was shipped, what problem was solved, what decision was made.',
    '- Apply a mandatory importance gate: include an insight only when omitting it could cause founders or leadership to miss a material organization outcome, strategic movement, significant change, blocker, risk, unresolved decision, cross-team dependency, ownership/capability/load concern, or concrete leadership action.',
    '- Optimize for decision value, not coverage. More teams or more source data must not produce more output by itself.',
    '- Rank candidates by organization-wide impact, urgency, evidence strength, and actionability; merge overlapping team signals into one organization-level insight.',
    '- Completed work is important only when it creates a material organization outcome, advances a strategic bet, changes risk, unlocks other teams, or warrants founder recognition; ordinary delivery activity is not automatically founder-significant.',
    '- Treat missing data as one consolidated insight only when it materially changes confidence or requires corrective action. Never generate multiple bullets from the same visibility gap.',
    '- Unless this section explicitly requires fewer, return at most 3 top-level insight items per array. This cap does not apply to teamSignalRefs, contributor IDs, affected-team IDs, or other reference arrays inside a selected insight.',
    '- Empty or short output is correct when nothing crosses the importance threshold. Never fill space or represent every team for completeness.',
    '- Order every array by leadership urgency: CRITICAL/HIGH first, then BLOCKED/OPEN/STALLED/REGRESSING, then MEDIUM. LOW should usually be omitted.',
    '- Keep executive narrative under 150 words, lead with the most important organization conclusion, and keep each bullet/detail sentence concise.',
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
          'Already generated section context for this same organization only. Use these stable IDs when this section needs to reference prior generated items:',
          JSON.stringify(section.priorSections),
        ]
      : []),
    '',
    'INPUT:',
    JSON.stringify({
      schemaVersion: '1.0',
      scope: 'ORG_LEADERSHIP_SNAPSHOT_INPUT',
      batchId: input.batchId,
      reportDate: input.reportDate,
      organization: immutableIdentity.organization,
      teamDirectory: buildOrgTeamDirectory(input.teams),
      processingCoverage: input.processingCoverage,
      currentTeamSignals: sectionSource.currentTeamSignals,
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

type OrgTeamSignalField = keyof TeamIntelligenceOrgAggregationPayload;
type OrgContinuityField = keyof TeamIntelligenceOrgContinuityState;

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

function buildOrgTeamDirectory(teams: TeamIntelligenceOrgAggregationPayload[]) {
  return teams.map((team) => ({
    teamSummaryId: team.teamSummaryId,
    teamId: team.team.id,
    teamName: team.team.name,
    memberCount: team.team.memberCount,
    members: team.members.map((member) => ({
      userId: member.userId,
      userEmail: member.userEmail,
      userName: member.userName,
      role: member.role,
    })),
    confidence: team.confidence,
  }));
}

function buildOrgContinuitySubset(
  state: TeamIntelligenceOrgContinuityState | null,
  fields: OrgContinuityField[]
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

function buildOrgSectionSource(
  input: TeamIntelligenceOrgLeadershipInput,
  signalFields: OrgTeamSignalField[],
  continuityFields: OrgContinuityField[] = []
): OrgSectionSource {
  const currentTeamSignals = input.teams
    .map((team) => {
      const signal: Record<string, unknown> = {
        teamSummaryId: team.teamSummaryId,
        reportDate: team.reportDate,
        team: team.team,
      };
      let hasSelectedSignal = false;
      for (const field of signalFields) {
        const value = team[field];
        if (hasPromptSignal(value)) {
          signal[field] = value;
          hasSelectedSignal = true;
        }
      }
      return hasSelectedSignal ? signal : null;
    })
    .filter((signal): signal is Record<string, unknown> => signal !== null);

  return {
    currentTeamSignals,
    previousContinuityState: buildOrgContinuitySubset(
      input.previousContinuityState,
      continuityFields
    ),
    sourceSelection: {
      includedTeamSignalFields: signalFields,
      includedPreviousContinuityFields: continuityFields,
      includedTeamSignals: currentTeamSignals.length,
      omittedTeamsWithoutRelevantSignals: input.teams.length - currentTeamSignals.length,
    },
  };
}

type OrgTeamSignalRef = OrgOperationalSnapshot['whoIsDoingWhat'][number]['teamSignalRefs'][number];
type OrgWorkstream = OrgOperationalSnapshot['whoIsDoingWhat'][number];
type OrgBlocker = OrgOperationalSnapshot['needsUnblocking'][number];
type OrgDecision = OrgOperationalSnapshot['decisionsAndAlignment']['decisions'][number];
type OrgPortfolioItem = OrgOperationalSnapshot['loadFocusAndGaps']['overloadedTeams'][number];
type OrgLeadershipItem = OrgFounderSnapshot['leadershipLeverage']['budgetsAndApprovals'][number];
type OrgRisk = OrgOperationalSnapshot['upcomingAndAtRisk'][number];
type OrgBet = OrgFounderSnapshot['portfolioOfBets'][number];
type OrgTouchTeam = OrgFounderSnapshot['teamTouchPortfolio']['highTouch'][number];

function buildOrgSectionFallbackRefs(
  source: OrgSectionSource | undefined,
  validSignalIdsBySummary: Map<string, Set<string>>
): OrgTeamSignalRef[] {
  if (!source) return [];
  return dedupeTeamSignalRefs(
    source.currentTeamSignals.flatMap((signal) => {
      const teamSummaryId = cleanString(signal.teamSummaryId);
      const validSignalIds = validSignalIdsBySummary.get(teamSummaryId) ?? new Set<string>();
      return Array.from(collectIds(signal))
        .filter((signalId) => validSignalIds.has(signalId))
        .slice(0, 3)
        .map((signalId) => ({
          teamSummaryId,
          signalId,
          reason: 'Source evidence from section-filtered team summary',
        }));
    })
  );
}

const ORG_PRIORITY = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const ORG_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const;
const ORG_WORK_STATUS = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'UNKNOWN'] as const;
const ORG_MOVEMENT = [
  'PROGRESSING',
  'PROGRESSING_WITH_RISK',
  'STALLED',
  'REGRESSING',
  'UNCLEAR',
] as const;
const ORG_BLOCKER_STATUS = ['OPEN', 'RESOLVED', 'UNCLEAR'] as const;
const ORG_MOMENTUM = [
  'FORWARD',
  'FORWARD_WITH_BLOCKERS',
  'MIXED',
  'FLAT',
  'REGRESSING',
  'INSUFFICIENT_BASELINE',
] as const;
const ORG_DIRECTION = [
  'TOWARD_STATED_GOALS',
  'COHERENT_INFERRED_DIRECTION',
  'MIXED_OR_UNCLEAR',
  'AWAY_FROM_STATED_GOALS',
  'INSUFFICIENT_EVIDENCE',
] as const;
const ORG_ALIGNMENT = [
  'ALIGNED',
  'PARTIALLY_ALIGNED',
  'MISALIGNED',
  'INSUFFICIENT_EVIDENCE',
] as const;
const ORG_REVERSIBILITY = ['REVERSIBLE', 'IRREVERSIBLE', 'UNCLEAR'] as const;
const ORG_DECISION_STATUS = ['DECIDED', 'PENDING', 'CONFLICTING', 'SUPERSEDED', 'UNCLEAR'] as const;
const ORG_BET_STAGE = [
  'ZERO_TO_ONE',
  'ONE_TO_TEN',
  'TEN_TO_HUNDRED',
  'HUNDRED_TO_THOUSAND',
  'UNKNOWN',
] as const;
const ORG_BET_MOMENTUM = [
  'GROWING',
  'STABLE',
  'WEAKENING',
  'STALLED',
  'INSUFFICIENT_BASELINE',
] as const;
const ORG_EVIDENCE_LEVEL = ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_EVIDENCE'] as const;
const ORG_DEP_STATUS = ['OPEN', 'BLOCKED', 'AT_RISK', 'RESOLVED', 'UNCLEAR'] as const;
const ORG_TIME_HORIZON = ['IMMEDIATE', 'THIS_WEEK', 'NEXT_TWO_WEEKS', 'LONGER_TERM'] as const;
const ORG_BULLET_CATEGORIES = [
  'shipped',
  'achievement',
  'collaboration',
  'learning',
  'recognition',
  'learned',
  'helped',
  'milestone',
] as const;
/** Maximum founder-brief bullets kept after generation. Prevents a per-team
 * firehose — only the most important org-wide takeaways should survive. */
const MAX_ORG_SUMMARY_BULLETS = 8;
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
 * form stored in the schema. Unlike `enumValue` (which uppercases the input
 * and is intended for UPPER_SNAKE enums), bullet categories are lowercase, so
 * a plain `enumValue` call never matches and silently falls back — making
 * every bullet read "achievement". This normalizes both sides to lowercase.
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
  if (['RESOLVED', 'COMPLETED', 'DECIDED', 'SUPERSEDED'].includes(normalized)) return 4;
  return 5;
}

function movementRank(value: unknown): number {
  const normalized = cleanString(value).toUpperCase();
  if (['STALLED', 'REGRESSING', 'WEAKENING'].includes(normalized)) return 0;
  if (normalized === 'PROGRESSING_WITH_RISK') return 1;
  if (['PROGRESSING', 'GROWING'].includes(normalized)) return 2;
  if (normalized === 'STABLE') return 3;
  if (['UNCLEAR', 'INSUFFICIENT_BASELINE'].includes(normalized)) return 4;
  return 5;
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
  deadlockRisk?: unknown;
  status?: unknown;
  movement?: unknown;
  currentMovement?: unknown;
  momentum?: unknown;
  timeHorizon?: unknown;
  needsLeadershipInput?: unknown;
}): number {
  return (
    priorityRank(
      item.priority ?? item.severity ?? item.riskLevel ?? item.importance ?? item.deadlockRisk
    ) *
      1000 +
    statusRank(item.status) * 100 +
    movementRank(item.movement ?? item.currentMovement ?? item.momentum) * 10 +
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
    deadlockRisk?: unknown;
    status?: unknown;
    movement?: unknown;
    currentMovement?: unknown;
    momentum?: unknown;
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

function teamRefsFromFact(
  fact: Record<string, unknown>,
  validSignalIdsBySummary: Map<string, Set<string>>,
  fallbackReason: string
): OrgTeamSignalRef[] {
  return [...asArray(fact.teamSignalRefs), ...asArray(fact.signalRefs)]
    .map(asRecord)
    .map((ref) => {
      const teamSummaryId = cleanString(ref.teamSummaryId);
      const signalId = cleanString(ref.signalId);
      if (
        !teamSummaryId ||
        !signalId ||
        !validSignalIdsBySummary.get(teamSummaryId)?.has(signalId)
      ) {
        return null;
      }
      return {
        teamSummaryId,
        signalId,
        reason: cleanString(ref.reason, cleanString(fact.reason, fallbackReason)),
      };
    })
    .filter((ref): ref is OrgTeamSignalRef => ref !== null);
}

function dedupeTeamSignalRefs(refs: OrgTeamSignalRef[]): OrgTeamSignalRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.teamSummaryId}:${ref.signalId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function teamIdsFromFact(fact: Record<string, unknown>, validTeamIds: Set<string>): string[] {
  return cleanStringArray(fact.teamIds ?? fact.affectedTeamIds ?? fact.contributorTeamIds).filter(
    (teamId) => validTeamIds.has(teamId)
  );
}

function initiativeIdsFromFact(
  fact: Record<string, unknown>,
  initiatives: OrgWorkstream[]
): string[] {
  const ids = new Set(initiatives.map((item) => item.id));
  const direct = cleanStringArray(fact.initiativeIds ?? fact.affectedInitiativeIds).filter((id) =>
    ids.has(id)
  );
  if (direct.length > 0) {
    return direct;
  }
  const titles = new Set(
    cleanStringArray(fact.initiativeTitles ?? fact.workstreamTitles).map((title) =>
      title.toLowerCase()
    )
  );
  return initiatives.filter((item) => titles.has(item.title.toLowerCase())).map((item) => item.id);
}

function buildOrgItems(
  facts: Record<string, unknown>[],
  prefix: string,
  validTeamIds: Set<string>,
  validSignalIdsBySummary: Map<string, Set<string>>,
  fallbackRefs: OrgTeamSignalRef[] = []
): OrgLeadershipItem[] {
  return facts.map((fact, index) => {
    const title = cleanString(fact.title, `${prefix} ${index + 1}`);
    const refs = teamRefsFromFact(fact, validSignalIdsBySummary, `Evidence for ${title}`);
    return {
      id: `${prefix}_${index + 1}`,
      title,
      description: cleanString(fact.description ?? fact.detail, title),
      implication: cleanString(fact.implication, 'Leadership implication should be clarified.'),
      recommendedAction: cleanString(
        fact.recommendedAction ?? fact.action,
        'Clarify the next leadership action.'
      ),
      priority: enumValue(fact.priority ?? fact.severity, ORG_PRIORITY, 'MEDIUM'),
      affectedTeamIds: teamIdsFromFact(fact, validTeamIds),
      teamSignalRefs:
        refs.length > 0
          ? refs
          : fallbackRefs.slice(0, 3).map((ref) => ({ ...ref, reason: `Evidence for ${title}` })),
    };
  });
}

async function generateOrgSummarySectionsFromSimpleFacts(
  llmClient: LLMClient,
  input: TeamIntelligenceOrgLeadershipInput
): Promise<OrgGeneratedSections> {
  const validSignalIdsBySummary = new Map(
    input.teams.map((team) => [team.teamSummaryId, collectIds(team)])
  );
  const teamById = new Map(input.teams.map((team) => [team.team.id, team]));
  const teamBySummaryId = new Map(input.teams.map((team) => [team.teamSummaryId, team]));
  const validTeamIds = new Set(input.teams.map((team) => team.team.id));
  const sourceFallbackRefs = dedupeTeamSignalRefs(
    input.teams.flatMap((team) => {
      const validSignalIds = validSignalIdsBySummary.get(team.teamSummaryId) ?? new Set<string>();
      return Array.from(validSignalIds)
        .slice(0, 3)
        .map((signalId) => ({
          teamSummaryId: team.teamSummaryId,
          signalId,
          reason: 'Source evidence from completed team summary',
        }));
    })
  );
  const sectionFallbackRefs = new Map<string, OrgTeamSignalRef[]>();
  const fallbackRefsFor = (sectionName: string): OrgTeamSignalRef[] =>
    sectionFallbackRefs.get(sectionName) ?? [];
  const refsFromFact = (
    fact: Record<string, unknown>,
    fallbackReason: string,
    sectionName?: string
  ): OrgTeamSignalRef[] => {
    const refs = teamRefsFromFact(fact, validSignalIdsBySummary, fallbackReason);
    if (refs.length > 0) {
      return refs;
    }
    const fallbackRefs = sectionName ? fallbackRefsFor(sectionName) : sourceFallbackRefs;
    return fallbackRefs.slice(0, 3).map((ref) => ({
      ...ref,
      reason: fallbackReason,
    }));
  };
  const runSection = async <T>(section: OrgPromptSection): Promise<T> => {
    const startedAt = Date.now();
    const logContext = {
      batchId: input.batchId,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      section: section.name,
      sourceTeams: section.source?.currentTeamSignals.length ?? input.teams.length,
    };
    logger.info('[TEAM-INTEL-ORG-SUMMARY] Org section started', logContext);
    try {
      const result = await runSectionWithFallback<T>({
        llmCall: (prompt, purpose) => llmGenerate(llmClient, prompt, { purpose }),
        jsonPrompt: buildSectionPrompt(input, section),
        outputShape: section.outputShape,
        purpose: `org-section-${section.name}`,
        label: `LLM org ${section.name} section response`,
        logTag: '[TEAM-INTEL-ORG-SUMMARY]',
      });
      logger.info('[TEAM-INTEL-ORG-SUMMARY] Org section completed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      logger.error('[TEAM-INTEL-ORG-SUMMARY] Org section failed', {
        ...logContext,
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  };
  const runSectionWave = async (
    waveName: string,
    sections: Record<string, OrgPromptSection>
  ): Promise<Record<string, Record<string, unknown>>> => {
    const startedAt = Date.now();
    const sectionNames = Object.values(sections).map((section) => section.name);
    const concurrency = getTeamIntelligenceSectionConcurrency('org', sectionNames.length);
    logger.info('[TEAM-INTEL-ORG-SUMMARY] Org section wave started', {
      batchId: input.batchId,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
    });
    for (const section of Object.values(sections)) {
      sectionFallbackRefs.set(
        section.name,
        buildOrgSectionFallbackRefs(section.source, validSignalIdsBySummary)
      );
    }
    const entries = await mapWithConcurrency(
      Object.entries(sections),
      concurrency,
      async ([key, section]) => [key, await runSection<Record<string, unknown>>(section)] as const
    );
    logger.info('[TEAM-INTEL-ORG-SUMMARY] Org section wave completed', {
      batchId: input.batchId,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      waveName,
      sections: sectionNames,
      sectionCount: sectionNames.length,
      concurrency,
      durationMs: Date.now() - startedAt,
    });
    return Object.fromEntries(entries);
  };
  const refShape = [
    {
      teamSummaryId: 'exact teamSummaryId',
      signalId: 'exact signal id from that team payload',
      reason: 'string',
    },
  ];
  const itemShape = {
    title: 'string with team/person context included',
    description: 'rich qualitative detail with team/person context included in the sentence',
    priority: 'CRITICAL|HIGH|MEDIUM|LOW',
    affectedTeamIds: ['exact team id'],
    teamSignalRefs: refShape,
  };
  const decisionFactShape = {
    decision: 'string',
    context: 'string',
    impact: 'string',
    affectedTeamIds: ['exact team id'],
    reversibility: 'REVERSIBLE|IRREVERSIBLE|UNCLEAR',
    status: 'DECIDED|PENDING|CONFLICTING|SUPERSEDED|UNCLEAR',
    needsLeadershipInput: false,
    teamSignalRefs: refShape,
  };
  const teamIdentities = (teamIds: string[]) =>
    teamIds
      .map((teamId) => teamById.get(teamId))
      .filter((team): team is TeamIntelligenceOrgAggregationPayload => Boolean(team))
      .map((team) => ({ teamId: team.team.id, teamName: team.team.name }));
  const teamIdsFromRefs = (refs: OrgTeamSignalRef[]) => [
    ...new Set(
      refs
        .map((ref) => teamBySummaryId.get(ref.teamSummaryId)?.team.id)
        .filter((teamId): teamId is string => Boolean(teamId))
    ),
  ];
  const formatNames = (names: string[]): string => {
    const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    if (unique.length <= 1) return unique[0] ?? '';
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
  };
  const formatLabel = (value: unknown): string =>
    cleanString(value).toLowerCase().replace(/_/g, ' ');
  const lowercaseFirst = (value: string): string =>
    value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
  const textMentionsAny = (text: string, names: string[]): boolean => {
    const normalized = text.toLowerCase();
    return names.some((name) => normalized.includes(name.toLowerCase()));
  };
  const teamNamesFromIds = (teamIds: string[]): string[] =>
    teamIds
      .map((teamId) => teamById.get(teamId)?.team.name)
      .filter((name): name is string => Boolean(name));
  const contextualizeWithTeams = (value: string, teamIds: string[], maxWords: number): string => {
    const text = cleanString(value);
    const teamNames = teamNamesFromIds(teamIds);
    if (!text || teamNames.length === 0 || textMentionsAny(text, teamNames)) {
      return limitWords(text, maxWords);
    }
    const teamLabel =
      teamNames.length === 1
        ? `${teamNames[0]} team`
        : `${formatNames(teamNames.map((name) => `${name} team`))}`;
    return limitWords(`For ${teamLabel}, ${lowercaseFirst(text)}`, maxWords);
  };
  const teamContextForIds = (teamIds: string[]): string => {
    const teamNames = teamNamesFromIds(teamIds);
    if (teamNames.length === 0) return 'The organization';
    return teamNames.length === 1
      ? `${teamNames[0]} team`
      : `${formatNames(teamNames.map((name) => `${name} team`))}`;
  };

  const extractionRaw = await runSectionWave('source-extraction', {
    who: {
      name: 'who-is-doing-what',
      source: buildOrgSectionSource(
        input,
        ['primaryWorkstreams', 'criticalWork', 'managerSummaryBullets'],
        ['criticalInitiatives']
      ),
      instructions: [
        '- Return an items array with every organization initiative/workstream fact that meets the founder-significance rules; do not create final schema IDs.',
        '- Include only initiatives that are critical/high priority, blocked, moving with risk, or strategically meaningful for a founder. Do not enumerate every team task.',
        '- Prefer simple title, description/text, priority/importance, status, movement, and affected team IDs when supported. teamSignalRefs are optional.',
        '- Deduplicate the same initiative reported by multiple teams.',
      ],
      outputShape: {
        items: [
          {
            ...itemShape,
            status: 'PLANNED|IN_PROGRESS|BLOCKED|COMPLETED|UNKNOWN',
            movement: 'PROGRESSING|PROGRESSING_WITH_RISK|STALLED|REGRESSING|UNCLEAR',
          },
        ],
      },
    },
    needs: {
      name: 'needs-unblocking',
      source: buildOrgSectionSource(
        input,
        ['blockers', 'leadershipAsks', 'bottlenecks'],
        ['organizationBlockers', 'crossTeamDependencies']
      ),
      instructions: [
        '- Return an items array with every organization blocker that needs founder/leadership attention; do not create final schema IDs.',
        '- Include only blockers needing founder/leadership attention, cross-team decisioning, dependency clearing, ownership, staffing, or escalation.',
        '- Include qualitative blocker detail, affected teams/initiatives, and needed action. Do not invent firstSeen/daysOpen; the system will set report-date continuity fields.',
      ],
      outputShape: {
        items: [
          {
            ...itemShape,
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            status: 'OPEN|RESOLVED|UNCLEAR',
            initiativeTitles: ['string'],
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
      source: buildOrgSectionSource(
        input,
        ['criticalWork', 'blockers', 'managerSummaryBullets'],
        ['criticalInitiatives', 'organizationBlockers']
      ),
      instructions: [
        '- Return an items array with every critical organization initiative; do not create final schema IDs.',
        '- Include only critical/high-value movement, blocked critical work, or progressing-with-risk work. Do not include routine progress.',
        '- Include qualitative criticality, movement, and affected teams. teamSignalRefs are optional.',
      ],
      outputShape: {
        items: [
          {
            ...itemShape,
            status: 'PLANNED|IN_PROGRESS|BLOCKED|COMPLETED|UNKNOWN',
            movement: 'PROGRESSING|PROGRESSING_WITH_RISK|STALLED|REGRESSING|UNCLEAR',
          },
        ],
      },
    },
    momentum: {
      name: 'momentum-and-direction',
      source: buildOrgSectionSource(
        input,
        ['momentumAndDirection', 'primaryWorkstreams', 'criticalWork'],
        ['strategicBets', 'criticalInitiatives']
      ),
      instructions: [
        '- Return one qualitative organization momentum assessment with simple initiative title arrays.',
        '- Distinguish meaningful progress from activity volume.',
        '- Include only the most decision-relevant initiative titles, ranked by organization impact; omit routine or redundant titles.',
      ],
      outputShape: {
        momentum: 'FORWARD|FORWARD_WITH_BLOCKERS|MIXED|FLAT|REGRESSING|INSUFFICIENT_BASELINE',
        direction:
          'TOWARD_STATED_GOALS|COHERENT_INFERRED_DIRECTION|MIXED_OR_UNCLEAR|AWAY_FROM_STATED_GOALS|INSUFFICIENT_EVIDENCE',
        assessment: 'string',
        progressingInitiativeTitles: ['string'],
        stalledInitiativeTitles: ['string'],
        busyButNotClearlyDirectional: ['string'],
        teamSignalRefs: refShape,
      },
    },
    decisions: {
      name: 'decisions-and-alignment',
      source: buildOrgSectionSource(
        input,
        ['decisionsAndAlignment', 'leadershipLeverage', 'leadershipAsks'],
        ['crossTeamDependencies']
      ),
      instructions: [
        '- Return qualitative alignment status plus simple decision facts; do not create final schema IDs.',
        '- Include only the highest-impact decisions, prioritizing unresolved, irreversible, conflicting, or founder-input decisions.',
        '- Include only open questions whose resolution can materially change direction, risk, ownership, or execution.',
      ],
      outputShape: {
        alignmentStatus: 'ALIGNED|PARTIALLY_ALIGNED|MISALIGNED|INSUFFICIENT_EVIDENCE',
        decisions: [decisionFactShape],
        conflictingDecisions: [
          {
            ...decisionFactShape,
            status: 'CONFLICTING',
            needsLeadershipInput: true,
          },
        ],
        openQuestions: ['string'],
      },
    },
    load: {
      name: 'load-focus-and-gaps',
      source: buildOrgSectionSource(
        input,
        ['capacityAndLoad', 'capabilityMix', 'leadershipTouch'],
        ['capacityRisks', 'capabilityGaps']
      ),
      instructions: [
        '- Return qualitative arrays for overloadedTeams, teamsNeedingSupport, capabilityGaps, ownershipConcentrationRisks, and resourceImbalances.',
        '- Describe observable system conditions, not team/person judgment.',
        '- Include only the most consequential founder-actionable load, support, capability, ownership, or resource concerns. Omit unsupported, routine, or lower-impact observations.',
      ],
      outputShape: {
        overloadedTeams: [
          {
            teamId: 'exact team id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            teamSignalRefs: refShape,
          },
        ],
        teamsNeedingSupport: [
          {
            teamId: 'exact team id',
            assessment: 'string',
            severity: 'CRITICAL|HIGH|MEDIUM|LOW',
            teamSignalRefs: refShape,
          },
        ],
        capabilityGaps: [itemShape],
        ownershipConcentrationRisks: [itemShape],
        resourceImbalances: [itemShape],
      },
    },
    upcoming: {
      name: 'upcoming-and-at-risk',
      source: buildOrgSectionSource(
        input,
        ['upcomingRisks', 'leadershipAsks', 'blockers'],
        ['organizationBlockers', 'crossTeamDependencies']
      ),
      instructions: [
        '- Return an items array with every upcoming organization commitment or risk that a founder should actively track.',
        '- Include only at-risk commitments, critical deadlines, unowned dependencies, or risks a founder should actively track.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            description: 'rich qualitative detail',
            expectedDate: 'ISO-8601 string or null',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            affectedTeamIds: ['exact team id'],
            dependencies: ['string'],
            requiredNextSteps: ['string'],
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    bets: {
      name: 'portfolio-of-bets',
      source: buildOrgSectionSource(
        input,
        ['directionalBet', 'criticalWork', 'primaryWorkstreams'],
        ['strategicBets', 'criticalInitiatives']
      ),
      instructions: [
        '- Return an items array with every qualitative organization bet supported by the evidence.',
        '- Include only explicit or clearly evidenced bets with critical/high risk, strategic movement, or founder relevance.',
        '- Separate explicit bets from inferred portfolio direction; never present inferred patterns as declared strategy.',
      ],
      outputShape: {
        items: [
          {
            title: 'string',
            description: 'string',
            teamIds: ['exact team id'],
            technicalWaves: ['string'],
            businessWaves: ['string'],
            stage: 'ZERO_TO_ONE|ONE_TO_TEN|TEN_TO_HUNDRED|HUNDRED_TO_THOUSAND|UNKNOWN',
            momentum: 'GROWING|STABLE|WEAKENING|STALLED|INSUFFICIENT_BASELINE',
            differentiation: 'HIGH|MEDIUM|LOW|INSUFFICIENT_EVIDENCE',
            organizationAlignment: 'ALIGNED|PARTIALLY_ALIGNED|MISALIGNED|INSUFFICIENT_EVIDENCE',
            riskLevel: 'CRITICAL|HIGH|MEDIUM|LOW',
            assessment: 'string',
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    capability: {
      name: 'organization-capability-mix',
      source: buildOrgSectionSource(
        input,
        ['capabilityMix', 'capacityAndLoad', 'leadershipLeverage'],
        ['capabilityGaps', 'capacityRisks']
      ),
      instructions: [
        '- Return qualitative capability mix arrays; these are capability coverage/gap observations, not team ratings.',
        '- Include only the most material capability signals. Prioritize missing capabilities, concentration risks, and strengths relevant to critical bets.',
      ],
      outputShape: {
        strongCapabilities: [itemShape],
        developingCapabilities: [itemShape],
        missingCapabilities: [itemShape],
        capabilitiesConcentratedInOneTeam: [itemShape],
        capabilitiesConcentratedInOnePerson: [itemShape],
        capabilityMovementOpportunities: [itemShape],
        hiringOrUpskillingNeeds: [itemShape],
        assessment: 'string',
      },
    },
    touch: {
      name: 'team-touch-portfolio',
      source: buildOrgSectionSource(
        input,
        ['leadershipTouch', 'capacityAndLoad', 'blockers'],
        ['capacityRisks', 'organizationBlockers']
      ),
      instructions: [
        '- Return qualitative touch-level arrays for teams. Low-touch means less intervention required now, not unimportant.',
        '- Include only teams whose required leadership touch is consequential. Prioritize high-touch and medium-touch teams; include insufficient-evidence teams only when the visibility gap itself creates material risk. Omit routine low-touch teams.',
      ],
      outputShape: {
        highTouch: [
          {
            teamId: 'exact team id',
            reason: 'string',
            interventionNeeded: 'string or null',
            teamSignalRefs: refShape,
          },
        ],
        mediumTouch: [
          {
            teamId: 'exact team id',
            reason: 'string',
            interventionNeeded: 'string or null',
            teamSignalRefs: refShape,
          },
        ],
        lowTouch: [
          {
            teamId: 'exact team id',
            reason: 'string',
            interventionNeeded: 'string or null',
            teamSignalRefs: refShape,
          },
        ],
        insufficientEvidence: [
          {
            teamId: 'exact team id',
            reason: 'string',
            interventionNeeded: 'string or null',
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    cannot: {
      name: 'cannot-deadlock',
      source: buildOrgSectionSource(
        input,
        ['criticalWork', 'blockers', 'bottlenecks', 'leadershipAsks'],
        ['criticalInitiatives', 'organizationBlockers', 'crossTeamDependencies']
      ),
      instructions: [
        '- Return an items array with every initiative that cannot deadlock.',
        '- Prioritize CRITICAL/HIGH deadlock risk, stalled/regressing movement, missing owners, or cross-team bottlenecks.',
      ],
      outputShape: {
        items: [
          {
            initiativeTitle: 'string',
            teamIds: ['exact team id'],
            whyCritical: 'string',
            currentMovement: 'PROGRESSING|PROGRESSING_WITH_RISK|STALLED|REGRESSING|UNCLEAR',
            deadlockRisk: 'CRITICAL|HIGH|MEDIUM|LOW',
            currentBottleneck: 'string or null',
            leadershipIntervention: 'string',
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    bottlenecks: {
      name: 'organization-bottlenecks',
      source: buildOrgSectionSource(
        input,
        ['bottlenecks', 'blockers', 'leadershipLeverage'],
        ['organizationBlockers', 'crossTeamDependencies', 'capabilityGaps']
      ),
      instructions: [
        '- Return qualitative bottleneck arrays separated into peopleOrOwnership, process, platform, and crossTeamDependencies.',
        '- Include only the highest-impact bottlenecks that can change organization outcomes.',
      ],
      outputShape: {
        peopleOrOwnership: [itemShape],
        process: [itemShape],
        platform: [itemShape],
        crossTeamDependencies: [
          {
            fromTeamId: 'exact team id',
            toTeamId: 'exact team id or null',
            description: 'string',
            status: 'OPEN|BLOCKED|AT_RISK|RESOLVED|UNCLEAR',
            ageDays: 1,
            affectedBetTitles: ['string'],
            recommendedAction: 'string',
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    agenda: {
      name: 'decision-agenda',
      source: buildOrgSectionSource(
        input,
        ['decisionsAndAlignment', 'leadershipLeverage', 'leadershipAsks'],
        ['crossTeamDependencies']
      ),
      instructions: [
        '- Return qualitative decision agenda arrays. Include only decisions supported by current signals.',
        '- Include only decision agenda items that can materially change outcomes. Prioritize irreversible, conflicting, ownerless, delayed, or budget-impacting decisions.',
      ],
      outputShape: {
        irreversibleDecisions: [decisionFactShape],
        reversibleDecisionsNeedingDelegation: [decisionFactShape],
        conflictingTeamDecisions: [decisionFactShape],
        budgetApprovals: [itemShape],
        decisionsWithoutOwners: [itemShape],
        decisionsAtRiskOfDelay: [itemShape],
      },
    },
    leverage: {
      name: 'leadership-leverage',
      source: buildOrgSectionSource(
        input,
        ['leadershipLeverage', 'leadershipAsks', 'blockers', 'decisionsAndAlignment'],
        ['organizationBlockers', 'crossTeamDependencies', 'capabilityGaps']
      ),
      instructions: [
        '- Return qualitative leadership leverage arrays tied to observed source signals.',
        '- Include only the highest-leverage points tied to observed source signals. Omit nice-to-know observations that do not change a founder or manager decision.',
      ],
      outputShape: {
        budgetsAndApprovals: [itemShape],
        momentumCorrections: [itemShape],
        connectionsNeeded: [itemShape],
        problemShapingNeeds: [itemShape],
        learningAndUpskilling: [itemShape],
        tradeoffs: [itemShape],
        alignmentCorrections: [itemShape],
        peopleOrTeamMoves: [itemShape],
      },
    },
    next: {
      name: 'organization-next-leap',
      source: buildOrgSectionSource(
        input,
        ['nextLeap', 'directionalBet', 'capabilityMix', 'blockers', 'criticalWork'],
        ['strategicBets', 'criticalInitiatives', 'capabilityGaps', 'organizationBlockers']
      ),
      instructions: [
        '- Return one qualitative organization next-leap assessment.',
        '- State what is wrong, what comes next, and the next meaningful leap without unsupported facts.',
        '- Include only the most decision-relevant people/process/platform/connections/successSignals items supported by the evidence.',
      ],
      outputShape: {
        whatNext: 'string',
        whatIsWrong: 'string',
        theLeap: 'string',
        peopleMoves: ['string'],
        problemShapingChanges: ['string'],
        processChanges: ['string'],
        platformChanges: ['string'],
        connectionsNeeded: ['string'],
        successSignals: ['string'],
        teamSignalRefs: refShape,
      },
    },
    actions: {
      name: 'recommended-actions',
      source: buildOrgSectionSource(
        input,
        ['leadershipAsks', 'blockers', 'criticalWork', 'upcomingRisks', 'decisionsAndAlignment'],
        ['organizationBlockers', 'crossTeamDependencies', 'criticalInitiatives']
      ),
      instructions: [
        '- Return an items array with every concrete organization leadership action that is supported by the evidence.',
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
            affectedTeamIds: ['exact team id'],
            teamSignalRefs: refShape,
          },
        ],
      },
    },
    dataGaps: {
      name: 'data-gaps',
      source: buildOrgSectionSource(input, ['dataGaps']),
      instructions: [
        '- Return only an items array of evidence/data gaps that limit organization interpretation.',
        '- Include only evidence/data gaps that materially change founder confidence or require corrective action.',
      ],
      outputShape: { items: [{ gap: 'string', impact: 'string' }] },
    },
  });
  const whoRaw = extractionRaw.who;
  const whoIsDoingWhat = simpleRecords(whoRaw)
    .map((fact, index): OrgWorkstream | null => {
      const refs = refsFromFact(fact, 'Evidence for organization initiative', 'who-is-doing-what');
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0 || teamIds.length === 0) return null;
      const title = cleanString(fact.title, `Initiative ${index + 1}`);
      return {
        id: `initiative_${index + 1}`,
        title,
        description: contextualizeWithTeams(
          cleanString(fact.description ?? fact.detail, title),
          teamIds,
          95
        ),
        status: enumValue(fact.status, ORG_WORK_STATUS, 'UNKNOWN'),
        importance: enumValue(fact.importance ?? fact.priority, ORG_PRIORITY, 'MEDIUM'),
        movement: enumValue(fact.movement, ORG_MOVEMENT, 'UNCLEAR'),
        teams: teamIdentities(teamIds),
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgWorkstream => item !== null);
  const rankedWhoIsDoingWhat = rankItems(whoIsDoingWhat);

  const needsRaw = extractionRaw.needs;
  const needsUnblocking = simpleRecords(needsRaw)
    .map((fact, index): OrgBlocker | null => {
      const refs = refsFromFact(fact, 'Evidence for organization blocker', 'needs-unblocking');
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Blocker ${index + 1}`);
      return {
        id: `blocker_${index + 1}`,
        title,
        description: contextualizeWithTeams(
          cleanString(fact.description ?? fact.detail, title),
          teamIds,
          95
        ),
        severity: enumValue(fact.severity ?? fact.priority, ORG_PRIORITY, 'MEDIUM'),
        status: enumValue(fact.status, ORG_BLOCKER_STATUS, 'OPEN'),
        affectedTeamIds: teamIds,
        affectedInitiativeIds: initiativeIdsFromFact(fact, rankedWhoIsDoingWhat),
        needsActionFrom: allStrings(cleanStringArray(fact.needsActionFrom)),
        recommendedAction: contextualizeWithTeams(
          cleanString(fact.recommendedAction ?? fact.action, 'Clarify the next unblock action.'),
          teamIds,
          55
        ),
        firstSeen: input.reportDate,
        daysOpen: 1,
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgBlocker => item !== null);
  const rankedNeedsUnblocking = rankItems(needsUnblocking);

  const criticalRaw = extractionRaw.critical;
  const criticalAndMoving = simpleRecords(criticalRaw)
    .map((fact, index): OrgWorkstream | null => {
      const refs = refsFromFact(
        fact,
        'Evidence for critical organization initiative',
        'critical-and-moving'
      );
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0 || teamIds.length === 0) return null;
      const title = cleanString(fact.title, `Critical initiative ${index + 1}`);
      return {
        id: `critical_initiative_${index + 1}`,
        title,
        description: contextualizeWithTeams(
          cleanString(fact.description ?? fact.detail, title),
          teamIds,
          105
        ),
        status: enumValue(fact.status, ORG_WORK_STATUS, 'UNKNOWN'),
        importance: enumValue(fact.importance ?? fact.priority, ORG_PRIORITY, 'HIGH'),
        movement: enumValue(fact.movement, ORG_MOVEMENT, 'UNCLEAR'),
        teams: teamIdentities(teamIds),
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgWorkstream => item !== null);
  const rankedCriticalAndMoving = rankItems(criticalAndMoving);

  const momentumRaw = extractionRaw.momentum;
  const momentumRecord = asRecord(momentumRaw.momentumAndDirection ?? momentumRaw);
  const momentumAndDirection: OrgOperationalSnapshot['momentumAndDirection'] = {
    momentum: enumValue(momentumRecord.momentum, ORG_MOMENTUM, 'INSUFFICIENT_BASELINE'),
    direction: enumValue(momentumRecord.direction, ORG_DIRECTION, 'INSUFFICIENT_EVIDENCE'),
    assessment: cleanString(
      momentumRecord.assessment,
      'Insufficient evidence to assess organization momentum confidently.'
    ),
    progressingInitiativeIds: initiativeIdsFromFact(
      { initiativeTitles: momentumRecord.progressingInitiativeTitles },
      rankedWhoIsDoingWhat
    ),
    stalledInitiativeIds: initiativeIdsFromFact(
      { initiativeTitles: momentumRecord.stalledInitiativeTitles },
      rankedWhoIsDoingWhat
    ),
    busyButNotClearlyDirectional: allStrings(
      cleanStringArray(momentumRecord.busyButNotClearlyDirectional)
    ),
    teamSignalRefs: refsFromFact(
      momentumRecord,
      'Evidence for organization momentum',
      'momentum-and-direction'
    ),
  };

  const decisionsRaw = extractionRaw.decisions;
  const decisionsRecord = asRecord(decisionsRaw.decisionsAndAlignment ?? decisionsRaw);
  const buildDecisions = (key: string, prefix: string): OrgDecision[] =>
    simpleRecords(decisionsRecord, [key])
      .map((fact, index) => {
        const refs = refsFromFact(fact, `Evidence for ${prefix}`, 'decisions-and-alignment');
        if (refs.length === 0) return null;
        const decision = cleanString(fact.decision ?? fact.title, `${prefix} ${index + 1}`);
        return {
          id: `${prefix}_${index + 1}`,
          decision,
          context: cleanString(fact.context ?? fact.description, decision),
          impact: cleanString(fact.impact, 'Impact not fully specified in evidence.'),
          affectedTeamIds: teamIdsFromFact(fact, validTeamIds),
          reversibility: enumValue(fact.reversibility, ORG_REVERSIBILITY, 'UNCLEAR'),
          status: enumValue(
            fact.status,
            ORG_DECISION_STATUS,
            key === 'conflictingDecisions' ? 'CONFLICTING' : 'UNCLEAR'
          ),
          needsLeadershipInput: Boolean(fact.needsLeadershipInput),
          teamSignalRefs: refs,
        };
      })
      .filter((item): item is OrgDecision => item !== null);
  const decisions = buildDecisions('decisions', 'decision');
  const conflictingDecisions = buildDecisions('conflictingDecisions', 'conflicting_decision');
  const rankedDecisions = rankItems(decisions);
  const rankedConflictingDecisions = rankItems(conflictingDecisions);
  const decisionsAndAlignment: OrgOperationalSnapshot['decisionsAndAlignment'] = {
    alignmentStatus: enumValue(
      decisionsRecord.alignmentStatus,
      ORG_ALIGNMENT,
      'INSUFFICIENT_EVIDENCE'
    ),
    decisions: rankedDecisions,
    conflictingDecisions: rankedConflictingDecisions,
    openQuestions: allStrings(cleanStringArray(decisionsRecord.openQuestions)),
  };

  const loadRaw = extractionRaw.load;
  const loadRecord = asRecord(loadRaw.loadFocusAndGaps ?? loadRaw);
  const buildPortfolioItems = (key: string, prefix: string): OrgPortfolioItem[] =>
    simpleRecords(loadRecord, [key])
      .map((fact) => {
        const teamId = cleanString(fact.teamId);
        const team = teamById.get(teamId);
        const refs = refsFromFact(fact, `Evidence for ${prefix}`, 'load-focus-and-gaps');
        if (!team || refs.length === 0) return null;
        return {
          teamId,
          teamName: team.team.name,
          assessment: cleanString(
            fact.assessment ?? fact.description,
            `${prefix} for ${team.team.name}`
          ),
          severity: enumValue(fact.severity ?? fact.priority, ORG_PRIORITY, 'MEDIUM'),
          teamSignalRefs: refs,
        };
      })
      .filter((item): item is OrgPortfolioItem => item !== null);
  const loadFocusAndGaps: OrgOperationalSnapshot['loadFocusAndGaps'] = {
    overloadedTeams: rankItems(buildPortfolioItems('overloadedTeams', 'load signal')),
    teamsNeedingSupport: rankItems(buildPortfolioItems('teamsNeedingSupport', 'support signal')),
    capabilityGaps: rankItems(
      buildOrgItems(
        simpleRecords(loadRecord, ['capabilityGaps']),
        'capability_gap',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('load-focus-and-gaps')
      )
    ),
    ownershipConcentrationRisks: rankItems(
      buildOrgItems(
        simpleRecords(loadRecord, ['ownershipConcentrationRisks']),
        'ownership_concentration',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('load-focus-and-gaps')
      )
    ),
    resourceImbalances: rankItems(
      buildOrgItems(
        simpleRecords(loadRecord, ['resourceImbalances']),
        'resource_imbalance',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('load-focus-and-gaps')
      )
    ),
  };

  const upcomingRaw = extractionRaw.upcoming;
  const upcomingAndAtRisk = simpleRecords(upcomingRaw)
    .map((fact, index): OrgRisk | null => {
      const refs = refsFromFact(fact, 'Evidence for organization risk', 'upcoming-and-at-risk');
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0) return null;
      const title = cleanString(fact.title, `Risk ${index + 1}`);
      return {
        id: `risk_${index + 1}`,
        title,
        description: contextualizeWithTeams(
          cleanString(fact.description ?? fact.detail, title),
          teamIds,
          95
        ),
        expectedDate: nullableString(fact.expectedDate),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, ORG_PRIORITY, 'MEDIUM'),
        affectedTeamIds: teamIds,
        dependencies: allStrings(cleanStringArray(fact.dependencies)),
        requiredNextSteps: allStrings(cleanStringArray(fact.requiredNextSteps ?? fact.nextSteps)),
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgRisk => item !== null);
  const rankedUpcomingAndAtRisk = rankItems(upcomingAndAtRisk);

  const betsRaw = extractionRaw.bets;
  const portfolioOfBets = simpleRecords(betsRaw)
    .map((fact, index): OrgBet | null => {
      const refs = refsFromFact(fact, 'Evidence for organization bet', 'portfolio-of-bets');
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0 || teamIds.length === 0) return null;
      const title = cleanString(fact.title, `Bet ${index + 1}`);
      return {
        id: `bet_${index + 1}`,
        title,
        description: cleanString(fact.description ?? fact.detail, title),
        teamIds,
        technicalWaves: allStrings(cleanStringArray(fact.technicalWaves)),
        businessWaves: allStrings(cleanStringArray(fact.businessWaves)),
        stage: enumValue(fact.stage, ORG_BET_STAGE, 'UNKNOWN'),
        momentum: enumValue(fact.momentum, ORG_BET_MOMENTUM, 'INSUFFICIENT_BASELINE'),
        differentiation: enumValue(
          fact.differentiation,
          ORG_EVIDENCE_LEVEL,
          'INSUFFICIENT_EVIDENCE'
        ),
        organizationAlignment: enumValue(
          fact.organizationAlignment,
          ORG_ALIGNMENT,
          'INSUFFICIENT_EVIDENCE'
        ),
        riskLevel: enumValue(fact.riskLevel ?? fact.priority, ORG_PRIORITY, 'MEDIUM'),
        assessment: cleanString(fact.assessment, title),
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgBet => item !== null);
  const rankedPortfolioOfBets = rankItems(portfolioOfBets);

  const capabilityRaw = extractionRaw.capability;
  const capabilityRecord = asRecord(capabilityRaw.organizationCapabilityMix ?? capabilityRaw);
  const organizationCapabilityMix: OrgFounderSnapshot['organizationCapabilityMix'] = {
    strongCapabilities: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['strongCapabilities']),
        'strong_capability',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    developingCapabilities: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['developingCapabilities']),
        'developing_capability',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    missingCapabilities: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['missingCapabilities']),
        'missing_capability',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    capabilitiesConcentratedInOneTeam: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['capabilitiesConcentratedInOneTeam']),
        'team_concentrated_capability',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    capabilitiesConcentratedInOnePerson: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['capabilitiesConcentratedInOnePerson']),
        'person_concentrated_capability',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    capabilityMovementOpportunities: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['capabilityMovementOpportunities']),
        'capability_movement',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    hiringOrUpskillingNeeds: rankItems(
      buildOrgItems(
        simpleRecords(capabilityRecord, ['hiringOrUpskillingNeeds']),
        'upskilling_need',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-capability-mix')
      )
    ),
    assessment: cleanString(
      capabilityRecord.assessment,
      'Insufficient evidence to assess organization capability mix confidently.'
    ),
  };

  const touchRaw = extractionRaw.touch;
  const touchRecord = asRecord(touchRaw.teamTouchPortfolio ?? touchRaw);
  const buildTouchTeams = (key: string, prefix: string): OrgTouchTeam[] =>
    simpleRecords(touchRecord, [key])
      .map((fact, index) => {
        const teamId = cleanString(fact.teamId);
        const team = teamById.get(teamId);
        const refs = refsFromFact(fact, `Evidence for ${prefix}`, 'team-touch-portfolio');
        if (!team || refs.length === 0) return null;
        return {
          teamId,
          teamName: team.team.name,
          reason: cleanString(fact.reason ?? fact.description, `${prefix} ${index + 1}`),
          interventionNeeded: nullableString(fact.interventionNeeded),
          teamSignalRefs: refs,
        };
      })
      .filter((item): item is OrgTouchTeam => item !== null);
  const teamTouchPortfolio: OrgFounderSnapshot['teamTouchPortfolio'] = {
    highTouch: buildTouchTeams('highTouch', 'high-touch team'),
    mediumTouch: buildTouchTeams('mediumTouch', 'medium-touch team'),
    lowTouch: buildTouchTeams('lowTouch', 'low-touch team'),
    insufficientEvidence: buildTouchTeams('insufficientEvidence', 'insufficient-evidence team'),
  };

  const cannotRaw = extractionRaw.cannot;
  const cannotDeadlockItems = simpleRecords(cannotRaw)
    .map((fact, index) => {
      const refs = refsFromFact(fact, 'Evidence for cannot-deadlock item', 'cannot-deadlock');
      const teamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
      ];
      if (refs.length === 0 || teamIds.length === 0) return null;
      const initiative = cleanString(
        fact.initiative ?? fact.initiativeTitle ?? fact.title,
        `Initiative ${index + 1}`
      );
      return {
        rank: index + 1,
        initiativeId:
          initiativeIdsFromFact(fact, [...rankedWhoIsDoingWhat, ...rankedCriticalAndMoving])[0] ??
          `cannot_deadlock_${index + 1}`,
        initiative,
        teamIds,
        whyCritical: cleanString(fact.whyCritical ?? fact.description, initiative),
        currentMovement: enumValue(fact.currentMovement ?? fact.movement, ORG_MOVEMENT, 'UNCLEAR'),
        deadlockRisk: enumValue(fact.deadlockRisk ?? fact.riskLevel, ORG_PRIORITY, 'MEDIUM'),
        currentBottleneck: nullableString(fact.currentBottleneck),
        leadershipIntervention: cleanString(
          fact.leadershipIntervention ?? fact.recommendedAction,
          'Clarify the required leadership intervention.'
        ),
        teamSignalRefs: refs,
      };
    })
    .filter((item): item is OrgFounderSnapshot['cannotDeadlock'][number] => item !== null);
  const cannotDeadlock: OrgFounderSnapshot['cannotDeadlock'] = rankItems(cannotDeadlockItems).map(
    (item, index) => ({ ...item, rank: index + 1 })
  );

  const bottlenecksRaw = extractionRaw.bottlenecks;
  const bottleneckRecord = asRecord(bottlenecksRaw.organizationBottlenecks ?? bottlenecksRaw);
  const organizationBottlenecks: OrgFounderSnapshot['organizationBottlenecks'] = {
    peopleOrOwnership: rankItems(
      buildOrgItems(
        simpleRecords(bottleneckRecord, ['peopleOrOwnership']),
        'people_bottleneck',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-bottlenecks')
      )
    ),
    process: rankItems(
      buildOrgItems(
        simpleRecords(bottleneckRecord, ['process']),
        'process_bottleneck',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-bottlenecks')
      )
    ),
    platform: rankItems(
      buildOrgItems(
        simpleRecords(bottleneckRecord, ['platform']),
        'platform_bottleneck',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('organization-bottlenecks')
      )
    ),
    crossTeamDependencies: rankItems(
      simpleRecords(bottleneckRecord, ['crossTeamDependencies'])
        .map((fact, index) => {
          const refs = refsFromFact(
            fact,
            'Evidence for cross-team dependency',
            'organization-bottlenecks'
          );
          if (refs.length === 0) return null;
          return {
            id: `dependency_${index + 1}`,
            fromTeamId: cleanString(fact.fromTeamId, teamIdsFromRefs(refs)[0] ?? ''),
            toTeamId: nullableString(fact.toTeamId),
            description: cleanString(fact.description, `Cross-team dependency ${index + 1}`),
            status: enumValue(fact.status, ORG_DEP_STATUS, 'UNCLEAR'),
            ageDays:
              typeof fact.ageDays === 'number' && Number.isFinite(fact.ageDays)
                ? Math.max(0, Math.floor(fact.ageDays))
                : null,
            affectedBetIds: [] as string[],
            recommendedAction: cleanString(
              fact.recommendedAction ?? fact.action,
              'Clarify the dependency owner and next action.'
            ),
            teamSignalRefs: refs,
          };
        })
        .filter(
          (
            item
          ): item is OrgFounderSnapshot['organizationBottlenecks']['crossTeamDependencies'][number] =>
            item !== null
        )
    ),
  };

  const agendaRaw = extractionRaw.agenda;
  const agendaRecord = asRecord(agendaRaw.decisionAgenda ?? agendaRaw);
  const decisionAgenda: OrgFounderSnapshot['decisionAgenda'] = {
    irreversibleDecisions: rankItems(
      simpleRecords(agendaRecord, ['irreversibleDecisions'])
        .map((fact, index) => buildDecisionsFromFact(fact, index, 'irreversible_decision'))
        .filter((item): item is OrgDecision => item !== null)
    ),
    reversibleDecisionsNeedingDelegation: rankItems(
      simpleRecords(agendaRecord, ['reversibleDecisionsNeedingDelegation'])
        .map((fact, index) => buildDecisionsFromFact(fact, index, 'reversible_decision'))
        .filter((item): item is OrgDecision => item !== null)
    ),
    conflictingTeamDecisions: rankItems(
      simpleRecords(agendaRecord, ['conflictingTeamDecisions'])
        .map((fact, index) => buildDecisionsFromFact(fact, index, 'conflicting_team_decision'))
        .filter((item): item is OrgDecision => item !== null)
    ),
    budgetApprovals: rankItems(
      buildOrgItems(
        simpleRecords(agendaRecord, ['budgetApprovals']),
        'budget_approval',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('decision-agenda')
      )
    ),
    decisionsWithoutOwners: rankItems(
      buildOrgItems(
        simpleRecords(agendaRecord, ['decisionsWithoutOwners']),
        'ownerless_decision',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('decision-agenda')
      )
    ),
    decisionsAtRiskOfDelay: rankItems(
      buildOrgItems(
        simpleRecords(agendaRecord, ['decisionsAtRiskOfDelay']),
        'delayed_decision',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('decision-agenda')
      )
    ),
  };

  function buildDecisionsFromFact(
    fact: Record<string, unknown>,
    index: number,
    prefix: string
  ): OrgDecision | null {
    const refs = refsFromFact(fact, `Evidence for ${prefix}`, 'decision-agenda');
    if (refs.length === 0) return null;
    const decision = cleanString(fact.decision ?? fact.title, `${prefix} ${index + 1}`);
    return {
      id: `${prefix}_${index + 1}`,
      decision,
      context: cleanString(fact.context ?? fact.description, decision),
      impact: cleanString(fact.impact, 'Impact not fully specified in evidence.'),
      affectedTeamIds: teamIdsFromFact(fact, validTeamIds),
      reversibility: enumValue(fact.reversibility, ORG_REVERSIBILITY, 'UNCLEAR'),
      status: enumValue(fact.status, ORG_DECISION_STATUS, 'UNCLEAR'),
      needsLeadershipInput: Boolean(fact.needsLeadershipInput),
      teamSignalRefs: refs,
    };
  }

  const leverageRaw = extractionRaw.leverage;
  const leverageRecord = asRecord(leverageRaw.leadershipLeverage ?? leverageRaw);
  const leadershipLeverage: OrgFounderSnapshot['leadershipLeverage'] = {
    budgetsAndApprovals: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['budgetsAndApprovals']),
        'leverage_budget',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    momentumCorrections: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['momentumCorrections']),
        'leverage_momentum',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    connectionsNeeded: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['connectionsNeeded']),
        'leverage_connection',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    problemShapingNeeds: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['problemShapingNeeds']),
        'leverage_problem_shape',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    learningAndUpskilling: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['learningAndUpskilling']),
        'leverage_learning',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    tradeoffs: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['tradeoffs']),
        'leverage_tradeoff',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    alignmentCorrections: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['alignmentCorrections']),
        'leverage_alignment',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
    peopleOrTeamMoves: rankItems(
      buildOrgItems(
        simpleRecords(leverageRecord, ['peopleOrTeamMoves']),
        'leverage_team_move',
        validTeamIds,
        validSignalIdsBySummary,
        fallbackRefsFor('leadership-leverage')
      )
    ),
  };

  const nextRaw = extractionRaw.next;
  const nextRecord = asRecord(nextRaw.organizationNextLeap ?? nextRaw);
  const organizationNextLeap: OrgFounderSnapshot['organizationNextLeap'] = {
    whatNext: cleanString(nextRecord.whatNext, 'Clarify the next organization step.'),
    whatIsWrong: cleanString(
      nextRecord.whatIsWrong,
      'Insufficient evidence to isolate the core issue.'
    ),
    theLeap: cleanString(nextRecord.theLeap, 'Define the next meaningful leap with leadership.'),
    peopleMoves: allStrings(cleanStringArray(nextRecord.peopleMoves)),
    problemShapingChanges: allStrings(cleanStringArray(nextRecord.problemShapingChanges)),
    processChanges: allStrings(cleanStringArray(nextRecord.processChanges)),
    platformChanges: allStrings(cleanStringArray(nextRecord.platformChanges)),
    connectionsNeeded: allStrings(cleanStringArray(nextRecord.connectionsNeeded)),
    successSignals: allStrings(cleanStringArray(nextRecord.successSignals)),
    teamSignalRefs: refsFromFact(
      nextRecord,
      'Evidence for organization next leap',
      'organization-next-leap'
    ),
  };

  const actionsRaw = extractionRaw.actions;
  const recommendedActions = simpleRecords(actionsRaw).map((fact, index) => {
    const refs = refsFromFact(fact, 'Evidence for organization action', 'recommended-actions');
    const teamIds = [
      ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(refs)]),
    ];
    return {
      id: `action_${index + 1}`,
      priority: enumValue(fact.priority, ORG_PRIORITY, 'MEDIUM'),
      timeHorizon: enumValue(fact.timeHorizon, ORG_TIME_HORIZON, 'THIS_WEEK'),
      action: contextualizeWithTeams(
        cleanString(fact.action, `Review action ${index + 1}.`),
        teamIds,
        55
      ),
      why: contextualizeWithTeams(
        cleanString(fact.why ?? fact.reason, 'Evidence indicates this action may help.'),
        teamIds,
        70
      ),
      suggestedOwner: nullableString(fact.suggestedOwner),
      expectedOutcome: contextualizeWithTeams(
        cleanString(fact.expectedOutcome, 'Improved execution clarity.'),
        teamIds,
        45
      ),
      affectedTeamIds: teamIds,
      teamSignalRefs: refs,
    };
  });
  const rankedRecommendedActions = rankItems(recommendedActions);

  const dataGapsRaw = extractionRaw.dataGaps;
  const dataGaps = simpleRecords(dataGapsRaw).map((fact) => ({
    gap: cleanString(fact.gap ?? fact.title, 'Unspecified data gap'),
    impact: cleanString(
      fact.impact ?? fact.description,
      'This limits confidence in the organization snapshot.'
    ),
  }));

  const fallbackRefs = dedupeTeamSignalRefs([
    ...rankedWhoIsDoingWhat.flatMap((item) => item.teamSignalRefs),
    ...rankedCriticalAndMoving.flatMap((item) => item.teamSignalRefs),
    ...rankedNeedsUnblocking.flatMap((item) => item.teamSignalRefs),
    ...sourceFallbackRefs,
  ]);
  const finalSummaryRaw = await runSection<Record<string, unknown>>({
    name: 'final-dependent-summary',
    source: buildOrgSectionSource(input, [
      'summary',
      'managerSummaryBullets',
      'leadershipAsks',
      'confidence',
    ]),
    instructions: [
      '- Return one final dependent summary object only.',
      '- Base overallConfidence on evidence breadth, team coverage, consistency, and data gaps.',
      '- Synthesize the generated sections and supplied compact team source without adding unsupported facts.',
      '- executiveSummary must be concise, qualitative, and founder-ready. It must not be empty/default when priorSections contains critical work, blockers, risks, or actions.',
      '- Every executiveSummary list item and every managerSummaryBullets.text sentence must name the relevant team(s), and must name the relevant individual(s) when currentTeamSignals includes member/owner names.',
      '- Write team/person context inside the sentence itself, not only in contributorTeamIds or teamSignalRefs.',
      '- managerSummaryBullets must contain only the 3 to 5 most important, evidence-backed founder/leadership takeaways across the organization — facts whose omission could change a founder decision or understanding. Select material blockers, risks, outcomes, strategic movement, unresolved decisions, and high-leverage actions. Do not emit one bullet per team or routine update; merge related points. Return fewer than 3 when evidence is weak and never exceed 5.',
    ],
    outputShape: {
      overallConfidence: 'HIGH|MEDIUM|LOW',
      executiveSummary: {
        narrative: 'string',
        momentum: 'FORWARD|FORWARD_WITH_BLOCKERS|MIXED|FLAT|REGRESSING|INSUFFICIENT_BASELINE',
        topBets: ['string'],
        topSignals: ['string'],
        topBlockers: ['string'],
        topRisks: ['string'],
        immediateLeadershipActions: ['string'],
      },
      managerSummaryBullets: [
        {
          title: '3-8 word headline',
          text: 'one concise leadership sentence with team/person context included',
          category:
            'shipped|achievement|collaboration|learning|recognition|learned|helped|milestone',
          contributorTeamIds: ['exact team id'],
          teamSignalRefs: refShape,
        },
      ], // max 5 bullets — only decision-relevant founder-level takeaways
    },
    priorSections: compactForPriorSections({
      whoIsDoingWhat: rankedWhoIsDoingWhat,
      needsUnblocking: rankedNeedsUnblocking,
      criticalAndMoving: rankedCriticalAndMoving,
      momentumAndDirection,
      decisionsAndAlignment,
      loadFocusAndGaps,
      upcomingAndAtRisk: rankedUpcomingAndAtRisk,
      portfolioOfBets: rankedPortfolioOfBets,
      organizationCapabilityMix,
      teamTouchPortfolio,
      cannotDeadlock,
      organizationBottlenecks,
      decisionAgenda,
      leadershipLeverage,
      organizationNextLeap,
      recommendedActions: rankedRecommendedActions,
      dataGaps,
    }) as Record<string, unknown>,
  });
  const finalSummaryRecord = asRecord(finalSummaryRaw);
  const workstreamLine = (item: OrgWorkstream): string => {
    const teamIds = item.teams.map((team) => team.teamId);
    return `${teamContextForIds(teamIds)}: ${item.title} is ${formatLabel(item.status)} with ${formatLabel(item.movement)} movement. ${item.description}`;
  };
  const blockerLine = (item: OrgBlocker): string =>
    `${teamContextForIds(item.affectedTeamIds)} is blocked by ${item.title}. ${item.description}`;
  const riskLine = (item: OrgRisk): string =>
    `${teamContextForIds(item.affectedTeamIds)} has risk ${item.title}. ${item.description}`;
  const actionLine = (
    item: TeamIntelligenceOrgLeadershipSummary['recommendedActions'][number]
  ): string => item.action;
  const overallConfidence = enumValue(
    finalSummaryRecord.overallConfidence ??
      finalSummaryRecord.confidence ??
      finalSummaryRecord.value,
    ORG_CONFIDENCE,
    'MEDIUM'
  );
  const executiveRecord = asRecord(finalSummaryRecord.executiveSummary ?? finalSummaryRecord);
  const generatedNarrative = cleanString(executiveRecord.narrative ?? executiveRecord.summary);
  const derivedTopBets = allStrings(
    rankedPortfolioOfBets.map(
      (bet) => `${teamContextForIds(bet.teamIds)} is tied to ${bet.title}: ${bet.assessment}`
    )
  );
  const derivedTopSignals = allStrings(rankedCriticalAndMoving.map(workstreamLine));
  const derivedTopBlockers = allStrings(rankedNeedsUnblocking.map(blockerLine));
  const derivedTopRisks = allStrings(rankedUpcomingAndAtRisk.map(riskLine));
  const derivedImmediateActions = allStrings(rankedRecommendedActions.map(actionLine));
  const reusedNarrative = firstCleanString([
    generatedNarrative,
    momentumAndDirection.assessment,
    derivedTopSignals[0],
    derivedTopBlockers[0],
    derivedTopRisks[0],
    derivedImmediateActions[0],
    derivedTopBets[0],
  ]);
  if (!reusedNarrative) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM organization final summary did not produce an overall summary for organization=${input.organization.name}`
    );
  }
  const topBets = allStrings(cleanStringArray(executiveRecord.topBets));
  const topSignals = allStrings(cleanStringArray(executiveRecord.topSignals));
  const topBlockers = allStrings(cleanStringArray(executiveRecord.topBlockers));
  const topRisks = allStrings(cleanStringArray(executiveRecord.topRisks));
  const immediateLeadershipActions = allStrings(
    cleanStringArray(executiveRecord.immediateLeadershipActions)
  );
  const executiveSummary: TeamIntelligenceOrgLeadershipSummary['executiveSummary'] = {
    narrative: limitWords(reusedNarrative, 300),
    momentum: enumValue(executiveRecord.momentum, ORG_MOMENTUM, momentumAndDirection.momentum),
    topBets: topBets.length > 0 ? topBets : derivedTopBets,
    topSignals: topSignals.length > 0 ? topSignals : derivedTopSignals,
    topBlockers: topBlockers.length > 0 ? topBlockers : derivedTopBlockers,
    topRisks: topRisks.length > 0 ? topRisks : derivedTopRisks,
    immediateLeadershipActions:
      immediateLeadershipActions.length > 0 ? immediateLeadershipActions : derivedImmediateActions,
  };
  let managerSummaryBullets = simpleRecords(finalSummaryRecord, [
    'managerSummaryBullets',
    'bullets',
    'items',
  ])
    .map((fact, index) => {
      const refs = refsFromFact(fact, 'Evidence for organization bullet');
      const teamSignalRefs = refs.length > 0 ? refs : fallbackRefs.slice(0, 3);
      const contributorTeamIds = [
        ...new Set([...teamIdsFromFact(fact, validTeamIds), ...teamIdsFromRefs(teamSignalRefs)]),
      ];
      if (teamSignalRefs.length === 0 || contributorTeamIds.length === 0) return null;
      const text = contextualizeWithTeams(
        cleanString(fact.text ?? fact.summary ?? fact.description, executiveSummary.narrative),
        contributorTeamIds,
        55
      );
      return {
        id: `bullet_${index + 1}`,
        title: cleanString(fact.title, text.split(/\s+/).slice(0, 6).join(' ')),
        text,
        category: bulletCategoryValue(fact.category, ORG_BULLET_CATEGORIES, 'achievement'),
        contributorTeamIds,
        teamSignalRefs,
      };
    })
    .filter(
      (item): item is TeamIntelligenceOrgLeadershipSummary['managerSummaryBullets'][number] =>
        item !== null
    );
  // Hard cap: a founder brief must surface only the most important takeaways,
  // never one-per-team routine updates. Keep at most MAX_ORG_SUMMARY_BULLETS.
  managerSummaryBullets = managerSummaryBullets.slice(0, MAX_ORG_SUMMARY_BULLETS);

  const continuityState: TeamIntelligenceOrgContinuityState = {
    window: { from: input.reportDate, to: input.reportDate, daysRepresented: 1 },
    strategicBets: rankedPortfolioOfBets.map((bet) => ({
      id: bet.id,
      title: bet.title,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      strength: bet.momentum === 'INSUFFICIENT_BASELINE' ? 'UNCLEAR' : bet.momentum,
      teamIds: bet.teamIds,
    })),
    criticalInitiatives: rankedCriticalAndMoving.map((item) => ({
      id: item.id,
      title: item.title,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      movement: item.movement,
      teamIds: item.teams.map((team) => team.teamId),
    })),
    organizationBlockers: rankedNeedsUnblocking.map((item) => ({
      id: item.id,
      title: item.title,
      firstSeen: item.firstSeen ?? input.reportDate,
      lastSeen: input.reportDate,
      status: item.status,
      affectedTeamIds: item.affectedTeamIds,
    })),
    crossTeamDependencies: organizationBottlenecks.crossTeamDependencies.map((item) => ({
      id: item.id,
      fromTeamId: item.fromTeamId,
      toTeamId: item.toTeamId,
      description: item.description,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      status: item.status,
    })),
    capabilityGaps: organizationCapabilityMix.missingCapabilities.map((item) => ({
      id: item.id,
      capability: item.title,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      affectedTeamIds: item.affectedTeamIds,
    })),
    capacityRisks: loadFocusAndGaps.overloadedTeams.map((item) => ({
      teamId: item.teamId,
      assessment: 'OVERLOADED',
      daysObserved: 1,
    })),
    irreversibleDecisions: decisionAgenda.irreversibleDecisions.map((item) => ({
      id: item.id,
      decision: item.decision,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
      status:
        item.status === 'DECIDED'
          ? 'DECIDED'
          : item.status === 'SUPERSEDED'
            ? 'SUPERSEDED'
            : 'PENDING',
    })),
    upcomingCommitments: rankedUpcomingAndAtRisk.map((item) => ({
      id: item.id,
      title: item.title,
      expectedDate: item.expectedDate,
      riskLevel: item.riskLevel,
      teamIds: item.affectedTeamIds,
    })),
    teamTouchLevels: [
      ...teamTouchPortfolio.highTouch.map((item) => ({
        teamId: item.teamId,
        recommendedMode: 'HIGH_TOUCH' as const,
      })),
      ...teamTouchPortfolio.mediumTouch.map((item) => ({
        teamId: item.teamId,
        recommendedMode: 'MEDIUM_TOUCH' as const,
      })),
      ...teamTouchPortfolio.lowTouch.map((item) => ({
        teamId: item.teamId,
        recommendedMode: 'LOW_TOUCH' as const,
      })),
      ...teamTouchPortfolio.insufficientEvidence.map((item) => ({
        teamId: item.teamId,
        recommendedMode: 'INSUFFICIENT_EVIDENCE' as const,
      })),
    ].map((item) => ({
      ...item,
      firstSeen: input.reportDate,
      lastSeen: input.reportDate,
    })),
  };

  return {
    whoIsDoingWhat: rankedWhoIsDoingWhat,
    needsUnblocking: rankedNeedsUnblocking,
    criticalAndMoving: rankedCriticalAndMoving,
    momentumAndDirection,
    decisionsAndAlignment,
    loadFocusAndGaps,
    upcomingAndAtRisk: rankedUpcomingAndAtRisk,
    portfolioOfBets: rankedPortfolioOfBets,
    organizationCapabilityMix,
    teamTouchPortfolio,
    cannotDeadlock,
    organizationBottlenecks,
    decisionAgenda,
    leadershipLeverage,
    organizationNextLeap,
    recommendedActions: rankedRecommendedActions,
    dataGaps,
    continuityState,
    overallConfidence,
    executiveSummary,
    managerSummaryBullets,
  };
}

async function generateOrgSummarySections(
  llmClient: LLMClient,
  input: TeamIntelligenceOrgLeadershipInput
): Promise<OrgGeneratedSections> {
  return generateOrgSummarySectionsFromSimpleFacts(llmClient, input);
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
  Object.entries(record).forEach(([key, item]) => {
    // The team identity is valid context, but its id is not an evidence signal.
    if (key !== 'team') {
      collectIds(item, ids);
    }
  });
  return ids;
}

function validateIdentityAndCoverage(
  summary: TeamIntelligenceOrgLeadershipSummary,
  input: TeamIntelligenceOrgLeadershipInput
): void {
  const expectedMemberCount = input.teams.reduce((sum, team) => sum + team.team.memberCount, 0);
  if (
    summary.batchId !== input.batchId ||
    summary.reportDate !== input.reportDate ||
    summary.organization.id !== input.organization.id ||
    summary.organization.name !== input.organization.name ||
    summary.organization.teamCount !== input.processingCoverage.expectedTeams ||
    summary.organization.memberCount !== expectedMemberCount
  ) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM organization summary changed immutable batch, date, organization, or coverage identity'
    );
  }
  if (JSON.stringify(summary.processingCoverage) !== JSON.stringify(input.processingCoverage)) {
    throw new TeamIntelligenceLLMUnavailableError(
      'LLM organization summary changed immutable processing coverage'
    );
  }
}

function validateReferences(
  summary: TeamIntelligenceOrgLeadershipSummary,
  input: TeamIntelligenceOrgLeadershipInput
): void {
  const teamBySummaryId = new Map(input.teams.map((team) => [team.teamSummaryId, team]));
  const teamIds = new Set(input.teams.map((team) => team.team.id));
  const signalIdsBySummary = new Map(
    input.teams.map((team) => [team.teamSummaryId, collectIds(team)])
  );
  const invalidSignalRefs: string[] = [];
  const unknownTeamIds: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'teamSignalRefs' && Array.isArray(child)) {
        for (const rawRef of child) {
          if (!rawRef || typeof rawRef !== 'object') {
            continue;
          }
          const ref = rawRef as Record<string, unknown>;
          if (
            typeof ref.teamSummaryId !== 'string' ||
            typeof ref.signalId !== 'string' ||
            !teamBySummaryId.has(ref.teamSummaryId) ||
            !signalIdsBySummary.get(ref.teamSummaryId)?.has(ref.signalId)
          ) {
            invalidSignalRefs.push(`${String(ref.teamSummaryId)}:${String(ref.signalId)}`);
          }
        }
      }
      if (
        (key === 'teamId' || key === 'fromTeamId' || key === 'toTeamId') &&
        typeof child === 'string' &&
        child &&
        !teamIds.has(child)
      ) {
        unknownTeamIds.push(child);
      }
      if (
        (key === 'teamIds' || key === 'affectedTeamIds' || key === 'contributorTeamIds') &&
        Array.isArray(child)
      ) {
        for (const teamId of child) {
          if (typeof teamId === 'string' && !teamIds.has(teamId)) {
            unknownTeamIds.push(teamId);
          }
        }
      }
      visit(child);
    }
  };
  const contentForReferenceValidation: Partial<TeamIntelligenceOrgLeadershipSummary> = {
    ...summary,
  };
  delete contentForReferenceValidation.processingCoverage;
  delete contentForReferenceValidation.organization;
  visit(contentForReferenceValidation);

  if (invalidSignalRefs.length > 0 || unknownTeamIds.length > 0) {
    logger.warn(
      '[TEAM-INTEL-ORG-SUMMARY] Ignoring invalid generated organization summary references',
      {
        organizationId: input.organization.id,
        organizationName: input.organization.name,
        invalidSignalRefs: [...new Set(invalidSignalRefs)],
        unknownTeamIds: [...new Set(unknownTeamIds)],
      }
    );
  }
}

function buildCompatibilityProvenance(
  input: TeamIntelligenceOrgLeadershipInput,
  summary: TeamIntelligenceOrgLeadershipSummary
): TeamIntelligenceOrgSummaryProvenance {
  const teamById = new Map(input.teams.map((team) => [team.team.id, team]));
  const teamBySummaryId = new Map(input.teams.map((team) => [team.teamSummaryId, team]));
  const bullets: TeamIntelligenceOrgSummaryBullet[] = summary.managerSummaryBullets.map(
    (bullet) => {
      const invalidContributorTeamIds = bullet.contributorTeamIds.filter(
        (teamId) => !teamById.has(teamId)
      );
      const primaryTeam =
        bullet.contributorTeamIds
          .map((teamId) => teamById.get(teamId))
          .find((team): team is TeamIntelligenceOrgAggregationPayload => Boolean(team)) ??
        bullet.teamSignalRefs
          .map((ref) => teamBySummaryId.get(ref.teamSummaryId))
          .find((team): team is TeamIntelligenceOrgAggregationPayload => Boolean(team)) ??
        input.teams[0];
      if (invalidContributorTeamIds.length > 0) {
        logger.warn(
          '[TEAM-INTEL-ORG-SUMMARY] Ignored invalid compatibility contributor team references',
          {
            batchId: input.batchId,
            organizationId: input.organization.id,
            organizationName: input.organization.name,
            bulletId: bullet.id,
            invalidContributorTeamIds: [...new Set(invalidContributorTeamIds)],
            fallbackTeamId: primaryTeam.team.id,
          }
        );
      }
      const sourceTeamBulletIds = new Set<string>();
      for (const ref of bullet.teamSignalRefs) {
        const team = teamBySummaryId.get(ref.teamSummaryId);
        const exactBullet = team?.managerSummaryBullets.find(
          (candidate) => candidate.id === ref.signalId
        );
        if (exactBullet) {
          sourceTeamBulletIds.add(exactBullet.id);
        } else if (team?.managerSummaryBullets[0]) {
          sourceTeamBulletIds.add(team.managerSummaryBullets[0].id);
        }
      }

      return {
        bulletId: bullet.id,
        teamId: primaryTeam.team.id,
        teamName: primaryTeam.team.name,
        reportDate: input.reportDate,
        bulletTitle: bullet.title,
        bulletText: bullet.text,
        bulletCat: bullet.category,
        sourceTeamBulletIds: [...sourceTeamBulletIds],
        prIdsUsed: [],
        repoNames: [],
        contributors: [],
        confidence:
          summary.overallConfidence === 'HIGH'
            ? 0.9
            : summary.overallConfidence === 'MEDIUM'
              ? 0.7
              : 0.5,
      };
    }
  );
  const generatedAt = new Date().toISOString();

  return {
    reportDate: input.reportDate,
    source: input.source,
    generatedAt,
    bulletCount: bullets.length,
    teamIndex: input.teams.reduce<Record<string, { teamName: string; bulletCount: number }>>(
      (index, team) => {
        index[team.team.id] = {
          teamName: team.team.name,
          bulletCount: bullets.filter((bullet) => bullet.teamId === team.team.id).length,
        };
        return index;
      },
      {}
    ),
    bullets,
  };
}

class TeamIntelligenceOrgSummaryService {
  private getLlmClient(): LLMClient {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence org summaries'
      );
    }
    return llmClient;
  }

  async generate(
    input: TeamIntelligenceOrgLeadershipInput
  ): Promise<TeamIntelligenceOrgLeadershipOutput> {
    if (input.teams.length === 0) {
      throw new TeamIntelligenceLLMUnavailableError(
        `No completed team summaries available for organization on ${input.reportDate}`
      );
    }

    const llmClient = this.getLlmClient();
    const sections = await generateOrgSummarySections(llmClient, input);
    const parsed: unknown = {
      schemaVersion: '1.0',
      scope: 'ORG_LEADERSHIP_SNAPSHOT',
      batchId: input.batchId,
      reportDate: input.reportDate,
      organization: {
        id: input.organization.id,
        name: input.organization.name,
        teamCount: input.processingCoverage.expectedTeams,
        memberCount: input.teams.reduce((sum, team) => sum + team.team.memberCount, 0),
      },
      managerSummaryBullets: sections.managerSummaryBullets,
      executiveSummary: sections.executiveSummary,
      operationalSnapshot: {
        whoIsDoingWhat: sections.whoIsDoingWhat,
        needsUnblocking: sections.needsUnblocking,
        criticalAndMoving: sections.criticalAndMoving,
        momentumAndDirection: sections.momentumAndDirection,
        decisionsAndAlignment: sections.decisionsAndAlignment,
        loadFocusAndGaps: sections.loadFocusAndGaps,
        upcomingAndAtRisk: sections.upcomingAndAtRisk,
      },
      founderSnapshot: {
        portfolioOfBets: sections.portfolioOfBets,
        organizationCapabilityMix: sections.organizationCapabilityMix,
        teamTouchPortfolio: sections.teamTouchPortfolio,
        cannotDeadlock: sections.cannotDeadlock,
        organizationBottlenecks: sections.organizationBottlenecks,
        decisionAgenda: sections.decisionAgenda,
        leadershipLeverage: sections.leadershipLeverage,
        organizationNextLeap: sections.organizationNextLeap,
      },
      recommendedActions: sections.recommendedActions,
      processingCoverage: input.processingCoverage,
      dataGaps: sections.dataGaps,
      continuityState: sections.continuityState,
      overallConfidence: sections.overallConfidence,
    };

    let validation = TeamIntelligenceOrgLeadershipSummarySchema.safeParse(parsed);
    if (!validation.success) {
      const pruned = pruneInvalidArrayItemsForRetry(parsed, validation.error.issues);
      if (pruned.prunedCount > 0) {
        logger.warn(
          '[TEAM-INTEL-ORG-SUMMARY] Pruned invalid organization summary array items before validation retry',
          {
            organizationId: input.organization.id,
            organizationName: input.organization.name,
            prunedCount: pruned.prunedCount,
            prunedPaths: pruned.prunedPaths,
            error: validation.error.message,
          }
        );
        validation = TeamIntelligenceOrgLeadershipSummarySchema.safeParse(parsed);
      }
    }
    if (!validation.success) {
      throw new TeamIntelligenceLLMUnavailableError(
        `LLM organization leadership response did not match the required schema: ${validation.error.message}`
      );
    }
    validateIdentityAndCoverage(validation.data, input);
    validateReferences(validation.data, input);

    const provenance = buildCompatibilityProvenance(input, validation.data);
    const summaryText = validation.data.managerSummaryBullets.map(
      (bullet) => `**[${input.organization.name}]:** ${bullet.text}`
    );
    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-org-leadership-llm-v1',
      generatedAt: provenance.generatedAt,
      reportDate: input.reportDate,
      organizationId: input.organization.id,
      organizationName: input.organization.name,
      source: input.source,
      metrics: {
        expectedTeams: input.processingCoverage.expectedTeams,
        completedTeamSummaries: input.processingCoverage.completedTeamSummaries,
        failedTeamSummaries: input.processingCoverage.failedTeamSummaries,
        betCount: validation.data.founderSnapshot.portfolioOfBets.length,
        criticalInitiativeCount: validation.data.operationalSnapshot.criticalAndMoving.length,
        blockerCount: validation.data.operationalSnapshot.needsUnblocking.length,
        recommendedActionCount: validation.data.recommendedActions.length,
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
          'load-focus-and-gaps',
          'upcoming-and-at-risk',
          'portfolio-of-bets',
          'organization-capability-mix',
          'team-touch-portfolio',
          'cannot-deadlock',
          'organization-bottlenecks',
          'decision-agenda',
          'leadership-leverage',
          'organization-next-leap',
          'recommended-actions',
          'data-gaps',
          'final-dependent-summary',
        ],
        codeBuiltSections: ['continuity-state'],
      },
    };

    return {
      reportDate: input.reportDate,
      source: input.source,
      summaryText,
      summaryMetadata:
        summaryMetadata as unknown as TeamIntelligenceOrgSummaryOutput['summaryMetadata'],
      provenance,
      orgSummary: validation.data,
      continuityState: validation.data.continuityState,
    };
  }
}

export const teamIntelligenceOrgSummaryService = new TeamIntelligenceOrgSummaryService();
