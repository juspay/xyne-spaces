import { interact, spacesFetch, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import { errMsg } from "../lib/errors.js";

export type ContextType = "channel" | "ticket" | "canvas" | "call" | "activity" | "collection" | "file" | "folder";
// 'collection' / 'file' / 'folder' are not user-searchable via this service
// (they're picked through the dashboard's KB picker, not via the generic
// search), so they're intentionally excluded from the search-type enum.
export type ContextItemType = ContextType | "repository";
export type ContextSearchType = Exclude<ContextType, "activity" | "collection" | "file" | "folder"> | "repository" | "all";

export interface ContextItem {
  id: string;
  type: ContextItemType;
  title: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
}

/**
 * What an attached canvas IS, when the attaching surface knows. A recording
 * attaches two canvases whose rows are indistinguishable — the machine-written
 * summary and the human's own notes — and they carry very different authority,
 * so the role travels with the item instead of being guessed from the title.
 */
export type CanvasRole = "call-notes" | "call-summary";

const CANVAS_ROLES: readonly CanvasRole[] = ["call-notes", "call-summary"];

function isCanvasRole(value: unknown): value is CanvasRole {
  return typeof value === "string" && (CANVAS_ROLES as readonly string[]).includes(value);
}

export interface AttachedContextRef {
  type: ContextType;
  id: string;
  title: string;
  threadId?: string;
  /** Canvas items only. Absent for a canvas the user picked by hand. */
  canvasRole?: CanvasRole;
  // Activity-specific fields
  eventName?: string;
  eventCategory?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  relatedData?: Record<string, unknown>;
}

export interface ContextFile {
  path: string;
  content: string;
}

interface ChannelRow {
  id: string;
  name: string;
  scopeType?: string;
  visibility?: string;
  participantCount?: number;
  lastActivityAt?: string;
  conversationId?: string;
}

interface TicketRow {
  id: string;
  title: string;
  xyneId?: string;
  statusV2?: string;
  priority?: string;
  stageName?: string;
  description?: string;
  conversationId?: string;
  updatedAt?: string;
}

interface CanvasRow {
  id: string;
  title: string;
  docType?: string;
  visibility?: string;
  updatedAt?: string;
}

interface CallRow {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  callType?: string;
  channelId?: string;
  startsAt?: string;
  endsAt?: string;
  organizerId?: string;
  createdByUserId?: string;
  aiSummary?: string;
  transcript?: string;
  updatedAt?: string;
}

interface ConversationRow {
  callId?: string;
  conversationId: string;
}

interface MessageRow {
  messageId?: string;
  conversationId: string;
  senderId?: string;
  content?: string;
  createdAt?: string;
}

interface ResolvedContextSection {
  header: string;
  inlineText?: string;
  file?: ContextFile;
  fileCharCount?: number;
}

const MAX_CONTEXT_TOTAL = 20;
const PER_TYPE_LIMIT = 20;
const INLINE_THRESHOLD = 2_000;
const TICKET_MESSAGE_LIMIT = 12;

export function normalizeAttachedContext(input: unknown): { items: AttachedContextRef[]; error?: string } {
  if (input == null) return { items: [] };
  if (!Array.isArray(input)) return { items: [], error: "attachedContext must be an array" };
  if (input.length > MAX_CONTEXT_TOTAL) return { items: [], error: `attachedContext exceeds ${MAX_CONTEXT_TOTAL} items` };

  const items: AttachedContextRef[] = [];
  const seen = new Set<string>();
  const perTypeCounts: Record<Exclude<ContextType, "activity">, number> = {
    channel: 0,
    ticket: 0,
    canvas: 0,
    call: 0,
    collection: 0,
    file: 0,
    folder: 0,
  };

  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { items: [], error: "attachedContext contains invalid entries" };
    const obj = raw as Record<string, unknown>;
    const type = obj["type"];
    const id = obj["id"];
    const title = obj["title"];
    if (!isContextType(type)) return { items: [], error: "attachedContext.type must be one of channel|ticket|canvas|call|activity|collection|file|folder" };
    if (typeof id !== "string" || id.trim().length === 0) return { items: [], error: "attachedContext.id must be a non-empty string" };
    if (typeof title !== "string" || title.trim().length === 0) return { items: [], error: "attachedContext.title must be a non-empty string" };
    const threadId = obj["threadId"];
    if (threadId != null && (typeof threadId !== "string" || threadId.trim().length === 0)) {
      return { items: [], error: "attachedContext.threadId must be a non-empty string when provided" };
    }

    // Only apply per-type limit for non-activity types
    if (type !== "activity" && perTypeCounts[type] >= PER_TYPE_LIMIT) {
      return { items: [], error: `attachedContext exceeds ${PER_TYPE_LIMIT} items for type ${type}` };
    }

    const key = `${type}:${id.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type !== "activity") {
      perTypeCounts[type] += 1;
    }
    
    // Build item with all activity-specific fields if applicable
    const canvasRole = obj["canvasRole"];
    if (canvasRole != null && !isCanvasRole(canvasRole)) {
      return { items: [], error: "attachedContext.canvasRole must be one of call-notes|call-summary" };
    }

    const item: AttachedContextRef = {
      type,
      id: id.trim(),
      title: title.trim(),
      ...(typeof threadId === "string" && threadId.trim().length > 0 ? { threadId: threadId.trim() } : {}),
      ...(isCanvasRole(canvasRole) ? { canvasRole } : {}),
    };
    
    // Add activity-specific fields if this is an activity
    if (type === "activity") {
      const eventName = obj["eventName"];
      const eventCategory = obj["eventCategory"];
      const timestamp = obj["timestamp"];
      const metadata = obj["metadata"];
      const relatedData = obj["relatedData"];
      
      if (typeof eventName === "string") item.eventName = eventName;
      if (typeof eventCategory === "string") item.eventCategory = eventCategory;
      if (typeof timestamp === "string") item.timestamp = timestamp;
      if (metadata && typeof metadata === "object") item.metadata = metadata as Record<string, unknown>;
      if (relatedData && typeof relatedData === "object") item.relatedData = relatedData as Record<string, unknown>;
    }
    
    items.push(item);
  }

  return { items };
}

export async function searchContextItems(type: ContextSearchType, q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const safeLimit = clamp(limit, 1, 50);
  const query = q.trim();

  if (type === "all") {
    const [channels, tickets, canvases, calls] = await Promise.all([
      searchChannels(query, safeLimit, auth),
      searchTickets(query, safeLimit, auth),
      searchCanvases(query, safeLimit, auth),
      searchCalls(query, safeLimit, auth),
    ]);
    return interleave([channels, tickets, canvases, calls], safeLimit);
  }

  if (type === "channel") return searchChannels(query, safeLimit, auth);
  if (type === "ticket") return searchTickets(query, safeLimit, auth);
  if (type === "canvas") return searchCanvases(query, safeLimit, auth);
  if (type === "repository") return searchRepositories(query, safeLimit, auth);
  return searchCalls(query, safeLimit, auth);
}

export async function buildAttachedContextPayload(
  items: AttachedContextRef[],
  auth?: SpacesAuthContext,
  opts?: { threadConversationId?: string; canvasViewAccessId?: string },
): Promise<{ promptPrefix?: string; contextFiles: ContextFile[] }> {
  const threadConversationId = opts?.threadConversationId;
  const canvasViewAccessId = opts?.canvasViewAccessId;
  if (items.length === 0 && !threadConversationId && !canvasViewAccessId) return { contextFiles: [] };

  const sections = await Promise.all(items.map(async (item) => {
    try {
      return await resolveSection(item, auth);
    } catch (err) {
      const message = errMsg(err);
      return {
        header: `${labelForType(item.type)} "${item.title}" (id=${item.id})`,
        inlineText: `Unable to resolve attached context: ${message}`,
      } satisfies ResolvedContextSection;
    }
  }));

  // The Spaces thread the assistant was opened from arrives via
  // SPACES_CONVERSATION_ID (Session Metadata), NOT through the attachedContext
  // array — so it was never explained here. Fold it in as the FIRST section
  // (the user is most likely asking about it). Skip when it's a claw session id
  // rather than a Spaces conversation, or already covered by an attached item.
  if (
    threadConversationId &&
    !threadConversationId.startsWith("chat-") &&
    !threadConversationId.startsWith("scheduled_") &&
    !items.some((i) => i.threadId === threadConversationId)
  ) {
    try {
      sections.unshift(await resolveThreadSection(threadConversationId, auth));
    } catch (err) {
      const message = errMsg(err);
      sections.unshift({
        header: `Spaces thread (conversationId=${threadConversationId})`,
        inlineText: `Unable to resolve thread: ${message}. Read it with \`spaces-messages\` (conversationId=${threadConversationId}).`,
      });
    }
  }

  // The canvas the assistant was opened from (with an optional selected section
  // quoted in the query) arrives as SPACES_CANVAS_VIEW_ACCESS_ID — free text in
  // the query otherwise, never explained. Fold it in as the FIRST section so
  // the agent reads the full canvas before explaining a quoted snippet.
  if (canvasViewAccessId) {
    try {
      sections.unshift(await resolveCanvasByViewAccessSection(canvasViewAccessId, auth));
    } catch (err) {
      const message = errMsg(err);
      sections.unshift({
        header: `Canvas (viewAccessId=${canvasViewAccessId})`,
        inlineText: `Unable to resolve canvas: ${message}. Read it with \`spaces-read-canvas\` (viewAccessId=${canvasViewAccessId}).`,
      });
    }
  }

  const lines: string[] = [
    "# Attached context",
    "",
    "I have attached the following item(s) with my message:",
  ];
  const contextFiles: ContextFile[] = [];

  for (const section of sections) {
    lines.push("", `## ${section.header}`);
    if (section.file) {
      contextFiles.push(section.file);
      lines.push(`Context written to \`${section.file.path}\` (${section.fileCharCount ?? section.file.content.length} chars).`);
      lines.push("Use the Read tool to access it.");
      continue;
    }
    if (section.inlineText && section.inlineText.trim()) {
      lines.push(section.inlineText.trim());
      continue;
    }
    lines.push("No additional data available.");
  }

  // A recording's Ask AI attaches the call plus up to two canvases that read as
  // interchangeable documents unless the difference is spelled out. State how to
  // rank them — and only when such items are actually attached, so ordinary chats
  // don't carry instructions about documents they don't have.
  const hasCallItem = sections.some((section) => section.header.startsWith("Call "));
  const hasNotesCanvas = items.some((item) => item.canvasRole === "call-notes");
  const hasSummaryCanvas = items.some((item) => item.canvasRole === "call-summary");
  const callGuidance: string[] = [];
  if (hasNotesCanvas || hasSummaryCanvas) {
    callGuidance.push(
      "",
      "**How to weigh the attached call material** — these are three different kinds of evidence, not three copies of the same thing:",
      ...(hasCallItem
        ? [
            "- The **transcript** (via the call above) is the verbatim record of what was actually said. It is the source of truth: when the documents and the transcript disagree, the transcript wins, and anything load-bearing gets checked against it.",
          ]
        : []),
      ...(hasNotesCanvas
        ? [
            "- **My notes** are human-written and tell you what I cared about and how I framed it — follow my wording and priorities. They are deliberately partial, so never read a gap in them as \"this didn't happen\".",
          ]
        : []),
      ...(hasSummaryCanvas
        ? [
            "- The **AI summary** is machine-generated and is orientation only. Treat it as a lead to verify, never as a citable fact on its own.",
          ]
        : []),
      "- Read them together before answering. If my notes and the AI summary conflict, say so plainly and resolve it from the transcript rather than silently picking one.",
    );
  }

  // Single consolidated guidance block. Kept AFTER the item list so the model
  // reads "here is what's attached" then "here is how to use it", right before
  // the "## Query" that claw appends.
  lines.push(
    "",
    "---",
    "Refer to these attached item(s) to answer my query. The details above are only a stub — fetch fresh data with each item's noted `spaces-*` / `kb-*` tools before answering, and ground your answer in all of them.",
    ...callGuidance,
    ...(callGuidance.length > 0 ? [""] : []),
    "- If my message isn't really a question (just a greeting or small talk), reply normally instead of forcing it onto the attached items.",
    "- If the query is vague, don't guess — search broad: fan out several queries across the org, then converge on the single best-quality answer.",
    "- If anything is ambiguous or you're unsure, ask me before assuming.",
    "- Never state unverified information. When your answer draws on org data, back each claim with an inline citation token — and never repeat the same token more than once.",
  );

  return {
    promptPrefix: lines.join("\n"),
    contextFiles,
  };
}

