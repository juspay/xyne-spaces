import { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { storageService } from '@/services/storage';
import { resolveAnnouncementMediaType } from '@xyne/shared';
import { setSafeInlineMediaHeaders } from '@/utils/safeAttachmentDownload';
import { featureAnnouncementService, parsePages } from '@/services/featureAnnouncementService';
import type { EligibilitySubject } from '@/services/featureAnnouncementEligibility';

/**
 * The subject always comes from the authenticated session. A userId in the body would let
 * one account write another's delivery state.
 */
async function resolveSubject(req: Request): Promise<EligibilitySubject | null> {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { createdAt: true },
  });
  if (!user) return null;

  return { userId, workspaceId, userCreatedAt: user.createdAt };
}

export async function getPendingAnnouncements(req: Request, res: Response) {
  const subject = await resolveSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const announcements = await featureAnnouncementService.getPending(subject);
    return res.json({ announcements });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Pending lookup failed:', error);
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
}

export async function markAnnouncementSeen(req: Request, res: Response) {
  const subject = await resolveSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  const announcementId = req.params.id;
  const { pageIndex } = req.body as { pageIndex: number };

  try {
    const announcement = await featureAnnouncementService.findPublishedById(
      subject,
      announcementId
    );
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

    if (pageIndex >= parsePages(announcement.pages).length) {
      return res.status(400).json({ error: 'pageIndex is outside this announcement' });
    }

    const state = await featureAnnouncementService.recordSeen(subject, announcementId, pageIndex);
    return res.json({ progress: state.progress, seenCount: state.seenCount });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Seen write failed:', error);
    return res.status(500).json({ error: 'Failed to record view' });
  }
}

export async function markAnnouncementCtaClicked(req: Request, res: Response) {
  const subject = await resolveSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  const announcementId = req.params.id;

  try {
    const announcement = await featureAnnouncementService.findPublishedById(
      subject,
      announcementId
    );
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

    await featureAnnouncementService.recordCta(subject, announcementId);
    return res.json({ success: true });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] CTA write failed:', error);
    return res.status(500).json({ error: 'Failed to record CTA click' });
  }
}

export async function dismissAnnouncements(req: Request, res: Response) {
  const subject = await resolveSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  const { announcementIds } = req.body as { announcementIds: string[] };

  try {
    const dismissed = await featureAnnouncementService.dismiss(subject, announcementIds);
    return res.json({ dismissed });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Dismiss failed:', error);
    return res.status(500).json({ error: 'Failed to dismiss announcements' });
  }
}

/**
 * Media is addressed by announcement and page position, never by storage key: the key is
 * read from the row, so a caller cannot name an arbitrary object in the bucket.
 */
async function streamMediaFor(
  res: Response,
  announcement: { mediaKey: string | null; pages: unknown } | null,
  index: string,
  immutable: boolean
) {
  if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

  const mediaKey =
    index === 'cover'
      ? announcement.mediaKey
      : (parsePages(announcement.pages)[Number(index)]?.mediaKey ?? null);

  if (!mediaKey) return res.status(404).json({ error: 'Media not found' });

  const metadata = await storageService.getFileMetadata(mediaKey);
  const contentType = resolveAnnouncementMediaType(metadata.contentType, mediaKey);
  if (!contentType || !setSafeInlineMediaHeaders(res, contentType)) {
    logger.warn('[FEATURE-ANNOUNCEMENT-CTRL] Unsupported stored media', {
      mediaKey,
      storedContentType: metadata.contentType,
    });
    return res.status(415).json({ error: 'Stored media is not a supported type' });
  }
  // Published bytes never change and one asset is read by every user, so it is cached
  // hard. A draft is still being edited, so its preview must not be.
  res.setHeader(
    'Cache-Control',
    immutable ? 'public, max-age=31536000, immutable' : 'private, no-store'
  );
  if (metadata.size) res.setHeader('Content-Length', String(metadata.size));

  const stream = await storageService.createReadStream(mediaKey);
  stream.on('error', (error: Error) => {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Media stream error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream media' });
    else res.destroy(error);
  });
  return stream.pipe(res);
}

export async function streamAnnouncementMedia(req: Request, res: Response) {
  const subject = await resolveSubject(req);
  if (!subject) return res.status(401).json({ error: 'Unauthorized' });

  const { id, index } = req.params;

  try {
    const announcement = await featureAnnouncementService.findPublishedById(subject, id);
    return await streamMediaFor(res, announcement, index, true);
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Media lookup failed:', error);
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to stream media' });
    return res.end();
  }
}

/**
 * Draft media, so an admin can preview an announcement before publishing it. Reads go
 * through the ACL-scoped client, so a draft in another workspace is simply not found.
 */
export async function streamAnnouncementMediaForAdmin(req: Request, res: Response) {
  const { id, index } = req.params;

  try {
    const announcement = await db.featureAnnouncement.findUnique({
      where: { id },
      select: { mediaKey: true, pages: true },
    });
    return await streamMediaFor(res, announcement, index, false);
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-CTRL] Admin media lookup failed:', error);
    if (!res.headersSent) return res.status(500).json({ error: 'Failed to stream media' });
    return res.end();
  }
}
