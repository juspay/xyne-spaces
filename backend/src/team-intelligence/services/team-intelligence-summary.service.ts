import type { Prisma } from '@prisma/client';
import { LLMClient } from '@framework';
import { createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';
import type {
  TeamIntelligenceAiUsageInput,
  TeamIntelligenceCommitInput,
  TeamIntelligenceDiffInput,
  TeamIntelligencePullRequestInput,
} from '../types';

export interface TeamIntelligenceGeneratedSummary {
  pullRequests: Prisma.InputJsonValue;
  soloCommits: Prisma.InputJsonValue;
  employeeSummary: string[];
  summaryMetadata: Prisma.InputJsonValue;
}

interface RawEmployeeBulletRewriteResponse {
  bullets?: unknown;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function normalizeCommitMessageForSummary(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return 'Updated code changes';
  }

  const withoutPrefix = normalized.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '');
  return withoutPrefix || normalized;
}

function summarizeCommitMessage(message: string): string {
  const normalized = normalizeCommitMessageForSummary(message);
  if (!normalized) {
    return 'Updated code changes.';
  }

  const firstSentence = normalized.split(/[.!?]\s/)[0] ?? normalized;
  if (firstSentence.length <= 140) {
    return `${firstSentence.trim()}.`;
  }

  return `${firstSentence.slice(0, 137).trimEnd()}...`;
}

function summarizeDiff(diff: TeamIntelligenceDiffInput | undefined): string {
  if (!diff) {
    return 'Diff details were not provided.';
  }

  const filesChanged = toFiniteNumber(diff.filesChanged);
  const additions = toFiniteNumber(diff.additions);
  const deletions = toFiniteNumber(diff.deletions);

  return `Changed ${filesChanged} file(s) with ${additions} additions and ${deletions} deletions.`;
}

const SUMMARY_MIN_LINES = 3;
const SUMMARY_MAX_LINES = 4;
const SUMMARY_MAX_WORDS = 50;

function normalizeSummaryText(value: string, maxWords = SUMMARY_MAX_WORDS): string {
  if (!value) {
    return '';
  }

  const text = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b:?\s*/g, ' ')
    .replace(/\b(?:feat|fix|chore|refactor|docs|test|perf|style|build|ci|revert)(?:\([^)]+\))?!?:\s*/gi, ' ')
    .replace(/[#>*\-\[\]`*_~]|\d+\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstSentence = text.split(/[.!?\n]/).find(Boolean) || text;
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords);
  const concise = words.join(' ').replace(/[.,;:]+$/, '').trim();

  return concise ? `${concise}.`.replace(/\.\./g, '.') : '';
}

