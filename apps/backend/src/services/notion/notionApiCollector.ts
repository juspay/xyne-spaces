/**
 * Notion API → staged export (the "collect" half of a Notion migration).
 *
 * Reads every page and database the token can see and writes them to a directory laid out exactly
 * like a Notion "Markdown & CSV" export, so notionCanvasImporter ingests API and zip sources the
 * same way:
 *
 *   Page <id>.md            page body as markdown
 *   Page <id>/              its sub-pages, databases and downloaded files
 *   DB <id>.csv             database rows
 *   DB <id>/Row <id>.md     each row's page
 *
 * Notion-hosted file URLs expire after an hour, so files are downloaded during collection.
 * Rate limit: ~3 requests/second per token — requests are spaced and 429s honour Retry-After.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from '@/utils/logger';

const API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';
const MIN_GAP_MS = 350;

type Json = any; // Notion's payloads are wide unions; this collector reads them defensively.

interface Item {
  id: string; // 32-hex, no dashes
  kind: 'page' | 'database';
  title: string;
  parentId: string | null; // page/database id it sits under (after resolving block parents)
  raw: Json;
}

export interface NotionUser {
  id: string;
  name: string;
  email?: string; // only for people, and only with the "read user emails" capability
}

/** One Notion comment, grouped into discussions (threads) by discussionId. */
export interface NotionComment {
  id: string;
  discussionId: string;
  authorId?: string;
  text: string; // user mentions as ⟦@u:<id>⟧ tokens (resolved to Spaces mentions at ingest)
  plainText: string; // as Notion displays it ("@Nasim Sheikh …") — matches comments imported before tokens
  createdTime: string;
  anchorText?: string; // text of the block it was made on (none = page-level comment)
}

/**
 * Something Notion didn't give us. `pageId` set = that page is incomplete (ingest won't overwrite an
 * existing canvas with it); unset = it affects the whole import (e.g. comments or users unavailable).
 */
export interface NotionCollectFailure {
  what: 'page' | 'database' | 'file' | 'comments' | 'users';
  title: string;
  reason: string;
  pageId?: string;
}

/** Who created each staged page (+ its comments) — ingest maps people to Spaces users by email. */
export interface NotionManifest {
  items: Array<{ id: string; kind: 'page' | 'database'; title: string; relPath: string; parentId: string | null; createdById?: string; lastEditedTime?: string; comments?: NotionComment[] }>;
  users: NotionUser[];
  failures?: NotionCollectFailure[];
}

export const NOTION_MANIFEST_FILE = 'notion-manifest.json';

/**
 * A Notion user mention, written into the staged markdown as `⟦@u:<userId>⟧` and turned into a
 * Spaces mention (or "@Name" text) at ingest. Plain ASCII-free brackets so markdown and table
 * syntax never touch it.
 */
export const userMentionToken = (notionUserId: string): string => `⟦@u:${notionUserId}⟧`;
export const USER_MENTION_TOKEN = /⟦@u:([0-9a-f]{32})⟧/g;

export interface NotionCollectResult {
  dir: string;
  pages: number;
  databases: number;
  files: number;
  warnings: string[];
  failures: NotionCollectFailure[];
  manifest: NotionManifest;
}

/** Where the collector gets its access token. A plain string never changes (integration tokens). */
export interface NotionTokenSource {
  /** The current access token — refreshed first if it's known to expire within a few minutes. */
  get(): Promise<string>;
  /** After a 401: get a new token (and keep the rotated refresh token), or throw if access is gone. */
  refresh(): Promise<string>;
}

/** Notion no longer accepts our token. Fatal: the whole collect stops rather than writing stub pages. */
export class NotionAuthError extends Error {
  constructor(detail = '') {
    super(`Notion stopped accepting our access (expired or revoked)${detail ? `: ${detail}` : ''}. Nothing was imported — start the import again.`);
    this.name = 'NotionAuthError';
  }
}

