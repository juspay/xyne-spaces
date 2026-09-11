import { SDLC_AGENT_SLUG } from '@xyne/shared';
import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { allBaselinesReady } from './sdlcProgressiveGate';
import { findSdlcMembershipForActor, repoIdsForChannel } from './sdlcChannelMembership';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import type { SdlcActor } from './types';
import { sdlcVcs } from './vcs';
import { issueSdlcInteractiveGrant } from './vcs/sdlcInteractiveGrant';

export type SdlcAgentOperation = 'interactive' | 'baseline' | 'work' | 'wiki';
export type SdlcWikiAgentRole =
  | 'BOOTSTRAP_SURVEY'
  | 'BOOTSTRAP_PAGE'
  | 'BOOTSTRAP_EDITOR'
  | 'BOOTSTRAP'
  | 'GENERATOR'
  | 'ARCHITECTURE_VALIDATOR'
  | 'CORRECTOR';

export interface SdlcAgentContextInput {
  operation: SdlcAgentOperation;
  channelId?: string;
  workflowExecutionId?: string;
  sessionId?: string;
  conversationId?: string;
  setupExecutionId?: string;
  baselineKind?: string;
  generationCommit?: string;
  artifactId?: string;
  ticketId?: string;
  sourceType?: 'CANVAS' | 'TICKET';
  sourceId?: string;
  wikiRole?: SdlcWikiAgentRole;
  wikiAssignedCommitShas?: string[];
  wikiBootstrapRef?: string | null;
  wikiTargetHeadSha?: string | null;
}

export interface SdlcAgentContext {
  version: 1;
  operation: SdlcAgentOperation;
  workspaceId: string;
  projectId: string;
  channelId: string;
  actorUserId: string;
  /**
   * The repository claw clones and binds its SDLC tools to. Claw drops every
   * trusted tool binding and refuses `sandbox-repo-setup` without it, so a hub
   * run names one even though the grant covers the whole hub.
   */
  repository?: { id: string; name: string; url: string; baseBranch: string };
  permissions: { repositoryRole: 'ADMIN' | 'MEMBER' };
  gates: {
    capabilities: unknown[];
    allBaselinesApproved: boolean;
  };
  execution: {
    workflowExecutionId: string | null;
    sessionId: string | null;
    conversationId: string | null;
  };
  interactiveGrant: string | null;
  artifact: {
    kind: string | null;
    id: string | null;
    sourceType: string | null;
    sourceId: string | null;
  };
  ticketId: string | null;
  setupExecutionId: string | null;
  baselineKind: string | null;
  generationCommit: string | null;
  wiki: {
    role: SdlcWikiAgentRole | null;
    assignedCommitShas: string[];
    bootstrapRef: string | null;
    targetHeadSha: string | null;
  };
}

export class SdlcAgentContextService {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async build(
    actor: SdlcActor,
    repoId: string,
    input: SdlcAgentContextInput
  ): Promise<SdlcAgentContext> {
    const [repo, membership] = await Promise.all([
      this.prisma.repo.findFirst({
        where: { id: repoId, workspaceId: actor.workspaceId, projectId: { not: null } },
        select: {
          id: true,
          name: true,
          url: true,
          canonicalUrl: true,
          baseBranch: true,
          projectId: true,
          accessCapabilities: true,
        },
      }),
      findSdlcMembershipForActor(this.prisma, {
        workspaceId: actor.workspaceId,
        repoId,
        userId: actor.userId,
        ...(input.channelId ? { channelId: input.channelId } : {}),
      }),
    ]);
    if (!repo?.projectId) throw new AppError('SDLC repository not found', 404);
    if (!membership) {
      throw new AppError(
        input.channelId
          ? 'This repository is not part of that SDLC Hub'
          : 'You are not a member of this repository',
        403
      );
    }
    const channelId = membership.channelId;
    const baselines = await this.prisma.sdlcArtifact.findMany({
      where: { repoId: repo.id, canvas: { is: { channelId } } },
      select: { artifactType: true, artifactStatus: true },
    });
    const parsed = sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url);
    return {
      version: 1,
      operation: input.operation,
      workspaceId: actor.workspaceId,
      projectId: repo.projectId,
      channelId,
      actorUserId: actor.userId,
      repository: {
        id: repo.id,
        name: repo.name,
        url: parsed.cloneUrl,
        baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      },
      permissions: {
        repositoryRole: membership.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      },
      gates: {
        capabilities: Array.isArray(repo.accessCapabilities) ? repo.accessCapabilities : [],
        // Wire-compat field name: claw-auth validates gates["allBaselinesApproved"].
        // Semantics are now "all baselines generation-READY" (approval flow removed).
        allBaselinesApproved: allBaselinesReady(baselines),
      },
      execution: {
        workflowExecutionId: input.workflowExecutionId ?? null,
        sessionId: input.sessionId ?? null,
        conversationId: input.conversationId ?? null,
      },
      interactiveGrant:
        input.operation === 'interactive' && input.conversationId
          ? issueSdlcInteractiveGrant(
              {
                agentSlug: SDLC_AGENT_SLUG,
                workspaceId: actor.workspaceId,
                repoId: repo.id,
                actorUserId: actor.userId,
                conversationId: input.conversationId,
              },
              process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || ''
            )
          : null,
      artifact: {
        kind: null,
        id: input.artifactId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
      ticketId: input.ticketId ?? null,
      setupExecutionId: input.setupExecutionId ?? null,
      baselineKind: input.baselineKind ?? null,
      generationCommit: input.generationCommit ?? null,
      wiki: {
        role: input.wikiRole ?? null,
        assignedCommitShas: input.wikiAssignedCommitShas ?? [],
        bootstrapRef: input.wikiBootstrapRef ?? null,
        targetHeadSha: input.wikiTargetHeadSha ?? null,
      },
    };
  }

