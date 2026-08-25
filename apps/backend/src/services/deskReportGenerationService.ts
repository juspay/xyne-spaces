/**
 * Desk Report scheduled generation — mirrors recapGenerationService.ts's
 * shape (sweep enabled channels, per-channel try/catch), but triggers a
 * Claw agent run per desk since the report comes from the `create-desk-report`
 * tool, not something computed in-process.
 *
 * Persistence reuses the generic MessageAttachment table
 * (entityType='DESK_REPORT', entityId=channelId). A 'pending' row is written
 * before dispatch so the panel can show "Generating…"; the callback route
 * (deskReportCallback.handler.ts) flips it to 'completed'/'failed'.
 */
import { randomUUID } from 'crypto';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { runClawAgent, listS2SClawAgents } from '@/services/clawAgentService';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { storageService } from '@/services/storage';
import { AttachmentEntityType } from '@xyne/shared';

const DESK_REPORT_ENTITY_TYPE = AttachmentEntityType.DESK_REPORT;
// A run that never gets a callback (crashed agent, dropped webhook) would
// otherwise leave a 'pending' row stuck forever, showing "Generating…" in the
// panel indefinitely. Anything past this age is reaped as failed.
const STUCK_PENDING_HOURS = 2;

const messageAttachmentRepo = new MessageAttachmentRepository();

export interface DeskReportGenerationResult {
  channelId: string;
  success: boolean;
  error?: string;
}

