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

const SUMMARY_MIN_LINES = 3;
const SUMMARY_MAX_LINES = 4;
const SUMMARY_MAX_WORDS = 50;

function normalizeSummaryText(value: string, maxWords = SUMMARY_MAX_WORDS): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, ' ')
    .replace(/^\s*\d+\.\s+/gm, ' ')
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
): Promise<TeamIntelligenceOrgSummaryBullet[] | null> {
  const prompt = [
    'Rewrite org bullets for a manager feed.',
    'Return STRICT JSON only with this shape:',
    '{ "bullets": [ { "bulletId": "string", "bulletTitle": "string", "bulletText": "string" } ] }',
    'Rules:',
    '- Keep all bulletId values exactly the same as input.',
    '- bulletTitle must be concise: 3-8 words.',
    '- bulletText must be descriptive: one sentence with concrete delivery details.',
    '- bulletText must stay under 50 words.',
    '- bulletTitle must not be the same as bulletText.',
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

    const normalizedText = normalizeSummaryText(rewritten.bulletText, SUMMARY_MAX_WORDS);

    return {
      ...bullet,
      bulletTitle: rewritten.bulletTitle,
      bulletText: normalizedText,
      bulletCat: normalizeBulletCategory(bullet.bulletCat, normalizedText),
    };
  });
}

function buildDeterministicBullets(input: TeamIntelligenceOrgSummaryInput): TeamIntelligenceOrgSummaryBullet[] {
  const bullets: TeamIntelligenceOrgSummaryBullet[] = input.teamSummaries.flatMap((teamSummary): TeamIntelligenceOrgSummaryBullet[] => {
    const teamBullets = teamSummary.provenance.bullets ?? [];
    if (teamBullets.length > 0) {
      return teamBullets.map((bullet) => ({
        bulletId: `${teamSummary.teamId}:${bullet.bulletId}`,
        teamId: teamSummary.teamId,
        teamName: teamSummary.teamName,
        reportDate: bullet.reportDate,
        bulletTitle: buildBulletTitle(normalizeSummaryText(bullet.bulletText, SUMMARY_MAX_WORDS)),
        bulletText: normalizeSummaryText(bullet.bulletText, SUMMARY_MAX_WORDS),
        bulletCat: inferBulletCategory(normalizeSummaryText(bullet.bulletText, SUMMARY_MAX_WORDS)),
        sourceTeamBulletIds: [bullet.bulletId],
        prIdsUsed: bullet.prIdsUsed,
        repoNames: bullet.repoNames,
        contributors: bullet.contributors,
        confidence: bullet.confidence,
      }));
    }

    return [{
      bulletId: `${teamSummary.teamId}:no-signal`,
      teamId: teamSummary.teamId,
      teamName: teamSummary.teamName,
      reportDate: input.reportDate,
      bulletTitle: `${teamSummary.teamName} had no PR-linked signal`,
      bulletText: 'No PR-linked delivery signal was recorded for this reporting date.',
      bulletCat: 'milestone' as const,
      sourceTeamBulletIds: [],
      prIdsUsed: [],
      repoNames: [],
      contributors: [],
      confidence: 0.3,
    }];
  });

  return bullets.slice(0, SUMMARY_MAX_LINES);
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
    '- bulletTitle must not repeat bulletText.',
    '- bulletText must be descriptive and concrete (not just a short label).',
    '- Return exactly 2 or 3 bullets total (never more than 3).',
    '- bulletText must be one sentence under 50 words.',
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

function parseOrgSummaryResponse(input: TeamIntelligenceOrgSummaryInput, raw: string): TeamIntelligenceOrgSummaryBullet[] | null {
  const teamBulletIndex = new Map<string, { teamId: string; teamName: string; bullet: TeamIntelligenceTeamSummaryBullet }>();
  for (const teamSummary of input.teamSummaries) {
    for (const bullet of teamSummary.provenance.bullets ?? []) {
      teamBulletIndex.set(bullet.bulletId, { teamId: teamSummary.teamId, teamName: teamSummary.teamName, bullet });
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

  const conciseBullets = bullets.slice(0, SUMMARY_MAX_LINES);
  if (conciseBullets.length < SUMMARY_MIN_LINES) {
    return null;
  }

  return conciseBullets;
}

function enforceOrgBulletWindow(input: TeamIntelligenceOrgSummaryInput, bullets: TeamIntelligenceOrgSummaryBullet[]): TeamIntelligenceOrgSummaryBullet[] {
  const concise = bullets.slice(0, SUMMARY_MAX_LINES);
  if (concise.length >= SUMMARY_MIN_LINES) {
    return concise;
  }

  if (concise.length === 1) {
    const primary = concise[0];
    const secondText = normalizeSummaryText(
      `${input.source} teams maintained focused delivery progress on ${input.reportDate}.`,
      SUMMARY_MAX_WORDS
    );
    const secondBullet: TeamIntelligenceOrgSummaryBullet = {
      ...primary,
      bulletId: `${primary.teamId}:${primary.sourceTeamBulletIds.join('|')}:context`,
      bulletTitle: buildBulletTitle(secondText),
      bulletText: secondText,
      bulletCat: normalizeBulletCategory(primary.bulletCat, secondText),
    };

    return [primary, secondBullet];
  }

  const fallbackTeam = input.teamSummaries[0];
  const defaultText = normalizeSummaryText(
    `${fallbackTeam?.teamName ?? 'Org'} delivered focused engineering progress on ${input.reportDate}.`,
    SUMMARY_MAX_WORDS
  );
  const defaultBullet: TeamIntelligenceOrgSummaryBullet = {
    bulletId: `${fallbackTeam?.teamId ?? 'org'}:fallback`,
    teamId: fallbackTeam?.teamId ?? 'org',
    teamName: fallbackTeam?.teamName ?? 'Org',
    reportDate: input.reportDate,
    bulletTitle: buildBulletTitle(defaultText),
    bulletText: defaultText,
    bulletCat: 'milestone',
    sourceTeamBulletIds: [],
    prIdsUsed: [],
    repoNames: [],
    contributors: [],
    confidence: 0.3,
  };

  const secondBullet: TeamIntelligenceOrgSummaryBullet = {
    ...defaultBullet,
    bulletId: `${defaultBullet.teamId}:fallback-context`,
  };

  return [defaultBullet, secondBullet];
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

    bullets = enforceOrgBulletWindow(input, bullets);

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
