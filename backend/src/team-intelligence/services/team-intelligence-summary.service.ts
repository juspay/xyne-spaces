import type { Prisma } from '@prisma/client';
import { LLMClient } from '@framework';
import { createUserMessage } from '@framework';
import { config as appConfig } from '../../config/env.js';
import { logger } from '@/utils/logger';
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

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function summarizePullRequest(pr: TeamIntelligencePullRequestInput): string {
  const prState = pr.prState?.trim() || 'updated';
  const repoName = pr.repoName?.trim() || 'unknown-repository';
  const projectName = pr.projectName?.trim() || 'unknown-project';
  const commitCount = asArray(pr.commits).length;

  const diffRecord = asObject(pr.diff);
  const filesChanged = toFiniteNumber(diffRecord.filesChanged);
  const additions = toFiniteNumber(diffRecord.additions);
  const deletions = toFiniteNumber(diffRecord.deletions);

  const description = typeof pr.prDescription === 'string' && pr.prDescription.trim()
    ? ` Focus: ${pr.prDescription.trim()}`
    : '';

  return [
    `Implemented ${pr.prTitle} in ${projectName}/${repoName}.`,
    `${prState === 'merged' ? 'The change shipped' : 'The change progressed'} through ${commitCount} commit(s) and ${filesChanged} touched file(s) (${additions}+/${deletions}-).${description}`,
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
  const focus = trimSentence(pr.prDescription?.trim() || pr.prSummary?.trim() || pr.prTitle);
  const highlights = commitSummaries.map(trimSentence).filter(Boolean).slice(0, 2);
  const highlightText = highlights.length > 0
    ? `, improving ${formatList(highlights)}`
    : '';

  return `${userName} implemented ${focus} in ${repoLabel || 'the product'} through ${pr.prTitle}${highlightText}.`;
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

  return [...prBullets, ...(soloBullet ? [soloBullet] : []), ...(scopeBullet ? [scopeBullet] : [])].slice(0, 4);
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
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    }
  } catch {
    // Fall through to plain-text bullet parsing.
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(-|\*|•|\d+\.)\s+/.test(line))
    .map((line) => line.replace(/^(-|\*|•|\d+\.)\s+/, '').trim())
    .filter(Boolean);
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

class TeamIntelligenceSummaryService {
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

  async generate(input: {
    pullRequests: unknown;
    soloCommits: unknown;
    aiUsage: unknown;
    userName: string;
    teamName: string | null;
    reportDate: Date;
  }): Promise<TeamIntelligenceGeneratedSummary> {
    const llmClient = this.llmClient;

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
                  `Summarize this git commit for an engineering manager in one sentence.\nContext PR: ${pr.prTitle}\nCommit message: "${commit.commitMessage}"\nKeep it specific and outcome-focused. Respond with only one sentence.`,
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
              `Summarize this code diff for a manager. Files changed: ${toFiniteNumber(diffRecord.filesChanged)}, additions: ${toFiniteNumber(diffRecord.additions)}, deletions: ${toFiniteNumber(diffRecord.deletions)}.\nPR title: "${pr.prTitle}".\nWrite one concise sentence describing what changed. Respond with only the summary sentence.`,
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
              `Summarize this pull request for a manager in 2 short sentences.\nTitle: "${pr.prTitle}"\nState: ${pr.prState}\nRepo: ${pr.repoName}\nDescription: ${pr.prDescription ?? 'N/A'}\nDiff: ${diffSummary}\nCommit highlights:\n${commitHighlights || '- No commits listed'}\nEmphasize what changed and why it matters. Respond with only the summary text.`,
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
              `Summarize this direct (non-PR) commit for a manager in one sentence.\nCommit message: "${commit.commitMessage}"\nHighlight practical impact. Respond with only one sentence.`,
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
    if (llmClient) {
      const llmText = await llmGenerate(
        llmClient,
        `Create a manager-ready employee summary as a JSON array of 3-4 bullet strings.\nEmployee: ${input.userName}\nTeam: ${input.teamName ?? 'No Team'}\nDate: ${input.reportDate.toISOString().slice(0, 10)}\n\nPull Requests:\n${prBullets || 'None'}\n\nDirect Commits:\n${commitBullets || 'None'}\n\nAI Usage: ${formatAiUsage(aiUsage)}\n\nRequirements:\n- Write subjective, feature-first bullets for a news feed.\n- Say what the engineer implemented, improved, fixed, or enabled.\n- Mention repo or system area when available.\n- Avoid PR counts, token counts, and generic status lines unless there is no other signal.\n- Do not include markdown bullets, just JSON array strings.\nRespond with valid JSON only.`,
      );
      if (llmText) {
        const parsedBullets = extractEmployeeBullets(llmText);
        if (parsedBullets.length > 0) {
          employeeSummary = parsedBullets;
        }
      }
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
