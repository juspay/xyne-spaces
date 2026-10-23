import {
  SDLC_HUB_ITEM_FLAT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_WIKI_WORKFLOW_RELATION,
  sdlcWikiFolderId,
} from '@xyne/shared';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import { cancelParkedClawRuns } from '@/workflowsV2/agents/clawSessions';
import { TERMINAL_EXECUTION_STATUSES } from '@/workflowsV2/constants';
import { workflowRuntime } from '@/workflowsV2/runtime';
import { deleteCanvases } from '../cleanupLegacy';
import type { SdlcActor } from '../types';

export interface ResetWikiResult {
  dryRun: boolean;
  activeRuns: number;
  pages: number;
  folders: number;
  runs: number;
}

/**
 * Deletes a hub's Wiki and its run history, so the next run starts from each repository's first
 * commit. Plan resumes from that history, so deleting pages alone would resume where the old run ended.
 */
export async function resetWiki(actor: SdlcActor, channelId: string, dryRun: boolean): Promise<ResetWikiResult> {
  const hub = await db.channel.findFirst({
    where: { id: channelId, workspaceId: actor.workspaceId, type: 'SDLC' },
    select: { id: true },
  });
  if (!hub) throw new AppError('SDLC hub not found', 404);

  const link = await db.sdlcEntityLink.findFirst({
    where: { channelId, sourceType: 'CHANNEL', targetType: 'WORKFLOW', relationType: SDLC_WIKI_WORKFLOW_RELATION },
    select: { targetId: true },
  });
  const executions = link
    ? await db.workflowExecution.findMany({ where: { workflowId: link.targetId }, select: { id: true, status: true } })
    : [];
  const terminal: ReadonlySet<string> = new Set(TERMINAL_EXECUTION_STATUSES);
  const active = executions.filter((execution) => !terminal.has(execution.status));
  const pages = await db.canvas.findMany({
    where: { channelId, sdlcArtifact: { artifactType: 'WIKI' } },
    select: { id: true },
  });
  // The Hub Wiki and each repository's folder stay; everything filed below them goes.
  const scopes = await db.sdlcEntityLink.findMany({
    where: { channelId, sourceType: 'FOLDER', sourceId: sdlcWikiFolderId(channelId), targetType: 'FOLDER', relationType: SDLC_HUB_ITEM_RELATION },
    select: { targetId: true },
  });
  const folders = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      sourceType: 'FOLDER',
      sourceId: { in: scopes.map((scope) => scope.targetId) },
      targetType: 'FOLDER',
      relationType: SDLC_HUB_ITEM_FLAT_RELATION,
    },
    select: { targetId: true },
  });
  const folderIds = folders.map((folder) => folder.targetId);
  const result = { dryRun, activeRuns: active.length, pages: pages.length, folders: folderIds.length, runs: executions.length };
  if (dryRun) return result;

  for (const execution of active) {
    try {
      await workflowRuntime.cancelExecution({ userId: actor.userId, workspaceId: actor.workspaceId }, execution.id);
    } catch (error) {
      // Deleting a run that is still going would leave its claw agent writing pages into the reset Wiki.
      throw new AppError(`Could not cancel Wiki run ${execution.id}: ${error instanceof Error ? error.message : String(error)}`, 409);
    }
    await cancelParkedClawRuns(execution.id);
  }
  await deleteCanvases(pages.map((page) => page.id));
  await db.sdlcEntityLink.deleteMany({
    where: {
      channelId,
      OR: [
        { targetType: 'FOLDER', targetId: { in: folderIds } },
        { sourceType: 'FOLDER', sourceId: { in: folderIds } },
      ],
    },
  });
  await db.sdlcFolder.deleteMany({ where: { id: { in: folderIds } } });
  const executionIds = executions.map((execution) => execution.id);
  await db.workflowStep.deleteMany({ where: { workflowExecutionId: { in: executionIds } } });
  await db.workflowExecution.deleteMany({ where: { id: { in: executionIds } } });
  logger.info(`[SDLC] reset Wiki of hub ${channelId}`, result);
  return result;
}
