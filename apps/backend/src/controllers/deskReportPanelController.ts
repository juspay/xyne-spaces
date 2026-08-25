/**
 * Read-side for the Desk Report sidebar panel — "give me the latest generated
 * report for THIS desk". Every query is filtered by entityId=channelId, which
 * is what guarantees a desk can never see another desk's report (see the
 * Phase 2 plan's isolation requirement).
 */
import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { assertChannelMembership } from '@/utils/channelMembership';
import { AttachmentEntityType, ChannelRole } from '@xyne/shared';
import { deskReportGenerationService } from '@/services/deskReportGenerationService';
import { storageService } from '@/services/storage/index';
import { normalizeStoragePath } from '@xyne/storage';
import { config } from '@/config/env';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

const channelParticipantRepo = new ChannelParticipantRepository();

/**
 * "Can this user manage Desk Report for this desk" — same rule as
 * EmailChannelPreferencesACL.canUpdate: the desk owner, or a channel-level
 * admin, never an org-wide role. Shared by getLatest (button visibility)
 * and generateNow (actual enforcement).
 */
async function canManageDeskReport(
  channelId: string,
  userId: string | undefined,
  ownerUserId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (ownerUserId && ownerUserId === userId) return true;
  const participant = await channelParticipantRepo.findParticipant(channelId, userId);
  return participant?.role === ChannelRole.ADMIN;
}

export class DeskReportPanelController {
  /** GET /api/desk-report/:channelId/latest */
  getLatest = async (req: Request, res: Response): Promise<void> => {
    const channelId = req.params['channelId'];
    if (!channelId) {
      res.status(400).json({ success: false, error: 'channelId is required' });
      return;
    }

    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) {
      res.status(access.status).json({ success: false, error: access.error });
      return;
    }

