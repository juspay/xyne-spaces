import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  AccessType,
  CHANNEL_NAME_MAX_LENGTH,
  ChannelRole,
  ChannelType,
  normalizeChannelName,
  validateChannelName,
} from '@xyne/shared';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { DatabaseClient } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { AppError } from '@/middleware/errorHandler';
import { sdlcAdmission } from '@/queues/sdlcAdmission';
import { sdlcQueue } from '@/queues/sdlcQueue';
import { logger } from '@/utils/logger';
import type { SdlcActor } from '../types';

const TAG = '[SDLC-TEARDOWN]';
const SDLC_WORKFLOW_TYPES = ['SDLC_SETUP', 'SDLC_WORK', 'SDLC_WIKI'] as const;
const ACTIVE_EXECUTION_STATUSES = ['NEW', 'PENDING', 'RUNNING', 'SCHEDULED'];
const channelRepository = new ChannelRepository();

export const sdlcHubTeardownSchema = z.object({
  dryRun: z.boolean().default(true),
  name: z.string().trim().min(1).max(120).optional(),
  /**
   * Tear down despite a PENDING/SCHEDULED execution. Never bypasses a live run:
   * an execution still holding an admission permit is refused either way.
   */
  force: z.boolean().default(false),
});
export type SdlcHubTeardownInput = z.infer<typeof sdlcHubTeardownSchema>;

/** The bull job id sdlcQueue minted for a run: `wiki:<executionId>`. */
const jobIdFor = (workflowType: string, executionId: string): string =>
  `${workflowType.replace('SDLC_', '').toLowerCase()}:${executionId}`;