function summarizePullRequest(pr: TeamIntelligencePullRequestInput): string {
  const prState = pr.prState?.trim() || 'updated';
  const repoName = pr.repoName?.trim() || 'unknown-repository';
  const projectName = pr.projectName?.trim() || 'unknown-project';
  const commitCount = asArray(pr.commits).length;

  const diffRecord = asObject(pr.diff);
  const filesChanged = toFiniteNumber(diffRecord.filesChanged);
  const additions = toFiniteNumber(diffRecord.additions);
  const deletions = toFiniteNumber(diffRecord.deletions);

  // Robustly extract a concise summary from prDescription or prSummary or prTitle
  const rawDesc = pr.prDescription?.trim() || pr.prSummary?.trim() || pr.prTitle;
  const conciseDesc = normalizeSummaryText(rawDesc);

  return [
    `Implemented ${conciseDesc} in ${projectName}/${repoName}.`,
    `${prState === 'merged' ? 'The change shipped' : 'The change progressed'} through ${commitCount} commit(s) and ${filesChanged} touched file(s) (${additions}+/${deletions}-).`
  ].join(' ');
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

function buildSubjectivePullRequestBullet(
  userName: string,
  pr: TeamIntelligencePullRequestInput,
  commitSummaries: string[]
): string {
  const repoLabel = [pr.projectName, pr.repoName].filter(Boolean).join('/');
  const focus = trimSentence(normalizeSummaryText(pr.prSummary?.trim() || pr.prDescription?.trim() || pr.prTitle, 14));
  const highlights = commitSummaries.map(trimSentence).filter(Boolean).slice(0, 2);
  const highlightText = highlights.length > 0
    ? `, with refinements in ${formatList(highlights)}`
    : '';
  const target = repoLabel || 'the product';
  const variants = [
    `Delivery in ${target} advanced through ${focus}${highlightText}.`,
    `${focus} was delivered in ${target}${highlightText}.`,
    `Work in ${target} moved forward with ${focus}${highlightText}.`,
    `${userName} moved ${target} forward by delivering ${focus}${highlightText}.`,
  ];

  const variantIndex = Math.abs(pr.prId) % variants.length;
  return variants[variantIndex];
}

function buildSubjectiveSoloCommitBullet(userName: string, commits: TeamIntelligenceCommitInput[]): string | null {
  const highlights = commits
    .map((commit) => trimSentence(typeof commit.commitSummary === 'string' ? commit.commitSummary : summarizeCommitMessage(commit.commitMessage)))
    .filter(Boolean)
    .slice(0, 3);

  if (highlights.length === 0) {
    return null;
  }

  return `${userName} also improved day-to-day engineering flow through direct changes, including ${formatList(highlights)}.`;
}

function buildSubjectiveEmployeeSummary(input: {
  userName: string;
  teamName: string | null;
  pullRequests: TeamIntelligencePullRequestInput[];
  soloCommits: TeamIntelligenceCommitInput[];
}): string[] {
  const prBullets = input.pullRequests.slice(0, 3).map((pr) => {
    const commitSummaries = asArray<TeamIntelligenceCommitInput>(pr.commits)
      .map((commit) => typeof commit.commitSummary === 'string' ? commit.commitSummary : summarizeCommitMessage(commit.commitMessage));
    return buildSubjectivePullRequestBullet(input.userName, pr, commitSummaries);
  });

  const soloBullet = buildSubjectiveSoloCommitBullet(input.userName, input.soloCommits);

  const repoNames = [...new Set(input.pullRequests.map((pr) => pr.repoName).filter(Boolean))];
  const scopeBullet = prBullets.length > 0
    ? `${input.userName} focused ${input.teamName ? `${input.teamName} work` : 'their work'} on ${formatList(repoNames)} and related platform changes during this reporting window.`
    : null;

  return [...prBullets, ...(soloBullet ? [soloBullet] : []), ...(scopeBullet ? [scopeBullet] : [])]
    .map((line) => normalizeSummaryText(line, SUMMARY_MAX_WORDS))
    .filter(Boolean)
    .slice(0, SUMMARY_MAX_LINES);
}

function extractEmployeeBullets(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? normalizeSummaryText(item, SUMMARY_MAX_WORDS) : ''))
        .filter(Boolean);
    }
  } catch {
    // Fall through to plain-text parsing.
  }

  const bulletLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(-|\*|•|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(-|\*|•|\d+\.)\s+/, '').trim())
    .map((line) => normalizeSummaryText(line, SUMMARY_MAX_WORDS))
    .filter(Boolean);

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  return trimmed
    .split(/[\n.!?]+/)
    .map((line) => normalizeSummaryText(line, SUMMARY_MAX_WORDS))
    .filter(Boolean);
}

function enforceEmployeeSummaryWindow(input: {
  userName: string;
  teamName: string | null;
  reportDate: Date;
}, lines: string[]): string[] {
  const concise = lines
    .map((line) => normalizeSummaryText(line, SUMMARY_MAX_WORDS))
    .filter(Boolean)
    .slice(0, SUMMARY_MAX_LINES);

  if (concise.length >= SUMMARY_MIN_LINES) {
    return concise;
  }

  if (concise.length === 1) {
    return [
      concise[0],
      normalizeSummaryText(
        `${input.userName} sustained delivery momentum for ${input.teamName ?? 'the team'} on ${input.reportDate.toISOString().slice(0, 10)}.`,
        SUMMARY_MAX_WORDS
      ),
    ];
  }

  return [
    normalizeSummaryText(
      `${input.userName} delivered focused engineering progress for ${input.teamName ?? 'the team'}.`,
      SUMMARY_MAX_WORDS
    ),
    normalizeSummaryText(
      `Work remained concise, outcome-oriented, and aligned to priorities on ${input.reportDate.toISOString().slice(0, 10)}.`,
      SUMMARY_MAX_WORDS
    ),
  ];
}

