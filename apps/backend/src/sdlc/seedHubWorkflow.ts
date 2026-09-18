import {
  ChannelRole,
  SDLC_HUB_KNOWLEDGE_FOLDER,
  SDLC_WIKI_WORKFLOW_RELATION,
  SDLC_WORKFLOW_RELATION,
  sdlcHubWorkflowFolderId,
} from '@xyne/shared';
import type { WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { SDLC_AUTHOR_METADATA_KEY, sdlcAuthorOf } from '@/workflowsV2/agents/sdlc-dispatch';
import { ensureHubKnowledgeFolder, ensureHubWikiFolder, ensureRepositoryWikiFolder } from './hubFolders';
import { HUB_KNOWLEDGE_DEFINITIONS } from './hubKnowledgeDefinitions';
import { repoIdsForChannel } from './sdlcChannelMembership';
import type { SdlcActor } from './types';
import { WIKI_TRIGGER, buildWikiWorkflowConfig } from './wiki/wikiWorkflowConfig';

function sdlcRootFolderId(workspaceId: string): string {
  return `sdlc-${workspaceId}`;
}

export function buildHubKnowledgeConfig(channelId: string): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: HUB_KNOWLEDGE_DEFINITIONS.map((definition) => ({
      id: definition.id,
      type: 'CREATE_SDLC_ARTIFACT',
      title: definition.title,
      config: {
        channelId,
        artifactType: 'Hub Knowledge',
        artifactTitle: definition.title,
        sections: definition.sections.map((section) => ({
          title: section.title,
          description: section.instructions,
        })),
        task: definition.instructions,
        outputType: 'json',
        outputSchema: {
          type: 'object',
          properties: { canvasId: { type: 'string' }, summary: { type: 'string' } },
          required: ['canvasId'],
        },
      },
    })) as WorkflowStepConfig[],
  };
}

const HUB_WORKFLOWS = [
  { relation: SDLC_WORKFLOW_RELATION, name: 'Generate Hub Knowledge', build: buildHubKnowledgeConfig },
  { relation: SDLC_WIKI_WORKFLOW_RELATION, name: 'Generate Wiki', build: buildWikiWorkflowConfig },
] as const;

type HubWorkflow = (typeof HUB_WORKFLOWS)[number];

