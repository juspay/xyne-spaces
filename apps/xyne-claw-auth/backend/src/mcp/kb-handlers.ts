/**
 * Local handlers for the Knowledge Base MCP tools (kb-list-resources,
 * kb-search, kb-list-files, kb-read-file). These run inline in claw-auth's
 * `/mcp/call` route — NOT in the spawned xyne-spaces MCP subprocess — because
 * they need:
 *
 *   1. The agent's AgentCollection allowlist (claw-auth Prisma DB).
 *   2. The calling user's live spaces auth context (claw-auth lib/spaces-db).
 *
 * Two-layer access check on every call:
 *   - Layer 1: requested resource must be in the agent's allowlist.
 *   - Layer 2: requesting user must still have spaces-side permission to
 *     read that resource (re-verified via /api/collections/accessible so a
 *     revoked permission stops working immediately, without redeploys).
 */

import type { Citation } from "xyne-claw-shared";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { fetchAccessibleKb, indexKbTree, type KbCollectionNode } from "../lib/spaces-kb.js";
import { spacesFetchBuffer, search as spacesVespaSearch } from "./servers/xyne-spaces-client.js";
import { getSpacesAuthForUser } from "../lib/spaces-db.js";
import { createLogger } from "../logger.js";
import { extractXlsxText, isXlsxFile } from "./kb-xlsx.js";

/**
 * Debug sidecar — the YQL spaces actually emitted to Vespa for this call.
 * Returned by /api/vespaSearch/claw when `includeDebugInfo=true`. We carry it
 * through `KbHandlerResult` to the MCP route so it can ride alongside the
 * tool's `content` as `data.debug` — the model never sees it, claw stashes it
 * via takeDebug() and attaches to the persisted ToolInvocation so it's
 * inspectable in turn debug data.
 */
export interface VespaDebugBlock {
  payloads?: Array<{
    stage: string;
    yql: string;
    vespaParams: Record<string, unknown>;
  }>;
}

const log = createLogger("kb-handlers");


export interface KbHandlerResult {
  content: string;
  citations?: Citation[];
  isError?: boolean;
  /**
   * Optional Vespa-query debug sidecar — populated by kb-search when spaces'
   * /api/vespaSearch/claw returns `data.debug` (always requested for kb-search,
   * always cheap: just YQL strings). Surfaced on the /mcp/call response as
   * `data.debug` so claw can stash it via takeDebug() onto the persisted
   * ToolInvocation. Never makes it into the model-visible `content`.
   */
  debug?: VespaDebugBlock;
}

interface KbResolution {
  /**
   * Scoping mode for this agent.
   *   "COLLECTIONS" — `grants` is the allowlist; both layers (allowlist +
   *                   live spaces access) gate every read.
   *   "USER"        — `grants` is empty by construction; the agent inherits
   *                   the calling user's full accessible KB. The
   *                   accessibility layer is the only gate (which is
   *                   exactly the security boundary spaces already
   *                   enforces between users).
   */
  scope: "COLLECTIONS" | "USER";
  /** AgentCollection rows on this agent (the allowlist). Empty when scope="USER". */
  grants: Array<{ collectionId: string; fileId: string | null }>;
  /** Tree of collections + files the calling user can access in spaces. */
  accessibleTree: KbCollectionNode[];
  /** Flat sets of accessible-by-the-user ids — used for layer-2 checks. */
  accessibleCollectionIds: Set<string>;
  accessibleFileIds: Set<string>;
  /**
   * Flat lookup of every accessible file, keyed by collectionItem.id (the
   * spaces-side canonical id used by the picker, grants, and downloads).
   * `vespaDocId` is the corresponding Vespa file-schema docId
   * (= collectionItem.fileId) — present so we can build Vespa-side `fileId`
   * filters in single-file-grant mode.
   *
   * `projectId` / `channelId` / `rootCollectionId` are carried from the file's
   * root collection — the v2 KB file-viewer route requires all four
   * (`/knowledge-base/<projectId>/<channelId>/<rootCollectionId>/<folderId>/<fileId>`)
   * to deep-link straight into the open file. `folderId` is the immediate
   * parent collection's id when the file lives in a sub-folder, else '_'
   * (the route's root-folder sentinel — see dashboard/searchNavigation.ts).
   */
  filesById: Map<string, {
    name: string;
    /**
     * Slash-separated path from the ROOT collection down to and including the
     * file name (e.g. `services/release-deploy/service.md`). Files sitting
     * directly in the root have a path equal to their name.
     *
     * Rendered by kb-list-files and kb-search: a convention-based KB layout
     * produces dozens of identically-named files (`service.md`, `people.md`,
     * `00-index.md`) and `name` alone makes them indistinguishable in tool
     * output — the model can't tell which area a hit belongs to.
     */
    path: string;
    /**
     * Immediate parent collection's name. `collectionName` is deliberately the
     * ROOT collection's name (citations want the top-level label), so this is
     * the only place the containing folder's name survives.
     */
    folderName: string;
    collectionId: string;
    collectionName: string;
    vespaDocId: string;
    projectId?: string;
    channelId?: string;
    rootCollectionId?: string;
    folderId: string;
  }>;
  /**
   * Flat lookup of every accessible collection: id → { name, root id, parent id }.
   *
   * `parentId` is the IMMEDIATE parent (null at a root) and is taken from the
   * tree walk, not the payload's own `parentId` field, so it can't disagree
   * with the structure we actually traversed. The grant checks below follow
   * this chain link by link — see `ancestorChain`.
   */
  collectionsById: Map<string, { name: string; rootCollectionId: string; parentId: string | null }>;
  /**
   * Every accessible collection node — roots AND sub-folders — keyed by id,
   * with `children`/`items` intact.
   *
   * kb-list-files walks this to render the folder tree. The flat `filesById`
   * map can't express nesting: its `collectionId` is the file's IMMEDIATE
   * parent, so an exact-match filter on a root collection id returns nothing
   * for any KB that keeps its content in sub-folders, and no tool ever emitted
   * the sub-folder ids the model would need to drill in. That dead end is what
   * this map exists to close.
   */
  nodesById: Map<string, KbCollectionNode>;
  /**
   * Translation map for Vespa hits: Vespa's `docId` on the file schema is
   * `collectionItem.fileId` (see backend/src/zero/vespa-injection/core/mapper.ts),
   * but everywhere else in this service — accessibleFileIds, filesById, grants,
   * the spaces download endpoint (/api/collections/items/:itemId/download), and
   * the picker — uses `collectionItem.id`. This map lets kb-search translate
   * Vespa results back into the canonical id before access checks and citations.
   */
  vespaDocIdToItemId: Map<string, string>;
  /**
   * Calling user's active spaces workspaceId. Needed because the dashboard
   * mounts every route under `/:workspaceId/...` (see AppRoot.tsx) — the v2
   * file-viewer URL is `/<workspaceId>/knowledge-base/<projectId>/<channelId>/
   * <collectionId>/<folderId>/<fileId>`. Without this prefix, citation links
   * 404 on the React Router catch-all.
   */
  workspaceId?: string;
}

