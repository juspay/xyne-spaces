// Handles inbound Mobius release events and records them as ticket activities.

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

const MOBIUS_RELEASE_BOT_ID = 'xyne-release-bot';
const DEDUP_TTL_SECONDS = 24 * 60 * 60;

const MobiusReleaseEventSchema = z
  .object({
    event_name: z.string().min(1),
    id: z.string().min(1).optional(),
    release_id: z.string().min(1).optional(),
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

  async handleWebhookEvent(
    body: unknown,
    workspaceId: string,
  ): Promise<MobiusWebhookResult> {
    // No req.user on a webhook: open tenant scope from the path workspaceId.
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

      const dedupId = payload.id;
      if (dedupId) {
        const isFirstDelivery = await this.claimEvent(workspaceId, dedupId);
        if (!isFirstDelivery) {
          logger.info(`[Mobius-Webhook] Duplicate event ${dedupId} ignored for workspace ${workspaceId}`);
          return { success: true, message: 'Duplicate event ignored' };
        }
      }

      // Release the dedup claim on any non-success outcome so a retry can reprocess.
      try {
        const ticket = await this.resolveTicket(payload, workspaceId);
        if (!ticket) {
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

        // Best-effort enrichment; never blocks the activity.
        const releaseState = payload.release_id
          ? await mobiusService.getReleaseState(payload.release_id)
          : null;

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
        await this.releaseEvent(workspaceId, dedupId);
        throw error;
      }
    });
  }

  // Backfill from Mobius history when a release is linked after events occurred.
  // Idempotent: events already recorded are skipped by event id.
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
            timestamp: ev.date_created ? new Date(ev.date_created) : undefined,
          });
          if (ev.id) await this.claimEvent(workspaceId, ev.id);
          created++;
        }

        logger.info(`[Mobius-Webhook] Backfilled ${created} history activities on ticket ${ticket.xyneId} (release ${trimmedRelease})`);
      } catch (error) {
        logger.error('[Mobius-Webhook] History backfill failed', { ticketId, releaseId: trimmedRelease, error });
      }
    });
  }

  private parseStaggerPercent(eventName?: string): number | undefined {
    const m = eventName?.match(/^STAGGERED_UP_(\d+)$/);
    return m ? Number(m[1]) : undefined;
  }

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

  // Claim an event id (NX). Returns false if already claimed; fails open on Redis errors.
  private async claimEvent(workspaceId: string, eventId: string): Promise<boolean> {
    try {
      return await redisService.set(this.dedupKey(workspaceId, eventId), '1', DEDUP_TTL_SECONDS, true);
    } catch (error) {
      logger.error('[Mobius-Webhook] Dedup claim failed, processing anyway', { workspaceId, eventId, error });
      return true;
    }
  }

  private async releaseEvent(workspaceId: string, eventId: string | undefined): Promise<void> {
    if (!eventId) return;
    try {
      await redisService.del(this.dedupKey(workspaceId, eventId));
    } catch (error) {
      logger.warn('[Mobius-Webhook] Failed to release dedup claim', { workspaceId, eventId, error });
    }
  }

  private dedupKey(workspaceId: string, eventId: string): string {
    return `mobius:webhook:dedup:${workspaceId}:${eventId}`;
  }

  // Resolve by explicit xyneId if present, else by the linked release_id.
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
