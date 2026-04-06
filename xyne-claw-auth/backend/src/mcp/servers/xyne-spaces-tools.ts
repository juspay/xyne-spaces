/**
 * Xyne Spaces MCP tool definitions.
 *
 * Each tool has a name, description, JSON Schema inputSchema, and async handler.
 * Handlers call the Spaces HTTP client and return MCP-formatted results.
 */

import { interact, search, memorySearch, spacesFetch, CURRENT_USER_ID } from "./xyne-spaces-client.js";

// ── Types ────────────────────────────────────────────────────────────

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
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

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ── spaces-search ────────────────────────────────────────────────────

const spacesSearch: ToolDef = {
  name: "spaces-search",
  description:
    "Search across all connected apps in Spaces — messages, tickets, files, channels, users. " +
    "Supports filters like app, type, date range, priority, status, tags, and more.",
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
      if (query) params["query"] = query;
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

      if (data.data.grouped && data.data.groups) {
        const groups = data.data.groups;
        if (groups.length === 0) return ok(`No results found for "${args["query"]}".`);
        const parts: string[] = [];
        for (const group of groups) {
          parts.push(`--- ${group.groupValue} (${group.count}) ---`);
          for (const r of group.results) parts.push(formatSearchResult(r));
          parts.push("");
        }
        return ok(parts.join("\n"));
      }

      const results = data.data.results ?? [];
      if (results.length === 0) return ok(`No results found for "${args["query"]}".`);
      return ok(`Found ${data.data.totalCount ?? results.length} result(s):\n\n${results.map(formatSearchResult).join("\n\n")}`);
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
      };
      if (args["query"]) body["query"] = args["query"];
      if (args["docType"]) body["docType"] = args["docType"];
      if (args["tags"]) body["tags"] = args["tags"];
      if (args["reviewStatus"]) body["reviewStatus"] = args["reviewStatus"];

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

// ── spaces-tickets ───────────────────────────────────────────────────

