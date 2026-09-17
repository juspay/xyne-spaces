/**
 * Migrate a Slack channel/DM's non-message surfaces — bookmarks bar, shared/external links, and canvases —
 * into Xyne (`Link` + `Canvas`). Shared by BOTH the self-serve flow and `/sync`:
 *   - `fetchChannelExtras` reads the surfaces from Slack (bookmarks.list + files.list, canvas HTML via url_private).
 *   - `ingestChannelExtras` writes them to Xyne, idempotently.
 *
 * File uploads and pins are already migrated by the message pipeline, so they are intentionally not handled here.
 */
import fetch from 'node-fetch';
import type { WebClient } from '@slack/web-api';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { CanvasRole, CanvasVisibility, LinkVisibility } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { withServerEditor } from '@/utils/serverBlockNoteEditor';
import { initializeYSweetDoc } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

const CANVAS_FILETYPES = new Set(['quip', 'canvas']);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface ChannelLink { url: string; title: string; favicon?: string; slackUserId?: string }
export interface ChannelCanvas { slackFileId: string; title: string; slackUserId?: string; html: string }
export interface ChannelExtras { links: ChannelLink[]; canvases: ChannelCanvas[] }

interface SlackFile {
  id: string; name?: string; title?: string; filetype?: string; mode?: string;
  is_external?: boolean; external_url?: string; url_private?: string; url_private_download?: string; user?: string;
}

/** Download a Slack-hosted file's text body (canvas HTML) with the token. */
async function fetchFileText(token: string, url?: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return resp.ok ? await resp.text() : undefined;
  } catch (e) {
    logger.warn('[ChannelExtras] canvas fetch failed', { url, error: msg(e) });
    return undefined;
  }
}

/** Read a channel/DM's bookmarks + external links + canvases from Slack. Each surface is fail-soft. */
export async function fetchChannelExtras(client: WebClient, token: string, slackChannelId: string): Promise<ChannelExtras> {
  const links: ChannelLink[] = [];
  const canvases: ChannelCanvas[] = [];

  // Bookmarks bar (only `type: link` bookmarks map to a URL).
  try {
    const r = await client.bookmarks.list({ channel_id: slackChannelId });
    for (const b of (r.bookmarks ?? []) as Array<{ type?: string; link?: string; title?: string; icon_url?: string; last_updated_by_user_id?: string }>) {
      if (b.type === 'link' && b.link) {
        links.push({ url: b.link, title: b.title || b.link, favicon: b.icon_url || undefined, slackUserId: b.last_updated_by_user_id });
      }
    }
  } catch (e) {
    logger.warn('[ChannelExtras] bookmarks.list skipped (scope/membership?)', { slackChannelId, error: msg(e) });
  }

  // Files & links tab: canvases (quip) + external links. Uploaded files are handled by the message pipeline.
  try {
    let cursor: string | undefined;
    do {
      const r = await client.files.list({ channel: slackChannelId, limit: 200, cursor } as never);
      for (const f of (r.files ?? []) as SlackFile[]) {
        const isCanvas = (f.filetype && CANVAS_FILETYPES.has(f.filetype)) || f.mode === 'quip' || f.mode === 'canvas';
        if (isCanvas) {
          const html = await fetchFileText(token, f.url_private_download || f.url_private);
          if (html) canvases.push({ slackFileId: f.id, title: f.title || f.name || 'Canvas', slackUserId: f.user, html });
        } else if (f.is_external || f.external_url) {
          const url = f.external_url || f.url_private;
          if (url) links.push({ url, title: f.title || f.name || url, slackUserId: f.user });
        }
      }
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    logger.warn('[ChannelExtras] files.list skipped (membership?)', { slackChannelId, error: msg(e) });
  }

  return { links, canvases };
}

export interface ExtrasContext {
  xyneChannelId: string;
  workspaceId: string;
  /** Slack user id → Xyne user id (undefined if unresolvable). Reuses the migration's offline user directory. */
  resolveUser: (slackUserId: string | undefined) => Promise<string | undefined>;
  /** Used as author when a specific Slack user can't be resolved (e.g. the channel creator / job owner). */
  fallbackUserId: string;
}

/** Write the extras to Xyne. Idempotent: links dedup on their unique key, canvases skip if already migrated. */
export async function ingestChannelExtras(extras: ChannelExtras, ctx: ExtrasContext): Promise<{ links: number; canvases: number }> {
  let links = 0;
  let canvases = 0;
  for (const l of extras.links) {
    const createdBy = (await ctx.resolveUser(l.slackUserId)) ?? ctx.fallbackUserId;
    if (await createLink(l, createdBy, ctx)) links += 1;
  }
  for (const cv of extras.canvases) {
    const createdBy = (await ctx.resolveUser(cv.slackUserId)) ?? ctx.fallbackUserId;
    if (await createCanvas(cv, createdBy, ctx)) canvases += 1;
  }
  return { links, canvases };
}

async function createLink(l: ChannelLink, createdBy: string, ctx: ExtrasContext): Promise<boolean> {
  const now = new Date();
  try {
    await db.link.create({
      data: {
        id: createId(), workspaceId: ctx.workspaceId, url: l.url, title: l.title, favicon: l.favicon ?? null,
        channelId: ctx.xyneChannelId, createdBy, visibility: LinkVisibility.DEFAULT, createdAt: now, updatedAt: now,
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false; // already migrated
    logger.warn('[ChannelExtras] link create failed', { url: l.url, error: msg(e) });
    return false;
  }
}

async function createCanvas(cv: ChannelCanvas, createdBy: string, ctx: ExtrasContext): Promise<boolean> {
  // Idempotent: one Xyne canvas per Slack canvas per channel — skip if already migrated (never clobber later edits).
  const existing = await db.canvas.findFirst({
    where: { channelId: ctx.xyneChannelId, metadata: { path: ['slackFileId'], equals: cv.slackFileId } },
    select: { id: true },
  });
  if (existing) return false;

  const blocks = (await withServerEditor((editor) => editor.tryParseHTMLToBlocks(cv.html))) as BlockNoteBlock[];
  const canvasId = createId();
  const now = new Date();
  await db.canvas.create({
    data: {
      id: canvasId, workspaceId: ctx.workspaceId, title: cv.title,
      content: blocks as unknown as Prisma.InputJsonValue,
      channelId: ctx.xyneChannelId, createdBy, visibility: CanvasVisibility.PUBLIC, isCollaborative: true,
      lastEditedBy: createdBy, lastEditedAt: now, createdAt: now, updatedAt: now,
      metadata: { source: 'slack_migration', slackFileId: cv.slackFileId },
    },
  });
  // Creator is OWNER; the channel is an EDITOR participant so every channel member can open/edit it ("open").
  await db.canvasParticipant.createMany({
    data: [
      { id: createId(), canvasId, workspaceId: ctx.workspaceId, userId: createdBy, role: CanvasRole.OWNER, joinedAt: now, updatedAt: now },
      { id: createId(), canvasId, workspaceId: ctx.workspaceId, channelId: ctx.xyneChannelId, role: CanvasRole.EDITOR, joinedAt: now, updatedAt: now },
    ],
    skipDuplicates: true,
  });
  // Populate the collaborative doc so the editor actually renders the content (DB content alone isn't enough).
  await initializeYSweetDoc(canvasId, blocks, createdBy).catch((e) =>
    logger.warn('[ChannelExtras] ysweet init failed', { canvasId, error: msg(e) }),
  );
  return true;
}