async function resolveKbContext(
  userId: string,
  agentSlug: string,
): Promise<KbResolution | { error: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (!user?.orgId) return { error: `User has no orgId: ${userId}` };
  const agent = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: user.orgId, slug: agentSlug } },
    include: { collections: true },
  });
  if (!agent) return { error: `Agent not found: ${agentSlug}` };
  const scope: "COLLECTIONS" | "USER" = agent.kbScope === "USER" ? "USER" : "COLLECTIONS";
  if (scope === "COLLECTIONS" && agent.collections.length === 0) {
    return { error: "This agent has no Knowledge Base grants configured." };
  }

  const tree = await fetchAccessibleKb(userId, { includeItems: true });
  if (tree === null) {
    return { error: "Spaces session unavailable — cannot verify Knowledge Base access." };
  }

  const { collections, files } = indexKbTree(tree);

  // Build flat lookups for nice citations and file→collection backlinks.
  const filesById = new Map<string, {
    name: string;
    path: string;
    folderName: string;
    collectionId: string;
    collectionName: string;
    vespaDocId: string;
    projectId?: string;
    channelId?: string;
    rootCollectionId?: string;
    folderId: string;
  }>();
  const collectionsById = new Map<string, { name: string; rootCollectionId: string; parentId: string | null }>();
  const nodesById = new Map<string, KbCollectionNode>();
  const vespaDocIdToItemId = new Map<string, string>();
  const walk = (
    n: KbCollectionNode,
    rootName: string,
    rootId: string,
    rootProjectId: string | undefined,
    rootChannelId: string | undefined,
    // Slash-terminated path from the root collection down to `n`, EXCLUDING the
    // root's own name ("" at the root, "services/release-deploy/" three levels in).
    pathPrefix: string,
    // Immediate parent's id — null at a root. Taken from the traversal rather
    // than `n.parentId` so it always agrees with the tree we actually walked.
    parentId: string | null,
  ): void => {
    collectionsById.set(n.id, { name: n.name, rootCollectionId: rootId, parentId });
    nodesById.set(n.id, n);
    // Files directly in the ROOT collection use the '_' sentinel for folder
    // (matches the v2 KB route convention — see dashboard/searchNavigation.ts).
    // Files in any sub-folder use that sub-folder's id as folderId.
    const folderForChildren = n.id === rootId ? "_" : n.id;
    for (const f of n.items ?? []) {
      filesById.set(f.id, {
        name: f.name,
        path: `${pathPrefix}${f.name}`,
        folderName: n.name,
        collectionId: n.id,
        collectionName: rootName,
        vespaDocId: f.fileId,
        ...(rootProjectId ? { projectId: rootProjectId } : {}),
        ...(rootChannelId ? { channelId: rootChannelId } : {}),
        rootCollectionId: rootId,
        folderId: folderForChildren,
      });
      if (f.fileId) vespaDocIdToItemId.set(f.fileId, f.id);
    }
    for (const c of n.children ?? []) {
      walk(c, rootName, rootId, rootProjectId, rootChannelId, `${pathPrefix}${c.name}/`, n.id);
    }
  };
  for (const root of tree) {
    // Channel-scoped collections store the channelId in `scopeId` when
    // scopeType='CHANNEL'. Other scope types (e.g. WORKSPACE) don't have a
    // channel — the file viewer route still needs a placeholder so we treat
    // it as undefined and downstream link builders fall back gracefully.
    const channelId = root.scopeType === "CHANNEL" ? root.scopeId : undefined;
    walk(root, root.name, root.id, root.projectId, channelId, "", null);
  }

  // Best-effort fetch of the user's workspaceId for citation deep-links. We
  // don't fail the resolution if it's missing — link builders just fall back
  // to a workspace-less URL (which 404s today, but at least the rest of the
  // handler still works).
  const authForLinks = await getSpacesAuthForUser(userId, "agent-chat");
  const workspaceId = authForLinks?.workspaceId;

  return {
    scope,
    // In USER mode the stored grants are intentionally IGNORED — they're
    // retained in the DB by agents.ts (so flipping back to COLLECTIONS
    // restores the picker's previous selection) but dropped from the
    // runtime context. The accessibility layer is the only gate in USER mode.
    grants: scope === "USER" ? [] : agent.collections.map((c: { collectionId: string; fileId: string | null }) => ({ collectionId: c.collectionId, fileId: c.fileId })),
    accessibleTree: tree,
    accessibleCollectionIds: collections,
    accessibleFileIds: files,
    filesById,
    collectionsById,
    nodesById,
    vespaDocIdToItemId,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/**
 * Every collection id from `startId` up to its root, INCLUDING `startId`.
 *
 * Follows the parent chain one link at a time. The previous implementation
 * hopped straight from a collection to its `rootCollectionId`, skipping every
 * level in between — so a grant on an intermediate folder (`services/`) never
 * matched a file nested deeper (`services/release-deploy/service.md`), and the
 * grant silently read as empty even though the KB picker had accepted it.
 *
 * `seen` guards against a cycle in the payload: a malformed parent chain would
 * otherwise spin this loop forever and hang the request.
 */
function* ancestorChain(ctx: KbResolution, startId: string): Generator<string> {
  const seen = new Set<string>();
  let cursor: string | null = startId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    yield cursor;
    cursor = ctx.collectionsById.get(cursor)?.parentId ?? null;
  }
}

/** Does any whole-collection grant sit on `collectionId` or one of its ancestors? */
function grantedViaAncestor(ctx: KbResolution, collectionId: string): boolean {
  for (const id of ancestorChain(ctx, collectionId)) {
    if (ctx.grants.some(g => g.fileId === null && g.collectionId === id)) return true;
  }
  return false;
}

/** Is `fileId` covered by the agent's grants AND still accessible to the user? */
function fileAllowed(ctx: KbResolution, fileId: string): boolean {
  if (!ctx.accessibleFileIds.has(fileId)) return false;
  // USER scope: any file the calling user can see in spaces is allowed.
  // No allowlist intersection — the agent inherits the user's reach.
  if (ctx.scope === "USER") return true;
  const file = ctx.filesById.get(fileId);
  if (!file) return false;
  // Single-file grant on exactly this file.
  for (const g of ctx.grants) {
    if (g.fileId === fileId) return true;
  }
  // Whole-collection grant anywhere from the file's own folder up to the root.
  return grantedViaAncestor(ctx, file.collectionId);
}

/** Is `collectionId` covered by the agent's grants? */
function collectionAllowed(ctx: KbResolution, collectionId: string): boolean {
  if (!ctx.accessibleCollectionIds.has(collectionId)) return false;
  // USER scope: every collection the user can see in spaces is allowed.
  if (ctx.scope === "USER") return true;
  // Whole-collection grant on this id OR an ancestor.
  if (grantedViaAncestor(ctx, collectionId)) return true;
  // Or a single-file grant on a file somewhere BELOW this collection — the
  // folders between the root and a granted file have to be listable or the
  // grant is unreachable by navigation (kb-search would be the only way in).
  // Listing one of these folders is not a leak: every row it renders is itself
  // re-checked, so only the granted file and the folders on its path appear.
  for (const g of ctx.grants) {
    if (!g.fileId) continue;
    const f = ctx.filesById.get(g.fileId);
    if (!f) continue;
    for (const id of ancestorChain(ctx, f.collectionId)) {
      if (id === collectionId) return true;
    }
  }
  return false;
}