function formatAiUsage(aiUsage: TeamIntelligenceAiUsageInput | null): string {
  if (!aiUsage) {
    return 'AI usage data not available.';
  }

  const totalTokens = toFiniteNumber(aiUsage.total_tokens);
  const promptTokens = toFiniteNumber(aiUsage.prompt_tokens);
  const completionTokens = toFiniteNumber(aiUsage.completion_tokens);
  const totalSpend = toFiniteNumber(aiUsage.total_spend);
  const currency = typeof aiUsage.currency === 'string' ? aiUsage.currency : 'USD';

  return `AI usage: ${totalTokens} total tokens (${promptTokens} prompt, ${completionTokens} completion), spend ${totalSpend.toFixed(4)} ${currency}.`;
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
    logger.warn('[TEAM-INTEL-SUMMARY] LLM call failed, falling back to rule-based', { error });
    return null;
  }
}

async function llmRewriteEmployeeSummary(
  llmClient: LLMClient,
  input: {
    userName: string;
    teamName: string | null;
    reportDate: Date;
  },
  bullets: string[]
): Promise<string[] | null> {
  const prompt = [
    'Rewrite employee summary bullets for a manager feed.',
    'Return STRICT JSON only with this shape:',
    '{ "bullets": ["string", "string"] }',
    'Rules:',
    '- Keep the same number of bullets as input.',
    '- Keep each bullet to exactly one sentence under 50 words.',
    '- Use natural, fluent narration with clean grammar.',
    '- Avoid repetitive starts; do not always begin with the employee name.',
    '- Do not include ticket IDs, PR IDs, commit hashes, branch names, or conventional-commit prefixes.',
    '- Do not copy PR titles or commit lines verbatim; paraphrase into plain language.',
    '- Keep factual meaning and concrete engineering outcomes from input bullets.',
    '- No filler or promotional language.',
    `Context employee: ${input.userName}`,
    `Context team: ${input.teamName ?? 'No Team'}`,
    `Context date: ${input.reportDate.toISOString().slice(0, 10)}`,
    'Input bullets:',
    ...bullets.map((bullet, index) => `${index + 1}. ${bullet}`),
  ].join('\n');

  const raw = await llmGenerate(llmClient, prompt);
  if (!raw) {
    return null;
  }

  let parsed: RawEmployeeBulletRewriteResponse;
  try {
    parsed = JSON.parse(raw) as RawEmployeeBulletRewriteResponse;
  } catch {
    return null;
  }

  const rewritten = asArray<unknown>(parsed.bullets)
    .map((value) => normalizeSummaryText(normalizeString(value), SUMMARY_MAX_WORDS))
    .filter(Boolean);

  if (rewritten.length === 0) {
    return null;
  }

  return rewritten;
}

class TeamIntelligenceSummaryService {
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