export class DeskReportGenerationService {
  /**
   * Sweep every channel with deskReportEnabled=true and trigger a fresh
   * report for each. Per-channel failures are isolated — one bad desk never
   * blocks the rest, same resilience pattern as recap's channel loop.
   */
  async generateReportsForEnabledDesks(): Promise<{
    total: number;
    dispatched: number;
    failed: number;
    results: DeskReportGenerationResult[];
  }> {
    const preferences = await db.emailChannelPreference.findMany({
      where: { deskReportEnabled: true },
      select: {
        channelId: true,
        ownerUserId: true,
        workspaceId: true,
        deskReportAgentSlug: true,
        deskReportRangeDays: true,
      },
    });

    logger.info(`[DeskReport] Starting scheduled generation for ${preferences.length} desk(s)`);

    const results: DeskReportGenerationResult[] = [];
    for (const pref of preferences) {
      try {
        const result = await this.generateReportForChannel(pref);
        results.push(result);
      } catch (error) {
        logger.error(`[DeskReport] Unexpected error for channel ${pref.channelId}:`, error);
        results.push({
          channelId: pref.channelId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const dispatched = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    logger.info(`[DeskReport] Scheduled generation done: ${dispatched} dispatched, ${failed} failed`);

    return { total: preferences.length, dispatched, failed, results };
  }

  /**
   * Trigger one desk's report. This is also the entry point for a manual
   * "generate now" trigger — always scoped to a single channelId, so a
   * caller can never accidentally regenerate another desk's report.
   */
  async generateReportForChannel(pref: {
    channelId: string;
    ownerUserId: string | null;
    workspaceId: string;
    deskReportAgentSlug: string | null;
    deskReportRangeDays: number | null;
  }): Promise<DeskReportGenerationResult> {
    const { channelId, workspaceId } = pref;
    const agentSlug = pref.deskReportAgentSlug?.trim() || null;
    const rangeDays = pref.deskReportRangeDays && pref.deskReportRangeDays > 0 ? pref.deskReportRangeDays : 1;

    if (!pref.ownerUserId) {
      logger.warn(`[DeskReport] channel ${channelId} has deskReportEnabled but no ownerUserId — skipping`);
      return { channelId, success: false, error: 'No desk owner configured' };
    }

    // Refuse a second run while one is already in flight for this channel —
    // otherwise a manual click during an active cron run races two pending
    // rows and whichever callback lands last can flip an already-completed
    // report to failed. Stale rows past STUCK_PENDING_HOURS don't count as
    // "in flight" so a crashed run can't block generations for hours.
    const existingPending = await db.messageAttachment.findFirst({
      where: { entityType: DESK_REPORT_ENTITY_TYPE, entityId: channelId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) {
      const existingMetadata = (existingPending.metadata as Record<string, unknown> | null) ?? {};
      const stuckCutoff = new Date(Date.now() - STUCK_PENDING_HOURS * 60 * 60 * 1000);
      if (existingMetadata['status'] === 'pending' && existingPending.createdAt > stuckCutoff) {
        logger.info(`[DeskReport] channel ${channelId} already has a report generating — skipping`);
        return { channelId, success: false, error: 'A report is already generating for this desk' };
      }
    }

    const owner = await db.user.findUnique({
      where: { id: pref.ownerUserId },
      select: { id: true, name: true },
    });
    if (!owner) {
      logger.warn(`[DeskReport] channel ${channelId} owner ${pref.ownerUserId} not found — skipping`);
      return { channelId, success: false, error: 'Desk owner not found' };
    }

    const channel = await db.channel.findUnique({ where: { id: channelId }, select: { name: true } });
    const channelName = channel?.name ?? channelId;

    // Two distinct reasons a report can't be dispatched, both surfaced the
    // same way (a 'failed' row with an actionable message): nothing picked
    // yet, or something was picked but no longer exists (deleted/renamed
    // since). Only the second case needs an actual lookup.
    let dispatchBlockedMessage: string | null = null;
    if (!agentSlug) {
      dispatchBlockedMessage = 'No agent selected for Desk Report. Pick an agent in Desk Settings → Agent before this desk\'s report can be generated.';
    } else {
      let agentExists: boolean;
      try {
        const agents = await listS2SClawAgents();
        agentExists = agents.some((a) => a.slug === agentSlug);
      } catch (err) {
        logger.error(`[DeskReport] failed to check agent existence for ${agentSlug}:`, err);
        agentExists = true; // fail open on a transient lookup error — let the dispatch attempt itself decide
      }
      if (!agentExists) {
        dispatchBlockedMessage = `Agent "${agentSlug}" isn't configured in this workspace. Pick a different agent for Desk Report in Desk Settings → Agent.`;
      }
    }
    if (dispatchBlockedMessage) {
      logger.warn(`[DeskReport] channel ${channelId}: cannot dispatch — ${dispatchBlockedMessage}`, { channelId, agentSlug });
      await messageAttachmentRepo.create({
        entityId: channelId,
        entityType: DESK_REPORT_ENTITY_TYPE,
        originalFilename: `${channelName}-desk-report.html`,
        size: 0,
        mimetype: 'text/html',
        url: '',
        uploadedByUserId: owner.id,
        createdBy: owner.id,
        storageProvider: config.fileStorage.provider,
        conversationId: null,
        workspaceId,
        metadata: { status: 'failed', rangeDays, agentSlug, triggeredBy: 'cron', error: dispatchBlockedMessage },
      });
      return { channelId, success: false, error: dispatchBlockedMessage };
    }
    // Reached only when agentSlug was picked AND confirmed to exist above.
    const resolvedAgentSlug = agentSlug as string;

    // Write a pending placeholder first so the sidebar panel can show
    // "Generating…" while the agent run is in flight.
    const sessionId = randomUUID();
    await messageAttachmentRepo.create({
      entityId: channelId,
      entityType: DESK_REPORT_ENTITY_TYPE,
      originalFilename: `${channelName}-desk-report.html`,
      size: 0,
      mimetype: 'text/html',
      url: '',
      uploadedByUserId: owner.id,
      createdBy: owner.id,
      storageProvider: config.fileStorage.provider,
      conversationId: null,
      workspaceId,
      metadata: {
        status: 'pending',
        rangeDays,
        agentSlug: resolvedAgentSlug,
        triggeredBy: 'cron',
        sessionId,
        generatedAt: new Date().toISOString(),
      },
    });

    const rangeLabel = rangeDays === 1 ? 'the last 1 day' : `the last ${rangeDays} days`;
    const task = `Generate a desk html report for ${channelName} for ${rangeLabel}.`;
    const callbackUrl = `${config.backendUrl.replace(/\/$/, '')}/api/internal/desk-report/callback/${encodeURIComponent(channelId)}`;

    const { dispatched } = await runClawAgent({
      agentSlug: resolvedAgentSlug,
      task,
      userId: owner.id,
      userName: owner.name || 'Desk Owner',
      conversationId: `desk-report-${channelId}-${sessionId}`,
      channelId,
      workspaceId,
      resultForwardUrl: callbackUrl,
    });

    if (!dispatched) {
      logger.warn('[DeskReport] no installed-app webhook for agent — marking failed', {
        channelId,
        agentSlug: resolvedAgentSlug,
      });
      await this.markLatestPending(channelId, 'failed', 'Agent not installed for this workspace');
      return { channelId, success: false, error: 'Agent not installed for this workspace' };
    }

    logger.info(`[DeskReport] dispatched report generation for channel ${channelId} (agent=${resolvedAgentSlug})`);
    return { channelId, success: true };
  }

  /** Flip the most recent pending row for a channel to failed, e.g. on dispatch failure. */
  private async markLatestPending(channelId: string, status: 'failed', errorMessage?: string): Promise<void> {
    const pending = await db.messageAttachment.findFirst({
      where: { entityType: DESK_REPORT_ENTITY_TYPE, entityId: channelId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return;
    const metadata = (pending.metadata as Record<string, unknown> | null) ?? {};
    if (metadata['status'] !== 'pending') return;
    await db.messageAttachment.update({
      where: { id: pending.id },
      data: { metadata: { ...metadata, status, error: errorMessage ?? 'Generation failed' } },
    });
  }

  /**
   * Nightly cleanup — mirrors recap's cleanup job, but a desk's newest
   * COMPLETED report is never deleted regardless of age, so cleanup can't
   * regress a desk to "No report generated yet". Everything else past
   * retentionDays (or STUCK_PENDING_HOURS for stuck 'pending' rows) is
   * removed, storage file included.
   */
  async cleanupOldReports(retentionDays: number): Promise<{ deletedRows: number; deletedFiles: number }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

    const pendingCutoff = new Date();
    pendingCutoff.setUTCHours(pendingCutoff.getUTCHours() - STUCK_PENDING_HOURS);

    const rows = await db.messageAttachment.findMany({
      where: { entityType: DESK_REPORT_ENTITY_TYPE, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true, url: true, createdAt: true, metadata: true },
    });

    // Group by channel so we can always spare each channel's newest completed row.
    const latestCompletedIdByChannel = new Map<string, string>();
    for (const row of rows) {
      const status = (row.metadata as Record<string, unknown> | null)?.['status'];
      if (status !== 'completed') continue;
      if (!latestCompletedIdByChannel.has(row.entityId)) {
        latestCompletedIdByChannel.set(row.entityId, row.id); // rows are newest-first
      }
    }

    const toDelete = rows.filter((row) => {
      if (row.id === latestCompletedIdByChannel.get(row.entityId)) return false; // spare the newest per channel
      const status = (row.metadata as Record<string, unknown> | null)?.['status'];
      if (status === 'pending') return row.createdAt < pendingCutoff;
      return row.createdAt < cutoff;
    });

    let deletedFiles = 0;
    for (const row of toDelete) {
      if (!row.url) continue;
      try {
        await storageService.deleteFile(row.url);
        deletedFiles++;
      } catch (err) {
        logger.warn(`[DeskReport] cleanup: failed to delete storage file for ${row.id}:`, err);
      }
    }

    if (toDelete.length > 0) {
      await db.messageAttachment.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
    }

    logger.info(
      `[DeskReport] cleanup: deleted ${toDelete.length} row(s), ${deletedFiles} storage file(s) (retention=${retentionDays}d)`,
    );
    return { deletedRows: toDelete.length, deletedFiles };
  }
}

export const deskReportGenerationService = new DeskReportGenerationService();