export interface SdlcHubTeardownPlan {
  dryRun: boolean;
  channel: {
    id: string;
    workspaceId: string;
    projectId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  repo: Record<string, unknown> | null;
  delete: {
    sdlcEntityLinks: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
    workflowExecutions: Array<Record<string, unknown>>;
    knowledgeDocuments: Array<Record<string, unknown>>;
    repos: Array<Record<string, unknown>>;
    redis: { queueJobIds: string[]; admissionPermitIds: string[] };
  };
  stripMetadata: { canvases: Array<Record<string, unknown>> };
  /** Everything needed to put this hub back by hand. Logged before the write. */
  restore: {
    channel: Record<string, unknown>;
    repo: Record<string, unknown> | null;
    sdlcEntityLinks: Array<Record<string, unknown>>;
    canvasMetadata: Record<string, unknown>;
  };
  keep: {
    canvases: number;
    canvasFolders: number;
    conversations: number;
    messages: number;
    tickets: number;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

/**
 * Turn one SDLC hub channel back into an ordinary channel: delete the SDLC
 * bookkeeping, keep every document, conversation and ticket, and strip the SDLC
 * metadata off what stays. Archiving is left to the archiveChannel mutator, which
 * posts the system message. Dry run by default.
 */
export async function teardownSdlcHub(
  actor: SdlcActor,
  channelId: string,
  input: SdlcHubTeardownInput,
  prisma: PrismaClient = DatabaseClient.getInstance()
): Promise<SdlcHubTeardownPlan> {
  // The ACL extension scopes every read to channels the caller participates in, so
  // a hub they are not a member of reads as "not found" and the projects-admin
  // check below could never run — and the deletes would silently match no rows.
  // Authorization is done by hand here instead; every query carries an explicit
  // workspaceId or an id derived from one, so tenancy still holds.
  return runAsSystem(() => teardown(actor, channelId, input, prisma));
}

async function teardown(
  actor: SdlcActor,
  channelId: string,
  input: SdlcHubTeardownInput,
  prisma: PrismaClient
): Promise<SdlcHubTeardownPlan> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, workspaceId: actor.workspaceId },
    include: { participants: { where: { userId: actor.userId }, select: { role: true } } },
  });
  if (!channel) throw new AppError('Channel not found', 404);
  // A pre-fix hub has one participant — whoever attached the repo — and is hidden
  // from chat, so there is no UI route for anyone else to join it. A projects
  // admin is therefore also allowed through, the same escape hatch
  // SdlcHubService.requireProjectBoardAccess uses.
  const participant = channel.participants[0];
  const projectsAdmin = await prisma.resourceAccess.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      accessType: AccessType.ADMIN,
      resource: { name: 'LISTPROJECTS' },
      OR: [
        { userId: actor.userId },
        {
          userGroup: {
            workspaceId: actor.workspaceId,
            userGroupMappings: { some: { userId: actor.userId } },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!projectsAdmin) {
    if (!participant) throw new AppError('You are not a member of this channel', 403);
    if (participant.role !== ChannelRole.ADMIN) {
      throw new AppError('Channel admin access is required', 403);
    }
  }

  const channelMetadata = asRecord(channel.metadata);
  const repo = await prisma.repo.findFirst({
    where: { channelId, workspaceId: actor.workspaceId },
  });
  // metadata.repoId outlives an unguarded repos.delete, so an orphaned hub is still reachable.
  const repoId =
    repo?.id ?? (typeof channelMetadata.repoId === 'string' ? channelMetadata.repoId : null);
  if (channelMetadata.surface !== 'SDLC' && !repo) {
    throw new AppError('Channel is not an SDLC hub', 400);
  }

  const links = repoId
    ? await prisma.sdlcEntityLink.findMany({
        where: { workspaceId: actor.workspaceId, repoId },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          targetType: true,
          targetId: true,
          relationType: true,
        },
      })
    : [];

  // workflows.metadata is TEXT holding JSON, so the repo filter runs in JS.
  // ponytail: loads every SDLC row in the workspace; move to a
  // `metadata::jsonb->>'repoId'` predicate if one ever grows enough runs to hurt.
  const allWorkflows = repoId
    ? await prisma.workflow.findMany({
        where: { workspaceId: actor.workspaceId, workflowType: { in: [...SDLC_WORKFLOW_TYPES] } },
        select: { id: true, workflowType: true, workflowName: true, metadata: true },
      })
    : [];
  const workflows = allWorkflows.filter((row) => parseJsonRecord(row.metadata).repoId === repoId);
  const workflowIds = workflows.map((row) => row.id);

  const allExecutions = repoId
    ? await prisma.workflowExecution.findMany({
        where: { workspaceId: actor.workspaceId, workflowType: { in: [...SDLC_WORKFLOW_TYPES] } },
        select: { id: true, workflowId: true, workflowType: true, status: true, context: true },
      })
    : [];
  const executions = allExecutions.filter(
    (row) => workflowIds.includes(row.workflowId) || parseJsonRecord(row.context).repoId === repoId
  );

  const knowledgeDocuments = repoId
    ? await prisma.knowledgeDocument.findMany({
        where: { workspaceId: actor.workspaceId, metadata: { path: ['repoId'], equals: repoId } },
        select: { id: true, title: true },
      })
    : [];

  const folders = await prisma.canvasFolder.findMany({
    where: { channelId },
    select: { id: true, name: true },
  });
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  // canvases.metadata has no index. `surface` covers both shapes; artifactKind alone
  // would miss every wiki page.
  const channelCanvases = await prisma.canvas.findMany({
    where: { channelId },
    select: { id: true, title: true, folderId: true, metadata: true },
  });
  const sdlcCanvases = channelCanvases.filter(
    (canvas) => asRecord(canvas.metadata).surface === 'SDLC'
  );

  const [conversationCount, messageCount, ticketCount] = await Promise.all([
    prisma.conversation.count({ where: { channelId } }),
    prisma.message.count({ where: { conversation: { channelId } } }),
    prisma.ticket.count({ where: { channelId } }),
  ]);

  const pending = executions.filter((row) => ACTIVE_EXECUTION_STATUSES.includes(row.status));
  // workflow_executions.workflowType is nullable.
  const workflowTypeById = new Map(workflows.map((row) => [row.id, row.workflowType]));
  const queueJobIds = executions
    .map((row) => {
      const workflowType = row.workflowType ?? workflowTypeById.get(row.workflowId) ?? null;
      return workflowType ? jobIdFor(workflowType, row.id) : null;
    })
    .filter((jobId): jobId is string => jobId !== null);
  const admissionPermitIds = executions
    .map((row) => parseJsonRecord(row.context).admissionPermitId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  // The bull job completes the moment the run is handed to Claw (sdlcWorker.ts:96-101),
  // so an in-flight run has no active job — only a held admission permit. That permit
  // is the liveness signal, and force must not override it.
  const liveExecutions = executions.filter(
    (row) =>
      typeof parseJsonRecord(row.context).admissionPermitId === 'string' &&
      ACTIVE_EXECUTION_STATUSES.includes(row.status)
  );
  if (liveExecutions.length > 0) {
    throw new AppError(
      `Refusing teardown: ${liveExecutions.length} SDLC run(s) still hold an admission permit (${liveExecutions.map((row) => row.id).join(', ')}). Cancel them first; force does not override this.`,
      409
    );
  }
  const activeJobIds = await activeQueueJobIds(queueJobIds);
  if (activeJobIds.length > 0) {
    throw new AppError(
      `Refusing teardown: ${activeJobIds.length} SDLC job(s) are running (${activeJobIds.join(', ')}). Wait for them or cancel the run first.`,
      409
    );
  }
  if (pending.length > 0 && !input.force) {
    throw new AppError(
      `Refusing teardown: ${pending.length} SDLC execution(s) are still ${pending.map((row) => row.status).join('/')}. Cancel them, or re-run with force: true.`,
      409
    );
  }

  const nextName = await resolveChannelName(actor, channel.name, input.name, repo?.name);
  const plan: SdlcHubTeardownPlan = {
    dryRun: input.dryRun,
    channel: {
      id: channel.id,
      workspaceId: channel.workspaceId,
      projectId: channel.projectId,
      before: {
        name: channel.name,
        type: channel.type,
        description: channel.description,
        metadata: channel.metadata,
        showTicketsTabTicketsInChat: channel.showTicketsTabTicketsInChat,
      },
      after: {
        name: nextName,
        type: ChannelType.DEFAULT,
        description: null,
        metadata: null,
        showTicketsTabTicketsInChat: true,
      },
    },
    repo: repo ?? null,
    delete: {
      sdlcEntityLinks: links,
      workflows: workflows.map(({ id, workflowType, workflowName }) => ({
        id,
        workflowType,
        workflowName,
      })),
      workflowExecutions: executions.map(({ id, workflowType, status }) => ({
        id,
        workflowType,
        status,
      })),
      knowledgeDocuments,
      repos: repo ? [repo] : [],
      redis: { queueJobIds, admissionPermitIds },
    },
    stripMetadata: {
      canvases: sdlcCanvases.map((canvas) => {
        const metadata = asRecord(canvas.metadata);
        return {
          id: canvas.id,
          title: canvas.title,
          kind: metadata.artifactKind ?? metadata.documentKind ?? null,
          folder: canvas.folderId ? (folderNames.get(canvas.folderId) ?? null) : null,
        };
      }),
    },
    keep: {
      canvases: channelCanvases.length,
      canvasFolders: folders.length,
      conversations: conversationCount,
      messages: messageCount,
      tickets: ticketCount,
    },
    restore: {
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        metadata: channel.metadata,
        showTicketsTabTicketsInChat: channel.showTicketsTabTicketsInChat,
      },
      repo,
      sdlcEntityLinks: links,
      canvasMetadata: Object.fromEntries(sdlcCanvases.map((c) => [c.id, c.metadata])),
    },
  };

  if (input.dryRun) {
    logger.info(`${TAG} dry run`, {
      channelId,
      repoId,
      repoName: repo?.name,
      repoUrl: repo?.url,
      counts: summarize(plan),
    });
    return plan;
  }

  // Logged BEFORE the write: if the process dies mid-run, this line is what puts
  // the hub back. Stringified so no log transport truncates the nested payload.
  logger.info(`${TAG} applying — restore payload`, {
    channelId,
    repoId,
    repoName: repo?.name,
    repoUrl: repo?.url,
    counts: summarize(plan),
    restore: JSON.stringify(plan.restore),
  });

  const executionIds = executions.map((row) => row.id);
  const canvasIds = sdlcCanvases.map((canvas) => canvas.id);
  await prisma.$transaction(async (tx) => {
    // Clear repos_sdlcSetupExecutionId_key before the execution it points at goes.
    if (repo?.sdlcSetupExecutionId) {
      await tx.repo.update({ where: { id: repo.id }, data: { sdlcSetupExecutionId: null } });
    }
    // No relation to workflows, so Prisma cascades nothing to it.
    if (knowledgeDocuments.length > 0) {
      await tx.knowledgeDocument.deleteMany({
        where: { id: { in: knowledgeDocuments.map((row) => row.id) } },
      });
    }
    if (repoId) {
      await tx.sdlcEntityLink.deleteMany({ where: { repoId } });
    }
    if (workflowIds.length > 0) {
      await tx.workflow.deleteMany({ where: { id: { in: workflowIds } } });
    }
    // Executions whose workflow was already gone miss the cascade above.
    if (executionIds.length > 0) {
      await tx.workflowExecution.deleteMany({ where: { id: { in: executionIds } } });
    }
    if (canvasIds.length > 0) {
      await tx.canvas.updateMany({
        where: { id: { in: canvasIds } },
        data: { metadata: Prisma.DbNull },
      });
    }
    await tx.channel.update({
      where: { id: channelId },
      data: {
        name: nextName,
        // archiveChannel refuses anything but DEFAULT.
        type: ChannelType.DEFAULT,
        description: null,
        metadata: Prisma.DbNull,
        showTicketsTabTicketsInChat: true,
      },
    });
    // Delete, never null channelId: the repos ACL reads null as "legacy IDE
    // repository" and exposes the row workspace-wide.
    if (repo) {
      await tx.repo.delete({ where: { id: repo.id } });
    }
    // Prisma's 5s default rolls back a hub with a long run history mid-cascade.
  }, { timeout: 60_000 });

  await releaseQueueState(repoId, queueJobIds, admissionPermitIds);

  logger.info(`${TAG} applied`, {
    channelId,
    repoId,
    repoName: repo?.name,
    repoUrl: repo?.url,
    name: nextName,
    counts: summarize(plan),
  });
  return plan;
}

