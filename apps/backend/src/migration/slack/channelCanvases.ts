import fetch from 'node-fetch';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { AttachmentEntityType, CanvasRole, CanvasVisibility } from '@xyne/shared';
import { db } from '@/database/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { uploadFiles } from '@/services/fileUploadService';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { withServerEditor } from '@/utils/serverBlockNoteEditor';
import { initializeYSweetDoc } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { isCanvasFile, type SlackFile } from './channelFiles';
import type { MigrationTarget } from './migrationTarget';

export interface ChannelCanvas { slackFileId: string; title: string; slackUserId?: string; html: string; createdTs?: number; updatedTs?: number }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const attachmentRepo = new MessageAttachmentRepository();

/** files.info → { downloadUrl, name, mimetype } for a Slack file. */
async function slackFileInfo(token: string, fileId: string): Promise<{ url?: string; name?: string; mimetype?: string } | undefined> {
  try {
    const resp = await fetch('https://slack.com/api/files.info?file=' + fileId, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await resp.json()) as { ok?: boolean; file?: { url_private_download?: string; url_private?: string; name?: string; mimetype?: string } };
    if (!j.ok || !j.file) return undefined;
    return { url: j.file.url_private_download || j.file.url_private, name: j.file.name, mimetype: j.file.mimetype };
  } catch (e) {
    logger.warn('[ChannelCanvases] files.info failed', { fileId, error: msg(e) });
    return undefined;
  }
}

// Rehost Slack-hosted canvas images to Xyne storage so they actually render: the image block serves from props.url =
// attachment id. Public emoji/CDN URLs (slack-imgs.com) render as-is and are left alone.
const IMG_RE = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;
const SLACK_FILE_ID = /\/([FG][A-Z0-9]{6,})(?=[/?]|$)/;

// Slack's public emoji CDN — match on the parsed hostname, not a substring (a substring check is spoofable).
const isSlackEmojiCdn = (src: string): boolean => {
  try { const h = new URL(src).hostname.toLowerCase(); return h === 'slack-imgs.com' || h.endsWith('.slack-imgs.com'); }
  catch { return false; }
};

async function rehostCanvasImages(html: string, canvasId: string, createdBy: string, token: string | undefined, target: MigrationTarget): Promise<string> {
  if (!token) return html;
  let out = html;
  for (const m of [...html.matchAll(IMG_RE)]) {
    const src = m[2];
    if (!src || isSlackEmojiCdn(src)) continue; // public emoji CDN — already renders
    const fileId = (src.match(SLACK_FILE_ID) || [])[1];
    if (!fileId) continue;
    try {
      const info = await slackFileInfo(token, fileId);
      if (!info?.url) continue;
      const resp = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      const [up] = await uploadFiles([{ originalname: info.name || fileId, mimetype: info.mimetype || 'application/octet-stream', size: buffer.length, buffer } as Express.Multer.File]);
      if (!up) continue;
      const att = await attachmentRepo.create({
        entityId: canvasId, entityType: AttachmentEntityType.CANVAS, conversationId: `canvas_${canvasId}`,
        originalFilename: up.originalName, size: up.fileSize, mimetype: up.mimeType, url: up.fileUrl, thumbnailUrl: up.thumbnailUrl,
        width: up.width, height: up.height, uploadedByUserId: createdBy, createdBy, storageProvider: config.fileStorage.provider,
        workspaceId: target.workspaceId, metadata: { canvasId, type: 'canvas_attachment' },
      });
      out = out.replace(m[0], () => m[0].replace(src, att.id)); // src → attachment id (becomes the image block's props.url)
    } catch (e) {
      logger.warn('[ChannelCanvases] image rehost failed — leaving reference', { fileId, error: msg(e) });
    }
  }
  return out;
}

// Slack mentions arrive as <a>@Uxxx</a> and parse to plain "@Uxxx" text. Convert those to real Xyne mention inline
// content (which the canvas editor + Y-Sweet render), resolving the Slack id to the Xyne user.
const MENTION_RE = /@([UW][A-Z0-9]{6,})/g;

