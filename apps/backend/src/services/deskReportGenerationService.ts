import { randomUUID } from 'crypto';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { runClawAgent } from '@/services/clawAgentService';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { storageService } from '@/services/storage';
import { runAsServiceActor } from '@/database/tenant/context';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';

const DESK_REPORT_SCHEDULER_ACTOR_ID = 'desk-report-scheduler';

const DESK_REPORT_ENTITY_TYPE = AttachmentEntityType.DESK_REPORT;
// A run with no callback (crash, dropped webhook) is reaped as failed past this age.
export const STUCK_PENDING_HOURS = 3;
export const DEFAULT_DESK_REPORT_AGENT_SLUG = 'desk-report-generator';

const messageAttachmentRepo = new MessageAttachmentRepository();

export interface DeskReportGenerationResult {
  channelId: string;
  success: boolean;
  error?: string;
}

export class DeskReportGenerationService {
  /**
   * Sweep every channel with deskReportEnabled=true and trigger a fresh report for each.
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
        const result = await runAsServiceActor(DESK_REPORT_SCHEDULER_ACTOR_ID, pref.workspaceId, () =>
          this.generateReportForChannel(pref),
        );
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
   * "generate now" trigger — always scoped to a single channelId.
   */
  async generateReportForChannel(pref: {
    channelId: string;
    ownerUserId: string | null;
    workspaceId: string;
    deskReportAgentSlug: string | null;
    deskReportRangeDays: number | null;
  }): Promise<DeskReportGenerationResult> {
    const { channelId, workspaceId } = pref;
    const agentSlug = pref.deskReportAgentSlug?.trim() || DEFAULT_DESK_REPORT_AGENT_SLUG;
    const rangeDays = pref.deskReportRangeDays && pref.deskReportRangeDays > 0 ? pref.deskReportRangeDays : 1;

    if (!pref.ownerUserId) {
      logger.warn(`[DeskReport] channel ${channelId} has deskReportEnabled but no ownerUserId — skipping`);
      return { channelId, success: false, error: 'No desk owner configured' };
    }

    // Reap anything past STUCK_PENDING_HOURS before checking if one's in flight.
    await this.reapStuckPending(channelId);

    // Refuse a second run while one's in flight. Plain check-then-write.
    const existingPending = await db.messageAttachment.findFirst({
      where: { entityType: DESK_REPORT_ENTITY_TYPE, entityId: channelId, isDeleted: false, uploadStatus: AttachmentUploadStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) {
      logger.info(`[DeskReport] channel ${channelId} already has a report generating — skipping`);
      return { channelId, success: false, error: 'A report is already generating for this desk' };
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
    const resolvedAgentSlug = agentSlug;

    // Write a pending placeholder first so the sidebar panel can show
    // "Generating…" while the agent run is in flight. The callback URL below
    // embeds this row's own id so a stale/delayed callback can only ever
    // complete THIS run's row, never a different pending row for the same channel.
    const sessionId = randomUUID();
    const pending = await messageAttachmentRepo.create({
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
      uploadStatus: AttachmentUploadStatus.PENDING,
      metadata: {
        rangeDays,
        agentSlug: resolvedAgentSlug,
        triggeredBy: 'cron',
        sessionId,
        generatedAt: new Date().toISOString(),
      },
    });

    const rangeLabel = rangeDays === 1 ? 'the last 1 day' : `the last ${rangeDays} days`;
    const task = `Generate a desk html report for ${channelName} for ${rangeLabel}.`;
    const callbackUrl = `${config.backendUrl.replace(/\/$/, '')}/api/internal/desk-report/callback/${encodeURIComponent(channelId)}/${encodeURIComponent(pending.id)}`;

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
      const errorMessage = pref.deskReportAgentSlug?.trim()
        ? `Agent "${resolvedAgentSlug}" isn't configured in this workspace. Pick a different agent for Desk Report in Desk Settings → Agent.`
        : `The default Desk Report agent isn't installed in this workspace yet. Ask an admin to install it, or pick a different agent in Desk Settings → Agent.`;
      logger.warn('[DeskReport] no installed-app webhook for agent — marking failed', {
        channelId,
        agentSlug: resolvedAgentSlug,
      });
      await this.markPendingFailed(pending.id, errorMessage);
      return { channelId, success: false, error: errorMessage };
    }

    logger.info(`[DeskReport] dispatched report generation for channel ${channelId} (agent=${resolvedAgentSlug})`);
    return { channelId, success: true };
  }

  /** Flip a specific pending row to failed by id, e.g. on dispatch failure. */
  private async markPendingFailed(id: string, errorMessage?: string): Promise<void> {
    const pending = await db.messageAttachment.findUnique({ where: { id } });
    if (!pending) return;
    const metadata = (pending.metadata as Record<string, unknown> | null) ?? {};
    await db.messageAttachment.update({
      where: { id },
      data: { uploadStatus: AttachmentUploadStatus.FAILED, metadata: { ...metadata, error: errorMessage ?? 'Generation failed' } },
    });
  }

  /**
   * Flip this channel's pending row(s) to 'failed' if they've been pending
   * longer than STUCK_PENDING_HOURS (crashed agent, dropped webhook) — so a
   * dropped run doesn't just sit there and block a fresh dispatch.
   */
  private async reapStuckPending(channelId: string): Promise<void> {
    const stuckCutoff = new Date(Date.now() - STUCK_PENDING_HOURS * 60 * 60 * 1000);
    const stuck = await db.messageAttachment.findMany({
      where: {
        entityType: DESK_REPORT_ENTITY_TYPE,
        entityId: channelId,
        isDeleted: false,
        uploadStatus: AttachmentUploadStatus.PENDING,
        createdAt: { lt: stuckCutoff },
      },
    });
    for (const row of stuck) {
      const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
      await db.messageAttachment.update({
        where: { id: row.id },
        data: { uploadStatus: AttachmentUploadStatus.FAILED, metadata: { ...metadata, error: 'Generation timed out' } },
      });
    }
  }

  async cleanupOldReports(retentionDays: number): Promise<{ deletedRows: number; deletedFiles: number }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

    const stuckCutoff = new Date(Date.now() - STUCK_PENDING_HOURS * 60 * 60 * 1000);
    await db.messageAttachment.updateMany({
      where: {
        entityType: DESK_REPORT_ENTITY_TYPE,
        isDeleted: false,
        uploadStatus: AttachmentUploadStatus.PENDING,
        createdAt: { lt: stuckCutoff },
      },
      data: { uploadStatus: AttachmentUploadStatus.FAILED },
    });

    const rows = await db.messageAttachment.findMany({
      where: { entityType: DESK_REPORT_ENTITY_TYPE, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true, url: true, createdAt: true, uploadStatus: true },
    });

    // Group by channel so we can always spare each channel's newest completed row.
    const latestCompletedIdByChannel = new Map<string, string>();
    for (const row of rows) {
      if (row.uploadStatus !== AttachmentUploadStatus.COMPLETED) continue;
      if (!latestCompletedIdByChannel.has(row.entityId)) {
        latestCompletedIdByChannel.set(row.entityId, row.id); // rows are newest-first
      }
    }

    const toDelete = rows.filter((row) => {
      if (row.id === latestCompletedIdByChannel.get(row.entityId)) return false; // spare the newest per channel
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
