import { SDLC_WORKFLOW_RELATION, sdlcHubWorkflowFolderId } from '@xyne/shared';
import type { WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { SDLC_AUTHOR_METADATA_KEY } from '@/workflowsV2/agents/sdlc-artifact-provider';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import { repoIdsForChannel } from './sdlcChannelMembership';
import type { SdlcActor } from './types';

const WORKFLOW_NAME = 'Generate Repo Knowledge';

function sdlcRootFolderId(workspaceId: string): string {
  return `sdlc-${workspaceId}`;
}

function buildSteps(input: RepoKnowledgeInput): WorkflowStepConfig[] {
  return BASELINE_DEFINITIONS.map((definition) => ({
    id: definition.kind.toLowerCase(),
    type: 'CREATE_SDLC_ARTIFACT',
    title: definition.title,
    config: {
      channelId: input.channelId,
      // Snapshot: a repository added to the hub later needs a reset to appear here.
      repoIds: input.repoIds,
      artifactType: 'Repo Knowledge',
      artifactTitle: definition.title,
      sections: definition.sections.map((section) => ({
        title: section.title,
        description: section.instructions,
      })),
      task: definition.instructions,
      outputType: 'json',
      outputSchema: {
        type: 'object',
        properties: {
          canvasId: { type: 'string' },
          sections: { type: 'array', items: { type: 'string' } },
          sourcePaths: { type: 'array', items: { type: 'string' } },
        },
        required: ['canvasId'],
      },
    },
  })) as WorkflowStepConfig[];
}

interface RepoKnowledgeInput {
  channelId: string;
  repoIds: string[];
}

export function buildRepoKnowledgeConfig(input: RepoKnowledgeInput): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: buildSteps(input),
  };
}

/** Presence, dangling included, means "seeded once": a deleted workflow stays deleted. */
export async function findHubWorkflowLink(
  channelId: string,
): Promise<{ id: string; targetId: string; workspaceId: string } | null> {
  return db.sdlcEntityLink.findFirst({
    where: {
      channelId,
      sourceType: 'CHANNEL',
      targetType: 'WORKFLOW',
      relationType: SDLC_WORKFLOW_RELATION,
    },
    select: { id: true, targetId: true, workspaceId: true },
  });
}

async function ensureHubFolder(
  actor: SdlcActor,
  channelId: string,
  hubName: string,
): Promise<string> {
  const rootId = sdlcRootFolderId(actor.workspaceId);
  const hubId = sdlcHubWorkflowFolderId(channelId);
  const now = new Date();
  await db.workflowFolder.upsert({
    where: { id: rootId },
    create: {
      id: rootId,
      workspaceId: actor.workspaceId,
      name: 'SDLC',
      metadata: '{}',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    },
    update: {},
  });
  await db.workflowFolder.upsert({
    where: { id: hubId },
    create: {
      id: hubId,
      workspaceId: actor.workspaceId,
      name: hubName,
      metadata: '{}',
      parentId: rootId,
      createdAt: now,
      updatedAt: now,
    },
    update: { name: hubName, parentId: rootId, updatedAt: now },
  });
  return hubId;
}

async function hubTargets(
  channelId: string,
): Promise<{ hubName: string; repoIds: string[] }> {
  const [channel, repoIds] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { name: true } }),
    repoIdsForChannel(db, channelId),
  ]);
  if (!channel) throw new AppError('SDLC hub not found', 404);
  return { hubName: channel.name, repoIds };
}

export interface SeedHubWorkflowResult {
  status: 'seeded' | 'reset' | 'skipped';
  workflowId?: string;
}

/** Call after createChannel commits: createWorkflow cannot join a Prisma transaction. */
export async function seedHubWorkflow(
  actor: SdlcActor,
  channelId: string,
): Promise<SeedHubWorkflowResult> {
  if (await findHubWorkflowLink(channelId)) return { status: 'skipped' };

  const { hubName, repoIds } = await hubTargets(channelId);
  const folderId = await ensureHubFolder(actor, channelId, hubName);
  const workflowId = await workflowRuntime.createWorkflow(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    {
      name: WORKFLOW_NAME,
      config: buildRepoKnowledgeConfig({ channelId, repoIds }),
      folderId,
      metadata: { [SDLC_AUTHOR_METADATA_KEY]: actor.userId },
      attributes: { workspaceId: actor.workspaceId, createdByUserId: actor.userId },
    },
  ).then((record) => record.id);

  await db.sdlcEntityLink.create({
    data: {
      workspaceId: actor.workspaceId,
      channelId,
      sourceType: 'CHANNEL',
      sourceId: channelId,
      targetType: 'WORKFLOW',
      targetId: workflowId,
      relationType: SDLC_WORKFLOW_RELATION,
      createdBy: actor.userId,
    },
  });

  logger.info(`[SDLC] seeded Repo Knowledge workflow ${workflowId} for hub ${channelId}`);
  return { status: 'seeded', workflowId };
}

export async function resetHubWorkflow(
  actor: SdlcActor,
  channelId: string,
): Promise<SeedHubWorkflowResult> {
  const link = await findHubWorkflowLink(channelId);
  if (!link) return seedHubWorkflow(actor, channelId);

  // Replace only a missing workflow: dropping the edge on other errors orphans its runs.
  const existing = await db.workflow.findUnique({
    where: { id: link.targetId },
    select: { id: true },
  });
  if (!existing) {
    logger.warn(`[SDLC] hub ${channelId} workflow ${link.targetId} is gone, reseeding`);
    await db.sdlcEntityLink.delete({ where: { id: link.id } });
    return seedHubWorkflow(actor, channelId);
  }

  const { hubName, repoIds } = await hubTargets(channelId);
  const folderId = await ensureHubFolder(actor, channelId, hubName);

  await workflowRuntime.updateWorkflow(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    link.targetId,
    {
      name: WORKFLOW_NAME,
      config: buildRepoKnowledgeConfig({ channelId, repoIds }),
      folderId,
      metadata: { [SDLC_AUTHOR_METADATA_KEY]: actor.userId },
    },
  );

  logger.info(`[SDLC] reset Repo Knowledge workflow ${link.targetId} for hub ${channelId}`);
  return { status: 'reset', workflowId: link.targetId };
}

export interface BackfillResult {
  seeded: number;
  reset: number;
  skipped: number;
  failed: Array<{ channelId: string; error: string }>;
}

async function walkHubs(
  actor: SdlcActor,
  channelId: string | undefined,
  apply: (actor: SdlcActor, channelId: string) => Promise<SeedHubWorkflowResult>,
): Promise<BackfillResult> {
  const hubs = await db.channel.findMany({
    where: {
      workspaceId: actor.workspaceId,
      type: 'SDLC',
      ...(channelId ? { id: channelId } : {}),
    },
    select: { id: true },
  });

  const result: BackfillResult = { seeded: 0, reset: 0, skipped: 0, failed: [] };
  for (const hub of hubs) {
    try {
      const outcome = await apply(actor, hub.id);
      result[outcome.status] += 1;
    } catch (error) {
      result.failed.push({
        channelId: hub.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export async function backfillHubWorkflows(
  actor: SdlcActor,
  channelId?: string,
): Promise<BackfillResult> {
  return walkHubs(actor, channelId, seedHubWorkflow);
}

export async function resetHubWorkflows(
  actor: SdlcActor,
  channelId?: string,
): Promise<BackfillResult> {
  return walkHubs(actor, channelId, resetHubWorkflow);
}