/**
 * Build a deep-link to the v2 KB file viewer for a single item. The dashboard
 * mounts every route under `/:workspaceId/...` (see AppRoot.tsx:774), so the
 * full path is:
 *   /<workspaceId>/knowledge-base/<projectId>/<channelId>/<rootCollectionId>/<folderId>/<fileId>
 * `folderId` is '_' when the file lives directly in the root collection.
 *
 * Returns a RELATIVE path (no scheme/host). Other citation kinds (thread,
 * canvas, ticket — see dashboard/.../clawCitationUrl.ts) do the same so
 * react-router's <Link to={url}> navigates client-side within the dashboard
 * origin. Prefixing with CONFIG.spacesAppUrl would point at the backend host
 * and 404 with the standard Express not-found JSON.
 *
 * Returns "" when the user has no active spaces session (no workspaceId) OR
 * we don't have enough tree metadata to build the full path (channel-scoped
 * collections that predate scopeType tracking, workspace-scoped collections,
 * etc.). The caller (fileCitation) just omits the `url` field in that case
 * so the chip still renders without navigation.
 */
function deepLinkForFile(
  ctx: KbResolution,
  itemId: string,
  collectionId: string,
  pageNumber?: number,
  chunkIndex?: number,
): string {
  const meta = ctx.filesById.get(itemId);
  // Need workspaceId + projectId + channelId + rootCollectionId to land on the
  // file viewer route; without any of them the link would 404.
  if (!ctx.workspaceId) return "";
  if (!meta?.projectId || !meta.channelId || !meta.rootCollectionId) return "";
  // `?page=<N>` is read by FileViewerLayout and forwarded as PdfViewer's 1-based
  // `initialPage`; `?chunkIndex=<K>` (0-based) lets FileViewerPanel fetch the
  // cited chunk's snippet and highlight it via pdf.js find. Query params don't
  // affect route matching, so the chip still resolves when metadata is absent.
  const params = new URLSearchParams();
  if (typeof pageNumber === "number" && pageNumber >= 1) {
    params.set("page", String(pageNumber));
  }
  if (typeof chunkIndex === "number" && chunkIndex >= 0) {
    params.set("chunkIndex", String(chunkIndex));
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  return (
    `/` +
    `${encodeURIComponent(ctx.workspaceId)}/` +
    `knowledge-base/` +
    `${encodeURIComponent(meta.projectId)}/` +
    `${encodeURIComponent(meta.channelId)}/` +
    `${encodeURIComponent(meta.rootCollectionId)}/` +
    `${encodeURIComponent(meta.folderId)}/` +
    `${encodeURIComponent(itemId)}` +
    query
  );
}

function fileCitation(
  ctx: KbResolution,
  itemId: string,
  fileName: string,
  collectionId: string,
  chunkIndex?: number,
  pageNumber?: number,
): Citation {
  const url = deepLinkForFile(ctx, itemId, collectionId, pageNumber, chunkIndex);
  return {
    kind: "collection-item",
    collectionItemId: itemId,
    collectionId,
    fileName,
    label: fileName,
    ...(url ? { url } : {}),
    ...(typeof chunkIndex === "number" ? { chunkIndex } : {}),
    ...(typeof pageNumber === "number" ? { pageNumber } : {}),
  };
}

// ── kb-list-resources ────────────────────────────────────────────────────────

export async function handleKbListResources(args: { userId: string; agentSlug: string }): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  // USER scope: there is no allowlist — list the user's ROOT collections so
  // the LLM has a tractable inventory to drill into via kb-list-files /
  // kb-search. Flattening every file across every collection would blow up
  // the context for users with sizeable KBs.
  if (ctx.scope === "USER") {
    const rootRows = ctx.accessibleTree.map((root) => ({
      id: root.id,
      name: root.name,
      fileCount: countAccessibleFilesInTree(root),
      // Surfaced so the model knows a collection whose files all live in
      // sub-folders still has something to drill into.
      folderCount: (root.children ?? []).length,
    }));
    if (rootRows.length === 0) {
      return { content: "You currently have no accessible collections in spaces — nothing for this agent to read." };
    }
    // Same XML shape as kb-get-chunks. No cite tokens here: the Citation type
    // has no "collection" kind, only "collection-item" — the LLM should call
    // kb-list-files / kb-search to drill in and pick up file-level chips.
    const lines: string[] = [];
    lines.push(`<resources scope="USER" count="${rootRows.length}">`);
    for (const r of rootRows) {
      lines.push(
        `  <collection id="${escapeXmlAttr(r.id)}" name="${escapeXmlAttr(r.name)}" ` +
          `file_count="${r.fileCount}" folder_count="${r.folderCount}" />`,
      );
    }
    lines.push(`</resources>`);
    lines.push(
      `\nThis agent is user-scoped: it can read anything you can read in spaces. ` +
        `Use \`kb-list-files\` to enumerate a collection (it lists sub-folders too — pass ` +
        `\`depth\` to expand them) or \`kb-search\` to find a file by name. ` +
        `\`file_count\` is recursive, so a collection with 0 folders shown at the top level ` +
        `may still hold everything one level down.`,
    );
    return { content: lines.join("\n") };
  }

  type Row = { kind: "collection" | "file"; id: string; name: string; collectionId?: string; collectionName?: string };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const g of ctx.grants) {
    if (g.fileId) {
      const f = ctx.filesById.get(g.fileId);
      if (!f) continue;
      const key = `f:${g.fileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ kind: "file", id: g.fileId, name: f.name, collectionId: f.collectionId, collectionName: f.collectionName });
    } else {
      const c = ctx.collectionsById.get(g.collectionId);
      if (!c) continue;
      const key = `c:${g.collectionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ kind: "collection", id: g.collectionId, name: c.name });
    }
  }
  if (rows.length === 0) return { content: "This agent has no Knowledge Base resources you can currently access." };

  const lines: string[] = [];
  lines.push(`<resources scope="COLLECTIONS" count="${rows.length}">`);
  const citations: Citation[] = [];
  let fileChunkIndex = 0;
  for (const r of rows) {
    if (r.kind === "collection") {
      // No cite token — Citation type has no "collection" kind. The LLM can
      // still reference the collection by id when calling kb-list-files.
      // Counts are recursive/immediate respectively so a granted collection
      // whose content all sits in sub-folders doesn't look empty here.
      const node = ctx.nodesById.get(r.id);
      lines.push(
        `  <collection id="${escapeXmlAttr(r.id)}" name="${escapeXmlAttr(r.name)}"` +
          (node
            ? ` file_count="${countAllowedFilesInTree(ctx, node)}"` +
              ` folder_count="${countAllowedChildFolders(ctx, node)}"`
            : "") +
          ` />`,
      );
    } else {
      // Citation token format: `[clf-<toolCallId>#<chunkIndex>]`. The literal
      // `__TOOL_CALL_ID__` sentinel is replaced with the actual toolCallId by
      // xyne-claw/src/mcp.ts:injectToolCallIdIntoClawCitations before the tool
      // result reaches the LLM. Same pattern as kb-get-chunks above.
      lines.push(
        `  <file id="${escapeXmlAttr(r.id)}" name="${escapeXmlAttr(r.name)}"` +
          (r.collectionName ? ` collection="${escapeXmlAttr(r.collectionName)}"` : "") +
          ` cite="[clf-__TOOL_CALL_ID__#${fileChunkIndex}]" />`,
      );
      if (r.collectionId) {
        citations.push(fileCitation(ctx, r.id, r.name, r.collectionId, fileChunkIndex));
      }
      fileChunkIndex++;
    }
  }
  lines.push(`</resources>`);
  return { content: lines.join("\n"), ...(citations.length > 0 ? { citations } : {}) };
}

