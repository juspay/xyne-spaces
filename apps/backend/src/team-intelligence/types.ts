import type { JsonValue } from '@prisma/client/runtime/library';

export interface TeamIntelligenceCommitInput {
  commitId: string;
  commitMessage: string;
  timestamp: string;
  commitSummary?: string;
  [key: string]: unknown;
}

export interface TeamIntelligenceDiffInput {
  filesChanged: number;
  additions: number;
  deletions: number;
  diffSummary?: string;
  [key: string]: unknown;
}

export interface TeamIntelligencePullRequestInput {
  source: string;
  prId: number;
  prTitle: string;
  prDescription?: string;
  prState: string;
  prUrl: string;
  repoName: string;
  projectName: string;
  mergedAt?: string;
  diff?: TeamIntelligenceDiffInput;
  commits?: TeamIntelligenceCommitInput[];
  prSummary?: string;
  [key: string]: unknown;
}

export interface TeamIntelligenceAiUsageInput {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_spend?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface TeamIntelligenceUserInput {
  userEmail: string;
  userName: string;
  teamId?: string;
  teamName?: string;
  source?: string;
  pullRequests: TeamIntelligencePullRequestInput[];
  soloCommits?: TeamIntelligenceCommitInput[];
  commits?: TeamIntelligenceCommitInput[];
  Commits?: TeamIntelligenceCommitInput[];
  aiUsage?: TeamIntelligenceAiUsageInput | null;
  [key: string]: unknown;
}

export interface TeamIntelligenceSyncRequest {
  reportDate: string;
  users: TeamIntelligenceUserInput[];
  source?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface TeamIntelligenceNormalizedCommit extends TeamIntelligenceCommitInput {
  ingestionId: string;
}

export interface TeamIntelligenceNormalizedPullRequest extends TeamIntelligencePullRequestInput {
  ingestionId: string;
  diff: TeamIntelligenceDiffInput;
  commits: TeamIntelligenceNormalizedCommit[];
}

export interface TeamIntelligenceNormalizedUserRecord {
  userEmail: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  source: string;
  pullRequests: TeamIntelligenceNormalizedPullRequest[];
  soloCommits: TeamIntelligenceNormalizedCommit[];
  aiUsage: TeamIntelligenceAiUsageInput | null;
}

export interface TeamIntelligenceSyncRequestMetadata {
  idempotencyKey: string;
  source: string;
  requestId?: string;
}

export interface TeamIntelligenceQueuedJobData {
  batchId: string;
  userIngestionId: string;
  reportDate: string;
  userEmail: string;
  userName: string;
  teamId: string | null;
  teamName: string | null;
  source: string;
  orgId: string;
}

export interface TeamIntelligenceTeamSummaryQueuedJobData {
  batchId: string;
  teamSummaryId: string;
  reportDate: string;
  teamId: string | null;
  teamName: string;
  source: string;
  orgId: string;
}

export interface TeamIntelligenceOrgSummaryQueuedJobData {
  batchId: string;
  orgSummaryId: string;
  reportDate: string;
  source: string;
  orgId: string;
}

export interface TeamIntelligenceIngestionResponse {
  batchId: string;
  idempotencyKey: string;
  reportDate: string;
  source: string;
  totalUsers: number;
  queuedUsers: number;
  failedUsers: number;
  status: string;
}

export interface TeamIntelligenceTeamSummaryUserInput {
  userId?: string;
  userEmail: string;
  userName: string;
  teamId: string;
  teamName: string;
  role?: string | null;
  source?: string;
  pullRequests: TeamIntelligencePullRequestInput[];
  soloCommits?: TeamIntelligenceCommitInput[];
  aiUsage?: TeamIntelligenceAiUsageInput | null;
  [key: string]: unknown;
}

export interface TeamIntelligenceTeamSummaryInput {
  reportDate: string;
  teamId: string;
  teamName: string;
  source?: string;
  users: TeamIntelligenceTeamSummaryUserInput[];
  [key: string]: unknown;
}

export interface TeamIntelligenceTeamSummaryEvidenceItem {
  reportDate: string;
  teamId: string;
  teamName: string;
  source: string;
  userId?: string;
  userEmail: string;
  userName: string;
  role?: string | null;
  prId: number;
  prTitle: string;
  prDescription?: string | null;
  prSummary?: string | null;
  repoName: string;
  projectName: string;
  prState: string;
  diffSummary?: string | null;
  commitIds: string[];
  commitSummaries: string[];
}

export interface TeamIntelligenceTeamSummaryBulletContributor {
  userId?: string;
  userEmail: string;
  userName: string;
  role?: string | null;
  contributionNote: string;
}

export interface TeamIntelligenceTeamSummaryBullet {
  bulletId: string;
  reportDate: string;
  bulletTitle: string;
  bulletText: string;
  bulletCat: 'shipped' | 'achievement' | 'collaboration' | 'learning' | 'recognition' | 'learned' | 'helped' | 'milestone';
  prIdsUsed: number[];
  repoNames: string[];
  contributors: TeamIntelligenceTeamSummaryBulletContributor[];
  confidence?: number;
}

export interface TeamIntelligenceTeamSummaryProvenance {
  reportDate: string;
  teamId: string;
  teamName: string;
  source: string;
  generatedAt: string;
  bullets: TeamIntelligenceTeamSummaryBullet[];
  prIndex: Record<string, {
    userId?: string;
    userEmail: string;
    userName: string;
    role?: string | null;
    repoName: string;
    projectName: string;
  }>;
}

export interface TeamIntelligenceTeamSummaryOutput {
  reportDate: string;
  teamId: string;
  teamName: string;
  source: string;
  summaryText: string[];
  summaryMetadata: JsonValue;
  provenance: TeamIntelligenceTeamSummaryProvenance;
}

export interface TeamIntelligenceOrgSummaryBullet {
  bulletId: string;
  teamId: string;
  teamName: string;
  reportDate: string;
  bulletTitle: string;
  bulletText: string;
  bulletCat: 'shipped' | 'achievement' | 'collaboration' | 'learning' | 'recognition' | 'learned' | 'helped' | 'milestone';
  sourceTeamBulletIds: string[];
  prIdsUsed: number[];
  repoNames: string[];
  contributors: TeamIntelligenceTeamSummaryBulletContributor[];
  confidence?: number;
}

export interface TeamIntelligenceOrgSummaryProvenance {
  reportDate: string;
  source: string;
  generatedAt: string;
  bulletCount: number;
  teamIndex: Record<string, { teamName: string; bulletCount: number }>;
  bullets: TeamIntelligenceOrgSummaryBullet[];
}

export interface TeamIntelligenceOrgSummaryInput {
  reportDate: string;
  source: string;
  teamSummaries: TeamIntelligenceTeamSummaryOutput[];
}

export interface TeamIntelligenceOrgSummaryOutput {
  reportDate: string;
  source: string;
  summaryText: string[];
  summaryMetadata: JsonValue;
  provenance: TeamIntelligenceOrgSummaryProvenance;
}
