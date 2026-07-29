import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import type {
  TeamIntelligenceOrgSummaryBullet,
  TeamIntelligenceOrgSummaryInput,
  TeamIntelligenceOrgSummaryOutput,
  TeamIntelligenceTeamSummaryBullet,
} from '../types';
import { TeamIntelligenceLLMUnavailableError } from '../errors';
import { extractJson } from '../llm-utils';
import { createTeamIntelligenceLlmClient } from './team-intelligence-llm-client';

interface RawOrgSummaryBullet {
  teamId?: unknown;
  teamName?: unknown;
  bulletTitle?: unknown;
  bulletText?: unknown;
  bulletCat?: unknown;
  sourceTeamBulletIds?: unknown;
  confidence?: unknown;
}

interface RawOrgSummaryResponse {
  reportDate?: unknown;
  bullets?: unknown;
}

interface RawOrgBulletRewriteItem {
  bulletId?: unknown;
  bulletTitle?: unknown;
  bulletText?: unknown;
}

interface RawOrgBulletRewriteResponse {
  bullets?: unknown;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

  logger.error('[TEAM-INTEL-ORG-SUMMARY] LLM call failed after retries; no fallback', { error: lastError });
  throw new TeamIntelligenceLLMUnavailableError(
    `LLM org summary generation failed after ${LLM_MAX_ATTEMPTS} attempt(s): ${
      lastError instanceof Error ? lastError.message : 'unknown error'
    }`
  );
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const ORG_BULLET_CATEGORIES = new Set([
  'shipped',
  'achievement',
  'collaboration',
  'learning',
  'recognition',
  'learned',
  'helped',
  'milestone',
] as const);

type OrgBulletCategory = TeamIntelligenceOrgSummaryBullet['bulletCat'];

function inferBulletCategory(text: string): OrgBulletCategory {
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

function normalizeBulletCategory(value: unknown, bulletText: string): OrgBulletCategory {
  const normalized = normalizeString(value).toLowerCase();
  if (ORG_BULLET_CATEGORIES.has(normalized as OrgBulletCategory)) {
    return normalized as OrgBulletCategory;
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

  // Strip common narrative boilerplate to keep the title headline-like.
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

const SUMMARY_MAX_WORDS = 50;

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

async function llmRewriteBullets(
  llmClient: LLMClient,
  reportDate: string,
  source: string,
  bullets: TeamIntelligenceOrgSummaryBullet[]
): Promise<TeamIntelligenceOrgSummaryBullet[]> {
  const prompt = [
    'Rewrite org bullets for a manager feed.',
    'Return STRICT JSON only with this shape:',
    '{ "bullets": [ { "bulletId": "string", "bulletTitle": "string", "bulletText": "string" } ] }',
    'Rules:',
    '- Keep all bulletId values exactly the same as input.',
    '- bulletTitle must be concise: 3-8 words.',
    '- bulletTitle must be a standalone headline that summarizes the main outcome.',
    '- bulletTitle must NOT reuse the opening clause of bulletText.',
    '- bulletTitle must not start with phrases like "Delivery progressed", "Work progressed", "Team continued", or similar narrative lead-ins.',
    '- Prefer noun-phrase style titles such as "Mandate ACL Enforcement" or "Checkout Styling Expansion".',
    '- bulletText must be descriptive: one sentence with concrete delivery details.',
    '- bulletText must stay under 50 words.',
    '- bulletTitle must not be the same as bulletText.',
    '- Use clear, natural manager narration with correct grammar.',
    '- Do not include ticket IDs, commit hashes, or branch names (examples: BC-223, XYZ-19, a1b2c3d).',
    '- Do not copy PR titles or commit messages verbatim.',
    '- Paraphrase technical work into plain engineering outcomes.',
    '- Avoid malformed phrasing like duplicated verbs or repeated clauses.',
    '- Preserve the highest-impact signal from each input bullet while compressing.',
    '- If a detail must be dropped, drop lower-impact context first.',
    '- Keep factual meaning aligned to the input evidence.',
    '- Remove extra nuance and keep only the top outcome.',
    '- No speculation or filler words.',
    `Context reportDate: ${reportDate}`,
    `Context source: ${source}`,
    'Input bullets:',
    ...bullets.map((bullet) => JSON.stringify({
      bulletId: bullet.bulletId,
      teamId: bullet.teamId,
      teamName: bullet.teamName,
      bulletTitle: bullet.bulletTitle,
      bulletText: bullet.bulletText,
      bulletCat: bullet.bulletCat,
      repoNames: bullet.repoNames,
      prIdsUsed: bullet.prIdsUsed,
    })),
  ].join('\n');

  const raw = await llmGenerate(llmClient, prompt);

  let parsed: RawOrgBulletRewriteResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as RawOrgBulletRewriteResponse;
  } catch (error) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM org rewrite response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  const rewriteRows = asArray<RawOrgBulletRewriteItem>(parsed.bullets);
  const rewriteMap = new Map<string, { bulletTitle: string; bulletText: string }>();

  for (const row of rewriteRows) {
    const bulletId = normalizeString(row.bulletId);
    const bulletTitle = normalizeString(row.bulletTitle);
    const bulletText = normalizeString(row.bulletText);

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
      `LLM org rewrite returned ${rewriteMap.size} usable bullets, expected ${bullets.length}`
    );
  }

  return bullets.map((bullet) => {
    const rewritten = rewriteMap.get(bullet.bulletId);
    if (!rewritten) {
      return bullet;
    }

    const normalizedText = normalizeSummaryText(rewritten.bulletText, SUMMARY_MAX_WORDS);

    return {
      ...bullet,
      bulletTitle: rewritten.bulletTitle,
      bulletText: normalizedText,
      bulletCat: normalizeBulletCategory(bullet.bulletCat, normalizedText),
    };
  });
}

function buildSummaryText(bullets: TeamIntelligenceOrgSummaryBullet[]): string[] {
  return bullets.map((bullet) => `**[${bullet.teamName}]:** ${bullet.bulletText}`);
}

function buildPrompt(input: TeamIntelligenceOrgSummaryInput): string {
  const teamLines = input.teamSummaries.map((teamSummary) => {
    const bullets = (teamSummary.provenance.bullets ?? []).map((bullet) => JSON.stringify({
      bulletId: bullet.bulletId,
      teamId: teamSummary.teamId,
      teamName: teamSummary.teamName,
      bulletText: bullet.bulletText,
      prIdsUsed: bullet.prIdsUsed,
      repoNames: bullet.repoNames,
      contributors: bullet.contributors,
    })).join('\n');
    return `Team ${teamSummary.teamName}:\n${bullets || 'No bullets'}`;
  }).join('\n\n');

  return [
    'You are writing an org-level engineering summary for managers.',
    'Return STRICT JSON only with this shape:',
    '{ "reportDate": "YYYY-MM-DD", "bullets": [ { "teamId": "string", "teamName": "string", "bulletTitle": "string", "bulletText": "string", "bulletCat": "shipped|achievement|collaboration|learning|recognition|learned|helped|milestone", "sourceTeamBulletIds": ["bullet-id"], "confidence": 0.0 } ] }',
    'Rules:',
    '- Each bullet must reference sourceTeamBulletIds from the input evidence.',
    '- teamId must match the source bullet team id.',
    '- teamName should match the source team display name.',
    '- bulletTitle must be a short headline (3-8 words).',
    '- bulletTitle must summarize the outcome/theme, not repeat the first words of bulletText.',
    '- bulletTitle must avoid narrative lead-ins such as "Delivery progressed" or "Team continued".',
    '- Prefer noun-phrase headline style (for example: "Mandate ACL Enforcement", "Checkout Styling Expansion").',
    '- bulletTitle must not repeat bulletText.',
    '- bulletText must be descriptive and concrete (not just a short label).',
    '- Return exactly 2 or 3 bullets total (never more than 3).',
    '- bulletText must be one sentence under 50 words.',
    '- Write in natural, human narration, as if briefing leadership on what happened.',
    '- Keep grammar clean and fluent; avoid awkward or repetitive phrasing.',
    '- Do not include ticket IDs, PR IDs, commit hashes, or conventional-commit prefixes in bulletText.',
    '- Never copy PR titles or commit messages verbatim; always paraphrase into plain language.',
    '- Focus on what changed and why it mattered for product, platform, or developer experience.',
    '- bulletCat must be one of: shipped, achievement, collaboration, learning, recognition, learned, helped, milestone.',
    '- Use factual, evidence-based bullets for a manager feed.',
    '- Say what the team shipped, improved, fixed, or enabled.',
    '- First rank candidate insights by impact, specificity, and uniqueness.',
    '- Then keep only top non-overlapping insights in final bullets.',
    '- Keep output concise and only include the most important points per team.',
    '- If there are more than 3 strong points, keep the highest-impact 3 (not first-come order).',
    '- No speculation or filler words.',
    `Report date: ${input.reportDate}`,
    `Source: ${input.source}`,
    'Team summary bullets:',
    teamLines,
  ].join('\n');
}

function parseOrgSummaryResponse(input: TeamIntelligenceOrgSummaryInput, raw: string): TeamIntelligenceOrgSummaryBullet[] {
  const teamBulletIndex = new Map<string, { teamId: string; teamName: string; bullet: TeamIntelligenceTeamSummaryBullet }>();
  for (const teamSummary of input.teamSummaries) {
    for (const bullet of teamSummary.provenance.bullets ?? []) {
      teamBulletIndex.set(bullet.bulletId, { teamId: teamSummary.teamId, teamName: teamSummary.teamName, bullet });
    }
  }

  let parsed: RawOrgSummaryResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as RawOrgSummaryResponse;
  } catch (error) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM org summary response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  if (normalizeString(parsed.reportDate, input.reportDate) !== input.reportDate) {
    throw new TeamIntelligenceLLMUnavailableError('LLM org summary response reportDate did not match input');
  }

  const bullets = asArray<RawOrgSummaryBullet>(parsed.bullets).map((rawBullet) => {
    const teamId = normalizeString(rawBullet.teamId);
    const teamName = normalizeString(rawBullet.teamName);
    const bulletText = normalizeSummaryText(normalizeString(rawBullet.bulletText), SUMMARY_MAX_WORDS);
    const bulletTitleRaw = normalizeString(rawBullet.bulletTitle);
    const sourceTeamBulletIds = asArray<unknown>(rawBullet.sourceTeamBulletIds)
      .map((value) => normalizeString(value))
      .filter(Boolean);

    if (!teamId || !teamName || !bulletText || sourceTeamBulletIds.length === 0) {
      return null;
    }

    const sourceBullets = sourceTeamBulletIds
      .map((bulletId) => teamBulletIndex.get(bulletId))
      .filter((value) => value !== undefined);

    if (sourceBullets.length !== sourceTeamBulletIds.length) {
      return null;
    }

    if (sourceBullets.some((sourceBullet) => sourceBullet.teamId !== teamId)) {
      return null;
    }

    const title = bulletTitleRaw || buildBulletTitle(bulletText);
    return {
      bulletId: `${teamId}:${sourceTeamBulletIds.join('|')}`,
      teamId,
      teamName,
      reportDate: input.reportDate,
      bulletTitle: isTitleTooSimilarToText(title, bulletText) ? buildBulletTitle(bulletText) : title,
      bulletText,
      bulletCat: normalizeBulletCategory(rawBullet.bulletCat, bulletText),
      sourceTeamBulletIds,
      prIdsUsed: [...new Set(sourceBullets.flatMap((sourceBullet) => sourceBullet.bullet.prIdsUsed))].sort((left, right) => left - right),
      repoNames: [...new Set(sourceBullets.flatMap((sourceBullet) => sourceBullet.bullet.repoNames))].sort(),
      contributors: [...new Map(sourceBullets
        .flatMap((sourceBullet) => sourceBullet.bullet.contributors)
        .map((contributor) => [contributor.userEmail, contributor])).values()],
      confidence: toFiniteNumber(rawBullet.confidence, 0.7),
    } satisfies TeamIntelligenceOrgSummaryBullet;
  }).filter((bullet) => bullet !== null) as TeamIntelligenceOrgSummaryBullet[];

  if (bullets.length === 0) {
    throw new TeamIntelligenceLLMUnavailableError('LLM org summary response contained no valid bullets');
  }

  return bullets;
}

class TeamIntelligenceOrgSummaryService {
  private async getDefaultWorkspaceLlmClient(): Promise<LLMClient> {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence org summaries'
      );
    }
    return llmClient;
  }

  async generate(input: TeamIntelligenceOrgSummaryInput): Promise<TeamIntelligenceOrgSummaryOutput> {
    const llmClient = await this.getDefaultWorkspaceLlmClient();

    // LLM-only org summary. No deterministic fallback: if the LLM call fails or
    // yields no valid bullets, this throws and the worker fails the org summary job.
    if (input.teamSummaries.length === 0) {
      throw new TeamIntelligenceLLMUnavailableError(
        `No team summaries to roll up for org summary on ${input.reportDate}`
      );
    }

    const raw = await llmGenerate(llmClient, buildPrompt(input));
    let bullets = parseOrgSummaryResponse(input, raw);

    bullets = await llmRewriteBullets(llmClient, input.reportDate, input.source, bullets);

    const summaryText = buildSummaryText(bullets);

    const generatedAt = new Date().toISOString();
    const teamIndex = input.teamSummaries.reduce<Record<string, { teamName: string; bulletCount: number }>>((accumulator, teamSummary) => {
      accumulator[teamSummary.teamId] = {
        teamName: teamSummary.teamName,
        bulletCount: bullets.filter((bullet) => bullet.teamId === teamSummary.teamId).length,
      };
      return accumulator;
    }, {});

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-org-summary-llm-v2',
      generatedAt,
      reportDate: input.reportDate,
      source: input.source,
      metrics: {
        totalTeams: input.teamSummaries.length,
        bulletCount: summaryText.length,
      },
    };

    return {
      reportDate: input.reportDate,
      source: input.source,
      summaryText,
      summaryMetadata: summaryMetadata as unknown as TeamIntelligenceOrgSummaryOutput['summaryMetadata'],
      provenance: {
        reportDate: input.reportDate,
        source: input.source,
        generatedAt,
        bulletCount: summaryText.length,
        teamIndex,
        bullets,
      },
    };
  }
}

export const teamIntelligenceOrgSummaryService = new TeamIntelligenceOrgSummaryService();
