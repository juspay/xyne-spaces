import type { PrismaClient } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { allBaselinesApproved } from './sdlcProgressiveGate';
import { requireSdlcBaseBranch } from './sdlcRepositoryContext';
import type { SdlcActor } from './types';
import { sdlcVcs } from './vcs';

export type SdlcAgentOperation = 'interactive' | 'baseline' | 'artifact' | 'work';

export interface SdlcAgentContextInput {
  operation: SdlcAgentOperation;
  workflowExecutionId?: string;
  sessionId?: string;
  conversationId?: string;
  setupExecutionId?: string;
  baselineKind?: string;
  artifactKind?: 'PRD' | 'TECH_DOC';
  artifactId?: string;
  ticketId?: string;
  sourceType?: 'CANVAS' | 'TICKET';
  sourceId?: string;
  writeRequested?: boolean;
}

export interface SdlcAgentContext {
  version: 1;
  operation: SdlcAgentOperation;
  workspaceId: string;
  projectId: string;
  channelId: string;
  actorUserId: string;
  repository: { id: string; name: string; url: string; baseBranch: string };
  permissions: { repositoryRole: 'ADMIN' | 'MEMBER'; writeRequested: boolean };
  gates: {
    capabilities: unknown[];
    allBaselinesApproved: boolean;
  };
  execution: {
    workflowExecutionId: string | null;
    sessionId: string | null;
    conversationId: string | null;
  };
  artifact: {
    kind: string | null;
    id: string | null;
    sourceType: string | null;
    sourceId: string | null;
  };
  ticketId: string | null;
  setupExecutionId: string | null;
  baselineKind: string | null;
}

export class SdlcAgentContextService {
  constructor(private readonly prisma: PrismaClient = DatabaseClient.getInstance()) {}

  async build(
    actor: SdlcActor,
    repoId: string,
    input: SdlcAgentContextInput,
  ): Promise<SdlcAgentContext> {
    const repo = await this.prisma.repo.findFirst({
      where: {
        id: repoId,
        workspaceId: actor.workspaceId,
        projectId: { not: null },
        channelId: { not: null },
      },
      select: {
        id: true,
        name: true,
        url: true,
        canonicalUrl: true,
        baseBranch: true,
        projectId: true,
        channelId: true,
        accessCapabilities: true,
        channel: {
          select: {
            participants: {
              where: { userId: actor.userId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!repo?.projectId || !repo.channelId) throw new AppError('SDLC repository not found', 404);
    const participant = repo.channel?.participants[0];
    if (!participant) throw new AppError('You are not a member of this repository', 403);
    const baselines = await this.prisma.canvas.findMany({
      where: { channelId: repo.channelId },
      select: { metadata: true },
    });
    const parsed = sdlcVcs.parseRepository('GITHUB', repo.canonicalUrl || repo.url);
    return {
      version: 1,
      operation: input.operation,
      workspaceId: actor.workspaceId,
      projectId: repo.projectId,
      channelId: repo.channelId,
      actorUserId: actor.userId,
      repository: {
        id: repo.id,
        name: repo.name,
        url: parsed.cloneUrl,
        baseBranch: requireSdlcBaseBranch(repo.baseBranch),
      },
      permissions: {
        repositoryRole: participant.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
        writeRequested: input.writeRequested === true,
      },
      gates: {
        capabilities: Array.isArray(repo.accessCapabilities) ? repo.accessCapabilities : [],
        allBaselinesApproved: allBaselinesApproved(baselines),
      },
      execution: {
        workflowExecutionId: input.workflowExecutionId ?? null,
        sessionId: input.sessionId ?? null,
        conversationId: input.conversationId ?? null,
      },
      artifact: {
        kind: input.artifactKind ?? null,
        id: input.artifactId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
      ticketId: input.ticketId ?? null,
      setupExecutionId: input.setupExecutionId ?? null,
      baselineKind: input.baselineKind ?? null,
    };
  }
}

export const sdlcAgentContext = new SdlcAgentContextService();
