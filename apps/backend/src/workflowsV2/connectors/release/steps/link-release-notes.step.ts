import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { isReleaseTicket } from '@xyne/shared';
import type { BaseTicketType } from '@xyne/shared';
import { z } from 'zod/v3';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { buildWorkspaceCanvasUrl } from '@/services/canvasService';
import { workspaceOf } from '../../xyne-spaces/context';
import { canvasIssues, ticketIssues } from '../../xyne-spaces/validation';
import type { Checked, ConfigIssue } from '../../xyne-spaces/validation';

const LinkReleaseNotesConfigSchema = z.object({
  releaseTicket: variableRef(z.string().min(1)).describe('Release ticket id or ID like XYNE-12'),
  canvasId: variableRef(z.string().min(1)).describe('The canvas holding the release notes'),
});
type LinkReleaseNotesConfig = z.infer<typeof LinkReleaseNotesConfigSchema>;

const LinkReleaseNotesOutputSchema = z.object({
  canvasId: z.string(),
  canvasUrl: z.string(),
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

  async validateConfig(ctx: Checked<{ releaseTicket?: string; canvasId?: string }>): Promise<ConfigIssue[]> {
    return (
      await Promise.all([
        ticketIssues(ctx, 'releaseTicket', ctx.known.releaseTicket),
        canvasIssues(ctx, 'canvasId', ctx.known.canvasId),
      ])
    ).flat();
  }

  async execute(config: LinkReleaseNotesConfig, ctx: StepExecutionContext): Promise<LinkReleaseNotesOutput> {
    const workspaceId = workspaceOf(ctx, this.type);
    const identifier = (config.releaseTicket as string).trim();
    const canvasId = (config.canvasId as string).trim();

    const release = await db.ticket.findFirst({
      where: { workspaceId, OR: [{ id: identifier }, { xyneId: identifier }] },
      select: { id: true, xyneId: true, ticketType: true, conversationId: true },
    });
    if (!release) throw new Error(`Release ticket ${identifier} not found`);
    if (!isReleaseTicket(release.ticketType as BaseTicketType)) {
      throw new Error(`Ticket ${release.xyneId} is not a release ticket`);
    }
    const canvas = await db.canvas.findFirst({ where: { id: canvasId, workspaceId }, select: { id: true, metadata: true } });
    if (!canvas) throw new Error(`Canvas ${canvasId} not found`);

    const canvasUrl = buildWorkspaceCanvasUrl(workspaceId, canvas.id);
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

    return { canvasId: canvas.id, canvasUrl };
  }
}
