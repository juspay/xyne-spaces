import { ActivityClassification, ActivityType, TicketStatusV2 } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withWorkspaceScope } from '@/database/tenant/context';
import { recordTicketTimelineEvent } from '@/services/ticketTimelineEventService';
import { activityService } from '@/services/activity/activityService';
import { notificationService } from '@/services/notificationService';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service';
import { ticketService } from '@/services/ticketService';
import { ActivitySource } from '@/types/ticket';

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
        boardId: true,
        stageName: true,
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

  // Board automation: boards can map a release status to a stage ("When Release
  // Status is COMPLETED -> Status becomes Released"). Resolve the mapping once
  // per board so the per-ticket loop is a lookup. Service scope: mappings are
  // workspace config, not per-user data.
  const targetStageByBoard = await resolveReleaseStatusStageByBoard(
    [...new Set(devTickets.map(dev => dev.boardId).filter((id): id is string => Boolean(id)))],
    params.status,
  );

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

      // Board automation: move the dev ticket to the stage its board maps to
      // this release status, if any. AUTOMATION source shows "Automation" in the
      // activity feed; skipped when the ticket is already on the target stage.
      const targetStage = dev.boardId ? targetStageByBoard.get(dev.boardId) : undefined;
      if (targetStage && dev.stageName !== targetStage) {
        try {
          await ticketService.updateTicketStageForWorkflow(
            dev.id,
            bot.id,
            targetStage,
            ActivitySource.AUTOMATION,
          );
          logger.info(
            `[ReleaseDevNotify] Auto-moved ${dev.xyneId} to stage "${targetStage}" (release ${release.xyneId} -> ${params.status})`,
          );
        } catch (error) {
          logger.error(`[ReleaseDevNotify] Failed to auto-move ticket ${dev.id} to "${targetStage}":`, error);
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

// Board -> target stage name for a release status, across the given boards.
// One stage per release status per board (unique [stageId, releaseStatus] plus
// the builder storing the status on the target stage), so first match wins.
async function resolveReleaseStatusStageByBoard(
  boardIds: string[],
  status: TicketStatusV2,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (boardIds.length === 0) return result;
  try {
    const stages = await withWorkspaceScope(() =>
      db.stage.findMany({
        where: { boardId: { in: boardIds } },
        select: { id: true, name: true, boardId: true },
      }),
    );
    if (stages.length === 0) return result;
    const stageById = new Map(stages.map(s => [s.id, s]));
    const mappings = await withWorkspaceScope(() =>
      db.stageReleaseStatusMapping.findMany({
        where: { releaseStatus: status, stageId: { in: stages.map(s => s.id) } },
        select: { stageId: true },
      }),
    );
    for (const mapping of mappings) {
      const stage = stageById.get(mapping.stageId);
      if (stage && !result.has(stage.boardId)) result.set(stage.boardId, stage.name);
    }
  } catch (error) {
    logger.error('[ReleaseDevNotify] Failed to resolve release-status stage mappings:', error);
  }
  return result;
}

export const releaseDevTicketNotifyService = { notifyDevTicketsOnReleaseStatusChange };
