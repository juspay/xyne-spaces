import type { FieldOptionsContext, FieldOptionsPage } from '@xyne/workflow-sdk';
import { BaseActionStep, variableRef, withOptions } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '@/database/client';
import { buildWorkspaceCanvasUrl, convertMarkdownToBlockNote } from '@/services/canvasService';
import { syncToYSweet } from '@/utils/ysweetUtils';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import type { XyneCtx } from '@/workflowsV2/types';
import { channelOptions, noOptions, optionsQuery } from '../options';
import { actorOf, workflowIdOf, workspaceOf } from '../context';

const CreateCanvasConfigSchema = z.object({
  title: variableRef(z.string().min(1)),
  content: variableRef(z.string()).describe('The canvas body, in markdown'),
  channelId: withOptions(variableRef(z.string())).optional().describe('Channel the canvas belongs to'),
});
type CreateCanvasConfig = z.infer<typeof CreateCanvasConfigSchema>;

const CreateCanvasOutputSchema = z.object({
  canvasId: z.string(),
  canvasUrl: z.string(),
  title: z.string(),
});
type CreateCanvasOutput = z.infer<typeof CreateCanvasOutputSchema>;

export class CreateCanvasStep extends BaseActionStep<typeof CreateCanvasConfigSchema, CreateCanvasOutput> {
  readonly type = 'CREATE_CANVAS';
  readonly configSchema = CreateCanvasConfigSchema;
  readonly outputSchema = CreateCanvasOutputSchema;
  readonly name = 'Create a canvas';
  readonly description = 'Creates a canvas from markdown content.';
  readonly category = 'canvas';
  readonly icon = 'FileText';

  override getOptions(
    ctx: FieldOptionsContext<CreateCanvasConfig, Record<string, unknown>, XyneCtx>,
  ): Promise<FieldOptionsPage> {
    return ctx.field === 'channelId' ? channelOptions(optionsQuery(ctx)) : Promise.resolve(noOptions);
  }

  async execute(config: CreateCanvasConfig, ctx: StepExecutionContext): Promise<CreateCanvasOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const createdBy = await actorOf(ctx, this.type);
    const title = (config.title as string).trim();
    const markdown = String(config.content ?? '');
    const channelId = typeof config.channelId === 'string' && config.channelId.trim() ? config.channelId.trim() : null;

    if (channelId) {
      const channel = await db.channel.findFirst({ where: { id: channelId, workspaceId }, select: { id: true } });
      if (!channel) throw new Error(`Channel ${channelId} not found`);
    }

    const blocks = await convertMarkdownToBlockNote(markdown);
    if (markdown.trim() && blocks.length === 0) throw new Error('The content could not be turned into canvas blocks');

    const canvasId = uuidv4();
    if (!(await syncToYSweet(canvasId, blocks, createdBy))) {
      throw new Error(`Saving canvas ${canvasId} to Y-Sweet failed`);
    }

    const now = new Date();
    await db.canvas.create({
      data: {
        id: canvasId,
        title,
        workspaceId,
        content: [],
        isCollaborative: true,
        createdBy,
        visibility: CanvasVisibility.PUBLIC,
        isTemplate: false,
        lastEditedBy: createdBy,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
        channelId,
        metadata: { source: 'workflow', workflowId: workflowIdOf(ctx) },
      },
    });
    await db.canvasParticipant.create({
      data: { id: uuidv4(), canvasId, workspaceId, userId: createdBy, role: CanvasRole.OWNER, joinedAt: now, updatedAt: now },
    });

    vespaQueue
      .addJob({ schema: fileSchema, docId: canvasId, jobType: 'feed', userId: createdBy, app: SubApp.CANVAS, workspaceId })
      .catch((err) => logger.error(`[CREATE_CANVAS] Queuing search indexing for canvas ${canvasId} failed:`, err));

    return { canvasId, canvasUrl: buildWorkspaceCanvasUrl(workspaceId, canvasId), title };
  }
}