function countAccessibleFilesInTree(n: KbCollectionNode): number {
  let total = n.items?.length ?? 0;
  for (const c of n.children ?? []) total += countAccessibleFilesInTree(c);
  return total;
}

// ── kb-search ────────────────────────────────────────────────────────────────

/**
 * One result row as returned by spaces' `/api/vespaSearch/claw` after
 * `transformCollection()` formatting. We pluck only what we need.
 */
interface VespaCollectionHit {
  id: string;
  type: string;
  title?: string;
  subtitle?: string;
  context?: string;
  searchContext?: {
    docId?: string;
    collectionId?: string;
    folderId?: string;
  };
}

interface VespaClawSearchResponse {
  success?: boolean;
  data?: {
    grouped?: boolean;
    groups?: Array<{ groupValue: string; count: number; results: VespaCollectionHit[] }>;
    results?: VespaCollectionHit[];
    totalCount?: number;
    /** Only present when includeDebugInfo=true on the request. */
    debug?: VespaDebugBlock;
  };
}

/**
 * Build the Vespa-side scope filter for kb-search. Pushes the agent's grant
 * shape DOWN to Vespa so it ranks only over in-scope docs (not just trims
 * after the fact).
 *
 * Returns one of:
 *   - { kind: "none" }          → no filter; USER scope relies on Vespa's
 *                                 per-user permission guard + workspace gate.
 *   - { kind: "collection", ids }→ Vespa `collectionId IN ids` (clId match).
 *                                 Used for whole-collection grants and mixed
 *                                 (collection + single-file) grants — keeps
 *                                 the "any file in the collection" semantics
 *                                 so newly-uploaded files are searchable
 *                                 without re-resolving grants. Single-file
 *                                 sibling extras are trimmed by fileAllowed().
 *   - { kind: "file", docIds }  → Vespa `docId IN docIds` (mapped to each
 *                                 grant's collectionItem.fileId). Used when
 *                                 ALL grants are single-file — Vespa ranks
 *                                 over exactly the granted files.
 *   - { error }                 → no allowed scope to search.
 */
type VespaScopeFilter =
  | { kind: "none" }
  | { kind: "collection"; ids: string[] }
  | { kind: "file"; docIds: string[] };

function buildVespaScope(
  ctx: KbResolution,
  explicitCollectionId: string | undefined,
): VespaScopeFilter | { error: string } {
  if (explicitCollectionId) {
    const meta = ctx.collectionsById.get(explicitCollectionId);
    // A non-root folder: Vespa's collectionId filter only ever matches a
    // doc's ROOT collection, so this has to expand to explicit docIds
    // instead (see collectAllowedVespaDocIds). Applies equally to a
    // folder-picked attachedContext item and to the model passing a
    // sub-folder id as kb-search's collectionId arg directly.
    if (meta && meta.rootCollectionId !== explicitCollectionId) {
      const docIds = collectAllowedVespaDocIds(ctx, explicitCollectionId);
      if (docIds.length === 0) {
        return { error: `Folder \`${explicitCollectionId}\` has no accessible files.` };
      }
      return { kind: "file", docIds };
    }
    return { kind: "collection", ids: [explicitCollectionId] };
  }
  if (ctx.scope === "USER") return { kind: "none" };

  const hasWholeCollectionGrant = ctx.grants.some(g => g.fileId === null);
  const singleFileGrants = ctx.grants.filter(g => g.fileId !== null);

  // All-single-file grant set → narrow Vespa to exactly those docIds. Vespa's
  // file schema uses collectionItem.fileId as docId, not collectionItem.id —
  // resolve via filesById (which knows both ids).
  if (!hasWholeCollectionGrant && singleFileGrants.length > 0) {
    const docIds = new Set<string>();
    for (const g of singleFileGrants) {
      const f = ctx.filesById.get(g.fileId!);
      if (f?.vespaDocId) docIds.add(f.vespaDocId);
    }
    if (docIds.size === 0) {
      // Grant rows exist but every granted item is no longer accessible to the
      // user (or the tree fetch missed them). Nothing to search.
      return { error: "This agent's granted files are not currently accessible." };
    }
    return { kind: "file", docIds: Array.from(docIds) };
  }

  // Mixed grants OR all whole-collection grants → collection-level filter. The
  // per-file grants (`g.fileId` set) still include the file's parent collection
  // id so Vespa surfaces those files; the post-filter (`fileAllowed`) trims
  // sibling extras out of mixed-grant collections.
  const ids = new Set<string>();
  for (const g of ctx.grants) {
    if (g.fileId === null) {
      ids.add(g.collectionId);
    } else {
      const f = ctx.filesById.get(g.fileId);
      if (f?.collectionId) ids.add(f.collectionId);
    }
  }
  if (ids.size === 0) return { error: "This agent has no Knowledge Base resources to search." };
  return { kind: "collection", ids: Array.from(ids) };
}