async function searchChannels(q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const where: Record<string, unknown> = {};
  if (q) where["name"] = { contains: q, mode: "insensitive" };

  const rows = (await interact({
    model: "channel",
    operation: "findMany",
    where,
    orderBy: [{ lastActivityAt: "desc" }],
    take: limit,
  }, auth)) as ChannelRow[];

  return (rows ?? []).map((row) => ({
    id: row.id,
    type: "channel",
    title: `#${row.name}`,
    subtitle: [row.scopeType, row.visibility, typeof row.participantCount === "number" ? `${row.participantCount} members` : undefined]
      .filter((v): v is string => Boolean(v))
      .join(" · "),
    ...((row.lastActivityAt || row.conversationId) ? { meta: {
      ...(row.lastActivityAt ? { lastActivityAt: row.lastActivityAt } : {}),
      ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    } } : {}),
  }));
}

async function searchRepositories(q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const response = await spacesFetch(
    `/api/sdlc/repositories/context?${params.toString()}`,
    undefined,
    auth,
  ) as {
    success?: boolean;
    contexts?: Array<{ repoId?: string; name?: string; url?: string; baseBranch?: string }>;
  };

  if (!response.success || !Array.isArray(response.contexts)) {
    throw new Error("Spaces returned an invalid SDLC repository list");
  }

  return response.contexts.flatMap((repo) => {
    if (!repo.repoId || !repo.name || !repo.url || !repo.baseBranch) return [];
    return [{
      id: repo.repoId,
      type: "repository" as const,
      title: repo.name,
      subtitle: `${repo.baseBranch} · ${repo.url}`,
      meta: { url: repo.url, baseBranch: repo.baseBranch },
    }];
  });
}

