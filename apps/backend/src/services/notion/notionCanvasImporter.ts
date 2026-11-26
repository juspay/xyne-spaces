/**
 * Notion → Canvas writer (the "ingest" half of a Notion migration).
 *
 * Input is what notionApiCollector staged from the Notion API: pages laid out like a Notion
 * "Markdown & CSV" export, plus notion-manifest.json with each page's creator. Same pipeline as the Confluence importer: markdown → convertMarkdownToBlockNote →
 * canvas row + connect group + owners → Y-Sweet doc → Vespa feed.
 *
 * Access is decided per top-level page ("section"), by an import plan:
 *   - public:  🌐 canvases in the target channel, viewable by the workspace
 *   - private: 🔒 canvases in one user's Personal section, owned only by them (e.g. on Notion
 *              Enterprise, a member's private page the owner shared with the integration)
 *   - skip:    not imported
 * Sections missing from the plan are imported public.
 *
 * Owners: each page's Notion creator is mapped to a Spaces user by email (falls back to the importer
 * and is reported as unresolved).
 *
 * Re-runnable: each canvas is keyed by its Notion page id (metadata.notionImport.key), so a later
 * run updates the same canvas — and its latest review decision sets where it lives and who sees it.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Prisma } from '@prisma/client';
import { AttachmentEntityType, CanvasRole, CanvasVisibility, DocType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { newConnectId, resolveCanvasConnectId } from '@/database/connectGroup';
import { createCanvasWithConnectGroupTx } from '@/bypassAcl/transactions/connectGroupEntities';
import { convertMarkdownToBlockNote, getCanvasUrl } from '@/services/canvasService';
import { getStorageService } from '@/services/storage';
import { initializeYSweetDoc, syncToYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { vespaQueue } from '@/queues/vespaQueue';
import { enqueueCanvasPermissionRefresh } from '@/services/canvasPermissionSync';
import { fileSchema, SubApp } from '@/vespa/src/types';
import { config } from '@/config/env';
import { toJsonSafeValue } from '@/services/jsonSafe';
import mime from 'mime';
import { logger } from '@/utils/logger';
import { NOTION_MANIFEST_FILE, NOTION_REF_PREFIX, USER_MENTION_TOKEN, type NotionCollectFailure, type NotionComment, type NotionManifest } from './notionApiCollector';

const NOTION_ID = /\s([0-9a-f]{32})$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export interface NotionImportTarget {
  userId: string; // the person running the import
  workspaceId: string;
  isAdmin: boolean; // may re-place canvases they don't own (token import re-review)
  channelId: string | null; // where public sections go; only looked up when a section is public
  projectId: string | null;
}

export type SectionAccess = { mode: 'public' } | { mode: 'private'; ownerUserId: string } | { mode: 'skip' };

/** Access per top-level page, keyed by NotionSection.key. Missing sections are imported public. */
export interface NotionImportPlan {
  sections: Record<string, SectionAccess>;
  /**
   * A member importing everything they can access in Notion (OAuth). Every canvas is private and
   * access is rebuilt from who can see the page: one canvas per Notion page, owned by its Notion
   * creator (when they have a Spaces account), and each member whose import contains it is added.
   * A page an admin already made public stays public — the member is just added.
   */
  member?: { userId: string };
}

export interface SpacesUserRef {
  id: string;
  name: string;
  email: string;
  display: string; // how Spaces shows them (displayName → name → email) — comment mentions match on this
}

/** One top-level Notion page and everything under it — the unit an admin reviews. */
export interface NotionSection {
  key: string;
  title: string;
  pages: number;
  databases: number;
  notionOwner?: { name: string; email?: string };
  spacesOwner?: SpacesUserRef; // notionOwner resolved by email; undefined = no Spaces account
}

export interface NotionImportSummary {
  created: number;
  updated: number;
  joined: number;
  skipped: number;
  folders: number;
  attachments: number;
  comments: number; // Notion comments imported as canvas comments this run
  accessRemoved: string[]; // member re-import: canvases this person can no longer see in Notion, so lost access to
  warnings: string[];
  failed: Array<Omit<NotionCollectFailure, 'pageId'> & { kept?: boolean }>; // kept = existing canvas left as it was
  unresolvedUsers: Array<{ name: string; email?: string }>;
  canvases: Array<{
    title: string;
    url: string;
    status: 'created' | 'updated' | 'joined';
    access: 'public' | 'private';
    ownerEmail?: string;
    sharedWith?: string[]; // everyone who can open this canvas in Spaces right now (its participants)
  }>;
}

interface NotionNode {
  key: string; // Notion page id (or the relative path when an export has none)
  kind: 'page' | 'database';
  relPath: string;
  title: string;
  parentRelPath: string | null;
  sectionKey: string; // top-level ancestor's key
  sectionTitle: string;
  canvasId?: string;
  created?: boolean;
  joinedOnly?: boolean; // member import over a canvas that isn't theirs — leave it as it is
  rowOf?: string; // a database row: written into its database's canvas (this relPath), not a canvas of its own
}

interface Placement {
  access: 'public' | 'private';
  channelId: string | null;
  projectId: string | null;
  visibility: CanvasVisibility;
  ownerIds: string[]; // first one is the canvas creator
  editorIds: string[]; // also given access (member imports: the importer, when they didn't create the page)
  creatorKnown?: boolean; // ownerIds[0] is the page's Notion creator (not a fallback) — re-imports correct the owner
}

const db = DatabaseClient.getInstance();

