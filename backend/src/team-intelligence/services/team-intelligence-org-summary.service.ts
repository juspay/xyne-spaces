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

interface RawOrgSummaryBullet {
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


async function llmGenerate(llmClient: LLMClient, prompt: string): Promise<string | null> {
  try {
    const response = await llmClient.generate({
      model: appConfig.workflow.defaultModelName,
      messages: [createUserMessage(prompt)],
      parameters: { maxTokens: 2048 },
    });

    return response.content?.trim() || null;
  } catch (error) {
    logger.warn('[TEAM-INTEL-ORG-SUMMARY] LLM call failed, falling back to deterministic summary', { error });
    return null;
  }
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

  const clean = compact.replace(/[.!?]+$/g, '');
  const words = clean.split(' ').filter(Boolean);
  const concise = words.slice(0, 8).join(' ');
  return concise || 'Team Update';
}

async function llmRewriteBullets(
  llmClient: LLMClient,
  reportDate: string,
  source: string,
  bullets: TeamIntelligenceOrgSummaryBullet[]
): Promise<TeamIntelligenceOrgSummaryBullet[] | null> {
  const prompt = [
    'Rewrite org bullets for a manager feed.',
    'Return STRICT JSON only with this shape:',
    '{ "bullets": [ { "bulletId": "string", "bulletTitle": "string", "bulletText": "string" } ] }',
    'Rules:',
    '- Keep all bulletId values exactly the same as input.',
    '- bulletTitle must be concise: 3-8 words.',
    '- bulletText must be descriptive: one sentence with concrete delivery details.',
    '- bulletTitle must not be the same as bulletText.',
    '- Keep factual meaning aligned to the input evidence.',
    `Context reportDate: ${reportDate}`,
    `Context source: ${source}`,
    'Input bullets:',
    ...bullets.map((bullet) => JSON.stringify({
      bulletId: bullet.bulletId,
      teamName: bullet.teamName,
      bulletTitle: bullet.bulletTitle,
      bulletText: bullet.bulletText,
      bulletCat: bullet.bulletCat,
      repoNames: bullet.repoNames,
      prIdsUsed: bullet.prIdsUsed,
    })),
  ].join('\n');

  const raw = await llmGenerate(llmClient, prompt);
  if (!raw) {
    return null;
  }

  let parsed: RawOrgBulletRewriteResponse;
  try {
    parsed = JSON.parse(raw) as RawOrgBulletRewriteResponse;
  } catch {
    return null;
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
    return null;
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

function buildDeterministicBullets(input: TeamIntelligenceOrgSummaryInput): TeamIntelligenceOrgSummaryBullet[] {
  return input.teamSummaries.flatMap((teamSummary) => {
    const teamBullets = teamSummary.provenance.bullets ?? [];
    if (teamBullets.length > 0) {
      return teamBullets.map((bullet) => ({
        bulletId: `${teamSummary.teamName}:${bullet.bulletId}`,
        teamName: teamSummary.teamName,
        reportDate: bullet.reportDate,
        bulletTitle: buildBulletTitle(bullet.bulletText),
        bulletText: bullet.bulletText,
        bulletCat: inferBulletCategory(bullet.bulletText),
        sourceTeamBulletIds: [bullet.bulletId],
        prIdsUsed: bullet.prIdsUsed,
        repoNames: bullet.repoNames,
        contributors: bullet.contributors,
        confidence: bullet.confidence,
      }));
    }

    return [{
      bulletId: `${teamSummary.teamName}:no-signal`,
      teamName: teamSummary.teamName,
      reportDate: input.reportDate,
      bulletTitle: `${teamSummary.teamName} had no PR-linked signal`,
      bulletText: 'No PR-linked delivery signal was recorded for this reporting date.',
      bulletCat: 'milestone',
      sourceTeamBulletIds: [],
      prIdsUsed: [],
      repoNames: [],
      contributors: [],
      confidence: 0.3,
    }];
  });
}

function buildSummaryText(bullets: TeamIntelligenceOrgSummaryBullet[]): string[] {
  return bullets.map((bullet) => `**[${bullet.teamName}]:** ${bullet.bulletText}`);
}

function buildPrompt(input: TeamIntelligenceOrgSummaryInput): string {
  const teamLines = input.teamSummaries.map((teamSummary) => {
    const bullets = (teamSummary.provenance.bullets ?? []).map((bullet) => JSON.stringify({
      bulletId: bullet.bulletId,
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
    '{ "reportDate": "YYYY-MM-DD", "bullets": [ { "teamName": "string", "bulletTitle": "string", "bulletText": "string", "bulletCat": "shipped|achievement|collaboration|learning|recognition|learned|helped|milestone", "sourceTeamBulletIds": ["bullet-id"], "confidence": 0.0 } ] }',
    'Rules:',
    '- Each bullet must reference sourceTeamBulletIds from the input evidence.',
    '- teamName must match the source bullet team name.',
    '- bulletTitle must be a short headline (3-8 words).',
    '- bulletTitle must not repeat bulletText.',
    '- bulletText must be descriptive and concrete (not just a short label).',
    '- bulletCat must be one of: shipped, achievement, collaboration, learning, recognition, learned, helped, milestone.',
    '- Write subjective, feature-first bullets suitable for a news feed.',
    '- Say what the team shipped, improved, fixed, or enabled.',
    '- Include at least one bullet for every team represented in input.',
    `Report date: ${input.reportDate}`,
    `Source: ${input.source}`,
    'Team summary bullets:',
    teamLines,
  ].join('\n');
}

function parseOrgSummaryResponse(input: TeamIntelligenceOrgSummaryInput, raw: string): TeamIntelligenceOrgSummaryBullet[] | null {
  const teamBulletIndex = new Map<string, { teamName: string; bullet: TeamIntelligenceTeamSummaryBullet }>();
  for (const teamSummary of input.teamSummaries) {
    for (const bullet of teamSummary.provenance.bullets ?? []) {
      teamBulletIndex.set(bullet.bulletId, { teamName: teamSummary.teamName, bullet });
    }
  }

  let parsed: RawOrgSummaryResponse;
  try {
    parsed = JSON.parse(raw) as RawOrgSummaryResponse;
  } catch (error) {
    logger.warn('[TEAM-INTEL-ORG-SUMMARY] Failed to parse LLM JSON response', { error });
    return null;
  }

  if (normalizeString(parsed.reportDate, input.reportDate) !== input.reportDate) {
    return null;
  }

  const bullets = asArray<RawOrgSummaryBullet>(parsed.bullets).map((rawBullet) => {
    const teamName = normalizeString(rawBullet.teamName);
    const bulletText = normalizeString(rawBullet.bulletText);
    const bulletTitleRaw = normalizeString(rawBullet.bulletTitle);
    const sourceTeamBulletIds = asArray<unknown>(rawBullet.sourceTeamBulletIds)
      .map((value) => normalizeString(value))
      .filter(Boolean);

    if (!teamName || !bulletText || sourceTeamBulletIds.length === 0) {
      return null;
    }

    const sourceBullets = sourceTeamBulletIds
      .map((bulletId) => teamBulletIndex.get(bulletId))
      .filter((value) => value !== undefined);

    if (sourceBullets.length !== sourceTeamBulletIds.length) {
      return null;
    }

    if (sourceBullets.some((sourceBullet) => sourceBullet.teamName !== teamName)) {
      return null;
    }

    const title = bulletTitleRaw || buildBulletTitle(bulletText);
    return {
      bulletId: `${teamName}:${sourceTeamBulletIds.join('|')}`,
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

  const representedTeams = new Set(bullets.map((bullet) => bullet.teamName));
  if (bullets.length === 0 || input.teamSummaries.some((teamSummary) => !representedTeams.has(teamSummary.teamName))) {
    return null;
  }

  return bullets;
}

class TeamIntelligenceOrgSummaryService {
  private readonly llmClient: LLMClient | null;

  constructor() {
    const apiKey = appConfig.llm.litellmApiKey;
    this.llmClient = apiKey
      ? new LLMClient({
          provider: {
            type: 'litellm',
            config: {
              apiKey,
              baseUrl: appConfig.llm.litellmBaseUrl,
              timeout: 60000,
            },
          },
          defaultModel: appConfig.workflow.defaultModelName,
        })
      : null;
  }

  async generate(input: TeamIntelligenceOrgSummaryInput): Promise<TeamIntelligenceOrgSummaryOutput> {
    const llmClient = this.llmClient;
    let bullets = buildDeterministicBullets(input);
    if (llmClient && input.teamSummaries.length > 0) {
      const raw = await llmGenerate(llmClient, buildPrompt(input));
      if (raw) {
        const parsed = parseOrgSummaryResponse(input, raw);
        if (parsed) {
          bullets = parsed;
        }
      }
    }

    if (llmClient && bullets.length > 0) {
      const rewritten = await llmRewriteBullets(llmClient, input.reportDate, input.source, bullets);
      if (rewritten) {
        bullets = rewritten;
      }
    }

    const summaryText = buildSummaryText(bullets);

    const generatedAt = new Date().toISOString();
    const teamIndex = input.teamSummaries.reduce<Record<string, { bulletCount: number }>>((accumulator, teamSummary) => {
      accumulator[teamSummary.teamName] = {
        bulletCount: bullets.filter((bullet) => bullet.teamName === teamSummary.teamName).length,
      };
      return accumulator;
    }, {});

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: llmClient ? 'team-intelligence-org-summary-llm-v2' : 'team-intelligence-org-summary-v2',
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