async function searchTickets(q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const where: Record<string, unknown> = {};
  if (q) {
    where["OR"] = [
      { title: { contains: q, mode: "insensitive" } },
      { xyneId: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = (await interact({
    model: "ticket",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  }, auth)) as TicketRow[];

  return (rows ?? []).map((row) => ({
    id: row.id,
    type: "ticket",
    title: row.xyneId ? `${row.xyneId} — ${row.title}` : row.title,
    subtitle: [row.priority, row.statusV2, row.stageName].filter((v): v is string => Boolean(v)).join(" · "),
    ...(row.conversationId ? { meta: { conversationId: row.conversationId } } : {}),
  }));
}

async function searchCanvases(q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const where: Record<string, unknown> = {};
  if (q) where["title"] = { contains: q, mode: "insensitive" };

  const rows = (await interact({
    model: "canvas",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  }, auth)) as CanvasRow[];

  return (rows ?? []).map((row) => ({
    id: row.id,
    type: "canvas",
    title: row.title,
    subtitle: [row.docType ?? "Canvas", row.visibility].filter((v): v is string => Boolean(v)).join(" · "),
  }));
}

async function searchCalls(q: string, limit: number, auth?: SpacesAuthContext): Promise<ContextItem[]> {
  const where: Record<string, unknown> = {};
  if (q) where["title"] = { contains: q, mode: "insensitive" };

  const rows = (await interact({
    model: "call",
    operation: "findMany",
    where,
    orderBy: [{ lastActivityAt: "desc" }],
    take: limit,
  }, auth)) as CallRow[];

  const callRows = rows ?? [];
  const channelIds = [...new Set(callRows.map((r) => r.channelId).filter((v): v is string => typeof v === "string" && v.length > 0))];
  const callIds = callRows.map((r) => r.id);

  let channelNameById = new Map<string, string>();
  if (channelIds.length > 0) {
    const channels = (await interact({
      model: "channel",
      operation: "findMany",
      where: { id: { in: channelIds } },
      take: Math.max(channelIds.length, 20),
      select: { id: true, name: true },
    }, auth)) as Array<{ id: string; name?: string }>;
    channelNameById = new Map((channels ?? []).map((c) => [c.id, c.name ?? ""]));
  }

  let conversationIdByCallId = new Map<string, string>();
  if (callIds.length > 0) {
    const conversations = (await interact({
      model: "conversation",
      operation: "findMany",
      where: { callId: { in: callIds } },
      orderBy: [{ lastActivityAt: "desc" }],
      take: Math.max(callIds.length * 2, 20),
      select: { callId: true, conversationId: true },
    }, auth)) as ConversationRow[];
    for (const row of conversations ?? []) {
      if (!row.callId || !row.conversationId) continue;
      if (!conversationIdByCallId.has(row.callId)) conversationIdByCallId.set(row.callId, row.conversationId);
    }
  }

  return callRows.map((row) => {
    const channelName = row.channelId ? channelNameById.get(row.channelId) : undefined;
    const fallbackTitle = channelName
      ? `Call in #${channelName}`
      : row.description?.trim()
        ? truncate(row.description.trim(), 80)
        : "(untitled call)";
    return {
      id: row.id,
      type: "call" as const,
      title: row.title?.trim() || fallbackTitle,
      subtitle: [
        row.status,
        row.callType,
        channelName ? `#${channelName}` : undefined,
        row.startsAt ? formatDate(row.startsAt) : undefined,
      ].filter((v): v is string => Boolean(v)).join(" · "),
      ...((row.channelId || conversationIdByCallId.get(row.id)) ? {
        meta: {
          ...(row.channelId ? { channelId: row.channelId } : {}),
          ...(conversationIdByCallId.get(row.id) ? { conversationId: conversationIdByCallId.get(row.id) } : {}),
        },
      } : {}),
    };
  });
}

async function resolveSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  if (item.type === "channel") return resolveChannelSection(item, auth);
  if (item.type === "ticket") return resolveTicketSection(item, auth);
  if (item.type === "canvas") return resolveCanvasSection(item, auth);
  if (item.type === "activity") return resolveActivitySection(item);
  if (item.type === "collection") return resolveCollectionSection(item);
  if (item.type === "file") return resolveFileSection(item);
  if (item.type === "folder") return resolveFolderSection(item);
  return resolveCallSection(item, auth);
}

/** Knowledge Base collection attached from the ask-ai v2 picker.
 *  We don't try to inline the file list — the kb-list-files tool gives the
 *  agent live results and gates by the agent's KB scope. We just point the
 *  agent at the right tool and id. */
async function resolveCollectionSection(item: AttachedContextRef): Promise<ResolvedContextSection> {
  const header = `Collection "${item.title}" (id=${item.id})`;
  const lines = [
    `Collection: ${item.title} (collectionId=${item.id})`,
    `Fetch: enumerate files with \`kb-list-files\` (collectionId=${item.id}); find one with \`kb-search\` (collectionId=${item.id} + query); read a file with \`kb-read-file\` (fileId from kb-list-files).`,
  ];
  return { header, inlineText: lines.join("\n") };
}

/** Knowledge Base file attached from the ask-ai v2 picker.
 *  The `id` is the CollectionItem.id (cuid) — the same identifier the
 *  agent's kb-read-file tool expects. */
async function resolveFileSection(item: AttachedContextRef): Promise<ResolvedContextSection> {
  const header = `File "${item.title}" (id=${item.id})`;
  const lines = [
    `File: ${item.title} (fileId=${item.id})`,
    `Fetch: read its full content with \`kb-read-file\` (fileId=${item.id}).`,
  ];
  return { header, inlineText: lines.join("\n") };
}

/** Knowledge Base folder (a non-root collection node) attached from the
 *  ask-ai v2 picker. Same shape as resolveCollectionSection — the `id` works
 *  as a `collectionId` arg to kb-list-files/kb-search/kb-read-file exactly
 *  like a root collection id does, since folders are collection-tree nodes
 *  too. buildVespaScope (kb-handlers.ts) is what actually handles the
 *  root-vs-folder distinction when kb-search turns this into a Vespa filter
 *  — Vespa's collectionId filter only ever matches a doc's ROOT collection,
 *  so a folder id there expands to explicit docIds instead. */
async function resolveFolderSection(item: AttachedContextRef): Promise<ResolvedContextSection> {
  const header = `Folder "${item.title}" (id=${item.id})`;
  const lines = [
    `Folder: ${item.title} (collectionId=${item.id})`,
    `Fetch: enumerate files with \`kb-list-files\` (collectionId=${item.id}); find one with \`kb-search\` (collectionId=${item.id} + query); read a file with \`kb-read-file\` (fileId from kb-list-files).`,
  ];
  return { header, inlineText: lines.join("\n") };
}

async function resolveActivitySection(item: AttachedContextRef): Promise<ResolvedContextSection> {
  const lines: string[] = [
    `Activity: ${item.eventName || item.title}`,
    `Category: ${item.eventCategory || "N/A"}`,
    ...(item.timestamp ? [`Timestamp: ${item.timestamp}`] : []),
  ];

  if (item.metadata && Object.keys(item.metadata).length > 0) {
    lines.push("", "Metadata:");
    lines.push(JSON.stringify(item.metadata, null, 2));
  }

  if (item.relatedData && Object.keys(item.relatedData).length > 0) {
    lines.push("", "Related Data:");
    lines.push(JSON.stringify(item.relatedData, null, 2));
  }

  return { header: `Activity "${item.title}"`, inlineText: lines.join("\n") };
}

/** A Spaces thread/conversation the user opened the assistant from. It arrives
 *  as agentConfig.SPACES_CONVERSATION_ID (NOT via the attachedContext array),
 *  so it's resolved here and folded into the same "# Attached context" block. */
async function resolveThreadSection(conversationId: string, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const header = `Spaces thread (conversationId=${conversationId})`;
  const rows = (await interact({
    model: "message",
    operation: "findMany",
    where: {
      conversationId: { equals: conversationId },
      isDeleted: { equals: false },
    },
    orderBy: [{ createdAt: "desc" }],
    take: TICKET_MESSAGE_LIMIT,
  }, auth)) as MessageRow[];
  const recent = (rows ?? []).slice().reverse();

  const lines = [
    "This is the Spaces thread the user opened the assistant from — the query is most likely about this discussion.",
    `Fetch: read the full thread with \`spaces-messages\` (conversationId=${conversationId}); use \`spaces-message-detail\` (messageId) for a single message's reactions/attachments.`,
  ];
  if (recent.length > 0) {
    lines.push("", "Recent messages:");
    for (const message of recent) {
      lines.push(`- [${formatDate(message.createdAt)}] ${message.senderId ?? "unknown"}: ${truncate(message.content ?? "", 280)}`);
    }
  }
  return { header, inlineText: lines.join("\n") };
}

async function resolveChannelSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const channelRows = (await interact({
    model: "channel",
    operation: "findMany",
    where: { id: { equals: item.id } },
    take: 1,
  }, auth)) as ChannelRow[];

  const channel = channelRows[0];
  const header = `Channel "${item.title}" (id=${item.id})`;
  if (!channel) {
    return { header, inlineText: "Channel is not accessible or no longer exists." };
  }
  const threadId = item.threadId ?? channel.conversationId;
  const lines = [
    `Channel: #${channel.name} (channelId=${item.id})`,
    `Scope: ${channel.scopeType ?? "UNKNOWN"} · Visibility: ${channel.visibility ?? "UNKNOWN"} · Participants: ${typeof channel.participantCount === "number" ? channel.participantCount : "unknown"}`,
    ...(threadId ? [`Thread conversationId: ${threadId}`] : []),
    `Fetch: search inside it with \`spaces-search\` (in=${item.id}); ${threadId ? `read the thread with \`spaces-messages\` (conversationId=${threadId})` : `use \`spaces-activity\` (channelId=${item.id}) to find a conversationId, then \`spaces-messages\``}; \`spaces-channels\` for metadata.`,
  ];
  return { header, inlineText: lines.join("\n") };
}

