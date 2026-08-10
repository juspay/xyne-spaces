#!/usr/bin/env node
/**
 * MCP Server for Xyne Spaces
 *
 * Provides tools to interact with Spaces — search, tickets, messages, channels, users, and more.
 * Speaks plain stdio MCP, so any MCP-capable client can run it.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import { spacesFetch } from "./auth.js"
import {
  queryTickets,
  queryMessages,
  queryMessageDetail,
  queryChannels,
  queryConversations,
  queryUsers,
  queryUserActivity,
  queryProjects,
  queryBoards,
} from "./query.js"

// ── Tool Definitions ─────────────────────────────────────────────────

const tools: Tool[] = [
  {
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
  },
  {
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
  },
  {
    name: "spaces-tickets",
    description:
      "List and filter tickets in Spaces. Filter by status, priority, assignee, board, project, or stage. " +
      "Returns ticket details including assignee, tags, stage, and conversation ID.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "Filter by status" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Filter by priority" },
        assignedTo: { type: "string", description: "Filter by assigned user's ID (use spaces-users to find user IDs)" },
        createdBy: { type: "string", description: "Filter by ticket creator's user ID" },
        boardId: { type: "string", description: "Filter by board ID (use spaces-search to find board IDs)" },
        projectId: { type: "string", description: "Filter by project ID (use spaces-search to find project IDs)" },
        stageName: { type: "string", description: "Filter by stage name" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max tickets (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
    },
  },
  {
    name: "spaces-messages",
    description:
      "Read messages in a conversation thread. IMPORTANT: Use the conversationId field from spaces-tickets results (NOT the channel ID or ticket ID). " +
      "Messages are returned in chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "The conversationId field from spaces-tickets or spaces-activity results. This is NOT a channelId, ticketId, or messageId." },
        limit: { type: "number", minimum: 1, maximum: 100, default: 30, description: "Max messages (default 30)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
      required: ["conversationId"],
    },
  },
  {
    name: "spaces-message-detail",
    description:
      "Get detailed information about a specific message including full content, sender details, " +
      "reactions (with counts), and attachments. Use messageId from spaces-messages or spaces-activity results.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "The messageId field from spaces-messages or spaces-activity results. This is NOT a conversationId, channelId, or ticketId." },
      },
      required: ["messageId"],
    },
  },
  {
    name: "spaces-channels",
    description:
      "List channels in Spaces. Can filter by visibility (PUBLIC/PRIVATE), scope type (DEFAULT/DM/TICKET/GROUP_DM), " +
      "and participant name. Returns channel name, participant count, last activity, and ChannelID. " +
      "To find a DM between two people, use scopeType='DM' and participantName to filter by one of them. " +
      "A channel is a container of threads and has NO conversationId of its own — to post in a channel, " +
      "pass its ChannelID to spaces-conversations (to reply in an existing thread) or to " +
      "spaces-create-conversation (to start a new one). Results are ordered by most recent activity, " +
      "so raise limit or filter by visibility/scopeType when looking for a dormant channel.",
    inputSchema: {
      type: "object",
      properties: {
        visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
        scopeType: { type: "string", enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"], description: "Filter by scope type" },
        participantName: { type: "string", description: "Filter channels by participant name (partial match)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max channels (default 20)" },
      },
    },
  },
  {
    name: "spaces-conversations",
    description:
      "List conversation threads inside a channel, newest activity first. This is how you turn a " +
      "ChannelID into a conversationId — channels do not have one. Returns each thread's " +
      "ConversationID, author, opening message preview, and reply count. " +
      "Use the ConversationID with spaces-messages to read a thread or spaces-send-message to reply.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The ChannelID from spaces-channels results" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max threads (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
      required: ["channelId"],
    },
  },
  {
    name: "spaces-create-conversation",
    description:
      "Start a NEW conversation thread in a channel and post its first message. " +
      "Use this to post something new in a channel — spaces-send-message can only reply to a thread " +
      "that already exists. Returns the new ConversationID and messageId. " +
      "Requires the Spaces desktop app to be running and the channel to be one you can post in.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "The ChannelID to start the thread in (from spaces-channels)" },
        content: { type: "string", description: "The opening message content" },
      },
      required: ["channelId", "content"],
    },
  },
  {
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
  },
  {
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
  },
  {
    name: "spaces-projects",
    description: "Search and list projects to find project IDs for creating tickets. Can filter by name with pagination support.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filter by project name (partial match)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
    },
  },
  {
    name: "spaces-boards",
    description: "Search and list boards to find board IDs for creating tickets. Can filter by name or project ID with pagination support.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filter by board name (partial match)" },
        projectId: { type: "string", description: "Filter by project ID (use spaces-projects to find project IDs)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max results (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
    },
  },
  {
    name: "spaces-send-message",
    description:
      "Reply to an EXISTING conversation thread. Requires a conversationId — from spaces-conversations, " +
      "spaces-tickets, or spaces-activity (NOT a channelId or ticketId). " +
      "To post in a channel that has no suitable thread yet, use spaces-create-conversation instead.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "The ConversationID to reply to (from spaces-conversations, spaces-tickets, or spaces-activity)" },
        content: { type: "string", description: "Message content to send" },
      },
      required: ["conversationId", "content"],
    },
  },
  {
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
  },
  {
    name: "spaces-schedule-call",
    description: "Schedule a call in Spaces. Must provide either a channelId or targetUserIds (list of user IDs to invite).",
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
  },
  {
    name: "spaces-webfetch",
    description:
      "Fetch an external URL and return its content as markdown or text. " +
      "Only use for URLs outside Spaces (e.g. GitHub PRs, docs, external links from messages). " +
      "Do NOT use for Spaces internal URLs — use the other spaces tools instead.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        format: { type: "string", enum: ["text", "markdown", "html"], default: "markdown", description: "Output format (default: markdown)" },
      },
      required: ["url"],
    },
  },
]

// ── Tool Handlers ────────────────────────────────────────────────────

interface SearchResult {
  id: string
  type: string
  title: string
  subtitle?: string
  context?: string
  metadata?: Record<string, unknown>
  searchContext?: Record<string, unknown>
}

function formatSearchResult(r: SearchResult): string {
  const lines = [`[${r.type}] ${r.title}${r.subtitle ? ` — ${r.subtitle}` : ""}`]
  if (r.context) lines.push(`  ${r.context.replace(/<\/?[^>]+>/g, "").slice(0, 300)}`)
  const meta = r.metadata
  if (meta) {
    const p: string[] = []
    if (meta["timestamp"]) p.push(`${meta["timestamp"]}`)
    if (meta["channelName"]) p.push(`#${meta["channelName"]}`)
    if (meta["status"]) p.push(`status: ${meta["status"]}`)
    if (p.length > 0) lines.push(`  ${p.join(" · ")}`)
  }
  const sc = r.searchContext
  if (sc) {
    if (sc["senderName"]) lines.push(`  From: ${sc["senderName"]}`)
    if (sc["xyneId"]) lines.push(`  ID: ${sc["xyneId"]}`)
  }
  return lines.join("\n")
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "spaces-search": {
      const params = new URLSearchParams()
      params.set("q", (args.query as string) ?? "")
      params.set("limit", String(args.limit ?? 10))
      if (args.offset) params.set("offset", String(args.offset))
      if (args.apps) params.set("apps", args.apps as string)
      if (args.type) params.set("type", args.type as string)
      if (args.from) params.set("from", args.from as string)
      if (args.in) params.set("in", args.in as string)
      if (args.status) params.set("status", args.status as string)
      if (args.priority) params.set("priority", args.priority as string)
      if (args.board) params.set("board", args.board as string)
      if (args.tags) params.set("tags", args.tags as string)
      if (args.stage) params.set("stage", args.stage as string)
      if (args.assignee) params.set("assignee", args.assignee as string)
      if (args.before) params.set("before", args.before as string)
      if (args.after) params.set("after", args.after as string)
      if (args.range) params.set("range", args.range as string)
      if (args.filterOnly) params.set("filterOnly", "true")

      const data = (await spacesFetch(`/search?${params}`)) as {
        success: boolean
        data?: {
          grouped: boolean
          groups?: Array<{ groupValue: string; count: number; results: SearchResult[] }>
          results?: SearchResult[]
          totalCount?: number
        }
      }

      if (!data.success || !data.data) return "Search failed."

      if (data.data.grouped && data.data.groups) {
        const groups = data.data.groups
        if (groups.length === 0) return `No results found for "${args.query}".`
        const parts: string[] = []
        for (const group of groups) {
          parts.push(`--- ${group.groupValue} (${group.count}) ---`)
          for (const r of group.results) parts.push(formatSearchResult(r))
          parts.push("")
        }
        return parts.join("\n")
      }

      const results = data.data.results ?? []
      if (results.length === 0) return `No results found for "${args.query}".`
      return `Found ${data.data.totalCount ?? results.length} result(s):\n\n${results.map(formatSearchResult).join("\n\n")}`
    }

    case "spaces-memory-search": {
      const body: Record<string, unknown> = {
        scope: args.scope ?? "my",
        limit: args.limit ?? 10,
        offset: args.offset ?? 0,
        includeSummary: true,
        includeQuery: true,
      }
      if (args.query) body["query"] = args.query
      if (args.docType) body["docType"] = args.docType
      if (args.tags) body["tags"] = args.tags
      if (args.reviewStatus) body["reviewStatus"] = args.reviewStatus

      const data = (await spacesFetch("/memory/search", {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        success?: boolean
        data?: {
          documents?: Array<{
            docId: string
            docType: string
            userQuery?: string
            chatSummary?: string[]
            rawContent?: string
            tags?: string[]
            reviewStatus?: string
            createdAt?: number
          }>
          pagination?: { total: number }
        }
      }

      const docs = data.data?.documents ?? []
      if (docs.length === 0) return args.query ? `No memory results for "${args.query}".` : "No memory entries found."
      const parts = docs.map((d) => {
        const lines = [`[${d.docType}] ${d.docId}`]
        if (d.userQuery) lines.push(`  Query: ${d.userQuery}`)
        if (d.chatSummary?.length) lines.push(`  Summary: ${d.chatSummary.join(" ")}`)
        else if (d.rawContent) lines.push(`  ${d.rawContent.slice(0, 300)}${d.rawContent.length > 300 ? "..." : ""}`)
        if (d.tags?.length) lines.push(`  Tags: ${d.tags.join(", ")}`)
        if (d.reviewStatus) lines.push(`  Review: ${d.reviewStatus}`)
        return lines.join("\n")
      })
      return `Found ${data.data?.pagination?.total ?? docs.length} result(s):\n\n${parts.join("\n\n")}`
    }

    case "spaces-tickets": {
      return queryTickets({
        status: args.status as string | undefined,
        priority: args.priority as string | undefined,
        assignedTo: args.assignedTo as string | undefined,
        createdBy: args.createdBy as string | undefined,
        boardId: args.boardId as string | undefined,
        projectId: args.projectId as string | undefined,
        stageName: args.stageName as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      })
    }

    case "spaces-messages": {
      return queryMessages(
        args.conversationId as string,
        (args.limit as number) ?? 30,
        (args.offset as number) ?? 0
      )
    }

    case "spaces-message-detail": {
      return queryMessageDetail(args.messageId as string)
    }

    case "spaces-channels": {
      return queryChannels(
        (args.limit as number) ?? 20,
        args.visibility as string | undefined,
        args.scopeType as string | undefined,
        args.participantName as string | undefined
      )
    }

    case "spaces-conversations": {
      return queryConversations(
        args.channelId as string,
        (args.limit as number) ?? 20,
        (args.offset as number) ?? 0
      )
    }

    case "spaces-create-conversation": {
      const data = (await spacesFetch(
        `/channels/${encodeURIComponent(args.channelId as string)}/conversations`,
        {
          method: "POST",
          body: JSON.stringify({ content: args.content }),
        }
      )) as {
        conversationId: string
        channelId: string
        initialMessage?: { messageId: string }
      }

      return [
        `Conversation started:`,
        `  ConversationID: ${data.conversationId}`,
        `  ChannelID: ${data.channelId}`,
        `  messageId: ${data.initialMessage?.messageId ?? "(unknown)"}`,
        ``,
        `Reply to this thread with spaces-send-message using the ConversationID above.`,
      ].join("\n")
    }

    case "spaces-users": {
      return queryUsers(args.nameOrEmail as string, (args.limit as number) ?? 10)
    }

    case "spaces-activity": {
      return queryUserActivity(
        args.classification as string | undefined,
        args.unreadOnly === true ? false : undefined,
        args.limit as number | undefined
      )
    }

    case "spaces-projects": {
      return queryProjects(
        args.search as string | undefined,
        args.limit as number | undefined,
        args.offset as number | undefined
      )
    }

    case "spaces-boards": {
      return queryBoards(
        args.search as string | undefined,
        args.projectId as string | undefined,
        args.limit as number | undefined,
        args.offset as number | undefined
      )
    }

    case "spaces-send-message": {
      const data = (await spacesFetch(`/chat/postMessage/${args.conversationId}`, {
        method: "POST",
        body: JSON.stringify({ content: args.content }),
      })) as { messageId: string; conversationId: string; content: string; sender?: { name: string } }

      return `Message sent. messageId: ${data.messageId}, conversationId: ${data.conversationId}`
    }

    case "spaces-create-ticket": {
      const body: Record<string, unknown> = {
        title: args.title,
        description: args.description,
        projectId: args.projectId,
        boardId: args.boardId,
        channelId: args.channelId,
      }
      if (args.priority) body["priority"] = args.priority
      if (args.assignedTo) body["assignedTo"] = args.assignedTo
      if (args.eta) body["eta"] = args.eta
      if (args.tags) body["tags"] = args.tags

      const data = (await spacesFetch("/ticket/create", {
        method: "POST",
        body: JSON.stringify(body),
      })) as {
        id: string
        xyneId: string
        conversationId: string
        title: string
        priority: string
        status: string
      }

      return [
        `Ticket created:`,
        `  xyneId: ${data.xyneId}`,
        `  ID: ${data.id}`,
        `  Status: ${data.status}`,
        `  Priority: ${data.priority}`,
        `  ConversationID: ${data.conversationId}`,
      ].join("\n")
    }

    case "spaces-schedule-call": {
      if (!args.channelId && (!args.targetUserIds || (args.targetUserIds as string[]).length === 0)) {
        throw new Error("Must provide either channelId or targetUserIds")
      }

      const body: Record<string, unknown> = {
        title: args.title,
        startsAt: new Date(args.startsAt as string).getTime(),
        endsAt: new Date(args.endsAt as string).getTime(),
      }
      if (args.channelId) body["channelId"] = args.channelId
      if (args.targetUserIds) body["targetUserIds"] = args.targetUserIds

      const data = (await spacesFetch("/calls/schedule", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { success: boolean; callId?: string; externalId?: string; channelId?: string }

      if (!data.success) return "Failed to schedule call."
      return [
        `Call scheduled:`,
        `  callId: ${data.callId}`,
        `  externalId: ${data.externalId}`,
        `  channelId: ${data.channelId}`,
      ].join("\n")
    }

    case "spaces-webfetch": {
      const url = args.url as string
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        throw new Error("URL must start with http:// or https://")
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: "text/html;q=1.0, text/plain;q=0.8, */*;q=0.1",
          },
          redirect: "follow",
        })
        clearTimeout(timer)

        if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`)

        const contentType = response.headers.get("content-type") ?? ""
        let text = await response.text()

        if (contentType.includes("html") && args.format !== "html") {
          text = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        }

        if (text.length > 15000) text = text.slice(0, 15000) + "\n\n... (truncated)"
        return text
      } finally {
        clearTimeout(timer)
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ── MCP Server ───────────────────────────────────────────────────────

const server = new Server(
  {
    name: "xyne-spaces-mcp",
    version: "0.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>)
    return {
      content: [{ type: "text", text: result }],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    }
  }
})

// ── Start Server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("Xyne Spaces MCP server running on stdio")
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
