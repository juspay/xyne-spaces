// Mobius Webhook Service
// Handles inbound Mobius release-update events and records them on the linked
// Xyne ticket as ACTIVITIES (shown in the ticket Details ▸ Activity feed), not as
// conversation messages. An unauthenticated webhook that opens an explicit tenant
// scope from the path :workspaceId, resolves a ticket, then writes the activity.
//
// The event shape mirrors Mobius' own event-log entries (event_name / id /
// release_id). Kept permissive (.passthrough()) so event-specific fields are not
// rejected.
//
// Ticket routing: Mobius events carry a `release_id`. A user manually links that
// release id to a Xyne ticket from the Details panel (persisted on
// tickets.mobiusReleaseId, unique per workspace), so we resolve the ticket by
// release_id. An explicit xyneId in the payload takes precedence. See resolveTicket().

import { z } from 'zod';
import { ActivityType, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { runWithContext } from '@/database/tenant/context';
import { TicketRepository } from '@/database/repositories/ticketRepository';
import { DatabaseClient } from '@/database/client';
import { redisService } from '@/services/redisService';
import { mobiusService } from '@/services/mobiusService';
import { unifiedBotUserService } from '@/bots/unified/index.js';

const prisma = DatabaseClient.getInstance();

// Bot identity used to post release updates (already used for release notes).
const MOBIUS_RELEASE_BOT_ID = 'xyne-release-bot';

// How long a processed event id is remembered for dedup. Long enough to absorb
// Mobius retry windows without unbounded Redis growth.
const DEDUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * Mobius release event. Modeled on Mobius' event-log entries. The `result` field
 * is event-specific and can be large/nested, so it's left as an opaque unknown.
 * `xyneId` / `ticket.xyneId` are OPTIONAL linkage fields we've asked Mobius to
 * attach so we can route to a ticket (see file header).
 */
const MobiusReleaseEventSchema = z
  .object({
    // Mobius event fields we act on (event-log shape). `.passthrough()` keeps any
    // other event-specific fields (result, timestamps, ...) without validating them.
    event_name: z.string().min(1),
    id: z.string().min(1).optional(),
    release_id: z.string().min(1).optional(),

    // Xyne linkage (requested from Mobius; not yet guaranteed present).
    xyneId: z.string().min(1).optional(),
    ticket: z
      .object({
        xyneId: z.string().min(1).optional(),
        url: z.string().url().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MobiusReleaseEventPayload = z.infer<typeof MobiusReleaseEventSchema>;

export interface MobiusWebhookResult {
  success: boolean;
  message: string;
}

export class MobiusWebhookService {
  private ticketRepository = new TicketRepository();

  /**
   * Main entry point for a Mobius webhook event. Returns success even on most
   * failures so Mobius does not retry indefinitely; genuine "please retry"
   * conditions should be signalled with a non-2xx from the route instead.
   */
  async handleWebhookEvent(
    body: unknown,
    workspaceId: string,
  ): Promise<MobiusWebhookResult> {
    // Unauthenticated webhook (no req.user): open an explicit tenant scope from the
    // path workspaceId so the workspaceId stamper fills any downstream writes.
    return runWithContext({ userId: 'mobius-webhook', workspaceId }, async () => {
      const parsed = MobiusReleaseEventSchema.safeParse(body);
      if (!parsed.success) {
        logger.warn('[Mobius-Webhook] Invalid payload', {
          workspaceId,
          issues: parsed.error.issues,
        });
        return { success: false, message: 'Invalid payload' };
      }

      const payload = parsed.data;
      logger.info(`[Mobius-Webhook] Received event: ${payload.event_name} (release ${payload.release_id}) for workspace: ${workspaceId}`);

      // Idempotency: dedup on the event's own id when present (Mobius emits a
      // stable unique id per event). Without one we cannot safely dedup.
      const dedupId = payload.id;
      if (dedupId) {
        const isFirstDelivery = await this.claimEvent(workspaceId, dedupId);
        if (!isFirstDelivery) {
          logger.info(`[Mobius-Webhook] Duplicate event ${dedupId} ignored for workspace ${workspaceId}`);
          return { success: true, message: 'Duplicate event ignored' };
        }
      }

      // From here on the event is claimed. Release the claim on any non-success
      // outcome so a legitimate Mobius retry can reprocess it.
      try {
        const ticket = await this.resolveTicket(payload, workspaceId);
        if (!ticket) {
          // No ticket is linked to this release yet (or the explicit xyneId is
          // unknown). Acknowledge so Mobius doesn't retry — a link may be added
          // later, and a future event for the same release will route fine.
          logger.warn('[Mobius-Webhook] No ticket linked to this event; skipping', {
            workspaceId,
            releaseId: payload.release_id,
            xyneId: this.explicitXyneId(payload),
            event: payload.event_name,
          });
          await this.releaseEvent(workspaceId, dedupId);
          return { success: false, message: 'No ticket linked to release' };
        }

        if (!ticket.conversationId) {
          logger.warn(`[Mobius-Webhook] Ticket ${ticket.xyneId} has no conversation to post to`);
          await this.releaseEvent(workspaceId, dedupId);
          return { success: false, message: `Ticket ${ticket.xyneId} has no conversation` };
        }

        const bot = await unifiedBotUserService.getBotByBotId(MOBIUS_RELEASE_BOT_ID, workspaceId);
        if (!bot) {
          logger.error(`[Mobius-Webhook] Release bot user not found in workspace ${workspaceId}`);
          await this.releaseEvent(workspaceId, dedupId);
          return { success: false, message: 'Release bot user not found' };
        }

        // Enrich with the current release state (status + stagger percent) from
        // Mobius if we have a release id and the outbound client is configured.
        // Best-effort: never blocks the activity.
        const releaseState = payload.release_id
          ? await mobiusService.getReleaseState(payload.release_id)
          : null;

        // Record the update as a ticket ACTIVITY (Details ▸ Activity feed). The
        // release bot is the actor, so it renders as "Xyne Release — Mobius release …".
        await this.recordActivity({
          ticketId: ticket.id,
          botId: bot.id,
          channelId: ticket.channelId,
          value: {
            eventName: payload.event_name,
            eventId: dedupId,
            releaseId: payload.release_id,
            status: releaseState?.status,
            staggerPercent: releaseState?.staggerPercent,
            product: releaseState?.product,
            version: releaseState?.newVersion,
          },
        });

        logger.info(`[Mobius-Webhook] Recorded release-update activity on ticket ${ticket.xyneId} (event ${payload.event_name})`);
        return { success: true, message: 'Release update recorded' };
      } catch (error) {
        // Release the claim so the event isn't permanently swallowed by dedup.
        await this.releaseEvent(workspaceId, dedupId);
        throw error;
      }
    });
  }

  /**
   * Backfill a ticket's activity feed from the Mobius event history. Called when
   * a mobiusReleaseId is linked to a ticket *after* events have already occurred,
   * so the earlier events aren't lost. Best-effort and idempotent: events already
   * recorded (by a live webhook or a prior backfill) are skipped by event id.
   */
  async backfillFromHistory(ticketId: string, releaseId: string, workspaceId: string): Promise<void> {
    const trimmedRelease = releaseId?.trim();
    if (!trimmedRelease) return;

    return runWithContext({ userId: 'mobius-webhook', workspaceId }, async () => {
      try {
        const events = await mobiusService.getReleaseHistory(trimmedRelease);
        if (!events || events.length === 0) {
          logger.info(`[Mobius-Webhook] No history to backfill for release ${trimmedRelease}`);
          return;
        }

        const ticket = await this.ticketRepository.getTicketById(ticketId);
        if (!ticket) return;

        const bot = await unifiedBotUserService.getBotByBotId(MOBIUS_RELEASE_BOT_ID, workspaceId);
        if (!bot) {
          logger.error(`[Mobius-Webhook] Release bot not found for backfill in workspace ${workspaceId}`);
          return;
        }

        // Skip events already present as activities (dedup by event id).
        const existing = await prisma.ticketActivity.findMany({
          where: { ticketId, activityType: ActivityType.MOBIUS_RELEASE_UPDATE },
          select: { value: true },
        });
        const seen = new Set(
          existing
            .map((a) => (a.value as { eventId?: string } | null)?.eventId)
            .filter((id): id is string => Boolean(id)),
        );

        let created = 0;
        for (const ev of events) {
          if (ev.id && seen.has(ev.id)) continue;
          await this.recordActivity({
            ticketId,
            botId: bot.id,
            channelId: ticket.channelId,
            value: {
              eventName: ev.event_name,
              eventId: ev.id,
              releaseId: trimmedRelease,
              staggerPercent: this.parseStaggerPercent(ev.event_name),
              backfilled: true,
            },
            // Preserve the original event time so the feed reads chronologically.
            timestamp: ev.date_created ? new Date(ev.date_created) : undefined,
          });
          // Claim the dedup key too, so a later live re-delivery of this same
          // event id is recognised as a duplicate instead of posting twice.
          if (ev.id) await this.claimEvent(workspaceId, ev.id);
          created++;
        }

        logger.info(`[Mobius-Webhook] Backfilled ${created} history activities on ticket ${ticket.xyneId} (release ${trimmedRelease})`);
      } catch (error) {
        logger.error('[Mobius-Webhook] History backfill failed', { ticketId, releaseId: trimmedRelease, error });
      }
    });
  }

  /** Derive a stagger percent from STAGGERED_UP_<n> event names; undefined otherwise. */
  private parseStaggerPercent(eventName?: string): number | undefined {
    const m = eventName?.match(/^STAGGERED_UP_(\d+)$/);
    return m ? Number(m[1]) : undefined;
  }

  /** Write a single MOBIUS_RELEASE_UPDATE activity (used by live + backfill paths). */
  private async recordActivity(params: {
    ticketId: string;
    botId: string;
    channelId: string | null;
    value: Record<string, unknown>;
    timestamp?: Date;
  }): Promise<void> {
    await prisma.ticketActivity.create({
      data: {
        ticketId: params.ticketId,
        updatedBy: params.botId,
        activityType: ActivityType.MOBIUS_RELEASE_UPDATE,
        value: params.value as Prisma.InputJsonValue,
        channelId: params.channelId,
        ...(params.timestamp ? { timestamp: params.timestamp } : {}),
      },
    });
  }

  /**
   * Atomically claim an event for processing. Returns true on first delivery,
   * false if the id was already claimed (duplicate). Fails open (returns true)
   * if Redis is unavailable so a Redis outage never drops release updates.
   */
  private async claimEvent(workspaceId: string, eventId: string): Promise<boolean> {
    try {
      return await redisService.set(
        this.dedupKey(workspaceId, eventId),
        '1',
        DEDUP_TTL_SECONDS,
        true, // NX: only set if absent
      );
    } catch (error) {
      logger.error('[Mobius-Webhook] Dedup claim failed, processing anyway', { workspaceId, eventId, error });
      return true;
    }
  }

  /** Release a previously claimed event so a retry can reprocess it. */
  private async releaseEvent(workspaceId: string, eventId: string | undefined): Promise<void> {
    if (!eventId) {
      return;
    }
    try {
      await redisService.del(this.dedupKey(workspaceId, eventId));
    } catch (error) {
      logger.warn('[Mobius-Webhook] Failed to release dedup claim', { workspaceId, eventId, error });
    }
  }

  private dedupKey(workspaceId: string, eventId: string): string {
    return `mobius:webhook:dedup:${workspaceId}:${eventId}`;
  }

  /**
   * Resolve the Xyne ticket for an event. Primary path: look up the ticket that
   * a user manually linked to this release_id (tickets.mobiusReleaseId). If the
   * payload carries an explicit xyneId, that takes precedence as an override.
   * Returns null when neither resolves to a ticket.
   */
  private async resolveTicket(payload: MobiusReleaseEventPayload, workspaceId: string) {
    const xyneId = this.explicitXyneId(payload);
    if (xyneId) {
      return this.ticketRepository.getTicketByXyneId(xyneId, workspaceId);
    }
    if (payload.release_id) {
      return this.ticketRepository.getTicketByMobiusReleaseId(payload.release_id.trim(), workspaceId);
    }
    return null;
  }

  /**
   * Extract an explicit Xyne ticket key from the payload if Mobius sends one:
   * top-level xyneId, ticket.xyneId, or a PROJECT-1234 key inside ticket.url.
   */
  private explicitXyneId(payload: MobiusReleaseEventPayload): string | null {
    if (payload.xyneId) {
      return payload.xyneId.trim();
    }
    if (payload.ticket?.xyneId) {
      return payload.ticket.xyneId.trim();
    }
    if (payload.ticket?.url) {
      const match = payload.ticket.url.match(/([A-Za-z][A-Za-z0-9]*-\d+)/);
      if (match) {
        return match[1];
      }
    }
    return null;
  }
}

export const mobiusWebhookService = new MobiusWebhookService();
