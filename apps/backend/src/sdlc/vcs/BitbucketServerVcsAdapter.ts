import { createHash } from 'crypto';
import type {
  CapabilityEvidence,
  FirstParentHistory,
  GitAuthentication,
  ParsedRepository,
  PullRequestInput,
  PullRequestInspection,
  PullRequestResult,
  RepositoryInspection,
  RepositoryReach,
  SourceLineRange,
  ValidatedCredential,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';
import { defaultGitRunner, listFirstParentHistoryWithGit, type GitRunner } from './gitHistory';
import { repositoryHost } from './repositoryHost';

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
// Draft pull requests arrived in Bitbucket Data Center 8.18.
const DRAFT_MIN_VERSION: [number, number] = [8, 18];
const REACH_TTL_MS = 10 * 60_000;

interface BitbucketRepositoryResponse {
  slug?: string;
  name?: string;
  public?: boolean;
  project?: { key?: string; public?: boolean };
}

interface BitbucketPullRequestResponse {
  id?: number;
  state?: string;
  draft?: boolean;
  fromRef?: { displayId?: string };
  toRef?: { displayId?: string };
  links?: { self?: Array<{ href?: string }> };
  properties?: { commentCount?: number };
}

interface Paged<T> {
  values?: T[];
  isLastPage?: boolean;
  nextPageStart?: number;
}

export class BitbucketServerVcsAdapter implements VcsProviderAdapter {
  readonly provider = 'BITBUCKET_SERVER' as const;
  private version: Promise<string | null> | null = null;
  // Keyed by a token hash: counting pages through every repository the token reads.
  private readonly reach = new Map<string, { at: number; value: RepositoryReach }>();

  constructor(
    readonly host: string,
    private readonly git: GitRunner = defaultGitRunner
  ) {}

  parseRepositoryUrl(raw: string): ParsedRepository {
    const value = raw.trim();
    const invalid = () =>
      new VcsProviderError(
        'INVALID_REPOSITORY_URL',
        `Enter a ${this.host} repository link (browse, HTTPS or SSH clone link)`,
        400
      );
    if (repositoryHost(value) !== this.host) {
      throw new VcsProviderError(
        'UNSUPPORTED_REPOSITORY_HOST',
        `This credential serves ${this.host} only`,
        400
      );
    }
    let path: string;
    const scp = value.match(/^[^@\s/]+@[^:\s/]+:(.+)$/);
    if (scp && !value.includes('://')) {
      path = scp[1]!;
    } else if (value.includes('://')) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw invalid();
      }
      if (url.username && url.protocol !== 'ssh:') throw invalid();
      if (url.password || url.hash) throw invalid();
      path = url.pathname;
    } else {
      path = value.split('/').slice(1).join('/');
    }
    const segments = path
      .replace(/\/+$/, '')
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    let key: string | undefined;
    let slug: string | undefined;
    if (segments[0]?.toLowerCase() === 'projects' && segments[2]?.toLowerCase() === 'repos') {
      key = segments[1];
      slug = segments[3];
    } else if (segments[0]?.toLowerCase() === 'scm') {
      key = segments[1];
      slug = segments[2];
    } else if (segments.length === 2) {
      key = segments[0];
      slug = segments[1];
    }
    slug = slug?.replace(/\.git$/i, '');
    if (!key || !slug || !SEGMENT.test(key) || !SEGMENT.test(slug)) throw invalid();

    const projectKey = key.toUpperCase();
    const repositorySlug = slug.toLowerCase();
    return {
      provider: 'BITBUCKET_SERVER',
      host: this.host,
      owner: projectKey,
      name: repositorySlug,
      canonicalUrl: `https://${this.host}/scm/${projectKey.toLowerCase()}/${repositorySlug}`,
      cloneUrl: `https://${this.host}/scm/${projectKey.toLowerCase()}/${repositorySlug}.git`,
    };
  }

  /** Personal HTTP access tokens only: project and repository tokens act as a bot with no email. */
  async validateCredential(token: string): Promise<ValidatedCredential> {
    const { response } = await this.send('/rest/api/1.0/application-properties', token);
    // The login, URL-encoded (`jane%40example.com`); it is not the user slug.
    const header = response.headers.get('x-ausername')?.trim() ?? '';
    let login = header;
    try {
      login = decodeURIComponent(header);
    } catch {
      // Keep the raw header; the lookup below fails closed if it is not a login.
    }
    if (!login) {
      throw new VcsProviderError(
        'BITBUCKET_CREDENTIAL_INVALID',
        'Bitbucket did not accept the token as an authenticated user',
        401
      );
    }
    const page = await this.request<
      Paged<{ name?: string; slug?: string; displayName?: string; emailAddress?: string }>
    >(`/rest/api/1.0/users?filter=${encodeURIComponent(login)}&limit=25`, token);
    const user = page.values?.find((value) => value.name?.toLowerCase() === login.toLowerCase());
    const email = user?.emailAddress?.trim() ?? '';
    if (!user?.name || !email.includes('@')) throw this.personalTokenRequired();
    const accountName = (user.displayName?.trim() || user.name).replace(/[\r\n<>]/g, '').slice(0, 200);
    // Git over HTTPS authenticates with the login, not the slug.
    return { identityLogin: user.name, accountName: accountName || user.name, accountEmail: email };
  }

  // Display only, never a gate. Bitbucket pages carry no totals, so count the pages.
  async repositoryReach(token: string): Promise<RepositoryReach> {
    const key = createHash('sha256').update(token).digest('hex');
    const cached = this.reach.get(key);
    if (cached && Date.now() - cached.at < REACH_TTL_MS) return cached.value;
    try {
      let count = 0;
      let start = 0;
      // Capped at 10k repositories; past that the count is a floor.
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await this.request<Paged<unknown>>(
          `/rest/api/1.0/repos?permission=REPO_READ&limit=1000&start=${start}`,
          token
        );
        count += page.values?.length ?? 0;
        if (page.isLastPage !== false || page.nextPageStart === undefined) break;
        start = page.nextPageStart;
      }
      const value = { repositoryOwner: null, repositoryCount: count };
      this.reach.set(key, { at: Date.now(), value });
      return value;
    } catch {
      return { repositoryOwner: null, repositoryCount: null };
    }
  }

  /** Bitbucket's `name` filter only matches prefixes; the search API matches inside names. */
  async searchRepositories(token: string, query: string, limit: number): Promise<ParsedRepository[]> {
    if (!query.trim()) {
      const page = await this.request<Paged<BitbucketRepositoryResponse>>(
        `/rest/api/1.0/repos?permission=REPO_READ&limit=${limit}`,
        token
      );
      return (page.values ?? []).flatMap((value) =>
        value.slug && value.project?.key
          ? [this.parseRepositoryUrl(`https://${this.host}/projects/${value.project.key}/repos/${value.slug}/browse`)]
          : []
      );
    }
    const result = await this.request<{
      repositories?: { values?: Array<{ slug?: string; project?: { key?: string } }> };
    }>('/rest/search/latest/search', token, {
      method: 'POST',
      body: JSON.stringify({ query: query.trim(), entities: { repositories: { start: 0, limit } } }),
    });
    return (result.repositories?.values ?? []).flatMap((value) =>
      value.slug && value.project?.key
        ? [
            this.parseRepositoryUrl(
              `https://${this.host}/projects/${value.project.key}/repos/${value.slug}/browse`
            ),
          ]
        : []
    );
  }

  async inspectRepository(input: {
    repository: ParsedRepository;
    baseBranch?: string;
    token?: string;
  }): Promise<RepositoryInspection> {
    const { repository, token } = input;
    const repo = await this.request<BitbucketRepositoryResponse>(this.repoPath(repository), token);
    let baseBranch = input.baseBranch;
    if (!baseBranch) {
      const branch = await this.request<{ displayId?: string }>(
        `${this.repoPath(repository)}/branches/default`,
        token
      );
      baseBranch = branch.displayId;
    }
    if (!baseBranch) {
      throw new VcsProviderError(
        'BITBUCKET_DEFAULT_BRANCH_MISSING',
        'Repository has no default branch',
        409
      );
    }
    await this.resolveBranchHead(token, repository, baseBranch);
    const canPush = token ? await this.hasWritePermission(token, repository, repo.name) : false;
    const visibility = repo.public === true || repo.project?.public === true ? 'PUBLIC' : 'PRIVATE';
    const capabilities: CapabilityEvidence[] = [
      {
        capability: 'READ_REPOSITORY',
        state: 'PROVEN',
        source: token ? 'bitbucket-api-authenticated' : 'bitbucket-api-anonymous',
        detail: `Read and branch ${baseBranch} verified without remote mutation`,
        visibility,
      },
      {
        capability: 'PUSH_BRANCH',
        state: canPush ? 'INFERRED' : 'UNAVAILABLE',
        source: token ? 'bitbucket-repository-permissions' : 'anonymous',
        detail: canPush
          ? 'Bitbucket reports write permission; no write was attempted'
          : 'No write permission reported',
      },
      {
        capability: 'CREATE_PULL_REQUEST',
        state: canPush ? 'INFERRED' : 'UNAVAILABLE',
        source: 'bitbucket-required-permission',
        detail: canPush
          ? 'Repository write permission is required and will be proven only at runtime'
          : 'Pull request creation needs an authenticated writable branch',
      },
    ];
    return {
      repository: {
        ...repository,
        owner: repo.project?.key?.toUpperCase() || repository.owner,
        name: repo.slug || repository.name,
      },
      visibility,
      defaultBranch: baseBranch,
      identityLogin: token ? 'credential' : null,
      capabilities,
      evidence: {
        apiRead: true,
        configuredBaseBranch: baseBranch,
        bitbucketWritePermission: canPush,
      },
    };
  }

  buildGitAuthentication(credential: {
    token: string;
    identityLogin: string | null;
  }): GitAuthentication {
    if (!credential.identityLogin) {
      throw new VcsProviderError(
        'BITBUCKET_IDENTITY_INVALID',
        'Revalidate this Bitbucket credential before using it',
        409
      );
    }
    return { username: credential.identityLogin, password: credential.token };
  }

  async createPullRequest(token: string, input: PullRequestInput): Promise<PullRequestResult> {
    const repository = { slug: input.repository, project: { key: input.owner } };
    const draft = input.draft && (await this.supportsDrafts(token));
    const result = await this.request<BitbucketPullRequestResponse>(
      `/rest/api/1.0/projects/${encodeURIComponent(input.owner)}/repos/${encodeURIComponent(input.repository)}/pull-requests`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          description: input.body,
          fromRef: { id: `refs/heads/${input.head}`, repository },
          toRef: { id: `refs/heads/${input.base}`, repository },
          reviewers: [],
          ...(draft ? { draft: true } : {}),
        }),
      }
    );
    const url = result.links?.self?.[0]?.href;
    if (!url || typeof result.id !== 'number') {
      throw new VcsProviderError(
        'BITBUCKET_PULL_REQUEST_INVALID_RESPONSE',
        'Bitbucket returned an invalid pull request response',
        502
      );
    }
    return {
      url,
      number: result.id,
      draft: result.draft === true,
      head: result.fromRef?.displayId || input.head,
      base: result.toRef?.displayId || input.base,
    };
  }

  async inspectPullRequest(
    token: string,
    repository: ParsedRepository,
    number: number
  ): Promise<PullRequestInspection> {
    const result = await this.request<BitbucketPullRequestResponse>(
      `${this.repoPath(repository)}/pull-requests/${number}`,
      token
    );
    const url = result.links?.self?.[0]?.href;
    if (!url || result.id !== number) {
      throw new VcsProviderError(
        'BITBUCKET_PULL_REQUEST_INVALID_RESPONSE',
        'Bitbucket returned an invalid pull request response',
        502
      );
    }
    return {
      url,
      number,
      state: result.state === 'MERGED' ? 'MERGED' : result.state === 'OPEN' ? 'OPEN' : 'CLOSED',
      draft: result.draft === true,
      head: result.fromRef?.displayId || '',
      base: result.toRef?.displayId || '',
      numberOfComments: result.properties?.commentCount || 0,
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
        'BITBUCKET_REMOTE_COMMIT_MISMATCH',
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
    const page = await this.request<Paged<{ displayId?: string; latestCommit?: string }>>(
      `${this.repoPath(repository)}/branches?filterText=${encodeURIComponent(branch)}&boostMatches=true&limit=100`,
      token
    );
    const match = page.values?.find((value) => value.displayId === branch);
    if (!match) {
      throw new VcsProviderError(
        'BITBUCKET_REPOSITORY_NOT_FOUND',
        'Repository or branch was not found for this credential',
        404
      );
    }
    if (!match.latestCommit || !/^[0-9a-f]{40}$/i.test(match.latestCommit)) {
      throw new VcsProviderError(
        'BITBUCKET_BRANCH_HEAD_INVALID',
        'Bitbucket did not return a valid branch head',
        502
      );
    }
    return match.latestCommit;
  }

  async listFirstParentHistory(
    token: string | undefined,
    repository: ParsedRepository,
    branch: string
  ): Promise<FirstParentHistory> {
    return listFirstParentHistoryWithGit(this.git, {
      cloneUrl: repository.cloneUrl,
      branch,
      ...(token
        ? {
            authorization: {
              url: `https://${this.host}/`,
              header: `AUTHORIZATION: Bearer ${token}`,
            },
          }
        : {}),
      errorPrefix: 'BITBUCKET',
    });
  }

  async verifyPathsAtCommit(
    token: string | undefined,
    repository: ParsedRepository,
    commitHash: string,
    paths: string[]
  ): Promise<void> {
    this.requireCommit(commitHash);
    for (const path of [...new Set(paths)]) {
      this.requirePath(path);
      try {
        await this.request(
          `${this.repoPath(repository)}/browse/${this.encodePath(path)}?at=${encodeURIComponent(commitHash)}&limit=1`,
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
    this.requireCommit(commitHash);
    for (const reference of references) {
      if (!reference.startLine) continue;
      this.requirePath(reference.path);
      const lastLine = Math.max(reference.startLine, reference.endLine ?? reference.startLine);
      // Asking browse for just the last cited line proves the range without paging the file.
      const page = await this.request<{ lines?: unknown[] }>(
        `${this.repoPath(repository)}/browse/${this.encodePath(reference.path)}?at=${encodeURIComponent(commitHash)}&start=${lastLine - 1}&limit=1`,
        token
      );
      if (!Array.isArray(page.lines)) {
        throw new VcsProviderError(
          'INVALID_SOURCE_RANGE',
          `[INVALID_SOURCE_RANGE] Source cannot be line-addressed: ${reference.path}`,
          400
        );
      }
      if (page.lines.length === 0) {
        throw new VcsProviderError(
          'INVALID_SOURCE_RANGE',
          `[INVALID_SOURCE_RANGE] ${reference.path} has fewer than ${lastLine} lines at the assigned ref`,
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
        url.hostname.toLowerCase() === this.host &&
        parts[0] === 'projects' &&
        parts[1]?.toUpperCase() === repository.owner.toUpperCase() &&
        parts[2] === 'repos' &&
        parts[3]?.toLowerCase() === repository.name.toLowerCase() &&
        parts[4] === 'pull-requests' &&
        /^\d+$/.test(parts[5] || '')
      );
    } catch {
      return false;
    }
  }

  // `name` filters on the display name, which can differ from the slug the link carries.
  private async hasWritePermission(
    token: string,
    repository: ParsedRepository,
    displayName: string | undefined
  ): Promise<boolean> {
    const page = await this.request<Paged<BitbucketRepositoryResponse>>(
      `/rest/api/1.0/repos?projectkey=${encodeURIComponent(repository.owner)}&name=${encodeURIComponent(displayName ?? repository.name)}&permission=REPO_WRITE&limit=100`,
      token
    );
    return (page.values ?? []).some(
      (value) =>
        value.slug?.toLowerCase() === repository.name.toLowerCase() &&
        value.project?.key?.toUpperCase() === repository.owner.toUpperCase()
    );
  }

  private async supportsDrafts(token: string): Promise<boolean> {
    this.version ??= this.request<{ version?: string }>('/rest/api/1.0/application-properties', token)
      .then((value) => value.version ?? null)
      .catch(() => null);
    const version = await this.version;
    const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
    return major > DRAFT_MIN_VERSION[0] || (major === DRAFT_MIN_VERSION[0] && minor >= DRAFT_MIN_VERSION[1]);
  }

  private repoPath(repository: ParsedRepository): string {
    return `/rest/api/1.0/projects/${encodeURIComponent(repository.owner)}/repos/${encodeURIComponent(repository.name)}`;
  }

  private encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  private requireCommit(commitHash: string): void {
    if (!/^[0-9a-f]{40}$/i.test(commitHash)) {
      throw new VcsProviderError('BITBUCKET_COMMIT_INVALID', 'Invalid Git commit identity', 400);
    }
  }

  private requirePath(path: string): void {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      throw new VcsProviderError('BITBUCKET_PATH_INVALID', `Invalid repository path: ${path}`, 400);
    }
  }

  private personalTokenRequired(): VcsProviderError {
    return new VcsProviderError(
      'BITBUCKET_PERSONAL_TOKEN_REQUIRED',
      'Use a personal HTTP access token: Bitbucket returned no user email for this token',
      400
    );
  }

  private async request<T = unknown>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
    return (await this.send<T>(path, token, init)).data;
  }

  private async send<T = unknown>(
    path: string,
    token?: string,
    init: RequestInit = {}
  ): Promise<{ data: T; response: Response }> {
    let response: Response;
    try {
      response = await fetch(`https://${this.host}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'xyne-spaces-sdlc',
          // Bitbucket rejects write calls without it as XSRF.
          'X-Atlassian-Token': 'no-check',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new VcsProviderError(
        'BITBUCKET_UNAVAILABLE',
        'Bitbucket is temporarily unavailable',
        503,
        true
      );
    }
    if (!response.ok) throw this.responseError(response);
    return { data: (await response.json()) as T, response };
  }

  private responseError(response: Response): VcsProviderError {
    if (response.status === 401) {
      return new VcsProviderError(
        'BITBUCKET_CREDENTIAL_INVALID',
        'Bitbucket rejected the credential',
        401
      );
    }
    if (response.status === 403) {
      return new VcsProviderError(
        'BITBUCKET_PERMISSION_REQUIRED',
        'Bitbucket access is forbidden for this credential',
        403
      );
    }
    if (response.status === 404) {
      return new VcsProviderError(
        'BITBUCKET_REPOSITORY_NOT_FOUND',
        'Repository or branch was not found for this credential',
        404
      );
    }
    if (response.status === 400 || response.status === 409) {
      return new VcsProviderError(
        'BITBUCKET_VALIDATION_FAILED',
        'Bitbucket rejected the repository operation',
        response.status === 409 ? 409 : 422
      );
    }
    return new VcsProviderError(
      'BITBUCKET_REQUEST_FAILED',
      `Bitbucket request failed with status ${response.status}`,
      response.status >= 500 ? 503 : 502,
      response.status >= 500
    );
  }
}
