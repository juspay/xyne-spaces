import { ActivityClassification, ActivityType, TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withWorkspaceScope } from '@/database/tenant/context';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';

const TICKET_BOT_ID = 'ticket-bot';

// Activity-feed action per status (rendered by TicketUpdateActivity on the
// dashboard; every key here needs a config case there and an entry in the
// Activity panel's 'tickets' filter).
const RELEASE_ACTOR_ACTION: Record<TicketStatusV2, string> = {
  [TicketStatusV2.STARTED]: 'ticket_release_started',
  [TicketStatusV2.COMPLETED]: 'ticket_release_completed',
  [TicketStatusV2.CANCELLED]: 'ticket_release_cancelled',
  [TicketStatusV2.PAUSED]: 'ticket_release_paused',
  [TicketStatusV2.TODO]: 'ticket_release_planning',
};

interface NotifyParams {
  releaseTicketId: string;
  status: TicketStatusV2;
  workspaceId: string;
}

// Copy is keyed on the canonical statusV2, never on board stage names — teams
// define their own stages, but every stage collapses onto these five statuses.
// Thread copy: the message sits inside the dev ticket's own thread, so it names
// only the release.
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
      return `\u21A9\uFE0F Release ${releaseXyneId} moved to planning.`;
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
      select: {
        id: true,
        xyneId: true,
        conversationId: true,
        workspaceId: true,
        channelId: true,
        createdBy: true,
        assignedTo: true,
      },
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

  const actorAction = RELEASE_ACTOR_ACTION[params.status];

  const results = await Promise.allSettled(
    devTickets.map(async dev => {
      if (!dev.conversationId) return;
      const content = buildContent(params.status, release.xyneId);
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

      // Actors follow the ticket regardless of thread subscription.
      const actorIds = [dev.createdBy, dev.assignedTo].filter(
        (id): id is string => Boolean(id) && id !== bot.id,
      );

      // Activity feed (Activity panel -> Tickets tab): subscribed thread
      // participants + actors. Mirrors the tickets-handler recipient pattern.
      try {
        const participants = await withWorkspaceScope(() =>
          db.conversationParticipant.findMany({
            where: { conversationId: dev.conversationId!, isSubscribed: true },
            select: { userId: true },
          }),
        );
        const feedRecipients = [...participants.map(p => p.userId), ...actorIds].filter(
          (id, index, arr) => arr.indexOf(id) === index && id !== bot.id,
        );
        for (const userId of feedRecipients) {
          await activityService.createActivity({
            userId,
            actorAction,
            actionSource: 'ticket',
            actionSourceId: dev.id,
            ticketId: dev.id,
            conversationId: dev.conversationId ?? undefined,
            channelId: dev.channelId ?? undefined,
            actorId: bot.id,
            workspaceId: dev.workspaceId,
            classification: ActivityClassification.FYI,
          });
        }
      } catch (error) {
        logger.error(`[ReleaseDevNotify] Failed to create release activities for ticket ${dev.id}:`, error);
      }

      // Push (in-app + FCM, per user preference): actors only, on every transition.
      if (actorIds.length > 0) {
        try {
          await notificationService.sendTicketReleaseStatusChangeNotification(
            dev.id,
            dev.xyneId,
            actorIds,
            bot.id,
            release,
            params.status,
          );
        } catch (error) {
          logger.error(`[ReleaseDevNotify] Failed to push release notification for ticket ${dev.id}:`, error);
        }
      }
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
