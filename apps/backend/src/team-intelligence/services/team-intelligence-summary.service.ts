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
import { TeamIntelligenceLLMUnavailableError } from '../errors';
import { extractJson } from '../llm-utils';
import { createTeamIntelligenceLlmClient } from './team-intelligence-llm-client';

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
    .replace(/[#>*[\]`*_~-]|\d+\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstSentence = text.split(/[.!?\n]/).find(Boolean) || text;
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords);
  const concise = words.join(' ').replace(/[.,;:]+$/, '').trim();

  return concise ? `${concise}.`.replace(/\.\./g, '.') : '';
}

function extractEmployeeBullets(rawText: string): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(extractJson(trimmed));
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


const LLM_MAX_ATTEMPTS = 3;
const LLM_RETRY_BASE_DELAY_MS = 1000;
// Cap concurrent LLM calls within a single user-summary job. litellm enforces a
// max_parallel_requests limit per api_key; a user with many PRs/commits would
// otherwise fan out dozens of parallel calls and trip the rate limit.
const LLM_MAX_CONCURRENCY = 3;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

function isTransientLLMError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  const message = error.message.toLowerCase();
  // Treat network/timeout/rate-limit style failures as retryable. Everything
  // else (e.g. malformed request) is surfaced immediately.
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

async function sleep(ms: number): Promise<void> {
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
      // Empty response — treat as a transient failure and retry.
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

  logger.error('[TEAM-INTEL-SUMMARY] LLM call failed after retries; no fallback', { error: lastError });
  throw new TeamIntelligenceLLMUnavailableError(
    `LLM summary generation failed after ${LLM_MAX_ATTEMPTS} attempt(s): ${
      lastError instanceof Error ? lastError.message : 'unknown error'
    }`
  );
}

