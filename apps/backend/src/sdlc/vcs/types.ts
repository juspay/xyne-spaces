import type { SdlcActor } from '../types';

export type VcsProvider = 'GITHUB';
export type VcsCapability = 'READ_REPOSITORY' | 'PUSH_BRANCH' | 'CREATE_PULL_REQUEST';
export type CapabilityState =
  | 'PROVEN'
  | 'INFERRED'
  | 'REQUIRED'
  | 'UNAVAILABLE'
  | 'STALE'
  | 'RUNTIME_FAILED';

export type RepositoryVisibility = 'PUBLIC' | 'PRIVATE' | 'INTERNAL';

export interface CapabilityEvidence {
  capability: VcsCapability;
  state: CapabilityState;
  source: string;
  detail: string;
  visibility?: RepositoryVisibility;
}

export interface ParsedRepository {
  provider: VcsProvider;
  owner: string;
  name: string;
  canonicalUrl: string;
  cloneUrl: string;
}

export interface ValidatedCredential {
  identityLogin: string;
  resourceOwner: string;
}

export interface RepositoryInspection {
  repository: ParsedRepository;
  visibility: RepositoryVisibility;
  defaultBranch: string;
  identityLogin: string | null;
  capabilities: CapabilityEvidence[];
  evidence: Record<string, unknown>;
}

export interface GitAuthentication {
  username: string;
  password: string;
}

export interface DraftPullRequestInput {
  owner: string;
  repository: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface DraftPullRequestResult {
  url: string;
  number: number;
  draft: boolean;
  head: string;
  base: string;
}

export interface PullRequestInspection {
  url: string;
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  draft: boolean;
  head: string;
  base: string;
  numberOfComments: number;
}

export interface FirstParentCommitIdentity {
  sha: string;
  parentSha: string | null;
}

export interface FirstParentHistory {
  targetHeadSha: string;
  commits: FirstParentCommitIdentity[];
}

export interface SourceLineRange {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface VcsProviderAdapter {
  readonly provider: VcsProvider;
  parseRepositoryUrl(url: string): ParsedRepository;
  validateCredential(token: string, resourceOwner: string): Promise<ValidatedCredential>;
  inspectRepository(input: {
    repository: ParsedRepository;
    baseBranch?: string;
    token?: string;
  }): Promise<RepositoryInspection>;
  buildGitAuthentication(token: string): GitAuthentication;
  createDraftPullRequest(
    token: string,
    input: DraftPullRequestInput
  ): Promise<DraftPullRequestResult>;
  inspectPullRequest(
    token: string,
    repository: ParsedRepository,
    number: number
  ): Promise<PullRequestInspection>;
  verifyRemoteCommit(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string,
    commitHash: string
  ): Promise<void>;
  resolveBranchHead(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string
  ): Promise<string>;
  listFirstParentHistory(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string
  ): Promise<FirstParentHistory>;
  verifyPathsAtCommit(
    token: string | undefined,
    repository: ParsedRepository,
    commitHash: string,
    paths: string[]
  ): Promise<void>;
  verifySourceRangesAtCommit(
    token: string | undefined,
    repository: ParsedRepository,
    commitHash: string,
    references: SourceLineRange[]
  ): Promise<void>;
  validatePullRequestUrl(repository: ParsedRepository, url: string): boolean;
}

export type RepositoryAccessStatus = 'NOT_CHECKED' | 'READY' | 'BLOCKED' | 'ERROR';

export interface RepositoryAccessCheckResult {
  status: RepositoryAccessStatus;
  errorMessage: string | null;
  capabilities: CapabilityEvidence[];
}

export interface SdlcVcs {
  listCredentials(actor: SdlcActor): Promise<unknown[]>;
  configureCredential(
    actor: SdlcActor,
    provider: VcsProvider,
    input: { token: string; resourceOwner: string }
  ): Promise<unknown>;
  revalidateCredential(actor: SdlcActor, provider: VcsProvider): Promise<unknown>;
  disconnectCredential(actor: SdlcActor, provider: VcsProvider): Promise<void>;
  checkRepositoryAccess(
    actor: SdlcActor,
    repoId: string,
    options?: { force?: boolean }
  ): Promise<RepositoryAccessCheckResult>;
  markRuntimeFailure(
    repoId: string,
    operation: 'CLONE' | 'PUSH' | 'CREATE_PULL_REQUEST',
    error: string
  ): Promise<void>;
  requireCapabilities(
    actor: SdlcActor,
    repoId: string,
    capabilities: VcsCapability[]
  ): Promise<void>;
  createDraftPullRequest(input: {
    repoId: string;
    title: string;
    body: string;
    head: string;
    base: string;
    commitHash: string;
  } & (
    | { executionId: string; sessionId: string }
    | { interactiveGrant: string; conversationId: string }
  )):
    Promise<DraftPullRequestResult>;
  inspectPullRequest(repoId: string, number: number): Promise<PullRequestInspection>;
  resolveBaseBranchHead(repoId: string): Promise<string>;
  listBaseBranchFirstParentHistory(repoId: string): Promise<FirstParentHistory>;
  verifyBaseBranchHead(repoId: string, commitHash: string): Promise<void>;
  verifySourcePaths(repoId: string, commitHash: string, paths: string[]): Promise<void>;
  verifySourceRanges(
    repoId: string,
    commitHash: string,
    references: SourceLineRange[]
  ): Promise<void>;
}

export class VcsProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false
  ) {
    super(message);
  }
}