export class NotionApiCollector {
  private lastRequestAt = 0;
  /** Set on an unrecoverable 401; every later request fails fast and the collect stops. */
  private authError: NotionAuthError | null = null;
  private readonly blockParentCache = new Map<string, string | null>();
  private readonly warnings: string[] = [];
  private readonly failures: NotionCollectFailure[] = [];
  private files = 0;
  private commentsUnavailable = false;
  private readonly commentsByPage = new Map<string, NotionComment[]>();

  constructor(private readonly auth: string | NotionTokenSource) {}

  // -------------------------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------------------------
  private async request(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<Json> {
    if (this.authError) throw this.authError;
    let refreshed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = this.lastRequestAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      const res = await fetch(`${API}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${typeof this.auth === 'string' ? this.auth : await this.auth.get()}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        logger.warn(`[NotionCollect] ${res.status} on ${pathname}, retrying in ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 401) {
        // Refresh once and resend the same request; a second 401 (or no way to refresh) is fatal.
        if (refreshed || typeof this.auth === 'string') throw (this.authError = new NotionAuthError(`401 on ${pathname}`));
        refreshed = true;
        try {
          await this.auth.refresh();
        } catch (error) {
          throw (this.authError = error instanceof NotionAuthError ? error : new NotionAuthError(error instanceof Error ? error.message : String(error)));
        }
        logger.info('[NotionCollect] Access token refreshed after a 401, retrying');
        continue;
      }
      const json = (await res.json()) as Json;
      if (!res.ok) throw new Error(`Notion ${method} ${pathname} → ${res.status} ${json?.code ?? ''}: ${json?.message ?? ''}`);
      return json;
    }
    throw new Error(`Notion ${method} ${pathname}: gave up after retries`);
  }