/** The person running the import, and — only when a section goes public — the channel it goes to (default #general). */
export async function resolveNotionImportTarget(input: { userId: string; workspaceId: string; channelName?: string; needsChannel: boolean }): Promise<NotionImportTarget> {
  const user = await db.user.findFirst({ where: { id: input.userId, workspaceId: input.workspaceId }, select: { id: true, role: true } });
  if (!user) throw new Error('The importing user is not in this workspace');
  const target: NotionImportTarget = { userId: user.id, workspaceId: input.workspaceId, isAdmin: user.role === 'ADMIN', channelId: null, projectId: null };
  if (!input.needsChannel) return target;
  const channelName = input.channelName || 'general';
  // An open channel, or a private one the importer is in — never an archived one.
  const channel = await db.channel.findFirst({
    where: {
      name: channelName,
      workspaceId: input.workspaceId,
      isArchived: false,
      OR: [{ visibility: 'PUBLIC' }, { participants: { some: { userId: user.id } } }],
    },
    select: { id: true, projectId: true },
  });
  if (!channel?.projectId) throw new Error(`Channel #${channelName} not found, archived, or not one you're in`);
  return { ...target, channelId: channel.id, projectId: channel.projectId };
}

// ---------------------------------------------------------------------------------------------
// Review: the top-level pages an admin decides access for, with their owners mapped.
// ---------------------------------------------------------------------------------------------
/** What both the review step and the import read from a staged collect: the page tree, the manifest and the owners. */
async function loadStaged(root: string, workspaceId: string) {
  const manifest = await readManifest(root);
  // With a manifest, only the pages it lists are pages: a downloaded .md/.csv attachment is a file.
  const files = manifest ? manifest.items.map(i => path.join(root, i.relPath)) : await walk(root);
  return {
    nodes: buildTree(root, files),
    owners: await resolveOwners(manifest, workspaceId),
    createdBy: new Map(manifest?.items.map(i => [i.id, i.createdById]) ?? []),
    commentsByPage: new Map(manifest?.items.map(i => [i.id, i.comments ?? []]) ?? []),
    usersById: new Map(manifest?.users.map(u => [u.id, u]) ?? []),
    failures: manifest?.failures ?? [],
  };
}

export async function listNotionSections(root: string, workspaceId: string): Promise<NotionSection[]> {
  const { nodes, owners, createdBy, usersById } = await loadStaged(root, workspaceId);

  const sections = new Map<string, NotionSection>();
  for (const node of nodes) {
    if (node.rowOf) continue; // part of its database's canvas
    const section = sections.get(node.sectionKey) ?? { key: node.sectionKey, title: node.sectionTitle, pages: 0, databases: 0 };
    node.kind === 'database' ? section.databases++ : section.pages++;
    if (node.key === node.sectionKey) {
      const notionUser = usersById.get(createdBy.get(node.key) ?? '');
      if (notionUser) section.notionOwner = { name: notionUser.name, email: notionUser.email };
      section.spacesOwner = owners.get(createdBy.get(node.key) ?? '');
    }
    sections.set(node.sectionKey, section);
  }
  return [...sections.values()];
}

// ---------------------------------------------------------------------------------------------
// Page tree from file layout: "Page <id>.md" owns the folder "Page <id>/".
// ---------------------------------------------------------------------------------------------
function buildTree(root: string, files: string[]): NotionNode[] {
  const rel = files.map(f => path.relative(root, f));
  const mds = rel.filter(f => f.endsWith('.md'));
  // Notion writes "<db>.csv" (visible columns) and "<db>_all.csv" (all columns): keep one per db.
  const csvs = rel.filter(f => f.endsWith('.csv') && !f.endsWith('_all.csv'));
  const ownerOfFolder = new Map<string, string>();
  for (const f of [...mds, ...csvs]) ownerOfFolder.set(f.replace(/\.(md|csv)$/, ''), f);

  const nodes = new Map<string, NotionNode>();
  for (const f of [...mds, ...csvs]) {
    const base = path.basename(f).replace(/\.(md|csv)$/, '');
    const id = NOTION_ID.exec(base)?.[1];
    nodes.set(f, {
      key: id ?? f,
      kind: f.endsWith('.csv') ? 'database' : 'page',
      relPath: f,
      title: cleanTitle(base),
      parentRelPath: ownerOfFolder.get(path.dirname(f)) ?? null,
      sectionKey: '',
      sectionTitle: '',
    });
  }
  // Database rows live inside their database's canvas (table on top, each row's content below), so a
  // to-do list stays one page. A row's own sub-pages hang off the database instead.
  for (const node of nodes.values()) {
    const parent = node.parentRelPath ? nodes.get(node.parentRelPath) : undefined;
    if (node.kind === 'page' && parent?.kind === 'database') node.rowOf = parent.relPath;
  }
  for (const node of nodes.values()) {
    const parent = node.parentRelPath ? nodes.get(node.parentRelPath) : undefined;
    if (parent?.rowOf) node.parentRelPath = parent.rowOf;
  }
  for (const node of nodes.values()) {
    let top = node;
    while (top.parentRelPath && nodes.get(top.parentRelPath)) top = nodes.get(top.parentRelPath)!;
    node.sectionKey = top.key;
    node.sectionTitle = top.title;
  }
  return [...nodes.values()].sort((a, b) => a.relPath.split('/').length - b.relPath.split('/').length);
}

