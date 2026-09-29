import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { assertChannelMembership, isDeskOwnerOrChannelAdmin } from '@/utils/channelMembership';
import { AttachmentEntityType, AttachmentUploadStatus } from '@xyne/shared';
import { deskReportGenerationService, STUCK_PENDING_HOURS } from '@/services/deskReportGenerationService';
import { storageService } from '@/services/storage/index';
import { normalizeStoragePath } from '@xyne/storage';
import { config } from '@/config/env';
import { UserManagementService } from '@/services/userManagementService';

const userManagementService = UserManagementService.getInstance();

/** Hard cap on how many distinct avatars we inline per report — a
 *  prompt-injected report must not fan out into unbounded storage reads. */
const MAX_INLINE_AVATARS = 50;
/** Skip (placeholder) any single avatar larger than this once inlined. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
/** 1x1 transparent GIF used when an avatar can't be resolved — we must never
 *  leave the original authenticated URL behind (it 401s cookielessly). */
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// <img ... src="URL"> / src='URL' — captures pre-src text, the quote, and the URL.
const IMG_SRC_RE = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;
// Authenticated same-origin avatar endpoint, relative or absolute:
//   /api/users/<id>/picture?v=<path>   or   https://host/api/users/<id>/picture
const AVATAR_URL_RE = /^(?:https?:\/\/[^/]+)?\/api\/users\/([^/?#]+)\/picture(?:[?#].*)?$/i;

/** Resolve one user's avatar to a data: URI using the SAME storage path a
 *  direct GET /api/users/<id>/picture would (mirrors
 *  userManagementController.streamProfilePicture). Returns null on any miss
 *  or oversize so the caller can fall back to a neutral placeholder. */
async function resolveAvatarDataUri(userId: string): Promise<string | null> {
  try {
    const user = await userManagementService.getUser(userId);
    const gcsPath = user?.picture;
    if (!gcsPath) return null;
    if (!(await storageService.fileExists(gcsPath))) return null;
    const metadata = await storageService.getFileMetadata(gcsPath);
    const declaredSize = parseInt(String(metadata.size ?? '0'), 10);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_AVATAR_BYTES) return null;
    const buffer = await storageService.getFileBuffer(gcsPath);
    if (buffer.length > MAX_AVATAR_BYTES) return null;
    const contentType = metadata.contentType || 'image/png';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    logger.warn('[DeskReportPanel] failed to inline avatar', { userId, error: err });
    return null;
  }
}

/** Rewrite authenticated same-origin avatar <img> sources in the report HTML
 *  to self-contained data: URIs, so the report renders inside the still-opaque
 *  sandboxed iframe without any cookie'd request. Non-authenticated, external,
 *  and data: images are left untouched. */
async function inlineAvatarImages(html: string): Promise<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(IMG_SRC_RE)) {
    const avatar = AVATAR_URL_RE.exec(m[3] ?? '');
    if (!avatar) continue;
    ids.add(avatar[1]!);
    if (ids.size >= MAX_INLINE_AVATARS) break;
  }
  if (ids.size === 0) return html;

  const resolved = new Map<string, string>();
  await Promise.all(
    [...ids].map(async (id) => {
      resolved.set(id, (await resolveAvatarDataUri(id)) ?? TRANSPARENT_PIXEL);
    }),
  );

  return html.replace(IMG_SRC_RE, (full: string, pre: string, quote: string, src: string) => {
    const avatar = AVATAR_URL_RE.exec(src);
    if (!avatar) return full;
    // Ids beyond the cap were never resolved — still must not keep their
    // authenticated URL (cookieless 401), so fall back to the placeholder.
    const dataUri = resolved.get(avatar[1]!) ?? TRANSPARENT_PIXEL;
    return `${pre}${quote}${dataUri}${quote}`;
  });
}

