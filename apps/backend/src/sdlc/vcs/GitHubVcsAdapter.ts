import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type {
  DraftPullRequestInput,
  DraftPullRequestResult,
  FirstParentHistory,
  GitAuthentication,
  ParsedRepository,
  PullRequestInspection,
  RepositoryInspection,
  RepositoryVisibility,
  SourceLineRange,
  ValidatedCredential,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';

const execFileAsync = promisify(execFile);
const API_URL = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const GIT_HISTORY_TIMEOUT_MS = 5 * 60_000;
const GIT_HISTORY_MAX_BUFFER = 64 * 1024 * 1024;

interface GitHubVcsAdapterDependencies {
  runGit(
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }
  ): Promise<{ stdout: string }>;
  makeTempDirectory(prefix: string): Promise<string>;
  removeTempDirectory(path: string): Promise<void>;
}

const defaultDependencies: GitHubVcsAdapterDependencies = {
  async runGit(args, options) {
    const result = await execFileAsync('git', args, options);
    return { stdout: String(result.stdout) };
  },
  makeTempDirectory: mkdtemp,
  async removeTempDirectory(path) {
    await rm(path, { recursive: true, force: true });
  },
};

interface GitHubRepositoryResponse {
  name?: string;
  owner?: { login?: string };
  private?: boolean;
  visibility?: string;
  default_branch?: string;
  permissions?: {
    pull?: boolean;
    push?: boolean;
    admin?: boolean;
    maintain?: boolean;
    triage?: boolean;
  };
}

export class GitHubVcsAdapter implements VcsProviderAdapter {
  readonly provider = 'GITHUB' as const;

  constructor(
    private readonly dependencies: GitHubVcsAdapterDependencies = defaultDependencies
  ) {}

