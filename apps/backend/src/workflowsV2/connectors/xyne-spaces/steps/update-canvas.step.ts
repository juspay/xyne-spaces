import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { z } from 'zod';
import { db } from '@/database/client';
import {
  buildWorkspaceCanvasUrl,
  convertBlockNoteToMarkdown,
  convertMarkdownToBlockNote,
} from '@/services/canvasService';
import { readFromYSweetStrict, syncToYSweet } from '@/utils/ysweetUtils';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import { actorOf, workspaceOf } from '../context';

const UpdateCanvasConfigSchema = z.object({
  canvas: variableRef(z.string().min(1)).describe('Canvas id or canvas link'),
  content: variableRef(z.string().min(1)).describe(
    'Markdown to add or to put in place of the canvas body'
  ),
  mode: z
    .enum(['append', 'replace'])
    .default('append')
    .describe('append adds the content at the end of the canvas; replace swaps the whole body'),
  skipIfContains: variableRef(z.string())
    .optional()
    .describe(
      'Leave the canvas as it is when it already contains this text, so a re-run does not add it twice'
    ),
});
type UpdateCanvasConfig = z.infer<typeof UpdateCanvasConfigSchema>;

const UpdateCanvasOutputSchema = z.object({
  canvasId: z.string(),
  canvasUrl: z.string(),
  updated: z
    .boolean()
    .describe('False when skipIfContains matched and the canvas was left as it is'),
});
type UpdateCanvasOutput = z.infer<typeof UpdateCanvasOutputSchema>;

export class UpdateCanvasStep extends BaseActionStep<
  typeof UpdateCanvasConfigSchema,
  UpdateCanvasOutput
> {
  readonly type = 'UPDATE_CANVAS';
  readonly configSchema = UpdateCanvasConfigSchema;
  readonly outputSchema = UpdateCanvasOutputSchema;
  readonly name = 'Update a canvas';
  readonly description =
    'Adds markdown at the end of a canvas or replaces its body. Runs editing the same canvas take turns.';
  readonly category = 'canvas';
  readonly icon = 'FilePen';

  async execute(
    config: UpdateCanvasConfig,
    ctx: StepExecutionContext
  ): Promise<UpdateCanvasOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const editedBy = await actorOf(ctx, this.type);
    const reference = (config.canvas as string).trim();
    const canvasId = reference.match(/\/canvas\/([^/?#]+)/)?.[1] ?? reference;
    const markdown = (config.content as string).trim();
    const skipIfContains = ((config.skipIfContains as string | undefined) ?? '').trim();

    const canvas = await db.canvas.findFirst({
      where: { id: canvasId, workspaceId },
      select: { id: true, isCollaborative: true },
    });
    if (!canvas) throw new Error(`Canvas ${reference} not found`);
    if (!canvas.isCollaborative)
      throw new Error(`Canvas ${canvasId} is not a collaborative canvas`);
    const canvasUrl = buildWorkspaceCanvasUrl(workspaceId, canvasId);

    const blocks = await convertMarkdownToBlockNote(markdown);
    if (blocks.length === 0) throw new Error('The content could not be turned into canvas blocks');

    // The body is read, extended and written back whole, so two runs at once must take turns.
    const lock = await acquireLock(`lock:workflow-canvas-update:${canvasId}`, {
      waitTimeoutMs: 30_000,
      ttlSeconds: 120,
    });
    if (!lock) throw new Error(`Canvas ${canvasId} is being updated by another run; try again`);
    try {
      // Strict read: a failed read must not be taken as an empty canvas and written back over it.
      const existing = await readFromYSweetStrict(canvasId, editedBy);
      if (skipIfContains && (await convertBlockNoteToMarkdown(existing)).includes(skipIfContains)) {
        return { canvasId, canvasUrl, updated: false };
      }
      const content = config.mode === 'replace' ? blocks : [...existing, ...blocks];
      if (!(await syncToYSweet(canvasId, content, editedBy))) {
        throw new Error(`Saving canvas ${canvasId} to Y-Sweet failed`);
      }
    } finally {
      await releaseLock(lock);
    }

    const now = new Date();
    await db.canvas.update({
      where: { id: canvasId },
      data: { lastEditedBy: editedBy, lastEditedAt: now, updatedAt: now },
    });
    vespaQueue
      .addJob({
        schema: fileSchema,
        docId: canvasId,
        jobType: 'feed',
        userId: editedBy,
        app: SubApp.CANVAS,
        workspaceId,
      })
      .catch((err) =>
        logger.error(`[UPDATE_CANVAS] Queuing search indexing for canvas ${canvasId} failed:`, err)
      );

    return { canvasId, canvasUrl, updated: true };
  }
}
