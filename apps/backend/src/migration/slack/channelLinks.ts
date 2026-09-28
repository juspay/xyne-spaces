import type { WebClient } from '@slack/web-api';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { LinkVisibility } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { isCanvasFile, type SlackFile } from './channelFiles';
import type { MigrationTarget } from './migrationTarget';

export interface ChannelLink { url: string; title: string; favicon?: string; slackUserId?: string }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A channel's links: the bookmark bar (type:link) plus external/shared files. Uploads stay with the message pipeline. */
export async function fetchChannelLinks(client: WebClient, slackChannelId: string, files: SlackFile[]): Promise<ChannelLink[]> {
  const links: ChannelLink[] = [];
  try {
    const r = await client.bookmarks.list({ channel_id: slackChannelId });
    for (const b of (r.bookmarks ?? []) as Array<{ type?: string; link?: string; title?: string; icon_url?: string; last_updated_by_user_id?: string }>) {
      if (b.type === 'link' && b.link) {
        links.push({ url: b.link, title: b.title || b.link, favicon: b.icon_url || undefined, slackUserId: b.last_updated_by_user_id });
      }
    }
  } catch (e) {
    logger.warn('[ChannelLinks] bookmarks.list skipped (scope/membership?)', { slackChannelId, error: msg(e) });
  }
  for (const f of files) {
    if (isCanvasFile(f)) continue;
    if (f.is_external || f.external_url) {
      const url = f.external_url || f.url_private;
      if (url) links.push({ url, title: f.title || f.name || url, slackUserId: f.user });
    }
  }
  return links;
}

/** Idempotent: links dedup on their unique key. Returns the number created. */
export async function ingestChannelLinks(links: ChannelLink[], target: MigrationTarget): Promise<number> {
  let created = 0;
  const now = new Date();
  for (const l of links) {
    const createdBy = (await target.resolveUser(l.slackUserId)) ?? target.fallbackUserId;
    try {
      await db.link.create({
        data: {
          id: createId(), workspaceId: target.workspaceId, url: l.url, title: l.title, favicon: l.favicon ?? null,
          channelId: target.xyneChannelId, createdBy, visibility: LinkVisibility.DEFAULT, createdAt: now, updatedAt: now,
        },
      });
      created += 1;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // already migrated
      logger.warn('[ChannelLinks] create failed', { url: l.url, error: msg(e) });
    }
  }
  return created;
}