async function llmRewriteEmployeeSummary(
  llmClient: LLMClient,
  input: {
    userName: string;
    teamName: string | null;
    reportDate: Date;
  },
  bullets: string[]
): Promise<string[]> {
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

  let parsed: RawEmployeeBulletRewriteResponse;
  try {
    parsed = JSON.parse(extractJson(raw)) as RawEmployeeBulletRewriteResponse;
  } catch (error) {
    throw new TeamIntelligenceLLMUnavailableError(
      `LLM rewrite response was not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }

  const rewritten = asArray<unknown>(parsed.bullets)
    .map((value) => normalizeSummaryText(normalizeString(value), SUMMARY_MAX_WORDS))
    .filter(Boolean);

  if (rewritten.length === 0) {
    throw new TeamIntelligenceLLMUnavailableError('LLM rewrite returned no usable bullets');
  }

  return rewritten;
}

class TeamIntelligenceSummaryService {
  private async getDefaultWorkspaceLlmClient(): Promise<LLMClient> {
    const llmClient = createTeamIntelligenceLlmClient();
    if (!llmClient) {
      throw new TeamIntelligenceLLMUnavailableError(
        'LITELLM_API_KEY and LITELLM_BASE_URL must be configured for Team Intelligence'
      );
    }
    return llmClient;
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

    // LLM-only enrichment: every commit/diff/PR summary is generated by the LLM.
    // There is no deterministic fallback; if the LLM call fails it throws and the
    // worker marks this user ingestion FAILED (then passes ahead to the team stage).
    const pullRequests: TeamIntelligencePullRequestInput[] = await runWithConcurrency(
      rawPullRequests,
      LLM_MAX_CONCURRENCY,
      async (pr) => {
        const commitItems = asArray<TeamIntelligenceCommitInput>(pr.commits);
        const commits: TeamIntelligenceCommitInput[] = await runWithConcurrency(
          commitItems,
          LLM_MAX_CONCURRENCY,
          async (commit) => {
            const commitSummary = await llmGenerate(
              llmClient,
              `Summarize this git commit for an engineering manager.\nContext PR: ${pr.prTitle}\nCommit message: "${commit.commitMessage}"\nReturn exactly one sentence under 50 words, factual and outcome-focused. Respond with only that sentence.`,
            );
            return { ...commit, commitSummary };
          }
        );

        const diffRecord = asObject(pr.diff);
        const diffSummary = await llmGenerate(
          llmClient,
          `Summarize this code diff for a manager. Files changed: ${toFiniteNumber(diffRecord.filesChanged)}, additions: ${toFiniteNumber(diffRecord.additions)}, deletions: ${toFiniteNumber(diffRecord.deletions)}.\nPR title: "${pr.prTitle}".\nReturn exactly one factual sentence under 50 words. Respond with only the sentence.`,
        );

        const diff: TeamIntelligenceDiffInput = {
          filesChanged: toFiniteNumber(diffRecord.filesChanged),
          additions: toFiniteNumber(diffRecord.additions),
          deletions: toFiniteNumber(diffRecord.deletions),
          diffSummary,
        };

        const commitHighlights = commits
          .map((c) => `- ${c.commitMessage}: ${typeof c.commitSummary === 'string' ? c.commitSummary : ''}`)
          .join('\n');
        const prSummary = await llmGenerate(
          llmClient,
          `Summarize this pull request for a manager in one concise line.\nTitle: "${pr.prTitle}"\nState: ${pr.prState}\nRepo: ${pr.repoName}\nDescription (may contain noisy markdown/checklists): ${pr.prDescription ?? 'N/A'}\nDiff: ${diffSummary}\nCommit highlights:\n${commitHighlights || '- No commits listed'}\nRequirements:\n- Use factual, evidence-based wording only.\n- Prioritize concrete implementation changes and impact.\n- Return exactly one sentence under 50 words.\n- Do not copy markdown headings, checklist items, links, screenshots, or testing sections.\n- If description is verbose, extract only the top concrete change.\n- No speculation or filler.\nRespond with only plain summary text.`,
        );

        return { ...pr, commits, diff, prSummary };
      }
    );

    const soloCommits: TeamIntelligenceCommitInput[] = await runWithConcurrency(
      rawSoloCommits,
      LLM_MAX_CONCURRENCY,
      async (commit) => {
        const commitSummary = await llmGenerate(
          llmClient,
          `Summarize this direct (non-PR) commit for a manager.\nCommit message: "${commit.commitMessage}"\nReturn exactly one sentence under 50 words, highlighting practical impact. Respond with only that sentence.`,
        );
        return { ...commit, commitSummary };
      }
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

    // LLM-only employee summary. No rule-based fallback: if the LLM call fails or
    // returns nothing usable, this throws and the worker fails the job (passing ahead).
    const llmText = await llmGenerate(
      llmClient,
      `Create a manager-ready employee summary as a JSON array of 2-3 bullet strings.\nEmployee: ${input.userName}\nTeam: ${input.teamName ?? 'No Team'}\nDate: ${input.reportDate.toISOString().slice(0, 10)}\n\nPull Requests:\n${prBullets || 'None'}\n\nDirect Commits:\n${commitBullets || 'None'}\n\nAI Usage: ${formatAiUsage(aiUsage)}\n\nSelection strategy (must follow):\n1) Build candidate insights from PR and commit evidence.\n2) Score candidates by impact, specificity, and uniqueness.\n3) Keep top non-overlapping insights only.\n4) If there are more than 3 strong insights, keep the highest-impact 3 (not the first 3).\n\nRequirements:\n- Use factual, evidence-based bullets (not narrative or promotional style).\n- Say exactly what the engineer implemented, improved, fixed, or enabled.\n- Mention repo or system area when available.\n- Keep each bullet to one sentence and under 50 words.\n- Return exactly 2 or 3 bullets only.\n- Prefer concrete delivery outcomes over broad activity statements.\n- Avoid PR counts, token counts, and generic status lines unless there is no other signal.\n- Write in natural, human narration with clean grammar.\n- Do not include ticket IDs, PR IDs, commit hashes, branch names, or conventional-commit prefixes.\n- Never copy PR titles or commit messages verbatim; paraphrase into plain language.\n- Avoid repetitive phrasing and avoid always starting bullets with the employee name.\n- Do not include markdown bullets, just JSON array strings.\nRespond with valid JSON only.`,
    );

    let employeeSummary = extractEmployeeBullets(llmText);
    if (employeeSummary.length === 0) {
      const single = normalizeSummaryText(llmText, SUMMARY_MAX_WORDS);
      if (!single) {
        throw new TeamIntelligenceLLMUnavailableError('LLM employee summary returned no usable bullets');
      }
      employeeSummary = [single];
    }

    employeeSummary = await llmRewriteEmployeeSummary(
      llmClient,
      {
        userName: input.userName,
        teamName: input.teamName,
        reportDate: input.reportDate,
      },
      employeeSummary
    );

    const summaryMetadata: Prisma.InputJsonValue = {
      generator: 'team-intelligence-llm-summary-v1',
      generatedAt: new Date().toISOString(),
      model: appConfig.workflow.defaultModelName,
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
