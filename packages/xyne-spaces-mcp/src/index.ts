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
  type ServerNotification,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"

import { spacesFetch } from "./auth.js"
import {
  ClawClient,
  clawErrorMessage,
  clearClawConfig,
  formatAgents,
  formatSessions,
  getClawConfigPath,
  loadClawConfig,
  performClawLogin,
  requireClawConfig,
  resolveClawBaseUrl,
  runAndWait,
} from "./claw.js"
import {
  queryTickets,
  queryTicketDetail,
  queryMessages,
  queryMessageDetail,
  queryChannels,
  queryChannelMessages,
  queryChannelParticipants,
  queryUserMessages,
  queryConversations,
  queryUsers,
  queryUserActivity,
  queryProjects,
  queryBoards,
  queryBoardStages,
  queryCalls,
  queryCanvases,
  querySubTickets,
  queryMyDrafts,
  queryEmails,
  queryNotifications,
  queryWhoami,
} from "./query.js"

// ── Tool Definitions ─────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "spaces-whoami",
    description:
      "Identify the current Spaces user — name, email, UserID, and WorkspaceID. " +
      "Call this FIRST whenever a request involves 'me', 'my', 'mine', or 'assigned to me': " +
      "no other tool reveals your own UserID, and filters like assignedTo or createdBy need it. " +
      "Cheap and cached, so calling it early costs nothing.",
    inputSchema: { type: "object", properties: {} },
  },
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
        orderBy: { type: "string", enum: ["newest", "oldest", "relevance"], description: "Result order. Use 'newest' for 'the latest N' — the default is relevance, which cannot be paged through time reliably." },
        groupBy: { type: "string", description: "Pass an empty string to disable grouping and get one flat ranked list" },
        onlyMyChannels: { type: "boolean", description: "Restrict to channels you are a member of — the main way to cut cross-channel noise" },
        includeBotMessages: { type: "boolean", description: "Include bot/automation messages (excluded by default)" },
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
        createdAfter: { type: "string", description: "Only tickets created on/after this ISO date (e.g. 2026-08-01)" },
        createdBefore: { type: "string", description: "Only tickets created on/before this ISO date" },
        updatedAfter: { type: "string", description: "Only tickets updated on/after this ISO date" },
        updatedBefore: { type: "string", description: "Only tickets updated on/before this ISO date" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max tickets (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset" },
      },
    },
  },
  {
    name: "spaces-ticket-detail",
    description:
      "Read one ticket in full — description, status, priority, stage, assignee, and its sub-tickets. " +
      "Accepts either the TicketID (cuid) or the human key like JUSPROD-1234. " +
      "Use this before spaces-update-ticket so you know the current state you are changing.",
    inputSchema: {
      type: "object",
      properties: {
        ticket: { type: "string", description: "TicketID or ticket key (e.g. JUSPROD-1234)" },
      },
      required: ["ticket"],
    },
  },
  {
    name: "spaces-update-ticket",
    description:
      "Update an existing ticket: status, priority, assignee, stage, title, description, ETA, or tags. " +
      "Only the fields you pass are changed. To move a ticket between stages, first call " +
      "spaces-board-stages for its board and pass a stage NAME from that list — an unknown stage is rejected. " +
      "Use spaces-whoami to get your own UserID for assigneeId, or spaces-users to find someone else's.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "TicketID (cuid) from spaces-tickets or spaces-ticket-detail" },
        status: { type: "string", enum: ["TODO", "STARTED", "PAUSED", "CANCELLED", "COMPLETED"], description: "New status" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "New priority" },
        assigneeId: { type: "string", description: "UserID to assign the ticket to" },
        stage: { type: "string", description: "Stage NAME from spaces-board-stages" },
        title: { type: "string", description: "New title" },
        description: { type: "string", description: "New description" },
        eta: { type: "string", description: "Due date as an ISO 8601 string" },
        tags: { type: "array", items: { type: "string" }, description: "Replaces the ticket's tags" },
      },
      required: ["ticketId"],
    },
  },
  {
    name: "spaces-subtickets",
    description: "List the sub-tickets of a ticket, with their stage and assignee. Use the parent's TicketID.",
    inputSchema: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "Parent TicketID" },
      },
      required: ["ticketId"],
    },
  },
  {
    name: "spaces-board-stages",
    description:
      "List a board's stages in workflow order, with the ticket status each implies and whether entry " +
      "needs approval. Required before moving a ticket with spaces-update-ticket, which takes a stage name.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "BoardID from spaces-boards or spaces-ticket-detail" },
      },
      required: ["boardId"],
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
        name: { type: "string", description: "Find channels whose #name contains this text — the way to look up a channel you know by name" },
        visibility: { type: "string", enum: ["PUBLIC", "PRIVATE"], description: "Filter by visibility" },
        scopeType: { type: "string", enum: ["DEFAULT", "DM", "TICKET", "DOCUMENT", "GROUP_DM"], description: "Filter by scope type" },
        participantName: { type: "string", description: "Filter channels by MEMBER name (not the channel's own name — use 'name' for that)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max channels (default 20)" },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset — walk the full list a page at a time" },
      },
    },
  },
  {
    name: "spaces-channel-messages",
    description:
      "Read a channel's message timeline, flattened across all its threads, newest first. " +
      "This is the 'what is happening in this channel' read — pass a ChannelID from spaces-channels. " +
      "Use spaces-messages instead when you want one specific thread by its ConversationID.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "ChannelID from spaces-channels" },
        limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max messages (default 50)" },
        before: { type: "string", description: "Only messages at/before this ISO timestamp — page backwards with the value the previous call reports" },
      },
      required: ["channelId"],
    },
  },
  {
    name: "spaces-user-messages",
    description:
      "Everything a user wrote, newest first, ordered by time. Use this to build someone's authored " +
      "history — it pages reliably, unlike spaces-search with from=<userId>, which ranks by relevance " +
      "so a thin page cannot be told apart from a truncated one. Get the UserID from spaces-users or " +
      "spaces-whoami.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "UserID from spaces-users or spaces-whoami" },
        limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max messages (default 50)" },
        after: { type: "string", description: "Only messages on/after this ISO date" },
        before: { type: "string", description: "Only messages on/before this ISO date — page backwards with the value the previous call reports" },
      },
      required: ["userId"],
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
    name: "spaces-channel-participants",
    description:
      "List who is in a channel, with their role and UserID. Use this to find the right person to " +
      "assign a ticket to or mention, when you know the channel but not the people.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "ChannelID from spaces-channels" },
        limit: { type: "number", minimum: 1, maximum: 200, default: 50, description: "Max participants (default 50)" },
      },
      required: ["channelId"],
    },
  },
  {
    name: "spaces-add-reaction",
    description:
      "Add an emoji reaction to a message. Use the messageId from spaces-messages or spaces-activity. " +
      "The emoji name is the bare name without colons, e.g. 'thumbsup' or 'eyes'.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "The messageId to react to" },
        emojiName: { type: "string", description: "Emoji name without colons, e.g. 'thumbsup'" },
      },
      required: ["messageId", "emojiName"],
    },
  },
  {
    name: "spaces-remove-reaction",
    description: "Remove your own emoji reaction from a message. Only affects your reaction, not other people's.",
    inputSchema: {
      type: "object",
      properties: {
        messageId: { type: "string", description: "The messageId to un-react to" },
        emojiName: { type: "string", description: "Emoji name without colons, e.g. 'thumbsup'" },
      },
      required: ["messageId", "emojiName"],
    },
  },
  {
    name: "spaces-calls",
    description:
      "List calls — scheduled, active, or past — with organizer, timing, join link, and CallID. " +
      "Filter by status or restrict to one channel.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by call status (e.g. SCHEDULED, ONGOING, ENDED)" },
        channelId: { type: "string", description: "Only calls in this ChannelID" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max calls (default 20)" },
      },
    },
  },
  {
    name: "spaces-canvases",
    description:
      "List canvas documents, newest first, with author and CanvasID. Filter by channel or project. " +
      "Canvases marked collaborative are live-edited by a realtime server.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Only canvases in this ChannelID" },
        projectId: { type: "string", description: "Only canvases in this project" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max canvases (default 20)" },
      },
    },
  },
  {
    name: "spaces-emails",
    description:
      "List emails tied to a conversation or channel, with sender, recipients, subject, and body preview. " +
      "Spaces threads can be backed by email, so this shows what was actually sent or received.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string", description: "Only emails in this ConversationID" },
        channelId: { type: "string", description: "Only emails in this ChannelID" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max emails (default 20)" },
      },
    },
  },
  {
    name: "spaces-my-drafts",
    description:
      "List your own unsent message drafts. Resolves your identity internally — no user id needed. " +
      "Drafts are read-only here; to actually post the text use spaces-send-message.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max drafts (default 20)" },
      },
    },
  },
  {
    name: "spaces-notifications",
    description:
      "List your own notifications, newest first. Resolves your identity internally. " +
      "This is distinct from spaces-activity: notifications are delivery records (what was pushed to you), " +
      "while activity is the mention/reply/assignment feed.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (e.g. UNREAD, READ)" },
        limit: { type: "number", minimum: 1, maximum: 50, default: 20, description: "Max notifications (default 20)" },
      },
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
    name: "claw-login",
    description:
      "Log in to Xyne Claw (remote agents) using device flow. Opens your browser to an authorization " +
      "page and polls until a token is minted, then stores it at ~/.xyne/agent/claw.json — the same " +
      "file the Xyne CLI uses, so one login covers both. Claw auth is SEPARATE from the Spaces tools, " +
      "which use the desktop app; being logged into one says nothing about the other.",
    inputSchema: {
      type: "object",
      properties: {
        timeoutSeconds: { type: "number", description: "Max seconds to wait for authorization (default: the server's expiry)" },
      },
    },
  },
  {
    name: "claw-logout",
    description: "Log out of Xyne Claw by deleting the stored ~/.xyne/agent/claw.json token. Does not affect Spaces tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claw-whoami",
    description:
      "Show the stored Xyne Claw login (email, userId, base URL), or report that no login is stored. " +
      "Use this to check Claw auth before dispatching an agent.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claw-list-agents",
    description:
      "List the Xyne Claw remote agents this account can dispatch to. Returns each agent's slug — the " +
      "value claw-run-agent needs. Requires claw-login first.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "claw-list-sessions",
    description:
      "List recent Xyne Claw runs with their session ids and statuses. Use a session id with claw-get-run " +
      "to fetch the full result. Requires claw-login first.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", minimum: 1, maximum: 100, default: 20, description: "Max sessions (default 20)" },
      },
    },
  },
  {
    name: "claw-run-agent",
    description:
      "Dispatch a task to a remote Xyne Claw agent and wait for it to finish. Blocks while polling, so " +
      "prefer a generous timeout for long jobs; on timeout the run usually continues and can be picked up " +
      "with claw-get-run. Optionally deliver the agent's reply into a Spaces thread — pass channelId " +
      "(get one from spaces-channels) to post into that channel, or deliverTo='dm' for the user's own DM. " +
      "Requires claw-login first.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent slug from claw-list-agents" },
        task: { type: "string", description: "The task or prompt to send to the agent" },
        timeoutSeconds: { type: "number", minimum: 1, default: 300, description: "Max seconds to wait (default 300)" },
        channelId: { type: "string", description: "Optional Spaces ChannelID (from spaces-channels) — the agent posts its reply into that channel" },
        deliverTo: { type: "string", enum: ["cli", "dm"], description: "'cli' (default) returns the result here; 'dm' also delivers it to your Spaces DM" },
      },
      required: ["agent", "task"],
    },
  },
  {
    name: "claw-get-run",
    description:
      "Get the status and full detail of one Xyne Claw run by session id, including tool calls, timing, " +
      "and token usage. Use this to check on a run that timed out or was started earlier. Requires claw-login first.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session id from claw-run-agent or claw-list-sessions" },
      },
      required: ["sessionId"],
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
    if (sc["conversationId"]) lines.push(`  ConversationID: ${sc["conversationId"]}`)
    if (sc["channelId"]) lines.push(`  ChannelID: ${sc["channelId"]}`)
  }
  // The result's own id, labelled by what it actually identifies. Without this a
  // channel or ticket hit is a dead end — you can see it but not act on it.
  if (r.id) lines.push(`  ${idLabel(r.type)}: ${r.id}`)
  if (sc?.["xyneId"] && sc["xyneId"] !== r.id) lines.push(`  Key: ${sc["xyneId"]}`)
  return lines.join("\n")
}