function summarize(plan: SdlcHubTeardownPlan): Record<string, number> {
  return {
    sdlcEntityLinks: plan.delete.sdlcEntityLinks.length,
    workflows: plan.delete.workflows.length,
    workflowExecutions: plan.delete.workflowExecutions.length,
    knowledgeDocuments: plan.delete.knowledgeDocuments.length,
    repos: plan.delete.repos.length,
    canvasesStripped: plan.stripMetadata.canvases.length,
  };
}

/**
 * Pre-fix hubs are called `<Repo> · SDLC`, which validateChannelName rejects, so
 * rebuild the name from the repository — or from the channel's own name with the
 * SDLC suffix stripped when the repo row is already gone — then uniquify it the
 * way channel creation does.
 */
async function resolveChannelName(
  actor: SdlcActor,
  currentName: string,
  requestedName: string | undefined,
  repoName: string | undefined
): Promise<string> {
  const source =
    requestedName?.trim() || repoName?.trim() || currentName.replace(/\s*·\s*SDLC\s*$/iu, '');
  const base = normalizeChannelName(source);
  const error = validateChannelName(base);
  if (error) {
    throw new AppError(
      `${error} (derived "${base}" from "${source}") — pass an explicit name`,
      400
    );
  }

  let candidate = base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (candidate === currentName) return candidate;
    if (!(await channelRepository.checkDuplicateName(candidate, actor.workspaceId))) {
      return candidate;
    }
    const tail = `-${suffix}`;
    candidate = `${base.slice(0, CHANNEL_NAME_MAX_LENGTH - tail.length)}${tail}`;
  }
  throw new AppError(
    `Could not find a free channel name near "${base}" — pass an explicit name`,
    409
  );
}

