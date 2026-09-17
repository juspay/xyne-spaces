import { Prisma, type PrismaClient } from '@prisma/client';
import {
  ACLAuditEventType,
  ACLAuditTargetType,
  SDLC_AGENT_SLUG,
  SDLC_GITHUB_HOST,
  sdlcTokenSchemaFor,
  type BootstrapSdlcRuntimeCredentialInput,
  type CreateSdlcPullRequestInput,
  type CreateSdlcVcsCredentialInput,
  type SdlcSandboxGitCredential,
  type UpdateSdlcVcsCredentialInput,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import type { SdlcActor } from '../types';
import { isSafeSdlcGitRef, requireSdlcBaseBranch } from '../sdlcRepositoryContext';
import { GitHubVcsAdapter } from './GitHubVcsAdapter';
import { BitbucketServerVcsAdapter } from './BitbucketServerVcsAdapter';
import { SdlcVcsCredentialStore, type StoredSdlcVcsCredential } from './SdlcVcsCredentialStore';
import { classifyRuntimeAccessFailure } from './accessCheckPolicy';
import { blockedCapabilities, deriveAccessStatus, readCapabilities } from './accessStatus';
import {
  encryptSandboxCredentialEnvelope,
  parseSandboxPublicKey,
  type SandboxCredentialEnvelope,
} from './sandboxCredentialEnvelope';
import { providerForHost, repositoryHost } from './repositoryHost';
import type {
  ParsedRepository,
  RepositoryAccessCheckResult,
  SdlcVcs,
  ValidatedCredential,
  VcsCapability,
  VcsProvider,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';
import { sdlcGrantCoversRepo, verifySdlcInteractiveGrant } from './sdlcInteractiveGrant';
import { findSdlcMembershipForActor } from '../sdlcChannelMembership';
import { requireSdlcProjectAccess } from '../sdlcProjectAccess';

const ACCESS_REFRESH_CHUNK = 5;

const PROVIDER_LABEL: Record<VcsProvider, string> = {
  GITHUB: 'GitHub',
  BITBUCKET_SERVER: 'Bitbucket',
};

type Db = PrismaClient | Prisma.TransactionClient;

interface RepositoryRow {
  id: string;
  workspaceId: string | null;
  url: string;
  canonicalUrl: string | null;
  vcsCredentialId: string | null;
}

interface RepositoryAccess {
  adapter: VcsProviderAdapter;
  repository: ParsedRepository;
  credential: StoredSdlcVcsCredential | null;
  token: string | undefined;
}

export interface SandboxCredentialBootstrap {
  envelope: SandboxCredentialEnvelope | null;
  repository: { name: string; cloneUrl: string; baseBranch: string };
}

function grantSecret(): string {
  return process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || '';
}

function isUsable(credential: StoredSdlcVcsCredential | null): credential is StoredSdlcVcsCredential & {
  token: string;
} {
  return Boolean(
    credential?.status === 'CONNECTED' && credential.validationStatus === 'VALID' && credential.token
  );
}

export class SdlcVcsService implements SdlcVcs {
  private readonly credentialStore = new SdlcVcsCredentialStore();
  private readonly github = new GitHubVcsAdapter();
  private readonly bitbucket = new Map<string, BitbucketServerVcsAdapter>();

  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  parseRepositoryUrl(url: string): ParsedRepository {
    try {
      const host = repositoryHost(url);
      return this.adapter(providerForHost(host), host).parseRepositoryUrl(url);
    } catch (error) {
      throw this.toAppError(error);
    }
  }

  async providerHosts(workspaceId: string): Promise<Array<{ provider: VcsProvider; host: string }>> {
    const rows = await this.credentialStore.list(this.prisma, workspaceId);
    const hosts = new Map<string, { provider: VcsProvider; host: string }>([
      [`GITHUB:${SDLC_GITHUB_HOST}`, { provider: 'GITHUB', host: SDLC_GITHUB_HOST }],
    ]);
    for (const row of rows) hosts.set(`${row.provider}:${row.host}`, { provider: row.provider, host: row.host });
    return [...hosts.values()];
  }

  async credentialsForRepository(workspaceId: string, repository: ParsedRepository) {
    return (await this.credentialStore.list(this.prisma, workspaceId))
      .filter(isUsable)
      .filter((row) => row.provider === repository.provider && row.host === repository.host)
      .map((row) => ({ id: row.id, name: row.name, accountName: row.accountName }));
  }

  async searchCredentialRepositories(
    workspaceId: string,
    scope: { provider: VcsProvider; host: string },
    query: string,
    limit: number
  ) {
    const rows = (await this.credentialStore.list(this.prisma, workspaceId))
      .filter(isUsable)
      .filter((row) => row.provider === scope.provider && row.host === scope.host);
    const outcomes = await Promise.allSettled(
      rows.map(async (row) => ({
        row,
        repositories: await this.adapter(row.provider, row.host).searchRepositories(
          row.token,
          query,
          limit
        ),
      }))
    );
    const byCanonicalUrl = new Map<
      string,
      { repository: ParsedRepository; credentials: Array<{ id: string; name: string; accountName: string | null }> }
    >();
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        logger.warn('[SDLC] credential repository search failed', {
          workspaceId,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
        continue;
      }
      const { row, repositories } = outcome.value;
      for (const repository of repositories) {
        const entry = byCanonicalUrl.get(repository.canonicalUrl) ?? { repository, credentials: [] };
        entry.credentials.push({ id: row.id, name: row.name, accountName: row.accountName });
        byCanonicalUrl.set(repository.canonicalUrl, entry);
      }
    }
    return [...byCanonicalUrl.values()];
  }

  async defaultBranch(
    workspaceId: string,
    repository: ParsedRepository,
    credentialId: string | null
  ): Promise<string | null> {
    const credential = credentialId
      ? await this.credentialStore.find(this.prisma, workspaceId, credentialId)
      : null;
    try {
      const inspection = await this.adapter(repository.provider, repository.host).inspectRepository({
        repository,
        ...(isUsable(credential) ? { token: credential.token } : {}),
      });
      return inspection.defaultBranch;
    } catch {
      return null;
    }
  }

  async listCredentials(actor: SdlcActor): Promise<unknown[]> {
    const user = await this.requireWorkspaceUser(actor);
    const rows = await this.credentialStore.list(this.prisma, actor.workspaceId);
    const linked = await this.prisma.repo.groupBy({
      by: ['vcsCredentialId'],
      where: { workspaceId: actor.workspaceId, vcsCredentialId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });
    return await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        name: row.name,
        provider: row.provider,
        host: row.host,
        status: row.status,
        revision: row.revision,
        identityLogin: row.identityLogin,
        accountName: row.accountName,
        accountEmail: row.accountEmail,
        linkedRepositoryCount:
          linked.find((item) => item.vcsCredentialId === row.id)?._count._all ?? 0,
        ...(isUsable(row)
          ? await this.adapter(row.provider, row.host).repositoryReach(row.token)
          : { repositoryOwner: null, repositoryCount: null }),
        validationStatus: row.validationStatus,
        validatedAt: row.validatedAt,
        validationErrorCode: row.validationErrorCode,
        validationErrorMessage: row.validationErrorMessage,
        disconnectedAt: row.disconnectedAt,
        updatedAt: row.updatedAt,
        canManage: user.role === 'OWNER' || user.role === 'ADMIN',
      }))
    );
  }

  async createCredential(actor: SdlcActor, input: CreateSdlcVcsCredentialInput): Promise<unknown> {
    await this.requireWorkspaceAdmin(actor);
    const host = input.provider === 'GITHUB' ? SDLC_GITHUB_HOST : input.host;
    let validation;
    try {
      validation = await this.adapter(input.provider, host).validateCredential(input.token);
    } catch (error) {
      throw this.toAppError(error);
    }
    const now = new Date().toISOString();
    const saved = await this.credentialStore.save(this.prisma, {
      workspaceId: actor.workspaceId,
      provider: input.provider,
      name: input.name,
      host,
      status: 'CONNECTED',
      token: input.token,
      revision: 1,
      identityLogin: validation.identityLogin,
      accountName: validation.accountName,
      accountEmail: validation.accountEmail,
      validationStatus: 'VALID',
      validatedAt: now,
      validationErrorCode: null,
      validationErrorMessage: null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      disconnectedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit(actor, saved.id, 'created');
    // Repositories left without a credential (never linked, or theirs was deleted) take this one.
    const unlinked = await this.prisma.repo.findMany({
      where: {
        workspaceId: actor.workspaceId,
        vcsCredentialId: null,
        projectId: { not: null },
        canonicalUrl: { startsWith: `https://${host}/`, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (unlinked.length > 0) {
      await this.prisma.repo.updateMany({
        where: { id: { in: unlinked.map((repo) => repo.id) }, vcsCredentialId: null },
        data: { vcsCredentialId: saved.id },
      });
      void this.refreshRepositories(actor, unlinked.map((repo) => repo.id));
    }
    return this.listedCredential(actor, saved.id);
  }

  async updateCredential(
    actor: SdlcActor,
    credentialId: string,
    input: UpdateSdlcVcsCredentialInput
  ): Promise<unknown> {
    await this.requireWorkspaceAdmin(actor);
    const existing = await this.requireCredential(actor.workspaceId, credentialId);
    let validation: ValidatedCredential | undefined;
    if (input.token !== undefined) {
      const token = sdlcTokenSchemaFor(existing.provider).safeParse(input.token);
      if (!token.success) {
        throw new AppError(token.error.issues[0]?.message ?? 'Invalid token', 400);
      }
      try {
        validation = await this.adapter(existing.provider, existing.host).validateCredential(
          token.data
        );
      } catch (error) {
        throw this.toAppError(error);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, credentialId);
      const current = await this.requireCredential(actor.workspaceId, credentialId, tx);
      const now = new Date().toISOString();
      await this.credentialStore.save(tx, {
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(validation && input.token
          ? {
              status: 'CONNECTED' as const,
              token: input.token,
              revision: current.revision + 1,
              identityLogin: validation.identityLogin,
              accountName: validation.accountName,
              accountEmail: validation.accountEmail,
              validationStatus: 'VALID',
              validatedAt: now,
              validationErrorCode: null,
              validationErrorMessage: null,
              disconnectedAt: null,
            }
          : {}),
        updatedBy: actor.userId,
        updatedAt: now,
      });
      if (validation) await this.resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
    });
    if (validation) {
      await this.audit(actor, credentialId, 'replaced');
      void this.refreshCredentialRepositories(actor, credentialId);
    }
    return this.listedCredential(actor, credentialId);
  }

  async revalidateCredential(actor: SdlcActor, credentialId: string): Promise<unknown> {
    await this.requireWorkspaceAdmin(actor);
    const row = await this.requireCredential(actor.workspaceId, credentialId);
    if (row.status !== 'CONNECTED' || !row.token) {
      throw new AppError('Repository credential is not connected', 409);
    }
    try {
      const validation = await this.adapter(row.provider, row.host).validateCredential(row.token);
      const now = new Date().toISOString();
      await this.prisma.$transaction(async (tx) => {
        await this.credentialStore.save(tx, {
          ...row,
          validationStatus: 'VALID',
          validatedAt: now,
          validationErrorCode: null,
          validationErrorMessage: null,
          identityLogin: validation.identityLogin,
          accountName: validation.accountName,
          accountEmail: validation.accountEmail,
          updatedBy: actor.userId,
          updatedAt: now,
        });
        await this.resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
      });
      await this.audit(actor, row.id, 'validated');
      void this.refreshCredentialRepositories(actor, credentialId);
    } catch (error) {
      const mapped = this.providerError(error);
      await this.prisma.$transaction(async (tx) => {
        const now = new Date().toISOString();
        await this.credentialStore.save(tx, {
          ...row,
          validationStatus: 'INVALID',
          validatedAt: now,
          validationErrorCode: mapped.code,
          validationErrorMessage: mapped.message,
          updatedBy: actor.userId,
          updatedAt: now,
        });
        await this.resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
      });
      await this.audit(actor, row.id, 'validation_failed');
      throw this.toAppError(mapped);
    }
    return this.listedCredential(actor, credentialId);
  }

  /** Linked Repositories keep working anonymously if public; private ones need a new credential. */
  async deleteCredential(actor: SdlcActor, credentialId: string): Promise<void> {
    await this.requireWorkspaceAdmin(actor);
    const repoIds = await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, credentialId);
      await this.requireCredential(actor.workspaceId, credentialId, tx);
      const linked = await tx.repo.findMany({
        where: { workspaceId: actor.workspaceId, vcsCredentialId: credentialId },
        select: { id: true },
      });
      await tx.repo.updateMany({
        where: { id: { in: linked.map((repo) => repo.id) } },
        data: { vcsCredentialId: null, accessCapabilities: [] },
      });
      await this.credentialStore.remove(tx, credentialId);
      return linked.map((repo) => repo.id);
    });
    await this.audit(actor, credentialId, 'disconnected');
    void this.refreshRepositories(actor, repoIds);
  }

  async checkRepositoryAccess(
    actor: SdlcActor,
    repoId: string,
    options: { force?: boolean } = {}
  ): Promise<RepositoryAccessCheckResult> {
    // Project access, not hub membership: a repository is checked from the moment it
    // is registered, and joins a hub only later.
    const repo = await this.requireProjectRepository(actor, repoId);
    // Only a proven read short-circuits: failures persist non-empty capabilities, so a
    // length check here would leave a BLOCKED repository stuck forever.
    const current = deriveAccessStatus(repo.accessCapabilities);
    if (!options.force && current.status === 'READY') {
      return { status: 'READY', errorMessage: null, capabilities: current.capabilities };
    }
    return this.performRepositoryCheck({
      repoId: repo.id,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
    });
  }

  async markRuntimeFailure(
    repoId: string,
    operation: 'CLONE' | 'PUSH' | 'CREATE_PULL_REQUEST',
    error: string
  ): Promise<void> {
    const failureKind = classifyRuntimeAccessFailure(error);
    if (!failureKind) return;
    const capability =
      operation === 'CLONE'
        ? 'READ_REPOSITORY'
        : operation === 'PUSH'
          ? 'PUSH_BRANCH'
          : 'CREATE_PULL_REQUEST';
    const repo = await this.prisma.repo.findUnique({
      where: { id: repoId },
      select: { accessCapabilities: true, workspaceId: true, createdBy: true, vcsCredentialId: true },
    });
    if (!repo) return;
    if (failureKind !== 'CREDENTIAL_INVALID') {
      const capabilities = readCapabilities(repo.accessCapabilities).map((item) =>
        item.capability === capability
          ? {
              ...item,
              state: 'RUNTIME_FAILED' as const,
              source: 'runtime',
              detail: 'Provider authentication failed during execution',
            }
          : item
      );
      await this.prisma.repo.update({
        where: { id: repoId },
        data: { accessCapabilities: capabilities as unknown as Prisma.InputJsonValue },
      });
      return;
    }
    if (!repo.workspaceId || !repo.vcsCredentialId) return;
    const credential = await this.credentialStore.find(
      this.prisma,
      repo.workspaceId,
      repo.vcsCredentialId
    );
    if (!credential) return;
    await this.invalidateCredential({
      workspaceId: repo.workspaceId,
      userId: repo.createdBy,
      credential,
      error: new VcsProviderError(
        'CREDENTIAL_INVALID',
        `${PROVIDER_LABEL[credential.provider]} rejected the repository credential`,
        401
      ),
    });
    void this.refreshCredentialRepositories(
      { workspaceId: repo.workspaceId, userId: repo.createdBy },
      credential.id
    );
  }

  async performRepositoryCheck(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }): Promise<RepositoryAccessCheckResult> {
    const repo = await this.prisma.repo.findFirst({
      where: { id: input.repoId, workspaceId: input.workspaceId, projectId: { not: null } },
    });
    if (!repo) throw new Error('SDLC repository not found');
    let invalidatedCredentialId: string | null = null;
    let credentialState: string | null = null;
    try {
      const access = await this.repositoryAccess(this.prisma, repo);
      const { adapter, repository, credential } = access;
      credentialState = this.credentialState(credential);
      let token = access.token;
      let inspection;
      let fallbackError: VcsProviderError | null = null;
      const baseBranch = this.baseBranch(repo.baseBranch);
      if (token) {
        // The Provider authorises the repository; do not re-add a local owner check here.
        try {
          inspection = await adapter.inspectRepository({ repository, baseBranch, token });
        } catch (error) {
          fallbackError = this.providerError(error);
          if (fallbackError.retryable) throw fallbackError;
          if (fallbackError.code.endsWith('_CREDENTIAL_INVALID') && credential) {
            await this.invalidateCredential({
              workspaceId: input.workspaceId,
              userId: input.userId,
              credential,
              error: fallbackError,
            });
            invalidatedCredentialId = credential.id;
          }
        }
        if (!inspection) {
          try {
            inspection = await adapter.inspectRepository({ repository, baseBranch });
          } catch {
            throw fallbackError;
          }
          token = undefined;
        }
      } else {
        inspection = await adapter.inspectRepository({ repository, baseBranch });
      }
      await this.prisma.$transaction(async (tx) => {
        if (!(await this.credentialUnchanged(tx, repo, credentialState))) {
          throw new VcsProviderError(
            'CREDENTIAL_CHANGED_DURING_CHECK',
            'Repository credential changed during repository access check',
            409,
            true
          );
        }
        await tx.repo.update({
          where: { id: repo.id },
          data: {
            canonicalUrl: inspection.repository.canonicalUrl,
            accessCapabilities: inspection.capabilities as unknown as Prisma.InputJsonValue,
          },
        });
        await this.accessCheckAudit(input, repo.id, fallbackError?.code ?? 'READY', tx);
      });
      this.refreshAfterCredentialInvalidation(invalidatedCredentialId, input, repo.id);
      return { status: 'READY', errorMessage: null, capabilities: inspection.capabilities };
    } catch (error) {
      const mapped = this.providerError(error);
      // Transient trouble is not evidence of missing access, and inline there is no Bull
      // retry — leave stored capabilities alone rather than blanking on a 503.
      if (mapped.retryable) {
        await this.accessCheckAudit(input, repo.id, mapped.code);
        this.refreshAfterCredentialInvalidation(invalidatedCredentialId, input, repo.id);
        return {
          status: 'ERROR',
          errorMessage: mapped.message,
          capabilities: readCapabilities(repo.accessCapabilities),
        };
      }
      const capabilities = blockedCapabilities(mapped);
      // Bull's per-repo job id used to serialise checks; without it a slow failure can
      // overwrite a newer success, so take the same guard as the success path.
      const stale = await this.prisma.$transaction(async (tx) => {
        if (!(await this.credentialUnchanged(tx, repo, credentialState))) return true;
        await tx.repo.update({
          where: { id: repo.id },
          data: { accessCapabilities: capabilities as unknown as Prisma.InputJsonValue },
        });
        await this.accessCheckAudit(input, repo.id, mapped.code, tx);
        return false;
      });
      this.refreshAfterCredentialInvalidation(invalidatedCredentialId, input, repo.id);
      if (stale) {
        return {
          status: 'ERROR',
          errorMessage: 'Repository credential changed during repository access check',
          capabilities: readCapabilities(repo.accessCapabilities),
        };
      }
      return { status: 'BLOCKED', errorMessage: mapped.message, capabilities };
    }
  }

  async requireCapabilities(
    actor: SdlcActor,
    repoId: string,
    required: VcsCapability[]
  ): Promise<void> {
    const repo = await this.requireRepositoryMember(actor, repoId);
    const evidence = readCapabilities(repo.accessCapabilities);
    const missing = required.filter((capability) => {
      const state = evidence.find((item) => item.capability === capability)?.state;
      return capability === 'READ_REPOSITORY'
        ? state !== 'PROVEN'
        : state !== 'PROVEN' && state !== 'INFERRED';
    });
    if (missing.length > 0) {
      throw new AppError(`Repository capability required: ${missing.join(', ')}`, 409);
    }
    if (required.some((value) => value !== 'READ_REPOSITORY')) {
      const access = await this.repositoryAccess(this.prisma, repo);
      if (!access.token) {
        throw new AppError(
          'Replace or reconnect this repository credential before starting work',
          409
        );
      }
    }
  }

  // The grant branch serves only the claw deployed before Actor-based access.
  async bootstrapSandboxCredential(
    binding: BootstrapSdlcRuntimeCredentialInput
  ): Promise<SandboxCredentialBootstrap> {
    const repo = await this.prisma.repo.findUnique({ where: { id: binding.repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    const { actor, legacy } = this.runActor(binding, repo);
    await this.requireRepositoryMember(actor, repo.id);
    let sandboxPublicKey: ReturnType<typeof parseSandboxPublicKey>;
    try {
      sandboxPublicKey = parseSandboxPublicKey(binding.sandboxPublicKey);
    } catch {
      throw new AppError('Invalid sandbox public key', 400);
    }
    await this.requireCapabilities(actor, repo.id, ['READ_REPOSITORY']);
    const access = await this.repositoryAccess(this.prisma, repo);
    const repository = {
      name: repo.name,
      cloneUrl: access.repository.cloneUrl,
      baseBranch: requireSdlcBaseBranch(repo.baseBranch),
    };
    if (!access.token || !access.credential) return { envelope: null, repository };

    const credential = await this.withAccountIdentity(actor, access.credential, access.adapter);
    const auth = access.adapter.buildGitAuthentication({
      token: access.token,
      identityLogin: credential.identityLogin,
    });
    const payload: SdlcSandboxGitCredential = {
      provider: access.repository.provider,
      host: access.repository.host,
      cloneUrl: access.repository.cloneUrl,
      username: auth.username,
      password: auth.password,
      accountName: credential.accountName!,
      accountEmail: credential.accountEmail!,
    };
    const envelope = encryptSandboxCredentialEnvelope(
      payload,
      {
        workspaceId: repo.workspaceId,
        repoId: repo.id,
        actorUserId: actor.userId,
        sandboxId: binding.sandboxId,
        credentialRevision: credential.revision,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(legacy
          ? {
              agentSlug: SDLC_AGENT_SLUG,
              operation: 'INTERACTIVE',
              conversationId: binding.conversationId!,
            }
          : {}),
      },
      sandboxPublicKey
    );
    return { envelope, repository };
  }

  async createPullRequest(input: CreateSdlcPullRequestInput) {
    const repo = await this.prisma.repo.findUnique({ where: { id: input.repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    // Single-repo claim only: a grant's repoIds must never authorize a write.
    const { actor } = this.runActor(input, repo, { singleRepository: true });
    await this.requireRepositoryMember(actor, repo.id);
    await this.requireCapabilities(actor, repo.id, ['READ_REPOSITORY', 'CREATE_PULL_REQUEST']);
    const expectedBase = requireSdlcBaseBranch(repo.baseBranch);
    if (!expectedBase || input.base !== expectedBase) {
      throw new AppError('Pull request base must match the configured base branch', 409);
    }
    if (!isSafeSdlcGitRef(input.head) || input.head === input.base) {
      throw new AppError('Refusing to create a pull request from the default branch', 409);
    }
    const { adapter, repository, token } = await this.repositoryAccess(this.prisma, repo);
    if (!token) throw new AppError('Repository credential is not connected', 409);
    try {
      await adapter.verifyRemoteCommit(token, repository, input.head, input.commitHash);
      const result = await adapter.createPullRequest(token, {
        owner: repository.owner,
        repository: repository.name,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
        draft: input.draft,
      });
      if (result.head !== input.head || result.base !== input.base) {
        throw new VcsProviderError(
          'PULL_REQUEST_MISMATCH',
          'Created pull request does not match the requested head and base',
          502
        );
      }
      return result;
    } catch (error) {
      const mapped = this.providerError(error);
      if ([401, 403].includes(mapped.httpStatus)) {
        await this.markRuntimeFailure(
          repo.id,
          'CREATE_PULL_REQUEST',
          `${mapped.httpStatus} ${mapped.message}`
        );
      }
      throw this.toAppError(mapped);
    }
  }

  async inspectPullRequest(repoId: string, number: number) {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) {
      throw new AppError('SDLC repository not found', 404);
    }
    const { adapter, repository, token } = await this.repositoryAccess(this.prisma, repo);
    if (!token) throw new AppError('Repository credential is not connected', 409);
    try {
      const result = await adapter.inspectPullRequest(token, repository, number);
      if (!adapter.validatePullRequestUrl(repository, result.url)) {
        throw new VcsProviderError(
          'PULL_REQUEST_MISMATCH',
          'The Provider returned a pull request outside the attached repository',
          502
        );
      }
      return result;
    } catch (error) {
      const mapped = this.providerError(error);
      if ([401, 403].includes(mapped.httpStatus)) {
        await this.markRuntimeFailure(
          repo.id,
          mapped.httpStatus === 401 ? 'CLONE' : 'CREATE_PULL_REQUEST',
          `${mapped.httpStatus} ${mapped.message}`
        );
      }
      throw this.toAppError(mapped);
    }
  }

  async verifySourcePaths(repoId: string, commitHash: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { adapter, repository, token } = await this.repositoryAccessById(repoId);
    try {
      await adapter.verifyPathsAtCommit(token, repository, commitHash, paths);
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async verifySourceRanges(
    repoId: string,
    commitHash: string,
    references: import('./types').SourceLineRange[]
  ): Promise<void> {
    if (references.length === 0) return;
    const { adapter, repository, token } = await this.repositoryAccessById(repoId);
    try {
      await adapter.verifySourceRangesAtCommit(token, repository, commitHash, references);
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async resolveBaseBranchHead(repoId: string): Promise<string> {
    const { adapter, repository, token, baseBranch } = await this.repositoryAccessById(repoId);
    try {
      return await adapter.resolveBranchHead(token, repository, baseBranch);
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async listBaseBranchFirstParentHistory(repoId: string) {
    const { adapter, repository, token, baseBranch } = await this.repositoryAccessById(repoId);
    try {
      return await adapter.listFirstParentHistory(token, repository, baseBranch);
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  private async repositoryAccessById(repoId: string) {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    return {
      ...(await this.repositoryAccess(this.prisma, repo)),
      baseBranch: requireSdlcBaseBranch(repo.baseBranch),
    };
  }

  private async repositoryAccess(client: Db, repo: RepositoryRow): Promise<RepositoryAccess> {
    const repository = this.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    const stored =
      repo.workspaceId && repo.vcsCredentialId
        ? await this.credentialStore.find(client, repo.workspaceId, repo.vcsCredentialId)
        : null;
    // A credential for another host must never be sent to this one.
    const credential =
      stored && stored.provider === repository.provider && stored.host === repository.host
        ? stored
        : null;
    return {
      adapter: this.adapter(repository.provider, repository.host),
      repository,
      credential,
      token: isUsable(credential) ? credential.token : undefined,
    };
  }

  /** Rows saved before identity was stored get it on first use. */
  private async withAccountIdentity(
    actor: SdlcActor,
    credential: StoredSdlcVcsCredential & { token: string | null },
    adapter: VcsProviderAdapter
  ): Promise<StoredSdlcVcsCredential> {
    if (credential.accountName && credential.accountEmail && credential.identityLogin) {
      return credential;
    }
    let validation;
    try {
      validation = await adapter.validateCredential(credential.token!);
    } catch (error) {
      throw this.toAppError(error);
    }
    return this.credentialStore.save(this.prisma, {
      ...credential,
      identityLogin: validation.identityLogin,
      accountName: validation.accountName,
      accountEmail: validation.accountEmail,
      updatedBy: actor.userId,
      updatedAt: new Date().toISOString(),
    });
  }

  private runActor(
    input: {
      workspaceId?: string | undefined;
      actorUserId?: string | undefined;
      interactiveGrant?: string | undefined;
      conversationId?: string | undefined;
      agentSlug?: string | undefined;
    },
    repo: { id: string; workspaceId: string | null },
    options: { singleRepository?: boolean } = {}
  ): { actor: SdlcActor; legacy: boolean } {
    if (input.workspaceId && input.actorUserId) {
      if (input.workspaceId !== repo.workspaceId) {
        throw new AppError('SDLC repository not found', 404);
      }
      return { actor: { userId: input.actorUserId, workspaceId: input.workspaceId }, legacy: false };
    }
    let grant;
    try {
      grant = verifySdlcInteractiveGrant(input.interactiveGrant ?? '', grantSecret());
    } catch {
      throw new AppError('Invalid or expired SDLC interactive grant', 403);
    }
    const covers = options.singleRepository
      ? grant.repoId === repo.id
      : sdlcGrantCoversRepo(grant, repo.id);
    if (
      (input.agentSlug !== undefined && input.agentSlug !== SDLC_AGENT_SLUG) ||
      !covers ||
      grant.workspaceId !== repo.workspaceId ||
      grant.conversationId !== input.conversationId
    ) {
      throw new AppError('SDLC interactive binding mismatch', 403);
    }
    return { actor: { userId: grant.actorUserId, workspaceId: grant.workspaceId }, legacy: true };
  }

  private refreshAfterCredentialInvalidation(
    credentialId: string | null,
    input: { workspaceId: string; userId: string },
    excludeRepoId: string
  ): void {
    if (!credentialId) return;
    void this.refreshCredentialRepositories(
      { workspaceId: input.workspaceId, userId: input.userId },
      credentialId,
      excludeRepoId
    );
  }

  /** Callers do not await this; the UI re-checks anything left unproven. */
  private async refreshCredentialRepositories(
    actor: SdlcActor,
    credentialId: string,
    excludeRepoId?: string
  ): Promise<void> {
    try {
      const repositories = await this.prisma.repo.findMany({
        where: {
          workspaceId: actor.workspaceId,
          vcsCredentialId: credentialId,
          projectId: { not: null },
          ...(excludeRepoId && { id: { not: excludeRepoId } }),
        },
        select: { id: true },
      });
      await this.refreshRepositories(
        actor,
        repositories.map((repository) => repository.id)
      );
    } catch (error) {
      logger.warn('[SDLC] automatic repository access refresh could not start', {
        workspaceId: actor.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async refreshRepositories(actor: SdlcActor, repoIds: string[]): Promise<void> {
    // ponytail: fixed chunk size to stay under Provider rate limits; use a real
    // limiter only if workspaces grow past a few dozen repositories.
    for (let index = 0; index < repoIds.length; index += ACCESS_REFRESH_CHUNK) {
      const chunk = repoIds.slice(index, index + ACCESS_REFRESH_CHUNK);
      const outcomes = await Promise.allSettled(
        chunk.map((repoId) =>
          this.performRepositoryCheck({
            repoId,
            workspaceId: actor.workspaceId,
            userId: actor.userId,
          })
        )
      );
      outcomes.forEach((outcome, offset) => {
        if (outcome.status !== 'rejected') return;
        logger.warn('[SDLC] automatic repository access refresh failed', {
          repoId: chunk[offset],
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      });
    }
  }

  private async invalidateCredential(input: {
    workspaceId: string;
    userId: string;
    credential: StoredSdlcVcsCredential;
    error: VcsProviderError;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, input.credential.id);
      const current = await this.credentialStore.find(tx, input.workspaceId, input.credential.id);
      if (
        !current ||
        current.revision !== input.credential.revision ||
        current.status !== 'CONNECTED'
      ) {
        return;
      }
      const now = new Date().toISOString();
      await this.credentialStore.save(tx, {
        ...current,
        validationStatus: 'INVALID',
        validatedAt: now,
        validationErrorCode: input.error.code,
        validationErrorMessage: `${PROVIDER_LABEL[current.provider]} rejected this key. It may be expired or revoked; replace it to restore repository write access.`,
        updatedBy: input.userId,
        updatedAt: now,
      });
      await this.resetLinkedCapabilities(tx, input.workspaceId, current.id);
    });
  }

  private async resetLinkedCapabilities(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    credentialId: string
  ): Promise<void> {
    await tx.repo.updateMany({
      where: { workspaceId, vcsCredentialId: credentialId },
      data: { accessCapabilities: [] },
    });
  }

  private async credentialUnchanged(
    tx: Prisma.TransactionClient,
    repo: RepositoryRow,
    expectedState: string | null
  ): Promise<boolean> {
    if (!repo.workspaceId) return false;
    const current = await tx.repo.findUnique({
      where: { id: repo.id },
      select: { vcsCredentialId: true },
    });
    if ((current?.vcsCredentialId ?? null) !== repo.vcsCredentialId) return false;
    if (!repo.vcsCredentialId) return expectedState === null;
    await this.credentialStore.lock(tx, repo.vcsCredentialId);
    const credential = await this.credentialStore.find(tx, repo.workspaceId, repo.vcsCredentialId);
    const repository = this.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    const matching =
      credential && credential.provider === repository.provider && credential.host === repository.host
        ? credential
        : null;
    return this.credentialState(matching) === expectedState;
  }

  private adapter(provider: VcsProvider, host: string): VcsProviderAdapter {
    if (provider === 'GITHUB') return this.github;
    if (provider === 'BITBUCKET_SERVER') {
      let adapter = this.bitbucket.get(host);
      if (!adapter) {
        adapter = new BitbucketServerVcsAdapter(host);
        this.bitbucket.set(host, adapter);
      }
      return adapter;
    }
    throw new AppError(`Unsupported VCS provider: ${provider}`, 400);
  }

  private async listedCredential(actor: SdlcActor, credentialId: string): Promise<unknown> {
    return (await this.listCredentials(actor)).find(
      (value) => (value as { id?: string }).id === credentialId
    );
  }

  private async requireCredential(
    workspaceId: string,
    credentialId: string,
    client: Db = this.prisma
  ): Promise<StoredSdlcVcsCredential> {
    const credential = await this.credentialStore.find(client, workspaceId, credentialId);
    if (!credential) throw new AppError('Repository credential not found', 404);
    return credential;
  }

  private async requireWorkspaceUser(actor: SdlcActor) {
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, workspaceId: actor.workspaceId },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError('Workspace user not found', 403);
    return user;
  }

  private async requireWorkspaceAdmin(actor: SdlcActor): Promise<void> {
    const user = await this.requireWorkspaceUser(actor);
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new AppError('Workspace owner or admin access is required', 403);
    }
  }

  /** Reached through its project. For repo-scoped writes use requireRepositoryMember. */
  private async requireProjectRepository(actor: SdlcActor, repoId: string) {
    const repo = await this.prisma.repo.findFirst({
      where: { id: repoId, workspaceId: actor.workspaceId, projectId: { not: null } },
    });
    if (!repo?.projectId) throw new AppError('SDLC repository not found', 404);
    await requireSdlcProjectAccess(
      this.prisma,
      actor,
      repo.projectId,
      'You must be a project participant to check this repository'
    );
    return repo;
  }

  private async requireRepositoryMember(actor: SdlcActor, repoId: string) {
    const [repo, membership] = await Promise.all([
      this.prisma.repo.findFirst({
        where: { id: repoId, workspaceId: actor.workspaceId, projectId: { not: null } },
      }),
      findSdlcMembershipForActor(this.prisma, {
        workspaceId: actor.workspaceId,
        repoId,
        userId: actor.userId,
      }),
    ]);
    if (!repo) throw new AppError('SDLC repository not found', 404);
    if (!membership) throw new AppError('You are not a member of this repository', 403);
    return repo;
  }

  private credentialState(credential: StoredSdlcVcsCredential | null): string | null {
    if (!credential) return null;
    return [
      credential.id,
      credential.revision,
      credential.status,
      credential.validationStatus,
      credential.updatedAt,
    ].join(':');
  }

  private baseBranch(value: Prisma.JsonValue): string | undefined {
    return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
  }

  private providerError(error: unknown): VcsProviderError {
    if (error instanceof VcsProviderError) return error;
    if (error instanceof AppError) {
      return new VcsProviderError('VCS_REQUEST_REJECTED', error.message, error.statusCode);
    }
    return new VcsProviderError(
      'VCS_ACCESS_CHECK_FAILED',
      'Repository access check failed',
      502,
      true
    );
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const mapped = this.providerError(error);
    return new AppError(mapped.message, mapped.httpStatus);
  }

  private async audit(actor: SdlcActor, targetId: string, action: string): Promise<void> {
    const eventType =
      action === 'created'
        ? ACLAuditEventType.RESOURCE_CREATED
        : action === 'disconnected'
          ? ACLAuditEventType.RESOURCE_DELETED
          : ACLAuditEventType.RESOURCE_UPDATED;
    await this.prisma.aCLAuditLog.create({
      data: {
        workspaceId: actor.workspaceId,
        actorUserId: actor.userId,
        eventType,
        targetType: ACLAuditTargetType.RESOURCE,
        targetId,
        description: `SDLC VCS credential ${action}; metadata only`,
      },
    });
  }

  private accessCheckAudit(
    input: { workspaceId: string; userId: string },
    repoId: string,
    outcome: string,
    client: Db = this.prisma
  ) {
    return client.aCLAuditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.userId,
        eventType: ACLAuditEventType.RESOURCE_UPDATED,
        targetType: ACLAuditTargetType.RESOURCE,
        targetId: repoId,
        description: `SDLC VCS repository access check completed: ${outcome}; metadata only`,
      },
    });
  }
}

export const sdlcVcs = new SdlcVcsService();
