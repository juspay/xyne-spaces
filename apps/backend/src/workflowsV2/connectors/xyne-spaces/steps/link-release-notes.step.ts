import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { isReleaseTicket } from '@xyne/shared';
import type { BaseTicketType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { buildWorkspaceCanvasUrl } from '@/services/canvasService';
import { workspaceOf } from '../context';

const LinkReleaseNotesConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like XYNE-12'),
  canvasId: variableRef(z.string().min(1)).describe('The canvas holding the release notes'),
});
type LinkReleaseNotesConfig = z.infer<typeof LinkReleaseNotesConfigSchema>;

const LinkReleaseNotesOutputSchema = z.object({
  status: z
    .enum(['created', 'unchanged', 'replaced'])
    .describe('replaced: the release linked other release notes before, now this canvas'),
  canvasId: z.string(),
  canvasUrl: z.string(),
  previousCanvasUrl: z.string().nullable(),
});
type LinkReleaseNotesOutput = z.infer<typeof LinkReleaseNotesOutputSchema>;

export class LinkReleaseNotesStep extends BaseActionStep<typeof LinkReleaseNotesConfigSchema, LinkReleaseNotesOutput> {
  readonly type = 'LINK_RELEASE_NOTES';
  readonly configSchema = LinkReleaseNotesConfigSchema;
  readonly outputSchema = LinkReleaseNotesOutputSchema;
  readonly name = 'Link release notes';
  readonly description = "Sets a canvas as a release's release notes, replacing the ones it linked before.";
  readonly category = 'release';
  readonly icon = 'NotebookPen';

  async execute(config: LinkReleaseNotesConfig, ctx: StepExecutionContext): Promise<LinkReleaseNotesOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.releaseTicket as string).trim();
    const canvasId = (config.canvasId as string).trim();

    const release = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, xyneId: true, ticketType: true, conversationId: true, metadata: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);
    if (!isReleaseTicket(release.ticketType as BaseTicketType)) {
      throw new Error(`Ticket ${release.xyneId} is not a release ticket`);
    }
    const canvas = await db.canvas.findFirst({ where: { id: canvasId, workspaceId }, select: { id: true, metadata: true } });
    if (!canvas) throw new Error(`Canvas ${canvasId} not found`);

    const canvasUrl = buildWorkspaceCanvasUrl(workspaceId, canvas.id);
    const previous = (release.metadata as Record<string, unknown> | null)?.['releaseNotesCanvasUrl'];
    const previousCanvasUrl = typeof previous === 'string' && previous ? previous : null;
    if (previousCanvasUrl?.endsWith(`/canvas/${canvas.id}`)) {
      return { status: 'unchanged', canvasId: canvas.id, canvasUrl: previousCanvasUrl, previousCanvasUrl };
    }

    const now = new Date();
    await db.canvas.update({
      where: { id: canvas.id },
      data: {
        metadata: {
          ...((canvas.metadata as Record<string, unknown> | null) ?? {}),
          source: 'release_notes',
          releaseTicketId: release.id,
          releaseTicketXyneId: release.xyneId,
          conversationId: release.conversationId,
          generatedAt: now.toISOString(),
        },
      },
    });
    await repositories.tickets.updateTicketMetadata(release.id, {
      releaseNotesCanvasUrl: canvasUrl,
      releaseNotesGeneratedAt: now.toISOString(),
      isGeneratingReleaseNotes: false,
    });

    return { status: previousCanvasUrl ? 'replaced' : 'created', canvasId: canvas.id, canvasUrl, previousCanvasUrl };
  }
}