export async function handleKbSearch(args: {
  userId: string;
  agentSlug: string;
  query: string;
  collectionId?: string;
  limit?: number;
  offset?: number;
  createdBy?: string;
  before?: string;
  after?: string;
  on?: string;
  range?: string;
}): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  if (args.collectionId && !collectionAllowed(ctx, args.collectionId)) {
    return { content: `Collection \`${args.collectionId}\` is not in this agent's allowed scope.`, isError: true };
  }

  const q = args.query.trim();
  if (!q) return { content: "kb-search requires a non-empty query.", isError: true };
  const limit = args.limit ?? 10;

  const scope = buildVespaScope(ctx, args.collectionId);
  if ("error" in scope) return { content: scope.error, isError: true };

  const auth = await getSpacesAuthForUser(args.userId, "agent-chat");
  if (!auth) return { content: "Spaces session unavailable — cannot search the Knowledge Base.", isError: true };

  // Fetch a bit more than `limit` so the post-filter pass (single-file grants,
  // revoked-since-index files) has room to drop ineligible hits without
  // starving the result list. Capped at vespa's reasonable upper bound.
  const params: Record<string, string> = {
    q,
    apps: "file",
    subApp: "collections",
    limit: String(Math.min(Math.max(limit * 2, limit), 50)),
  };
  if (scope.kind === "collection" && scope.ids.length > 0) {
    params["collectionId"] = scope.ids.join(",");
  } else if (scope.kind === "file" && scope.docIds.length > 0) {
    params["fileId"] = scope.docIds.join(",");
  }

  // Optional Vespa-side filters mirrored from spaces-search. The spaces
  // searchHandler maps `from` → file.createdBy, and the date filters
  // (before/after/on/range) → file.created* — see backend/src/services/
  // vespaSearch/index.ts. Bumping `offset` paginates the underlying Vespa
  // results; the post-filter still trims to `limit` per page.
  if (args.createdBy) params["from"] = args.createdBy;
  if (args.before) params["before"] = args.before;
  if (args.after) params["after"] = args.after;
  if (args.on) params["on"] = args.on;
  if (args.range) params["range"] = args.range;
  if (typeof args.offset === "number" && args.offset > 0) params["offset"] = String(args.offset);

  // Always request the YQL so it can be persisted on the ToolInvocation
  // record — see KbHandlerResult.debug. The cost is just a few extra hundred
  // bytes per response (no model context impact — claw strips it before
  // building the tool result).
  params["includeDebugInfo"] = "true";

  log.info(
    `[kb-search] DEBUG agent=${args.agentSlug} user=${args.userId} scope=${ctx.scope} ` +
    `grants=${ctx.grants.length} vespaScope=${scope.kind}` +
    `${scope.kind === "collection" ? `(${scope.ids.length})` : scope.kind === "file" ? `(${scope.docIds.length})` : ""} ` +
    `accessibleCollections=${ctx.accessibleCollectionIds.size} ` +
    `accessibleFiles=${ctx.accessibleFileIds.size} params=${JSON.stringify(params)}`
  );

  let raw: unknown;
  try {
    raw = await spacesVespaSearch(params, {
      token: auth.token,
      sessionId: auth.sessionId,
      workspaceId: auth.workspaceId,
    });
  } catch (err) {
    log.warn(`[kb-search] vespa call failed: ${errMsg(err)}`);
    return { content: `KB search failed: ${err instanceof Error ? err.message : "unknown error"}`, isError: true };
  }

  const data = raw as VespaClawSearchResponse;

  // Compact raw-response shape log (don't dump entire payload — chunks can be huge).
  const rawFlatForDebug = data?.data?.grouped && data?.data?.groups
    ? data.data.groups.flatMap(g => g.results ?? [])
    : (data?.data?.results ?? []);
  try {
    log.info(
      `[kb-search] DEBUG vespa response success=${data?.success} hasData=${!!data?.data} ` +
      `grouped=${data?.data?.grouped} totalCount=${data?.data?.totalCount} rawHits=${rawFlatForDebug.length} ` +
      `sampleHit=${rawFlatForDebug.length > 0 ? JSON.stringify({
        id: rawFlatForDebug[0]?.id,
        type: rawFlatForDebug[0]?.type,
        title: rawFlatForDebug[0]?.title,
        subtitle: rawFlatForDebug[0]?.subtitle,
        hasContext: !!rawFlatForDebug[0]?.context,
        contextLen: rawFlatForDebug[0]?.context?.length ?? 0,
        searchContext: rawFlatForDebug[0]?.searchContext,
      }) : "none"}`
    );
  } catch (e) {
    log.warn(`[kb-search] DEBUG log of response shape failed: ${errMsg(e)}`);
  }

  // Capture for attachment to the result below. Spaces returns the YQL +
  // bound params under `data.debug.payloads` when includeDebugInfo=true.
  const debugBlock: VespaDebugBlock | undefined = data?.data?.debug;

  if (!data?.success || !data.data) {
    return {
      content: `No matching files for query "${args.query}" in this agent's KB scope.`,
      ...(debugBlock ? { debug: debugBlock } : {}),
    };
  }

  const flat: VespaCollectionHit[] = data.data.grouped && data.data.groups
    ? data.data.groups.flatMap(g => g.results ?? [])
    : (data.data.results ?? []);

  type Hit = { fileId: string; name: string; path?: string; collectionId: string; collectionName: string; snippet?: string };
  const hits: Hit[] = [];
  const seen = new Set<string>();
  let droppedNoIds = 0;
  let droppedDuplicate = 0;
  let droppedNotAllowed = 0;
  let droppedUnknownDocId = 0;
  const droppedNotAllowedSample: string[] = [];
  const droppedUnknownSample: string[] = [];
  for (const r of flat) {
    const sc = r.searchContext ?? {};
    // Vespa's docId on file docs is collectionItem.fileId, but everywhere else
    // (accessibleFileIds, filesById, grants, the spaces download endpoint) uses
    // collectionItem.id. Translate before the allow-check.
    const vespaDocId = sc.docId ?? r.id;
    const collectionId = sc.collectionId;
    if (!vespaDocId || !collectionId) { droppedNoIds++; continue; }
    const itemId = ctx.vespaDocIdToItemId.get(vespaDocId);
    if (!itemId) {
      droppedUnknownDocId++;
      if (droppedUnknownSample.length < 5) droppedUnknownSample.push(vespaDocId);
      continue;
    }
    if (seen.has(itemId)) { droppedDuplicate++; continue; }
    if (!fileAllowed(ctx, itemId)) {
      droppedNotAllowed++;
      if (droppedNotAllowedSample.length < 5) droppedNotAllowedSample.push(itemId);
      continue;
    }
    seen.add(itemId);
    const fileMeta = ctx.filesById.get(itemId);
    hits.push({
      fileId: itemId,
      name: r.title || fileMeta?.name || itemId,
      // Convention-based KBs repeat file names across folders (`service.md` in
      // every area). Without the path the model can't tell the hits apart.
      ...(fileMeta?.path ? { path: fileMeta.path } : {}),
      collectionId,
      collectionName: r.subtitle || fileMeta?.collectionName || collectionId,
      ...(typeof r.context === "string" && r.context.trim() ? { snippet: r.context.trim() } : {}),
    });
    if (hits.length >= limit) break;
  }

  log.info(
    `[kb-search] DEBUG post-filter rawHits=${flat.length} kept=${hits.length} ` +
    `droppedNoIds=${droppedNoIds} droppedDuplicate=${droppedDuplicate} ` +
    `droppedUnknownDocId=${droppedUnknownDocId}${droppedUnknownSample.length > 0 ? ` unknownSample=${JSON.stringify(droppedUnknownSample)}` : ""} ` +
    `droppedNotAllowed=${droppedNotAllowed}${droppedNotAllowedSample.length > 0 ? ` notAllowedSample=${JSON.stringify(droppedNotAllowedSample)}` : ""}`
  );

  if (hits.length === 0) return {
    content: `No matching files for query "${args.query}" in this agent's KB scope.`,
    ...(debugBlock ? { debug: debugBlock } : {}),
  };

  // Same XML + inline `cite="[clf-__TOOL_CALL_ID__#N]"` pattern as
  // kb-get-chunks / kb-search-within-doc — N matches each citation's
  // chunkIndex so the dashboard's findCitationForChunk resolves chips per hit.
  const lines: string[] = [];
  lines.push(
    `<search_results query="${escapeXmlAttr(args.query)}" returned="${hits.length}">`,
  );
  const citations: Citation[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    lines.push(
      `  <hit rank="${i + 1}" id="${escapeXmlAttr(h.fileId)}" name="${escapeXmlAttr(h.name)}" ` +
        (h.path ? `path="${escapeXmlAttr(h.path)}" ` : "") +
        `collection="${escapeXmlAttr(h.collectionName)}" cite="[clf-__TOOL_CALL_ID__#${i}]">`,
    );
    if (h.snippet) {
      const snippet = h.snippet.replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 280);
      lines.push(`    <snippet>${escapeXmlText(snippet)}</snippet>`);
    }
    lines.push(`  </hit>`);
    citations.push(fileCitation(ctx, h.fileId, h.name, h.collectionId, i));
  }
  lines.push(`</search_results>`);
  return {
    content: lines.join("\n"),
    citations,
    ...(debugBlock ? { debug: debugBlock } : {}),
  };
}