  private async paginate(method: 'GET' | 'POST', pathname: string, body: Record<string, unknown> = {}): Promise<Json[]> {
    const out: Json[] = [];
    let cursor: string | undefined;
    do {
      const page = method === 'GET'
        ? await this.request('GET', `${pathname}${pathname.includes('?') ? '&' : '?'}page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
        : await this.request('POST', pathname, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  }

  /** Who the token belongs to (bot) — used to verify the token before a long run. */
  async whoAmI(): Promise<{ name: string; workspace?: string }> {
    const me = await this.request('GET', '/users/me');
    return { name: me.name ?? 'integration', workspace: me.bot?.workspace_name };
  }

  // -------------------------------------------------------------------------------------------
  // Collect
  // -------------------------------------------------------------------------------------------
  async collect(onProgress?: (msg: string) => void): Promise<NotionCollectResult> {
    const results = await this.paginate('POST', '/search', {});
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notion-api-'));
    const items = new Map<string, Item>();
    for (const r of results) {
      if (r.archived || r.in_trash) continue;
      const kind = r.object === 'database' ? 'database' : 'page';
      items.set(bare(r.id), { id: bare(r.id), kind, title: titleOf(r), parentId: null, raw: r });
    }
    for (const item of items.values()) item.parentId = await this.resolveParent(item.raw.parent, items);

    // Notion's own member directory ("System → People" in the page picker): one row per workspace
    // member, not content. Dropped with its rows even when the user ticks it.
    const skipped = new Set(
      [...items.values()].filter(i => i.kind === 'database' && i.parentId === null && isPeopleDirectory(i.raw)).map(i => i.id),
    );
    for (let grew = skipped.size > 0; grew; ) {
      grew = false;
      for (const item of items.values()) {
        if (item.parentId && skipped.has(item.parentId) && !skipped.has(item.id)) {
          skipped.add(item.id);
          grew = true;
        }
      }
    }
    for (const id of skipped) items.delete(id);
    if (skipped.size) onProgress?.(`Skipped Notion's People directory (${skipped.size - 1} member rows)`);
    onProgress?.(`Found ${[...items.values()].filter(i => i.kind === 'page').length} pages, ${[...items.values()].filter(i => i.kind === 'database').length} databases`);

    // Lay out paths: "<Title> <id>" nested under the parent's folder.
    const relBase = new Map<string, string>();
    const baseOf = (item: Item, seen = new Set<string>()): string => {
      const cached = relBase.get(item.id);
      if (cached) return cached;
      const self = `${safeName(item.title)} ${item.id}`;
      const parent = item.parentId ? items.get(item.parentId) : undefined;
      const value = parent && !seen.has(parent.id) ? path.join(baseOf(parent, seen.add(item.id)), self) : self;
      relBase.set(item.id, value);
      return value;
    };
    for (const item of items.values()) baseOf(item);
    const relFile = (id: string) => {
      const item = items.get(id);
      // baseOf, not relBase.get: pages adopted mid-run (sub-pages, rows search missed) have no path yet.
      return item ? `${baseOf(item)}.${item.kind === 'database' ? 'csv' : 'md'}` : undefined;
    };

    // Search is eventually consistent (new pages show up late) — so also follow the page tree:
    // sub-pages and databases found while rendering, and database rows, are adopted into the run.
    const queue = [...items.values()];
    const adopt = async (id: string, kind: 'page' | 'database', parentId: string, raw?: Json): Promise<string | undefined> => {
      if (items.has(id)) return relFile(id);
      let object = raw;
      if (!object) {
        try {
          object = await this.request('GET', kind === 'database' ? `/databases/${id}` : `/pages/${id}`);
        } catch {
          return undefined; // not shared with this token, or a linked view of a database elsewhere
        }
      }
      if (object.archived || object.in_trash) return undefined;
      // A link to a member's row in the skipped People directory doesn't bring it back.
      if (skipped.has(id) || skipped.has(bare(object.parent?.database_id ?? ''))) return undefined;
      const item: Item = { id, kind, title: titleOf(object), parentId, raw: object };
      items.set(id, item);
      queue.push(item);
      return relFile(id);
    };

    let done = 0;
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      const file = path.join(dir, relFile(item.id)!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        if (item.kind === 'database') {
          await fs.writeFile(file, await this.databaseCsv(item, row => adopt(bare(row.id), 'page', item.id, row)));
        } else {
          const ctx: RenderCtx = {
            pageId: item.id, dir, fileDir: path.dirname(file), assetDir: path.join(dir, relBase.get(item.id)!), items, relFile, blocks: [],
            adopt: (id, kind) => adopt(id, kind, item.id),
          };
          const body = await this.renderChildren(item.id, ctx, 0);
          await fs.writeFile(file, `# ${item.title}\n\n${body}`);
          await this.collectComments(item, ctx.blocks);
        }
      } catch (error) {
        this.failures.push({ what: item.kind, title: item.title, reason: errorText(error), pageId: item.id });
        await fs.writeFile(file, `# ${item.title}\n\n> ⚠️ This page could not be collected from Notion.\n`);
      }
      await this.stopIfAuthLost(dir);
      done++;
      onProgress?.(`Collected ${done}/${queue.length}: ${item.title}`);
    }

    const users = await this.listUsers();
    await this.stopIfAuthLost(dir);

    const manifest: NotionManifest = {
      items: [...items.values()].map(item => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        relPath: relFile(item.id)!,
        parentId: item.parentId,
        createdById: item.raw.created_by?.id ? bare(item.raw.created_by.id) : undefined,
        lastEditedTime: item.raw.last_edited_time,
        comments: this.commentsByPage.get(item.id),
      })),
      users,
      failures: this.failures,
    };
    await fs.writeFile(path.join(dir, NOTION_MANIFEST_FILE), JSON.stringify(manifest, null, 2));