async function resolveTicketSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const ticketRows = (await interact({
    model: "ticket",
    operation: "findMany",
    where: { id: { equals: item.id } },
    orderBy: [{ updatedAt: "desc" }],
    take: 1,
  }, auth)) as TicketRow[];

  const ticket = ticketRows[0];
  const header = `Ticket "${item.title}" (id=${item.id})`;
  if (!ticket) {
    return { header, inlineText: "Ticket is not accessible or no longer exists." };
  }

  const ticketLines = [
    `Ticket: ${ticket.xyneId ? `${ticket.xyneId} — ` : ""}${ticket.title}`,
    `Priority: ${ticket.priority ?? "UNKNOWN"} · Status: ${ticket.statusV2 ?? "UNKNOWN"}${ticket.stageName ? ` · Stage: ${ticket.stageName}` : ""}`,
    ticket.updatedAt ? `Updated: ${formatDate(ticket.updatedAt)}` : undefined,
    "",
    "Description:",
    ticket.description?.trim() ? ticket.description.trim() : "(no description)",
  ].filter((v): v is string => typeof v === "string");

  if (ticket.conversationId) {
    const rows = (await interact({
      model: "message",
      operation: "findMany",
      where: {
        conversationId: { equals: ticket.conversationId },
        isDeleted: { equals: false },
      },
      orderBy: [{ createdAt: "desc" }],
      take: TICKET_MESSAGE_LIMIT,
    }, auth)) as MessageRow[];
    const recent = (rows ?? []).slice().reverse();
    ticketLines.push("", "Recent activity:");
    if (recent.length === 0) {
      ticketLines.push("- No recent activity found.");
    } else {
      for (const message of recent) {
        ticketLines.push(`- [${formatDate(message.createdAt)}] ${message.senderId ?? "unknown"}: ${truncate(message.content ?? "", 280)}`);
      }
    }
  } else {
    ticketLines.push("", "Recent activity:", "- No linked conversation found.");
  }

  return inlineOrFile(header, ticketLines.join("\n"), "ticket", item.id);
}