// ── kb-list-files ────────────────────────────────────────────────────────────

/** Recursive count of files under `n` that this agent + user may actually read. */
function countAllowedFilesInTree(ctx: KbResolution, n: KbCollectionNode): number {
  let total = 0;
  for (const f of n.items ?? []) if (fileAllowed(ctx, f.id)) total++;
  for (const c of n.children ?? []) total += countAllowedFilesInTree(ctx, c);
  return total;
}

/** Count of `n`'s IMMEDIATE sub-folders that are in scope. */
function countAllowedChildFolders(ctx: KbResolution, n: KbCollectionNode): number {
  let total = 0;
  for (const c of n.children ?? []) if (collectionAllowed(ctx, c.id)) total++;
  return total;
}

/**
 * Every allowed file's Vespa docId under `folderId`, recursively — used to
 * scope a kb-search call to a non-root folder. Vespa's `collectionId` filter
 * only ever matches a doc's ROOT collection (see buildVespaScope), so a
 * folder id can't be filtered on directly; this expands it to explicit
 * docIds instead, walking the tree already fetched for ACL checks (no extra
 * network call). Re-applies fileAllowed() per file so a COLLECTIONS-scoped
 * agent whose grant only covers part of this subtree doesn't leak the rest.
 */
function collectAllowedVespaDocIds(ctx: KbResolution, folderId: string): string[] {
  const start = ctx.nodesById.get(folderId);
  if (!start) return [];
  const docIds: string[] = [];
  const walk = (n: KbCollectionNode): void => {
    for (const f of n.items ?? []) {
      if (f.fileId && fileAllowed(ctx, f.id)) docIds.push(f.fileId);
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(start);
  return docIds;
}

/**
 * Row cap for one kb-list-files call. A deep `depth: -1` on a large KB would
 * otherwise dump thousands of rows into the model's context. When we hit it we
 * say so explicitly — a silently truncated listing reads as "that's everything"
 * and sends the agent down the same blind-search path this tool exists to avoid.
 */
const LIST_FILES_MAX_ROWS = 400;

export async function handleKbListFiles(args: {
  userId: string;
  agentSlug: string;
  collectionId: string;
  depth?: number;
}): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  if (!collectionAllowed(ctx, args.collectionId)) {
    return { content: `Collection \`${args.collectionId}\` is not in this agent's allowed scope.`, isError: true };
  }
  const root = ctx.nodesById.get(args.collectionId);
  if (!root) {
    return { content: `Collection \`${args.collectionId}\` is not in this agent's allowed scope.`, isError: true };
  }

  // depth 1 (default) — this collection's own files, plus its immediate
  // sub-folders as unexpanded <folder> rows. depth N expands N levels; depth -1
  // walks the whole subtree. Sub-folders MUST be emitted at every depth: their
  // ids are otherwise unobtainable (kb-list-resources only ever surfaces roots
  // or granted rows), which left the model unable to reach anything not sitting
  // directly in the collection it was pointed at.
  const rawDepth =
    typeof args.depth === "number" && Number.isFinite(args.depth) ? Math.trunc(args.depth) : 1;
  const maxDepth = rawDepth < 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(rawDepth, 10));

  const body: string[] = [];
  const citations: Citation[] = [];
  let fileRows = 0;
  let folderRows = 0;
  let unexpandedFolders = 0;
  let truncated = false;

  const indent = (level: number): string => "  ".repeat(level + 1);

  const render = (node: KbCollectionNode, level: number): void => {
    for (const f of node.items ?? []) {
      if (!fileAllowed(ctx, f.id)) continue;
      if (fileRows + folderRows >= LIST_FILES_MAX_ROWS) {
        truncated = true;
        return;
      }
      const meta = ctx.filesById.get(f.id);
      // Same inline `cite="[clf-__TOOL_CALL_ID__#N]"` pattern as kb-get-chunks —
      // N matches the citation's chunkIndex so the dashboard resolves a
      // clickable chip per file row.
      body.push(
        `${indent(level)}<file id="${escapeXmlAttr(f.id)}" name="${escapeXmlAttr(f.name)}"` +
          (meta?.path ? ` path="${escapeXmlAttr(meta.path)}"` : "") +
          ` cite="[clf-__TOOL_CALL_ID__#${fileRows}]" />`,
      );
      citations.push(fileCitation(ctx, f.id, f.name, node.id, fileRows));
      fileRows++;
    }
    for (const c of node.children ?? []) {
      if (!collectionAllowed(ctx, c.id)) continue;
      if (fileRows + folderRows >= LIST_FILES_MAX_ROWS) {
        truncated = true;
        return;
      }
      folderRows++;
      const open =
        `${indent(level)}<folder id="${escapeXmlAttr(c.id)}" name="${escapeXmlAttr(c.name)}" ` +
        `file_count="${countAllowedFilesInTree(ctx, c)}" ` +
        `folder_count="${countAllowedChildFolders(ctx, c)}"`;
      if (level + 1 < maxDepth) {
        body.push(`${open}>`);
        render(c, level + 1);
        body.push(`${indent(level)}</folder>`);
      } else {
        // Not expanded at this depth — the id is what the model needs to drill in.
        body.push(`${open} />`);
        unexpandedFolders++;
      }
    }
  };

  render(root, 0);

  if (fileRows === 0 && folderRows === 0) {
    return { content: `Collection \`${args.collectionId}\` has no files or sub-folders you can access.` };
  }

  const lines: string[] = [];
  lines.push(
    `<files collection_id="${escapeXmlAttr(args.collectionId)}"` +
      (root.name ? ` collection_name="${escapeXmlAttr(root.name)}"` : "") +
      ` depth="${rawDepth < 0 ? "all" : maxDepth}"` +
      ` file_count="${fileRows}" folder_count="${folderRows}">`,
  );
  lines.push(...body);
  lines.push(`</files>`);

  if (truncated) {
    lines.push(
      `\nTruncated at ${LIST_FILES_MAX_ROWS} rows — this is NOT the full listing. ` +
        `Call \`kb-list-files\` on a specific folder id to narrow, or \`kb-search\` to jump straight to a file.`,
    );
  }
  if (unexpandedFolders > 0) {
    lines.push(
      `\n${unexpandedFolders} folder(s) shown collapsed. Call \`kb-list-files\` with a folder's ` +
        `id to open it, or re-run with \`depth\` (e.g. 3, or -1 for the whole tree).`,
    );
  }
  return { content: lines.join("\n"), ...(citations.length > 0 ? { citations } : {}) };
}

