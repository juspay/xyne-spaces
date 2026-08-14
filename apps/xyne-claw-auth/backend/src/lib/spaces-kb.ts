/**
 * Spaces Knowledge Base helpers — pull a user's accessible collection tree
 * from spaces backend (/api/collections/accessible) and validate payloads.
 *
 * Used by:
 *   - routes/knowledge-base.ts  → frontend KB picker
 *   - routes/agents.ts          → validation on POST/PATCH knowledgeBase[]
 *   - mcp/servers/xyne-spaces-tools.ts → runtime access checks in KB tools
 */

import { spacesFetch, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { getSpacesAuthForUser } from "./spaces-db.js";
import { createLogger } from "../logger.js";

const log = createLogger("spaces-kb");

export interface KbFile {
  id: string;
  name: string;
  itemType: "file";
  fileId: string;
  ingestionStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbCollectionNode {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  ownerId: string;
  scopeType: string;
  scopeId: string;
  parentId: string | null;
  rootCollectionId: string | null;
  effectiveRole: "OWNER" | "EDITOR" | "VIEWER";
  /** Channel display name when scopeType='CHANNEL' (root nodes only). */
  channelName?: string;
  /** Project id of the channel that owns this collection (root nodes only). */
  projectId?: string;
  /** Project display name (root nodes only). */
  projectName?: string;
  children?: KbCollectionNode[];
  items?: KbFile[];
}

/**
 * Build a SpacesAuthContext for `userId` from the live spaces session DB.
 * Returns null if the user has no active session (no read possible).
 */
async function authForUser(userId: string): Promise<SpacesAuthContext | null> {
  const auth = await getSpacesAuthForUser(userId, "agent-chat");
  if (!auth) return null;
  return { token: auth.token, sessionId: auth.sessionId, workspaceId: auth.workspaceId };
}

/**
 * Fetch the requesting user's accessible KB tree from spaces backend. When
 * `includeItems` is true, every root collection is expanded with its full
 * sub-folder + file tree (one DB pass on the spaces side). Returns null when
 * the user has no active spaces session.
 */
export async function fetchAccessibleKb(
  userId: string,
  options: { includeItems?: boolean; scopeType?: string; scopeId?: string } = {},
): Promise<KbCollectionNode[] | null> {
  const auth = await authForUser(userId);
  if (!auth) return null;

  const qs = new URLSearchParams();
  if (options.includeItems) qs.set("includeItems", "1");
  if (options.scopeType) qs.set("scopeType", options.scopeType);
  if (options.scopeId) qs.set("scopeId", options.scopeId);

  try {
    const raw = (await spacesFetch(
      `/api/collections/accessible${qs.toString() ? `?${qs}` : ""}`,
      { method: "GET" },
      auth,
    )) as { success?: boolean; collections?: KbCollectionNode[] } | null;
    return raw?.collections ?? [];
  } catch (err) {
    log.warn(`[fetchAccessibleKb] failed userId=${userId} err=${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Index a KB tree as two sets:
 *  - `collections` — every collection (and sub-folder) id the user can see
 *  - `files`       — every file (collection_item) id the user can see
 *
 * Used to validate write payloads ("does the requester actually have access to
 * the resources they're trying to attach to this agent?") and to enforce
 * MCP-tool-time access ("does the calling user still have access to this id?").
 */
export function indexKbTree(tree: KbCollectionNode[]): { collections: Set<string>; files: Set<string> } {
  const collections = new Set<string>();
  const files = new Set<string>();

  function visit(n: KbCollectionNode): void {
    collections.add(n.id);
    for (const f of n.items ?? []) files.add(f.id);
    for (const c of n.children ?? []) visit(c);
  }
  for (const root of tree) visit(root);
  return { collections, files };
}

/**
 * Filter a candidate KB grant list to ONLY those the user can actually access.
 * Returns the filtered list AND the rejected entries (for error reporting).
 *
 * Soft-fails to the empty list when the spaces session is unavailable — the
 * tool-layer check is the hard gate; this validation is a defensive pre-write
 * to keep the DB clean and surface "you can't pick this" early.
 */
export async function validateKbGrants(
  userId: string,
  grants: Array<{ collectionId: string; fileId?: string | null }>,
): Promise<{
  accepted: Array<{ collectionId: string; fileId: string | null }>;
  rejected: Array<{ collectionId: string; fileId: string | null; reason: string }>;
}> {
  if (grants.length === 0) return { accepted: [], rejected: [] };

  const tree = await fetchAccessibleKb(userId, { includeItems: true });
  if (!tree) {
    // No session → can't validate. Reject the whole batch rather than
    // silently accepting unverifiable ids.
    return {
      accepted: [],
      rejected: grants.map(g => ({ collectionId: g.collectionId, fileId: g.fileId ?? null, reason: "no-spaces-session" })),
    };
  }

  const { collections, files } = indexKbTree(tree);
  const accepted: Array<{ collectionId: string; fileId: string | null }> = [];
  const rejected: Array<{ collectionId: string; fileId: string | null; reason: string }> = [];

  for (const g of grants) {
    const fileId = g.fileId ?? null;
    if (!collections.has(g.collectionId)) {
      rejected.push({ collectionId: g.collectionId, fileId, reason: "collection-not-accessible" });
      continue;
    }
    if (fileId !== null && !files.has(fileId)) {
      rejected.push({ collectionId: g.collectionId, fileId, reason: "file-not-accessible" });
      continue;
    }
    accepted.push({ collectionId: g.collectionId, fileId });
  }
  return { accepted, rejected };
}

/**
 * Attaches the agent's collection grants to the config sent to claw, but only
 * for KB-curating agents (`kbAccess: "files"`).
 *
 * claw builds its KB target from `knowledgeBase` on the config it receives.
 * Without this the grant never crosses the wire and claw logs "kbAccess=files
 * but no knowledgeBase grant" — the agent silently falls back to filesystem
 * tools pointed at an empty session workspace, which looks like the KB is empty
 * rather than like a misconfiguration.
 *
 * Every dispatcher that calls claw's /run must go through this, or the tools
 * differ depending on which entry point the user happened to hit.
 */
export async function attachKbGrantsToConfig(
  config: Record<string, unknown> | undefined,
  agentId: string,
  // Structurally typed so both dispatchers can pass their own client without
  // this module importing prisma and creating a cycle.
  prisma: { agentCollection: { findMany: (args: any) => Promise<Array<{ collectionId: string }>> } },
): Promise<Record<string, unknown> | undefined> {
  if (config?.["kbAccess"] !== "files") return config;

  const grants = await prisma.agentCollection.findMany({
    where: { agentId },
    select: { collectionId: true },
  });

  return {
    ...config,
    knowledgeBase: grants.map((g) => ({ collectionId: g.collectionId })),
  };
}
