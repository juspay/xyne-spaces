import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceCommitInput,
  TeamIntelligenceTeamSummaryBullet,
  TeamIntelligenceTeamSummaryBulletContributor,
  TeamIntelligenceTeamSummaryEvidenceItem,
  TeamIntelligenceTeamSummaryInput,
  TeamIntelligenceTeamSummaryOutput,
  TeamIntelligenceTeamSummaryProvenance,
} from '../types';
import { TeamIntelligenceLLMUnavailableError } from '../errors';
import { extractJson } from '../llm-utils';
import { createTeamIntelligenceLlmClient } from './team-intelligence-llm-client';

interface RawTeamSummaryBullet {
  bulletTitle?: unknown;
  bulletText?: unknown;
  bulletCat?: unknown;
  reportDate?: unknown;
  prIdsUsed?: unknown;
  repoNames?: unknown;
  contributors?: unknown;
  confidence?: unknown;
}

interface RawTeamSummaryContributor {
  userId?: unknown;
  userEmail?: unknown;
  userName?: unknown;
  role?: unknown;
  contributionNote?: unknown;
}

interface RawTeamSummaryResponse {
  reportDate?: unknown;
  teamName?: unknown;
  bullets?: unknown;
}

interface RawTeamBulletRewriteItem {
  bulletId?: unknown;
  bulletTitle?: unknown;
  bulletText?: unknown;
}

interface RawTeamBulletRewriteResponse {
  bullets?: unknown;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function createStableId(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 16);
}

function summarizeCommitMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return 'Updated code changes.';
  }

  const withoutPrefix = normalized.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '');
  const candidate = withoutPrefix || normalized;

  const firstSentence = candidate.split(/[.!?]\s/)[0] ?? candidate;
  if (firstSentence.length <= 140) {
    return `${firstSentence.trim()}.`;
  }

  return `${firstSentence.slice(0, 137).trimEnd()}...`;
}

const SUMMARY_MAX_WORDS = 50;

const TEAM_BULLET_CATEGORIES = new Set([
  'shipped',
  'achievement',
  'collaboration',
  'learning',
  'recognition',
  'learned',
  'helped',
  'milestone',
] as const);

type TeamBulletCategory = TeamIntelligenceTeamSummaryBullet['bulletCat'];

function inferBulletCategory(text: string): TeamBulletCategory {
  const normalized = text.toLowerCase();

  if (/\bshipped\b|\breleased\b|\bdelivered\b|\blaunched\b/.test(normalized)) {
    return 'shipped';
  }
  if (/\bcollaborat|\bpartnered|\bcross[- ]?team|\baligned\b/.test(normalized)) {
    return 'collaboration';
  }
  if (/\blearned\b/.test(normalized)) {
    return 'learned';
  }
  if (/\blearning\b|\blearn\b|\bexplored\b/.test(normalized)) {
    return 'learning';
  }
  if (/\brecognized\b|\brecognition\b|\bawarded\b|\bpraised\b/.test(normalized)) {
    return 'recognition';
  }
  if (/\bhelped\b|\bsupported\b|\bassisted\b|\bunblocked\b/.test(normalized)) {
    return 'helped';
  }
  if (/\bmilestone\b|\bphase\b|\brollout\b|\bgo[- ]live\b/.test(normalized)) {
    return 'milestone';
  }

  return 'achievement';
}

function normalizeBulletCategory(value: unknown, bulletText: string): TeamBulletCategory {
  const normalized = normalizeString(value).toLowerCase();
  if (TEAM_BULLET_CATEGORIES.has(normalized as TeamBulletCategory)) {
    return normalized as TeamBulletCategory;
  }
  return inferBulletCategory(bulletText);
}

function normalizeComparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isTitleTooSimilarToText(title: string, text: string): boolean {
  const normalizedTitle = normalizeComparableText(title);
  const normalizedText = normalizeComparableText(text);

  if (!normalizedTitle || !normalizedText) {
    return true;
  }

  return normalizedTitle === normalizedText || normalizedText.includes(normalizedTitle);
}

function buildBulletTitle(bulletText: string): string {
  const compact = bulletText.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Team Update';
  }

  const cleaned = compact
    .replace(/[.!?]+$/g, '')
    .replace(/^Delivery progressed in\s+[^,]+\s+as\s+[^,]+\s+implemented\s+/i, '')
    .replace(/^\w+\s+continued\s+focused\s+delivery\s+in\s+[^,]+\s+during\s+\d{4}-\d{2}-\d{2}\.?$/i, 'Delivery Update')
    .replace(/^Implemented\s+/i, '')
    .replace(/,\s*with\s+additional\s+refinements\s+in\s+.*$/i, '')
    .trim();

  const words = (cleaned || compact).split(' ').filter(Boolean);
  const concise = words.slice(0, 6).join(' ');
  return concise || 'Team Update';
}

