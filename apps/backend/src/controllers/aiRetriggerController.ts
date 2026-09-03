/**
 * AI Retrigger Controller
 */

import { Request, Response } from 'express';
import { EmailClassificationRepository } from '../database/repositories/emailClassificationRepository.js';
import { assertChannelMembership, assertDeskOwner } from '@/utils/channelMembership';
import { EmailChannelPreferenceRepository } from '../database/repositories/emailChannelPreferenceRepository.js';
import { DatabaseClient } from '../database/client.js';
import { emailClassificationQueue } from '../queues/emailClassificationQueue.js';
import { autoDraftQueue } from '../queues/autoDraftQueue.js';
import { redisService } from '../services/redisService.js';
import { logger } from '../utils/logger.js';
import { withWorkspaceScope } from '../database/tenant/context.js';
import { AutoDraftMode } from '@xyne/shared';

const COOLDOWN_SECONDS = 10 * 60;
const LOCK_TTL_SECONDS = 120;
const LOOKBACK_DAYS = 3;
const STAGGER_MS = 1000;

type AccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export class AiRetriggerController {
  private repo = new EmailClassificationRepository();
  private prefRepo = new EmailChannelPreferenceRepository();
  private prisma = DatabaseClient.getInstance();

  private async assertChannelAccess(
    req: Request,
    channelId: string,
    requireManageAccess = false,
  ): Promise<AccessResult> {
    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) return access;
    if (!requireManageAccess) return { ok: true, userId: access.userId };

    const preference = await this.repo.findRawPreferenceByChannelId(channelId);
    const owned = assertDeskOwner(access, preference?.ownerUserId, 'Only the desk owner can retrigger AI');
    return owned.ok ? { ok: true, userId: access.userId } : owned;
  }

  private async readFeatures(channelId: string): Promise<{
    classification: boolean;
    priority: boolean;
    autoDraft: boolean;
  }> {
    const [config, pref] = await Promise.all([
      this.repo.findConfigByChannelId(channelId),
      this.prefRepo.findByChannelId(channelId),
    ]);
    return {
      classification: !!config?.classificationEnabled,
      priority: !!config?.priorityClassificationEnabled,
      autoDraft: pref?.autoDraftMode === AutoDraftMode.DRAFT,
    };
  }

  /**
   * GET /channels/:channelId/ai-retrigger/status
   */
  getStatus = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    try {
      const access = await this.assertChannelAccess(req, channelId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const cooldownKey = `ai:retrigger:cooldown:${channelId}`;
      const cooldownActive = await redisService.exists(cooldownKey);

      res.status(200).json({ cooldownActive });
    } catch (error) {
      logger.error('[AiRetriggerController] getStatus failed', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Failed to get AI retrigger status' });
    }
  };

  /**
   * POST /channels/:channelId/ai-retrigger
   *
   * Scans tickets in the channel created in the last LOOKBACK_DAYS and re-fires
   * only the AI features that are (a) enabled on the channel AND (b) missing
   * output on the ticket. Returns counts immediately; jobs run async.
   */
  retrigger = async (req: Request, res: Response): Promise<void> => {
    const { channelId } = req.params;
    try {
      const access = await this.assertChannelAccess(req, channelId, true);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const userId = access.userId;

      // Cooldown: blocks repeat triggers — but only once we know real work was
      // enqueued (handled at the end). The lock here just coalesces concurrent
      // clicks so two admins don't both run the scan at the same moment.
      const cooldownKey = `ai:retrigger:cooldown:${channelId}`;
      const cooldownActive = await redisService.exists(cooldownKey);
      if (cooldownActive) {
        res.status(429).json({
          error: 'AI retrigger ran recently for this channel. Please try again in a few minutes.',
        });
        return;
      }

      const lockKey = `ai:retrigger:lock:${channelId}`;
      const lockAcquired = await redisService.set(lockKey, '1', LOCK_TTL_SECONDS, true);
      if (!lockAcquired) {
        res.status(429).json({ error: 'Another retrigger is in progress for this channel.' });
        return;
      }

      try {
        const channelFeatures = await this.readFeatures(channelId);

        // Allow caller to pass a feature override
        const body = req.body as {
          features?: { classification?: boolean; priority?: boolean; autoDraft?: boolean };
        };
        const features = {
          classification: channelFeatures.classification && (body.features?.classification ?? true),
          priority: channelFeatures.priority && (body.features?.priority ?? true),
          autoDraft: channelFeatures.autoDraft && (body.features?.autoDraft ?? true),
        };

        if (!features.classification && !features.priority && !features.autoDraft) {
          res.status(400).json({ error: 'No AI features are enabled on this channel.' });
          return;
        }

        // Resolve the channel's outbound email address once — used below to
        // determine whether the latest email in a thread is inbound or outbound.
        // Outbound emails have `from` = sendAsEmail ?? ownerUser.email.
        let outboundEmailAddress: string | null = null;
        if (features.autoDraft) {
          const pref = await this.prefRepo.findByChannelId(channelId);
          if (pref?.sendAsEmail) {
            outboundEmailAddress = pref.sendAsEmail;
          } else if (pref?.ownerUserId) {
            const owner = await this.prisma.user.findUnique({
              where: { id: pref.ownerUserId },
              select: { email: true },
            });
            outboundEmailAddress = owner?.email ?? null;
          }
        }

        const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
        const tickets = await this.prisma.ticket.findMany({
          where: { channelId, createdAt: { gte: since } },
          select: {
            id: true,
            conversationId: true,
            aiCategory: true,
            aiPriority: true,
          },
        });

        const conversationIds = tickets.map(t => t.conversationId);

        // Batch all per-ticket DB lookups before the loop to avoid N+1 queries.
        const allEmails = conversationIds.length > 0
          ? await this.prisma.email.findMany({
              where: { conversationId: { in: conversationIds } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, conversationId: true, from: true },
            })
          : [];

        // Group by conversationId — first entry = oldest email, last = newest.
        const firstEmailByConv = new Map<string, { id: string }>();
        const latestEmailByConv = new Map<string, { from: string }>();
        for (const email of allEmails) {
          if (!firstEmailByConv.has(email.conversationId)) {
            firstEmailByConv.set(email.conversationId, { id: email.id });
          }
          latestEmailByConv.set(email.conversationId, { from: email.from });
        }

        // Existing team drafts (userId: null) in one query.
        const existingDraftConvIds = conversationIds.length > 0
          ? new Set(
              (await withWorkspaceScope(() =>
                this.prisma.emailDraft.findMany({
                  where: { conversationId: { in: conversationIds }, userId: null },
                  select: { conversationId: true },
                }),
              )).map(d => d.conversationId),
            )
          : new Set<string>();

        const today = new Date().toISOString().slice(0, 10);
        let classifyEnqueued = 0;
        let priorityEnqueued = 0;
        let draftEnqueued = 0;
        let staggerIdx = 0;

        for (const ticket of tickets) {
          const needsClassification = features.classification && !ticket.aiCategory;
          const needsPriority = features.priority && !ticket.aiPriority;

          // Classification + priority share the same worker job. Enqueue once
          // if either output is missing; the worker no-ops the half that's
          // already populated.
          if (needsClassification || needsPriority) {
            const email = firstEmailByConv.get(ticket.conversationId);
            if (email) {
              try {
                await emailClassificationQueue.getQueue().add(
                  'classify',
                  {
                    ticketId: ticket.id,
                    channelId,
                    emailId: email.id,
                    groupId: null,
                    runClassification: needsClassification,
                    runPriority: needsPriority,
                  },
                  {
                    jobId: `retrigger:classify:${ticket.id}:${today}`,
                    delay: staggerIdx * STAGGER_MS,
                  },
                );
                if (needsClassification) classifyEnqueued++;
                if (needsPriority) priorityEnqueued++;
                staggerIdx++;
              } catch (err) {
                // Bull rejects duplicate jobIds — that's our dedup working.
                logger.debug('[AiRetriggerController] classify enqueue skipped', {
                  ticketId: ticket.id,
                  reason: err instanceof Error ? err.message : err,
                });
              }
            }
          }

          if (features.autoDraft) {
            const latestEmail = latestEmailByConv.get(ticket.conversationId);
            const agentRepliedLast =
              !!outboundEmailAddress && !!latestEmail && latestEmail.from === outboundEmailAddress;
            const existingDraft = existingDraftConvIds.has(ticket.conversationId);
            if (!agentRepliedLast && !existingDraft) {
              try {
                await autoDraftQueue.getQueue().add(
                  'draft',
                  {
                    ticketId: ticket.id,
                    conversationId: ticket.conversationId,
                    channelId,
                  },
                  {
                    jobId: `retrigger:draft:${ticket.id}:${today}`,
                    delay: staggerIdx * STAGGER_MS,
                  },
                );
                draftEnqueued++;
                staggerIdx++;
              } catch (err) {
                logger.debug('[AiRetriggerController] draft enqueue skipped', {
                  ticketId: ticket.id,
                  reason: err instanceof Error ? err.message : err,
                });
              }
            }
          }
        }

        const estimatedMinutes = Math.max(1, Math.ceil((staggerIdx * STAGGER_MS) / 60000));
        const totalEnqueued = classifyEnqueued + priorityEnqueued + draftEnqueued;

        // Only start the cooldown if real work was queued. If nothing was
        // missing (everything already classified / drafted), allow immediate
        // retry — no LLM calls were made so spam concerns don't apply.
        if (totalEnqueued > 0) {
          await redisService.set(
            cooldownKey,
            String(Date.now()),
            COOLDOWN_SECONDS,
            true,
          );
        }

        logger.info('[AiRetriggerController] retrigger executed', {
          channelId,
          userId,
          ticketsScanned: tickets.length,
          classifyEnqueued,
          priorityEnqueued,
          draftEnqueued,
          cooldownApplied: totalEnqueued > 0,
          features,
        });

        res.status(200).json({
          success: true,
          enqueued: {
            classify: classifyEnqueued,
            priority: priorityEnqueued,
            draft: draftEnqueued,
          },
          ticketsScanned: tickets.length,
          estimatedMinutes,
          cooldownSeconds: totalEnqueued > 0 ? COOLDOWN_SECONDS : 0,
          features,
        });
      } finally {
        await redisService.del(lockKey).catch(() => undefined);
      }
    } catch (error) {
      logger.error('[AiRetriggerController] retrigger failed', {
        channelId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'AI retrigger failed' });
    }
  };
}
