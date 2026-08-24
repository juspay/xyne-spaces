import { ActivityType, TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withWorkspaceScope } from '@/database/tenant/context';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';

const TICKET_BOT_ID = 'ticket-bot';

interface NotifyParams {
  releaseTicketId: string;
  status: TicketStatusV2;
  workspaceId: string;
}

// Copy is keyed on the canonical statusV2, never on board stage names — teams
// define their own stages, but every stage collapses onto these five statuses.
const buildContent = (status: TicketStatusV2, releaseXyneId: string): string => {
  switch (status) {
    case TicketStatusV2.STARTED:
      return `\u{1F4E6} Picked up in release ${releaseXyneId} — deployment is now in progress.`;
    case TicketStatusV2.COMPLETED:
      return `\u{1F680} Released in ${releaseXyneId} — this feature is now live in the app.`;
    case TicketStatusV2.CANCELLED:
      return `\u{1F6AB} Release ${releaseXyneId} was cancelled.`;
    case TicketStatusV2.PAUSED:
      return `\u23F8\uFE0F Release ${releaseXyneId} is on hold.`;
    case TicketStatusV2.TODO:
      return `\u21A9\uFE0F Release ${releaseXyneId} moved back to planning.`;
  }
};

// Post a status update into the messages section of every dev ticket bundled
// into the release. Best-effort; callers run it fire-and-forget.
async function notifyDevTicketsOnReleaseStatusChange(params: NotifyParams): Promise<void> {
  // Service-scope the reads: the per-user tickets ACL would silently drop dev
  // tickets the status-changer cannot see (e.g. private channels), and this is
  // workspace work — every bundled dev ticket must be notified.
  const { release, devTickets } = await withWorkspaceScope(async () => {
    const release = await db.ticket.findUnique({
      where: { id: params.releaseTicketId },
      select: { id: true, xyneId: true },
    });
    if (!release) return { release: null, devTickets: [] };

    const artRows = await db.applicationReleaseTicket.findMany({
      where: { releaseId: params.releaseTicketId },
      select: { ticketId: true },
    });
    const devTicketIds = Array.from(new Set(artRows.map(row => row.ticketId)));
    if (devTicketIds.length === 0) return { release, devTickets: [] };

    const devTickets = await db.ticket.findMany({
      where: { id: { in: devTicketIds } },
      select: { id: true, conversationId: true, workspaceId: true },
    });
    return { release, devTickets };
  });
  if (!release || devTickets.length === 0) return;

  const bot = await unifiedBotUserService.getBotByBotId(TICKET_BOT_ID, params.workspaceId);
  if (!bot) {
    logger.warn(
      `[ReleaseDevNotify] No ticket-bot user in workspace ${params.workspaceId}; skipping release ${release.xyneId} notifications`,
    );
    return;
  }

  const content = buildContent(params.status, release.xyneId);

  const results = await Promise.allSettled(
    devTickets.map(async dev => {
      if (!dev.conversationId) return;
      await recordTicketTimelineEvent({
        message: {
          conversationId: dev.conversationId,
          senderId: bot.id,
          content,
          activityType: ActivityType.STATUS,
          workspaceId: dev.workspaceId,
          isAutomation: true,
          extraMetadata: { releaseStatus: params.status, releaseTicketId: release.id },
        },
      });
    }),
  );

  const delivered = results.filter(r => r.status === 'fulfilled').length;
  results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .forEach(r => logger.error(`[ReleaseDevNotify] Failed to post release status message:`, r.reason));
  logger.info(
    `[ReleaseDevNotify] Release ${release.xyneId} -> ${params.status}: notified ${delivered}/${devTickets.length} dev ticket(s)`,
  );
}

export const releaseDevTicketNotifyService = { notifyDevTicketsOnReleaseStatusChange };
