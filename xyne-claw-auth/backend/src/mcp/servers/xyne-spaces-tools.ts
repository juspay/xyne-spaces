/**
 * Xyne Spaces MCP tool definitions.
 *
 * Each tool has a name, description, JSON Schema inputSchema, and async handler.
 * Handlers call the Spaces HTTP client and return MCP-formatted results.
 */

import { interact, search, memorySearch, spacesFetch, CURRENT_USER_ID } from "./xyne-spaces-client.js";
import type { Citation } from "xyne-claw-shared";

// ── Types ────────────────────────────────────────────────────────────

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  /** MCP `_meta` field — out-of-band metadata callers can read. We use it
   *  to propagate structured citations from tools through the MCP transport
   *  to xyne-claw's invocation record (see Tier 1 design). */
  _meta?: { citations?: Citation[]; [k: string]: unknown };
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function okCited(text: string, citations: Citation[]): ToolResult {
  return citations.length > 0
    ? { content: [{ type: "text", text }], _meta: { citations } }
    : { content: [{ type: "text", text }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Push a thread citation `(channelId, conversationId)` into `out`, deduping
 * by the composite key. Used by every tool that surfaces messages, tickets,
 * search hits, or activity entries with both IDs available.
 */
function pushThreadCitation(
  out: Citation[],
  seen: Set<string>,
  channelId: string | undefined | null,
  conversationId: string | undefined | null,
  label?: string,
): void {
  if (!channelId || !conversationId) return;
  const key = `${channelId}/${conversationId}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind: "thread", channelId, conversationId, ...(label ? { label } : {}) });
}

function pushCanvasCitation(out: Citation[], seen: Set<string>, viewAccessId: string | undefined | null, label?: string): void {
  if (!viewAccessId || seen.has(`canvas/${viewAccessId}`)) return;
  seen.add(`canvas/${viewAccessId}`);
  out.push({ kind: "canvas", viewAccessId, ...(label ? { label } : {}) });
}

/**
 * Single-query batch resolver: takes a list of channelIds and returns a
 * Map<channelId, { name, scopeType }>. Used by tools that emit thread
 * citations to enrich them with display name + channel type so the
 * citation block renders as e.g. "Ticket XYNE-123 in #testing-claw (TICKET)"
 * instead of an opaque "Spaces thread".
 */
async function resolveChannelInfo(channelIds: Iterable<string>): Promise<Map<string, { name?: string; scopeType?: string }>> {
  const ids = [...new Set(Array.from(channelIds).filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows = (await interact({
      model: "channel",
      operation: "findMany",
      where: { id: { in: ids } },
      take: ids.length,
    })) as Array<{ id: string; name?: string; scopeType?: string }>;
    const out = new Map<string, { name?: string; scopeType?: string }>();
    for (const r of rows) {
      out.set(r.id, { ...(r.name ? { name: r.name } : {}), ...(r.scopeType ? { scopeType: r.scopeType } : {}) });
    }
    return out;
  } catch {
    // Non-fatal — citations still work without channel display info.
    return new Map();
  }
}

function applyChannelInfo(citations: Citation[], info: Map<string, { name?: string; scopeType?: string }>): void {
  for (const c of citations) {
    if (c.kind !== "thread" || !c.channelId) continue;
    const meta = info.get(c.channelId);
    if (!meta) continue;
    if (meta.name && !c.channelName) c.channelName = meta.name;
    if (meta.scopeType && !c.channelType) c.channelType = meta.scopeType;
  }
}

// ── spaces-search ────────────────────────────────────────────────────

const spacesSearch: ToolDef = {
  name: "spaces-search",
  description:
    "Fast Vespa-powered search across all connected apps in Spaces — messages, tickets, files, channels, users. " +
    "This is much faster than reading individual conversations. Use this when looking for specific topics, keywords, or people. " +
    "IMPORTANT: For ticket-related queries (ticket status, ticket list, ticket details, finding tickets by label/tag/assignee), " +
    "ALWAYS use spaces-tickets instead — it has richer filters and returns structured ticket data. " +
    "Only use spaces-search for tickets when doing free-text keyword search across ticket content.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text. Can be empty if filterOnly is true." },
      apps: { type: "string", description: "Comma-separated apps to search: chat, ticket, user, file (default: all)" },
      type: { type: "string", description: "Filter by type: messages, attachments, channels, tickets, files" },
      from: { type: "string", description: "Filter by sender user ID(s), comma-separated" },
      in: { type: "string", description: "Filter by channel ID(s), comma-separated" },
      status: { type: "string", description: "Filter by ticket status(es), comma-separated" },
      priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "CRITICAL"], description: "Filter by ticket priority" },
      board: { type: "string", description: "Filter by board name" },
      tags: { type: "string", description: "Filter by tags, comma-separated" },
      stage: { type: "string", description: "Filter by ticket stage" },
      assignee: { type: "string", description: "Filter by assigned user ID" },
      before: { type: "string", description: "Created before date (e.g. '15 Mar 26' or ISO format)" },
      after: { type: "string", description: "Created after date" },
      range: { type: "string", description: "Time range: today, yesterday, this week, last 7 days, last 30 days" },
      filterOnly: { type: "boolean", description: "Set true to search with filters only, no query text required" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 10, description: "Max results per group (default 10)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0)" },
    },
    required: ["query"],
  },
  async handler(args) {
    try {
      const query = String(args["query"] ?? "").trim();
      if (!query && !args["filterOnly"]) return err("A search query is required. Set filterOnly=true to search by filters only.");
      const params: Record<string, string> = {};
      if (query) params["q"] = query;
      params["limit"] = String(args["limit"] ?? 10);
      if (args["offset"]) params["offset"] = String(args["offset"]);
      if (args["apps"]) params["apps"] = String(args["apps"]);
      if (args["type"]) params["type"] = String(args["type"]);
      if (args["from"]) params["from"] = String(args["from"]);
      if (args["in"]) params["in"] = String(args["in"]);
      if (args["status"]) params["status"] = String(args["status"]);
      if (args["priority"]) params["priority"] = String(args["priority"]);
      if (args["board"]) params["board"] = String(args["board"]);
      if (args["tags"]) params["tags"] = String(args["tags"]);
      if (args["stage"]) params["stage"] = String(args["stage"]);
      if (args["assignee"]) params["assignee"] = String(args["assignee"]);
      if (args["before"]) params["before"] = String(args["before"]);
      if (args["after"]) params["after"] = String(args["after"]);
      if (args["range"]) params["range"] = String(args["range"]);
      if (args["filterOnly"]) params["filterOnly"] = "true";

      console.log(args);

      const data = (await search(params)) as {
        success: boolean;
        data?: {
          grouped: boolean;
          groups?: Array<{ groupValue: string; count: number; results: Array<SearchResult> }>;
          results?: SearchResult[];
          totalCount?: number;
        };
      };

      if (!data.success || !data.data) return err("Search failed.");

      const citations: Citation[] = [];
      const seen = new Set<string>();
      const harvest = (r: SearchResult): void => {
        const sc = r.searchContext ?? {};
        const meta = r.metadata ?? {};
        const channelId = (sc["channelId"] as string | undefined) ?? (meta["channelId"] as string | undefined);
        const conversationId = (sc["conversationId"] as string | undefined) ?? (meta["conversationId"] as string | undefined);
        pushThreadCitation(citations, seen, channelId, conversationId, r.title || r.type);
      };

      if (data.data.grouped && data.data.groups) {
        const groups = data.data.groups;
        if (groups.length === 0) return ok(`No results found for "${args["query"]}".`);
        const parts: string[] = [];
        for (const group of groups) {
          parts.push(`--- ${group.groupValue} (${group.count}) ---`);
          for (const r of group.results) {
            parts.push(formatSearchResult(r));
            harvest(r);
          }
          parts.push("");
        }
        const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
        applyChannelInfo(citations, channelInfo);
        return okCited(parts.join("\n"), citations);
      }

      const results = data.data.results ?? [];
      if (results.length === 0) return ok(`No results found for "${args["query"]}".`);
      for (const r of results) harvest(r);
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);
      return okCited(
        `Found ${data.data.totalCount ?? results.length} result(s):\n\n${results.map(formatSearchResult).join("\n\n")}`,
        citations,
      );
    } catch (e) {
      return err(`Search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  context?: string;
  metadata?: Record<string, unknown>;
  searchContext?: Record<string, unknown>;
}

function formatSearchResult(r: SearchResult): string {
  const lines = [`[${r.type}] ${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`];
  if (r.context && typeof r.context === "string") lines.push(`  ${r.context.replace(/<\/?[^>]+>/g, "").slice(0, 300)}`);
  const meta = r.metadata;
  if (meta) {
    const p: string[] = [];
    if (meta["timestamp"]) p.push(`${meta["timestamp"]}`);
    if (meta["channelName"]) p.push(`#${meta["channelName"]}`);
    if (meta["status"]) p.push(`status: ${meta["status"]}`);
    if (p.length > 0) lines.push(`  ${p.join(" · ")}`);
  }
  const sc = r.searchContext;
  if (sc) {
    if (sc["senderName"]) lines.push(`  From: ${sc["senderName"]}`);
    if (sc["xyneId"]) lines.push(`  ID: ${sc["xyneId"]}`);
    if (sc["conversationId"]) lines.push(`  conversationId: ${sc["conversationId"]}`);
    if (sc["channelId"]) lines.push(`  channelId: ${sc["channelId"]}`);
  }
  if (meta) {
    if (meta["conversationId"]) lines.push(`  conversationId: ${meta["conversationId"]}`);
    if (meta["channelId"]) lines.push(`  channelId: ${meta["channelId"]}`);
  }
  return lines.join("\n");
}

// ── spaces-memory-search ─────────────────────────────────────────────

const spacesMemorySearch: ToolDef = {
  name: "spaces-memory-search",
  description: "Search Spaces memory — facts, SOPs, and knowledge base entries from past sessions.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (leave empty to list recent)" },
      scope: { type: "string", enum: ["my", "all"], default: "my", description: "'my' for your items, 'all' for team-wide" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 10, description: "Max results" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      docType: { type: "string", enum: ["fact", "sop"], description: "Filter by type" },
      tags: { type: "array", items: { type: "string" }, description: "Filter by tags" },
      reviewStatus: { type: "string", enum: ["pending", "verified", "rejected"], description: "Filter by review status" },
    },
  },
  async handler(args) {
    try {
      const body: Record<string, unknown> = {
        scope: args["scope"] ?? "my",
        limit: args["limit"] ?? 10,
        offset: args["offset"] ?? 0,
        includeSummary: true,
        includeQuery: true,
        reviewStatus: "verified",
      };
      if (args["query"]) body["query"] = args["query"];
      if (args["docType"]) body["docType"] = args["docType"];
      if (args["tags"]) body["tags"] = args["tags"];

      const data = (await memorySearch(body)) as {
        success?: boolean;
        data?: {
          documents?: Array<{
            docId: string;
            docType: string;
            userQuery?: string;
            chatSummary?: string[];
            rawContent?: string;
            tags?: string[];
            reviewStatus?: string;
          }>;
          pagination?: { total: number };
        };
      };

      const docs = data.data?.documents ?? [];
      if (docs.length === 0) return ok(args["query"] ? `No memory results for "${args["query"]}".` : "No memory entries found.");

      const parts = docs.map((d) => {
        const lines = [`[${d.docType}] ${d.docId}`];
        if (d.userQuery) lines.push(`  Query: ${d.userQuery}`);
        if (d.chatSummary?.length) lines.push(`  Summary: ${d.chatSummary.join(" ")}`);
        else if (d.rawContent) lines.push(`  ${d.rawContent.slice(0, 300)}${d.rawContent.length > 300 ? "..." : ""}`);
        if (d.tags?.length) lines.push(`  Tags: ${d.tags.join(", ")}`);
        if (d.reviewStatus) lines.push(`  Review: ${d.reviewStatus}`);
        return lines.join("\n");
      });
      return ok(`Found ${data.data?.pagination?.total ?? docs.length} result(s):\n\n${parts.join("\n\n")}`);
    } catch (e) {
      return err(`Memory search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-memory-create ────────────────────────────────────────────

const spacesMemoryCreate: ToolDef = {
  name: "spaces-memory-create",
  description:
    "Save a fact or SOP to the Spaces knowledge base. Use this to store important information, " +
    "learnings, decisions, or standard operating procedures that should be remembered for future reference.",
  inputSchema: {
    type: "object",
    properties: {
      docType: { type: "string", enum: ["fact", "sop"], description: "Type: 'fact' for individual facts/decisions, 'sop' for standard operating procedures" },
      content: { type: "string", description: "The content to store — the fact, decision, procedure, or knowledge to remember" },
      query: { type: "string", description: "A short summary or question this knowledge answers (used for search retrieval)" },
      tags: { type: "array", items: { type: "string" }, description: "Tags for categorization (e.g. ['deployment', 'auth', 'runbook'])" },
    },
    required: ["docType", "content"],
  },
  async handler(args) {
    try {
      const docType = args["docType"] as string;
      const content = args["content"] as string;
      const query = (args["query"] as string | undefined) ?? "";
      const tags = (args["tags"] as string[] | undefined) ?? [];
      const docId = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const document = {
        docId,
        docType,
        userId: CURRENT_USER_ID,
        sessionId: `manual-${docId}`,
        userQuery: query,
        chatSummary: [query || content.slice(0, 200)],
        rawContent: content,
        tags,
        filePointers: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentUsed: "xyne-claw",
        modelUsed: [],
        reviewStatus: "pending",
      };

      await spacesFetch("/api/memory/index", {
        method: "POST",
        body: JSON.stringify(document),
      });

      return ok(`Memory saved (${docType}): ${docId}\nQuery: ${query || "(none)"}\nTags: ${tags.length > 0 ? tags.join(", ") : "(none)"}\nContent: ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
    } catch (e) {
      return err(`Memory create error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-tickets ───────────────────────────────────────────────────

const spacesTickets: ToolDef = {
  name: "spaces-tickets",
  description:
    "PRIMARY tool for all ticket queries. ALWAYS use this when the user asks about tickets, ticket status, ticket lists, " +
    "or anything ticket-related. Filter by status, priority, assignee, board, project, tags, or stage. " +
    "Returns structured ticket details including assignee, tags, stage, and conversation ID. " +
    "Prefer this over spaces-search for ticket queries — it returns richer, more accurate data.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "Filter by status" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Filter by priority" },
      assignedTo: { type: "string", description: "Filter by assigned user's ID (defaults to current user)" },
      createdBy: { type: "string", description: "Filter by ticket creator's user ID" },
      boardId: { type: "string", description: "Filter by board ID" },
      projectId: { type: "string", description: "Filter by project ID" },
      stageName: { type: "string", description: "Filter by stage name" },
      tags: { type: "string", description: "Filter by tag name(s), comma-separated (e.g. 'April-Launch,Q2')" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max tickets (default 20)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const baseWhere: Record<string, unknown> = {};
      if (args["status"]) baseWhere["statusV2"] = { equals: args["status"] };
      if (args["priority"]) baseWhere["priority"] = { equals: args["priority"] };
      if (args["boardId"]) baseWhere["boardId"] = { equals: args["boardId"] };
      if (args["projectId"]) baseWhere["projectId"] = { equals: args["projectId"] };
      if (args["stageName"]) baseWhere["stageName"] = { equals: args["stageName"] };
      if (args["tags"]) {
        const tagNames = (args["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean);
        if (tagNames.length > 0) {
          baseWhere["tags"] = { some: { name: { in: tagNames } } };
        }
      }

      const take = (args["limit"] as number | undefined) ?? 20;
      const skip = (args["offset"] as number | undefined) ?? 0;
      const include = {
        assignedToUser: { select: { name: true } },
        createdByUser: { select: { name: true } },
        board: { select: { name: true } },
        project: { select: { name: true } },
        tags: { select: { name: true } },
      };

      const userId = args["assignedTo"] as string | undefined;

      // If we have a user to scope to, fetch both assigned + created and merge
      if (userId && !args["createdBy"]) {
        const [assigned, created] = await Promise.all([
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, assignedTo: { equals: userId } }, orderBy: [{ updatedAt: "desc" }], take, skip, include }) as Promise<TicketRow[]>,
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, createdBy: { equals: userId } }, orderBy: [{ updatedAt: "desc" }], take, skip, include }) as Promise<TicketRow[]>,
        ]);
        const seen = new Set<string>();
        const merged: TicketRow[] = [];
        for (const t of [...(assigned ?? []), ...(created ?? [])]) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
        }
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return await formatTickets(merged.slice(0, take));
      }

      // Explicit createdBy filter only
      if (args["createdBy"]) {
        baseWhere["createdBy"] = { equals: args["createdBy"] };
      }

      const rows = (await interact({ model: "ticket", operation: "findMany", where: baseWhere, orderBy: [{ updatedAt: "desc" }], take, skip, include })) as TicketRow[];
      return await formatTickets(rows);
    } catch (e) {
      return err(`Tickets error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

async function formatTickets(rows: TicketRow[]): Promise<ToolResult> {
  if (!rows || rows.length === 0) return ok("No tickets found.");
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const lines = rows.map((t) => {
    const parts = [`[${t.xyneId}] ${t.title}`];
    parts.push(`  Board Status: ${t.statusV2} (workflow state, not PR verification) · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`);
    if (t.assignedToUser) parts.push(`  Assigned: ${t.assignedToUser.name}`);
    if (t.createdByUser) parts.push(`  Created by: ${t.createdByUser.name}`);
    if (t.board) parts.push(`  Board: ${t.board.name}${t.project ? ` · Project: ${t.project.name}` : ""}`);
    if (t.tags && t.tags.length > 0) parts.push(`  Tags: ${t.tags.map((tg) => tg.name).join(", ")}`);
    if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`);
    if (t.channelId) parts.push(`  ChannelID: ${t.channelId}`);
    if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`);
    parts.push(`  Updated: ${new Date(t.updatedAt).toLocaleString()}`);
    pushThreadCitation(citations, seen, t.channelId, t.conversationId, `Ticket ${t.xyneId}`);
    return parts.join("\n");
  });
  const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
  applyChannelInfo(citations, channelInfo);
  return okCited(`${rows.length} ticket(s):\n\n${lines.join("\n\n")}`, citations);
}

interface TicketRow {
  id: string;
  title: string;
  xyneId: string;
  statusV2: string;
  priority: string;
  stageName?: string;
  eta?: string;
  createdAt: string;
  updatedAt: string;
  channelId?: string;
  conversationId?: string;
  assignedToUser?: { name: string } | null;
  createdByUser?: { name: string } | null;
  board?: { name: string } | null;
  project?: { name: string } | null;
  tags?: Array<{ name: string }>;
}

// ── spaces-messages ──────────────────────────────────────────────────

const spacesMessages: ToolDef = {
  name: "spaces-messages",
  description:
    "Read messages in a conversation thread. Use the conversationId field from spaces-tickets results (NOT the channel ID or ticket ID). " +
    "Messages are returned in chronological order.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "The conversationId from spaces-tickets or spaces-activity results." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 30, description: "Max messages (default 30)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"]);
      const rows = (await interact({
        model: "message",
        operation: "findMany",
        where: {
          conversationId: { equals: conversationId },
          isDeleted: { equals: false },
        },
        orderBy: [{ createdAt: "asc" }],
        take: (args["limit"] as number | undefined) ?? 30,
        skip: (args["offset"] as number | undefined) ?? 0,
        include: {
          sender: { select: { name: true } },
        },
      })) as MessageRow[];

      if (!rows || rows.length === 0) return ok(`No messages found in conversation ${conversationId}.`);

      const lines = rows.map((m) => {
        const sender = m.sender?.name ?? "unknown";
        const time = new Date(m.createdAt).toLocaleString();
        const attach = m.hasAttachment ? " [attachment]" : "";
        return `[${time}] ${sender}${attach}: ${m.content}`;
      });

      const context: string[] = [];
      const channelId = rows.find((m) => m.channelId)?.channelId;
      if (channelId) context.push(`channelId: ${channelId}`);
      context.push(`conversationId: ${conversationId}`);
      const header = context.length > 0 ? `${context.join(" · ")}\n\n` : "";

      const citations: Citation[] = [];
      const seen = new Set<string>();
      pushThreadCitation(citations, seen, channelId, conversationId, "Spaces thread");
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);

      return okCited(`${rows.length} message(s):\n\n${header}${lines.join("\n")}`, citations);
    } catch (e) {
      return err(`Messages error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface MessageRow {
  messageId: string;
  content: string;
  msgType: string;
  createdAt: string;
  hasAttachment: boolean;
  channelId?: string;
  conversationId?: string;
  sender?: { name: string } | null;
}

// ── spaces-message-detail ────────────────────────────────────────────

const spacesMessageDetail: ToolDef = {
  name: "spaces-message-detail",
  description:
    "Get detailed information about a specific message including full content, sender details, " +
    "reactions (with counts), and attachments. Use messageId from spaces-messages or spaces-activity results.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: { type: "string", description: "The messageId from spaces-messages or spaces-activity results." },
    },
    required: ["messageId"],
  },
  async handler(args) {
    try {
      const messageId = String(args["messageId"]);
      const rows = (await interact({
        model: "message",
        operation: "findMany",
        where: { messageId: { equals: messageId } },
        take: 1,
        include: {
          sender: { select: { name: true, email: true } },
          reactions: { select: { emojiName: true, userId: true } },
          reactionCounts: { select: { emojiName: true, count: true } },
        },
      })) as MessageDetailRow[];

      if (!rows || rows.length === 0) return ok(`Message ${messageId} not found.`);
      const m = rows[0]!;

      const parts = [
        `Message: ${m.messageId}`,
        `From: ${m.sender?.name ?? "unknown"} (${m.sender?.email ?? ""})`,
        `Type: ${m.msgType}${m.edited ? " (edited)" : ""}`,
        `Date: ${new Date(m.createdAt).toLocaleString()}`,
        ...(m.channelId ? [`channelId: ${m.channelId}`] : []),
        ...(m.conversationId ? [`conversationId: ${m.conversationId}`] : []),
        `\n${m.content}`,
      ];

      if (m.reactionCounts && m.reactionCounts.length > 0) {
        const rxns = m.reactionCounts.map((r) => `${r.emojiName} x${r.count}`).join("  ");
        parts.push(`\nReactions: ${rxns}`);
      }

      if (m.hasAttachment) {
        parts.push("\n[Has attachments]");
      }

      const citations: Citation[] = [];
      const seen = new Set<string>();
      pushThreadCitation(citations, seen, m.channelId, m.conversationId, `Message ${m.messageId}`);
      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);

      return okCited(parts.join("\n"), citations);
    } catch (e) {
      return err(`Message detail error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface MessageDetailRow {
  messageId: string;
  content: string;
  msgType: string;
  createdAt: string;
  edited: boolean;
  hasAttachment: boolean;
  channelId?: string;
  conversationId?: string;
  sender?: { name: string; email: string } | null;
  reactions?: Array<{ emojiName: string; userId: string }>;
  reactionCounts?: Array<{ emojiName: string; count: number }>;
}

interface AttachmentRow {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  url: string;
}

// ── spaces-channels ──────────────────────────────────────────────────

const spacesChannels: ToolDef = {
  name: "spaces-channels",
  description:
    "List channels in Spaces. Can filter by channel name, visibility (PUBLIC/PRIVATE), scope type (DEFAULT/DM/TICKET/GROUP_DM), " +
    "and participant name. Use the name filter to find a specific channel by name. " +
    "To find a DM between two people, use scopeType='DM' and participantName to filter by one of them. " +
    "Returns channel name, members, conversation ID, and last activity.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Filter by channel name (case-insensitive partial match). Use this to find a specific channel." },
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
      scopeType: { type: "string", enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"], description: "Filter by scope type" },
      participantName: { type: "string", description: "Filter channels by participant name (partial match)" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max channels (default 20)" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["name"]) where["name"] = { contains: args["name"] as string, mode: "insensitive" };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["scopeType"]) where["scopeType"] = { equals: args["scopeType"] };
      if (args["participantName"]) where["participants"] = { some: { user: { name: { contains: args["participantName"] as string } } } };

      const rows = (await interact({
        model: "channel",
        operation: "findMany",
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        include: {
          project: { select: { name: true } },
          participants: { select: { user: { select: { name: true } } } },
        },
      })) as ChannelRow[];

      if (!rows || rows.length === 0) return ok("No channels found.");

      const lines = rows.map((c) => {
        const parts = [`#${c.name} (${c.scopeType}, ${c.visibility})`];
        if (c.description) parts.push(`  ${c.description}`);
        const memberNames = (c as unknown as { participants?: Array<{ user?: { name?: string } }> }).participants
          ?.map((p) => p.user?.name).filter(Boolean) ?? [];
        if (memberNames.length > 0) parts.push(`  Members: ${memberNames.join(", ")}`);
        else parts.push(`  Participants: ${c.participantCount}`);
        if (c.project) parts.push(`  Project: ${c.project.name}`);
        if (c.lastActivityAt) parts.push(`  Last active: ${new Date(c.lastActivityAt).toLocaleString()}`);
        if (c.conversationId) parts.push(`  ConversationID: ${c.conversationId}`);
        parts.push(`  ID: ${c.id}`);
        return parts.join("\n");
      });

      return ok(`${rows.length} channel(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err(`Channels error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface ChannelRow {
  id: string;
  name: string;
  description?: string;
  type: string;
  scopeType: string;
  visibility: string;
  participantCount: number;
  lastActivityAt?: string;
  conversationId?: string;
  project?: { name: string } | null;
}

// ── spaces-users ─────────────────────────────────────────────────────

const spacesUsers: ToolDef = {
  name: "spaces-users",
  description: "Look up users by name or email. Returns user ID, name, email, and type.",
  inputSchema: {
    type: "object",
    properties: {
      nameOrEmail: { type: "string", description: "Person's name to search by name, or email address (with @ or .) to search by email" },
      limit: { type: "number", minimum: 1, maximum: 20, default: 10, description: "Max results (default 10)" },
    },
    required: ["nameOrEmail"],
  },
  async handler(args) {
    try {
      const nameOrEmail = String(args["nameOrEmail"]);
      const isEmail = nameOrEmail.includes("@") || nameOrEmail.includes(".");
      const where = isEmail
        ? { email: { contains: nameOrEmail }, status: { equals: "ACTIVE" } }
        : { name: { contains: nameOrEmail }, status: { equals: "ACTIVE" } };

      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where,
        take: (args["limit"] as number | undefined) ?? 10,
      })) as UserRow[];

      if (!rows || rows.length === 0) return ok(`No users found matching "${nameOrEmail}".`);

      const lines = rows.map((u) => `${u.name} (${u.email}) — ${u.userType}\n  ID: ${u.id}`);
      return ok(`${rows.length} user(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err(`Users error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
  userType: string;
}

// ── spaces-activity ──────────────────────────────────────────────────

const spacesActivity: ToolDef = {
  name: "spaces-activity",
  description:
    "Get your activity feed — mentions, replies, assignments, and notifications. " +
    "Returns messageId, conversationId, ticketId for each activity. " +
    "Use conversationId with spaces-messages to read the full thread, or messageId with spaces-message-detail.",
  inputSchema: {
    type: "object",
    properties: {
      classification: { type: "string", description: "Filter by classification (e.g. 'PENDING')" },
      unreadOnly: { type: "boolean", description: "Show only unread activity" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max entries (default 20)" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {
        userId: { equals: CURRENT_USER_ID },
      };
      if (args["classification"]) where["classification"] = { equals: args["classification"] };
      if (args["unreadOnly"] === true) where["isRead"] = { equals: false };

      const rows = (await interact({
        model: "activity",
        operation: "findMany",
        where,
        orderBy: [{ createdAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
      })) as UserActivityRow[];

      if (!rows || rows.length === 0) return ok("No activity found.");

      const citations: Citation[] = [];
      const seen = new Set<string>();
      const lines = rows.map((a) => {
        const when = new Date(a.createdAt).toLocaleString();
        const read = a.isRead ? "" : " (unread)";
        const refs: string[] = [];
        if (a.messageId) refs.push(`messageId: ${a.messageId}`);
        if (a.conversationId) refs.push(`conversationId: ${a.conversationId}`);
        if (a.ticketId) refs.push(`ticketId: ${a.ticketId}`);
        if (a.channelId) refs.push(`channelId: ${a.channelId}`);
        if (a.conversationId && a.channelId) {
          const key = `${a.channelId}/${a.conversationId}`;
          if (!seen.has(key)) {
            seen.add(key);
            citations.push({
              kind: "thread",
              channelId: a.channelId,
              conversationId: a.conversationId,
              ...(a.ticketId ? { label: `Ticket ${a.ticketId}` } : {}),
            });
          }
        }
        const refStr = refs.length > 0 ? `\n    ${refs.join(" · ")}` : "";
        return `[${when}] ${a.actorAction}${read}${a.classification ? ` · ${a.classification}` : ""}${refStr}`;
      });

      const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
      applyChannelInfo(citations, channelInfo);
      return okCited(`${rows.length} activity entries:\n\n${lines.join("\n")}`, citations);
    } catch (e) {
      return err(`Activity error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface UserActivityRow {
  id: string;
  actorAction: string;
  classification?: string;
  isRead: boolean;
  createdAt: string;
  channelId?: string;
  ticketId?: string;
  conversationId?: string;
  messageId?: string;
  actorId: string;
}

// ── spaces-projects ──────────────────────────────────────────────────

const spacesProjects: ToolDef = {
  name: "spaces-projects",
  description:
    "Search and list projects to find project IDs for creating tickets. " +
    "Can filter by name with pagination support.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by project name (partial match)" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["name"] = { contains: args["search"] };

      const rows = (await interact({
        model: "project",
        operation: "findMany",
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as ProjectRow[];

      if (!rows || rows.length === 0) return ok(args["search"] ? `No projects found matching "${args["search"]}".` : "No projects found.");

      const lines = rows.map((p) => {
        const parts = [p.name];
        if (p.description) parts.push(`  ${p.description}`);
        parts.push(`  ID: ${p.id}`);
        if (p.updatedAt) parts.push(`  Updated: ${new Date(p.updatedAt).toLocaleString()}`);
        return parts.join("\n");
      });

      return ok(`${rows.length} project(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err(`Projects error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface ProjectRow {
  id: string;
  name: string;
  description?: string;
  updatedAt?: string;
}

// ── spaces-project-team-members ─────────────────────────────────────

const spacesProjectTeamMembers: ToolDef = {
  name: "spaces-project-team-members",
  description:
    "Get all unique team members for a project by aggregating participants across every channel in the project. " +
    "Returns user IDs, names, and emails. Use this to identify who belongs to a project team.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Project ID (use spaces-projects to find project IDs)" },
    },
    required: ["projectId"],
  },
  async handler(args) {
    try {
      const projectId = String(args["projectId"] ?? "");
      if (!projectId) return err("projectId is required");

      const channels = (await interact({
        model: "channel",
        operation: "findMany",
        where: { projectId: { equals: projectId } },
        take: 200,
      })) as Array<{ id: string; name?: string }>;

      if (!channels || channels.length === 0) return ok(`No channels found for project ${projectId}.`);

      const channelIds = channels.map((c) => c.id);

      const participants = (await interact({
        model: "channelParticipant",
        operation: "findMany",
        where: { channelId: { in: channelIds } },
        take: 1000,
      })) as Array<{ userId: string }>;

      const uniqueUserIds = [...new Set(participants.map((p) => p.userId))];
      if (uniqueUserIds.length === 0) return ok(`No team members found in any channel for project ${projectId}.`);

      const users = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { in: uniqueUserIds } },
        take: 1000,
      })) as UserRow[];

      const lines = [
        `Project ID: ${projectId}`,
        `Channels: ${channels.length}`,
        `Team members: ${users.length}`,
        "",
        "Members:",
      ];
      for (const u of users) {
        lines.push(`  ${u.name} (${u.email})`);
        lines.push(`    ID: ${u.id}`);
      }

      return ok(lines.join("\n"));
    } catch (e) {
      return err(`Project team members error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-canvases ─────────────────────────────────────────────────

const spacesCanvases: ToolDef = {
  name: "spaces-canvases",
  description:
    "Search and list Canvas documents in Spaces (collaborative docs, Quarto bundles, slides). " +
    "Filter by title, channel, visibility, doc type. Returns canvas IDs, titles, channel, creator, and last-edited time.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by canvas title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE", "ORG", "CHANNEL"], description: "Filter by visibility" },
      docType: { type: "string", enum: ["Canvas", "Quarto"], description: "Filter by document type" },
      createdBy: { type: "string", description: "Filter by creator user ID" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["title"] = { contains: args["search"] as string, mode: "insensitive" };
      if (args["channelId"]) where["channelId"] = { equals: args["channelId"] };
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["docType"]) where["docType"] = { equals: args["docType"] };
      if (args["createdBy"]) where["createdBy"] = { equals: args["createdBy"] };

      const rows = (await interact({
        model: "canvas",
        operation: "findMany",
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as CanvasRow[];

      if (!rows || rows.length === 0) return ok(args["search"] ? `No canvases found matching "${args["search"]}".` : "No canvases found.");

      const citations: Citation[] = [];
      const seen = new Set<string>();
      const lines = rows.map((c) => {
        const parts = [c.title];
        parts.push(`  Type: ${c.docType ?? "Canvas"} · Visibility: ${c.visibility}`);
        if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`);
        if (c.createdBy) parts.push(`  Created by: ${c.createdBy}`);
        if (c.lastEditedAt) parts.push(`  Last edited: ${new Date(c.lastEditedAt).toLocaleString()}`);
        else if (c.updatedAt) parts.push(`  Updated: ${new Date(c.updatedAt).toLocaleString()}`);
        parts.push(`  ID: ${c.id}`);
        if (c.viewAccessId) {
          pushCanvasCitation(citations, seen, c.viewAccessId, c.title);
        }
        return parts.join("\n");
      });

      return okCited(`${rows.length} canvas(es):\n\n${lines.join("\n\n")}`, citations);
    } catch (e) {
      return err(`Canvases error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface CanvasRow {
  id: string;
  title: string;
  docType?: string;
  visibility: string;
  channelId?: string;
  createdBy?: string;
  lastEditedAt?: string;
  updatedAt?: string;
  viewAccessId?: string;
}

// ── spaces-calls ────────────────────────────────────────────────────

const spacesCalls: ToolDef = {
  name: "spaces-calls",
  description:
    "Search and list calls/meetings in Spaces. Filter by title, channel, status (ACTIVE/ENDED/SCHEDULED), " +
    "call type (VIDEO/AUDIO), or time range. Returns call IDs, titles, organizer, channel, status, and timing.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by call title (case-insensitive partial match)" },
      channelId: { type: "string", description: "Filter by channel ID" },
      status: { type: "string", enum: ["ACTIVE", "ENDED", "SCHEDULED", "CANCELLED"], description: "Filter by call status" },
      callType: { type: "string", enum: ["VIDEO", "AUDIO"], description: "Filter by call type" },
      organizerId: { type: "string", description: "Filter by organizer user ID" },
      createdByUserId: { type: "string", description: "Filter by creator user ID" },
      isRecurring: { type: "boolean", description: "Filter recurring calls only" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["title"] = { contains: args["search"] as string, mode: "insensitive" };
      if (args["channelId"]) where["channelId"] = { equals: args["channelId"] };
      if (args["status"]) where["status"] = { equals: args["status"] };
      if (args["callType"]) where["callType"] = { equals: args["callType"] };
      if (args["organizerId"]) where["organizerId"] = { equals: args["organizerId"] };
      if (args["createdByUserId"]) where["createdByUserId"] = { equals: args["createdByUserId"] };
      if (typeof args["isRecurring"] === "boolean") where["isRecurring"] = { equals: args["isRecurring"] };

      const rows = (await interact({
        model: "call",
        operation: "findMany",
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        skip: (args["offset"] as number | undefined) ?? 0,
      })) as CallRow[];

      if (!rows || rows.length === 0) return ok(args["search"] ? `No calls found matching "${args["search"]}".` : "No calls found.");

      const lines = rows.map((c) => {
        const parts = [c.title ?? "(untitled call)"];
        parts.push(`  Type: ${c.callType ?? "VIDEO"} · Status: ${c.status}`);
        if (c.description) parts.push(`  ${c.description}`);
        if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`);
        if (c.organizerId) parts.push(`  Organizer: ${c.organizerId}`);
        if (c.startsAt) parts.push(`  Starts: ${new Date(c.startsAt).toLocaleString()}`);
        if (c.endsAt) parts.push(`  Ends: ${new Date(c.endsAt).toLocaleString()}`);
        if (c.isRecurring) parts.push(`  Recurring: ${c.recurrenceRule ?? "yes"}`);
        if (c.roomLink) parts.push(`  Link: ${c.roomLink}`);
        parts.push(`  ID: ${c.id}`);
        return parts.join("\n");
      });

      return ok(`${rows.length} call(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err(`Calls error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface CallRow {
  id: string;
  title?: string;
  description?: string;
  callType?: string;
  status: string;
  channelId?: string;
  organizerId?: string;
  createdByUserId?: string;
  startsAt?: string;
  endsAt?: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  roomLink?: string;
  lastActivityAt?: string;
}

// ── spaces-boards ───────────────────────────────────────────────────

const spacesBoards: ToolDef = {
  name: "spaces-boards",
  description:
    "Search and list boards to find board IDs for creating tickets. " +
    "Can filter by name or project ID with pagination support.",
  inputSchema: {
    type: "object",
    properties: {
      search: { type: "string", description: "Filter by board name (partial match)" },
      projectId: { type: "string", description: "Filter by project ID (use spaces-projects to find project IDs)" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["search"]) where["name"] = { contains: args["search"] };
      if (args["projectId"]) where["projectId"] = { equals: args["projectId"] };

      const rows = (await interact({
        model: "board",
        operation: "findMany",
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        skip: (args["offset"] as number | undefined) ?? 0,
        include: {
          project: { select: { name: true } },
        },
      })) as BoardRow[];

      if (!rows || rows.length === 0) return ok(args["search"] ? `No boards found matching "${args["search"]}".` : "No boards found.");

      const lines = rows.map((b) => {
        const parts = [b.name];
        if (b.description) parts.push(`  ${b.description}`);
        if (b.project) parts.push(`  Project: ${b.project.name}`);
        parts.push(`  ID: ${b.id}`);
        if (b.updatedAt) parts.push(`  Updated: ${new Date(b.updatedAt).toLocaleString()}`);
        return parts.join("\n");
      });

      return ok(`${rows.length} board(s):\n\n${lines.join("\n\n")}`);
    } catch (e) {
      return err(`Boards error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface BoardRow {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  project?: { name: string } | null;
  updatedAt?: string;
}

// ── spaces-send-message ─────────────────────────────────────────────

const spacesSendMessage: ToolDef = {
  name: "spaces-send-message",
  description:
    "Send a message as the bot in Spaces. Supports HTML content for @mentions. " +
    "Use conversationId to reply in a thread, or channelId to post in a channel. " +
    "For @mentions, use HTML: <span data-mention=\"\" data-mention-type=\"user\" data-user-id=\"USER_ID\" data-username=\"NAME\" class=\"chat-input-mention\">@NAME</span>",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "Reply in this conversation thread" },
      channelId: { type: "string", description: "Post in this channel (use if no conversationId)" },
      content: { type: "string", description: "Message content (supports HTML for mentions)" },
    },
    required: ["content"],
  },
  async handler(args) {
    // This handler is intercepted at the /mcp/call level in mcp.ts
    // and posted as bot using the agent's app token.
    // This code only runs if called directly (not through /mcp/call).
    try {
      const conversationId = args["conversationId"] as string | undefined;
      const channelId = args["channelId"] as string | undefined;
      const content = String(args["content"]);
      const data = (await spacesFetch(`/api/conversations/${conversationId ?? channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      })) as { messageId: string; conversationId: string };
      return ok(`Message sent. messageId: ${data.messageId}`);
    } catch (e) {
      return err(`Send message error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-create-ticket ────────────────────────────────────────────

const spacesCreateTicket: ToolDef = {
  name: "spaces-create-ticket",
  description:
    "Create a new ticket in Spaces. Requires projectId, boardId, and channelId — " +
    "use spaces-projects, spaces-boards, and spaces-channels to look these up first. " +
    "IMPORTANT: If the user's message contained file attachments, pass the conversationId from " +
    "the session context as sourceConversationId so those attachments are automatically linked " +
    "to the new ticket. Do NOT pass channelId when using sourceConversationId.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Ticket title" },
      description: { type: "string", description: "Ticket description" },
      projectId: { type: "string", description: "Project ID (use spaces-projects to find)" },
      boardId: { type: "string", description: "Board ID (use spaces-boards to find)" },
      channelId: { type: "string", description: "Channel ID — use when NOT passing sourceConversationId (use spaces-channels to find)" },
      sourceConversationId: {
        type: "string",
        description: "ConversationId of the message that triggered this ticket creation. Pass this (instead of channelId) whenever the triggering message had file attachments — the backend will automatically transfer those attachments to the ticket.",
      },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Ticket priority" },
      assignedTo: { type: "string", description: "User ID to assign (use spaces-users to find)" },
      eta: { type: "string", description: "Due date as ISO 8601 string" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
    },
    required: ["title", "description", "projectId", "boardId"],
  },
  async handler(args) {
    try {
      if (!args["channelId"] && !args["sourceConversationId"]) {
        return err("Either channelId or sourceConversationId is required.");
      }

      const body: Record<string, unknown> = {
        title: args["title"],
        description: args["description"],
        projectId: args["projectId"],
        boardId: args["boardId"],
      };
      if (args["sourceConversationId"]) body["sourceConversationId"] = args["sourceConversationId"];
      else body["channelId"] = args["channelId"];
      if (args["priority"]) body["priority"] = args["priority"];
      if (args["assignedTo"]) body["assignedTo"] = args["assignedTo"];
      if (args["eta"]) body["eta"] = args["eta"];
      if (args["tags"]) body["tags"] = args["tags"];

      const data = (await spacesFetch("/api/tickets", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { id: string; xyneId: string; conversationId: string; title: string; priority: string; status: string };

      return ok([
        `Ticket created:`,
        `  xyneId: ${data.xyneId}`,
        `  ID: ${data.id}`,
        `  Status: ${data.status}`,
        `  Priority: ${data.priority}`,
        `  ConversationID: ${data.conversationId}`,
      ].join("\n"));
    } catch (e) {
      return err(`Create ticket error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-schedule-call ────────────────────────────────────────────

const spacesAddTicketAttachments: ToolDef = {
  name: "spaces-add-ticket-attachments",
  description:
    "Transfer file attachments from a Spaces conversation message to an existing ticket. " +
    "Call this after spaces-create-ticket when the ticket was created without sourceConversationId, " +
    "or when the user explicitly asks to attach files from a message to a ticket.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId: {
        type: "string",
        description: "Ticket ID — the `id` field returned by spaces-create-ticket (NOT the xyneId).",
      },
      sourceConversationId: {
        type: "string",
        description: "ConversationId of the Spaces message that contains the attachments.",
      },
      sourceMessageId: {
        type: "string",
        description: "Optional. MessageId of the specific message with the attachments. If omitted, falls back to the first message in the conversation.",
      },
    },
    required: ["ticketId", "sourceConversationId"],
  },
  async handler(args) {
    try {
      const ticketId = String(args["ticketId"]);
      const sourceConversationId = String(args["sourceConversationId"]);
      const sourceMessageId = args["sourceMessageId"] as string | undefined;

      const body: Record<string, unknown> = { sourceConversationId };
      if (sourceMessageId) body["sourceMessageId"] = sourceMessageId;

      const data = (await spacesFetch(`/api/tickets/${encodeURIComponent(ticketId)}/attachments/from-conversation`, {
        method: "POST",
        body: JSON.stringify(body),
      })) as { count: number };

      return ok(`Attached ${data.count} file(s) to ticket ${ticketId}.`);
    } catch (e) {
      return err(`Add ticket attachments error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-schedule-call ────────────────────────────────────────────

const spacesScheduleCall: ToolDef = {
  name: "spaces-schedule-call",
  description:
    "Schedule a call in Spaces. Must provide either a channelId or targetUserIds (list of user IDs to invite).",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Call title" },
      startsAt: { type: "string", description: "Start time as ISO 8601 string (e.g. '2026-03-28T10:00:00Z')" },
      endsAt: { type: "string", description: "End time as ISO 8601 string" },
      channelId: { type: "string", description: "Channel ID to schedule the call in" },
      targetUserIds: { type: "array", items: { type: "string" }, description: "User IDs to invite (use spaces-users to find)" },
    },
    required: ["title", "startsAt", "endsAt"],
  },
  async handler(args) {
    try {
      if (!args["channelId"] && !(args["targetUserIds"] as string[] | undefined)?.length) {
        return err("Must provide either channelId or targetUserIds.");
      }

      const body: Record<string, unknown> = {
        title: args["title"],
        startsAt: new Date(String(args["startsAt"])).getTime(),
        endsAt: new Date(String(args["endsAt"])).getTime(),
      };
      if (args["channelId"]) body["channelId"] = args["channelId"];
      if (args["targetUserIds"]) body["targetUserIds"] = args["targetUserIds"];

      const data = (await spacesFetch("/api/calls/schedule", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { success: boolean; callId?: string; externalId?: string; channelId?: string };

      if (!data.success) return err("Failed to schedule call.");
      return ok([
        `Call scheduled:`,
        `  callId: ${data.callId}`,
        `  externalId: ${data.externalId}`,
        `  channelId: ${data.channelId}`,
      ].join("\n"));
    } catch (e) {
      return err(`Schedule call error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── webfetch ────────────────────────────────────────────────────────

const webfetchTool: ToolDef = {
  name: "webfetch",
  description:
    "Fetch an external URL and return its content as text. " +
    "Only use for URLs outside Xyne Spaces (e.g. GitHub PRs, docs, external links from messages). " +
    "Do NOT use for Xyne Spaces internal URLs — use the other spaces tools instead.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
    },
    required: ["url"],
  },
  async handler(args) {
    try {
      const url = String(args["url"]);
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return err("URL must start with http:// or https://");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: "text/html;q=1.0, text/plain;q=0.8, */*;q=0.1",
          },
          redirect: "follow",
        });
        clearTimeout(timer);

        if (!response.ok) return err(`Fetch failed: ${response.status} ${response.statusText}`);

        const contentType = response.headers.get("content-type") ?? "";
        let text = await response.text();

        if (contentType.includes("html")) {
          text = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        if (text.length > 15000) text = text.slice(0, 15000) + "\n\n... (truncated)";
        return ok(text);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return err(`Webfetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-whoami ─────────────────────────────────────────────────────

const spacesWhoami: ToolDef = {
  name: "spaces-whoami",
  description:
    "Returns the current user's Spaces profile — userId, name, email. " +
    "Call this first to get the userId needed for filtering other tools (e.g. assignedTo, from, createdBy).",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    try {
      if (!CURRENT_USER_ID) return err("Could not determine current user from token.");
      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { equals: CURRENT_USER_ID } },
        take: 1,
      })) as Array<{ id: string; name: string; email: string }>;
      const u = rows?.[0];
      if (!u) return ok(`Current user ID: ${CURRENT_USER_ID} (profile not found)`);
      return ok(`Current user:\n- ID: ${u.id}\n- Name: ${u.name}\n- Email: ${u.email}`);
    } catch (e) {
      return err(`Whoami error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-publish-docs ─────────────────────────────────────────────

const spacesPublishDocs: ToolDef = {
  name: "spaces-publish-docs",
  description:
    "Publish a Quarto book or documentation to Xyne Spaces. " +
    "Accepts a base64-encoded zip of the rendered HTML output and uploads it. " +
    "Returns the published docs URL on success.",
  inputSchema: {
    type: "object",
    properties: {
      zipBase64: { type: "string", description: "Base64-encoded zip file containing the rendered HTML output" },
      userRepo: { type: "string", description: "Unique identifier in org/repo/branch format (e.g. 'pgm-agent/my-program/main')" },
      title: { type: "string", description: "Display title for the published docs" },
      entryFile: { type: "string", description: "Entry HTML file name (default: index.html)" },
      channelId: { type: "string", description: "Channel ID to publish to, or omit for personal/private docs" },
      docType: { type: "string", enum: ["book", "docs", "website", "slides"], description: "Document type (default: book)" },
    },
    required: ["zipBase64", "userRepo", "title"],
  },
  async handler(params) {
    try {
      const zipBase64 = params["zipBase64"] as string;
      const userRepo = params["userRepo"] as string;
      const title = params["title"] as string;
      const entryFile = (params["entryFile"] as string) || "index.html";
      const channelId = params["channelId"] as string | undefined;
      const docType = (params["docType"] as string) || "book";

      if (!zipBase64 || !userRepo || !title) {
        return err("zipBase64, userRepo, and title are required");
      }

      const zipBuffer = Buffer.from(zipBase64, "base64");
      console.error(`[spaces-publish-docs] Publishing ${title} (${(zipBuffer.length / 1024).toFixed(0)} KB) as ${userRepo}`);

      const formData = new FormData();
      formData.append("docs", new Blob([zipBuffer], { type: "application/zip" }), "docs.zip");
      formData.append("userRepo", userRepo);
      formData.append("title", title);
      formData.append("entryFile", entryFile);
      formData.append("docType", docType);
      if (channelId) formData.append("channelId", channelId);

      const baseUrl = (process.env["XYNE_SPACES_URL"] ?? "").replace(/\/+$/, "");
      const token = process.env["XYNE_SPACES_TOKEN"] ?? "";
      const sessionId = process.env["XYNE_SPACES_SESSION_ID"] ?? "";
      const url = `${baseUrl}/api/docs/publish`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(sessionId ? { "x-session-id": sessionId } : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(120_000),
      });

      const result = (await response.json()) as Record<string, unknown>;

      if (response.ok && result["success"]) {
        return ok(`Published successfully!\n- URL: ${result["docsUrl"]}\n- Title: ${title}\n- UserRepo: ${userRepo}`);
      } else {
        return err(`Publish failed (${response.status}): ${result["error"] || "Unknown error"}`);
      }
    } catch (e) {
      return err(`Publish error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-create-canvas ─────────────────────────────────────────────

const spacesCreateCanvas: ToolDef = {
  name: "spaces-create-canvas",
  description:
    "Create a new canvas in Xyne Spaces from markdown content. " +
    "The canvas is shared collaboratively (BlockNote + Y-Sweet) and owned by the Ask-AI bot plus the current user. " +
    "Returns the canvas URL on success. Use this when the user asks to create a document, notes, meeting summary, or any rich-text artifact.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Canvas title (shown in the canvas list and tab)." },
      markdown: {
        type: "string",
        description:
          "The markdown content for the canvas. Headings, lists, tables, code blocks, and links are all preserved. Max 5MB.",
      },
    },
    required: ["title", "markdown"],
  },
  async handler(params) {
    try {
      const title = String(params["title"] ?? "").trim();
      const markdown = String(params["markdown"] ?? "");
      if (!title) return err("title is required");
      if (!markdown) return err("markdown is required");

      const result = (await spacesFetch("/api/canvas", {
        method: "POST",
        body: JSON.stringify({ title, markdown }),
      })) as { success?: boolean; url?: string | null; message?: string; error?: string };

      if (!result.success) return err(result.error ?? "Failed to create canvas");
      return ok(result.message ?? `Canvas created.\nURL: ${result.url ?? "(unknown)"}`);
    } catch (e) {
      return err(`Create canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-edit-canvas ───────────────────────────────────────────────

const spacesEditCanvas: ToolDef = {
  name: "spaces-edit-canvas",
  description:
    "Replace the contents of an existing canvas. Requires edit access (owner, editor, or an edit link). " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>) and the new markdown. " +
    "Returns the canvas URL on success.",
  inputSchema: {
    type: "object",
    properties: {
      viewAccessId: {
        type: "string",
        description: "viewAccessId of the canvas to edit — the ID that appears in the canvas URL.",
      },
      content: {
        type: "string",
        description: "New markdown content to replace the canvas body. Max 5MB.",
      },
      title: { type: "string", description: "Optional new title for the canvas." },
    },
    required: ["viewAccessId", "content"],
  },
  async handler(params) {
    try {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      const content = String(params["content"] ?? "");
      const title = params["title"] ? String(params["title"]) : undefined;
      if (!viewAccessId) return err("viewAccessId is required");
      if (!content) return err("content is required");

      const result = (await spacesFetch(`/api/canvas/view/${encodeURIComponent(viewAccessId)}`, {
        method: "PATCH",
        body: JSON.stringify({ content, ...(title ? { title } : {}) }),
      })) as { success?: boolean; url?: string | null; message?: string; error?: string };

      if (!result.success) return err(result.error ?? "Failed to edit canvas");
      return ok(result.message ?? `Canvas updated.\nURL: ${result.url ?? "(unknown)"}`);
    } catch (e) {
      return err(`Edit canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── Export ────────────────────────────────────────────────────────────

// ── spaces-trigger-agent ────────────────────────────────────────────

const spacesTriggerAgent: ToolDef = {
  name: "spaces-trigger-agent",
  description:
    "Trigger another agent to start working on a task. " +
    "The target agent will receive the task in the same conversation thread. " +
    "Use this to hand off work to specialized agents (e.g. trigger doctor-agent to investigate a bug).",
  inputSchema: {
    type: "object",
    properties: {
      targetAgent: { type: "string", description: "Slug of the agent to trigger (e.g. 'doctor-agent', 'pgm-agent')" },
      task: { type: "string", description: "Task description for the target agent" },
      conversationId: { type: "string", description: "Conversation thread to continue in (from Session Metadata)" },
      channelId: { type: "string", description: "Channel where the conversation is happening (from Session Metadata)" },
    },
    required: ["targetAgent", "task"],
  },
  async handler() {
    // Intercepted at /mcp/call level — this handler should not be called directly
    return ok("Agent triggered.");
  },
};

// ── spaces-meeting-insights ─────────────────────────────────────────

const spacesMeetingInsights: ToolDef = {
  name: "spaces-meeting-insights",
  description:
    "Semantic search over AI-analyzed meeting data (Google Meet, Zoom, etc.) covering summaries, " +
    "action items, pain points, merchant discussions, decisions, Q&A, and participant-level insights. " +
    "Use this when the user asks about meeting content, action items from calls, what was discussed, " +
    "decisions made, or anything related to meetings/transcripts. " +
    "Prefer this over spaces-search for meeting-related queries.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The topic or question to search for in meeting insights — e.g. 'sales targets', 'action items', 'pain points', 'merchant feedback'. Can be empty if using filters only." },
      platform: { type: "string", description: "Filter by meeting platform(s), comma-separated: google-meet, zoom" },
      participants: { type: "string", description: "Filter by participant email(s), comma-separated (e.g. 'user@example.com')" },
      callType: { type: "string", description: "Filter by meeting/call type (e.g. 'sales-call', 'onboarding')" },
      before: { type: "string", description: "Filter meetings before this date (e.g. '2024-01-01' or '15 Mar 26')" },
      after: { type: "string", description: "Filter meetings after this date" },
      on: { type: "string", description: "Filter meetings on this specific date" },
      range: { type: "string", description: "Filter by time keyword: today, yesterday, this week, last week, last 7 days, this month, last month, last 30 days, recent" },
      limit: { type: "number", minimum: 1, maximum: 20, default: 10, description: "Max results (default 10)" },
    },
    required: [],
  },
  async handler(args) {
    try {
      const query = String(args["query"] ?? "").trim();
      const params: Record<string, string> = {
        q: query,
        type: "transcript",
        limit: String(args["limit"] ?? 10),
      };
      if (args["platform"]) params["callType"] = String(args["platform"]);
      if (args["participants"]) params["from"] = String(args["participants"]);
      if (args["callType"]) params["callType"] = String(args["callType"]);
      if (args["before"]) params["before"] = String(args["before"]);
      if (args["after"]) params["after"] = String(args["after"]);
      if (args["on"]) params["on"] = String(args["on"]);
      if (args["range"]) params["range"] = String(args["range"]);
      if (!query) params["filterOnly"] = "true";

      const data = (await search(params)) as {
        success: boolean;
        data?: {
          results?: Array<{
            id: string;
            type: string;
            title: string;
            subtitle?: string;
            context?: string;
            metadata?: Record<string, unknown>;
            searchContext?: Record<string, unknown>;
          }>;
          totalCount?: number;
        };
      };

      if (!data.success || !data.data) return err("Meeting insights search failed.");

      const results = data.data.results ?? [];
      if (results.length === 0) {
        return ok(query ? `No meeting insights found for "${query}".` : "No meeting insights found.");
      }

      const formatted = results.map((r, idx) => {
        const lines: string[] = [];
        lines.push(`### ${idx + 1}. ${r.title || "Untitled Meeting"}`);
        if (r.subtitle) lines.push(`**${r.subtitle}**`);

        const context = r.context ?? "";
        if (context) {
          const cleaned = context.replace(/<\/?[^>]+>/g, "").slice(0, 2000);
          lines.push(cleaned);
        }

        const meta = r.metadata ?? {};
        const sc = r.searchContext ?? {};
        const metaParts: string[] = [];
        if (meta["timestamp"]) metaParts.push(`Date: ${meta["timestamp"]}`);
        if (meta["channelName"]) metaParts.push(`Channel: #${meta["channelName"]}`);
        if (sc["senderName"]) metaParts.push(`Participants: ${sc["senderName"]}`);
        if (meta["platform"]) metaParts.push(`Platform: ${meta["platform"]}`);
        if (metaParts.length > 0) lines.push(metaParts.join(" · "));

        return lines.join("\n");
      }).join("\n\n---\n\n");

      return ok(`Found ${data.data.totalCount ?? results.length} meeting insight(s):\n\n${formatted}`);
    } catch (e) {
      return err(`Meeting insights search error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

export const tools: ToolDef[] = [
  spacesWhoami,
  spacesSearch,
  spacesMeetingInsights,
  spacesMemorySearch,
  spacesMemoryCreate,
  spacesTickets,
  spacesMessages,
  spacesMessageDetail,
  spacesChannels,
  spacesUsers,
  spacesActivity,
  spacesProjects,
  spacesProjectTeamMembers,
  spacesCanvases,
  spacesCalls,
  spacesBoards,
  spacesSendMessage,
  spacesCreateTicket,
  spacesAddTicketAttachments,
  spacesScheduleCall,
  spacesPublishDocs,
  spacesCreateCanvas,
  spacesEditCanvas,
  spacesTriggerAgent,
  webfetchTool,
];