// ---------------------------------------------------------------------------------------------
// Import: pass 1 creates every canvas (so links can resolve), pass 2 writes content.
// ---------------------------------------------------------------------------------------------
export async function importNotionTree(root: string, target: NotionImportTarget, plan?: NotionImportPlan): Promise<NotionImportSummary> {
  const { nodes: allNodes, owners, createdBy, commentsByPage, usersById: notionUsers, failures } = await loadStaged(root, target.workspaceId);
  const summary: NotionImportSummary = {
    created: 0, updated: 0, joined: 0, skipped: 0, folders: 0, attachments: 0, comments: 0, accessRemoved: [], warnings: [],
    failed: failures.map(({ pageId: _page, ...f }) => f), unresolvedUsers: [], canvases: [],
  };
  const incomplete = new Set(failures.flatMap(f => (f.pageId ? [f.pageId] : [])));
  const kept = new Set<string>(); // Notion keys whose existing canvas was left untouched
  if (allNodes.length === 0) throw new Error('No pages found — nothing was shared with the integration.');

  // Report Notion creators with no Spaces account (they fall back to the importer as owner).
  const unresolved = new Map<string, { name: string; email?: string }>();
  const commentAuthors = [...commentsByPage.values()].flat().map(c => c.authorId);
  for (const id of new Set([...createdBy.values(), ...commentAuthors])) {
    if (id && !owners.has(id)) {
      const u = notionUsers.get(id);
      if (u) unresolved.set(id, { name: u.name, email: u.email });
    }
  }
  summary.unresolvedUsers = [...unresolved.values()];

  const accessOf = (sectionKey: string): SectionAccess =>
    plan?.sections[sectionKey] ?? (plan?.member ? { mode: 'private', ownerUserId: plan.member.userId } : { mode: 'public' });

  const nodes = allNodes.filter(n => {
    if (accessOf(n.sectionKey).mode !== 'skip') return true;
    summary.skipped++;
    return false;
  });
  const byPath = new Map(nodes.map(n => [n.relPath, n]));
  const canvasNodes = nodes.filter(n => !n.rowOf);
  // A row's comments are shown on its database's canvas.
  for (const row of nodes) {
    if (!row.rowOf) continue;
    const dbKey = byPath.get(row.rowOf)?.key;
    if (dbKey) commentsByPage.set(dbKey, (commentsByPage.get(dbKey) ?? []).concat(commentsByPage.get(row.key) ?? []));
  }

  const placementOf = (node: NotionNode): Placement => {
    const access = accessOf(node.sectionKey);
    const author = owners.get(createdBy.get(node.key) ?? '')?.id;
    if (plan?.member) {
      // Owned by its Notion creator; the importer can see it too (they found it in their Notion).
      const owner = author ?? plan.member.userId;
      return {
        access: 'private', channelId: null, projectId: null, visibility: CanvasVisibility.PRIVATE,
        ownerIds: [owner], editorIds: owner === plan.member.userId ? [] : [plan.member.userId], creatorKnown: Boolean(author),
      };
    }
    if (access.mode === 'private') {
      return { access: 'private', channelId: null, projectId: null, visibility: CanvasVisibility.PRIVATE, ownerIds: [access.ownerUserId], editorIds: [] };
    }
    if (!target.channelId) throw new Error('A public section needs a channel');
    return {
      access: 'public',
      channelId: target.channelId,
      projectId: target.projectId,
      visibility: CanvasVisibility.PUBLIC,
      ownerIds: uniqueIds([author ?? target.userId, target.userId]),
      editorIds: [],
    };
  };
  const accessList = async (canvasId: string): Promise<string[]> => {
    const ids = (await db.canvasParticipant.findMany({ where: { canvasId }, select: { userId: true } })).map(p => p.userId).filter((id): id is string => Boolean(id));
    return (await db.user.findMany({ where: { id: { in: ids } }, select: { email: true } })).map(u => u.email).sort();
  };

  const folderIds = new Map<string, string>();
  for (const node of canvasNodes) {
    const placement = placementOf(node);
    const folderName = `Notion · ${node.sectionTitle}`;
    const folderKey = `${placement.channelId ?? `personal:${placement.ownerIds[0]}`}:${folderName}`;
    if (!folderIds.has(folderKey)) folderIds.set(folderKey, await findOrCreateFolder(folderName, placement, target, summary));
    const result = await findOrCreateCanvas(node, folderIds.get(folderKey)!, placement, target, plan?.member?.userId);
    node.canvasId = result.id;
    node.created = result.created;
    node.joinedOnly = result.joinedOnly;
  }

  // Links to a row land on its database's canvas.
  for (const row of nodes) if (row.rowOf) row.canvasId = byPath.get(row.rowOf)?.canvasId;
  const resolveRef = notionRefResolver(nodes, target.workspaceId);

  for (const node of canvasNodes) {
    const canvasId = node.canvasId!;
    const placement = placementOf(node);
    const ownerEmail = owners.get(createdBy.get(node.key) ?? '')?.email;
    if (node.joinedOnly) {
      // The canvas isn't rewritten, but a person was just added — keep search access in step.
      await enqueueCanvasPermissionRefresh(canvasId).catch(err => summary.warnings.push(`Search access refresh failed for "${node.title}": ${String(err)}`));
      summary.joined++;
      summary.canvases.push({ title: node.title, url: getCanvasUrl(canvasId, target.workspaceId), status: 'joined', access: 'public', ownerEmail, sharedWith: await accessList(canvasId) });
      continue;
    }
    // Notion didn't give us all of this page (or one of a database's rows): never overwrite an existing
    // canvas with that — keep it as it was. A new canvas gets what we have, so links still land.
    const partial = incomplete.has(node.key) || nodes.some(row => row.rowOf === node.relPath && incomplete.has(row.key));
    if (partial && !node.created) {
      kept.add(node.key);
      for (const row of nodes) if (row.rowOf === node.relPath) kept.add(row.key);
      if (plan?.member) await markSeenBy(canvasId, plan.member.userId); // still visible to them in Notion
      summary.skipped++;
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(root, node.relPath), 'utf8');
      let markdown = node.kind === 'database'
        ? await databaseToMarkdown(raw, node, nodes, root, resolveRef, canvasId, target, summary)
        : await pageToMarkdown(raw, node, root, resolveRef, canvasId, target, summary);

      const parent = node.parentRelPath ? byPath.get(node.parentRelPath) : undefined;
      if (parent?.canvasId) {
        markdown = `↑ [${mdText(parent.title)}](${canvasPath(parent.canvasId, target.workspaceId)})\n\n${markdown}`;
      }

      const parsed = await convertMarkdownToBlockNote(markdown);
      resolveMentionTokens(parsed as unknown[], id => owners.get(id), id => notionUsers.get(id)?.name ?? 'Unknown');
      const blocks = toJsonSafeValue(parsed) as unknown as Prisma.InputJsonValue;
      const previous = (await db.canvas.findUnique({ where: { id: canvasId }, select: { metadata: true } }))?.metadata as
        { notionImport?: { commentThreads?: Record<string, string>; commentIds?: string[]; seenBy?: string[] } } | null;
      const seenBy = uniqueIds([...(previous?.notionImport?.seenBy ?? []), plan?.member?.userId]);
      const notionMeta = (comments: { commentThreads: Record<string, string>; commentIds: string[] }) => ({
        notionImport: { key: node.key, path: node.relPath, kind: node.kind, access: placement.access, checksum: sha(markdown), importedAt: new Date().toISOString(), seenBy, ...comments },
      });
      await db.canvas.update({
        where: { id: canvasId },
        data: {
          title: node.title,
          content: blocks,
          lastEditedBy: placement.ownerIds[0],
          lastEditedAt: new Date(),
          metadata: notionMeta({ commentThreads: previous?.notionImport?.commentThreads ?? {}, commentIds: previous?.notionImport?.commentIds ?? [] }),
        },
      });
      const commentState = await importComments({
        canvasId,
        blocks: blocks as unknown as BlockNoteBlock[],
        comments: commentsByPage.get(node.key) ?? [],
        threads: previous?.notionImport?.commentThreads ?? {},
        importedIds: new Set(previous?.notionImport?.commentIds ?? []),
        authorOf: id => owners.get(id ?? '')?.id,
        nameOf: id => notionUsers.get(id ?? '')?.name ?? 'Unknown',
        userOf: id => owners.get(id),
        fallbackUserId: placement.access === 'public' ? target.userId : placement.ownerIds[0],
        workspaceId: target.workspaceId,
        summary,
      });
      if (commentState) {
        await db.canvas.update({
          where: { id: canvasId },
          data: {
            content: blocks, // now carries the comment highlights (marked by importComments)
            metadata: notionMeta(commentState),
          },
        });
      }
      const ysweetOk = node.created
        ? await initializeYSweetDoc(canvasId, blocks as unknown as BlockNoteBlock[], placement.ownerIds[0])
        : await syncToYSweet(canvasId, blocks as unknown as BlockNoteBlock[], placement.ownerIds[0]);
      if (!ysweetOk) summary.warnings.push(`Y-Sweet sync failed for "${node.title}" (DB content is saved; the editor may show it empty)`);

      await vespaQueue
        .addJob({ schema: fileSchema, docId: canvasId, jobType: 'feed', userId: placement.ownerIds[0], app: SubApp.CANVAS })
        .catch(err => summary.warnings.push(`Vespa queue failed for "${node.title}": ${String(err)}`));

      node.created ? summary.created++ : summary.updated++;
      summary.canvases.push({
        title: node.title,
        url: getCanvasUrl(canvasId, target.workspaceId),
        status: node.created ? 'created' : 'updated',
        access: placement.access,
        ownerEmail,
        sharedWith: await accessList(canvasId),
      });
    } catch (error) {
      // One bad page must not stop the rest of the import.
      logger.error('[NotionImport] Failed to write canvas', error, { canvasId, title: node.title });
      summary.failed.push({ what: node.kind, title: node.title, reason: `Could not be written: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  // A member's import contains every page they can see in Notion. A page they saw before but not
  // now means they lost access in Notion (or it was deleted) — take their access away here too,
  // unless they created it.
  if (plan?.member) {
    const member = plan.member.userId;
    const seenNow = new Set(allNodes.map(n => n.key));
    const before = await db.canvas.findMany({
      where: { workspaceId: target.workspaceId, metadata: { path: ['notionImport', 'seenBy'], array_contains: [member] } },
      select: { id: true, title: true, createdBy: true, metadata: true },
    });
    for (const c of before) {
      const meta = (c.metadata ?? {}) as { notionImport?: { key?: string; seenBy?: string[] } };
      const key = meta.notionImport?.key;
      if (!key || seenNow.has(key) || c.createdBy === member) continue;
      await db.canvasParticipant.deleteMany({ where: { canvasId: c.id, userId: member } });
      await db.canvas.update({
        where: { id: c.id },
        data: { metadata: { ...meta, notionImport: { ...meta.notionImport, seenBy: (meta.notionImport?.seenBy ?? []).filter(u => u !== member) } } },
      });
      summary.accessRemoved.push(c.title);
      // Without this they'd lose the canvas but could still find it in search.
      await enqueueCanvasPermissionRefresh(c.id).catch(err => summary.warnings.push(`Search access refresh failed for "${c.title}": ${String(err)}`));
    }
  }
  failures.forEach((f, i) => { if (f.pageId && kept.has(f.pageId)) summary.failed[i]!.kept = true; });
  return summary;
}

/** Record that a member's Notion still shows this page (what a later re-import's access check reads). */
async function markSeenBy(canvasId: string, userId: string): Promise<void> {
  const meta = ((await db.canvas.findUnique({ where: { id: canvasId }, select: { metadata: true } }))?.metadata ?? {}) as
    { notionImport?: { seenBy?: string[] } & Record<string, unknown> } & Record<string, unknown>;
  const seenBy = uniqueIds([...(meta.notionImport?.seenBy ?? []), userId]);
  await db.canvas.update({ where: { id: canvasId }, data: { metadata: toJsonSafeValue({ ...meta, notionImport: { ...meta.notionImport, seenBy } }) as unknown as Prisma.InputJsonValue } });
}

// ---------------------------------------------------------------------------------------------
// Owners: Notion creator → Spaces user by email.
// ---------------------------------------------------------------------------------------------
async function readManifest(root: string): Promise<NotionManifest | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, NOTION_MANIFEST_FILE), 'utf8')) as NotionManifest;
  } catch {
    return null; // no manifest → everything is owned by the importer
  }
}

async function resolveOwners(manifest: NotionManifest | null, workspaceId: string): Promise<Map<string, SpacesUserRef>> {
  const byNotionId = new Map<string, SpacesUserRef>();
  const emails = [...new Set((manifest?.users ?? []).map(u => u.email).filter((e): e is string => Boolean(e)))];
  if (emails.length === 0) return byNotionId;
  const users = await db.user.findMany({
    where: { workspaceId, email: { in: emails, mode: 'insensitive' } },
    select: { id: true, name: true, email: true, displayName: true },
  });
  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  for (const nu of manifest?.users ?? []) {
    const match = nu.email ? byEmail.get(nu.email) : undefined;
    if (match) {
      byNotionId.set(nu.id, {
        id: match.id, name: match.name ?? match.email, email: match.email, display: match.displayName || match.name || match.email,
      });
    }
  }
  return byNotionId;
}

// ---------------------------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------------------------
async function pageToMarkdown(
  raw: string,
  node: NotionNode,
  root: string,
  resolveRef: (notionId: string) => Promise<string>,
  canvasId: string,
  target: NotionImportTarget,
  summary: NotionImportSummary,
): Promise<string> {
  let md = raw.replace(/^#\s+.*\n+/, ''); // leading "# Title" is the canvas title already
  const dir = path.dirname(node.relPath);
  const replacements: Array<[string, string]> = [];
  for (const m of md.matchAll(/(!?)\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/g)) {
    const [whole, bang, label, href] = m;
    // Notion page references → always an internal route.
    if (href.startsWith(NOTION_REF_PREFIX)) {
      replacements.push([whole, `[${label}](${await resolveRef(href.slice(NOTION_REF_PREFIX.length))})`]);
      continue;
    }
    if (/^(https?:|mailto:|#)/i.test(href)) continue;
    // Anything else relative is a file the collector downloaded next to the page — and only that:
    // never a path outside the staging folder, and never the manifest (it lists people's emails).
    const abs = path.resolve(root, dir, safeDecode(href));
    const inside = path.relative(path.resolve(root), abs);
    const staysInside = inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
    if (!staysInside || path.basename(abs) === NOTION_MANIFEST_FILE) {
      replacements.push([whole, label || path.basename(abs)]);
      summary.warnings.push(`"${node.title}": ignored a link that isn't a file from this page (${href})`);
      continue;
    }
    if (!(await exists(abs))) {
      replacements.push([whole, label || path.basename(abs)]);
      summary.warnings.push(`"${node.title}": could not resolve link ${href}`);
      continue;
    }
    const attachmentId = await uploadAttachment(abs, canvasId, target, summary);
    const isImage = bang === '!' || IMAGE_EXT.test(abs);
    replacements.push([whole, isImage
      ? `![${label || path.basename(abs)}](${attachmentId})`
      : `[${label || path.basename(abs)}](/api/attachments/${encodeURIComponent(attachmentId)}/download)`]);
  }
  for (const [from, to] of replacements) md = md.split(from).join(to);
  return md;
}

/**
 * Notion page id → Spaces route: its canvas from this import, else one imported earlier into this
 * workspace (looked up once per id), else the canvas route for an id that doesn't exist — "not
 * found", never a link out to Notion.
 */
function notionRefResolver(nodes: NotionNode[], workspaceId: string): (notionId: string) => Promise<string> {
  const inImport = new Map(nodes.filter(n => n.canvasId).map(n => [n.key, n.canvasId!]));
  const earlier = new Map<string, Promise<string | undefined>>();
  return async notionId => {
    let canvasId = inImport.get(notionId);
    if (!canvasId) {
      if (!earlier.has(notionId)) {
        earlier.set(notionId, db.canvas.findFirst({ where: { workspaceId, ...byNotionKey(notionId) }, select: { id: true } }).then(c => c?.id));
      }
      canvasId = await earlier.get(notionId);
    }
    return canvasPath(canvasId ?? `notion-${notionId}`, workspaceId);
  };
}

const byNotionKey = (key: string) => ({ metadata: { path: ['notionImport', 'key'], equals: key } });

/**
 * A database as one canvas: the table of rows (a static snapshot of its properties), then each
 * row's own content under a heading, so a to-do list reads as a single page.
 */
async function databaseToMarkdown(
  raw: string,
  node: NotionNode,
  nodes: NotionNode[],
  root: string,
  resolveRef: (notionId: string) => Promise<string>,
  canvasId: string,
  target: NotionImportTarget,
  summary: NotionImportSummary,
): Promise<string> {
  const rows = parseCsv(raw.replace(/^\uFEFF/, ''));
  if (rows.length === 0) return '_Empty database._';
  const [header, ...body] = rows;
  const cell = (v: string) => mdText(v.replace(/ \([^)]*[0-9a-f]{32}[^)]*\)/gi, '')).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const table = [
    `> 🗂️ Imported from a Notion database (${body.length} rows). Typed properties, views, relations and rollups are not supported in Canvas yet — this is a static snapshot.`,
    '',
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(r => `| ${header.map((_, i) => cell(r[i] ?? '')).join(' | ')} |`),
  ];

  // Rows in table order; any the table didn't list (title mismatch) follow at the end.
  const rowNodes = nodes.filter(n => n.rowOf === node.relPath);
  const order = new Map(body.map((r, i) => [r[0] ?? '', i]));
  rowNodes.sort((a, b) => (order.get(a.title) ?? Infinity) - (order.get(b.title) ?? Infinity));
  const sections: string[] = [];
  for (const row of rowNodes) {
    let rowRaw: string;
    try {
      rowRaw = await fs.readFile(path.join(root, row.relPath), 'utf8');
    } catch {
      continue;
    }
    const content = demoteHeadings((await pageToMarkdown(rowRaw, row, root, resolveRef, canvasId, target, summary)).trim());
    if (content) sections.push(`## ${mdText(row.title)}\n\n${content}`);
  }
  return [...table, ...(sections.length ? ['', '---', '', sections.join('\n\n')] : [])].join('\n');
}