/** The canvas the assistant was opened from, keyed by viewAccessId (the id in
 *  the /chat/canvas/<viewAccessId> URL — the same id spaces-read-canvas takes).
 *  Title lookup is best-effort (view-link-only access may not resolve via the
 *  PG gateway); the fetch hint works regardless since spaces-read-canvas honors
 *  view access. */
async function resolveCanvasByViewAccessSection(viewAccessId: string, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const rows = (await interact({
    model: "canvas",
    operation: "findMany",
    where: { viewAccessId: { equals: viewAccessId } },
    take: 1,
  }, auth)) as CanvasRow[];
  const title = rows[0]?.title;
  const header = title
    ? `Canvas "${title}" (viewAccessId=${viewAccessId})`
    : `Canvas (viewAccessId=${viewAccessId})`;
  const inlineText = [
    "This is the canvas the user opened the assistant from — the query may be about a specific section quoted from it (look for a `from canvas(...)` block in the query).",
    `Fetch: read the full markdown with \`spaces-read-canvas\` (viewAccessId=${viewAccessId}) before answering, so you can explain any quoted section in its full context.`,
  ].join("\n");
  return { header, inlineText };
}

async function resolveCanvasSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const rows = (await interact({
    model: "canvas",
    operation: "findMany",
    where: { id: { equals: item.id } },
    take: 1,
  }, auth)) as CanvasRow[];
  const row = rows[0];

  const title = row?.title ?? item.title;
  // Label the role in the header too — the model scans headers first, and
  // "Canvas" alone would make the AI summary and the user's notes look
  // interchangeable when a recording attaches both.
  const roleLabel =
    item.canvasRole === "call-notes"
      ? "My notes"
      : item.canvasRole === "call-summary"
        ? "AI summary"
        : "Canvas";
  const header = `${roleLabel} "${title}" (id=${item.id})`;
  const roleLine =
    item.canvasRole === "call-notes"
      ? "What this is: MY OWN notes, typed by me during the call. Human-written and authoritative about what I " +
        "considered important, but partial by nature — shorthand, half-sentences, and gaps where I stopped typing. " +
        "Absence of something here does NOT mean it wasn't discussed; check the transcript before concluding that."
      : item.canvasRole === "call-summary"
        ? "What this is: an AI-GENERATED summary of the call, not written by a human. Useful for orientation, but it " +
          "can compress, omit, or get details wrong — verify anything load-bearing against the transcript before " +
          "repeating it as fact."
        : null;
  const inlineText = [
    `Canvas: ${title} (id=${item.id})`,
    ...(roleLine ? [roleLine] : []),
    `Fetch: read its full content with \`spaces-read-canvas\` (id=${item.id}).`,
  ].join("\n");
  return { header, inlineText };
}