const spacesTickets: ToolDef = {
  name: "spaces-tickets",
  description:
    "List and filter tickets in Spaces. Filter by status, priority, assignee, board, project, or stage. " +
    "Returns ticket details including assignee, tags, stage, and conversation ID.",
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

      const take = (args["limit"] as number | undefined) ?? 20;
      const skip = (args["offset"] as number | undefined) ?? 0;
      const include = {
        assignedToUser: { select: { name: true } },
        createdByUser: { select: { name: true } },
        board: { select: { name: true } },
        project: { select: { name: true } },
        tags: { select: { name: true } },
      };

      const userId = (args["assignedTo"] as string | undefined) ?? (CURRENT_USER_ID || undefined);

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
        return formatTickets(merged.slice(0, take));
      }

      // Explicit createdBy filter only
      if (args["createdBy"]) {
        baseWhere["createdBy"] = { equals: args["createdBy"] };
      }

      const rows = (await interact({ model: "ticket", operation: "findMany", where: baseWhere, orderBy: [{ updatedAt: "desc" }], take, skip, include })) as TicketRow[];
      return formatTickets(rows);
    } catch (e) {
      return err(`Tickets error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

function formatTickets(rows: TicketRow[]): ToolResult {
  if (!rows || rows.length === 0) return ok("No tickets found.");
  const lines = rows.map((t) => {
    const parts = [`[${t.xyneId}] ${t.title}`];
    parts.push(`  Status: ${t.statusV2} · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`);
    if (t.assignedToUser) parts.push(`  Assigned: ${t.assignedToUser.name}`);
    if (t.createdByUser) parts.push(`  Created by: ${t.createdByUser.name}`);
    if (t.board) parts.push(`  Board: ${t.board.name}${t.project ? ` · Project: ${t.project.name}` : ""}`);
    if (t.tags && t.tags.length > 0) parts.push(`  Tags: ${t.tags.map((tg) => tg.name).join(", ")}`);
    if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`);
    if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`);
    parts.push(`  Updated: ${new Date(t.updatedAt).toLocaleString()}`);
    return parts.join("\n");
  });
  return ok(`${rows.length} ticket(s):\n\n${lines.join("\n\n")}`);
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

      return ok(`${rows.length} message(s):\n\n${lines.join("\n")}`);
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
        `\n${m.content}`,
      ];

      if (m.reactionCounts && m.reactionCounts.length > 0) {
        const rxns = m.reactionCounts.map((r) => `${r.emojiName} x${r.count}`).join("  ");
        parts.push(`\nReactions: ${rxns}`);
      }

      if (m.hasAttachment) {
        parts.push("\n[Has attachments]");
      }

      return ok(parts.join("\n"));
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
    "List channels in Spaces. Can filter by visibility (PUBLIC/PRIVATE) and scope type (DEFAULT/DM/TICKET/GROUP_DM). " +
    "Returns channel name, participant count, project, and last activity.",
  inputSchema: {
    type: "object",
    properties: {
      visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
      scopeType: { type: "string", enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"], description: "Filter by scope type" },
      limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max channels (default 20)" },
    },
  },
  async handler(args) {
    try {
      const where: Record<string, unknown> = {};
      if (args["visibility"]) where["visibility"] = { equals: args["visibility"] };
      if (args["scopeType"]) where["scopeType"] = { equals: args["scopeType"] };

      const rows = (await interact({
        model: "channel",
        operation: "findMany",
        where,
        orderBy: [{ lastActivityAt: "desc" }],
        take: (args["limit"] as number | undefined) ?? 20,
        include: {
          project: { select: { name: true } },
        },
      })) as ChannelRow[];

      if (!rows || rows.length === 0) return ok("No channels found.");

      const lines = rows.map((c) => {
        const parts = [`#${c.name} (${c.scopeType}, ${c.visibility})`];
        if (c.description) parts.push(`  ${c.description}`);
        parts.push(`  Participants: ${c.participantCount}${c.project ? ` · Project: ${c.project.name}` : ""}`);
        if (c.lastActivityAt) parts.push(`  Last active: ${new Date(c.lastActivityAt).toLocaleString()}`);
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
      const where: Record<string, unknown> = {};
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

      const lines = rows.map((a) => {
        const when = new Date(a.createdAt).toLocaleString();
        const read = a.isRead ? "" : " (unread)";
        const refs: string[] = [];
        if (a.messageId) refs.push(`messageId: ${a.messageId}`);
        if (a.conversationId) refs.push(`conversationId: ${a.conversationId}`);
        if (a.ticketId) refs.push(`ticketId: ${a.ticketId}`);
        if (a.channelId) refs.push(`channelId: ${a.channelId}`);
        const refStr = refs.length > 0 ? `\n    ${refs.join(" · ")}` : "";
        return `[${when}] ${a.actorAction}${read}${a.classification ? ` · ${a.classification}` : ""}${refStr}`;
      });

      return ok(`${rows.length} activity entries:\n\n${lines.join("\n")}`);
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
    "Send a message in Spaces by replying to an existing conversation thread. " +
    "Use the conversationId from spaces-tickets or spaces-messages results (NOT channelId or ticketId).",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "The conversationId to send the message to" },
      content: { type: "string", description: "Message content to send" },
    },
    required: ["conversationId", "content"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"]);
      const content = String(args["content"]);
      const data = (await spacesFetch(`/api/chat/postMessage/${conversationId}`, {
        method: "POST",
        body: JSON.stringify({ content }),
      })) as { messageId: string; conversationId: string };

      return ok(`Message sent. messageId: ${data.messageId}, conversationId: ${data.conversationId}`);
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
    "use spaces-projects, spaces-boards, and spaces-channels to look these up first.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Ticket title" },
      description: { type: "string", description: "Ticket description" },
      projectId: { type: "string", description: "Project ID (use spaces-projects to find)" },
      boardId: { type: "string", description: "Board ID (use spaces-boards to find)" },
      channelId: { type: "string", description: "Channel ID (use spaces-channels to find)" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Ticket priority" },
      assignedTo: { type: "string", description: "User ID to assign (use spaces-users to find)" },
      eta: { type: "string", description: "Due date as ISO 8601 string" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
    },
    required: ["title", "description", "projectId", "boardId", "channelId"],
  },
  async handler(args) {
    try {
      const body: Record<string, unknown> = {
        title: args["title"],
        description: args["description"],
        projectId: args["projectId"],
        boardId: args["boardId"],
        channelId: args["channelId"],
      };
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

// ── Export ────────────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  spacesSearch,
  spacesMemorySearch,
  spacesTickets,
  spacesMessages,
  spacesMessageDetail,
  spacesChannels,
  spacesUsers,
  spacesActivity,
  spacesProjects,
  spacesBoards,
  spacesSendMessage,
  spacesCreateTicket,
  spacesScheduleCall,
  webfetchTool,
];
