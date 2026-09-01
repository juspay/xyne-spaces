import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { allBaselinesReady } from './sdlcProgressiveGate';
import { findSdlcMembershipForActor } from './sdlcChannelMembership';
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
  repository: { id: string; name: string; url: string; baseBranch: string };
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
      }),
    ]);
    if (!repo?.projectId) throw new AppError('SDLC repository not found', 404);
    if (!membership) throw new AppError('You are not a member of this repository', 403);
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
                agentSlug: 'sdlc-agent',
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
}

export const sdlcAgentContext = new SdlcAgentContextService();