  /**
   * Context for a run spanning a whole hub. A hub run has no execution row for
   * `bootstrapSandboxCredential` to check, so the grant carries the scope instead:
   * every repository in the hub, read-only.
   *
   * One repository is still named: a sandbox clones exactly one, and claw binds
   * its SDLC tools to `repository.id` rather than to anything the agent passes.
   */
  async buildForHub(
    actor: SdlcActor,
    channelId: string,
    input: SdlcAgentContextInput
  ): Promise<SdlcAgentContext> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, workspaceId: actor.workspaceId },
      select: {
        projectId: true,
        participants: { where: { userId: actor.userId }, select: { role: true }, take: 1 },
      },
    });
    if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
    const role = channel.participants[0]?.role;
    if (!role) throw new AppError('You are not a member of this SDLC hub', 403);

    const repoIds = await repoIdsForChannel(this.prisma, channelId);
    if (repoIds.length === 0) throw new AppError('This SDLC hub has no repositories', 409);

    const repo = await this.prisma.repo.findFirst({
      where: { id: repoIds[0]!, workspaceId: actor.workspaceId },
      select: { id: true, name: true, url: true, canonicalUrl: true, baseBranch: true },
    });
    if (!repo) throw new AppError('SDLC repository not found', 404);
    const parsed = sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url);

    return {
      version: 1,
      operation: input.operation,
      workspaceId: actor.workspaceId,
      projectId: channel.projectId,
      channelId,
      actorUserId: actor.userId,
      repository: {
        id: repo.id,
        name: repo.name,
        url: parsed.cloneUrl,
        baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      },
      permissions: { repositoryRole: role === 'ADMIN' ? 'ADMIN' : 'MEMBER' },
      gates: { capabilities: [], allBaselinesApproved: false },
      execution: {
        workflowExecutionId: input.workflowExecutionId ?? null,
        sessionId: input.sessionId ?? null,
        conversationId: input.conversationId ?? null,
      },
      interactiveGrant: input.conversationId
        ? issueSdlcInteractiveGrant(
            {
              agentSlug: SDLC_AGENT_SLUG,
              workspaceId: actor.workspaceId,
              repoIds,
              actorUserId: actor.userId,
              conversationId: input.conversationId,
            },
            process.env['INTERNAL_S2S_KEY'] || process.env['XYNE_CLAW_S2S_KEY'] || ''
          )
        : null,
      artifact: {
        kind: null,
        id: input.artifactId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
      ticketId: input.ticketId ?? null,
      setupExecutionId: null,
      baselineKind: null,
      generationCommit: input.generationCommit ?? null,
      wiki: {
        role: null,
        assignedCommitShas: [],
        bootstrapRef: null,
        targetHeadSha: null,
      },
    };
  }
}

export const sdlcAgentContext = new SdlcAgentContextService();
