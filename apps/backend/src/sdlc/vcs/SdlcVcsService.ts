import {
  createHash,
  randomUUID,
} from 'crypto';
import {
  Prisma,
  type PrismaClient,
  type SdlcVcsRuntimeGrant,
} from '@prisma/client';
import { ACLAuditEventType, ACLAuditTargetType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { sdlcAccessCheckQueue } from '@/queues/sdlcAccessCheckQueue';
import { logger } from '@/utils/logger';
import type { SdlcActor } from '../types';
import { isSafeSdlcGitRef, requireSdlcBaseBranch } from '../sdlcRepositoryContext';
import { credentialFingerprint } from './credentialEnvelope';
import { GitHubVcsAdapter } from './GitHubVcsAdapter';
import {
  SdlcVcsCredentialStore,
  type StoredSdlcVcsCredential,
} from './SdlcVcsCredentialStore';
import { classifyRuntimeAccessFailure, shouldEnsureRepositoryAccess } from './accessCheckPolicy';
import {
  encryptSandboxCredentialEnvelope,
  parseSandboxPublicKey,
  type SandboxCredentialEnvelope,
} from './sandboxCredentialEnvelope';
import type {
  CapabilityEvidence,
  RepositoryAccessCheckResult,
  RuntimeGrant,
  SdlcVcs,
  VcsCapability,
  VcsProvider,
  VcsProviderAdapter,
} from './types';
import { VcsProviderError } from './types';

const adapters: Record<VcsProvider, VcsProviderAdapter> = {
  GITHUB: new GitHubVcsAdapter(),
};

const activeExecutionStatuses = ['NEW', 'PENDING', 'SCHEDULED', 'RUNNING', 'EXTERNAL_WAIT'];
// This is only a lease for recovering a stuck queue job. It is not a credential TTL.
const ACCESS_CHECK_RUNNING_LEASE_MS = 5 * 60_000;
const CREDENTIAL_FEATURE_FLAG = 'sdlcVcsCredentialsV1';
const SDLC_AGENT_SLUG = 'sdlc-agent';

export class SdlcVcsService implements SdlcVcs {
  private readonly credentialStore = new SdlcVcsCredentialStore();

  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  parseRepository(provider: VcsProvider, url: string) {
    return this.adapter(provider).parseRepositoryUrl(url);
  }

  async listCredentials(actor: SdlcActor): Promise<unknown[]> {
    await this.requireCredentialFeature(actor.workspaceId);
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
    await this.requireCredentialFeature(actor.workspaceId);
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
        data: {
          accessCheckStatus: 'STALE',
          accessErrorCode: 'CREDENTIAL_REVISION_CHANGED',
          accessErrorMessage:
            'Repository access must be checked with the current workspace credential',
        },
      });
      return saved;
    });
    await this.audit(actor, row.id, row.revision === 1 ? 'created' : 'replaced');
    await this.queueWorkspaceRepositoryChecks(actor, provider);
    return (await this.listCredentials(actor)).find(
      (value) => (value as { provider?: string }).provider === provider
    );
  }

  async revalidateCredential(actor: SdlcActor, provider: VcsProvider): Promise<unknown> {
    await this.requireCredentialFeature(actor.workspaceId);
    await this.requireWorkspaceAdmin(actor);
    const row = await this.requireConnectedCredential(actor.workspaceId, provider);
    try {
      const validation = await this.adapter(provider).validateCredential(row.token, row.resourceOwner);
      const now = new Date().toISOString();
      await this.credentialStore.save(this.prisma, {
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
      await this.audit(actor, row.id, 'validated');
      const repoIds = await this.repositoryIdsForProvider(this.prisma, actor.workspaceId, provider);
      await this.prisma.repo.updateMany({
        where: { id: { in: repoIds } },
        data: {
          accessCheckStatus: 'STALE',
          accessErrorCode: 'CREDENTIAL_REVALIDATED',
          accessErrorMessage: 'Repository access is refreshing automatically',
        },
      });
      await this.queueWorkspaceRepositoryChecks(actor, provider);
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
          data: {
            accessCheckStatus: 'STALE',
            accessErrorCode: mapped.code,
            accessErrorMessage: `${mapped.message}. Fix or replace the credential, then check access again.`,
          },
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
    await this.requireCredentialFeature(actor.workspaceId);
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
        data: {
          accessCheckStatus: 'STALE',
          accessErrorCode: 'CREDENTIAL_DISCONNECTED',
          accessErrorMessage: 'Workspace credential disconnected; check access again',
        },
      });
      return disconnected;
    });
    await this.audit(actor, row.id, 'disconnected');
    await this.queueWorkspaceRepositoryChecks(actor, provider);
  }

  async queueRepositoryCheck(
    actor: SdlcActor,
    repoId: string,
    options: { force?: boolean } = {}
  ): Promise<RepositoryAccessCheckResult> {
    const repo = await this.requireRepositoryMember(actor, repoId);
    const credential = await this.credentialStore.find(this.prisma, actor.workspaceId, 'GITHUB');
    const shouldQueue = shouldEnsureRepositoryAccess({
      repository: {
        status: repo.accessCheckStatus,
        errorCode: repo.accessErrorCode,
        startedAt: repo.accessCheckStartedAt,
        credentialRevision: repo.accessCredentialRevision,
      },
      credential,
      force: options.force,
      runningLeaseMs: ACCESS_CHECK_RUNNING_LEASE_MS,
    });
    if (!shouldQueue) {
      return {
        queued: false,
        status: repo.accessCheckStatus,
        checkedAt: repo.accessCheckedAt?.toISOString() ?? null,
      };
    }
    return this.claimAndEnqueueRepositoryCheck({
      repoId: repo.id,
      workspaceId: actor.workspaceId,
      userId: actor.userId,
    });
  }

  private async claimAndEnqueueRepositoryCheck(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }): Promise<RepositoryAccessCheckResult> {
    const startedAt = new Date();
    const staleBefore = new Date(startedAt.getTime() - ACCESS_CHECK_RUNNING_LEASE_MS);
    const claimed = await this.prisma.repo.updateMany({
      where: {
        id: input.repoId,
        OR: [
          { accessCheckStatus: { notIn: ['QUEUED', 'CHECKING'] } },
          { accessCheckStartedAt: null },
          { accessCheckStartedAt: { lt: staleBefore } },
        ],
      },
      data: {
        accessCheckStatus: 'QUEUED',
        accessCheckStartedAt: startedAt,
        accessErrorCode: null,
        accessErrorMessage: null,
      },
    });
    if (claimed.count === 0) {
      return { queued: false, status: 'CHECKING', checkedAt: null };
    }
    try {
      await sdlcAccessCheckQueue.enqueue(input);
    } catch (error) {
      await this.prisma.repo.updateMany({
        where: { id: input.repoId, accessCheckStartedAt: startedAt },
        data: {
          accessCheckStatus: 'BLOCKED',
          accessErrorCode: 'ACCESS_CHECK_QUEUE_UNAVAILABLE',
          accessErrorMessage: 'Could not queue repository access check',
        },
      });
      throw error;
    }
    return { queued: true, status: 'QUEUED', checkedAt: null };
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
    const capabilities = this.capabilities(repo.accessCapabilities).map((item) =>
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
        data: {
          accessCheckStatus: 'READY',
          accessCapabilities: capabilities as unknown as Prisma.InputJsonValue,
          accessErrorCode: 'REPOSITORY_WRITE_PERMISSION_REQUIRED',
          accessErrorMessage:
            'The workspace key is valid, but GitHub denied this repository operation. Grant the required repository permissions before retrying Start Work.',
        },
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
    await this.queueWorkspaceRepositoryChecks(
      { workspaceId: repo.workspaceId, userId: repo.createdBy },
      'GITHUB'
    );
  }

  async performRepositoryCheck(input: {
    repoId: string;
    workspaceId: string;
    userId: string;
  }): Promise<void> {
    const repo = await this.prisma.repo.findFirst({
      where: { id: input.repoId, workspaceId: input.workspaceId, projectId: { not: null } },
    });
    if (!repo) throw new Error('SDLC repository not found');
    await this.prisma.repo.update({
      where: { id: repo.id },
      data: { accessCheckStatus: 'CHECKING', accessCheckStartedAt: new Date() },
    });
    const provider: VcsProvider = 'GITHUB';
    const adapter = this.adapter(provider);
    let credentialInvalidated = false;
    try {
      const parsed = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
      const credential = (await this.credentialFeatureEnabled(input.workspaceId))
        ? await this.credentialStore.find(this.prisma, input.workspaceId, provider)
        : null;
      let token: string | undefined;
      const credentialRevision = credential?.revision ?? null;
      let identityLogin: string | null = null;
      if (
        credential?.status === 'CONNECTED' &&
        credential.validationStatus === 'VALID' &&
        credential.token
      ) {
        token = credential.token;
        identityLogin = credential.identityLogin;
      }
      let inspection;
      let fallbackError: VcsProviderError | null = null;
      const storedCredentialError =
        credential?.status === 'DISCONNECTED'
          ? new VcsProviderError(
              'CREDENTIAL_DISCONNECTED',
              'Workspace GitHub key is disconnected',
              409
            )
          : credential?.validationStatus === 'INVALID'
            ? new VcsProviderError(
                'GITHUB_CREDENTIAL_INVALID',
                'Workspace GitHub key is invalid',
                401
              )
            : null;
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
          identityLogin = null;
        }
      } else {
        inspection = await adapter.inspectRepository({
          repository: parsed,
          baseBranch: this.baseBranch(repo.baseBranch),
        });
      }
      await this.prisma.$transaction([
        this.prisma.repo.update({
          where: { id: repo.id },
          data: {
            canonicalUrl: inspection.repository.canonicalUrl,
            accessCheckStatus: 'READY',
            accessCapabilities: inspection.capabilities as unknown as Prisma.InputJsonValue,
            accessEvidence: {
              ...inspection.evidence,
              repositoryVisibility: inspection.visibility,
              identityLogin,
              credentialState:
                credentialInvalidated || credential?.validationStatus === 'INVALID'
                  ? 'INVALID'
                  : fallbackError
                    ? 'VALID_REPOSITORY_ACCESS_DENIED'
                    : token
                      ? 'CONNECTED'
                      : credential?.status === 'DISCONNECTED'
                        ? 'DISCONNECTED'
                        : 'ANONYMOUS',
              credentialErrorCode: fallbackError?.code,
            } as Prisma.InputJsonValue,
            accessCredentialRevision: credentialRevision,
            accessCheckedAt: new Date(),
            accessErrorCode: (fallbackError ?? storedCredentialError)?.code ?? null,
            accessErrorMessage:
              fallbackError || storedCredentialError
                ? this.repositoryCredentialErrorMessage(
                    fallbackError ?? storedCredentialError!,
                    parsed.owner
                  )
                : null,
          },
        }),
        this.accessCheckAudit(input, repo.id, fallbackError?.code ?? 'READY'),
      ]);
      if (credentialInvalidated) {
        await this.queueWorkspaceRepositoryChecks(
          { workspaceId: input.workspaceId, userId: input.userId },
          provider,
          repo.id
        );
      }
    } catch (error) {
      const mapped = this.providerError(error);
      const preserveLastVerifiedEvidence =
        mapped.retryable &&
        repo.accessCheckStatus === 'READY' &&
        this.capabilities(repo.accessCapabilities).some((item) => item.state === 'PROVEN');
      await this.prisma.$transaction([
        this.prisma.repo.update({
          where: { id: repo.id },
          data: {
            accessCheckStatus: preserveLastVerifiedEvidence ? 'READY' : 'BLOCKED',
            ...(!preserveLastVerifiedEvidence && {
              accessCheckedAt: new Date(),
              accessCapabilities: this.unavailableCapabilities(
                mapped
              ) as unknown as Prisma.InputJsonValue,
            }),
            accessErrorCode: mapped.code,
            accessErrorMessage: preserveLastVerifiedEvidence
              ? `${mapped.message}; using the last verified repository access evidence`
              : mapped.message,
          },
        }),
        this.accessCheckAudit(input, repo.id, mapped.code),
      ]);
      if (credentialInvalidated) {
        await this.queueWorkspaceRepositoryChecks(
          { workspaceId: input.workspaceId, userId: input.userId },
          provider,
          repo.id
        );
      }
      throw mapped;
    }
  }

  async requireCapabilities(
    actor: SdlcActor,
    repoId: string,
    required: VcsCapability[]
  ): Promise<void> {
    const repo = await this.requireRepositoryMember(actor, repoId);
    if (repo.accessCheckStatus !== 'READY') {
      throw new AppError('Run repository access check before continuing', 409);
    }
    const credential = await this.credentialStore.find(this.prisma, actor.workspaceId, 'GITHUB');
    if (
      repo.accessCredentialRevision !== null &&
      repo.accessCredentialRevision !== credential?.revision
    ) {
      throw new AppError('Repository access check is stale; check access again', 409);
    }
    const evidence = this.capabilities(repo.accessCapabilities);
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

  async issueRuntimeGrant(input: {
    actor: SdlcActor;
    repoId: string;
    executionId: string;
    sessionId: string;
    operation: 'CLONE' | 'PUSH' | 'CREATE_PULL_REQUEST';
  }): Promise<RuntimeGrant> {
    await this.requireCredentialFeature(input.actor.workspaceId);
    const required: VcsCapability[] =
      input.operation === 'CLONE'
        ? ['READ_REPOSITORY']
        : input.operation === 'PUSH'
          ? ['READ_REPOSITORY', 'PUSH_BRANCH']
          : ['READ_REPOSITORY', 'CREATE_PULL_REQUEST'];
    await this.requireCapabilities(input.actor, input.repoId, required);
    const credential = await this.requireConnectedCredential(input.actor.workspaceId, 'GITHUB');
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const grantId = randomUUID();
    await this.prisma.sdlcVcsRuntimeGrant.create({
      data: {
        id: grantId,
        workspaceId: input.actor.workspaceId,
        repoId: input.repoId,
        provider: 'GITHUB',
        operation: input.operation,
        credentialRevision: credential.revision,
        executionId: input.executionId,
        sessionId: input.sessionId,
        expiresAt,
      },
    });
    return { grantId, expiresAt: expiresAt.toISOString() };
  }

  async bootstrapSandboxCredential(binding: {
    agentSlug: typeof SDLC_AGENT_SLUG;
    executionId: string;
    sessionId: string;
    repoId: string;
    operation: 'CLONE' | 'PUSH';
    sandboxId: string;
    sandboxPublicKey: string;
  }): Promise<SandboxCredentialEnvelope> {
    const [execution, repo] = await Promise.all([
      this.prisma.workflowExecution.findFirst({
        where: { id: binding.executionId, status: 'RUNNING' },
        select: { id: true, workspaceId: true, createdBy: true, context: true },
      }),
      this.prisma.repo.findUnique({
        where: { id: binding.repoId },
        select: { id: true, workspaceId: true },
      }),
    ]);
    if (!execution?.createdBy || !repo?.workspaceId) {
      throw new AppError('Active SDLC execution binding not found', 404);
    }
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
    const publicKeyHash = createHash('sha256')
      .update(Buffer.from(binding.sandboxPublicKey, 'base64'))
      .digest('hex');
    const priorBootstrap = await this.prisma.sdlcVcsRuntimeGrant.findFirst({
      where: {
        executionId: execution.id,
        sessionId: binding.sessionId,
        repoId: repo.id,
        operation: binding.operation,
        sandboxId: binding.sandboxId,
        sandboxPublicKeyHash: publicKeyHash,
      },
      select: { id: true },
    });
    if (priorBootstrap) throw new AppError('Sandbox credential bootstrap was already used', 409);
    const grant = await this.issueRuntimeGrant({
      actor: { userId: execution.createdBy, workspaceId: repo.workspaceId },
      repoId: repo.id,
      executionId: execution.id,
      sessionId: binding.sessionId,
      operation: binding.operation,
    });
    return this.redeemRuntimeGrant(grant.grantId, binding);
  }

  private async redeemRuntimeGrant(
    grantId: string,
    binding: {
      agentSlug: typeof SDLC_AGENT_SLUG;
      executionId: string;
      sessionId: string;
      repoId: string;
      operation: 'CLONE' | 'PUSH';
      sandboxId: string;
      sandboxPublicKey: string;
    }
  ): Promise<SandboxCredentialEnvelope> {
    let sandboxPublicKey: ReturnType<typeof parseSandboxPublicKey>;
    try {
      sandboxPublicKey = parseSandboxPublicKey(binding.sandboxPublicKey);
    } catch {
      throw new AppError('Invalid sandbox public key', 400);
    }
    const publicKeyHash = createHash('sha256')
      .update(Buffer.from(binding.sandboxPublicKey, 'base64'))
      .digest('hex');
    let grant: SdlcVcsRuntimeGrant;
    try {
      grant = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "workflow"."sdlc_vcs_runtime_grants" WHERE "id" = ${grantId} FOR UPDATE`;
        const current = await tx.sdlcVcsRuntimeGrant.findUnique({ where: { id: grantId } });
        if (!current) throw new AppError('Runtime grant not found', 404);
        if (current.redeemedAt) throw new AppError('Runtime grant was already redeemed', 409);
        if (current.expiresAt.getTime() <= Date.now())
          throw new AppError('Runtime grant expired', 410);
        if (
          current.executionId !== binding.executionId ||
          current.sessionId !== binding.sessionId ||
          current.repoId !== binding.repoId ||
          current.operation !== binding.operation
        ) {
          throw new AppError('Runtime grant binding mismatch', 403);
        }
        const execution = await tx.workflowExecution.findFirst({
          where: { id: current.executionId, status: { in: activeExecutionStatuses } },
          select: { id: true },
        });
        if (!execution) throw new AppError('Runtime grant workflow is inactive', 409);
        await tx.sdlcVcsRuntimeGrant.update({
          where: { id: current.id },
          data: {
            redeemedAt: new Date(),
            sandboxId: binding.sandboxId,
            sandboxPublicKeyHash: publicKeyHash,
            envelopeIssuedAt: new Date(),
          },
        });
        return current;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('Sandbox credential bootstrap was already used', 409);
      }
      throw error;
    }
    const credential = await this.requireConnectedCredential(grant.workspaceId, 'GITHUB');
    if (credential.revision !== grant.credentialRevision) {
      throw new AppError('Runtime grant credential revision is stale', 409);
    }
    const token = credential.token;
    const auth = this.adapter('GITHUB').buildGitAuthentication(token);
    return encryptSandboxCredentialEnvelope(auth, {
      grantId,
      agentSlug: binding.agentSlug,
      workspaceId: grant.workspaceId,
      repoId: grant.repoId,
      operation: grant.operation,
      executionId: grant.executionId,
      sessionId: grant.sessionId,
      sandboxId: binding.sandboxId,
      credentialRevision: grant.credentialRevision,
      expiresAt: grant.expiresAt.toISOString(),
    }, sandboxPublicKey);
  }

  async createDraftPullRequestFromGrant(
    input: {
      executionId: string;
      sessionId: string;
      repoId: string;
      title: string;
      body: string;
      head: string;
      base: string;
      commitHash: string;
    }
  ) {
    const grant = await this.prisma.sdlcVcsRuntimeGrant.findFirst({
      where: {
        executionId: input.executionId,
        sessionId: input.sessionId,
        repoId: input.repoId,
        operation: 'CREATE_PULL_REQUEST',
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!grant) throw new AppError('Runtime grant not found', 404);
    const repo = await this.prisma.repo.findFirst({
      where: { id: grant.repoId, workspaceId: grant.workspaceId },
    });
    if (!repo) throw new AppError('SDLC repository not found', 404);
    const expectedBase = requireSdlcBaseBranch(repo.baseBranch);
    if (!expectedBase || input.base !== expectedBase) {
      throw new AppError('Pull request base must match the configured base branch', 409);
    }
    if (!isSafeSdlcGitRef(input.head) || input.head === input.base) {
      throw new AppError('Refusing to create a pull request from the default branch', 409);
    }
    const credential = await this.redeemRuntimeGrantForBackend(grant.id, {
      executionId: input.executionId,
      sessionId: input.sessionId,
      repoId: repo.id,
      operation: 'CREATE_PULL_REQUEST',
    });
    const adapter = this.adapter('GITHUB');
    const parsed = adapter.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    try {
      await adapter.verifyRemoteCommit(credential.password, parsed, input.head, input.commitHash);
      const result = await adapter.createDraftPullRequest(credential.password, {
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

  private async redeemRuntimeGrantForBackend(
    grantId: string,
    binding: { executionId: string; sessionId: string; repoId: string; operation: 'CREATE_PULL_REQUEST' },
  ): Promise<{ password: string }> {
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "workflow"."sdlc_vcs_runtime_grants" WHERE "id" = ${grantId} FOR UPDATE`;
      const current = await tx.sdlcVcsRuntimeGrant.findUnique({ where: { id: grantId } });
      if (!current) throw new AppError('Runtime grant not found', 404);
      if (current.redeemedAt) throw new AppError('Runtime grant was already redeemed', 409);
      if (current.expiresAt.getTime() <= Date.now()) throw new AppError('Runtime grant expired', 410);
      if (current.executionId !== binding.executionId || current.sessionId !== binding.sessionId || current.repoId !== binding.repoId || current.operation !== binding.operation) {
        throw new AppError('Runtime grant binding mismatch', 403);
      }
      const execution = await tx.workflowExecution.findFirst({
        where: { id: current.executionId, status: { in: activeExecutionStatuses } },
        select: { id: true },
      });
      if (!execution) throw new AppError('Runtime grant workflow is inactive', 409);
      await tx.sdlcVcsRuntimeGrant.update({ where: { id: current.id }, data: { redeemedAt: new Date() } });
      return current;
    });
    const credential = await this.requireConnectedCredential(grant.workspaceId, 'GITHUB');
    if (credential.revision !== grant.credentialRevision) throw new AppError('Runtime grant credential revision is stale', 409);
    return { password: credential.token };
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

  adapterFor(provider: VcsProvider): VcsProviderAdapter {
    return this.adapter(provider);
  }

  private async queueWorkspaceRepositoryChecks(
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
    const outcomes = await Promise.allSettled(
      providerRepositories.map((repository) =>
        this.claimAndEnqueueRepositoryCheck({
          repoId: repository.id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
        })
      )
    );
    outcomes.forEach((outcome, index) => {
      if (outcome.status !== 'rejected') return;
      logger.warn('[SDLC] automatic repository access refresh could not be queued', {
        repoId: providerRepositories[index]?.id,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    });
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
        data: {
          accessCheckStatus: 'STALE',
          accessErrorCode: input.error.code,
          accessErrorMessage:
            'The workspace GitHub key expired or was revoked. Public access is refreshing automatically.',
        },
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

  private repositoryCredentialErrorMessage(error: VcsProviderError, owner: string): string {
    if (error.code === 'CREDENTIAL_DISCONNECTED') {
      return 'The workspace GitHub key is disconnected. Public read access remains available; connect a key to enable Start Work.';
    }
    if (error.code === 'GITHUB_CREDENTIAL_INVALID') {
      return 'The workspace GitHub key expired or was revoked. Public read access remains available; replace the key to restore Start Work.';
    }
    if (error.code === 'GITHUB_RESOURCE_OWNER_MISMATCH') {
      return `The workspace key is valid, but it is not issued for ${owner}. Replace it with a fine-grained key for this repository owner to enable Start Work.`;
    }
    if (
      error.code === 'GITHUB_ORG_APPROVAL_OR_PERMISSION_REQUIRED' ||
      error.code === 'GITHUB_REPOSITORY_NOT_FOUND'
    ) {
      return 'The workspace key is valid, but it lacks access to this repository. Grant repository Contents, Pull requests, and Workflows write permissions to enable Start Work.';
    }
    return `${error.message}. Public read access remains available; Start Work is unavailable.`;
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

  private async credentialFeatureEnabled(workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { metadata: true },
    });
    const metadata =
      workspace?.metadata &&
      typeof workspace.metadata === 'object' &&
      !Array.isArray(workspace.metadata)
        ? (workspace.metadata as Record<string, unknown>)
        : {};
    return metadata[CREDENTIAL_FEATURE_FLAG] === true;
  }

  private async requireCredentialFeature(workspaceId: string): Promise<void> {
    if (!(await this.credentialFeatureEnabled(workspaceId))) {
      throw new AppError('Workspace repository credentials are not enabled', 404);
    }
  }

  private async requireWorkspaceAdmin(actor: SdlcActor): Promise<void> {
    const user = await this.requireWorkspaceUser(actor);
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new AppError('Workspace owner or admin access is required', 403);
    }
  }

  private async requireRepositoryMember(actor: SdlcActor, repoId: string) {
    const repo = await this.prisma.repo.findFirst({
      where: {
        id: repoId,
        workspaceId: actor.workspaceId,
        projectId: { not: null },
        channelId: { not: null },
      },
      include: {
        channel: {
          select: {
            participants: { where: { userId: actor.userId }, select: { id: true, role: true } },
          },
        },
      },
    });
    if (!repo) throw new AppError('SDLC repository not found', 404);
    if (!repo.channel?.participants[0])
      throw new AppError('You are not a member of this repository', 403);
    return repo;
  }

  private async requireConnectedCredential(
    workspaceId: string,
    provider: VcsProvider
  ): Promise<StoredSdlcVcsCredential & { token: string; resourceOwner: string }> {
    const row = await this.credentialStore.find(this.prisma, workspaceId, provider);
    if (
      !row ||
      row.status !== 'CONNECTED' ||
      row.validationStatus !== 'VALID' ||
      !row.token ||
      !row.resourceOwner
    ) {
      throw new AppError('Workspace GitHub credential is not connected', 409);
    }
    return row as StoredSdlcVcsCredential & { token: string; resourceOwner: string };
  }

  private capabilities(value: Prisma.JsonValue | null): CapabilityEvidence[] {
    if (!Array.isArray(value)) return [];
    const result: CapabilityEvidence[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.capability === 'string' && typeof record.state === 'string') {
        result.push(record as unknown as CapabilityEvidence);
      }
    }
    return result;
  }

  private unavailableCapabilities(error: VcsProviderError): CapabilityEvidence[] {
    return (['READ_REPOSITORY', 'PUSH_BRANCH', 'CREATE_PULL_REQUEST'] as const).map(
      (capability) => ({
        capability,
        state: 'UNAVAILABLE',
        source: 'access-check',
        detail: error.message,
      })
    );
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
    outcome: string
  ) {
    return this.prisma.aCLAuditLog.create({
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