async function resolveMentions(blocks: BlockNoteBlock[], target: MigrationTarget): Promise<void> {
  const cache = new Map<string, { userId: string; username: string; userEmail: string } | null>();
  const lookup = async (slackId: string) => {
    if (!cache.has(slackId)) {
      const uid = await target.resolveUser(slackId);
      const u = uid ? await db.user.findUnique({ where: { id: uid }, select: { name: true, email: true } }) : null;
      cache.set(slackId, uid && u ? { userId: uid, username: u.name ?? '', userEmail: u.email ?? '' } : null);
    }
    return cache.get(slackId)!;
  };
  // Keep the source text node's styles on the pieces we split around a mention, else bold/italic/code/strike on the
  // surrounding text is lost (a bold line that contains a mention would otherwise come out plain).
  const mentionSplit = async (text: string, styles: unknown): Promise<unknown[]> => {
    const parts: unknown[] = [];
    let last = 0;
    for (const m of text.matchAll(MENTION_RE)) {
      const r = await lookup(m[1]);
      if (!r) continue;
      if (m.index! > last) parts.push({ type: 'text', text: text.slice(last, m.index), styles });
      parts.push({ type: 'mention', props: { userId: r.userId, username: r.username, userEmail: r.userEmail, groupId: '', groupName: '' } });
      last = m.index! + m[0].length;
    }
    if (!parts.length) return [{ type: 'text', text, styles }];
    if (last < text.length) parts.push({ type: 'text', text: text.slice(last), styles });
    return parts;
  };
  // Recurse over the whole tree. An inline-content array (holds text items) has its mentions expanded in place;
  // everything else is descended into — so mentions inside table cells (content is an object, not an array) resolve too.
  const walk = async (node: unknown): Promise<void> => {
    if (Array.isArray(node)) {
      if (node.some((it) => it && typeof it === 'object' && (it as { type?: string }).type === 'text')) {
        const next: unknown[] = [];
        for (const item of node as Array<{ type?: string; text?: string }>) {
          if (item?.type === 'text' && typeof item.text === 'string' && /@[UW][A-Z0-9]{6,}/.test(item.text)) {
            next.push(...(await mentionSplit(item.text, (item as { styles?: unknown }).styles ?? {})));
          } else { next.push(item); await walk(item); }
        }
        node.length = 0;
        node.push(...next);
      } else {
        for (const n of node) await walk(n);
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) await walk((node as Record<string, unknown>)[k]);
    }
  };
  await walk(blocks);
}

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
    out = out.replace(m[0], () => inner); // function replacer: insert literally (embedded HTML may contain $ patterns)
  }
  return out;
}

// Slack canvas code blocks are a run of <p class="…prettyprint…">line</p>; BlockNote reads each as a plain <p>, so the
// code block is lost (text stays, monospace/formatting doesn't). Merge each consecutive run into <pre><code> — which
// BlockNote parses as a real codeBlock — with the lines joined by newlines.
// Strip tags until stable — a single regex pass can leave a partial tag (e.g. "<<b>b>").
function stripTags(s: string): string {
  let prev: string;
  let out = s;
  do { prev = out; out = out.replace(/<[^>]+>/g, ''); } while (out !== prev);
  return out;
}
function convertCodeBlocks(html: string): string {
  return html.replace(/(?:<p\b[^>]*class=["'][^"']*prettyprint[^"']*["'][^>]*>[\s\S]*?<\/p>\s*)+/gi, (run) => {
    const lines = [...run.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]));
    return `<pre><code>${lines.join('\n')}</code></pre>`;
  });
}

// A BlockNote table cell is a single paragraph, so it flattens any multi-line cell (multiple <p>, a <ul>/<ol> list,
// <br>s) into one run WITH NO separator — fusing words across the boundary ("Flows</p><p>Adapter" → "FlowsAdapter",
// "columns</li><li>Emailer" → "columnsEmailer"). Insert a break at every block boundary inside a cell so words stay
// separate. (BlockNote renders the break as a space — true in-cell line breaks aren't supported — content stays intact.)
function separateCellLines(html: string): string {
  return html.replace(/<td\b[^>]*>[\s\S]*?<\/td>/gi, (cell) =>
    cell
      .replace(/<\/(p|li|div|h[1-6])\s*>/gi, '\n')       // end of a block-level line → break
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<(p|li|ul|ol|div|h[1-6])\b[^>]*>/gi, '') // drop block openers (inline tags — span/a/b/i/code — kept)
      .replace(/<\/(ul|ol)\s*>/gi, ''),
  );
}

// quip encodes ordered (numbered) lists as <ul> whose <li> carry a value= attribute — a plain bullet <ul> never does.
// BlockNote maps <ul> to a bullet list, dropping the numbering, so flip those (and their matching close) to <ol>.
// Stack-based so nested lists pair the right open/close (a bullet <ul> can contain an ordered one and vice-versa).
function orderifyLists(html: string): string {
  const re = /<(\/?)(ul|ol|li)\b([^>]*)>/gi;
  const stack: Array<{ tag: string; open: number; ordered: boolean }> = [];
  const flips: number[] = []; // string offsets of a 'ul' tag-name to rewrite to 'ol'
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'li') {
      const top = stack[stack.length - 1];
      if (!closing && top && top.tag === 'ul' && /\bvalue\s*=/.test(m[3])) top.ordered = true;
      continue;
    }
    if (!closing) {
      stack.push({ tag, open: m.index, ordered: false });
    } else {
      const frame = stack.pop();
      if (frame && frame.tag === 'ul' && frame.ordered) {
        flips.push(frame.open + 1, m.index + 2); // '<ul' → offset+1 ; '</ul' → offset+2
      }
    }
  }
  if (!flips.length) return html;
  const chars = html.split('');
  for (const at of flips) { chars[at] = 'o'; chars[at + 1] = 'l'; }
  return chars.join('');
}