async function resolveCallSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const callRows = (await interact({
    model: "call",
    operation: "findMany",
    where: { id: { equals: item.id } },
    take: 1,
  }, auth)) as CallRow[];
  const call = callRows[0];
  const header = `Call "${item.title}" (id=${item.id})`;
  if (!call) {
    return { header, inlineText: "Call is not accessible or no longer exists." };
  }

  const conversations = (await interact({
    model: "conversation",
    operation: "findMany",
    where: { callId: { equals: item.id } },
    orderBy: [{ lastActivityAt: "desc" }],
    take: 1,
  }, auth)) as ConversationRow[];

  const threadId = item.threadId ?? conversations[0]?.conversationId;
  const callSearch = (call.title?.trim() || item.title).replace(/"/g, "'");
  const lines = [
    `Call: ${call.title?.trim() || "(untitled call)"} (id=${item.id})`,
    `Status: ${call.status ?? "UNKNOWN"} · Type: ${call.callType ?? "UNKNOWN"}${call.channelId ? ` · channelId=${call.channelId}` : ""}`,
    ...(threadId ? [`Thread conversationId: ${threadId}`] : []),
    ...(call.startsAt ? [`Starts: ${formatDate(call.startsAt)}`] : []),
    ...(call.endsAt ? [`Ends: ${formatDate(call.endsAt)}`] : []),
    `Fetch: the FULL transcript with \`spaces-calls\` (callId=${item.id}, includeTranscript=true); search across calls with \`spaces-meeting-insights\`; metadata/participants with \`spaces-calls\` (${call.channelId ? `channelId=${call.channelId}, ` : ""}search="${callSearch}")${threadId ? `; read the call thread with \`spaces-messages\` (conversationId=${threadId})` : ""}.`,
  ];
  return { header, inlineText: lines.join("\n") };
}

function inlineOrFile(header: string, content: string, type: ContextType, id: string): ResolvedContextSection {
  if (content.length <= INLINE_THRESHOLD) {
    return { header, inlineText: content };
  }
  const file = toContextFile(type, id, content);
  return { header, file, fileCharCount: content.length };
}

function toContextFile(type: ContextType, id: string, content: string): ContextFile {
  const dir = dirForType(type);
  const safeId = sanitizeId(id);
  return {
    path: `.context/${dir}/${safeId}.md`,
    content,
  };
}

function dirForType(type: ContextType): string {
  if (type === "channel") return "channels";
  if (type === "ticket") return "tickets";
  if (type === "canvas") return "canvases";
  return "calls";
}

function sanitizeId(input: string): string {
  const out = input.replace(/[^a-zA-Z0-9._-]/g, "_");
  return out.length > 0 ? out.slice(0, 120) : "item";
}

function formatDate(value?: string): string {
  if (!value) return "unknown time";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  let index = 0;
  while (out.length < limit) {
    let pushed = false;
    for (const list of lists) {
      if (index < list.length) {
        out.push(list[index]!);
        pushed = true;
        if (out.length >= limit) break;
      }
    }
    if (!pushed) break;
    index += 1;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isContextType(value: unknown): value is ContextType {
  return (
    value === "channel" ||
    value === "ticket" ||
    value === "canvas" ||
    value === "call" ||
    value === "activity" ||
    value === "collection" ||
    value === "file" ||
    value === "folder"
  );
}

function labelForType(type: ContextType): string {
  if (type === "channel") return "Channel";
  if (type === "ticket") return "Ticket";
  if (type === "canvas") return "Canvas";
  if (type === "activity") return "Activity";
  if (type === "collection") return "Collection";
  if (type === "file") return "File";
  if (type === "folder") return "Folder";
  return "Call";
}