  async generate(input: {
    pullRequests: unknown;
    soloCommits: unknown;
    aiUsage: unknown;
    userName: string;
    teamName: string | null;
    reportDate: Date;
  }): Promise<TeamIntelligenceGeneratedSummary> {
    const llmClient = await this.getDefaultWorkspaceLlmClient();

    const rawPullRequests = asArray<TeamIntelligencePullRequestInput>(input.pullRequests);
    const rawSoloCommits = asArray<TeamIntelligenceCommitInput>(input.soloCommits);

    // Generate LLM summaries for each commit (in PRs and solo)
    const pullRequests: TeamIntelligencePullRequestInput[] = await Promise.all(
      rawPullRequests.map(async (pr) => {
        const commits: TeamIntelligenceCommitInput[] = await Promise.all(
          asArray<TeamIntelligenceCommitInput>(pr.commits).map(async (commit) => {
            const fallback = summarizeCommitMessage(commit.commitMessage?.toString() ?? '');
            const existingSummary = typeof commit.commitSummary === 'string' ? commit.commitSummary.trim() : '';
            const commitSummary = llmClient
              ? (await llmGenerate(
                  llmClient,
                  `Summarize this git commit for an engineering manager.\nContext PR: ${pr.prTitle}\nCommit message: "${commit.commitMessage}"\nReturn exactly one sentence under 50 words, factual and outcome-focused. Respond with only that sentence.`,
                )) ?? fallback
              : (existingSummary || fallback);
            return { ...commit, commitSummary };
          })
        );

        const diffRecord = asObject(pr.diff);
        const fallbackDiffSummary = summarizeDiff(pr.diff);
        const diffSummary = llmClient
          ? (await llmGenerate(
              llmClient,
              `Summarize this code diff for a manager. Files changed: ${toFiniteNumber(diffRecord.filesChanged)}, additions: ${toFiniteNumber(diffRecord.additions)}, deletions: ${toFiniteNumber(diffRecord.deletions)}.\nPR title: "${pr.prTitle}".\nReturn exactly one factual sentence under 50 words. Respond with only the sentence.`,
            )) ?? fallbackDiffSummary
          : fallbackDiffSummary;

        const diff: TeamIntelligenceDiffInput = {
          filesChanged: toFiniteNumber(diffRecord.filesChanged),
          additions: toFiniteNumber(diffRecord.additions),
          deletions: toFiniteNumber(diffRecord.deletions),
          diffSummary,
        };

        const fallbackPrSummary = summarizePullRequest(pr);
        const commitHighlights = commits
          .map((c) => `- ${c.commitMessage}: ${typeof c.commitSummary === 'string' ? c.commitSummary : ''}`)
          .join('\n');
        const prSummary = llmClient
          ? (await llmGenerate(
              llmClient,
              `Summarize this pull request for a manager in one concise line.\nTitle: "${pr.prTitle}"\nState: ${pr.prState}\nRepo: ${pr.repoName}\nDescription (may contain noisy markdown/checklists): ${pr.prDescription ?? 'N/A'}\nDiff: ${diffSummary}\nCommit highlights:\n${commitHighlights || '- No commits listed'}\nRequirements:\n- Use factual, evidence-based wording only.\n- Prioritize concrete implementation changes and impact.\n- Return exactly one sentence under 50 words.\n- Do not copy markdown headings, checklist items, links, screenshots, or testing sections.\n- If description is verbose, extract only the top concrete change.\n- No speculation or filler.\nRespond with only plain summary text.`,
            )) ?? fallbackPrSummary
          : fallbackPrSummary;

        return { ...pr, commits, diff, prSummary };
      })
    );

    const soloCommits: TeamIntelligenceCommitInput[] = await Promise.all(
      rawSoloCommits.map(async (commit) => {
        const fallback = summarizeCommitMessage(commit.commitMessage?.toString() ?? '');
        const existingSummary = typeof commit.commitSummary === 'string' ? commit.commitSummary.trim() : '';
        const commitSummary = llmClient
          ? (await llmGenerate(
              llmClient,
              `Summarize this direct (non-PR) commit for a manager.\nCommit message: "${commit.commitMessage}"\nReturn exactly one sentence under 50 words, highlighting practical impact. Respond with only that sentence.`,
            )) ?? fallback
          : (existingSummary || fallback);
        return { ...commit, commitSummary };
      })
    );

    const mergedPrCount = pullRequests.filter((pr) => (pr.prState || '').toLowerCase() === 'merged').length;
    const openPrCount = pullRequests.filter((pr) => (pr.prState || '').toLowerCase() === 'open').length;
    const directCommitCount = soloCommits.length;
    const totalCommitCount = pullRequests.reduce(
      (accumulator, pr) => accumulator + asArray(pr.commits).length,
      0
    ) + directCommitCount;

    const aiUsage = (input.aiUsage && typeof input.aiUsage === 'object')
      ? (input.aiUsage as TeamIntelligenceAiUsageInput)
      : null;

    const prBullets = pullRequests
      .map((pr) => `- ${pr.prTitle} (${pr.prState}): ${pr.prSummary}`)
      .join('\n');
    const commitBullets = soloCommits
      .map((c) => `- ${c.commitMessage}: ${c.commitSummary}`)
      .join('\n');

    const fallbackEmployeeSummary = buildSubjectiveEmployeeSummary({
      userName: input.userName,
      teamName: input.teamName,
      pullRequests,
      soloCommits,
    });

    const completeFallbackEmployeeSummary = fallbackEmployeeSummary.length > 0
      ? fallbackEmployeeSummary
      : [
          `${input.userName} kept ${input.teamName ?? 'their team'} moving with ${totalCommitCount} code change(s) on ${input.reportDate.toISOString().slice(0, 10)}.`,
          `This included ${mergedPrCount} merged PR(s), ${openPrCount} open PR(s), and ${directCommitCount} direct commit(s).`,
        ];

    let employeeSummary: string[] = completeFallbackEmployeeSummary;
    let llmPrimaryCallSucceeded = false;
    if (llmClient) {
      const llmText = await llmGenerate(
        llmClient,
        `Create a manager-ready employee summary as a JSON array of 2-3 bullet strings.\nEmployee: ${input.userName}\nTeam: ${input.teamName ?? 'No Team'}\nDate: ${input.reportDate.toISOString().slice(0, 10)}\n\nPull Requests:\n${prBullets || 'None'}\n\nDirect Commits:\n${commitBullets || 'None'}\n\nAI Usage: ${formatAiUsage(aiUsage)}\n\nSelection strategy (must follow):\n1) Build candidate insights from PR and commit evidence.\n2) Score candidates by impact, specificity, and uniqueness.\n3) Keep top non-overlapping insights only.\n4) If there are more than 3 strong insights, keep the highest-impact 3 (not the first 3).\n\nRequirements:\n- Use factual, evidence-based bullets (not narrative or promotional style).\n- Say exactly what the engineer implemented, improved, fixed, or enabled.\n- Mention repo or system area when available.\n- Keep each bullet to one sentence and under 50 words.\n- Return exactly 2 or 3 bullets only.\n- Prefer concrete delivery outcomes over broad activity statements.\n- Avoid PR counts, token counts, and generic status lines unless there is no other signal.\n- Write in natural, human narration with clean grammar.\n- Do not include ticket IDs, PR IDs, commit hashes, branch names, or conventional-commit prefixes.\n- Never copy PR titles or commit messages verbatim; paraphrase into plain language.\n- Avoid repetitive phrasing and avoid always starting bullets with the employee name.\n- Do not include markdown bullets, just JSON array strings.\nRespond with valid JSON only.`,
      );
      if (llmText) {
        llmPrimaryCallSucceeded = true;
        const parsedBullets = extractEmployeeBullets(llmText);
        if (parsedBullets.length > 0) {
          employeeSummary = parsedBullets;
        } else {
          employeeSummary = [normalizeSummaryText(llmText, SUMMARY_MAX_WORDS)].filter(Boolean);
        }
      }

      const rewrittenEmployeeSummary = await llmRewriteEmployeeSummary(
        llmClient,
        {
          userName: input.userName,
          teamName: input.teamName,
          reportDate: input.reportDate,
        },
        employeeSummary
      );
      if (rewrittenEmployeeSummary) {
        employeeSummary = rewrittenEmployeeSummary;
      }
    }

    if (!llmPrimaryCallSucceeded) {
      employeeSummary = enforceEmployeeSummaryWindow(
        {
          userName: input.userName,
          teamName: input.teamName,
          reportDate: input.reportDate,
        },
        employeeSummary
      );
    }

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: llmClient ? 'team-intelligence-llm-summary-v1' : 'team-intelligence-summary-v1',
      generatedAt: new Date().toISOString(),
      model: llmClient ? appConfig.workflow.defaultModelName : null,
      metrics: {
        pullRequestCount: pullRequests.length,
        mergedPullRequestCount: mergedPrCount,
        openPullRequestCount: openPrCount,
        directCommitCount,
        totalCommitCount,
      },
      hasAiUsage: aiUsage !== null,
    };

    return {
      pullRequests: pullRequests as unknown as Prisma.InputJsonValue,
      soloCommits: soloCommits as unknown as Prisma.InputJsonValue,
      employeeSummary,
      summaryMetadata,
    };
  }
}

export const teamIntelligenceSummaryService = new TeamIntelligenceSummaryService();