// quip canvases use <lnk href="…">text</lnk> for links; BlockNote drops unknown tags' attributes, so rewrite to <a>
// to preserve the URL (otherwise only the link text survives — real data loss).
function normalizeCanvasHtml(html: string): string {
  return orderifyLists(separateCellLines(convertCodeBlocks(html)))
    .replace(
      /<lnk\b[^>]*\bhref=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/lnk>/gi,
      (_m, _q, href, text) => `<a href="${href}">${text}</a>`,
    )
    // Mentions arrive as <control><a>@Uxxx</a></control>; the anchor makes BlockNote parse them as a link, so
    // resolveMentions (text nodes only) misses them. Unwrap the bare-id anchor to text → it becomes a real mention.
    .replace(/<a\b[^>]*>\s*(@[UW][A-Z0-9]{6,})\s*<\/a>/gi, '$1');
}

/** All text in a BlockNote tree — used to detect if a parse dropped a lot of content. */
function blocksText(node: unknown): string {
  let out = '';
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (typeof o.text === 'string') out += o.text + ' ';
      for (const k of Object.keys(o)) if (k !== 'text') walk(o[k]);
    }
  };
  walk(node);
  return out.replace(/\s+/g, ' ').trim();
}
const htmlText = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** The channel's canvas files, HTML downloaded via the token and embedded canvases inlined. */
export async function fetchChannelCanvases(token: string, files: SlackFile[]): Promise<ChannelCanvas[]> {
  const canvases: ChannelCanvas[] = [];
  for (const f of files) {
    if (!isCanvasFile(f)) continue;
    let html = await fetchFileText(token, f.url_private_download || f.url_private);
    if (!html) { logger.warn('[ChannelCanvases] canvas body empty — skipping', { fileId: f.id }); continue; }
    try {
      html = await resolveEmbeds(token, html, new Set([f.id]));
    } catch (e) {
      logger.warn('[ChannelCanvases] embed resolve failed — using raw canvas', { fileId: f.id, error: msg(e) });
    }
    html = normalizeCanvasHtml(html);
    canvases.push({ slackFileId: f.id, title: f.title || f.name || 'Canvas', slackUserId: f.user, html, createdTs: f.created, updatedTs: f.updated });
  }
  return canvases;
}

/**
 * Idempotent: one Xyne canvas per Slack canvas per channel — skip if already migrated. Returns the number created.
 * `token` (channel bot token) lets us rehost canvas images to Xyne storage so they render.
 */
export async function ingestChannelCanvases(canvases: ChannelCanvas[], target: MigrationTarget, token?: string): Promise<number> {
  let created = 0;
  for (const cv of canvases) {
    const createdBy = (await target.resolveUser(cv.slackUserId)) ?? target.fallbackUserId;
    if (await createCanvas(cv, createdBy, target, token)) created += 1;
  }
  return created;
}

async function createCanvas(cv: ChannelCanvas, createdBy: string, target: MigrationTarget, token?: string): Promise<boolean> {
  const existing = await db.canvas.findFirst({
    where: { channelId: target.xyneChannelId, metadata: { path: ['slackFileId'], equals: cv.slackFileId } },
    select: { id: true },
  });
  if (existing) return false; // never clobber later edits

  const canvasId = createId();
  // Rehost images first (attachments are keyed to canvasId), then parse, then turn @Uxxx text into real mentions.
  const html = await rehostCanvasImages(cv.html, canvasId, createdBy, token, target);
  const blocks = (await withServerEditor((editor) => editor.tryParseHTMLToBlocks(html))) as BlockNoteBlock[];
  await resolveMentions(blocks, target);
  // Prisma rejects `undefined` inside JSON arrays (e.g. a table's columnWidths); a round-trip normalizes them to null.
  const content = JSON.parse(JSON.stringify(blocks)) as Prisma.InputJsonValue;
  // Flag if the parse dropped a lot of text (e.g. a future quip format we don't handle) — the raw HTML below is the fallback.
  const srcLen = htmlText(cv.html).length;
  const outLen = blocksText(blocks).length;
  if (srcLen > 200 && outLen < srcLen * 0.6) {
    logger.warn('[ChannelCanvases] possible content loss on parse', { slackFileId: cv.slackFileId, srcChars: srcLen, parsedChars: outLen });
  }
  const now = new Date();
  // Preserve the canvas's real Slack dates (files.info created / updated) so it isn't stamped with the migration time.
  const createdAt = cv.createdTs ? new Date(cv.createdTs * 1000) : now;
  const editedAt = cv.updatedTs ? new Date(cv.updatedTs * 1000) : createdAt;
  await db.canvas.create({
    data: {
      id: canvasId, workspaceId: target.workspaceId, title: cv.title,
      content,
      channelId: target.xyneChannelId, createdBy, visibility: CanvasVisibility.PUBLIC, isCollaborative: true,
      lastEditedBy: createdBy, lastEditedAt: editedAt, createdAt, updatedAt: editedAt,
      // Keep the source HTML so no canvas data is ever unrecoverable, even if the parser drops something.
      metadata: { source: 'slack_migration', slackFileId: cv.slackFileId, sourceHtml: cv.html },
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
