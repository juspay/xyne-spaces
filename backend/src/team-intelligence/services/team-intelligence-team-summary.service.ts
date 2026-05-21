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

interface RawTeamSummaryBullet {
  bulletText?: unknown;
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

function buildPrNarrativeBullet(
  reportDate: string,
  teamName: string,
  evidenceItems: TeamIntelligenceTeamSummaryEvidenceItem[]
): TeamIntelligenceTeamSummaryBullet {
  const firstItem = evidenceItems[0];
  const contributors = evidenceItems.map((item) => ({
    userId: item.userId,
    userEmail: item.userEmail,
    userName: item.userName,
    role: item.role ?? null,
    contributionNote: `${item.userName} helped deliver ${firstItem.prTitle}`,
  }));
  const uniqueContributors = [...new Map(contributors.map((contributor) => [contributor.userEmail, contributor])).values()];
  const prIdsUsed = [...new Set(evidenceItems.map((item) => item.prId))].sort((left, right) => left - right);
  const repoNames = [...new Set(evidenceItems.map((item) => item.repoName))].sort();
  const contributorNames = uniqueContributors.map((contributor) => contributor.userName);
  const focus = trimSentence(firstItem.prDescription ?? firstItem.prSummary ?? firstItem.prTitle);
  const improvements = evidenceItems
    .flatMap((item) => item.commitSummaries)
    .map(trimSentence)
    .filter(Boolean)
    .slice(0, 2);
  const improvementText = improvements.length > 0 ? `, improving ${formatList(improvements)}` : '';
  const actorText = contributorNames.length > 0 ? formatList(contributorNames) : teamName;
  const repoLabel = formatList(repoNames);
  const bulletText = `${teamName} shipped ${focus} in ${repoLabel}, where ${actorText} helped deliver ${firstItem.prTitle}${improvementText}.`;

  return {
    bulletId: createStableId({ reportDate, teamName, prIdsUsed, bulletText }),
    reportDate,
    bulletText,
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
    '{ "reportDate": "YYYY-MM-DD", "teamName": "string", "bullets": [ { "bulletId": "string", "bulletText": "string", "reportDate": "YYYY-MM-DD", "prIdsUsed": [1,2], "repoNames": ["repo-a"], "contributors": [ { "userId": "string|null", "userEmail": "string", "userName": "string", "role": "string|null", "contributionNote": "string" } ], "confidence": 0.0 } ] }',
    'Rules:',
    '- Every bullet must reference at least one PR id from the input evidence.',
    '- Every prIdUsed must exist in the evidence set.',
    '- contributors must only contain users from the input evidence.',
    '- Include the reportDate in every bullet.',
    '- Write subjective, feature-first bullets for a news feed.',
    '- Explain what the team shipped, improved, fixed, or enabled.',
    '- Mention the repo or system area and name the contributors naturally.',
    '- Do not say only that somebody contributed to N PRs.',
    `Context reportDate: ${input.reportDate}`,
    `Context teamName: ${input.teamName}`,
    `Context source: ${input.source ?? 'mettle'}`,
    'Evidence items:',
    ...evidenceItems.map((item) => JSON.stringify({
      reportDate: item.reportDate,
      teamName: item.teamName,
      source: item.source,
      userId: item.userId ?? null,
      userEmail: item.userEmail,
      userName: item.userName,
      role: item.role ?? null,
      prId: item.prId,
      prTitle: item.prTitle,
      prDescription: item.prDescription,
      prSummary: item.prSummary,
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
          teamName: input.teamName,
          userEmail: user.userEmail,
          bulletText,
        }),
        reportDate: input.reportDate,
        bulletText,
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
    });
  }

  const byPr = new Map<number, TeamIntelligenceTeamSummaryEvidenceItem[]>();

  for (const item of evidenceItems) {
    const key = item.prId;
    const existing = byPr.get(key) ?? [];
    existing.push(item);
    byPr.set(key, existing);
  }

  return [...byPr.values()]
    .sort((left, right) => left[0].prId - right[0].prId)
    .map((items) => buildPrNarrativeBullet(input.reportDate, input.teamName, items));
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

      const bulletText = normalizeString(bullet.bulletText);
      if (!bulletText) {
        return null;
      }

      const repoNames = asArray<unknown>(bullet.repoNames)
        .map((value) => normalizeString(value))
        .filter(Boolean);

      const normalizedBullet: TeamIntelligenceTeamSummaryBullet = {
        bulletId: createStableId({
          reportDate: input.reportDate,
          teamName: input.teamName,
          bulletText,
          prIdsUsed,
        }),
        reportDate: input.reportDate,
        bulletText,
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

  async generate(input: TeamIntelligenceTeamSummaryInput): Promise<TeamIntelligenceTeamSummaryOutput> {
    const evidenceItems = buildTeamEvidenceItems(input);
    const llmClient = this.llmClient;

    let bullets: TeamIntelligenceTeamSummaryBullet[] | null = null;

    if (llmClient && evidenceItems.length > 0) {
      const prompt = buildTeamSummaryPrompt(input, evidenceItems);
      const rawContent = await llmGenerate(llmClient, prompt);
      if (rawContent) {
        bullets = parseTeamSummaryResponse(rawContent, input, evidenceItems);
      }
    }

    if (!bullets) {
      bullets = buildDeterministicBulletFromEvidence(input, evidenceItems);
    }

    const provenance = buildProvenance(input, evidenceItems, bullets);
    const summaryText = buildSummaryText(bullets, input.teamName);

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: llmClient ? 'team-intelligence-team-summary-llm-v1' : 'team-intelligence-team-summary-v1',
      generatedAt: provenance.generatedAt,
      reportDate: input.reportDate,
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
      teamName: input.teamName,
      source: input.source ?? 'mettle',
      summaryText,
      summaryMetadata: summaryMetadata as unknown as TeamIntelligenceTeamSummaryOutput['summaryMetadata'],
      provenance,
    };
  }
}

export const teamIntelligenceTeamSummaryService = new TeamIntelligenceTeamSummaryService();