// ── kb-read-file ─────────────────────────────────────────────────────────────

export async function handleKbReadFile(args: {
  userId: string;
  agentSlug: string;
  fileId: string;
}): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  if (!fileAllowed(ctx, args.fileId)) {
    return { content: `File \`${args.fileId}\` is not in this agent's allowed scope or you don't have access to it.`, isError: true };
  }

  const fileMeta = ctx.filesById.get(args.fileId)!;

  // Fetch the binary via spaces' download endpoint, with the user's session auth.
  const auth = await getSpacesAuthForUser(args.userId, "agent-chat");
  if (!auth) return { content: "Spaces session unavailable — cannot fetch file content.", isError: true };

  try {
    const { buffer, contentType } = await spacesFetchBuffer(
      `/api/collections/items/${encodeURIComponent(args.fileId)}/download`,
      { token: auth.token, sessionId: auth.sessionId, workspaceId: auth.workspaceId },
    );

    // Best-effort text extraction: if the response is plain text / markdown /
    // anything UTF-8-decodable, return it. For binaries the agent should call
    // a different tool (or rely on the ingestion-extracted text via Vespa
    // search — out of scope for v1).
    const looksTextual = /^(text\/|application\/(json|xml|x-yaml|yaml|markdown))/.test(contentType);
    const text = buffer.toString("utf8");
    // NB: match the NUL via the regex escape below, never a raw 0x00 byte in a
    // string literal. A literal NUL lived here once and got silently stripped,
    // leaving `includes("")` — always true, so every file reported as binary.
    const isLikelyBinary = /\x00/.test(text) || /[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 200));

    // Single-result read still emits the same `[clf-__TOOL_CALL_ID__#0]` token
    // shape as kb-get-chunks so the dashboard chip resolves via the matching
    // chunkIndex on the citation.
    const citation = fileCitation(ctx, args.fileId, fileMeta.name, fileMeta.collectionId, 0);
    const citeToken = `[clf-__TOOL_CALL_ID__#0]`;

    if (isLikelyBinary) {
      if (isXlsxFile(contentType, fileMeta.name)) {
        const body = await extractXlsxText(buffer, fileMeta.name);
        const header = `## ${fileMeta.name} ${citeToken}\n\n_collection: ${fileMeta.collectionName}_\n\n---\n\n`;
        return { content: header + body, citations: [citation] };
      }

      return {
        content:
          `File \`${fileMeta.name}\` ${citeToken} is a binary type (PDF / image / office doc). ` +
          `Plain text extraction isn't available in v1 — open the file in spaces for a preview.`,
        citations: [citation],
      };
    }

    const header = `## ${fileMeta.name} ${citeToken}\n\n_collection: ${fileMeta.collectionName}_\n\n---\n\n`;
    const body = text.length > 100_000 ? text.slice(0, 100_000) + "\n\n…(truncated to 100k characters)" : text;
    return { content: header + body, citations: [citation] };
  } catch (err) {
    log.warn(`[kb-read-file] download failed fileId=${args.fileId} err=${errMsg(err)}`);
    return { content: `Failed to read file \`${args.fileId}\`: ${err instanceof Error ? err.message : "unknown error"}`, isError: true };
  }
}

// ── kb-get-chunks / kb-search-within-doc ────────────────────────────────────
//
// Both tools delegate the actual Vespa read to spaces'
// /api/vespaSearch/claw endpoint in `includeChunkLevel=true` mode. The
// spaces handler is the trust boundary for the permissions check on the doc;
// our role here is the two-layer KB allowlist gate (`fileAllowed`) plus
// translating the spaces-side `fileId` (collectionItem.id) → Vespa `docId`
// (collectionItem.fileId) before issuing the HTTP call.

interface ChunkPayload {
  index: number;
  text: string;
  page_numbers?: number[];
  block_labels?: string[];
}

interface WithinDocHit {
  rank: number;
  chunk_index: number | null;
  score: number;
  snippet: string;
  page_numbers?: number[];
  block_labels?: string[];
}

interface ChunksResponse {
  success?: boolean;
  data?: {
    mode?: "chunks";
    docId?: string;
    title?: string;
    total_chunks?: number;
    returned?: number;
    start?: number;
    end?: number;
    has_more?: boolean;
    chunks?: ChunkPayload[];
    debug?: VespaDebugBlock;
  };
  error?: string;
}

interface WithinDocResponse {
  success?: boolean;
  data?: {
    mode?: "within-doc";
    docId?: string;
    title?: string;
    query?: string;
    total_chunks?: number;
    hits?: WithinDocHit[];
    debug?: VespaDebugBlock;
  };
  error?: string;
}

