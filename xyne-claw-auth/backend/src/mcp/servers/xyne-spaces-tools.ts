/**
 * Xyne Spaces MCP tool definitions.
 *
 * Each tool has a name, description, JSON Schema inputSchema, and async handler.
 * Handlers call the Spaces HTTP client and return MCP-formatted results.
 */

import { interact, search, memorySearch, spacesFetch, spacesFetchBuffer } from "./xyne-spaces-client.js";
import type { Citation } from "xyne-claw-shared";
import { CONFIG } from "../../config.js";

/**
 * Build a clickable Spaces thread URL for a ticket. Mirrors the
 * pattern used by claw-auth's citations.ts buildThreadUrl so the link
 * format stays consistent across the codebase. Returns null when
 * required fields are missing so callers can fall back to plain text.
 */
function buildTicketUrl(channelId: string | undefined, conversationId: string | undefined): string | null {
  const base = CONFIG.spacesAppUrl;
  if (!base || !channelId || !conversationId) return null;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}

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

export interface HandlerContext {
  userId: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>, ctx: HandlerContext) => Promise<ToolResult>;
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
  async handler(args, ctx) {
    try {
      const docType = args["docType"] as string;
      const content = args["content"] as string;
      const query = (args["query"] as string | undefined) ?? "";
      const tags = (args["tags"] as string[] | undefined) ?? [];
      const docId = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const document = {
        docId,
        docType,
        userId: ctx.userId,
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
    "or anything ticket-related. Filter by status, priority, assignee, creator, board, project, tags, stage, channel, " +
    "or creation date range. Returns structured ticket details including assignee, tags, stage, channel ID, conversation ID, " +
    "createdAt, and updatedAt. Prefer this over spaces-search for ticket queries — it returns richer, more accurate data.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "Filter by status" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Filter by priority" },
      assignedTo: { type: "string", description: "Filter by assigned user — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query." },
      createdBy: { type: "string", description: "Filter by ticket creator — accepts either the user's ID (cm…) or their email address. Email is resolved to userId server-side before the ticket query." },
      createdByIn: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter by ticket creator across MANY users in one call. Accepts an array of emails or userIds (mix allowed). " +
          "Use this for daily/team reports where you need tickets from a fixed user group — one tool call instead of N. " +
          "Emails are resolved server-side in a single batch query. " +
          "If this is provided, the singular `createdBy` is ignored. Unresolved emails are noted in the response.",
      },
      boardId: { type: "string", description: "Filter by board ID" },
      projectId: { type: "string", description: "Filter by project ID" },
      stageName: { type: "string", description: "Filter by stage name" },
      tags: { type: "string", description: "Filter by tag name(s), comma-separated (e.g. 'April-Launch,Q2')" },
      channelId: { type: "string", description: "Filter to tickets in this channel only" },
      createdAfter: { type: "string", description: "ISO 8601 timestamp — only tickets created at or after this time (e.g. '2026-04-20T00:00:00Z')" },
      createdBefore: { type: "string", description: "ISO 8601 timestamp — only tickets created strictly before this time" },
      limit: { type: "number", minimum: 1, maximum: 500, default: 20, description: "Max tickets (default 20, max 500). Use higher values with createdByIn for team-wide reports." },
      offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      classifyActionable: {
        type: "boolean",
        description:
          "When true, the server computes an `actionReason` per ticket — one of 'critical' | 'overdue' | 'no-assignee' | 'stale' | null — using deterministic rules with proper preconditions (terminal states never actionable). " +
          "Use this for daily reports / triage views so the agent never has to classify tickets itself (which it does badly). Default false (no classification).",
      },
      summary: {
        type: "boolean",
        description:
          "When true, appends a Summary block to the response containing aggregate counts: total, actionableCount (if classifyActionable also true), byStatus, byPriority, byUser. Computed server-side from the response data — agents that render reports never need to do arithmetic themselves. Default false.",
      },
      expectedUserGroup: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of emails (or userIds) the caller expects to see in the data. When provided alongside summary=true, summary.byUser includes every member of this list — those with 0 tickets are kept (with all-zero counts). Lets a daily-report caller surface 'Members with No Tickets' without doing set-difference math itself.",
      },
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
      if (args["channelId"]) baseWhere["channelId"] = { equals: args["channelId"] };
      if (args["tags"]) {
        const tagNames = (args["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean);
        if (tagNames.length > 0) {
          baseWhere["tags"] = { some: { name: { in: tagNames } } };
        }
      }
      const createdAtFilter: Record<string, string> = {};
      if (args["createdAfter"]) createdAtFilter["gte"] = args["createdAfter"] as string;
      if (args["createdBefore"]) createdAtFilter["lt"] = args["createdBefore"] as string;
      if (Object.keys(createdAtFilter).length > 0) baseWhere["createdAt"] = createdAtFilter;

      const take = (args["limit"] as number | undefined) ?? 20;
      const skip = (args["offset"] as number | undefined) ?? 0;
      const include = {
        assignedToUser: { select: { name: true, email: true } },
        createdByUser: { select: { name: true, email: true } },
        board: { select: { name: true } },
        project: { select: { name: true } },
        tags: { select: { name: true } },
      };

      // Resolve email-form values for assignedTo / createdBy → userId via one
      // lookup. Saves the caller a round-trip to spaces-users when they only
      // have an email handy (the common case for merchant-paglu user-tickets).
      const assignedToUserId = await resolveUserIdentifier(args["assignedTo"] as string | undefined);
      if (args["assignedTo"] && !assignedToUserId) return ok(`No user found for assignedTo='${args["assignedTo"]}'.`);

      // Bulk createdByIn — resolve every email-or-userId in a single batch
      // query, then filter with `createdBy IN (…)`. Lets a single tool call
      // span a whole team for daily reports, replacing N parallel subagent
      // calls. If createdByIn is set, the singular createdBy is ignored.
      let unresolvedEmails: string[] = [];
      let bulkActive = false;
      const rawIn = args["createdByIn"];
      if (Array.isArray(rawIn) && rawIn.length > 0) {
        bulkActive = true;
        const { userIds, unresolved } = await resolveUserIdentifiersBatch(
          (rawIn as unknown[]).map((v) => String(v)),
        );
        if (userIds.length === 0) {
          return ok(
            `No matching users found for any of the ${rawIn.length} createdByIn entries. ` +
              `Unresolved: ${unresolved.join(", ")}.`,
          );
        }
        baseWhere["createdBy"] = { in: userIds };
        unresolvedEmails = unresolved;
      }

      // Singular createdBy — only when bulk is not active.
      let createdByUserId: string | null = null;
      if (!bulkActive) {
        createdByUserId = await resolveUserIdentifier(args["createdBy"] as string | undefined);
        if (args["createdBy"] && !createdByUserId) return ok(`No user found for createdBy='${args["createdBy"]}'.`);
      }

      // Single-user merged fetch (assigned OR created by the same person) only
      // applies when bulk isn't in play and createdBy wasn't supplied.
      if (assignedToUserId && !bulkActive && !createdByUserId) {
        const [assigned, created] = await Promise.all([
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, assignedTo: { equals: assignedToUserId } }, orderBy: [{ updatedAt: "desc" }], take, skip, include }) as Promise<TicketRow[]>,
          interact({ model: "ticket", operation: "findMany", where: { ...baseWhere, createdBy: { equals: assignedToUserId } }, orderBy: [{ updatedAt: "desc" }], take, skip, include }) as Promise<TicketRow[]>,
        ]);
        const seen = new Set<string>();
        const merged: TicketRow[] = [];
        for (const t of [...(assigned ?? []), ...(created ?? [])]) {
          if (!seen.has(t.id)) { seen.add(t.id); merged.push(t); }
        }
        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return await formatTickets(merged.slice(0, take), {
          classifyActionable: args["classifyActionable"] === true,
          summary: args["summary"] === true,
          expectedUserGroup: Array.isArray(args["expectedUserGroup"])
            ? (args["expectedUserGroup"] as unknown[]).map((v) => String(v))
            : [],
        });
      }

      // Explicit single createdBy filter (only when bulk isn't active).
      if (createdByUserId) {
        baseWhere["createdBy"] = { equals: createdByUserId };
      }

      const rows = (await interact({ model: "ticket", operation: "findMany", where: baseWhere, orderBy: [{ updatedAt: "desc" }], take, skip, include })) as TicketRow[];

      const classifyActionable = args["classifyActionable"] === true;
      const wantSummary = args["summary"] === true;
      const expectedGroup = Array.isArray(args["expectedUserGroup"])
        ? (args["expectedUserGroup"] as unknown[]).map((v) => String(v))
        : [];

      const result = await formatTickets(rows, {
        classifyActionable,
        summary: wantSummary,
        expectedUserGroup: expectedGroup,
      });

      // When the caller did a bulk lookup, surface the unresolved email list
      // so they can flag those users in their downstream report.
      if (bulkActive && unresolvedEmails.length > 0) {
        const note = `\n\n_Note: ${unresolvedEmails.length} email(s) did not match any user and were excluded: ${unresolvedEmails.join(", ")}_`;
        if (result.content[0] && result.content[0].type === "text") {
          result.content[0].text = result.content[0].text + note;
        }
      }
      return result;
    } catch (e) {
      return err(`Tickets error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

/**
 * Resolve a mixed list of emails + userIds to a flat userId list in a single
 * `user findMany` query. Returns the resolved userIds and any emails that
 * didn't match any user. Inputs that don't contain '@' are passed through as
 * userIds without DB lookup.
 */
async function resolveUserIdentifiersBatch(raw: string[]): Promise<{ userIds: string[]; unresolved: string[] }> {
  const trimmed = raw.map((s) => s.trim()).filter((s) => s.length > 0);
  if (trimmed.length === 0) return { userIds: [], unresolved: [] };

  const emails = trimmed.filter((s) => s.includes("@"));
  const idPassthrough = trimmed.filter((s) => !s.includes("@"));

  if (emails.length === 0) {
    return { userIds: idPassthrough, unresolved: [] };
  }

  const rows = (await interact({
    model: "user",
    operation: "findMany",
    where: { email: { in: emails } },
    select: { id: true, email: true },
  })) as Array<{ id: string; email: string }>;

  const emailToId = new Map(rows.map((r) => [r.email, r.id] as const));
  const resolvedFromEmails: string[] = [];
  const unresolved: string[] = [];
  for (const e of emails) {
    const id = emailToId.get(e);
    if (id) resolvedFromEmails.push(id);
    else unresolved.push(e);
  }
  return { userIds: [...idPassthrough, ...resolvedFromEmails], unresolved };
}

/**
 * Accept either a user id (starts with "cm" or any non-email string) or an
 * email address. Emails are resolved to the underlying userId via a single
 * `/api/query` call against the user model. Returns null if nothing was
 * passed in OR if an email didn't match any user. The empty-arg → null path
 * is intentional so callers can write `if (resolved) ...` without juggling
 * undefined separately.
 */
async function resolveUserIdentifier(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("@")) return trimmed; // already a userId
  const rows = (await interact({
    model: "user",
    operation: "findMany",
    where: { email: { equals: trimmed } },
    take: 1,
    select: { id: true },
  })) as Array<{ id: string }>;
  return rows && rows.length > 0 ? rows[0]!.id : null;
}

interface FormatOptions {
  classifyActionable?: boolean;
  summary?: boolean;
  expectedUserGroup?: string[];
}

type ActionReason = "critical" | "overdue" | "no-assignee" | "stale" | null;

/**
 * Deterministic actionability classifier — same rules every caller, no LLM in
 * the loop. Terminal states (COMPLETED / CANCELLED) are never actionable.
 * Priority order: critical > overdue > no-assignee > stale.
 */
function classifyTicket(t: TicketRow, now: Date): ActionReason {
  const status = (t.statusV2 ?? "").toUpperCase();
  if (status === "COMPLETED" || status === "CANCELLED") return null;

  if ((t.priority ?? "").toUpperCase() === "CRITICAL") return "critical";

  if (t.eta) {
    const due = new Date(t.eta);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) return "overdue";
  }

  if (!t.assignedTo) {
    const created = new Date(t.createdAt);
    if (!Number.isNaN(created.getTime())) {
      const hoursSinceCreated = (now.getTime() - created.getTime()) / 3_600_000;
      if (hoursSinceCreated > 24) return "no-assignee";
    }
  }

  // "Stale" check excludes PAUSED — work paused intentionally isn't stale.
  if (status !== "PAUSED") {
    const updated = new Date(t.updatedAt);
    if (!Number.isNaN(updated.getTime())) {
      const hoursSinceUpdated = (now.getTime() - updated.getTime()) / 3_600_000;
      if (hoursSinceUpdated > 48) return "stale";
    }
  }
  return null;
}

interface UserBreakdownRow {
  userId: string;
  name: string;
  email: string | null;
  total: number;
  actionable: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}

interface SummaryShape {
  total: number;
  /** Only set when classifyActionable=true. Otherwise undefined, and the
   * renderer skips the Actionable line to avoid emitting misleading zeros. */
  actionableCount?: number;
  /** Only set when classifyActionable=true. */
  hasActionableInfo: boolean;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byUser: UserBreakdownRow[];
  membersWithNoTickets?: string[];
}

async function formatTickets(rows: TicketRow[], opts: FormatOptions = {}): Promise<ToolResult> {
  if (!rows || rows.length === 0) {
    // Even with zero tickets, the caller may want the expectedUserGroup as
    // "members with no tickets" — emit a minimal summary if asked.
    if (opts.summary && opts.expectedUserGroup && opts.expectedUserGroup.length > 0) {
      const empty: SummaryShape = {
        total: 0,
        hasActionableInfo: opts.classifyActionable === true,
        ...(opts.classifyActionable ? { actionableCount: 0 } : {}),
        byStatus: {},
        byPriority: {},
        byUser: [],
        membersWithNoTickets: opts.expectedUserGroup.slice(),
      };
      return ok(`${renderSummaryBlock(empty)}\n\nNo tickets found.`);
    }
    return ok("No tickets found.");
  }

  // Hydrate missing user-relation joins. Spaces' /api/query sometimes
  // returns `createdByUser`/`assignedToUser` as null even though the scalar
  // `createdBy`/`assignedTo` userId is present — observed especially on
  // bulk-IN queries. Without this hydration, the report would render raw
  // userIds like `n04kedw3hqlpz0Itc75tfvbr` in the Created By column.
  // One batch lookup covers every missing id across the whole result set.
  const missingIds = new Set<string>();
  for (const t of rows) {
    if (!t.createdByUser?.name && t.createdBy) missingIds.add(t.createdBy);
    if (!t.assignedToUser?.name && t.assignedTo) missingIds.add(t.assignedTo);
  }
  let nameMap = new Map<string, { name: string; email?: string }>();
  if (missingIds.size > 0) {
    try {
      const users = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { in: Array.from(missingIds) } },
        select: { id: true, name: true, email: true },
      })) as Array<{ id: string; name: string; email?: string }>;
      nameMap = new Map(
        users.map((u) => [u.id, u.email ? { name: u.name, email: u.email } : { name: u.name }] as const),
      );
    } catch {
      // Non-fatal — fall through to raw-id rendering for whatever didn't resolve.
    }
  }

  const now = new Date();
  // Pre-classify every ticket if the caller asked. Same Date snapshot used
  // for every ticket so the report is internally consistent (no drift
  // between "stale" cutoffs across rows in the same response).
  const reasons = new Map<string, ActionReason>();
  if (opts.classifyActionable) {
    for (const t of rows) reasons.set(t.id, classifyTicket(t, now));
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();
  const lines = rows.map((t) => {
    // Render ticketId as a clickable markdown link when we have the channel +
    // conversation pair needed to deep-link into Spaces. Falls back to plain
    // `[xyneId]` when either is missing so the output never breaks. The
    // deterministic link removes the agent's need to fabricate URLs in its
    // rendered report.
    const ticketUrl = buildTicketUrl(t.channelId, t.conversationId);
    const idCell = ticketUrl ? `[${t.xyneId}](${ticketUrl})` : `[${t.xyneId}]`;
    const parts = [`${idCell} ${t.title} (id: ${t.id})`];
    parts.push(`  Board Status: ${t.statusV2} (workflow state, not PR verification) · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`);
    // Assignee: prefer the joined user (name + email); fall back to the raw
    // assignedTo userId when the relation isn't populated. Always emit the
    // line if EITHER field is present so bulk callers (e.g. user-tickets
    // subagent) can always pin a ticket to a user.
    if (t.assignedToUser || t.assignedTo) {
      const u = t.assignedToUser ?? (t.assignedTo ? nameMap.get(t.assignedTo) : undefined);
      const id = t.assignedTo ?? "";
      const label = u
        ? `${u.name}${u.email ? ` <${u.email}>` : ""}${id ? ` (id: ${id})` : ""}`
        : `userId: ${id}`;
      parts.push(`  Assigned: ${label}`);
    }
    if (t.createdByUser || t.createdBy) {
      const u = t.createdByUser ?? (t.createdBy ? nameMap.get(t.createdBy) : undefined);
      const id = t.createdBy ?? "";
      const label = u
        ? `${u.name}${u.email ? ` <${u.email}>` : ""}${id ? ` (id: ${id})` : ""}`
        : `userId: ${id}`;
      parts.push(`  Created by: ${label}`);
    }
    if (t.board) parts.push(`  Board: ${t.board.name}${t.project ? ` · Project: ${t.project.name}` : ""}`);
    if (t.tags && t.tags.length > 0) parts.push(`  Tags: ${t.tags.map((tg) => tg.name).join(", ")}`);
    if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`);
    if (t.description && t.description.trim().length > 0) {
      // Cap at 1200 chars so a single fat ticket can't blow the response;
      // MID strings are short and usually near the top of the description.
      const trimmed = t.description.trim();
      const body = trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…[truncated]` : trimmed;
      parts.push(`  Description: ${body}`);
    }
    if (t.channelId) parts.push(`  ChannelID: ${t.channelId}`);
    if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`);
    parts.push(`  Created: ${new Date(t.createdAt).toISOString()} · Updated: ${new Date(t.updatedAt).toISOString()}`);
    if (opts.classifyActionable) {
      const reason = reasons.get(t.id) ?? null;
      parts.push(`  Action: ${reason ?? "none"}`);
    }
    pushThreadCitation(citations, seen, t.channelId, t.conversationId, `Ticket ${t.xyneId}`);
    return parts.join("\n");
  });
  const channelInfo = await resolveChannelInfo(citations.map((c) => c.channelId).filter((v): v is string => !!v));
  applyChannelInfo(citations, channelInfo);

  // Render order matters: when the response is large (200+ tickets), claw's
  // agent.ts truncates tool output at MAX_RESULT_LEN. If the Summary were at
  // the END, it'd be the FIRST thing dropped — losing the most useful info
  // for the agent. We put it at the TOP so it always survives truncation.
  const bodyParts: string[] = [];
  if (opts.summary) {
    const summary = buildSummary(rows, reasons, nameMap, opts.expectedUserGroup ?? [], opts.classifyActionable === true);
    bodyParts.push(renderSummaryBlock(summary));
    bodyParts.push(""); // blank separator
  }
  bodyParts.push(`${rows.length} ticket(s):`);
  bodyParts.push("");
  bodyParts.push(lines.join("\n\n"));

  return okCited(bodyParts.join("\n"), citations);
}

