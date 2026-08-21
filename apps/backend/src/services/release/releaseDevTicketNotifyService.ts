import { ActivityType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';

const TICKET_BOT_EMAIL = 'ticket-bot@bot.xyne.ai';

export type ReleaseMilestone = 'PICKED_UP' | 'DEPLOYED';

interface NotifyParams {
  releaseTicketId: string;
  milestone: ReleaseMilestone;
  workspaceId: string;
}

const buildContent = (milestone: ReleaseMilestone, releaseXyneId: string): string =>
  milestone === 'DEPLOYED'
    ? `\u{1F680} Deployed in release ${releaseXyneId} — this feature is now live in the app.`
    : `\u{1F4E6} Picked up in release ${releaseXyneId} — deployment is now in progress.`;

// Post a milestone update into the messages section of every dev ticket bundled
// into the release. Best-effort; callers run it fire-and-forget.
async function notifyDevTicketsOnReleaseMilestone(params: NotifyParams): Promise<void> {
  const release = await db.ticket.findUnique({
    where: { id: params.releaseTicketId },
    select: { id: true, xyneId: true },
  });
  if (!release) return;

  const artRows = await db.applicationReleaseTicket.findMany({
    where: { releaseId: params.releaseTicketId },
    select: { ticketId: true },
  });
  const devTicketIds = Array.from(new Set(artRows.map(row => row.ticketId)));
  if (devTicketIds.length === 0) return;

  const devTickets = await db.ticket.findMany({
    where: { id: { in: devTicketIds } },
    select: { id: true, conversationId: true, workspaceId: true },
  });

  const bot = await unifiedBotUserService.getBotByEmail(TICKET_BOT_EMAIL, params.workspaceId);
  if (!bot) {
    logger.warn(
      `[ReleaseDevNotify] No ticket-bot user in workspace ${params.workspaceId}; skipping release ${release.xyneId} notifications`,
    );
    return;
  }

  const content = buildContent(params.milestone, release.xyneId);

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
          extraMetadata: { releaseMilestone: params.milestone, releaseTicketId: release.id },
        },
      });
    }),
  );

  const delivered = results.filter(r => r.status === 'fulfilled').length;
  results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .forEach(r => logger.error(`[ReleaseDevNotify] Failed to post release milestone message:`, r.reason));
  logger.info(
    `[ReleaseDevNotify] Release ${release.xyneId} ${params.milestone}: notified ${delivered}/${devTickets.length} dev ticket(s)`,
  );
}

export const releaseDevTicketNotifyService = { notifyDevTicketsOnReleaseMilestone };