/** Maps the DB's uppercase enum to the lowercase status shape the frontend expects. */
function toClientStatus(uploadStatus: string | null): 'pending' | 'completed' | 'failed' {
  if (uploadStatus === AttachmentUploadStatus.COMPLETED) return 'completed';
  if (uploadStatus === AttachmentUploadStatus.FAILED) return 'failed';
  return 'pending';
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
      const canGenerate = await isDeskOwnerOrChannelAdmin(channelId, req.user?.id, ownerUserId);
      // Report contents are restricted to the same owner/admin set that can
      // generate them — members get nothing, not even the latest status.
      if (!canGenerate) {
        res.status(403).json({ success: false, error: 'Only the desk owner or a channel admin can view reports for this desk' });
        return;
      }

      // Query the latest completed report and the newest row directly via
      // uploadStatus — no fixed-window scan to push a completed report out of view.
      const [newest, completed] = await Promise.all([
        db.messageAttachment.findFirst({
          where: { entityType: AttachmentEntityType.DESK_REPORT, entityId: channelId, isDeleted: false },
          orderBy: { createdAt: 'desc' },
        }),
        db.messageAttachment.findFirst({
          where: {
            entityType: AttachmentEntityType.DESK_REPORT,
            entityId: channelId,
            isDeleted: false,
            uploadStatus: AttachmentUploadStatus.COMPLETED,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      if (!newest) {
        res.json({ success: true, data: null, canGenerate });
        return;
      }

      // A 'pending' row older than this is a crashed/dropped run, not still
      // generating — don't show "Generating…" forever.
      const stuckCutoff = new Date(Date.now() - STUCK_PENDING_HOURS * 60 * 60 * 1000);
      const isStuckPending = newest.uploadStatus === AttachmentUploadStatus.PENDING && newest.createdAt < stuckCutoff;
      const generating = newest.uploadStatus === AttachmentUploadStatus.PENDING && !isStuckPending;

      if (!completed) {
        // Never had a completed report — surface the newest row's own state
        // (pending/failed) as before.
        const metadata = (newest.metadata as Record<string, unknown> | null) ?? {};
        res.json({
          success: true,
          data: {
            status: isStuckPending ? 'failed' : toClientStatus(newest.uploadStatus),
            url: null,
            generatedAt: (metadata['generatedAt'] as string | undefined) ?? newest.createdAt.toISOString(),
            rangeDays: (metadata['rangeDays'] as number | undefined) ?? 1,
            agentSlug: (metadata['agentSlug'] as string | undefined) ?? null,
            error: isStuckPending ? 'Generation timed out' : ((metadata['error'] as string | undefined) ?? null),
            generating,
          },
          canGenerate,
        });
        return;
      }

      const metadata = (completed.metadata as Record<string, unknown> | null) ?? {};
      // Only surface an error if the newest attempt failed (or timed out) AND
      // it's not the one already represented by `completed` — i.e. a
      // regeneration attempt failed after this report was generated.
      const newestFailed = (newest.uploadStatus === AttachmentUploadStatus.FAILED || isStuckPending) && newest.id !== completed.id;
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
          error: newestFailed
            ? isStuckPending
              ? 'Generation timed out'
              : ((newestMetadata?.['error'] as string | undefined) ?? 'Generation failed')
            : null,
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
   * GET /api/desk-report/:channelId/view — streams the latest completed report's HTML.
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
      // Same gate as getLatest — only the desk owner or a channel admin may
      // read (or download) the report itself.
      const ownerUserId = (
        await db.emailChannelPreference.findUnique({ where: { channelId }, select: { ownerUserId: true } })
      )?.ownerUserId;
      if (!(await isDeskOwnerOrChannelAdmin(channelId, req.user?.id, ownerUserId))) {
        res.status(403).send('Only the desk owner or a channel admin can view reports for this desk');
        return;
      }

      // Must match getLatest — serve the latest COMPLETED row directly via
      // uploadStatus, not just the newest, since a regeneration may still be
      // pending.
      const latest = await db.messageAttachment.findFirst({
        where: {
          entityType: AttachmentEntityType.DESK_REPORT,
          entityId: channelId,
          isDeleted: false,
          uploadStatus: AttachmentUploadStatus.COMPLETED,
        },
        orderBy: { createdAt: 'desc' },
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
      // Inline authenticated avatar <img>s as data: URIs so the report renders
      // inside the opaque sandboxed iframe (and in a downloaded file) without
      // any cookie'd /api/users/.../picture request that would 401.
      const html = await inlineAvatarImages(buffer.toString('utf-8'));

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
        res.setHeader(
          'Content-Security-Policy',
          [
            // Keep the report on an OPAQUE origin: it is agent-generated,
            // prompt-injection-influenceable HTML, so it must never run its
            // scripts with first-party (allow-same-origin) privileges. The
            // authenticated avatar <img>s that used to 401 cookielessly under
            // this sandbox are instead inlined as data: URIs server-side
            // (see inlineAvatarImages), so no directive needs relaxing.
            'sandbox allow-scripts',
            "default-src 'none'",
            "script-src 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            'img-src data: https:',
            "connect-src 'none'",
            "frame-src 'none'",
            "form-action 'none'",
            "base-uri 'none'",
            `frame-ancestors 'self' ${config.frontendUrl}`,
          ].join('; '),
        );
      }
      res.send(html);
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

      if (!(await isDeskOwnerOrChannelAdmin(channelId, req.user?.id, pref?.ownerUserId))) {
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