/**
 * Compute aggregate counts from the ticket list. Pre-computed action reasons
 * (from classifyTicket) feed actionableCount and the per-user `actionable`
 * column. If a name hydration map is available, byUser rows are labelled
 * with names instead of raw userIds.
 */
function buildSummary(
  rows: TicketRow[],
  reasons: Map<string, ActionReason>,
  nameMap: Map<string, { name: string; email?: string }>,
  expectedUserGroup: string[],
  hasActionableInfo: boolean,
): SummaryShape {
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let actionableCount = 0;

  const userBuckets = new Map<string, UserBreakdownRow>();

  for (const t of rows) {
    const status = (t.statusV2 ?? "UNKNOWN").toUpperCase();
    const priority = (t.priority ?? "UNKNOWN").toUpperCase();
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;

    const isActionable = (reasons.get(t.id) ?? null) !== null;
    if (isActionable) actionableCount += 1;

    const creatorId = t.createdBy ?? "";
    if (!creatorId) continue;
    let bucket = userBuckets.get(creatorId);
    if (!bucket) {
      const user = t.createdByUser ?? nameMap.get(creatorId);
      bucket = {
        userId: creatorId,
        name: user?.name ?? `userId:${creatorId}`,
        email: user?.email ?? null,
        total: 0,
        actionable: 0,
        byStatus: {},
        byPriority: {},
      };
      userBuckets.set(creatorId, bucket);
    }
    bucket.total += 1;
    if (isActionable) bucket.actionable += 1;
    bucket.byStatus[status] = (bucket.byStatus[status] ?? 0) + 1;
    bucket.byPriority[priority] = (bucket.byPriority[priority] ?? 0) + 1;
  }

  // Compute "members with no tickets" against the caller's expected list.
  // Match by email primarily (since the caller usually passes emails); fall
  // back to userId match when an entry doesn't contain '@'.
  let membersWithNoTickets: string[] | undefined;
  if (expectedUserGroup.length > 0) {
    const presentEmails = new Set<string>();
    const presentUserIds = new Set<string>();
    for (const b of userBuckets.values()) {
      if (b.email) presentEmails.add(b.email.toLowerCase());
      presentUserIds.add(b.userId);
    }
    membersWithNoTickets = expectedUserGroup.filter((e) => {
      const lower = e.toLowerCase();
      if (e.includes("@")) return !presentEmails.has(lower);
      return !presentUserIds.has(e);
    });
  }

  const byUser = Array.from(userBuckets.values()).sort((a, b) => b.total - a.total);

  return {
    total: rows.length,
    hasActionableInfo,
    ...(hasActionableInfo ? { actionableCount } : {}),
    byStatus,
    byPriority,
    byUser,
    ...(membersWithNoTickets ? { membersWithNoTickets } : {}),
  };
}

