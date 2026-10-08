import { SDLC_HUB_ITEM_RELATION } from '@xyne/shared';
import { db } from '@/database/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { createRedisClient } from '@/services/redisFactory';
import { logger } from '@/utils/logger';
import { fileSchema, SubApp } from '@/vespa/src/types';

const LEGACY_WORKFLOW_TYPES = ['SDLC_WIKI', 'SDLC_WORK', 'SDLC_SETUP'];
const LEGACY_CANVAS_FOLDERS = ['Wiki Archive', 'Baseline'];
// Anything else in those folders is user content.
const LEGACY_ARTIFACT_TYPES: ReadonlySet<string> = new Set([
  'CORE_CODE_MAP',
  'FRONTEND_DESIGN_SYSTEM',
  'BACKEND_DESIGN_SYSTEM',
  'CODE_LINT_STANDARDS',
  'COMMIT_STANDARDS',
  'RUN_GUIDE',
  'TEST_GUIDE',
  'WIKI',
]);
const LEGACY_REDIS_PATTERNS = ['bull:sdlc:*', 'sdlc:admission:*'];

export interface LegacyCleanupResult {
  dryRun: boolean;
  canvases: number;
  canvasFolders: number;
  workflows: number;
  executions: number;
  wikiRunLinks: number;
  /** Null unless asked for: the keys belong to the old worker until both stacks run without it. */
  redisKeys: number | null;
}

async function legacyRedisKeys(): Promise<string[]> {
  const redis = createRedisClient('sdlc-legacy-cleanup');
  try {
    const keys: string[] = [];
    for (const match of LEGACY_REDIS_PATTERNS) {
      for await (const batch of redis.scanStream({ match, count: 500 })) {
        keys.push(...(batch as string[]));
      }
    }
    return keys;
  } finally {
    redis.disconnect();
  }
}

async function deleteRedisKeys(keys: string[]): Promise<void> {
  const redis = createRedisClient('sdlc-legacy-cleanup');
  try {
    for (let index = 0; index < keys.length; index += 500) {
      await redis.unlink(...keys.slice(index, index + 500));
    }
  } finally {
    redis.disconnect();
  }
}

async function deleteCanvases(canvasIds: string[]): Promise<void> {
  if (canvasIds.length === 0) return;
  const ids = { in: canvasIds };
  await db.$transaction([
    // A thread points at its first comment with a restrict rule, so unhook it before deleting comments.
    db.canvasCommentThread.updateMany({ where: { canvasId: ids }, data: { initialCommentId: null } }),
    db.canvasComment.deleteMany({ where: { canvasId: ids } }),
    db.canvasCommentThread.deleteMany({ where: { canvasId: ids } }),
    db.canvasVersion.deleteMany({ where: { canvasId: ids } }),
    db.canvasParticipant.deleteMany({ where: { canvasId: ids } }),
    db.canvasUserStatus.deleteMany({ where: { canvasId: ids } }),
    db.sdlcArtifact.deleteMany({ where: { artifactId: ids } }),
    db.sdlcEntityLink.deleteMany({
      where: {
        OR: [
          { sourceType: 'CANVAS', sourceId: ids },
          { targetType: 'CANVAS', targetId: ids },
        ],
      },
    }),
    db.canvas.deleteMany({ where: { id: ids } }),
  ]);
  for (const docId of canvasIds) {
    void vespaQueue
      .addJob({ schema: fileSchema, docId, jobType: 'delete', app: SubApp.CANVAS })
      .catch((error) => logger.warn('[SDLC] legacy cleanup could not queue a search delete', { docId, error }));
  }
}

/**
 * Removes what the SDLC worker and the old Wiki left behind. Never touches Wiki pages placed in
 * the hub folder tree, Hub Knowledge, or workflows of today's types. Previews unless dryRun is false.
 */
export async function cleanupLegacySdlc(input: { dryRun: boolean; redis: boolean }): Promise<LegacyCleanupResult> {
  const [wikiArtifacts, folders, workflows] = await Promise.all([
    db.sdlcArtifact.findMany({ where: { artifactType: 'WIKI' }, select: { artifactId: true } }),
    db.canvasFolder.findMany({
      where: { name: { in: LEGACY_CANVAS_FOLDERS }, channel: { type: 'SDLC' } },
      select: { id: true },
    }),
    db.workflow.findMany({ where: { workflowType: { in: LEGACY_WORKFLOW_TYPES } }, select: { id: true } }),
  ]);
  const folderIds = folders.map((folder) => folder.id);
  const workflowIds = workflows.map((workflow) => workflow.id);
  const folderCanvases = folderIds.length
    ? await db.canvas.findMany({
        where: { folderId: { in: folderIds } },
        select: { id: true, folderId: true, sdlcArtifact: { select: { artifactType: true } } },
      })
    : [];
  const candidateIds = [
    ...new Set([
      ...wikiArtifacts.map((artifact) => artifact.artifactId),
      ...folderCanvases
        .filter((canvas) => LEGACY_ARTIFACT_TYPES.has(canvas.sdlcArtifact?.artifactType ?? ''))
        .map((canvas) => canvas.id),
    ]),
  ];
  const [placedCanvases, executions, wikiRunLinks] = await Promise.all([
    candidateIds.length
      ? db.sdlcEntityLink.findMany({
          where: { relationType: SDLC_HUB_ITEM_RELATION, targetType: 'CANVAS', targetId: { in: candidateIds } },
          select: { targetId: true },
        })
      : [],
    db.workflowExecution.findMany({
      where: {
        OR: [{ workflowType: { in: LEGACY_WORKFLOW_TYPES } }, { workflowId: { in: workflowIds } }],
      },
      select: { id: true },
    }),
    db.sdlcEntityLink.count({ where: { relationType: 'WIKI_RUN' } }),
  ]);
  const placed = new Set(placedCanvases.map((link) => link.targetId));
  const canvasIds = candidateIds.filter((id) => !placed.has(id));
  const deleting = new Set(canvasIds);
  const emptiedFolderIds = folderIds.filter(
    (folderId) => !folderCanvases.some((canvas) => canvas.folderId === folderId && !deleting.has(canvas.id))
  );
  const executionIds = executions.map((execution) => execution.id);
  const redisKeys = input.redis ? await legacyRedisKeys() : null;

  if (!input.dryRun) {
    await deleteCanvases(canvasIds);
    await db.canvasFolder.deleteMany({ where: { id: { in: emptiedFolderIds } } });
    await db.workflowStep.deleteMany({ where: { workflowExecutionId: { in: executionIds } } });
    await db.workflowExecution.deleteMany({ where: { id: { in: executionIds } } });
    await db.workflow.deleteMany({ where: { id: { in: workflowIds } } });
    await db.sdlcEntityLink.deleteMany({ where: { relationType: 'WIKI_RUN' } });
    if (redisKeys?.length) await deleteRedisKeys(redisKeys);
    logger.info('[SDLC] legacy cleanup applied', {
      canvases: canvasIds.length,
      canvasFolders: emptiedFolderIds.length,
      workflows: workflowIds.length,
      executions: executionIds.length,
      wikiRunLinks,
      redisKeys: redisKeys?.length ?? null,
    });
  }

  return {
    dryRun: input.dryRun,
    canvases: canvasIds.length,
    canvasFolders: emptiedFolderIds.length,
    workflows: workflowIds.length,
    executions: executionIds.length,
    wikiRunLinks,
    redisKeys: redisKeys?.length ?? null,
  };
}