/** A row's headings sit under its "## Title": shift them down one level (capped at ###), outside code fences. */
function demoteHeadings(md: string): string {
  let inFence = false;
  return md
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return line.replace(/^(#{1,6})(\s)/, (_m, hashes: string, space: string) => `${'#'.repeat(Math.min(hashes.length + 1, 3))}${space}`);
    })
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Comments: each Notion discussion → one canvas comment thread, anchored to the matching block.
// ---------------------------------------------------------------------------------------------
async function importComments(input: {
  canvasId: string;
  blocks: BlockNoteBlock[];
  comments: NotionComment[];
  threads: Record<string, string>; // Notion discussion id → canvas thread id (from earlier runs)
  importedIds: Set<string>; // Notion comment ids already imported
  authorOf: (notionUserId?: string) => string | undefined;
  nameOf: (notionUserId?: string) => string;
  userOf: (notionUserId: string) => SpacesUserRef | undefined;
  fallbackUserId: string;
  workspaceId: string;
  summary: NotionImportSummary;
}): Promise<{ commentThreads: Record<string, string>; commentIds: string[] } | null> {
  const flat = flattenBlocks(input.blocks);
  const anchorFor = (text?: string | null): string => {
    const probe = text?.trim().slice(0, 60);
    return (probe && flat.find(b => b.text.includes(probe))?.id) || flat[0]?.id || 'root';
  };

  // A re-run regenerates the canvas with new block ids — move earlier threads onto the new blocks.
  const earlierThreadIds = Object.values(input.threads);
  if (earlierThreadIds.length) {
    const earlier = await db.canvasCommentThread.findMany({ where: { id: { in: earlierThreadIds } }, select: { id: true, anchorText: true } });
    for (const th of earlier) {
      const blockId = anchorFor(th.anchorText);
      await db.canvasCommentThread.update({ where: { id: th.id }, data: { blockId } });
      markCommentedText(input.blocks, blockId, th.anchorText, th.id);
    }
  }

  // "@Spaces display name" + mentionedUserIds is how Spaces stores (and renders) a comment mention.
  const renderBody = (c: NotionComment, author?: string): { body: string; mentionedUserIds: string } => {
    const ids: string[] = [];
    const text = c.text.replace(USER_MENTION_TOKEN, (_m, notionId: string) => {
      const user = input.userOf(notionId);
      if (!user) return `@${input.nameOf(notionId)}`;
      ids.push(user.id);
      return `@${user.display}`;
    });
    return {
      body: author ? text : `${input.nameOf(c.authorId)} (from Notion): ${text}`,
      mentionedUserIds: JSON.stringify([...new Set(ids)]),
    };
  };

  // Comments imported by an earlier run (before mentions were mapped) get their mentions fixed in place.
  const earlierComments = input.comments.filter(c => input.importedIds.has(c.id) && c.text.includes('⟦@u:'));
  if (earlierComments.length && earlierThreadIds.length) {
    const stored = await db.canvasComment.findMany({ where: { threadId: { in: earlierThreadIds } }, select: { id: true, body: true, mentionedUserIds: true } });
    for (const c of earlierComments) {
      const author = input.authorOf(c.authorId);
      const legacy = author ? c.plainText : `${input.nameOf(c.authorId)} (from Notion): ${c.plainText}`;
      const row = stored.find(r => r.body === legacy);
      if (!row) continue;
      const next = renderBody(c, author);
      if (row.body !== next.body || row.mentionedUserIds !== next.mentionedUserIds) {
        await db.canvasComment.update({ where: { id: row.id }, data: next });
      }
    }
  }

  const fresh = input.comments.filter(c => !input.importedIds.has(c.id) && c.text.trim());
  if (fresh.length === 0) {
    return earlierThreadIds.length ? { commentThreads: input.threads, commentIds: [...input.importedIds] } : null;
  }
  const connectId = await resolveCanvasConnectId(db, input.canvasId);

  const threads = { ...input.threads };
  const byDiscussion = new Map<string, NotionComment[]>();
  for (const c of [...fresh].sort((a, b) => a.createdTime.localeCompare(b.createdTime))) {
    byDiscussion.set(c.discussionId, [...(byDiscussion.get(c.discussionId) ?? []), c]);
  }

  for (const [discussionId, comments] of byDiscussion) {
    let threadId = threads[discussionId];
    const isNewThread = !threadId || !(await db.canvasCommentThread.findUnique({ where: { id: threadId }, select: { id: true } }));
    const first = comments[0];
    if (isNewThread) {
      threadId = uuidv4();
      await db.canvasCommentThread.create({
        data: {
          id: threadId,
          workspaceId: input.workspaceId,
          canvasId: input.canvasId,
          blockId: anchorFor(first.anchorText),
          anchorText: first.anchorText?.slice(0, 200) ?? null,
          commentCount: 0,
          status: 'OPEN',
          createdBy: input.authorOf(first.authorId) ?? input.fallbackUserId,
          createdAt: new Date(first.createdTime),
          ...(connectId ? { canvasConnectId: connectId } : {}),
        },
      });
      threads[discussionId] = threadId;
      markCommentedText(input.blocks, anchorFor(first.anchorText), first.anchorText, threadId);
    }
    let initialId: string | null = null;
    for (const [i, c] of comments.entries()) {
      const author = input.authorOf(c.authorId);
      const id = uuidv4();
      await db.canvasComment.create({
        data: {
          id,
          workspaceId: input.workspaceId,
          threadId,
          canvasId: input.canvasId,
          // No Spaces account for the Notion author → posted by the importer, credited in the text.
          ...renderBody(c, author),
          isInitial: isNewThread && i === 0,
          createdBy: author ?? input.fallbackUserId,
          createdAt: new Date(c.createdTime),
          ...(connectId ? { canvasConnectId: connectId } : {}),
        },
      });
      if (isNewThread && i === 0) initialId = id;
      input.importedIds.add(c.id);
      input.summary.comments++;
    }
    await db.canvasCommentThread.update({
      where: { id: threadId },
      data: { commentCount: { increment: comments.length }, ...(initialId ? { initialCommentId: initialId } : {}) },
    });
  }
  return { commentThreads: threads, commentIds: [...input.importedIds] };
}

/**
 * Turn `⟦@u:<notionUserId>⟧` tokens (written by the collector for Notion user mentions and Person
 * properties) into Spaces mentions — or "@Name" text when the person has no Spaces account.
 * Mutates the BlockNote blocks in place: paragraph/heading/list content, table cells, children.
 */
function resolveMentionTokens(
  blocks: unknown[],
  userFor: (notionUserId: string) => SpacesUserRef | undefined,
  nameOf: (notionUserId: string) => string,
): void {
  type Inline = { type: string; text?: string; styles?: Record<string, unknown>; props?: Record<string, string>; content?: unknown };
  const expand = (items: Inline[]): Inline[] =>
    items.flatMap(item => {
      if (item.type !== 'text' || !item.text || !item.text.includes('⟦@u:')) return [item];
      const out: Inline[] = [];
      let last = 0;
      for (const m of item.text.matchAll(USER_MENTION_TOKEN)) {
        if (m.index! > last) out.push({ ...item, text: item.text.slice(last, m.index) });
        const user = userFor(m[1]);
        out.push(user
          ? { type: 'mention', props: { userId: user.id, username: user.name, userEmail: user.email, groupId: '', groupName: '' } }
          : { type: 'text', text: `@${nameOf(m[1])}`, styles: item.styles ?? {} });
        last = m.index! + m[0].length;
      }
      if (last < item.text.length) out.push({ ...item, text: item.text.slice(last) });
      return out;
    });
  const fixContent = (content: unknown): unknown => {
    if (Array.isArray(content)) return expand(content as Inline[]);
    const table = content as { type?: string; rows?: Array<{ cells: unknown[] }> } | null;
    if (table?.type === 'tableContent' && Array.isArray(table.rows)) {
      for (const row of table.rows) {
        row.cells = row.cells.map(cell => {
          if (Array.isArray(cell)) return expand(cell as Inline[]);
          const c = cell as { content?: unknown };
          if (c && Array.isArray(c.content)) c.content = expand(c.content as Inline[]);
          return cell;
        });
      }
    }
    return content;
  };
  for (const block of blocks as Array<{ content?: unknown; children?: unknown[] }>) {
    if (block.content !== undefined) block.content = fixContent(block.content);
    if (Array.isArray(block.children)) resolveMentionTokens(block.children, userFor, nameOf);
  }
}

/**
 * Put Spaces' comment highlight on the commented text: the `canvasCommentThread` style (rendered as
 * data-canvas-comment-thread-id) on exactly the anchor text when it sits inside one text run, else on
 * the block's text. Page-level comments (no anchor text) get no highlight, like in Notion.
 */
function markCommentedText(blocks: BlockNoteBlock[], blockId: string, anchorText: string | null | undefined, threadId: string): void {
  const anchor = anchorText?.trim();
  if (!anchor) return;
  type Inline = { type: string; text?: string; styles?: Record<string, unknown> };
  const find = (list: unknown[]): { content?: unknown; children?: unknown[] } | undefined => {
    for (const b of list as Array<{ id?: string; content?: unknown; children?: unknown[] }>) {
      if (b.id === blockId) return b;
      const inner = Array.isArray(b.children) ? find(b.children) : undefined;
      if (inner) return inner;
    }
    return undefined;
  };
  const block = find(blocks as unknown[]);
  if (!block || !Array.isArray(block.content)) return;
  const items = block.content as Inline[];
  const mark = (item: Inline): Inline => ({ ...item, styles: { ...(item.styles ?? {}), canvasCommentThread: threadId } });
  const idx = items.findIndex(i => i.type === 'text' && i.text?.includes(anchor));
  if (idx >= 0) {
    const item = items[idx];
    const at = item.text!.indexOf(anchor);
    const parts: Inline[] = [];
    if (at > 0) parts.push({ ...item, text: item.text!.slice(0, at) });
    parts.push(mark({ ...item, text: anchor }));
    if (at + anchor.length < item.text!.length) parts.push({ ...item, text: item.text!.slice(at + anchor.length) });
    items.splice(idx, 1, ...parts);
  } else {
    // Anchor spans several runs (e.g. around a mention) — highlight the block's text runs.
    block.content = items.map(i => (i.type === 'text' ? mark(i) : i));
  }
}

/** Every block (incl. nested) with its plain text, in document order. */
function flattenBlocks(blocks: BlockNoteBlock[]): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  const textOf = (content: unknown): string =>
    Array.isArray(content)
      ? content.map(c => (typeof c === 'object' && c !== null ? ((c as { text?: string }).text ?? textOf((c as { content?: unknown }).content)) : '')).join('')
      : '';
  const walkBlocks = (list: unknown[]): void => {
    for (const b of list as Array<{ id?: string; content?: unknown; children?: unknown[] }>) {
      if (b.id) out.push({ id: b.id, text: textOf(b.content) });
      if (Array.isArray(b.children)) walkBlocks(b.children);
    }
  };
  walkBlocks(blocks as unknown[]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Persistence — canvas + connect group (shared helper) + owner participants.
// ---------------------------------------------------------------------------------------------
async function findOrCreateFolder(name: string, p: Placement, t: NotionImportTarget, summary: NotionImportSummary): Promise<string> {
  const createdBy = p.ownerIds[0];
  // Private placement → a workspace-root folder (no channel, no project) = that user's Personal section.
  const where = { projectId: p.projectId, channelId: p.channelId, name, ...(p.access === 'private' ? { createdBy } : {}) };
  const existing = await db.canvasFolder.findFirst({ where, select: { id: true } });
  if (existing) return existing.id;
  const folder = await db.canvasFolder.create({
    data: { id: uuidv4(), projectId: p.projectId, channelId: p.channelId, name, createdBy, workspaceId: t.workspaceId },
    select: { id: true },
  });
  summary.folders++;
  return folder.id;
}

async function findOrCreateCanvas(
  node: NotionNode,
  folderId: string,
  p: Placement,
  t: NotionImportTarget,
  memberUserId?: string,
): Promise<{ id: string; created: boolean; joinedOnly?: boolean }> {
  const existing = await db.canvas.findFirst({
    where: { workspaceId: t.workspaceId, ...byNotionKey(node.key) },
    select: { id: true, visibility: true, createdBy: true },
  });

  if (existing && memberUserId) {
    // Same Notion page, another person who can see it: add them, and make sure its Notion creator
    // owns it — correcting canvases first created with whoever imported first as the owner.
    if (p.creatorKnown && existing.visibility === CanvasVisibility.PRIVATE && existing.createdBy !== p.ownerIds[0]) {
      await db.canvas.update({ where: { id: existing.id }, data: { createdBy: p.ownerIds[0], folderId } });
    }
    await ensureOwners(existing.id, p.ownerIds, t.workspaceId);
    await ensureOwners(existing.id, p.editorIds, t.workspaceId, CanvasRole.EDITOR);
    // An admin's public import stays exactly as the admin set it; a private one gets fresh content.
    return existing.visibility === CanvasVisibility.PUBLIC
      ? { id: existing.id, created: false, joinedOnly: true }
      : { id: existing.id, created: false };
  }

  if (existing) {
    // The latest review decides placement (e.g. promoting an earlier private copy to public).
    await db.canvas.update({
      where: { id: existing.id },
      data: { folderId, channelId: p.channelId, projectId: p.projectId, visibility: p.visibility },
    });
    await ensureOwners(existing.id, p.ownerIds, t.workspaceId);
    return { id: existing.id, created: false };
  }

  const canvasId = uuidv4();
  const connectId = newConnectId();
  const now = new Date();
  await createCanvasWithConnectGroupTx(
    {
      id: canvasId,
      title: node.title,
      content: [],
      createdBy: p.ownerIds[0],
      lastEditedBy: p.ownerIds[0],
      lastEditedAt: now,
      visibility: p.visibility,
      isTemplate: false,
      isCollaborative: true,
      docType: DocType.Canvas,
      workspaceId: t.workspaceId,
      connectId,
      projectId: p.projectId,
      channelId: p.channelId,
      folderId,
      metadata: { notionImport: { key: node.key, path: node.relPath, kind: node.kind, access: p.access } },
    },
    t.workspaceId,
    connectId,
  );
  await ensureOwners(canvasId, p.ownerIds, t.workspaceId);
  await ensureOwners(canvasId, p.editorIds, t.workspaceId, CanvasRole.EDITOR);
  return { id: canvasId, created: true };
}

async function ensureOwners(canvasId: string, userIds: string[], workspaceId: string, role: CanvasRole = CanvasRole.OWNER): Promise<void> {
  const connectId = await resolveCanvasConnectId(db, canvasId);
  await db.canvasParticipant.createMany({
    data: uniqueIds(userIds).map(userId => ({
      id: uuidv4(),
      canvasId,
      userId,
      role,
      joinedAt: new Date(),
      updatedAt: new Date(),
      workspaceId,
      ...(connectId ? { canvasConnectId: connectId } : {}),
    })),
    skipDuplicates: true,
  });
  if (role === CanvasRole.OWNER && userIds.length) {
    await db.canvasParticipant.updateMany({
      where: { canvasId, userId: { in: uniqueIds(userIds) }, role: { not: CanvasRole.OWNER } },
      data: { role: CanvasRole.OWNER },
    });
  }
}

async function uploadAttachment(absPath: string, canvasId: string, t: NotionImportTarget, summary: NotionImportSummary): Promise<string> {
  const filename = path.basename(absPath);
  const buffer = await fs.readFile(absPath);
  const contentHash = sha(buffer);
  // Dedup by content, not name — two different images can share a file name.
  const existing = await db.messageAttachment.findFirst({
    where: { entityId: canvasId, metadata: { path: ['contentHash'], equals: contentHash } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const contentType = mime.getType(filename) ?? 'application/octet-stream';
  const uploaded = await getStorageService().uploadFile(buffer, {
    filename,
    contentType,
    scopeType: 'CANVAS',
    scopeId: canvasId,
    metadata: { originalName: filename, uploadedAt: new Date().toISOString() },
  });
  const record = await db.messageAttachment.create({
    data: {
      entityId: canvasId,
      entityType: AttachmentEntityType.CANVAS,
      conversationId: `canvas_${canvasId}`,
      originalFilename: filename,
      size: uploaded.size,
      mimetype: contentType,
      url: uploaded.path,
      uploadedByUserId: t.userId,
      createdBy: t.userId,
      storageProvider: config.fileStorage.provider,
      workspaceId: t.workspaceId,
      metadata: { type: 'notion_canvas_attachment', contentHash },
    },
    select: { id: true },
  });
  summary.attachments++;
  return record.id;
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
function cleanTitle(base: string): string {
  return base.replace(NOTION_ID, '').trim() || 'Untitled';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** In-app path of a canvas — used for links inside canvas content so they open in place, on any host. */
const canvasPath = (canvasId: string, workspaceId: string): string => `/${encodeURIComponent(workspaceId)}/chat/canvas/${canvasId}`;
const uniqueIds = (ids: Array<string | undefined | null>): string[] => [...new Set(ids.filter((v): v is string => Boolean(v)))];
const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** Text in a Markdown label or heading: escape what would end or restyle it. */
const mdText = (s: string) => s.replace(/[\\`*_~[\]<>]/g, '\\$&');