function normalizeSummaryText(value: string, maxWords = SUMMARY_MAX_WORDS): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b:?\s*/g, ' ')
    .replace(/\b(?:feat|fix|chore|refactor|docs|test|perf|style|build|ci|revert)(?:\([^)]+\))?!?:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstSentence = plain.split(/[.!?]\s/)[0] ?? plain;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  const clipped = words.slice(0, maxWords).join(' ').trim();

  if (!clipped) {
    return 'No significant delivery signal found.';
  }

  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

async function llmRewriteTeamBullets(
  llmClient: LLMClient,
  input: TeamIntelligenceTeamSummaryInput,
  bullets: TeamIntelligenceTeamSummaryBullet[]
): Promise<TeamIntelligenceTeamSummaryBullet[]> {
  const prompt = [
    'Rewrite team bullets for a manager feed.',
    'Return STRICT JSON only with this shape:',
    '{ "bullets": [ { "bulletId": "string", "bulletTitle": "string", "bulletText": "string" } ] }',
    'Rules:',
    '- Keep all bulletId values exactly the same as input.',
    '- bulletTitle must be concise: 3-8 words.',
    '- bulletTitle must be a standalone headline that summarizes the main outcome.',
    '- bulletTitle must NOT reuse the opening clause of bulletText.',
    '- bulletTitle must not start with phrases like "Delivery progressed", "Work progressed", "Team continued", or similar narrative lead-ins.',
    '- Prefer noun-phrase style titles such as "Mandate ACL Enforcement" or "Checkout Styling Expansion".',
    '- bulletTitle must not be the same as bulletText.',
    '- Keep every bullet as one sentence under 50 words.',
    '- Use natural, fluent narration with clean grammar.',
    '- Do not include ticket IDs, PR IDs, commit hashes, or branch names.',
    '- Do not copy PR titles or commit messages verbatim; paraphrase into plain language.',
    '- Avoid repetitive phrasing patterns and avoid always starting with team name.',
    '- Preserve factual meaning and evidence from input bullets.',
    '- Keep concrete engineering outcomes; remove filler and awkward wording.',
    `Context reportDate: ${input.reportDate}`,
    `Context teamName: ${input.teamName}`,
    `Context teamId: ${input.teamId}`,
    'Input bullets:',
    ...bullets.map((bullet) => JSON.stringify({
      bulletId: bullet.bulletId,
      bulletTitle: bullet.bulletTitle,
      bulletText: bullet.bulletText,
      bulletCat: bullet.bulletCat,
      prIdsUsed: bullet.prIdsUsed,
      repoNames: bullet.repoNames,
      contributors: bullet.contributors.map((contributor) => ({
        userName: contributor.userName,
        role: contributor.role,
      })),
    })),
  ].join('\n');

  const raw = await llmGenerate(llmClient, prompt);

  let parsed: RawTeamBulletRewriteResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as RawTeamBulletRewriteResponse;
  } catch (error) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM team rewrite response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  const rewriteRows = asArray<RawTeamBulletRewriteItem>(parsed.bullets);
  const rewriteMap = new Map<string, { bulletTitle: string; bulletText: string }>();

  for (const row of rewriteRows) {
    const bulletId = normalizeString(row.bulletId);
    const bulletTitle = normalizeString(row.bulletTitle);
    const bulletText = normalizeSummaryText(normalizeString(row.bulletText), SUMMARY_MAX_WORDS);

    if (!bulletId || !bulletTitle || !bulletText) {
      continue;
    }

    if (isTitleTooSimilarToText(bulletTitle, bulletText)) {
      continue;
    }

    rewriteMap.set(bulletId, { bulletTitle, bulletText });
  }

  if (rewriteMap.size !== bullets.length) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM team rewrite returned ${rewriteMap.size} usable bullets, expected ${bullets.length}`
    );
  }

  return bullets.map((bullet) => {
    const rewritten = rewriteMap.get(bullet.bulletId);
    if (!rewritten) {
      return bullet;
    }

    return {
      ...bullet,
      bulletTitle: rewritten.bulletTitle,
      bulletText: rewritten.bulletText,
      bulletCat: normalizeBulletCategory(bullet.bulletCat, rewritten.bulletText),
    };
  });
}



const LLM_MAX_ATTEMPTS = 3;
const LLM_RETRY_BASE_DELAY_MS = 1000;

function isTransientLLMError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('network') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function llmGenerate(llmClient: LLMClient, prompt: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await llmClient.generate({
        model: appConfig.workflow.defaultModelName,
        messages: [createUserMessage(prompt)],
        parameters: { maxTokens: 2048 },
      });
      const content = response.content?.trim();
      if (content) {
        return content;
      }
      lastError = new Error('LLM returned an empty response');
    } catch (error) {
      lastError = error;
      if (!isTransientLLMError(error) || attempt === LLM_MAX_ATTEMPTS) {
        break;
      }
    }
    if (attempt < LLM_MAX_ATTEMPTS) {
      await sleep(LLM_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  logger.error('[TEAM-INTEL-TEAM-SUMMARY] LLM call failed after retries; no fallback', { error: lastError });
  throw new TeamIntelligenceLLMUnavailableError(
    `LLM team summary generation failed after ${LLM_MAX_ATTEMPTS} attempt(s): ${
      lastError instanceof Error ? lastError.message : 'unknown error'
    }`
  );
}

function buildTeamEvidenceItems(input: TeamIntelligenceTeamSummaryInput): TeamIntelligenceTeamSummaryEvidenceItem[] {
  return input.users.flatMap((user) => {
    const source = normalizeString(user.source, input.source ?? 'mettle') || 'mettle';
    return user.pullRequests.map((pullRequest) => ({
      reportDate: input.reportDate,
      teamId: user.teamId.trim() || input.teamId,
      teamName: user.teamName?.trim() || input.teamName,
      source,
      userId: user.userId,
      userEmail: user.userEmail.trim().toLowerCase(),
      userName: user.userName.trim(),
      role: user.role ?? null,
      prId: pullRequest.prId,
      prTitle: pullRequest.prTitle,
      prDescription: normalizeOptionalString(pullRequest.prDescription),
      prSummary: normalizeOptionalString(pullRequest.prSummary),
      repoName: pullRequest.repoName,
      projectName: pullRequest.projectName,
      prState: pullRequest.prState,
      diffSummary: normalizeOptionalString(pullRequest.diff?.diffSummary),
      commitIds: asArray<TeamIntelligenceCommitInput>(pullRequest.commits).map((commit) => commit.commitId),
      commitSummaries: asArray<TeamIntelligenceCommitInput>(pullRequest.commits).map((commit) => {
        const summary = normalizeOptionalString(commit.commitSummary);
        return summary ?? summarizeCommitMessage(commit.commitMessage);
      }),
    }));
  });
}

function buildTeamSummaryPrompt(input: TeamIntelligenceTeamSummaryInput, evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[]): string {
  return [
    'You are writing a team summary for managers.',
    'Return STRICT JSON only with this shape:',
      '{ "reportDate": "YYYY-MM-DD", "teamName": "string", "bullets": [ { "bulletId": "string", "bulletTitle": "string", "bulletText": "string", "bulletCat": "shipped|achievement|collaboration|learning|recognition|learned|helped|milestone", "reportDate": "YYYY-MM-DD", "prIdsUsed": [1,2], "repoNames": ["repo-a"], "contributors": [ { "userId": "string|null", "userEmail": "string", "userName": "string", "role": "string|null", "contributionNote": "string" } ], "confidence": 0.0 } ] }',
    'Rules:',
      '- bulletTitle must be a short headline (3-8 words).',
      '- bulletTitle must summarize the outcome/theme, not repeat the first words of bulletText.',
      '- bulletTitle must avoid narrative lead-ins such as "Delivery progressed" or "Team continued".',
      '- Prefer noun-phrase headline style (for example: "Mandate ACL Enforcement", "Checkout Styling Expansion").',
      '- bulletTitle must not repeat bulletText.',
      '- bulletCat must be one of: shipped, achievement, collaboration, learning, recognition, learned, helped, milestone.',
    '- Every bullet must reference at least one PR id from the input evidence.',
    '- Every prIdUsed must exist in the evidence set.',
    '- contributors must only contain users from the input evidence.',
    '- Include the reportDate in every bullet.',
    '- Use factual, evidence-based bullets for a manager feed.',
    '- Explain what the team shipped, improved, fixed, or enabled.',
    '- Mention the repo or system area and name the contributors naturally.',
    '- Do not say only that somebody contributed to N PRs.',
    '- First rank candidate insights by impact, specificity, and uniqueness.',
    '- Then keep only the top non-overlapping insights in final bullets.',
    '- Return exactly 2 or 3 bullets total (never more than 3).',
    '- If there are more than 3 strong points, keep the highest-impact 3 (not first-come order).',
    '- Keep each bullet to one sentence and under 50 words.',
    '- Write in natural, human narration with clean grammar.',
    '- Do not include ticket IDs, PR IDs, commit hashes, or conventional-commit prefixes in bulletText.',
    '- Never copy PR titles or commit messages verbatim; always paraphrase into plain language.',
    '- Avoid repetitive structures such as "shipped X ... improving X".',
    '- Prefer prSummary as the primary signal; use prDescription only if prSummary is missing.',
    '- Do not copy markdown sections, checklists, links, screenshot names, or test plan text from PR descriptions.',
    '- No speculation or filler words; keep only high-signal facts.',
    `Context reportDate: ${input.reportDate}`,
    `Context teamId: ${input.teamId}`,
    `Context teamName: ${input.teamName}`,
    `Context source: ${input.source ?? 'mettle'}`,
    'Evidence items:',
    ...evidenceItems.map((item) => JSON.stringify({
      reportDate: item.reportDate,
      teamId: item.teamId,
      teamName: item.teamName,
      source: item.source,
      userId: item.userId ?? null,
      userEmail: item.userEmail,
      userName: item.userName,
      role: item.role ?? null,
      prId: item.prId,
      prTitle: item.prTitle,
      prSummary: item.prSummary,
      prDescription: item.prDescription,
      repoName: item.repoName,
      projectName: item.projectName,
      prState: item.prState,
      diffSummary: item.diffSummary,
      commitIds: item.commitIds,
      commitSummaries: item.commitSummaries,
    })),
  ].join('\n');
}

function parseBulletContributors(rawContributors: unknown): TeamIntelligenceTeamSummaryBulletContributor[] {
  return asArray<RawTeamSummaryContributor>(rawContributors)
    .map((contributor) => ({
      userId: normalizeOptionalString(contributor.userId) ?? undefined,
      userEmail: normalizeString(contributor.userEmail),
      userName: normalizeString(contributor.userName),
      role: normalizeOptionalString(contributor.role),
      contributionNote: normalizeString(contributor.contributionNote),
    }))
    .filter((contributor) => contributor.userEmail && contributor.userName && contributor.contributionNote);
}

function parseTeamSummaryResponse(
  rawContent: string,
  input: TeamIntelligenceTeamSummaryInput,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[]
): TeamIntelligenceTeamSummaryBullet[] {
  let parsed: RawTeamSummaryResponse;
  try {
    parsed = JSON.parse(extractJson(rawContent)) as RawTeamSummaryResponse;
  } catch (error) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM team summary response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  if (normalizeString(parsed.reportDate, input.reportDate) !== input.reportDate) {
    throw new TeamIntelligenceLLMUnavailableError('LLM team summary response reportDate did not match input');
  }

  if (normalizeString(parsed.teamName, input.teamName) !== input.teamName) {
    throw new TeamIntelligenceLLMUnavailableError('LLM team summary response teamName did not match input');
  }

  const evidencePrIds = new Set(evidenceItems.map((item) => item.prId));
  const evidenceUsers = new Set(evidenceItems.map((item) => item.userEmail));

  const bullets = asArray<RawTeamSummaryBullet>(parsed.bullets)
    .map((bullet) => {
      const prIdsUsed = asArray<unknown>(bullet.prIdsUsed)
        .map((value) => toFiniteNumber(value, Number.NaN))
        .filter((value) => Number.isFinite(value));

      if (prIdsUsed.length === 0 || prIdsUsed.some((prId) => !evidencePrIds.has(prId))) {
        return null;
      }

      const contributors = parseBulletContributors(bullet.contributors);
      if (contributors.length === 0) {
        return null;
      }

      if (contributors.some((contributor) => !evidenceUsers.has(contributor.userEmail))) {
        return null;
      }

      const bulletText = normalizeSummaryText(normalizeString(bullet.bulletText), SUMMARY_MAX_WORDS);
      if (!bulletText) {
        return null;
      }

      const bulletTitleRaw = normalizeString(bullet.bulletTitle);
      const bulletTitle = bulletTitleRaw || buildBulletTitle(bulletText);

      const repoNames = asArray<unknown>(bullet.repoNames)
        .map((value) => normalizeString(value))
        .filter(Boolean);

      const normalizedBullet: TeamIntelligenceTeamSummaryBullet = {
        bulletId: createStableId({
          reportDate: input.reportDate,
          teamId: input.teamId,
          bulletText,
          prIdsUsed,
        }),
        reportDate: input.reportDate,
        bulletTitle: isTitleTooSimilarToText(bulletTitle, bulletText) ? buildBulletTitle(bulletText) : bulletTitle,
        bulletText,
        bulletCat: normalizeBulletCategory(bullet.bulletCat, bulletText),
        prIdsUsed,
        repoNames,
        contributors,
        confidence: typeof bullet.confidence === 'number' ? bullet.confidence : 0.7,
      };

      return normalizedBullet;
    })
    .filter((bullet) => bullet !== null) as TeamIntelligenceTeamSummaryBullet[];

  if (bullets.length === 0) {
    throw new TeamIntelligenceLLMUnavailableError('LLM team summary response contained no valid bullets');
  }

  return bullets;
}

function buildProvenance(
  input: TeamIntelligenceTeamSummaryInput,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[],
  bullets: TeamIntelligenceTeamSummaryBullet[]
): TeamIntelligenceTeamSummaryProvenance {
  const prIndex = evidenceItems.reduce<TeamIntelligenceTeamSummaryProvenance['prIndex']>((accumulator, item) => {
    accumulator[item.prId] = {
      userId: item.userId,
      userEmail: item.userEmail,
      userName: item.userName,
      role: item.role ?? null,
      repoName: item.repoName,
      projectName: item.projectName,
    };
    return accumulator;
  }, {});

  return {
    reportDate: input.reportDate,
    teamId: input.teamId,
    teamName: input.teamName,
    source: input.source ?? 'mettle',
    generatedAt: new Date().toISOString(),
    bullets,
    prIndex,
  };
}

function buildSummaryText(bullets: TeamIntelligenceTeamSummaryBullet[], teamName: string): string[] {
  return bullets.map((bullet) => `**[${teamName}]:** ${bullet.bulletText}`);
}

class TeamIntelligenceTeamSummaryService {
  private async getDefaultWorkspaceLlmClient(): Promise<LLMClient> {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence team summaries'
      );
    }
    return llmClient;
  }

  async generate(input: TeamIntelligenceTeamSummaryInput): Promise<TeamIntelligenceTeamSummaryOutput> {
    const evidenceItems = buildTeamEvidenceItems(input);
    const llmClient = await this.getDefaultWorkspaceLlmClient();

    // LLM-only team summary. There is no deterministic fallback: if the LLM call
    // fails or yields no valid bullets, this throws and the worker fails the team
    // summary job (then passes ahead to the org stage with whatever teams completed).
    if (evidenceItems.length === 0) {
      throw new TeamIntelligenceLLMUnavailableError(
        `No PR evidence to summarize for team=${input.teamName} on ${input.reportDate}`
      );
    }

    const prompt = buildTeamSummaryPrompt(input, evidenceItems);
    const rawContent = await llmGenerate(llmClient, prompt);
    let bullets = parseTeamSummaryResponse(rawContent, input, evidenceItems);

    bullets = await llmRewriteTeamBullets(llmClient, input, bullets);

    const provenance = buildProvenance(input, evidenceItems, bullets);
    const summaryText = buildSummaryText(bullets, input.teamName);

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-team-summary-llm-v1',
      generatedAt: provenance.generatedAt,
      reportDate: input.reportDate,
      teamId: input.teamId,
      teamName: input.teamName,
      source: input.source ?? 'mettle',
      metrics: {
        userCount: input.users.length,
        evidenceCount: evidenceItems.length,
        bulletCount: bullets.length,
        uniquePrCount: evidenceItems.length,
        uniqueRepoCount: [...new Set(evidenceItems.map((item) => item.repoName))].length,
      },
      hasAiUsage: input.users.some((user) => user.aiUsage !== null && user.aiUsage !== undefined),
    };

    return {
      reportDate: input.reportDate,
      teamId: input.teamId,
      teamName: input.teamName,
      source: input.source ?? 'mettle',
      summaryText,
      summaryMetadata: summaryMetadata as unknown as TeamIntelligenceTeamSummaryOutput['summaryMetadata'],
      provenance,
    };
  }
}

export const teamIntelligenceTeamSummaryService = new TeamIntelligenceTeamSummaryService();
