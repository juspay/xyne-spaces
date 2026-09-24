import type { WebClient } from '@slack/web-api';
import { logger } from '@/utils/logger';

export interface SlackFile {
  id: string; name?: string; title?: string; filetype?: string; mode?: string;
  is_external?: boolean; external_url?: string; url_private?: string; url_private_download?: string; user?: string;
  created?: number; updated?: number; // unix seconds — original create / last-edit time
}

const CANVAS_FILETYPES = new Set(['quip', 'canvas']);

/** A file in the channel's Files & links tab is a canvas (vs an external link or an upload). */
export const isCanvasFile = (f: SlackFile): boolean =>
  (!!f.filetype && CANVAS_FILETYPES.has(f.filetype)) || f.mode === 'quip' || f.mode === 'canvas';

/**
 * Page a channel's file list ONCE — canvases and external/shared links both live here, so both migrators reuse
 * this rather than each re-listing (the list scales with the channel's file count). Uploads are ignored downstream.
 */
export async function listChannelFiles(client: WebClient, slackChannelId: string): Promise<SlackFile[]> {
  const files: SlackFile[] = [];
  try {
    let cursor: string | undefined;
    do {
      const r = await client.files.list({ channel: slackChannelId, limit: 200, cursor } as never);
      files.push(...((r.files ?? []) as SlackFile[]));
      cursor = (r.response_metadata as { next_cursor?: string })?.next_cursor || undefined;
    } while (cursor);
  } catch (e) {
    logger.warn('[ChannelFiles] files.list skipped (membership?)', { slackChannelId, error: e instanceof Error ? e.message : String(e) });
  }
  return files;
}
