import { Prisma, type PrismaClient } from '@prisma/client';
import { ACLAuditEventType, ACLAuditTargetType,
  SDLC_AGENT_SLUG,
} from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import type { SdlcActor } from '../types';
import { isSafeSdlcGitRef, requireSdlcBaseBranch } from '../sdlcRepositoryContext';
import { credentialFingerprint } from './credentialEnvelope';
import { GitHubVcsAdapter } from './GitHubVcsAdapter';
import { SdlcVcsCredentialStore, type StoredSdlcVcsCredential } from './SdlcVcsCredentialStore';
import { classifyRuntimeAccessFailure } from './accessCheckPolicy';
import { blockedCapabilities, deriveAccessStatus, readCapabilities } from './accessStatus';
import {
  encryptSandboxCredentialEnvelope,
  parseSandboxPublicKey,
  type SandboxCredentialEnvelope,
} from './sandboxCredentialEnvelope';
import type {
  RepositoryAccessCheckResult,
  SdlcVcs,
  VcsCapability,
  VcsProvider,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';
import { verifySdlcInteractiveGrant } from './sdlcInteractiveGrant';
import { findSdlcMembershipForActor } from '../sdlcChannelMembership';
import { requireSdlcProjectAccess } from '../sdlcProjectAccess';

const adapters: Record<VcsProvider, VcsProviderAdapter> = {
  GITHUB: new GitHubVcsAdapter(),
};

const ACCESS_REFRESH_CHUNK = 5;

const activeExecutionStatuses = ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING', 'EXTERNAL_WAIT'];

export class SdlcVcsService implements SdlcVcs {
  private readonly credentialStore = new SdlcVcsCredentialStore();

  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  parseRepository(provider: VcsProvider, url: string) {
    return this.adapter(provider).parseRepositoryUrl(url);
  }

  async listCredentials(actor: SdlcActor): Promise<unknown[]> {
    const user = await this.requireWorkspaceUser(actor);
    const rows = await this.credentialStore.list(this.prisma, actor.workspaceId);
    const counts = await this.repositoryCountsByProvider(actor.workspaceId);
    return rows.map((row) => ({
      provider: row.provider,
      status: row.status,
      revision: row.revision,
      identityLogin: row.identityLogin,
      resourceOwner: row.resourceOwner,
      fingerprint: row.fingerprint,
      validationStatus: row.validationStatus,
      validatedAt: row.validatedAt,
      validationErrorCode: row.validationErrorCode,
      validationErrorMessage: row.validationErrorMessage,
      disconnectedAt: row.disconnectedAt,
      updatedAt: row.updatedAt,
      attachedRepositoryCount: counts.get(row.provider) ?? 0,
      canManage: user.role === 'OWNER' || user.role === 'ADMIN',
    }));
  }

  async configureCredential(
    actor: SdlcActor,
    provider: VcsProvider,
    input: { token: string; resourceOwner: string }
  ): Promise<unknown> {
    await this.requireWorkspaceAdmin(actor);
    const adapter = this.adapter(provider);
    let validation;
    try {
      validation = await adapter.validateCredential(input.token, input.resourceOwner);
    } catch (error) {
      throw this.toAppError(error);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, actor.workspaceId, provider);
      const current = await this.credentialStore.find(tx, actor.workspaceId, provider);
      const revision = (current?.revision ?? 0) + 1;
      const now = new Date().toISOString();
      const saved = await this.credentialStore.save(tx, {
        ...(current ? { id: current.id } : {}),
        workspaceId: actor.workspaceId,
        provider,
        status: 'CONNECTED',
        token: input.token,
        revision,
        identityLogin: validation.identityLogin,
        resourceOwner: validation.resourceOwner,
        fingerprint: credentialFingerprint(input.token),
        validationStatus: 'VALID',
        validatedAt: now,
        validationErrorCode: null,
        validationErrorMessage: null,
        createdBy: current?.createdBy ?? actor.userId,
        updatedBy: actor.userId,
        disconnectedAt: null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
      const repoIds = await this.repositoryIdsForProvider(tx, actor.workspaceId, provider);
      await tx.repo.updateMany({
        where: { id: { in: repoIds } },
        data: { accessCapabilities: [] },
      });
      return saved;
    });
    await this.audit(actor, row.id, row.revision === 1 ? 'created' : 'replaced');
    void this.refreshWorkspaceRepositories(actor, provider);
    return (await this.listCredentials(actor)).find(
      (value) => (value as { provider?: string }).provider === provider
    );
  }

  async revalidateCredential(actor: SdlcActor, provider: VcsProvider): Promise<unknown> {
    await this.requireWorkspaceAdmin(actor);
    const row = await this.requireConnectedCredential(actor.workspaceId, provider);
    try {
      const validation = await this.adapter(provider).validateCredential(
        row.token,
        row.resourceOwner
      );
      const now = new Date().toISOString();
      await this.prisma.$transaction(async (tx) => {
        await this.credentialStore.save(tx, {
          ...row,
          validationStatus: 'VALID',
          validatedAt: now,
          validationErrorCode: null,
          validationErrorMessage: null,
          identityLogin: validation.identityLogin,
          resourceOwner: validation.resourceOwner,
          updatedBy: actor.userId,
          updatedAt: now,
        });
        const repoIds = await this.repositoryIdsForProvider(tx, actor.workspaceId, provider);
        await tx.repo.updateMany({
          where: { id: { in: repoIds } },
          data: { accessCapabilities: [] },
        });
      });
      await this.audit(actor, row.id, 'validated');
      void this.refreshWorkspaceRepositories(actor, provider);
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
        const repoIds = await this.repositoryIdsForProvider(tx, actor.workspaceId, provider);
        await tx.repo.updateMany({
          where: { id: { in: repoIds } },
          data: { accessCapabilities: [] },
        });
      });
      await this.audit(actor, row.id, 'validation_failed');
      throw this.toAppError(mapped);
    }
    return (await this.listCredentials(actor)).find(
      (value) => (value as { provider?: string }).provider === provider
    );
  }

  async disconnectCredential(actor: SdlcActor, provider: VcsProvider): Promise<void> {
    await this.requireWorkspaceAdmin(actor);
    const row = await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, actor.workspaceId, provider);
      const current = await this.credentialStore.find(tx, actor.workspaceId, provider);
      if (!current) throw new AppError('Workspace credential not found', 404);
      const now = new Date().toISOString();
      const disconnected = await this.credentialStore.save(tx, {
        ...current,
        status: 'DISCONNECTED',
        token: null,
        revision: current.revision + 1,
        validationStatus: 'DISCONNECTED',
        validationErrorCode: null,
        validationErrorMessage: null,
        disconnectedAt: now,
        updatedBy: actor.userId,
        updatedAt: now,
      });
      const repoIds = await this.repositoryIdsForProvider(tx, actor.workspaceId, provider);
      await tx.repo.updateMany({
        where: { id: { in: repoIds } },
        data: { accessCapabilities: [] },
      });
      return disconnected;
    });
    await this.audit(actor, row.id, 'disconnected');
    void this.refreshWorkspaceRepositories(actor, provider);
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
    const credentialInvalid = failureKind === 'CREDENTIAL_INVALID';
    const capability =
      operation === 'CLONE'
        ? 'READ_REPOSITORY'
        : operation === 'PUSH'
          ? 'PUSH_BRANCH'
          : 'CREATE_PULL_REQUEST';
    const repo = await this.prisma.repo.findUnique({
      where: { id: repoId },
      select: {
        accessCapabilities: true,
        workspaceId: true,
        createdBy: true,
      },
    });
    if (!repo) return;
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
    if (!credentialInvalid) {
      await this.prisma.repo.update({
        where: { id: repoId },
        data: { accessCapabilities: capabilities as unknown as Prisma.InputJsonValue },
      });
      return;
    }
    if (!repo.workspaceId) return;
    const credential = await this.credentialStore.find(this.prisma, repo.workspaceId, 'GITHUB');
    if (!credential) return;
    await this.invalidateWorkspaceCredential({
      workspaceId: repo.workspaceId,
      userId: repo.createdBy,
      provider: 'GITHUB',
      credentialId: credential.id,
      credentialRevision: credential.revision,
      error: new VcsProviderError(
        'GITHUB_CREDENTIAL_INVALID',
        'GitHub rejected the workspace key',
        401
      ),
    });
    void this.refreshWorkspaceRepositories(
      { workspaceId: repo.workspaceId, userId: repo.createdBy },
      'GITHUB'
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
    const provider: VcsProvider = 'GITHUB';
    const adapter = this.adapter(provider);
    let credentialInvalidated = false;
    let credentialState: string | null = null;
    try {
      const parsed = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
      const credential = await this.credentialStore.find(this.prisma, input.workspaceId, provider);
      credentialState = this.credentialState(credential);
      let token: string | undefined;
      if (
        credential?.status === 'CONNECTED' &&
        credential.validationStatus === 'VALID' &&
        credential.token
      ) {
        token = credential.token;
      }
      let inspection;
      let fallbackError: VcsProviderError | null = null;
      if (token) {
        if (
          credential?.resourceOwner &&
          credential.resourceOwner.toLowerCase() !== parsed.owner.toLowerCase()
        ) {
          fallbackError = new VcsProviderError(
            'GITHUB_RESOURCE_OWNER_MISMATCH',
            `Workspace credential is limited to ${credential.resourceOwner}`,
            403
          );
        } else {
          try {
            inspection = await adapter.inspectRepository({
              repository: parsed,
              baseBranch: this.baseBranch(repo.baseBranch),
              token,
            });
          } catch (error) {
            fallbackError = this.providerError(error);
            if (fallbackError.retryable) throw fallbackError;
            if (fallbackError.code === 'GITHUB_CREDENTIAL_INVALID' && credential) {
              await this.invalidateWorkspaceCredential({
                workspaceId: input.workspaceId,
                userId: input.userId,
                provider,
                credentialId: credential.id,
                credentialRevision: credential.revision,
                error: fallbackError,
              });
              credentialInvalidated = true;
            }
          }
        }
        if (!inspection) {
          try {
            inspection = await adapter.inspectRepository({
              repository: parsed,
              baseBranch: this.baseBranch(repo.baseBranch),
            });
          } catch {
            throw fallbackError;
          }
          token = undefined;
        }
      } else {
        inspection = await adapter.inspectRepository({
          repository: parsed,
          baseBranch: this.baseBranch(repo.baseBranch),
        });
      }
      await this.prisma.$transaction(async (tx) => {
        await this.credentialStore.lock(tx, input.workspaceId, provider);
        const currentCredential = await this.credentialStore.find(tx, input.workspaceId, provider);
        if (this.credentialState(currentCredential) !== credentialState) {
          throw new VcsProviderError(
            'CREDENTIAL_CHANGED_DURING_CHECK',
            'Workspace credential changed during repository access check',
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
      this.refreshAfterCredentialInvalidation(credentialInvalidated, input, provider, repo.id);
      return {
        status: 'READY',
        errorMessage: null,
        capabilities: inspection.capabilities,
      };
    } catch (error) {
      const mapped = this.providerError(error);
      // Transient trouble is not evidence of missing access, and inline there is no Bull
      // retry — leave stored capabilities alone rather than blanking on a 503.
      if (mapped.retryable) {
        await this.accessCheckAudit(input, repo.id, mapped.code);
        this.refreshAfterCredentialInvalidation(credentialInvalidated, input, provider, repo.id);
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
        await this.credentialStore.lock(tx, input.workspaceId, provider);
        const currentCredential = await this.credentialStore.find(tx, input.workspaceId, provider);
        if (this.credentialState(currentCredential) !== credentialState) return true;
        await tx.repo.update({
          where: { id: repo.id },
          data: { accessCapabilities: capabilities as unknown as Prisma.InputJsonValue },
        });
        await this.accessCheckAudit(input, repo.id, mapped.code, tx);
        return false;
      });
      this.refreshAfterCredentialInvalidation(credentialInvalidated, input, provider, repo.id);
      if (stale) {
        return {
          status: 'ERROR',
          errorMessage: 'Workspace credential changed during repository access check',
          capabilities: readCapabilities(repo.accessCapabilities),
        };
      }
      return { status: 'BLOCKED', errorMessage: mapped.message, capabilities };
    }
  }

  private refreshAfterCredentialInvalidation(
    invalidated: boolean,
    input: { workspaceId: string; userId: string },
    provider: VcsProvider,
    excludeRepoId: string
  ): void {
    if (!invalidated) return;
    void this.refreshWorkspaceRepositories(
      { workspaceId: input.workspaceId, userId: input.userId },
      provider,
      excludeRepoId
    );
  }

  async requireCapabilities(
    actor: SdlcActor,
    repoId: string,
    required: VcsCapability[]
  ): Promise<void> {
    const repo = await this.requireRepositoryMember(actor, repoId);
    const credential = await this.credentialStore.find(this.prisma, actor.workspaceId, 'GITHUB');
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
    if (
      required.some((value) => value !== 'READ_REPOSITORY') &&
      (credential?.status !== 'CONNECTED' || credential.validationStatus !== 'VALID')
    ) {
      throw new AppError('Replace or reconnect the workspace GitHub key before starting work', 409);
    }
  }

  async bootstrapSandboxCredential(binding: {
    agentSlug: typeof SDLC_AGENT_SLUG;
    repoId: string;
    operation: 'CLONE' | 'PUSH' | 'INTERACTIVE';
    sandboxId: string;
    sandboxPublicKey: string;
  } & (
    | { executionId: string; sessionId: string }
    | { interactiveGrant: string; conversationId: string }
  )): Promise<SandboxCredentialEnvelope | null> {
    const repo = await this.prisma.repo.findUnique({
      where: { id: binding.repoId },
      select: { id: true, workspaceId: true },
    });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);

    let actor: SdlcActor;
    let envelopeAuthority: { executionId?: string; sessionId?: string; conversationId?: string };
    if ('interactiveGrant' in binding) {
      let grant;
      try {
        grant = verifySdlcInteractiveGrant(
          binding.interactiveGrant,
          process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || ''
        );
      } catch {
        throw new AppError('Invalid or expired SDLC interactive grant', 403);
      }
      if (
        binding.agentSlug !== SDLC_AGENT_SLUG ||
        binding.operation !== 'INTERACTIVE' ||
        grant.repoId !== repo.id ||
        grant.workspaceId !== repo.workspaceId ||
        grant.conversationId !== binding.conversationId
      ) {
        throw new AppError('Sandbox credential interactive binding mismatch', 403);
      }
      actor = { userId: grant.actorUserId, workspaceId: grant.workspaceId };
      await this.requireRepositoryMember(actor, repo.id);
      envelopeAuthority = { conversationId: grant.conversationId };
    } else {
      const execution = await this.prisma.workflowExecution.findFirst({
        // Callback/handoff recovery may park an already-dispatched execution
        // in PENDING while its bound Claw session is still active.
        where: { id: binding.executionId, status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true, workspaceId: true, createdBy: true, context: true },
      });
      if (!execution?.createdBy) throw new AppError('Active SDLC execution binding not found', 404);
      let context: Record<string, unknown>;
      try {
        context = JSON.parse(execution.context || '{}') as Record<string, unknown>;
      } catch {
        throw new AppError('SDLC execution context is invalid', 409);
      }
      if (
        binding.agentSlug !== SDLC_AGENT_SLUG ||
        context['agentSlug'] !== SDLC_AGENT_SLUG ||
        (execution.workspaceId !== null && execution.workspaceId !== repo.workspaceId) ||
        context['repoId'] !== repo.id ||
        (context['credentialSessionId'] ?? context['sessionId']) !== binding.sessionId ||
        (context['phase'] === 'IMPLEMENTING' ? 'PUSH' : 'CLONE') !== binding.operation
      ) {
        throw new AppError('Sandbox credential execution binding mismatch', 403);
      }
      actor = { userId: execution.createdBy, workspaceId: repo.workspaceId };
      envelopeAuthority = { executionId: execution.id, sessionId: binding.sessionId };
    }
    let sandboxPublicKey: ReturnType<typeof parseSandboxPublicKey>;
    try {
      sandboxPublicKey = parseSandboxPublicKey(binding.sandboxPublicKey);
    } catch {
      throw new AppError('Invalid sandbox public key', 400);
    }
    const required: VcsCapability[] =
      binding.operation === 'PUSH' ? ['READ_REPOSITORY', 'PUSH_BRANCH'] : ['READ_REPOSITORY'];
    await this.requireCapabilities(actor, repo.id, required);
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    if (!credential && binding.operation === 'PUSH') {
      throw new AppError('Workspace GitHub credential is not connected', 409);
    }
    if (!credential) return null;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const auth = this.adapter('GITHUB').buildGitAuthentication(credential.token);
    return encryptSandboxCredentialEnvelope(
      auth,
      {
        agentSlug: binding.agentSlug,
        workspaceId: repo.workspaceId,
        repoId: repo.id,
        operation: binding.operation,
        ...envelopeAuthority,
        sandboxId: binding.sandboxId,
        credentialRevision: credential.revision,
        expiresAt,
      },
      sandboxPublicKey
    );
  }

  async createDraftPullRequest(input: {
    repoId: string;
    title: string;
    body: string;
    head: string;
    base: string;
    commitHash: string;
  } & (
    | { executionId: string; sessionId: string }
    | { interactiveGrant: string; conversationId: string }
  )) {
    const repo = await this.prisma.repo.findUnique({ where: { id: input.repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    let actor: SdlcActor;
    if ('interactiveGrant' in input) {
      let grant;
      try {
        grant = verifySdlcInteractiveGrant(
          input.interactiveGrant,
          process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || ''
        );
      } catch {
        throw new AppError('Invalid or expired SDLC interactive grant', 403);
      }
      if (
        grant.repoId !== repo.id ||
        grant.workspaceId !== repo.workspaceId ||
        grant.conversationId !== input.conversationId
      ) {
        throw new AppError('Pull request interactive binding mismatch', 403);
      }
      actor = { userId: grant.actorUserId, workspaceId: grant.workspaceId };
      await this.requireRepositoryMember(actor, repo.id);
    } else {
      const execution = await this.prisma.workflowExecution.findFirst({
        where: { id: input.executionId, status: { in: activeExecutionStatuses } },
        select: { id: true, workspaceId: true, createdBy: true, context: true },
      });
      if (!execution?.createdBy) throw new AppError('Active SDLC execution binding not found', 404);
      let context: Record<string, unknown>;
      try {
        context = JSON.parse(execution.context || '{}') as Record<string, unknown>;
      } catch {
        throw new AppError('SDLC execution context is invalid', 409);
      }
      if (
        context['agentSlug'] !== SDLC_AGENT_SLUG ||
        context['phase'] !== 'IMPLEMENTING' ||
        (execution.workspaceId !== null && execution.workspaceId !== repo.workspaceId) ||
        context['repoId'] !== repo.id ||
        (context['credentialSessionId'] ?? context['sessionId']) !== input.sessionId
      ) {
        throw new AppError('Pull request execution binding mismatch', 403);
      }
      actor = { userId: execution.createdBy, workspaceId: repo.workspaceId };
    }
    await this.requireCapabilities(actor, repo.id, ['READ_REPOSITORY', 'CREATE_PULL_REQUEST']);
    const credential = await this.requireConnectedCredential(repo.workspaceId, 'GITHUB');
    const expectedBase = requireSdlcBaseBranch(repo.baseBranch);
    if (!expectedBase || input.base !== expectedBase) {
      throw new AppError('Pull request base must match the configured base branch', 409);
    }
    if (!isSafeSdlcGitRef(input.head) || input.head === input.base) {
      throw new AppError('Refusing to create a pull request from the default branch', 409);
    }
    const adapter = this.adapter('GITHUB');
    const parsed = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      await adapter.verifyRemoteCommit(credential.token, parsed, input.head, input.commitHash);
      const result = await adapter.createDraftPullRequest(credential.token, {
        owner: parsed.owner,
        repository: parsed.name,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      });
      if (!result.draft || result.head !== input.head || result.base !== input.base) {
        throw new VcsProviderError(
          'GITHUB_PULL_REQUEST_MISMATCH',
          'Created pull request does not match required draft/head/base',
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
    const credential = await this.requireConnectedCredential(repo.workspaceId, 'GITHUB');
    const token = credential.token;
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      const result = await adapter.inspectPullRequest(token, repository, number);
      if (!adapter.validatePullRequestUrl(repository, result.url)) {
        throw new VcsProviderError(
          'GITHUB_PULL_REQUEST_MISMATCH',
          'GitHub returned a pull request outside the attached repository',
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
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    if (paths.length === 0) return;
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      await adapter.verifyPathsAtCommit(credential?.token, repository, commitHash, paths);
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async verifySourceRanges(
    repoId: string,
    commitHash: string,
    references: import('./types').SourceLineRange[]
  ): Promise<void> {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    if (references.length === 0) return;
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      await adapter.verifySourceRangesAtCommit(
        credential?.token,
        repository,
        commitHash,
        references
      );
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async verifyBaseBranchHead(repoId: string, commitHash: string): Promise<void> {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      await adapter.verifyRemoteCommit(
        credential?.token,
        repository,
        requireSdlcBaseBranch(repo.baseBranch),
        commitHash
      );
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async resolveBaseBranchHead(repoId: string): Promise<string> {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      return await adapter.resolveBranchHead(
        credential?.token,
        repository,
        requireSdlcBaseBranch(repo.baseBranch)
      );
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  async listBaseBranchFirstParentHistory(repoId: string) {
    const repo = await this.prisma.repo.findUnique({ where: { id: repoId } });
    if (!repo?.workspaceId) throw new AppError('SDLC repository not found', 404);
    const credential = await this.connectedCredential(repo.workspaceId, 'GITHUB');
    const adapter = this.adapter('GITHUB');
    const repository = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      return await adapter.listFirstParentHistory(
        credential?.token,
        repository,
        requireSdlcBaseBranch(repo.baseBranch)
      );
    } catch (error) {
      throw this.toAppError(this.providerError(error));
    }
  }

  adapterFor(provider: VcsProvider): VcsProviderAdapter {
    return this.adapter(provider);
  }

  /** Callers do not await this; the UI re-checks anything left unproven. */
  private async refreshWorkspaceRepositories(
    actor: SdlcActor,
    provider: VcsProvider,
    excludeRepoId?: string
  ): Promise<void> {
    try {
      await this.runWorkspaceRefresh(actor, provider, excludeRepoId);
    } catch (error) {
      logger.warn('[SDLC] automatic repository access refresh could not start', {
        workspaceId: actor.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runWorkspaceRefresh(
    actor: SdlcActor,
    provider: VcsProvider,
    excludeRepoId?: string
  ): Promise<void> {
    const repositories = await this.prisma.repo.findMany({
      where: {
        workspaceId: actor.workspaceId,
        projectId: { not: null },
        ...(excludeRepoId && { id: { not: excludeRepoId } }),
      },
      select: { id: true, canonicalUrl: true, url: true },
    });
    const providerRepositories = repositories.filter((repository) =>
      this.repositoryMatchesProvider(repository, provider)
    );
    // ponytail: fixed chunk size to stay under GitHub's secondary rate limits; use a real
    // limiter only if workspaces grow past a few dozen repositories.
    for (let index = 0; index < providerRepositories.length; index += ACCESS_REFRESH_CHUNK) {
      const chunk = providerRepositories.slice(index, index + ACCESS_REFRESH_CHUNK);
      const outcomes = await Promise.allSettled(
        chunk.map((repository) =>
          this.performRepositoryCheck({
            repoId: repository.id,
            workspaceId: actor.workspaceId,
            userId: actor.userId,
          })
        )
      );
      outcomes.forEach((outcome, offset) => {
        if (outcome.status !== 'rejected') return;
        logger.warn('[SDLC] automatic repository access refresh failed', {
          repoId: chunk[offset]?.id,
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      });
    }
  }

  private async invalidateWorkspaceCredential(input: {
    workspaceId: string;
    userId: string;
    provider: VcsProvider;
    credentialId: string;
    credentialRevision: number;
    error: VcsProviderError;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.credentialStore.lock(tx, input.workspaceId, input.provider);
      const current = await this.credentialStore.find(tx, input.workspaceId, input.provider);
      if (
        current?.id !== input.credentialId ||
        current.revision !== input.credentialRevision ||
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
        validationErrorMessage:
          'GitHub rejected this key. It may be expired or revoked; replace it to restore repository write access.',
        updatedBy: input.userId,
        updatedAt: now,
      });
      const repoIds = await this.repositoryIdsForProvider(tx, input.workspaceId, input.provider);
      await tx.repo.updateMany({
        where: { id: { in: repoIds } },
        data: { accessCapabilities: [] },
      });
    });
  }

  private repositoryMatchesProvider(
    repository: { canonicalUrl: string | null; url: string },
    provider: VcsProvider
  ): boolean {
    try {
      this.adapter(provider).parseRepositoryUrl(repository.canonicalUrl || repository.url);
      return true;
    } catch {
      return false;
    }
  }

  private async repositoryIdsForProvider(
    client: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    provider: VcsProvider
  ): Promise<string[]> {
    const repositories = await client.repo.findMany({
      where: { workspaceId, projectId: { not: null } },
      select: { id: true, canonicalUrl: true, url: true },
    });
    return repositories
      .filter((repository) => this.repositoryMatchesProvider(repository, provider))
      .map((repository) => repository.id);
  }

  private async repositoryCountsByProvider(workspaceId: string): Promise<Map<VcsProvider, number>> {
    const counts = new Map<VcsProvider, number>();
    for (const provider of Object.keys(adapters) as VcsProvider[]) {
      counts.set(
        provider,
        (await this.repositoryIdsForProvider(this.prisma, workspaceId, provider)).length
      );
    }
    return counts;
  }

  private adapter(provider: VcsProvider): VcsProviderAdapter {
    const adapter = adapters[provider];
    if (!adapter) throw new AppError(`Unsupported VCS provider: ${provider}`, 400);
    return adapter;
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

  private async requireConnectedCredential(
    workspaceId: string,
    provider: VcsProvider
  ): Promise<StoredSdlcVcsCredential & { token: string; resourceOwner: string }> {
    const row = await this.connectedCredential(workspaceId, provider);
    if (!row) {
      throw new AppError('Workspace GitHub credential is not connected', 409);
    }
    return row;
  }

  private async connectedCredential(
    workspaceId: string,
    provider: VcsProvider
  ): Promise<(StoredSdlcVcsCredential & { token: string; resourceOwner: string }) | null> {
    const row = await this.credentialStore.find(this.prisma, workspaceId, provider);
    if (
      !row ||
      row.status !== 'CONNECTED' ||
      row.validationStatus !== 'VALID' ||
      !row.token ||
      !row.resourceOwner
    ) {
      return null;
    }
    return row as StoredSdlcVcsCredential & { token: string; resourceOwner: string };
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
    return error instanceof VcsProviderError
      ? error
      : new VcsProviderError(
          'VCS_ACCESS_CHECK_FAILED',
          'Repository access check failed',
          502,
          true
        );
  }

  private toAppError(error: unknown): AppError {
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
    client: PrismaClient | Prisma.TransactionClient = this.prisma
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