/**
 * Render a deterministic Summary block at the end of the tool response.
 * The agent doesn't need to count anything — it copies these numbers.
 */
function renderSummaryBlock(s: SummaryShape): string {
  const L: string[] = [];
  L.push(`Summary:`);
  L.push(`  Total: ${s.total}`);
  // Skip Actionable line when classification didn't run — emitting "0" would
  // be misleading (it'd mean "we didn't classify" not "no actionable tickets").
  if (s.hasActionableInfo) {
    L.push(`  Actionable: ${s.actionableCount ?? 0}`);
  }

  const statuses = Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]);
  if (statuses.length > 0) {
    L.push(`  ByStatus: ${statuses.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }
  const priorities = Object.entries(s.byPriority).sort((a, b) => b[1] - a[1]);
  if (priorities.length > 0) {
    L.push(`  ByPriority: ${priorities.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }

  if (s.byUser.length > 0) {
    L.push(`  ByUser:`);
    for (const u of s.byUser) {
      const status = Object.entries(u.byStatus).map(([k, v]) => `${k}=${v}`).join(",");
      const prio = Object.entries(u.byPriority).map(([k, v]) => `${k}=${v}`).join(",");
      const actionableField = s.hasActionableInfo ? ` actionable=${u.actionable}` : "";
      L.push(
        `    - ${u.name}${u.email ? ` <${u.email}>` : ""} (id: ${u.userId}) — total=${u.total}${actionableField} status=[${status}] priority=[${prio}]`,
      );
    }
  }

  if (s.membersWithNoTickets && s.membersWithNoTickets.length > 0) {
    L.push(`  MembersWithNoTickets: ${s.membersWithNoTickets.join(", ")}`);
  }

  return L.join("\n");
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
  // Description body of the ticket (markdown). Often contains the MID (merchant
  // id) and other free-form context the agent needs but isn't in scalar columns.
  // Surfacing it here means a single spaces-tickets call gives the agent enough
  // to fill the MID column without spaces-messages.
  description?: string;
  // Raw foreign keys — always present in Prisma scalar output even when the
  // relation include is omitted / unpopulated. Used as a fallback in
  // formatTickets so we never lose the creator/assignee identity in bulk
  // results when Spaces' /api/query doesn't hydrate the relation object.
  assignedTo?: string;
  createdBy?: string;
  assignedToUser?: { name: string; email?: string } | null;
  createdByUser?: { name: string; email?: string } | null;
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
  async handler(args, ctx) {
    try {
      const where: Record<string, unknown> = {
        userId: { equals: ctx.userId },
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

// ── spaces-create-ticket ────────────────────────────────────────────

const spacesCreateTicket: ToolDef = {
  name: "spaces-create-ticket",
  description:
    "Create a new ticket in Spaces. Requires projectId, boardId, and channelId — " +
    "use spaces-projects, spaces-boards, and spaces-channels to look these up first. " +
    "The ticket lives in the channel identified by channelId. " +
    "If the user's triggering message had file attachments, ALSO pass attachConversationId " +
    "= the conversationId from your session (the thread that triggered this run). " +
    "Attachments will be copied from that conversation onto the ticket in the same operation. " +
    "attachConversationId is attachments-only — it does NOT change where the ticket lives.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Ticket title" },
      description: { type: "string", description: "Ticket description" },
      projectId: { type: "string", description: "Project ID (use spaces-projects to find)" },
      boardId: { type: "string", description: "Board ID (use spaces-boards to find)" },
      channelId: { type: "string", description: "Channel ID where the ticket will live (use spaces-channels to find)." },
      attachConversationId: {
        type: "string",
        description: "Optional. ConversationId of the user's triggering message. When set, any file attachments on that message are copied to the new ticket in the same operation. Does NOT affect routing — channelId still determines where the ticket lives.",
      },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Ticket priority" },
      assignedTo: { type: "string", description: "User ID to assign (use spaces-users to find)" },
      eta: { type: "string", description: "Due date as ISO 8601 string" },
      tags: { type: "array", items: { type: "string" }, description: "Tags to apply" },
    },
    required: ["title", "description", "projectId", "boardId", "channelId"],
  },
  async handler(args, ctx) {
    try {
      if (!args["channelId"]) {
        return err("channelId is required.");
      }

      const attachConversationId = (args["attachConversationId"] as string | undefined)?.trim() || undefined;

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

      // WORKAROUND for xyne-backend bug (ticketController.ts:500): when the
      // body omits createdBy, the conversationParticipant.upsert in the
      // ticket-create path passes `userId: undefined` and Prisma 500s the
      // whole request. The backend's ticket itself uses `finalCreatedBy`
      // (req.body.createdBy || req.user.id) which works fine — only the
      // participant upsert reads the raw body field. Explicitly pass
      // createdBy = ctx.userId here so the participant insert sees a real
      // userId. Remove once the backend fix lands (use finalCreatedBy in
      // that upsert).
      if (ctx.userId) body["createdBy"] = ctx.userId;

      // Step 1: create the ticket. channelId in the body, no
      // sourceConversationId — routing is honored as the caller specified.
      const data = (await spacesFetch("/api/tickets", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { id: string; xyneId: string; conversationId: string; title: string; priority: string; status: string };

      // Step 2: if the caller wants attachments carried over from another
      // conversation, transfer them via the existing standalone endpoint.
      // From the agent's POV this remains a single tool call (one approval).
      // We do not modify the spaces backend — both requests come from this
      // handler. If the transfer fails, the ticket itself still exists; we
      // surface the error in the response text so the model can report it.
      let attachLine = "";
      if (attachConversationId) {
        try {
          const attachResp = (await spacesFetch(
            `/api/tickets/${encodeURIComponent(data.id)}/attachments/from-conversation`,
            {
              method: "POST",
              body: JSON.stringify({ sourceConversationId: attachConversationId }),
            },
          )) as { count?: number };
          const count = typeof attachResp?.count === "number" ? attachResp.count : 0;
          attachLine = count > 0
            ? `  Attachments: ${count} file(s) carried over`
            : `  Attachments: 0 files found on source conversation`;
        } catch (e) {
          attachLine = `  Attachments: transfer failed — ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      return ok([
        `Ticket created:`,
        `  xyneId: ${data.xyneId}`,
        `  ID: ${data.id}`,
        `  Status: ${data.status}`,
        `  Priority: ${data.priority}`,
        `  ConversationID: ${data.conversationId}`,
        ...(attachLine ? [attachLine] : []),
      ].join("\n"));
    } catch (e) {
      return err(`Create ticket error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

// ── spaces-update-ticket ────────────────────────────────────────────

const spacesUpdateTicket: ToolDef = {
  name: "spaces-update-ticket",
  description:
    "Update an existing ticket in Spaces. At least one update field must be provided. " +
    "Use spaces-tickets to find the ticket ID (use the Internal ID, not the Xyne ID), spaces-users for user IDs, and spaces-boards for valid stage names. " +
    "Stage changes also update the ticket status to the stage's default status unless you explicitly provide a status override.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId: { type: "string", description: "Internal database ID of the ticket to update (use spaces-tickets to find — use 'Internal ID', not 'Xyne ID')" },
      assigneeId: { type: "string", description: "User ID to assign the ticket to (use spaces-users to find)" },
      stage: { type: "string", description: "Stage name to move the ticket to (must be a valid stage on the ticket's board)" },
      groupId: { type: "string", description: "User group ID to assign to the ticket" },
      title: { type: "string", description: "New title for the ticket" },
      description: { type: "string", description: "New description for the ticket" },
      priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "New priority" },
      status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "New status. Note: changing the stage may also change the status to the stage's default — provide this field to override." },
      eta: { type: "string", description: "New due date as ISO 8601 string (e.g. '2026-06-01T00:00:00Z')" },
    },
    required: ["ticketId"],
  },
  async handler(args, ctx) {
    try {
      const ticketId = String(args["ticketId"] ?? "").trim();
      const assigneeId = (args["assigneeId"] as string | undefined)?.trim();
      const stage = (args["stage"] as string | undefined)?.trim();
      const groupId = (args["groupId"] as string | undefined)?.trim();
      const title = (args["title"] as string | undefined)?.trim();
      const description = (args["description"] as string | undefined)?.trim();
      const priority = (args["priority"] as string | undefined)?.trim();
      const status = (args["status"] as string | undefined)?.trim();
      const eta = (args["eta"] as string | undefined)?.trim();

      if (!ticketId) return err("ticketId is required.");
      if (!assigneeId && !stage && !groupId && !title && !description && !priority && !status && !eta) {
        return err("At least one update field is required (assigneeId, stage, groupId, title, description, priority, status, or eta).");
      }

      const body: Record<string, unknown> = {};
      if (assigneeId) body["assigneeId"] = assigneeId;
      if (stage) body["stage"] = stage;
      if (groupId) body["groupId"] = groupId;
      if (title) body["title"] = title;
      if (description) body["description"] = description;
      if (priority) body["priority"] = priority;
      if (status) body["status"] = status;
      if (eta) body["eta"] = eta;

      const result = (await spacesFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })) as { success: boolean; updated?: string[] };

      const updates = result.updated ?? [];
      return ok(`Ticket ${ticketId} updated${updates.length > 0 ? `: ${updates.join(", ")}` : ""}.`);
    } catch (e) {
      return err(`Update ticket error: ${e instanceof Error ? e.message : String(e)}`);
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


// ── spaces-whoami ─────────────────────────────────────────────────────

const spacesWhoami: ToolDef = {
  name: "spaces-whoami",
  description:
    "Returns the current user's Spaces profile — userId, name, email and workspaceId of the User " +
    "Call this first to get the userId needed for filtering other tools (e.g. assignedTo, from, createdBy).",
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    try {
      if (!ctx.userId) return err("Could not determine current user.");
      const rows = (await interact({
        model: "user",
        operation: "findMany",
        where: { id: { equals: ctx.userId } },
        take: 1,
      })) as Array<{ id: string; name: string; email: string; workspaceId: string }>;
      const u = rows?.[0];
      if (!u) return ok(`Current user ID: ${ctx.userId} (profile not found)`);
      return ok(`Current user:\n- ID: ${u.id}\n- Name: ${u.name}\n- Email: ${u.email}\n- Workspace ID: ${u.workspaceId}`);
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
      const workspaceId = process.env["XYNE_SPACES_WORKSPACE_ID"] ?? "";
      const cookieParts: string[] = [];
      if (sessionId) cookieParts.push(`xyne_session=${sessionId}`);
      if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
      const cookieHeader = cookieParts.join("; ");
      const url = `${baseUrl}/api/docs/publish`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(sessionId ? { "x-session-id": sessionId } : {}),
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
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

// ── spaces-read-canvas ──────────────────────────────────────────────

const spacesReadCanvas: ToolDef = {
  name: "spaces-read-canvas",
  description:
    "Read the full markdown content of an existing canvas. " +
    "Pass the viewAccessId (the ID from the canvas URL: /chat/canvas/<viewAccessId>). " +
    "Returns the canvas title and markdown body.",
  inputSchema: {
    type: "object",
    properties: {
      viewAccessId: {
        type: "string",
        description: "viewAccessId of the canvas to read — the ID that appears in the canvas URL.",
      },
    },
    required: ["viewAccessId"],
  },
  async handler(params, ctx) {
    try {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      if (!viewAccessId) return err("viewAccessId is required");

      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const result = (await spacesFetch(
        `/api/internal/canvas/view/${encodeURIComponent(viewAccessId)}`,
        {
          method: "GET",
          headers: { "x-user-id": ctx.userId },
        },
        { s2sKey }
      )) as { title?: string; markdown?: string; url?: string; error?: string };

      if (result.error) return err(result.error);
      const title = result.title ?? "Untitled";
      const markdown = result.markdown ?? "";
      const url = result.url ?? "";

      return ok([
        `# ${title}`,
        ``,
        `URL: ${url}`,
        ``,
        markdown,
      ].join("\n"));
    } catch (e) {
      return err(`Read canvas error: ${e instanceof Error ? e.message : String(e)}`);
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
  async handler(params, ctx) {
    try {
      const viewAccessId = String(params["viewAccessId"] ?? "").trim();
      const content = String(params["content"] ?? "");
      const title = params["title"] ? String(params["title"]) : undefined;
      if (!viewAccessId) return err("viewAccessId is required");
      if (!content) return err("content is required");

      const s2sKey = process.env["INTERNAL_S2S_KEY"] ?? "";
      const result = (await spacesFetch(
        `/api/internal/canvas/view/${encodeURIComponent(viewAccessId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ markdown: content, ...(title ? { title } : {}) }),
          headers: { "x-user-id": ctx.userId },
        },
        { s2sKey }
      )) as { url?: string | null; title?: string; viewAccessId?: string; error?: string; updatedAt?: string };

      if (result.error) return err(result.error);
      return ok(`Canvas updated.\nTitle: ${result.title ?? "(unknown)"}\nURL: ${result.url ?? "(unknown)"}`);
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

// ── spaces-create-canvas ────────────────────────────────────────────
const spacesCreateCanvas: ToolDef = {
  name: "spaces-create-canvas",
  description:
    "Create a new canvas in Xyne Spaces from markdown content. " +
    "Returns the canvas URL and viewAccessId. " +
    "The user will be set as an OWNER of the canvas.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the canvas",
      },
      markdown: {
        type: "string",
        description: "Content in markdown format (max 5MB)",
      },
      visibility: {
        type: "string",
        enum: ["PUBLIC", "PRIVATE"],
        description: "Visibility: PUBLIC (team-visible) or PRIVATE (invite-only). Default: PRIVATE",
      },
    },
    required: ["title", "markdown"],
  },
  async handler(args) {
    try {
      const title = String(args["title"] ?? "").trim();
      const markdown = String(args["markdown"] ?? "");
      const visibility = String(args["visibility"] ?? "PRIVATE");

      if (!title) return err("Title is required");
      if (!markdown) return err("Markdown content is required");

      const data = (await spacesFetch("/api/canvas/create", {
        method: "POST",
        body: JSON.stringify({
          title,
          markdown,
          visibility: visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE",
        }),
      })) as {
        id: string;
        viewAccessId: string;
        title: string;
        url: string;
        visibility: string;
      };

      return ok([
        `Canvas created successfully!`,
        ``,
        `Title: ${data.title}`,
        `URL: ${data.url}`,
        `Visibility: ${data.visibility}`,
        `View Access ID: ${data.viewAccessId}`,
      ].join("\n"));
    } catch (e) {
      return err(`Create canvas error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};


// ── spaces-emails ──────────────────────────────────────────────────

const spacesEmails: ToolDef = {
  name: "spaces-emails",
  description:
    "Get the full email thread for an Xyne Desk ticket. Returns all emails (inbound and outbound) " +
    "associated with a desk ticket's conversation — subject, from, to, cc, bcc, body, and timestamps. " +
    "Use the conversationId from spaces-tickets results. Desk tickets have their email history here; " +
    "regular chat messages live in spaces-messages instead.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "The conversationId from a spaces-tickets desk ticket." },
      limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max emails to return (default 20)" },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"]);
      const take = (args["limit"] as number | undefined) ?? 20;

      const rows = (await interact({
        model: "email",
        operation: "findMany",
        where: { conversationId: { equals: conversationId } },
        orderBy: [{ createdAt: "asc" }],
        take,
      })) as EmailRow[];

      if (!rows || rows.length === 0) return ok(`No emails found for conversation ${conversationId}.`);

      const lines = rows.map((e, idx) => {
        const parts = [`[${idx + 1}] ${e.type === "DEFAULT" ? "\u{1F4E5} Inbound" : "\u{1F4E4} Outbound"}`];
        parts.push(`  Subject: ${e.subject}`);
        parts.push(`  From: ${e.from}`);
        parts.push(`  To: ${Array.isArray(e.to) ? e.to.join(", ") : e.to}`);
        if (e.cc && e.cc.length > 0) parts.push(`  CC: ${e.cc.join(", ")}`);
        if (e.bcc && e.bcc.length > 0) parts.push(`  BCC: ${e.bcc.join(", ")}`);
        parts.push(`  Date: ${new Date(e.createdAt).toLocaleString()}`);
        const body = e.body
          ? e.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
          : "(no body)";
        parts.push(`  Body: ${body}${e.body && e.body.length > 500 ? "..." : ""}`);
        return parts.join("\n");
      });

      const citations: Citation[] = [];
      const seen = new Set<string>();
      const channelId = rows.find((r) => r.channelId)?.channelId;
      pushThreadCitation(citations, seen, channelId, conversationId, "Desk email thread");
      const channelInfo = await resolveChannelInfo(
        citations.map((c) => c.channelId).filter((v): v is string => !!v),
      );
      applyChannelInfo(citations, channelInfo);

      return okCited(`${rows.length} email(s) in thread:\n\n${lines.join("\n\n")}`, citations);
    } catch (e) {
      return err(`Emails error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

interface EmailRow {
  id: string;
  type: string;
  subject: string;
  body: string;
  to: string[];
  from: string;
  cc: string[];
  bcc: string[];
  conversationId: string;
  channelId: string;
  createdAt: string;
}

// ── spaces-thread-attachments / spaces-fetch-attachment ──────────────
// Surface non-trigger thread attachments to the agent. The webhook path
// only ships attachments from the @mention message itself; without these
// tools, the agent has no way to reach files posted earlier in the
// thread. Both tools rely on the python query gateway's messageAttachment
// allowlist + the existing MessageAttachmentsACL (workspaceId scoped).

interface MessageAttachmentRow {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  createdAt: string;
  uploadedByUserId: string;
  entityId: string;          // messageId for CHAT entityType
  url?: string;
  isDeleted?: boolean;
}

const spacesThreadAttachments: ToolDef = {
  name: "spaces-thread-attachments",
  description:
    "List every non-deleted attachment in a Spaces conversation thread. " +
    "Pass the conversationId from your Session Metadata block. " +
    "Returns one line per attachment with id, filename, mimetype, size, uploader, posted time, and source messageId. " +
    "Use the returned id with spaces-fetch-attachment to download.",
  inputSchema: {
    type: "object",
    properties: {
      conversationId: { type: "string", description: "Thread/conversation id (from Session Metadata or spaces-messages results)." },
      limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max attachments to return (default 50)." },
    },
    required: ["conversationId"],
  },
  async handler(args) {
    try {
      const conversationId = String(args["conversationId"] ?? "");
      if (!conversationId) return err("conversationId is required");
      const limit = (args["limit"] as number | undefined) ?? 50;

      const rows = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { conversationId: { equals: conversationId }, isDeleted: { equals: false } },
        orderBy: [{ createdAt: "asc" }],
        take: limit,
      })) as MessageAttachmentRow[];

      if (!rows || rows.length === 0) {
        return ok(`No attachments in conversation ${conversationId}.`);
      }

      const lines = rows.map((r) =>
        `- id=${r.id}  ${r.originalFilename}  (${r.mimetype}, ${r.size}B)  uploadedBy=${r.uploadedByUserId}  at=${r.createdAt}  messageId=${r.entityId}`,
      );
      return ok(`${rows.length} attachment(s) in ${conversationId}:\n\n${lines.join("\n")}`);
    } catch (e) {
      return err(`Thread attachments error: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
};

const spacesFetchAttachment: ToolDef = {
  name: "spaces-fetch-attachment",
  description:
    "Download a Spaces attachment by id. The file lands in `.context/<fileName>` inside the agent's workspace; " +
    "use the standard `read` tool to view it afterwards. " +
    "Use this AFTER spaces-thread-attachments to retrieve specific files the user is asking about.",
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string", description: "Attachment id from spaces-thread-attachments." },
    },
    required: ["attachmentId"],
  },
  async handler(args) {
    try {
      const attachmentId = String(args["attachmentId"] ?? "");
      if (!attachmentId) return err("attachmentId is required");

      // Look up metadata so we can name the file correctly downstream.
      const meta = (await interact({
        model: "messageAttachment",
        operation: "findMany",
        where: { id: { equals: attachmentId }, isDeleted: { equals: false } },
        take: 1,
      })) as MessageAttachmentRow[];
      if (!meta || meta.length === 0) {
        return err(`Attachment ${attachmentId} not found or deleted`);
      }
      const m = meta[0]!;

      // Download via the user-token route. The MCP child has the user's
      // bearer in XYNE_SPACES_TOKEN, so this resolves the same as a UI fetch.
      const { buffer } = await spacesFetchBuffer(`/api/attachments/${encodeURIComponent(attachmentId)}/download`);

      // Sanitise filename to keep it within .context/ — strip path separators
      // and leading dots so the agent can't be tricked into reading outside.
      const safeName = m.originalFilename.replace(/[/\\]/g, "_").replace(/^\.+/, "");

      // Marker format consumed by xyne-claw/src/mcp.ts which decodes the
      // base64 and writes the buffer to .context/<fileName> in the workspace.
      return ok(`[SPACES_ATTACHMENT:${safeName}:${m.mimetype}]\n${buffer.toString("base64")}`);
    } catch (e) {
      return err(`Fetch attachment error: ${e instanceof Error ? e.message : String(e)}`);
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
  spacesEmails,
  spacesThreadAttachments,
  spacesFetchAttachment,
  spacesCreateTicket,
  spacesUpdateTicket,
  spacesScheduleCall,
  spacesPublishDocs,
  spacesReadCanvas,
  spacesEditCanvas,
  spacesTriggerAgent,
  spacesCreateCanvas,
];
