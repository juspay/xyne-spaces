import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import {
  FeatureAnnouncementStatus,
  isAnnouncementVideo,
  maxBytesForMedia,
  normalizeMimeType,
  resolveAnnouncementMediaType,
} from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { storageService } from '@/services/storage';
import { featureAnnouncementContentCache } from '@/services/featureAnnouncementContentCache';
import { parsePages } from '@/services/featureAnnouncementService';
import type {
  CreateFeatureAnnouncementInput,
  UpdateFeatureAnnouncementInput,
} from '@/validators/featureAnnouncementValidator';

/**
 * Every write clears the published-content cache. A product-wide announcement is visible
 * from every workspace, so a workspace-targeted invalidation would leave stale copies
 * behind for everyone else.
 */
async function afterWrite(): Promise<void> {
  await featureAnnouncementContentCache.invalidateAll();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function listAnnouncements(req: Request, res: Response) {
  const workspaceId = req.user?.workspaceId;
  if (!workspaceId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const announcements = await db.featureAnnouncement.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return res.json({
      announcements: announcements.map((row) => ({
        ...row,
        pageCount: parsePages(row.pages).length,
        editable: row.workspaceId === workspaceId,
      })),
    });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] List failed:', error);
    return res.status(500).json({ error: 'Failed to list announcements' });
  }
}

export async function getAnnouncement(req: Request, res: Response) {
  try {
    const announcement = await db.featureAnnouncement.findUnique({
      where: { id: req.params.id },
    });
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
    return res.json({ announcement });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] Get failed:', error);
    return res.status(500).json({ error: 'Failed to load announcement' });
  }
}

/**
 * `workspaceId` is forced to the author's workspace and never accepted from the body.
 * This backend has no cross-workspace admin role, so a workspace admin must not be able
 * to publish content that every other tenant would see.
 */
export async function createAnnouncement(req: Request, res: Response) {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return res.status(401).json({ error: 'Unauthorized' });

  const input = req.body as CreateFeatureAnnouncementInput;

  try {
    const announcement = await db.featureAnnouncement.create({
      data: {
        key: input.key,
        title: input.title,
        description: input.description,
        pages: input.pages as unknown as Prisma.InputJsonValue,
        mediaKey: input.mediaKey ?? null,
        mediaAlt: input.mediaAlt ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaType: input.ctaType ?? null,
        ctaTarget: input.ctaTarget ?? null,
        expiresAt: input.expiresAt ?? null,
        cacKey: input.cacKey ?? null,
        status: FeatureAnnouncementStatus.DRAFT,
        workspaceId,
        createdBy: userId,
      },
    });
    await afterWrite();
    return res.status(201).json({ announcement });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'An announcement with that key already exists' });
    }
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] Create failed:', error);
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
}

/**
 * `key` and `publishedAt` are immutable once published. Eligibility compares `publishedAt`
 * against every user's `createdAt`, so moving it would retroactively change who counts as
 * having already been offered the announcement.
 */
export async function updateAnnouncement(req: Request, res: Response) {
  const input = req.body as UpdateFeatureAnnouncementInput;

  try {
    const existing = await db.featureAnnouncement.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Announcement not found' });

    const data: Prisma.FeatureAnnouncementUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.pages !== undefined) data.pages = input.pages as unknown as Prisma.InputJsonValue;
    if (input.mediaKey !== undefined) data.mediaKey = input.mediaKey ?? null;
    if (input.mediaAlt !== undefined) data.mediaAlt = input.mediaAlt ?? null;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ?? null;
    if (input.cacKey !== undefined) data.cacKey = input.cacKey ?? null;
    if (input.ctaLabel !== undefined) data.ctaLabel = input.ctaLabel ?? null;
    if (input.ctaType !== undefined) data.ctaType = input.ctaType ?? null;
    if (input.ctaTarget !== undefined) data.ctaTarget = input.ctaTarget ?? null;

    const announcement = await db.featureAnnouncement.update({
      where: { id: req.params.id },
      data,
    });
    await afterWrite();
    return res.json({ announcement });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] Update failed:', error);
    return res.status(500).json({ error: 'Failed to update announcement' });
  }
}

export async function publishAnnouncement(req: Request, res: Response) {
  try {
    const existing = await db.featureAnnouncement.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Announcement not found' });
    if (existing.status === FeatureAnnouncementStatus.ARCHIVED) {
      return res.status(409).json({ error: 'An archived announcement cannot be published' });
    }
    if (parsePages(existing.pages).length === 0) {
      return res.status(400).json({ error: 'An announcement needs at least one page to publish' });
    }

    const announcement = await db.featureAnnouncement.update({
      where: { id: req.params.id },
      data: {
        status: FeatureAnnouncementStatus.PUBLISHED,
        publishedAt: existing.publishedAt ?? new Date(),
      },
    });
    await afterWrite();
    return res.json({ announcement });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] Publish failed:', error);
    return res.status(500).json({ error: 'Failed to publish announcement' });
  }
}

/** Archive rather than delete: `relationMode = "prisma"` gives no cascade, and retiring a
 *  row must not orphan the per-user state that references it. */
export async function archiveAnnouncement(req: Request, res: Response) {
  try {
    const existing = await db.featureAnnouncement.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Announcement not found' });

    const announcement = await db.featureAnnouncement.update({
      where: { id: req.params.id },
      data: { status: FeatureAnnouncementStatus.ARCHIVED },
    });
    await afterWrite();
    return res.json({ announcement });
  } catch (error) {
    logger.error('[FEATURE-ANNOUNCEMENT-ADMIN] Archive failed:', error);
    return res.status(500).json({ error: 'Failed to archive announcement' });
  }
}

export async function uploadAnnouncementMedia(req: Request, res: Response) {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  // The file has already streamed to storage by the time this runs, so a rejection has to
  // delete the object rather than merely refuse it.
  const discard = async (): Promise<void> => {
    if (file.path) await storageService.deleteFile(file.path).catch(() => undefined);
  };

  // The browser-reported type is authoritative when it is one we accept; otherwise fall
  // back to the filename, since some clients send application/octet-stream for everything.
  const contentType =
    resolveAnnouncementMediaType(file.mimetype, file.originalname) ??
    normalizeMimeType(file.mimetype);
  const maxBytes = maxBytesForMedia(contentType);

  if (maxBytes === null) {
    await discard();
    const described = contentType || file.originalname || 'that file';
    return res.status(415).json({
      error:
        `${described} can't be used here. Upload a PNG, JPEG, WebP or GIF image, ` +
        `or an MP4 or WebM video.`,
    });
  }

  if (file.size > maxBytes) {
    await discard();
    const isVideo = isAnnouncementVideo(contentType);
    return res.status(413).json({
      error:
        `${isVideo ? 'Video' : 'Image'} is ${formatBytes(file.size)} — the limit is ` +
        `${formatBytes(maxBytes)}.` +
        (isVideo
          ? ' Trimming the clip or exporting at a lower bitrate usually gets it under.'
          : ' Exporting as JPEG or WebP usually gets it under.'),
    });
  }

  return res.status(201).json({ mediaKey: file.path, size: file.size, contentType });
}
