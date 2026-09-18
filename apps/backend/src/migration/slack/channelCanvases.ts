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

async function fileDownloadUrl(token: string, fileId: string): Promise<string | undefined> {
  try {
    const resp = await fetch('https://slack.com/api/files.info?file=' + fileId, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await resp.json()) as { ok?: boolean; file?: { url_private_download?: string; url_private?: string } };
    return j.ok ? (j.file?.url_private_download || j.file?.url_private) : undefined;
  } catch (e) {
    logger.warn('[ChannelCanvases] files.info failed', { fileId, error: msg(e) });
    return undefined;
  }
}

// A canvas can embed other canvas files (<p class="embedded-file">File ID: sd:Fxxx…</p>); the real content lives in
// those. Inline each embedded canvas's body in place of the reference so migration captures actual content, not a link.
const EMBED_RE = /<p[^>]*class=['"]embedded-file['"][^>]*>[\s\S]*?File ID: sd:(F[A-Z0-9]+)[\s\S]*?<\/p>/g;
const INNER_RE = /<div class="quip-canvas-content">([\s\S]*)<\/div>\s*$/;

async function resolveEmbeds(token: string, html: string, seen: Set<string>, depth = 0): Promise<string> {
  if (depth > 3) return html;
  const embeds = [...html.matchAll(EMBED_RE)];
  let out = html;
  for (const m of embeds) {
    const fileId = m[1];
    if (seen.has(fileId)) { out = out.replace(m[0], ''); continue; } // guard against cycles
    seen.add(fileId);
    const body = await fetchFileText(token, await fileDownloadUrl(token, fileId));
    let inner = '';
    if (body) {
      inner = (body.match(INNER_RE) || [])[1] ?? body;
      inner = await resolveEmbeds(token, inner, seen, depth + 1);
    }
    out = out.replace(m[0], inner);
  }
  return out;
}

/** The channel's canvas files, HTML downloaded via the token and embedded canvases inlined. */
export async function fetchChannelCanvases(token: string, files: SlackFile[]): Promise<ChannelCanvas[]> {
  const canvases: ChannelCanvas[] = [];
  for (const f of files) {
    if (!isCanvasFile(f)) continue;
    let html = await fetchFileText(token, f.url_private_download || f.url_private);
    if (!html) continue;
    html = await resolveEmbeds(token, html, new Set([f.id]));
    canvases.push({ slackFileId: f.id, title: f.title || f.name || 'Canvas', slackUserId: f.user, html });
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
