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

// Inlined per step rather than a `{{vars.policy}}` variable: the builder's
// isRefBroken only whitelists `trigger` and step ids, so `vars` shows as a broken
// reference on every step.
const WRITING_POLICY = `You are writing reference documentation for an SDLC hub.

Ground every claim in the repository. Cite the paths and symbols a reader needs to
verify it, and prefer naming the few files that orient someone over listing many.
Skip generated code, vendored dependencies and trivial helpers. Where an existing
Wiki page already covers something, point at it instead of restating it, and say
how fresh that page is. If something does not exist in this hub, say so in one
line with the evidence, rather than inventing a plausible section.`;

/** Workspace-level parent every hub folder hangs under. */
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
        instructions: section.instructions,
      })),
      task: `${WRITING_POLICY}\n\n${definition.instructions}`,
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
  /** Empty means the whole hub at run time. */
  repoIds: string[];
}

export function buildRepoKnowledgeConfig(input: RepoKnowledgeInput): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: buildSteps(input),
  };
}

/**
 * The hub's CHANNEL -> WORKFLOW edge. Its presence — dangling included — is what
 * "seeded once" means, so a deliberately deleted workflow does not come back.
 */
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

/**
 * Find-or-create `SDLC / <hub name>`. Refreshing the name here is the only thing
 * that tracks a renamed hub.
 */
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

/** Everything about the hub that gets baked into its workflow definition. */
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

/**
 * Must run after `createChannel` commits — `createWorkflow` writes through the SDK's
 * own adapter and cannot join an outer Prisma transaction.
 */
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
      // Metadata, not attributes: `createdByUserId` is consumed at create, never stored.
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

/**
 * Put a hub's workflow back to the seeded definition, discarding builder edits.
 *
 * Rewritten in place, not recreated, so the workflow id — and with it the entity
 * edge and the run history — survives.
 */
export async function resetHubWorkflow(
  actor: SdlcActor,
  channelId: string,
): Promise<SeedHubWorkflowResult> {
  const link = await findHubWorkflowLink(channelId);
  if (!link) return seedHubWorkflow(actor, channelId);

  // Only a genuinely missing workflow earns a replacement. Dropping the edge on any
  // other error would orphan a live workflow and its run history.
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

/** Run one hub action across the workspace, or against a single hub. */
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

/** How hubs created before seeding existed get a workflow. A second run is a no-op. */
export async function backfillHubWorkflows(
  actor: SdlcActor,
  channelId?: string,
): Promise<BackfillResult> {
  return walkHubs(actor, channelId, seedHubWorkflow);
}

/** `backfillHubWorkflows`, but overwriting the hubs that already have a workflow. */
export async function resetHubWorkflows(
  actor: SdlcActor,
  channelId?: string,
): Promise<BackfillResult> {
  return walkHubs(actor, channelId, resetHubWorkflow);
}
