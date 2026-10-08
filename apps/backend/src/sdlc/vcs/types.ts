import type {
  CreateSdlcPullRequestInput,
  CreateSdlcVcsCredentialInput,
  UpdateSdlcVcsCredentialInput,
} from '@xyne/shared';
import type { SdlcActor } from '../types';

export type VcsProvider = 'GITHUB' | 'BITBUCKET_SERVER';
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
  host: string;
  /** GitHub owner, or Bitbucket project key. */
  owner: string;
  name: string;
  canonicalUrl: string;
  cloneUrl: string;
}

export interface ValidatedCredential {
  identityLogin: string;
  accountName: string;
  accountEmail: string;
}

export interface RepositoryReach {
  repositoryOwner: string | null;
  repositoryCount: number | null;
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

export interface PullRequestInput {
  owner: string;
  repository: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface PullRequestResult {
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

export interface VcsProviderAdapter {
  readonly provider: VcsProvider;
  parseRepositoryUrl(url: string): ParsedRepository;
  validateCredential(token: string): Promise<ValidatedCredential>;
  repositoryReach(token: string): Promise<RepositoryReach>;
  searchRepositories(token: string, query: string, limit: number): Promise<ParsedRepository[]>;
  inspectRepository(input: {
    repository: ParsedRepository;
    baseBranch?: string;
    token?: string;
  }): Promise<RepositoryInspection>;
  buildGitAuthentication(credential: { token: string; identityLogin: string | null }): GitAuthentication;
  createPullRequest(token: string, input: PullRequestInput): Promise<PullRequestResult>;
  inspectPullRequest(
    token: string,
    repository: ParsedRepository,
    number: number
  ): Promise<PullRequestInspection>;
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
  createCredential(actor: SdlcActor, input: CreateSdlcVcsCredentialInput): Promise<unknown>;
  updateCredential(
    actor: SdlcActor,
    credentialId: string,
    input: UpdateSdlcVcsCredentialInput
  ): Promise<unknown>;
  revalidateCredential(actor: SdlcActor, credentialId: string): Promise<unknown>;
  deleteCredential(actor: SdlcActor, credentialId: string): Promise<void>;
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
  createPullRequest(input: CreateSdlcPullRequestInput): Promise<PullRequestResult>;
  inspectPullRequest(repoId: string, number: number): Promise<PullRequestInspection>;
  resolveBaseBranchHead(repoId: string): Promise<string>;
  listBaseBranchFirstParentHistory(repoId: string): Promise<FirstParentHistory>;
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