/** Presence, dangling included, means "seeded once": a deleted workflow stays deleted. */
async function findHubWorkflowLink(
  channelId: string,
  relation: string,
): Promise<{ id: string; targetId: string } | null> {
  return db.sdlcEntityLink.findFirst({
    where: {
      channelId,
      sourceType: 'CHANNEL',
      targetType: 'WORKFLOW',
      relationType: relation,
    },
    select: { id: true, targetId: true },
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

interface Hub {
  channelId: string;
  folderId: string;
}

/** Idempotent, so seeds and resets both run it. */
async function prepareHub(actor: SdlcActor, channelId: string): Promise<Hub> {
  const [channel, repoIds] = await Promise.all([
    db.channel.findUnique({ where: { id: channelId }, select: { name: true, projectId: true } }),
    repoIdsForChannel(db, channelId),
  ]);
  if (!channel?.projectId) throw new AppError('SDLC hub not found', 404);
  const repos = await db.repo.findMany({
    where: { id: { in: repoIds } },
    select: { id: true, name: true },
  });
  await db.canvasFolder.upsert({
    where: {
      projectId_channelId_name: {
        projectId: channel.projectId,
        channelId,
        name: SDLC_HUB_KNOWLEDGE_FOLDER,
      },
    },
    create: {
      workspaceId: actor.workspaceId,
      projectId: channel.projectId,
      channelId,
      name: SDLC_HUB_KNOWLEDGE_FOLDER,
      createdBy: actor.userId,
    },
    update: {},
  });
  await ensureHubKnowledgeFolder(db, actor, channelId);
  await ensureHubWikiFolder(db, actor, channelId);
  for (const repo of repos) {
    await ensureRepositoryWikiFolder(db, actor, channelId, repo);
  }
  return { channelId, folderId: await ensureHubFolder(actor, channelId, channel.name) };
}

/** A workspace admin running backfill may not be in the hub, hence the oldest-admin fallback. */
async function hubAuthor(actor: SdlcActor, channelId: string, current?: string): Promise<string> {
  const candidates = [current, actor.userId].filter((userId): userId is string => Boolean(userId));
  const participants = await db.channelParticipant.findMany({
    where: { channelId, OR: [{ userId: { in: candidates } }, { role: ChannelRole.ADMIN }] },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true, role: true },
  });
  const member = candidates.find((userId) => participants.some((participant) => participant.userId === userId));
  const author = member ?? participants.find((participant) => participant.role === ChannelRole.ADMIN)?.userId;
  if (!author) throw new AppError(`SDLC hub ${channelId} has no admin for its workflows to act as`, 409);
  return author;
}

async function createHubWorkflow(actor: SdlcActor, hub: Hub, workflow: HubWorkflow): Promise<string> {
  const record = await workflowRuntime.createWorkflow(
    { userId: actor.userId, workspaceId: actor.workspaceId },
    {
      name: workflow.name,
      config: workflow.build(hub.channelId),
      folderId: hub.folderId,
      metadata: { [SDLC_AUTHOR_METADATA_KEY]: await hubAuthor(actor, hub.channelId) },
      attributes: { workspaceId: actor.workspaceId, createdByUserId: actor.userId },
    },
  );
  try {
    await db.sdlcEntityLink.create({
      data: {
        workspaceId: actor.workspaceId,
        channelId: hub.channelId,
        sourceType: 'CHANNEL',
        sourceId: hub.channelId,
        targetType: 'WORKFLOW',
        targetId: record.id,
        relationType: workflow.relation,
        createdBy: actor.userId,
      },
    });
  } catch (error) {
    // Unlinked, the next seed would add a second copy.
    await db.workflow.delete({ where: { id: record.id } }).catch(() => undefined);
    throw error;
  }
  logger.info(`[SDLC] seeded "${workflow.name}" workflow ${record.id} for hub ${hub.channelId}`);
  return record.id;
}

export interface SeedHubWorkflowResult {
  status: 'seeded' | 'reset' | 'skipped';
  wikiTriggerUpdated?: boolean;
}

/** Call after createChannel commits: createWorkflow cannot join a Prisma transaction. */
export async function seedHubWorkflow(
  actor: SdlcActor,
  channelId: string,
  dryRun = false,
): Promise<SeedHubWorkflowResult> {
  const hub = dryRun ? null : await prepareHub(actor, channelId);
  let seeded = false;
  for (const workflow of HUB_WORKFLOWS) {
    if (await findHubWorkflowLink(channelId, workflow.relation)) continue;
    if (hub) await createHubWorkflow(actor, hub, workflow);
    seeded = true;
  }
  const wikiTriggerUpdated = await syncWikiTrigger(channelId, dryRun);
  return { status: seeded ? 'seeded' : 'skipped', wikiTriggerUpdated };
}

/** Backfill moves existing Wiki workflows to the text start commits, keeping builder edits to steps. */
async function syncWikiTrigger(channelId: string, dryRun: boolean): Promise<boolean> {
  const link = await findHubWorkflowLink(channelId, SDLC_WIKI_WORKFLOW_RELATION);
  const workflow = link
    ? await db.workflow.findUnique({ where: { id: link.targetId }, select: { id: true, context: true } })
    : null;
  if (!workflow?.context) return false;
  const config = JSON.parse(workflow.context) as WorkflowConfig;
  if (JSON.stringify(config.trigger) === JSON.stringify(WIKI_TRIGGER)) return false;
  if (!dryRun) {
    await db.workflow.update({
      where: { id: workflow.id },
      data: { context: JSON.stringify({ ...config, trigger: WIKI_TRIGGER }) },
    });
  }
  return true;
}

export async function resetHubWorkflow(
  actor: SdlcActor,
  channelId: string,
  dryRun = false,
): Promise<SeedHubWorkflowResult> {
  if (dryRun) return { status: 'reset' };
  const hub = await prepareHub(actor, channelId);
  for (const workflow of HUB_WORKFLOWS) {
    const link = await findHubWorkflowLink(channelId, workflow.relation);
    // Replace only a missing workflow: dropping the edge on other errors orphans its runs.
    const existing = link
      ? await db.workflow.findUnique({ where: { id: link.targetId }, select: { id: true, metadata: true } })
      : null;
    if (!existing) {
      if (link) {
        logger.warn(`[SDLC] hub ${channelId} workflow ${link.targetId} is gone, reseeding`);
        await db.sdlcEntityLink.delete({ where: { id: link.id } });
      }
      await createHubWorkflow(actor, hub, workflow);
      continue;
    }
    await workflowRuntime.updateWorkflow(
      { userId: actor.userId, workspaceId: actor.workspaceId },
      existing.id,
      {
        name: workflow.name,
        config: workflow.build(channelId),
        folderId: hub.folderId,
        metadata: {
          [SDLC_AUTHOR_METADATA_KEY]: await hubAuthor(actor, channelId, sdlcAuthorOf(existing.metadata)),
        },
      },
    );
    logger.info(`[SDLC] reset "${workflow.name}" workflow ${existing.id} for hub ${channelId}`);
  }
  return { status: 'reset' };
}

export interface BackfillResult {
  dryRun: boolean;
  seeded: number;
  reset: number;
  skipped: number;
  wikiTriggersUpdated: number;
  failed: Array<{ channelId: string; error: string }>;
}

export interface HubWorkflowScope {
  channelId?: string | undefined;
  dryRun: boolean;
}

async function walkHubs(
  actor: SdlcActor,
  { channelId, dryRun }: HubWorkflowScope,
  apply: (actor: SdlcActor, channelId: string, dryRun: boolean) => Promise<SeedHubWorkflowResult>,
): Promise<BackfillResult> {
  const hubs = await db.channel.findMany({
    where: {
      workspaceId: actor.workspaceId,
      type: 'SDLC',
      ...(channelId ? { id: channelId } : {}),
    },
    select: { id: true },
  });

  const result: BackfillResult = { dryRun, seeded: 0, reset: 0, skipped: 0, wikiTriggersUpdated: 0, failed: [] };
  for (const hub of hubs) {
    try {
      const outcome = await apply(actor, hub.id, dryRun);
      result[outcome.status] += 1;
      if (outcome.wikiTriggerUpdated) result.wikiTriggersUpdated += 1;
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
  scope: HubWorkflowScope,
): Promise<BackfillResult> {
  return walkHubs(actor, scope, seedHubWorkflow);
}

export async function resetHubWorkflows(
  actor: SdlcActor,
  scope: HubWorkflowScope,
): Promise<BackfillResult> {
  return walkHubs(actor, scope, resetHubWorkflow);
}