async function queueOrNull() {
  try {
    await sdlcQueue.initialize();
    return sdlcQueue.getQueue();
  } catch (error) {
    logger.error(`${TAG} SDLC queue unavailable`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function activeQueueJobIds(jobIds: string[]): Promise<string[]> {
  if (jobIds.length === 0) return [];
  const queue = await queueOrNull();
  if (!queue) {
    throw new AppError(
      'Cannot reach the SDLC queue to check for running jobs. Refusing teardown rather than deleting rows blind.',
      503
    );
  }
  const active: string[] = [];
  for (const jobId of jobIds) {
    const job = await queue.getJob(jobId);
    if (job && (await job.getState()) === 'active') active.push(jobId);
  }
  return active;
}

async function releaseQueueState(
  repoId: string | null,
  jobIds: string[],
  permitIds: string[]
): Promise<void> {
  try {
    const queue = await queueOrNull();
    for (const jobId of jobIds) {
      const job = await queue?.getJob(jobId);
      if (job) await job.remove();
      if (repoId) await sdlcAdmission.unregisterPending(repoId, jobId);
    }
    for (const permitId of permitIds) {
      await sdlcAdmission.release(permitId);
    }
  } catch (error) {
    // The database is already converted, and the worker discards jobs for deleted
    // executions, so this must not fail the request.
    logger.error(`${TAG} queue cleanup failed`, {
      repoId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
