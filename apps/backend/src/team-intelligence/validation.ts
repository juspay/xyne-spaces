// NOTE: All schemas use .passthrough() to allow unknown fields from Mettle and other sources.
// This is intentional for backward compatibility: if Mettle adds new fields, they will not break validation here.
// Remove .passthrough() if you want strict validation and to reject unknown fields.

import { z } from 'zod';

export interface TeamIntelligencePayloadValidationError {
  fieldName: string;
  fieldPath: string;
  code: z.ZodIssueCode;
  message: string;
  expected?: string;
  received?: string;
}

function formatValidationPath(path: (string | number)[]): string {
  if (path.length === 0) return '$';

  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    return formatted ? `${formatted}.${segment}` : segment;
  }, '');
}

/**
 * Preserve complete nested Zod paths for ingestion logs. ZodError.flatten()
 * groups nested failures under their top-level field (for example `users`),
 * which makes malformed Mettle records difficult to locate.
 */
export function formatTeamIntelligenceValidationErrors(
  issues: z.ZodIssue[]
): TeamIntelligencePayloadValidationError[] {
  return issues.map((issue) => {
    const fieldPath = formatValidationPath(issue.path);
    const fieldName = String(issue.path.at(-1) ?? '$');
    const formatted: TeamIntelligencePayloadValidationError = {
      fieldName,
      fieldPath,
      code: issue.code,
      message: issue.message,
    };

    if (issue.code === z.ZodIssueCode.invalid_type) {
      formatted.expected = issue.expected;
      formatted.received = issue.received;
    }

    return formatted;
  });
}

const TeamIntelligenceCommitSchema = z.object({
  commitId: z.string().min(1),
  commitMessage: z.string().min(1),
  timestamp: z.string().min(1),
  commitSummary: z.string().optional(),
}).passthrough();

const TeamIntelligenceDiffSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  diffSummary: z.string().optional(),
}).passthrough();

const TeamIntelligencePullRequestSchema = z.object({
  source: z.string().min(1),
  prId: z.number().int().nonnegative(),
  prTitle: z.string().min(1),
  prDescription: z.string().optional(),
  prState: z.string().min(1),
  prUrl: z.string().min(1),
  repoName: z.string().min(1),
  projectName: z.string().min(1),
  mergedAt: z.string().optional(),
  diff: TeamIntelligenceDiffSchema.optional(),
  commits: z.array(TeamIntelligenceCommitSchema).default([]),
  prSummary: z.string().optional(),
}).passthrough();

const TeamIntelligenceAiUsageSchema = z.object({
  total_tokens: z.number().nonnegative().optional(),
  prompt_tokens: z.number().nonnegative().optional(),
  completion_tokens: z.number().nonnegative().optional(),
  total_spend: z.number().nonnegative().optional(),
  currency: z.string().optional(),
}).passthrough();

const TeamIntelligenceUserSchema = z.object({
  userEmail: z.string().email(),
  userName: z.string().min(1),
  teamId: z.string().optional(),
  teamName: z.string().optional(),
  source: z.string().optional(),
  pullRequests: z.array(TeamIntelligencePullRequestSchema).default([]),
  soloCommits: z.array(TeamIntelligenceCommitSchema).optional(),
  commits: z.array(TeamIntelligenceCommitSchema).optional(),
  Commits: z.array(TeamIntelligenceCommitSchema).optional(),
  aiUsage: TeamIntelligenceAiUsageSchema.nullable().optional(),
}).passthrough();

export const TeamIntelligenceSyncRequestSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reportDate must be in YYYY-MM-DD format'),
  users: z.array(TeamIntelligenceUserSchema).min(1, 'users must contain at least one record'),
  source: z.string().optional(),
  requestId: z.string().optional(),
}).passthrough();
