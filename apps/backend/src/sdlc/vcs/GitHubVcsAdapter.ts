import { execFile } from 'child_process';
import { promisify } from 'util';
import type {
  DraftPullRequestInput,
  DraftPullRequestResult,
  GitAuthentication,
  ParsedRepository,
  PullRequestInspection,
  RepositoryInspection,
  ValidatedCredential,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';

const execFileAsync = promisify(execFile);
const API_URL = 'https://api.github.com';
const API_VERSION = '2026-03-10';

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
    await this.lsRemote(repository.cloneUrl, baseBranch, token);
    const canPush = token ? repo.permissions?.push === true : false;
    return {
      repository: {
        ...repository,
        owner: repo.owner?.login || repository.owner,
        name: repo.name || repository.name,
      },
      visibility:
        repo.visibility === 'internal' ? 'INTERNAL' : repo.private === true ? 'PRIVATE' : 'PUBLIC',
      defaultBranch: baseBranch,
      identityLogin: token ? 'credential' : null,
      capabilities: [
        {
          capability: 'READ_REPOSITORY',
          state: 'PROVEN',
          source: token
            ? 'github-api+authenticated-git-ls-remote'
            : 'github-api+anonymous-git-ls-remote',
          detail: `Read and branch ${baseBranch} verified without remote mutation`,
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
        gitLsRemote: true,
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
    token: string,
    repository: ParsedRepository,
    branch: string,
    commitHash: string
  ): Promise<void> {
    const ref = await this.request<{ object?: { sha?: string } }>(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
      token
    );
    if (ref.object?.sha?.toLowerCase() !== commitHash.toLowerCase()) {
      throw new VcsProviderError(
        'GITHUB_REMOTE_COMMIT_MISMATCH',
        'Remote feature branch does not point to the submitted commit',
        409
      );
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

  private async lsRemote(url: string, branch: string, token?: string): Promise<void> {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (token) {
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
      env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    }
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--exit-code', url, `refs/heads/${branch}`],
        {
          env,
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
        }
      );
      if (!stdout.trim()) throw new Error('missing ref');
    } catch {
      throw new VcsProviderError(
        'GITHUB_GIT_READ_FAILED',
        `Git could not read branch ${branch}; check Contents permission and branch name`,
        403
      );
    }
  }
}
