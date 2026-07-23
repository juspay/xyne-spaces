import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { LLMClient, createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
import type {
  TeamIntelligenceCommitInput,
  TeamIntelligenceTeamSummaryBullet,
  TeamIntelligenceTeamSummaryBulletContributor,
  TeamIntelligenceTeamSummaryEvidenceItem,
  TeamIntelligenceTeamSummaryInput,
  TeamIntelligenceTeamSummaryOutput,
  TeamIntelligenceTeamSummaryProvenance,
} from '../types';

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

function formatList(items: string[]): string {
  const values = items.map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function trimSentence(value: string): string {
  return value.trim().replace(/[.\s]+$/, '');
}

const SUMMARY_MIN_LINES = 3;
const SUMMARY_MAX_LINES = 4;
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
): Promise<TeamIntelligenceTeamSummaryBullet[] | null> {
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
  if (!raw) {
    return null;
  }

  let parsed: RawTeamBulletRewriteResponse;
  try {
    parsed = JSON.parse(raw) as RawTeamBulletRewriteResponse;
  } catch {
    return null;
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

function buildPrNarrativeBullet(
  reportDate: string,
  teamId: string,
  teamName: string,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[]
): TeamIntelligenceTeamSummaryBullet {
  const firstItem = evidenceItems[0];
  const contributors = evidenceItems.map((item) => ({
    userId: item.userId,
    userEmail: item.userEmail,
    userName: item.userName,
    role: item.role ?? null,
    contributionNote: `${item.userName} contributed to this delivery`,
  }));
  const uniqueContributors = [...new Map(contributors.map((contributor) => [contributor.userEmail, contributor])).values()];
  const prIdsUsed = [...new Set(evidenceItems.map((item) => item.prId))].sort((left, right) => left - right);
  const repoNames = [...new Set(evidenceItems.map((item) => item.repoName))].sort();
  const contributorNames = uniqueContributors.map((contributor) => contributor.userName);
  const focus = trimSentence(normalizeSummaryText(firstItem.prSummary ?? firstItem.prDescription ?? firstItem.prTitle, 14));
  const improvements = evidenceItems
    .flatMap((item) => item.commitSummaries)
    .map((summary) => trimSentence(normalizeSummaryText(summary, 12)))
    .filter(Boolean)
    .slice(0, 2);
  const improvementText = improvements.length > 0 ? `, with additional refinements in ${formatList(improvements)}` : '';
  const actorText = contributorNames.length > 0 ? formatList(contributorNames) : teamName;
  const repoLabel = formatList(repoNames);
  const repoText = repoLabel ? ` in ${repoLabel}` : ' across core systems';
  const bulletText = normalizeSummaryText(
    `Delivery progressed${repoText} as ${actorText} implemented ${focus}${improvementText}.`,
    SUMMARY_MAX_WORDS
  );

  return {
    bulletId: createStableId({ reportDate, teamId, prIdsUsed, bulletText }),
    reportDate,
    bulletTitle: buildBulletTitle(bulletText),
    bulletText,
    bulletCat: inferBulletCategory(bulletText),
    prIdsUsed,
    repoNames,
    contributors: uniqueContributors,
    confidence: 0.65,
  };
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
    logger.warn('[TEAM-INTEL-TEAM-SUMMARY] LLM call failed, falling back to deterministic summary', {
      error,
    });
    return null;
  }
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

function buildDeterministicBulletFromEvidence(
  input: TeamIntelligenceTeamSummaryInput,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[]
): TeamIntelligenceTeamSummaryBullet[] {
  if (evidenceItems.length === 0) {
    return input.users.map((user) => {
      const directCommits = asArray<TeamIntelligenceCommitInput>(user.soloCommits);
      const highlights = directCommits
        .map((commit) => trimSentence(typeof commit.commitSummary === 'string' ? commit.commitSummary : summarizeCommitMessage(commit.commitMessage)))
        .filter(Boolean)
        .slice(0, 2);
      const bulletText = highlights.length > 0
        ? `${input.teamName} moved work forward outside the PR flow, where ${user.userName} improved ${formatList(highlights)}.`
        : `${input.teamName} had no PR-linked delivery signal on ${input.reportDate}, but ${user.userName} handled direct engineering maintenance work.`;

      return {
        bulletId: createStableId({
          reportDate: input.reportDate,
          teamId: input.teamId,
          userEmail: user.userEmail,
          bulletText,
        }),
        reportDate: input.reportDate,
        bulletTitle: buildBulletTitle(normalizeSummaryText(bulletText, SUMMARY_MAX_WORDS)),
        bulletText,
        bulletCat: inferBulletCategory(normalizeSummaryText(bulletText, SUMMARY_MAX_WORDS)),
        prIdsUsed: [],
        repoNames: [],
        contributors: [
          {
            userId: user.userId,
            userEmail: user.userEmail,
            userName: user.userName,
            role: user.role ?? null,
            contributionNote: highlights.length > 0
              ? `${user.userName} handled direct changes outside PR flow`
              : `${user.userName} handled maintenance work on ${input.reportDate}`,
          },
        ],
        confidence: 0.4,
      };
    }).slice(0, SUMMARY_MAX_LINES);
  }

  const byPr = new Map<number, TeamIntelligenceTeamSummaryEvidenceItem[]>();

  for (const item of evidenceItems) {
    const key = item.prId;
    const existing = byPr.get(key) ?? [];
    existing.push(item);
    byPr.set(key, existing);
  }

  const bullets = [...byPr.values()]
    .sort((left, right) => left[0].prId - right[0].prId)
    .map((items) => buildPrNarrativeBullet(input.reportDate, input.teamId, input.teamName, items));

  return bullets.slice(0, SUMMARY_MAX_LINES);
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
): TeamIntelligenceTeamSummaryBullet[] | null {
  let parsed: RawTeamSummaryResponse;
  try {
    parsed = JSON.parse(rawContent) as RawTeamSummaryResponse;
  } catch (error) {
    logger.warn('[TEAM-INTEL-TEAM-SUMMARY] Failed to parse LLM JSON response', { error });
    return null;
  }

  if (normalizeString(parsed.reportDate, input.reportDate) !== input.reportDate) {
    return null;
  }

  if (normalizeString(parsed.teamName, input.teamName) !== input.teamName) {
    return null;
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

  return bullets.length > 0 ? bullets : null;
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

function enforceTeamBulletWindow(
  input: TeamIntelligenceTeamSummaryInput,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[],
  bullets: TeamIntelligenceTeamSummaryBullet[]
): TeamIntelligenceTeamSummaryBullet[] {
  const concise = bullets.slice(0, SUMMARY_MAX_LINES);
  if (concise.length >= SUMMARY_MIN_LINES) {
    return concise;
  }

  if (concise.length === 1) {
    const repoNames = [...new Set(evidenceItems.map((item) => item.repoName).filter(Boolean))].slice(0, 2);
    const repoLabel = repoNames.length > 0 ? formatList(repoNames) : 'core systems';
    const secondText = normalizeSummaryText(
      `${input.teamName} continued focused delivery in ${repoLabel} during ${input.reportDate}.`,
      SUMMARY_MAX_WORDS
    );
    const primary = concise[0];
    const secondBullet: TeamIntelligenceTeamSummaryBullet = {
      bulletId: createStableId({
        reportDate: input.reportDate,
        teamId: input.teamId,
        bulletText: secondText,
        prIdsUsed: primary.prIdsUsed,
      }),
      reportDate: input.reportDate,
      bulletTitle: buildBulletTitle(secondText),
      bulletText: secondText,
      bulletCat: normalizeBulletCategory(primary.bulletCat, secondText),
      prIdsUsed: primary.prIdsUsed,
      repoNames: primary.repoNames,
      contributors: primary.contributors,
      confidence: 0.5,
    };

    return [primary, secondBullet];
  }

  const defaultText = normalizeSummaryText(
    `${input.teamName} delivered focused engineering updates during ${input.reportDate}.`,
    SUMMARY_MAX_WORDS
  );
  const secondaryText = normalizeSummaryText(
    `${input.teamName} maintained delivery momentum with concise, evidence-based progress updates.`,
    SUMMARY_MAX_WORDS
  );
  const defaultBullet: TeamIntelligenceTeamSummaryBullet = {
    bulletId: createStableId({
      reportDate: input.reportDate,
      teamId: input.teamId,
      bulletText: defaultText,
      prIdsUsed: [],
    }),
    reportDate: input.reportDate,
    bulletTitle: buildBulletTitle(defaultText),
    bulletText: defaultText,
    bulletCat: inferBulletCategory(defaultText),
    prIdsUsed: [],
    repoNames: [],
    contributors: [],
    confidence: 0.4,
  };

  const secondaryBullet: TeamIntelligenceTeamSummaryBullet = {
    bulletId: createStableId({
      reportDate: input.reportDate,
      teamId: input.teamId,
      bulletText: secondaryText,
      prIdsUsed: [],
    }),
    reportDate: input.reportDate,
    bulletTitle: buildBulletTitle(secondaryText),
    bulletText: secondaryText,
    bulletCat: inferBulletCategory(secondaryText),
    prIdsUsed: [],
    repoNames: [],
    contributors: [],
    confidence: 0.4,
  };

  return [defaultBullet, secondaryBullet];
}

class TeamIntelligenceTeamSummaryService {
  private async getDefaultWorkspaceLlmClient(): Promise<LLMClient | null> {
    const credential = await orgLLMCredentialService.getCredentialByWorkspaceId(
      appConfig.defaultWorkspaceId,
      OrgLLMServiceAccountPurpose.DEFAULT,
    );
    if (!credential) {
      return null;
    }

    return new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: credential.apiKey,
          baseUrl: credential.baseUrl,
          timeout: 60000,
        },
      },
      defaultModel: appConfig.workflow.defaultModelName,
    });
  }

  async generate(input: TeamIntelligenceTeamSummaryInput): Promise<TeamIntelligenceTeamSummaryOutput> {
    const evidenceItems = buildTeamEvidenceItems(input);
    const llmClient = await this.getDefaultWorkspaceLlmClient();

    let bullets: TeamIntelligenceTeamSummaryBullet[] | null = null;
    let llmPrimaryCallSucceeded = false;

    if (llmClient && evidenceItems.length > 0) {
      const prompt = buildTeamSummaryPrompt(input, evidenceItems);
      const rawContent = await llmGenerate(llmClient, prompt);
      if (rawContent) {
        llmPrimaryCallSucceeded = true;
        bullets = parseTeamSummaryResponse(rawContent, input, evidenceItems);
      }
    }

    if (!bullets) {
      bullets = buildDeterministicBulletFromEvidence(input, evidenceItems);
    }

    if (llmClient && bullets.length > 0) {
      const rewritten = await llmRewriteTeamBullets(llmClient, input, bullets);
      if (rewritten) {
        bullets = rewritten;
      }
    }

    if (!llmPrimaryCallSucceeded) {
      bullets = enforceTeamBulletWindow(input, evidenceItems, bullets);
    }

    const provenance = buildProvenance(input, evidenceItems, bullets);
    const summaryText = buildSummaryText(bullets, input.teamName);

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: llmClient ? 'team-intelligence-team-summary-llm-v1' : 'team-intelligence-team-summary-v1',
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