function formatPages(pageNumbers: number[] | undefined): string {
  if (!pageNumbers || pageNumbers.length === 0) return "";
  const sorted = [...pageNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    last - first === sorted.length - 1
  ) {
    return first === last ? String(first) : `${String(first)}-${String(last)}`;
  }
  return sorted.join(",");
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function handleKbGetChunks(args: {
  userId: string;
  agentSlug: string;
  fileId: string;
  startChunkIndex: number;
  limit?: number;
}): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  if (!fileAllowed(ctx, args.fileId)) {
    return {
      content: `File \`${args.fileId}\` is not in this agent's allowed scope or you don't have access to it.`,
      isError: true,
    };
  }

  const fileMeta = ctx.filesById.get(args.fileId)!;
  if (!fileMeta.vespaDocId) {
    return {
      content: `File \`${args.fileId}\` has no associated Vespa document (ingestion may not have completed).`,
      isError: true,
    };
  }

  const auth = await getSpacesAuthForUser(args.userId, "agent-chat");
  if (!auth) {
    return { content: "Spaces session unavailable — cannot fetch chunks.", isError: true };
  }

  const limit = Math.min(Math.max(args.limit ?? 15, 1), 30);
  const start = Math.max(args.startChunkIndex, 0);
  const params: Record<string, string> = {
    apps: "file",
    subApp: "collections",
    fileId: fileMeta.vespaDocId,
    includeChunkLevel: "true",
    startChunkIndex: String(start),
    chunkLimit: String(limit),
    q: "",
    filterOnly: "true",
    includeDebugInfo: "true",
  };

  let raw: unknown;
  try {
    raw = await spacesVespaSearch(params, {
      token: auth.token,
      sessionId: auth.sessionId,
      workspaceId: auth.workspaceId,
    });
  } catch (err) {
    log.warn(
      `[kb-get-chunks] vespa call failed fileId=${args.fileId} err=${errMsg(err)}`,
    );
    return {
      content: `kb-get-chunks failed: ${err instanceof Error ? err.message : "unknown error"}`,
      isError: true,
    };
  }

  const resp = raw as ChunksResponse;
  if (!resp?.success || !resp.data) {
    return {
      content: resp?.error ?? `No chunks returned for \`${args.fileId}\`.`,
      isError: true,
    };
  }
  const d = resp.data;
  const debugBlock = d.debug;
  const chunks = d.chunks ?? [];
  const total = d.total_chunks ?? chunks.length;
  const returned = d.returned ?? chunks.length;
  const startIdx = d.start ?? start;
  const endIdx = d.end ?? (returned > 0 ? startIdx + returned - 1 : startIdx);
  const hasMore = d.has_more ?? false;
  const title = d.title ?? fileMeta.name;

  const lines: string[] = [];
  lines.push(
    `<chunks docId="${escapeXmlAttr(args.fileId)}" start="${startIdx}" ` +
      `end="${endIdx}" returned="${returned}" total_chunks="${total}">`,
  );
  lines.push(`  <title>${escapeXmlText(title)}</title>`);
  const citations: Citation[] = [];
  for (const c of chunks) {
    const pages = formatPages(c.page_numbers);
    const labels = c.block_labels?.join(",") ?? "";
    // Citation token format: `[clf-<toolCallId>#<chunkIndex>]`. The literal
    // `__TOOL_CALL_ID__` sentinel is replaced with the actual toolCallId by
    // xyne-claw/src/mcp.ts:injectToolCallIdIntoClawCitations before the tool
    // result reaches the LLM. The dashboard's CitationMark regex requires
    // both the `clf-` prefix and a real toolCallId to render the chip.
    lines.push(
      `  <chunk index="${c.index}"` +
        (pages ? ` pages="${pages}"` : "") +
        (labels ? ` labels="${escapeXmlAttr(labels)}"` : "") +
        ` cite="[clf-__TOOL_CALL_ID__#${c.index}]">`,
    );
    lines.push(`    ${escapeXmlText(c.text)}`);
    lines.push(`  </chunk>`);
    // page_numbers is 1-based (Docling) and sorted; first entry is the page the
    // chunk starts on — that's where the viewer should land.
    citations.push(
      fileCitation(
        ctx,
        args.fileId,
        fileMeta.name,
        fileMeta.collectionId,
        c.index,
        c.page_numbers?.[0],
      ),
    );
  }
  lines.push(`</chunks>`);
  if (hasMore) {
    lines.push(
      `\nMore chunks available. Call \`kb-get-chunks\` again with ` +
        `startChunkIndex=${endIdx + 1} to continue from chunk ${endIdx + 1}/${total - 1}.`,
    );
  } else {
    lines.push(`\nReached end of document.`);
  }

  return {
    content: lines.join("\n"),
    citations,
    ...(debugBlock ? { debug: debugBlock } : {}),
  };
}

export async function handleKbSearchWithinDoc(args: {
  userId: string;
  agentSlug: string;
  fileId: string;
  query: string;
  limit?: number;
}): Promise<KbHandlerResult> {
  const ctx = await resolveKbContext(args.userId, args.agentSlug);
  if ("error" in ctx) return { content: ctx.error, isError: true };

  if (!fileAllowed(ctx, args.fileId)) {
    return {
      content: `File \`${args.fileId}\` is not in this agent's allowed scope or you don't have access to it.`,
      isError: true,
    };
  }

  const q = args.query.trim();
  if (!q) {
    return { content: "kb-search-within-doc requires a non-empty query.", isError: true };
  }

  const fileMeta = ctx.filesById.get(args.fileId)!;
  if (!fileMeta.vespaDocId) {
    return {
      content: `File \`${args.fileId}\` has no associated Vespa document (ingestion may not have completed).`,
      isError: true,
    };
  }

  const auth = await getSpacesAuthForUser(args.userId, "agent-chat");
  if (!auth) {
    return {
      content: "Spaces session unavailable — cannot search within document.",
      isError: true,
    };
  }

  const limit = Math.min(Math.max(args.limit ?? 15, 1), 30);
  const params: Record<string, string> = {
    q,
    apps: "file",
    subApp: "collections",
    fileId: fileMeta.vespaDocId,
    includeChunkLevel: "true",
    chunkLimit: String(limit),
    includeDebugInfo: "true",
  };

  let raw: unknown;
  try {
    raw = await spacesVespaSearch(params, {
      token: auth.token,
      sessionId: auth.sessionId,
      workspaceId: auth.workspaceId,
    });
  } catch (err) {
    log.warn(
      `[kb-search-within-doc] vespa call failed fileId=${args.fileId} err=${errMsg(err)}`,
    );
    return {
      content: `kb-search-within-doc failed: ${err instanceof Error ? err.message : "unknown error"}`,
      isError: true,
    };
  }

  const resp = raw as WithinDocResponse;
  if (!resp?.success || !resp.data) {
    return {
      content: resp?.error ?? `No matching chunks for "${q}" in \`${args.fileId}\`.`,
      isError: true,
    };
  }
  const d = resp.data;
  const debugBlock = d.debug;
  const hits = d.hits ?? [];
  const title = d.title ?? fileMeta.name;

  const lines: string[] = [];
  lines.push(
    `<doc_search docId="${escapeXmlAttr(args.fileId)}" query="${escapeXmlAttr(q)}" ` +
      `hits="${hits.length}"` +
      (typeof d.total_chunks === "number" ? ` total_chunks="${d.total_chunks}"` : "") +
      `>`,
  );
  lines.push(`  <title>${escapeXmlText(title)}</title>`);
  const citations: Citation[] = [];
  for (const h of hits) {
    const pages = formatPages(h.page_numbers);
    const labels = h.block_labels?.join(",") ?? "";
    // See kb-get-chunks above: `[clf-__TOOL_CALL_ID__#<N>]` — the sentinel is
    // swapped for the real toolCallId in xyne-claw/src/mcp.ts and the dashboard
    // CitationMark regex resolves it via findCitationForChunk(...).
    const cite =
      h.chunk_index === null
        ? ""
        : ` cite="[clf-__TOOL_CALL_ID__#${h.chunk_index}]"`;
    lines.push(
      `  <hit rank="${h.rank}" chunk_index="${h.chunk_index ?? ""}" ` +
        `score="${h.score.toFixed(4)}"` +
        (pages ? ` pages="${pages}"` : "") +
        (labels ? ` labels="${escapeXmlAttr(labels)}"` : "") +
        `${cite}>`,
    );
    if (h.snippet) {
      lines.push(`    <snippet>${escapeXmlText(h.snippet)}</snippet>`);
    }
    lines.push(`  </hit>`);
    if (h.chunk_index !== null) {
      citations.push(
        fileCitation(
          ctx,
          args.fileId,
          fileMeta.name,
          fileMeta.collectionId,
          h.chunk_index,
          h.page_numbers?.[0],
        ),
      );
    }
  }
  // Always include at least one whole-file citation so the chip can resolve
  // even when no hit had a chunk_index.
  if (citations.length === 0) {
    citations.push(fileCitation(ctx, args.fileId, fileMeta.name, fileMeta.collectionId));
  }
  lines.push(`</doc_search>`);
  lines.push(
    `\nFollow up with \`kb-get-chunks\` on the same fileId using the ` +
      `\`chunk_index\` of the most relevant hit to read full context.`,
  );

  return {
    content: lines.join("\n"),
    citations,
    ...(debugBlock ? { debug: debugBlock } : {}),
  };
}