/** Name the id field after the thing it points at, so the agent knows what to pass where. */
function idLabel(type: string): string {
  const t = type.toLowerCase()
  if (t.includes("channel")) return "ChannelID"
  if (t.includes("ticket")) return "TicketID"
  if (t.includes("message") || t.includes("conversation")) return "MessageID"
  if (t.includes("user")) return "UserID"
  if (t.includes("attachment") || t.includes("file")) return "AttachmentID"
  return "ID"
}

/**
 * Per-call context. Long-running Claw tools report progress and honour
 * cancellation; every Spaces tool ignores this.
 */
interface ToolContext {
  notify: (message: string) => Promise<void>
  signal?: AbortSignal
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
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
      if (args.orderBy) params.set("orderBy", args.orderBy as string)
      // groupBy is meaningful when empty, so test for presence rather than truth.
      if (args.groupBy !== undefined) params.set("groupBy", args.groupBy as string)
      if (args.onlyMyChannels !== undefined) params.set("onlyMyChannels", String(args.onlyMyChannels))
      if (args.includeBotMessages !== undefined) {
        params.set("includeBotMessages", String(args.includeBotMessages))
      }

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
        createdAfter: args.createdAfter as string | undefined,
        createdBefore: args.createdBefore as string | undefined,
        updatedAfter: args.updatedAfter as string | undefined,
        updatedBefore: args.updatedBefore as string | undefined,
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      })
    }

    case "spaces-whoami": {
      return queryWhoami()
    }

    case "spaces-ticket-detail": {
      return queryTicketDetail(args.ticket as string)
    }

    case "spaces-update-ticket": {
      // Only forward what the caller actually set — the backend treats a present
      // key as an intent to change, so passing undefined would clear fields.
      const body: Record<string, unknown> = {}
      for (const key of ["status", "priority", "title", "description", "eta", "tags", "stage"]) {
        if (args[key] !== undefined) body[key] = args[key]
      }
      if (args.assigneeId !== undefined) body["assigneeId"] = args.assigneeId

      if (Object.keys(body).length === 0) {
        throw new Error("Nothing to update — pass at least one field besides ticketId.")
      }

      await spacesFetch(`/ticket/${encodeURIComponent(args.ticketId as string)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })

      const changed = Object.keys(body).join(", ")
      return `Ticket ${args.ticketId} updated (${changed}).\n\nRe-read it with spaces-ticket-detail to confirm.`
    }

    case "spaces-subtickets": {
      return querySubTickets(args.ticketId as string)
    }

    case "spaces-board-stages": {
      return queryBoardStages(args.boardId as string)
    }

    case "spaces-channel-participants": {
      return queryChannelParticipants(args.channelId as string, (args.limit as number) ?? 50)
    }

    case "spaces-add-reaction": {
      await spacesFetch(`/message/${encodeURIComponent(args.messageId as string)}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emojiName: args.emojiName }),
      })
      return `Reacted :${args.emojiName}: to message ${args.messageId}.`
    }

    case "spaces-remove-reaction": {
      await spacesFetch(
        `/message/${encodeURIComponent(args.messageId as string)}/reactions/${encodeURIComponent(args.emojiName as string)}`,
        { method: "DELETE" }
      )
      return `Removed :${args.emojiName}: from message ${args.messageId}.`
    }

    case "spaces-calls": {
      return queryCalls(
        args.status as string | undefined,
        args.channelId as string | undefined,
        (args.limit as number) ?? 20
      )
    }

    case "spaces-canvases": {
      return queryCanvases(
        args.channelId as string | undefined,
        args.projectId as string | undefined,
        (args.limit as number) ?? 20
      )
    }

    case "spaces-emails": {
      return queryEmails(
        args.conversationId as string | undefined,
        args.channelId as string | undefined,
        (args.limit as number) ?? 20
      )
    }

    case "spaces-my-drafts": {
      return queryMyDrafts((args.limit as number) ?? 20)
    }

    case "spaces-notifications": {
      return queryNotifications(args.status as string | undefined, (args.limit as number) ?? 20)
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
        args.participantName as string | undefined,
        args.name as string | undefined,
        args.offset as number | undefined
      )
    }

    case "spaces-channel-messages": {
      return queryChannelMessages(
        args.channelId as string,
        (args.limit as number) ?? 50,
        args.before as string | undefined
      )
    }

    case "spaces-user-messages": {
      return queryUserMessages(
        args.userId as string,
        (args.limit as number) ?? 50,
        args.after as string | undefined,
        args.before as string | undefined
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

    case "claw-login": {
      const baseUrl = resolveClawBaseUrl()
      const { config, verifyUrl, userCode } = await performClawLogin(
        baseUrl,
        args.timeoutSeconds as number | undefined,
        ctx.notify
      )
      return [
        `Logged in to Xyne Claw${config.email ? ` as ${config.email}` : ""}.`,
        `  Base URL: ${config.baseUrl}`,
        `  Verification URL: ${verifyUrl}`,
        `  User code: ${userCode}`,
        `  Token stored at: ${getClawConfigPath()}`,
      ].join("\n")
    }

    case "claw-logout": {
      const cleared = clearClawConfig()
      return cleared
        ? `Logged out of Claw. Removed ${getClawConfigPath()}.`
        : "Not logged in to Claw — nothing to remove."
    }

    case "claw-whoami": {
      const config = loadClawConfig()
      if (!config) return "Not logged in to Claw. Run claw-login first."
      return [
        `Claw login:`,
        `  Email: ${config.email ?? "(unknown)"}`,
        `  UserID: ${config.userId ?? "(unknown)"}`,
        `  Base URL: ${config.baseUrl}`,
        `  Token: ${config.tokenPrefix ?? "(stored)"}…`,
        `  Since: ${config.createdAt ?? "(unknown)"}`,
      ].join("\n")
    }

    case "claw-list-agents": {
      const config = requireClawConfig()
      const agents = await new ClawClient(resolveClawBaseUrl(), config.token).listAgents()
      return formatAgents(agents)
    }

    case "claw-list-sessions": {
      const config = requireClawConfig()
      const limit = Math.max(1, Math.min((args.limit as number) ?? 20, 100))
      const sessions = await new ClawClient(resolveClawBaseUrl(), config.token).listSessions(limit)
      return formatSessions(sessions)
    }

    case "claw-run-agent": {
      const config = requireClawConfig()
      const agent = args.agent as string
      const task = args.task as string
      const timeoutMs = Math.max(1, (args.timeoutSeconds as number) ?? 300) * 1000

      // Explicit channelId wins; deliverTo:'dm' asks the server to resolve the user's own DM.
      const channelId = args.channelId as string | undefined
      const wantsDm = !channelId && args.deliverTo === "dm"

      const client = new ClawClient(resolveClawBaseUrl(), config.token)
      const run = await runAndWait(
        client,
        agent,
        task,
        timeoutMs,
        ctx.signal,
        (sessionId) => ctx.notify(`Running ${agent} (session ${sessionId})…`),
        channelId,
        wantsDm ? "dm" : undefined
      )

      const delivery = channelId
        ? `\n(reply delivered to Spaces channel ${channelId})`
        : wantsDm
          ? `\n(delivery requested to your Spaces DM)`
          : ""

      if (run.status.toLowerCase() === "completed") {
        return `${run.result ?? "(completed with no output)"}${delivery}\n\nSession: ${run.sessionId}`
      }
      throw new Error(
        `Claw run ${run.status}: ${run.error ?? run.result ?? "(no detail)"}${delivery}\nSession: ${run.sessionId}`
      )
    }

    case "claw-get-run": {
      const config = requireClawConfig()
      const { run, detail } = await new ClawClient(
        resolveClawBaseUrl(),
        config.token
      ).getRunWithDetail(args.sessionId as string)

      const summary = run.error ?? run.result ?? "(no result yet)"
      return `Run ${run.sessionId}: ${run.status}\n${summary}\n\nFull detail:\n${JSON.stringify(detail, null, 2)}`
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

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params

  const ctx: ToolContext = {
    // Progress is best-effort — the final result carries the same information.
    notify: async (message: string) => {
      try {
        await extra.sendNotification({
          method: "notifications/message",
          params: { level: "info", logger: "xyne-spaces-mcp", data: message },
        } satisfies ServerNotification)
      } catch {
        // Client does not support notifications; ignore.
      }
    },
    signal: extra.signal,
  }

  try {
    const result = await handleToolCall(name, (args ?? {}) as Record<string, unknown>, ctx)
    return {
      content: [{ type: "text", text: result }],
    }
  } catch (error) {
    // clawErrorMessage turns a 401 into "run claw-login", which is the single
    // most common failure and not obvious from the raw HTTP message.
    return {
      content: [{ type: "text", text: `Error: ${clawErrorMessage(error)}` }],
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