    return {
      dir,
      pages: [...items.values()].filter(i => i.kind === 'page').length,
      databases: [...items.values()].filter(i => i.kind === 'database').length,
      files: this.files,
      warnings: this.warnings,
      failures: this.failures,
      manifest,
    };
  }

  /**
   * Unresolved comments on the page and on each of its blocks (needs the "Read comments"
   * capability — without it this is skipped with one warning). One request per block, so pages
   * cost about twice as many requests with comments on.
   */
  private async collectComments(page: Item, blocks: Array<{ id: string; text: string }>): Promise<void> {
    if (this.commentsUnavailable) return;
    const pageId = page.id;
    const out: NotionComment[] = [];
    for (const target of [{ id: pageId, text: '' }, ...blocks]) {
      let comments: Json[];
      try {
        comments = await this.paginate('GET', `/comments?block_id=${target.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\b403\b|restricted_resource|insufficient/i.test(message)) {
          this.commentsUnavailable = true;
          this.failures.push({ what: 'comments', title: 'All pages', reason: 'Comments were not imported: turn on "Read comments" for the Notion integration and run again.' });
          return;
        }
        this.failures.push({ what: 'comments', title: page.title, reason: message, pageId });
        continue;
      }
      for (const c of comments) {
        out.push({
          id: bare(c.id),
          discussionId: bare(c.discussion_id ?? c.id),
          authorId: c.created_by?.id ? bare(c.created_by.id) : undefined,
          text: (c.rich_text ?? []).map((t: Json) =>
            t.type === 'mention' && t.mention?.type === 'user' && t.mention.user?.id ? userMentionToken(bare(t.mention.user.id)) : t.plain_text ?? '').join(''),
          plainText: plain(c.rich_text ?? []),
          createdTime: c.created_time,
          anchorText: target.text || undefined,
        });
      }
    }
    if (out.length) this.commentsByPage.set(pageId, out);
  }

  /** Workspace people with emails (needs the "read user information including emails" capability). */
  /** Per-page errors are caught and noted, but a lost token must end the whole collect. */
  private async stopIfAuthLost(dir: string): Promise<void> {
    if (!this.authError) return;
    await fs.rm(dir, { recursive: true, force: true });
    throw this.authError;
  }

  private async listUsers(): Promise<NotionUser[]> {
    try {
      const users = await this.paginate('GET', '/users');
      return users
        .filter(u => u.type === 'person')
        .map(u => ({ id: bare(u.id), name: u.name ?? 'Unknown', email: u.person?.email?.toLowerCase() }));
    } catch (error) {
      this.failures.push({ what: 'users', title: 'Notion users', reason: `Owners won't be mapped: ${errorText(error)}` });
      return [];
    }
  }

  /** Page/database parent → the nearest page or database id we can see (walks up through blocks). */
  private async resolveParent(parent: Json, items: Map<string, Item>): Promise<string | null> {
    for (let hops = 0; parent && hops < 20; hops++) {
      if (parent.type === 'workspace') return null;
      const id = bare(parent.page_id ?? parent.database_id ?? parent.block_id ?? '');
      if (!id) return null;
      if (parent.type !== 'block_id') return items.has(id) ? id : null;
      if (this.blockParentCache.has(id)) return this.blockParentCache.get(id)!;
      try {
        const block = await this.request('GET', `/blocks/${id}`);
        parent = block.parent;
      } catch {
        this.blockParentCache.set(id, null);
        return null;
      }
    }
    return null;
  }

  private async databaseCsv(item: Item, adoptRow: (row: Json) => Promise<unknown>): Promise<string> {
    const rows = await this.paginate('POST', `/databases/${item.id}/query`, {});
    for (const row of rows) await adoptRow(row);
    const schema: Record<string, Json> = item.raw.properties ?? {};
    const titleKey = Object.keys(schema).find(k => schema[k].type === 'title') ?? 'Name';
    const columns = [titleKey, ...Object.keys(schema).filter(k => k !== titleKey)];
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows) lines.push(columns.map(c => csvCell(propertyText(row.properties?.[c]))).join(','));
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------------------------
  // Blocks → markdown
  // -------------------------------------------------------------------------------------------
  private async renderChildren(blockId: string, ctx: RenderCtx, depth: number): Promise<string> {
    const blocks = await this.paginate('GET', `/blocks/${blockId}/children`);
    const out: string[] = [];
    let numbered = 0;
    for (const block of blocks) {
      numbered = block.type === 'numbered_list_item' ? numbered + 1 : 0;
      out.push(await this.renderBlock(block, ctx, depth, numbered));
    }
    return out.filter(Boolean).join('');
  }

  private async childrenOf(block: Json, ctx: RenderCtx, depth: number): Promise<string> {
    return block.has_children ? this.renderChildren(bare(block.id), ctx, depth) : '';
  }

  private async renderBlock(block: Json, ctx: RenderCtx, depth: number, n: number): Promise<string> {
    const pad = '  '.repeat(depth);
    const v = block[block.type] ?? {};
    if (!['child_page', 'child_database', 'column_list', 'column'].includes(block.type)) {
      ctx.blocks.push({ id: bare(block.id), text: plain(v.rich_text ?? []).slice(0, 200) });
    }
    const text = () => richText(v.rich_text ?? []);
    const nested = async () => this.childrenOf(block, ctx, depth + 1);
    switch (block.type) {
      case 'paragraph': return `${pad}${text()}\n\n${await this.childrenOf(block, ctx, depth)}`;
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return `${'#'.repeat(Number(block.type.slice(-1)))} ${text()}\n\n${await this.childrenOf(block, ctx, depth)}`;
      case 'bulleted_list_item': return `${pad}- ${text()}\n${await nested()}`;
      case 'numbered_list_item': return `${pad}${n}. ${text()}\n${await nested()}`;
      case 'to_do': return `${pad}- [${v.checked ? 'x' : ' '}] ${text()}\n${await nested()}`;
      case 'toggle': return `**▸ ${text().trim()}**\n\n${(await this.childrenOf(block, ctx, 0)).trim()}\n\n`;
      case 'quote': return `> ${text().replace(/\n/g, '\n> ')}\n\n${await this.childrenOf(block, ctx, depth)}`;
      case 'callout': {
        const icon = v.icon?.emoji ?? '💡';
        const body = `${icon} ${text()}\n${await this.childrenOf(block, ctx, 0)}`;
        return `${body.trim().split('\n').map(line => `> ${line.trim()}`).join('\n')}\n\n`;
      }
      case 'code': return `\`\`\`${(v.language ?? '').replace('plain text', '')}\n${plain(v.rich_text)}\n\`\`\`\n\n`;
      case 'equation': return `$$\n${v.expression}\n$$\n\n`;
      case 'divider': return '---\n\n';
      case 'table': return this.renderTable(block);
      case 'column_list':
      case 'column':
        return this.childrenOf(block, ctx, depth);
      case 'synced_block': {
        const sourceId = v.synced_from?.block_id;
        if (!sourceId) return this.childrenOf(block, ctx, depth);
        try { return await this.renderChildren(bare(sourceId), ctx, depth); }
        catch { this.warnings.push(`Synced block source ${sourceId} is not shared with the integration`); return ''; }
      }
      case 'child_page':
      case 'child_database': {
        const id = bare(block.id);
        // Adopting queues a sub-page search missed; it's linked by id either way.
        const known = ctx.relFile(id) ?? await ctx.adopt(id, block.type === 'child_page' ? 'page' : 'database');
        const title = block.type === 'child_page' ? v.title : v.title || 'Database';
        if (!known && block.type === 'child_database') {
          // Linked database views point at a database elsewhere; if that one isn't shared we can't read it.
          this.warnings.push(`A database view ("${v.title || 'linked view'}") points to a database not shared with the integration`);
          return `> 🗂️ Notion database view${v.title ? ` "${v.title}"` : ''} — its source database wasn't shared with the import, so it wasn't migrated.\n\n`;
        }
        return `[${mdText(title)}](${notionRef(id)})\n\n`;
      }
      case 'link_to_page': {
        const id = bare(v.page_id ?? v.database_id ?? '');
        if (!id) return '';
        return `[${mdText(ctx.items.get(id)?.title ?? 'Linked page')}](${notionRef(id)})\n\n`;
      }
      case 'image':
      case 'file':
      case 'pdf':
      case 'video':
      case 'audio': {
        const caption = plain(v.caption ?? []);
        if (v.type === 'external') {
          const url = mdUrl(v.external.url);
          return block.type === 'image' ? `![${mdText(caption)}](${url})\n\n` : `[${mdText(caption || v.external.url)}](${url})\n\n`;
        }
        const local = await this.download(v.file?.url, v.name ?? caption, ctx);
        if (!local) return `> ⚠️ A ${block.type} could not be downloaded from Notion.\n\n`;
        const href = relHref(ctx.fileDir, local);
        const label = mdText(caption || path.basename(local));
        return block.type === 'image' ? `![${label}](${href})\n\n` : `[${label}](${href})\n\n`;
      }
      case 'bookmark':
      case 'embed':
      case 'link_preview':
        return v.url ? `[${mdText(plain(v.caption ?? []) || v.url)}](${mdUrl(v.url)})\n\n` : '';
      case 'table_of_contents':
      case 'breadcrumb':
        return '';
      default:
        this.warnings.push(`Unsupported block "${block.type}" skipped`);
        return '';
    }
  }

  private async renderTable(block: Json): Promise<string> {
    const rows = await this.paginate('GET', `/blocks/${bare(block.id)}/children`);
    const cells = rows.map(r => (r.table_row?.cells ?? []).map((c: Json[]) => richText(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
    if (cells.length === 0) return '';
    const width = Math.max(...cells.map((r: string[]) => r.length));
    const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    return [line(cells[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...cells.slice(1).map(line)].join('\n') + '\n\n';
  }

  private async download(url: string | undefined, name: string, ctx: RenderCtx): Promise<string | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fromUrl = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'file');
      const filename = safeName(name && path.extname(name) ? name : fromUrl);
      await fs.mkdir(ctx.assetDir, { recursive: true });
      let target = path.join(ctx.assetDir, filename);
      for (let i = 1; await fs.stat(target).then(() => true, () => false); i++) {
        target = path.join(ctx.assetDir, `${path.basename(filename, path.extname(filename))}-${i}${path.extname(filename)}`);
      }
      await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
      this.files++;
      return target;
    } catch (error) {
      this.failures.push({ what: 'file', title: name || url.split('?')[0].split('/').pop() || 'file', reason: errorText(error), pageId: ctx.pageId });
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
interface RenderCtx {
  pageId: string; // the page being rendered (failures are recorded against it)
  dir: string; // staging root
  fileDir: string; // directory of the .md being written (links are relative to it)
  assetDir: string; // where this page's downloaded files go
  items: Map<string, Item>;
  relFile: (id: string) => string | undefined;
  blocks: Array<{ id: string; text: string }>; // blocks visited on this page — comments are fetched per block
  adopt: (id: string, kind: 'page' | 'database') => Promise<string | undefined>; // pull in a sub-page search missed
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const bare = (id: string) => id.replace(/-/g, '');
const safeName = (s: string) => (s || 'Untitled').replace(/[/\\:*?"<>|\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
const relHref = (fromDir: string, toFile: string) => path.relative(fromDir, toFile).split(path.sep).map(seg => mdUrl(encodeURIComponent(seg))).join('/');
/** Notion text is text: escape what Markdown would read as links or formatting (a typed "[x](../..)" stays text). */
const mdText = (s: string) => s.replace(/[\\`*_~[\]<>]/g, '\\$&');
/** A link target the Markdown link syntax can't misread: no spaces or parentheses. */
const mdUrl = (u: string) => u.replace(/[\s()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
const plain = (rt: Json[]) => (rt ?? []).map((t: Json) => t.plain_text ?? '').join('');
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function titleOf(r: Json): string {
  if (r.object === 'database') return plain(r.title) || 'Untitled database';
  const props = r.properties ?? {};
  const titleProp = Object.values(props).find((p: Json) => p?.type === 'title') as Json;
  return plain(titleProp?.title ?? []) || 'Untitled';
}

/** Notion's built-in member directory: a top-level database titled "People" (System → People). */
function isPeopleDirectory(r: Json): boolean {
  return titleOf(r).trim().toLowerCase() === 'people';
}

function richText(rt: Json[]): string {
  return (rt ?? []).map((t: Json) => {
    let s: string = t.plain_text ?? '';
    if (!s) return '';
    if (t.type === 'mention') {
      const m = t.mention;
      const id = bare(m.page?.id ?? m.database?.id ?? '');
      if (id) return `[${mdText(s)}](${notionRef(id)})`;
      if (m.type === 'user' && m.user?.id) return userMentionToken(bare(m.user.id));
      return s; // @date and other mentions come through as their display text
    }
    const a = t.annotations ?? {};
    if (a.code) s = `\`${s}\``;
    else {
      const lead = s.match(/^\s*/)![0];
      const trail = s.match(/\s*$/)![0];
      let core = mdText(s.trim());
      if (core) {
        if (a.bold) core = `**${core}**`;
        if (a.italic) core = `*${core}*`;
        if (a.strikethrough) core = `~~${core}~~`;
      }
      s = lead + core + trail;
    }
    const href = notionPageHref(t.href ?? t.text?.link?.url);
    return href ? `[${s}](${href.startsWith(NOTION_REF_PREFIX) ? href : mdUrl(href)})` : s;
  }).join('');
}

/**
 * Every reference to a Notion page or database (mention, sub-page, "link to page", text link) is
 * written as `notion-page:<id>` and turned into an internal Spaces route at ingest — its canvas
 * when one exists, else a route that shows "not found". Never a link back to Notion.
 */
export const NOTION_REF_PREFIX = 'notion-page:';
const notionRef = (id: string) => `${NOTION_REF_PREFIX}${bare(id).toLowerCase()}`;

/** A text link to a Notion page ("/<id>", "https://www.notion.so/Title-<id>") is a page reference; other links stay. */
function notionPageHref(href: string | undefined): string | undefined {
  if (!href || !(/^\/[0-9a-f]{32}\b/i.test(href) || /^https?:\/\/([\w-]+\.)?notion\.(so|site)\//i.test(href))) return href;
  const id = href.split(/[?#]/)[0]!.match(/([0-9a-f]{32})$/i)?.[1];
  return id ? notionRef(id) : href; // a Notion URL with no page in it (e.g. the help centre) stays
}

function propertyText(p: Json): string {
  if (!p) return '';
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'number': return p.number == null ? '' : String(p.number);
    case 'select': return p.select?.name ?? '';
    case 'status': return p.status?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((o: Json) => o.name).join(', ');
    case 'date': return p.date ? [p.date.start, p.date.end].filter(Boolean).join(' → ') : '';
    case 'people': return (p.people ?? []).map((u: Json) => (u.id ? userMentionToken(bare(u.id)) : u.name ?? '')).join(', ');
    case 'checkbox': return p.checkbox ? 'Yes' : 'No';
    case 'url': return p.url ?? '';
    case 'email': return p.email ?? '';
    case 'phone_number': return p.phone_number ?? '';
    case 'formula': return String(p.formula?.[p.formula?.type] ?? '');
    case 'relation': return `${(p.relation ?? []).length} linked`;
    case 'rollup': return p.rollup?.type === 'array' ? `${(p.rollup.array ?? []).length} items` : String(p.rollup?.[p.rollup?.type] ?? '');
    case 'created_time': return p.created_time ?? '';
    case 'last_edited_time': return p.last_edited_time ?? '';
    case 'created_by': return p.created_by?.name ?? '';
    case 'last_edited_by': return p.last_edited_by?.name ?? '';
    case 'files': return (p.files ?? []).map((f: Json) => f.name).join(', ');
    case 'unique_id': return [p.unique_id?.prefix, p.unique_id?.number].filter(v => v != null).join('-');
    default: return '';
  }
}