  parseRepositoryUrl(raw: string): ParsedRepository {
    let value = raw.trim();
    const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (ssh) value = `https://github.com/${ssh[1]}/${ssh[2]}`;
    // Older SDLC workspaces store their canonical repository identity without
    // a scheme (github.com/owner/repo). Accept that internal representation at
    // this boundary and normalize it to the same HTTPS identity as new records.
    if (/^github\.com\//i.test(value)) value = `https://${value}`;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new VcsProviderError(
        'INVALID_REPOSITORY_URL',
        'Enter a valid GitHub.com repository URL',
        400
      );
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new VcsProviderError(
        'UNSUPPORTED_REPOSITORY_HOST',
        'v1 supports GitHub.com HTTPS URLs only',
        400
      );
    }
    const segments = url.pathname
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (segments.length !== 2 || segments.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
      throw new VcsProviderError(
        'INVALID_REPOSITORY_URL',
        'Enter a GitHub.com owner/repository URL',
        400
      );
    }
    const [owner, name] = segments as [string, string];
    return {
      provider: 'GITHUB',
      owner,
      name,
      canonicalUrl: `https://github.com/${owner.toLowerCase()}/${name.toLowerCase()}`,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
    };
  }

  async validateCredential(token: string, resourceOwner: string): Promise<ValidatedCredential> {
    const identity = await this.request<{ login?: string }>('/user', token);
    if (!identity.login) {
      throw new VcsProviderError(
        'GITHUB_IDENTITY_INVALID',
        'GitHub did not return an authenticated identity',
        502
      );
    }
    await this.request(`/users/${encodeURIComponent(resourceOwner)}`, token);
    return { identityLogin: identity.login, resourceOwner };
  }

  async inspectRepository(input: {
    repository: ParsedRepository;
    baseBranch?: string;
    token?: string;
  }): Promise<RepositoryInspection> {
    const { repository, token } = input;
    const repo = await this.request<GitHubRepositoryResponse>(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      token
    );
    const baseBranch = input.baseBranch || repo.default_branch;
    if (!baseBranch) {
      throw new VcsProviderError(
        'GITHUB_DEFAULT_BRANCH_MISSING',
        'Repository has no default branch',
        409
      );
    }
    await this.request(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/branches/${encodeURIComponent(baseBranch)}`,
      token
    );
    const canPush = token ? repo.permissions?.push === true : false;
    const visibility: RepositoryVisibility =
      repo.visibility === 'internal' ? 'INTERNAL' : repo.private === true ? 'PRIVATE' : 'PUBLIC';
    return {
      repository: {
        ...repository,
        owner: repo.owner?.login || repository.owner,
        name: repo.name || repository.name,
      },
      visibility,
      defaultBranch: baseBranch,
      identityLogin: token ? 'credential' : null,
      capabilities: [
        {
          capability: 'READ_REPOSITORY',
          state: 'PROVEN',
          source: token ? 'github-api-authenticated' : 'github-api-anonymous',
          // GET /branches/{branch} needs Contents:read, the same grant a clone needs,
          // which is why no git ls-remote probe is required here.
          detail: `Read and branch ${baseBranch} verified without remote mutation`,
          visibility,
        },
        {
          capability: 'PUSH_BRANCH',
          state: canPush ? 'INFERRED' : 'UNAVAILABLE',
          source: token ? 'github-repository-permissions' : 'anonymous',
          detail: canPush
            ? 'GitHub reports push permission; no write was attempted'
            : 'No direct push permission reported',
        },
        {
          capability: 'CREATE_PULL_REQUEST',
          state: canPush ? 'INFERRED' : 'UNAVAILABLE',
          source: 'github-required-permission',
          detail: canPush
            ? 'Pull requests: write is required and will be proven only at runtime'
            : 'Draft pull request creation needs an authenticated writable branch',
        },
      ],
      evidence: {
        apiRead: true,
        configuredBaseBranch: baseBranch,
        githubPushPermission: repo.permissions?.push === true,
        pullRequestPermissionProof: 'INFERRED_REQUIRED',
      },
    };
  }

  buildGitAuthentication(token: string): GitAuthentication {
    return { username: 'x-access-token', password: token };
  }

  async createDraftPullRequest(
    token: string,
    input: DraftPullRequestInput
  ): Promise<DraftPullRequestResult> {
    const result = await this.request<{
      html_url?: string;
      number?: number;
      draft?: boolean;
      head?: { ref?: string };
      base?: { ref?: string };
    }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
          draft: true,
        }),
      }
    );
    if (!result.html_url || typeof result.number !== 'number') {
      throw new VcsProviderError(
        'GITHUB_PULL_REQUEST_INVALID_RESPONSE',
        'GitHub returned an invalid pull request response',
        502
      );
    }
    return {
      url: result.html_url,
      number: result.number,
      draft: result.draft === true,
      head: result.head?.ref || input.head,
      base: result.base?.ref || input.base,
    };
  }

  async inspectPullRequest(
    token: string,
    repository: ParsedRepository,
    number: number
  ): Promise<PullRequestInspection> {
    const result = await this.request<{
      html_url?: string;
      number?: number;
      state?: string;
      merged_at?: string | null;
      draft?: boolean;
      comments?: number;
      review_comments?: number;
      head?: { ref?: string };
      base?: { ref?: string };
    }>(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls/${number}`,
      token
    );
    if (!result.html_url || result.number !== number) {
      throw new VcsProviderError(
        'GITHUB_PULL_REQUEST_INVALID_RESPONSE',
        'GitHub returned an invalid pull request response',
        502
      );
    }
    return {
      url: result.html_url,
      number,
      state: result.merged_at ? 'MERGED' : result.state === 'open' ? 'OPEN' : 'CLOSED',
      draft: result.draft === true,
      head: result.head?.ref || '',
      base: result.base?.ref || '',
      numberOfComments: (result.comments || 0) + (result.review_comments || 0),
    };
  }

  async verifyRemoteCommit(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string,
    commitHash: string
  ): Promise<void> {
    const head = await this.resolveBranchHead(token, repository, branch);
    if (head.toLowerCase() !== commitHash.toLowerCase()) {
      throw new VcsProviderError(
        'GITHUB_REMOTE_COMMIT_MISMATCH',
        'Remote branch does not point to the submitted commit',
        409
      );
    }
  }

  async resolveBranchHead(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string
  ): Promise<string> {
    const ref = await this.request<{ object?: { sha?: string } }>(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
      token
    );
    if (!ref.object?.sha || !/^[0-9a-f]{40}$/i.test(ref.object.sha)) {
      throw new VcsProviderError(
        'GITHUB_BRANCH_HEAD_INVALID',
        'GitHub did not return a valid branch head',
        502
      );
    }
    return ref.object.sha;
  }

  async listFirstParentHistory(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string
  ): Promise<FirstParentHistory> {
    const directory = await this.dependencies.makeTempDirectory(
      join(tmpdir(), 'xyne-sdlc-wiki-history-')
    );
    const env = this.gitEnvironment(token);
    const options = {
      env,
      timeout: GIT_HISTORY_TIMEOUT_MS,
      maxBuffer: GIT_HISTORY_MAX_BUFFER,
    };
    try {
      await this.dependencies.runGit(['init', '--bare', directory], options);
      await this.dependencies.runGit(
        [
          '--git-dir',
          directory,
          'fetch',
          '--force',
          '--no-tags',
          // Planning needs commit ancestry only. Omitting historical trees and
          // blobs keeps 7k+ commit monorepos bounded; the agent sandbox fetches
          // code separately for the selected commits.
          '--filter=tree:0',
          repository.cloneUrl,
          `+refs/heads/${branch}:refs/remotes/origin/wiki-base`,
        ],
        options
      );
      const { stdout } = await this.dependencies.runGit(
        [
          '--git-dir',
          directory,
          'rev-list',
          '--first-parent',
          '--reverse',
          'refs/remotes/origin/wiki-base',
        ],
        options
      );
      const shas = stdout
        .split(/\r?\n/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (shas.length === 0 || shas.some((sha) => !/^[0-9a-f]{40}$/.test(sha))) {
        throw new VcsProviderError(
          'GITHUB_HISTORY_INVALID',
          'Git returned an invalid base-branch history',
          502
        );
      }
      return {
        targetHeadSha: shas[shas.length - 1]!,
        commits: shas.map((sha, index) => ({
          sha,
          parentSha: index === 0 ? null : shas[index - 1]!,
        })),
      };
    } catch (error) {
      if (error instanceof VcsProviderError) throw error;
      throw new VcsProviderError(
        'GITHUB_GIT_HISTORY_FAILED',
        `Git could not read first-parent history for branch ${branch}`,
        503,
        true
      );
    } finally {
      await this.dependencies.removeTempDirectory(directory).catch(() => undefined);
    }
  }

  async verifyPathsAtCommit(
    token: string | undefined,
    repository: ParsedRepository,
    commitHash: string,
    paths: string[]
  ): Promise<void> {
    if (!/^[0-9a-f]{40}$/i.test(commitHash)) {
      throw new VcsProviderError('GITHUB_COMMIT_INVALID', 'Invalid Git commit identity', 400);
    }
    for (const path of [...new Set(paths)]) {
      if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new VcsProviderError('GITHUB_PATH_INVALID', `Invalid repository path: ${path}`, 400);
      }
      try {
        await this.request(
          `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${path
            .split('/')
            .map(encodeURIComponent)
            .join('/')}?ref=${encodeURIComponent(commitHash)}`,
          token
        );
      } catch (error) {
        if (error instanceof VcsProviderError && error.httpStatus === 404) {
          throw new VcsProviderError(
            'INVALID_SOURCE_PATH',
            `[INVALID_SOURCE_PATH] Source path does not exist at the assigned ref: ${path}`,
            400
          );
        }
        throw error;
      }
    }
  }

  async verifySourceRangesAtCommit(
    token: string | undefined,
    repository: ParsedRepository,
    commitHash: string,
    references: SourceLineRange[]
  ): Promise<void> {
    if (!/^[0-9a-f]{40}$/i.test(commitHash)) {
      throw new VcsProviderError('GITHUB_COMMIT_INVALID', 'Invalid Git commit identity', 400);
    }
    for (const reference of references) {
      if (!reference.startLine) continue;
      const response = await this.request<{ type?: string; content?: string; encoding?: string }>(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${reference.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}?ref=${encodeURIComponent(commitHash)}`,
        token
      );
      if (response.type !== 'file' || response.encoding !== 'base64' || typeof response.content !== 'string') {
        throw new VcsProviderError(
          'INVALID_SOURCE_RANGE',
          `[INVALID_SOURCE_RANGE] Source cannot be line-addressed: ${reference.path}`,
          400
        );
      }
      const content = Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8');
      const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;
      const endLine = reference.endLine ?? reference.startLine;
      if (reference.startLine > lineCount || endLine > lineCount) {
        throw new VcsProviderError(
          'INVALID_SOURCE_RANGE',
          `[INVALID_SOURCE_RANGE] ${reference.path} has ${lineCount} lines at the assigned ref`,
          400
        );
      }
    }
  }

  validatePullRequestUrl(repository: ParsedRepository, raw: string): boolean {
    try {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      return (
        url.protocol === 'https:' &&
        url.hostname.toLowerCase() === 'github.com' &&
        parts[0]?.toLowerCase() === repository.owner.toLowerCase() &&
        parts[1]?.toLowerCase() === repository.name.toLowerCase() &&
        parts[2] === 'pull' &&
        /^\d+$/.test(parts[3] || '')
      );
    } catch {
      return false;
    }
  }

  private async request<T = unknown>(
    path: string,
    token?: string,
    init: RequestInit = {}
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'xyne-spaces-sdlc',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new VcsProviderError(
        'GITHUB_UNAVAILABLE',
        'GitHub is temporarily unavailable',
        503,
        true
      );
    }
    if (!response.ok) throw this.responseError(response);
    return (await response.json()) as T;
  }

  private responseError(response: Response): VcsProviderError {
    if (response.status === 401) {
      return new VcsProviderError(
        'GITHUB_CREDENTIAL_INVALID',
        'GitHub rejected the credential',
        401
      );
    }
    if (response.status === 403) {
      const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
      return exhausted
        ? new VcsProviderError(
            'GITHUB_RATE_LIMITED',
            'GitHub rate limit reached; retry later',
            429,
            true
          )
        : new VcsProviderError(
            'GITHUB_ORG_APPROVAL_OR_PERMISSION_REQUIRED',
            'GitHub access is forbidden; check organization approval and fine-grained permissions',
            403
          );
    }
    if (response.status === 404) {
      return new VcsProviderError(
        'GITHUB_REPOSITORY_NOT_FOUND',
        'Repository or branch was not found for this credential',
        404
      );
    }
    if (response.status === 422) {
      return new VcsProviderError(
        'GITHUB_VALIDATION_FAILED',
        'GitHub rejected the repository operation',
        422
      );
    }
    return new VcsProviderError(
      'GITHUB_REQUEST_FAILED',
      `GitHub request failed with status ${response.status}`,
      response.status >= 500 ? 503 : 502,
      response.status >= 500
    );
  }

  private gitEnvironment(token?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (token) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    }
    return env;
  }
}