    try {
      // Computed server-side and returned as `canGenerate` so the panel's
      // button visibility can never drift from what generateNow enforces.
      const ownerUserId = (
        await db.emailChannelPreference.findUnique({ where: { channelId }, select: { ownerUserId: true } })
      )?.ownerUserId;
      const canGenerate = await canManageDeskReport(channelId, req.user?.id, ownerUserId);

      // Pull recent rows, not just the newest — a regeneration writes a
      // fresh 'pending' row that would otherwise blank out the report the
      // user is looking at. We report the latest COMPLETED report plus a
      // `generating` flag, so the previous report never disappears mid-run.
      const recent = await db.messageAttachment.findMany({
        where: {
          entityType: AttachmentEntityType.DESK_REPORT,
          entityId: channelId,
          isDeleted: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      if (recent.length === 0) {
        res.json({ success: true, data: null, canGenerate });
        return;
      }

      const statusOf = (row: (typeof recent)[number]): string => {
        const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
        return typeof metadata['status'] === 'string' ? metadata['status'] : 'completed';
      };

      const newest = recent[0];
      const completed = recent.find((row) => statusOf(row) === 'completed') ?? null;
      const generating = statusOf(newest) === 'pending';

      if (!completed) {
        // Never had a completed report — surface the newest row's own state
        // (pending/failed) as before.
        const metadata = (newest.metadata as Record<string, unknown> | null) ?? {};
        res.json({
          success: true,
          data: {
            status: statusOf(newest),
            url: null,
            generatedAt: (metadata['generatedAt'] as string | undefined) ?? newest.createdAt.toISOString(),
            rangeDays: (metadata['rangeDays'] as number | undefined) ?? 1,
            agentSlug: (metadata['agentSlug'] as string | undefined) ?? null,
            error: (metadata['error'] as string | undefined) ?? null,
            generating,
          },
          canGenerate,
        });
        return;
      }

      const metadata = (completed.metadata as Record<string, unknown> | null) ?? {};
      // Only surface an error if the newest attempt failed AND it's not the
      // one already represented by `completed` — i.e. a regeneration attempt
      // failed after this report was generated.
      const newestFailed = statusOf(newest) === 'failed' && newest.id !== completed.id;
      const newestMetadata = newestFailed ? ((newest.metadata as Record<string, unknown> | null) ?? {}) : null;

      res.json({
        success: true,
        data: {
          status: 'completed',
          // `latest.url` is a raw storage path, not a fetchable web URL —
          // point the client at our own streaming route instead.
          url: `/desk-report/${encodeURIComponent(channelId)}/view`,
          generatedAt: (metadata['generatedAt'] as string | undefined) ?? completed.createdAt.toISOString(),
          rangeDays: (metadata['rangeDays'] as number | undefined) ?? 1,
          agentSlug: (metadata['agentSlug'] as string | undefined) ?? null,
          error: newestFailed ? ((newestMetadata?.['error'] as string | undefined) ?? 'Generation failed') : null,
          generating,
        },
        canGenerate,
      });
    } catch (err) {
      logger.error('[DeskReportPanel] getLatest failed', { channelId, error: err });
      res.status(500).json({ success: false, error: 'Failed to fetch desk report' });
    }
  };

  /**
   * GET /api/desk-report/:channelId/view — streams the latest completed
   * report's HTML. Add `?download=1` to force a save-as instead of inline
   * render. The report is our own server-generated, sanitized HTML (not a
   * user upload), so unlike the generic attachment-download route it's safe
   * to serve as inline text/html for the sidebar iframe.
   */
  serveReport = async (req: Request, res: Response): Promise<void> => {
    const channelId = req.params['channelId'];
    if (!channelId) {
      res.status(400).send('channelId is required');
      return;
    }

    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) {
      res.status(access.status).send(access.error);
      return;
    }

    try {
      // Must match getLatest's fallback — serve the latest COMPLETED row,
      // not just the newest, since a regeneration may still be pending.
      const recent = await db.messageAttachment.findMany({
        where: { entityType: AttachmentEntityType.DESK_REPORT, entityId: channelId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const latest = recent.find((row) => {
        const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
        return metadata['status'] === 'completed';
      });
      if (!latest || !latest.url) {
        res.status(404).send('No completed desk report for this channel');
        return;
      }

      const filePath = normalizeStoragePath(latest.url);
      if (!filePath) {
        res.status(404).send('Report file not found');
        return;
      }
      const buffer = await storageService.getFileBuffer(filePath);

      const download = req.query['download'] === '1';
      const filename = encodeURIComponent(latest.originalFilename || 'desk-report.html');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=60');
      if (!download) {
        // helmet's default X-Frame-Options/CSP would otherwise block this
        // route's whole purpose — embedding in the dashboard's iframe.
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${config.frontendUrl}`);
      }
      res.send(buffer);
    } catch (err) {
      logger.error('[DeskReportPanel] serveReport failed', { channelId, error: err });
      res.status(500).send('Failed to load desk report');
    }
  };

  /** POST /api/desk-report/:channelId/generate — manual "generate now" trigger. */
  generateNow = async (req: Request, res: Response): Promise<void> => {
    const channelId = req.params['channelId'];
    if (!channelId) {
      res.status(400).json({ success: false, error: 'channelId is required' });
      return;
    }

    const access = await assertChannelMembership(req, channelId);
    if (!access.ok) {
      res.status(access.status).json({ success: false, error: access.error });
      return;
    }

    try {
      const pref = await db.emailChannelPreference.findUnique({
        where: { channelId },
        select: {
          channelId: true,
          ownerUserId: true,
          workspaceId: true,
          deskReportEnabled: true,
          deskReportAgentSlug: true,
          deskReportRangeDays: true,
        },
      });

      if (!(await canManageDeskReport(channelId, req.user?.id, pref?.ownerUserId))) {
        res
          .status(403)
          .json({ success: false, error: 'Only the desk owner or a channel admin can generate a report for this desk' });
        return;
      }

      if (!pref?.deskReportEnabled) {
        res.status(400).json({ success: false, error: 'Desk report is not enabled for this desk' });
        return;
      }

      const result = await deskReportGenerationService.generateReportForChannel(pref);
      res.json({ success: result.success, error: result.error });
    } catch (err) {
      logger.error('[DeskReportPanel] generateNow failed', { channelId, error: err });
      res.status(500).json({ success: false, error: 'Failed to trigger desk report' });
    }
  };
}

export const deskReportPanelController = new DeskReportPanelController();
