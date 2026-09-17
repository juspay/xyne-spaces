import fetch from 'node-fetch';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withServerEditor } from '@/utils/serverBlockNoteEditor';
import { initializeYSweetDoc } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { isCanvasFile, type SlackFile } from './channelFiles';
import type { MigrationTarget } from './migrationTarget';

export interface ChannelCanvas { slackFileId: string; title: string; slackUserId?: string; html: string }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function fetchFileText(token: string, url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.ok ? await resp.text() : undefined;
  } catch (e) {
    logger.warn('[ChannelCanvases] canvas fetch failed', { url, error: msg(e) });
    return undefined;
  }
}

/** The channel's canvas files, with their HTML body downloaded via the token. */
export async function fetchChannelCanvases(token: string, files: SlackFile[]): Promise<ChannelCanvas[]> {
  const canvases: ChannelCanvas[] = [];
  for (const f of files) {
    if (!isCanvasFile(f)) continue;
    const html = await fetchFileText(token, f.url_private_download || f.url_private);
    if (html) canvases.push({ slackFileId: f.id, title: f.title || f.name || 'Canvas', slackUserId: f.user, html });
  }
  return canvases;
}

/** Idempotent: one Xyne canvas per Slack canvas per channel — skip if already migrated. Returns the number created. */
export async function ingestChannelCanvases(canvases: ChannelCanvas[], target: MigrationTarget): Promise<number> {
  let created = 0;
  for (const cv of canvases) {
    const createdBy = (await target.resolveUser(cv.slackUserId)) ?? target.fallbackUserId;
    if (await createCanvas(cv, createdBy, target)) created += 1;
  }
  return created;
}

async function createCanvas(cv: ChannelCanvas, createdBy: string, target: MigrationTarget): Promise<boolean> {
  const existing = await db.canvas.findFirst({
    where: { channelId: target.xyneChannelId, metadata: { path: ['slackFileId'], equals: cv.slackFileId } },
    select: { id: true },
  });
  if (existing) return false; // never clobber later edits

  const blocks = (await withServerEditor((editor) => editor.tryParseHTMLToBlocks(cv.html))) as BlockNoteBlock[];
  const canvasId = createId();
  const now = new Date();
  await db.canvas.create({
    data: {
      id: canvasId, workspaceId: target.workspaceId, title: cv.title,
      content: blocks as unknown as Prisma.InputJsonValue,
      channelId: target.xyneChannelId, createdBy, visibility: CanvasVisibility.PUBLIC, isCollaborative: true,
      lastEditedBy: createdBy, lastEditedAt: now, createdAt: now, updatedAt: now,
      metadata: { source: 'slack_migration', slackFileId: cv.slackFileId },
    },
  });
  // Creator is OWNER; the channel is an EDITOR so every member can open/edit it.
  await db.canvasParticipant.createMany({
    data: [
      { id: createId(), canvasId, workspaceId: target.workspaceId, userId: createdBy, role: CanvasRole.OWNER, joinedAt: now, updatedAt: now },
      { id: createId(), canvasId, workspaceId: target.workspaceId, channelId: target.xyneChannelId, role: CanvasRole.EDITOR, joinedAt: now, updatedAt: now },
    ],
    skipDuplicates: true,
  });
  // Populate the collaborative doc so the editor renders content (DB content alone isn't enough).
  await initializeYSweetDoc(canvasId, blocks, createdBy).catch((e) => logger.warn('[ChannelCanvases] ysweet init failed', { canvasId, error: msg(e) }));
  return true;
}
