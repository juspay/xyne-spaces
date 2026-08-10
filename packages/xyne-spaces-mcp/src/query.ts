/**
 * Spaces query helpers — build Prisma ASTs and call /interact endpoint.
 *
 * NOTE ON `include`/`select`: the backend AST validator accepts only
 * {model, operation, where, orderBy, take, skip} and strips everything else, so
 * relations never load no matter what is asked for. Relations must be resolved
 * with a follow-up query keyed by id (see `lookupUserNames`).
 */

import { spacesFetch } from "./auth.js"

interface QueryAST {
  model: string
  operation: "findMany" | "count"
  where?: Record<string, unknown>
  orderBy?: Record<string, string> | Array<Record<string, string>>
  take?: number
  skip?: number
  include?: Record<string, unknown>
  select?: Record<string, unknown>
}

export async function query(ast: QueryAST): Promise<unknown> {
  const result = (await spacesFetch("/interact", {
    method: "POST",
    body: JSON.stringify(ast),
  })) as { data: unknown }
  return result.data
}

/** Resolve user ids to display names, since `include` cannot do it. */
async function lookupUserNames(ids: Array<string | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map()

  const rows = (await query({
    model: "user",
    operation: "findMany",
    where: { id: { in: unique } },
    take: unique.length,
  })) as Array<{ id: string; name: string }>

  return new Map(rows.map((u) => [u.id, u.name]))
}

// ── Tickets ──────────────────────────────────────────────────────────

interface TicketFilters {
  status?: string
  priority?: string
  assignedTo?: string
  createdBy?: string
  boardId?: string
  projectId?: string
  stageName?: string
  limit?: number
  offset?: number
}

interface TicketRow {
  id: string
  title: string
  xyneId: string
  statusV2: string
  priority: string
  stageName?: string
  eta?: string
  createdAt: string
  updatedAt: string
  conversationId?: string
  assignedToUser?: { name: string } | null
  createdByUser?: { name: string } | null
  board?: { name: string } | null
  project?: { name: string } | null
  tags?: Array<{ name: string }>
}

export async function queryTickets(filters: TicketFilters): Promise<string> {
  const where: Record<string, unknown> = {}
  if (filters.status) where["statusV2"] = { equals: filters.status }
  if (filters.priority) where["priority"] = { equals: filters.priority }
  if (filters.assignedTo) where["assignedTo"] = { equals: filters.assignedTo }
  if (filters.createdBy) where["createdBy"] = { equals: filters.createdBy }
  if (filters.boardId) where["boardId"] = { equals: filters.boardId }
  if (filters.projectId) where["projectId"] = { equals: filters.projectId }
  if (filters.stageName) where["stageName"] = { equals: filters.stageName }

  const rows = (await query({
    model: "ticket",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: filters.limit ?? 20,
    skip: filters.offset ?? 0,
    include: {
      assignedToUser: { select: { name: true } },
      createdByUser: { select: { name: true } },
      board: { select: { name: true } },
      project: { select: { name: true } },
      tags: { select: { name: true } },
    },
  })) as TicketRow[]

  if (rows.length === 0) return "No tickets found."

  const lines = rows.map((t) => {
    const parts = [`[${t.xyneId}] ${t.title}`]
    parts.push(`  Status: ${t.statusV2} · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`)
    if (t.assignedToUser) parts.push(`  Assigned: ${t.assignedToUser.name}`)
    if (t.createdByUser) parts.push(`  Created by: ${t.createdByUser.name}`)
    if (t.board) parts.push(`  Board: ${t.board.name}${t.project ? ` · Project: ${t.project.name}` : ""}`)
    if (t.tags && t.tags.length > 0) parts.push(`  Tags: ${t.tags.map((tg) => tg.name).join(", ")}`)
    if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`)
    if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`)
    parts.push(`  Updated: ${new Date(t.updatedAt).toLocaleString()}`)
    return parts.join("\n")
  })

  return `${rows.length} ticket(s):\n\n${lines.join("\n\n")}`
}

// ── Messages ─────────────────────────────────────────────────────────

interface MessageRow {
  messageId: string
  content: string
  msgType: string
  createdAt: string
  hasAttachment: boolean
  senderId: string
}

export async function queryMessages(conversationId: string, limit: number, offset: number): Promise<string> {
  const rows = (await query({
    model: "message",
    operation: "findMany",
    where: {
      conversationId: { equals: conversationId },
      isDeleted: { equals: false },
    },
    orderBy: [{ createdAt: "asc" }],
    take: limit,
    skip: offset,
  })) as MessageRow[]

  if (rows.length === 0) {
    return (
      `No messages found in conversation ${conversationId}. ` +
      `If you passed a channel ID, use spaces-conversations to get a real conversationId first.`
    )
  }

  const names = await lookupUserNames(rows.map((m) => m.senderId))

  const lines = rows.map((m) => {
    const sender = names.get(m.senderId) ?? "unknown"
    const time = new Date(m.createdAt).toLocaleString()
    const attach = m.hasAttachment ? " 📎" : ""
    return `[${time}] ${sender}${attach}: ${m.content}`
  })

  return `${rows.length} message(s):\n\n${lines.join("\n")}`
}

// ── Message Detail ───────────────────────────────────────────────────

interface MessageDetailRow {
  messageId: string
  content: string
  msgType: string
  createdAt: string
  edited: boolean
  hasAttachment: boolean
  sender?: { name: string; email: string } | null
  reactions?: Array<{ emojiName: string; userId: string }>
  reactionCounts?: Array<{ emojiName: string; count: number }>
}

interface AttachmentRow {
  id: string
  originalFilename: string
  mimetype: string
  size: number
  url: string
}

export async function queryMessageDetail(messageId: string): Promise<string> {
  const rows = (await query({
    model: "message",
    operation: "findMany",
    where: { messageId: { equals: messageId } },
    take: 1,
    include: {
      sender: { select: { name: true, email: true } },
      reactions: { select: { emojiName: true, userId: true } },
      reactionCounts: { select: { emojiName: true, count: true } },
    },
  })) as MessageDetailRow[]

  if (rows.length === 0) return `Message ${messageId} not found.`
  const m = rows[0]!

  const parts = [
    `Message: ${m.messageId}`,
    `From: ${m.sender?.name ?? "unknown"} (${m.sender?.email ?? ""})`,
    `Type: ${m.msgType}${m.edited ? " (edited)" : ""}`,
    `Date: ${new Date(m.createdAt).toLocaleString()}`,
    `\n${m.content}`,
  ]

  // Reactions
  if (m.reactionCounts && m.reactionCounts.length > 0) {
    const rxns = m.reactionCounts.map((r) => `${r.emojiName} ×${r.count}`).join("  ")
    parts.push(`\nReactions: ${rxns}`)
  }

  // Attachments
  if (m.hasAttachment) {
    const attachments = (await query({
      model: "messageAttachment",
      operation: "findMany",
      where: { entityId: { equals: messageId } },
      take: 20,
    })) as AttachmentRow[]

    if (attachments.length > 0) {
      parts.push(`\nAttachments (${attachments.length}):`)
      for (const a of attachments) {
        const size = a.size < 1024 ? `${a.size} B` : a.size < 1024 * 1024 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / (1024 * 1024)).toFixed(1)} MB`
        parts.push(`  - ${a.originalFilename} (${a.mimetype}, ${size})`)
      }
    }
  }

  return parts.join("\n")
}

// ── Channels ─────────────────────────────────────────────────────────

interface ChannelRow {
  id: string
  name: string
  description?: string
  type: string
  scopeType: string
  visibility: string
  participantCount: number
  lastActivityAt?: string
  project?: { name: string } | null
  participants?: Array<{ user?: { name: string } | null }> | null
}

export async function queryChannels(limit: number, visibility?: string, scopeType?: string, participantName?: string): Promise<string> {
  const where: Record<string, unknown> = {}
  if (visibility) where["visibility"] = { equals: visibility }
  if (scopeType) where["scopeType"] = { equals: scopeType }
  if (participantName) {
    where["participants"] = { some: { user: { name: { contains: participantName } } } }
  }

  const rows = (await query({
    model: "channel",
    operation: "findMany",
    where,
    orderBy: [{ lastActivityAt: "desc" }],
    take: limit,
    include: {
      project: { select: { name: true } },
      participants: { select: { user: { select: { name: true } } } },
    },
  })) as ChannelRow[]

  if (rows.length === 0) return "No channels found."

  const lines = rows.map((c) => {
    const parts = [`#${c.name} (${c.scopeType}, ${c.visibility})`]
    if (c.description) parts.push(`  ${c.description}`)
    const memberNames = c.participants?.map((p) => p.user?.name).filter(Boolean) ?? []
    if (memberNames.length > 0) parts.push(`  Members: ${memberNames.join(", ")}`)
    else parts.push(`  Participants: ${c.participantCount}`)
    if (c.project) parts.push(`  Project: ${c.project.name}`)
    if (c.lastActivityAt) parts.push(`  Last active: ${new Date(c.lastActivityAt).toLocaleString()}`)
    parts.push(`  ChannelID: ${c.id}`)
    return parts.join("\n")
  })

  return (
    `${rows.length} channel(s):\n\n${lines.join("\n\n")}\n\n` +
    `A channel is not a thread — it has no conversationId of its own. To post here, pass a ` +
    `ChannelID to spaces-conversations to list its threads, or to spaces-create-conversation ` +
    `to start a new one.`
  )
}

// ── Conversations (threads within a channel) ─────────────────────────

interface ConversationRow {
  conversationId: string
  channelId: string
  createdBy: string
  initialMessageId: string
  lastActivityAt: string
  replyCount: number
  pinned: boolean
  ticketId?: string | null
}

interface InitialMessageRow {
  messageId: string
  content: string
  senderId: string
}

export async function queryConversations(
  channelId: string,
  limit: number,
  offset: number
): Promise<string> {
  const rows = (await query({
    model: "conversation",
    operation: "findMany",
    where: { channelId: { equals: channelId } },
    orderBy: [{ lastActivityAt: "desc" }],
    take: limit,
    skip: offset,
  })) as ConversationRow[]

  if (rows.length === 0) {
    return (
      `No conversations found in channel ${channelId}.\n` +
      `Either the channel is empty or the ID is not a channel ID — ` +
      `use spaces-create-conversation to start the first thread.`
    )
  }

  // Two follow-up lookups instead of `include`, which the backend strips.
  const initialIds = [...new Set(rows.map((c) => c.initialMessageId).filter(Boolean))]
  const initialMessages =
    initialIds.length > 0
      ? ((await query({
          model: "message",
          operation: "findMany",
          where: { messageId: { in: initialIds } },
          take: initialIds.length,
        })) as InitialMessageRow[])
      : []
  const previewById = new Map(initialMessages.map((m) => [m.messageId, m]))

  const names = await lookupUserNames([
    ...rows.map((c) => c.createdBy),
    ...initialMessages.map((m) => m.senderId),
  ])

  const lines = rows.map((c) => {
    const preview = previewById.get(c.initialMessageId)
    const author = names.get(preview?.senderId ?? c.createdBy) ?? "unknown"
    const parts = [`${c.pinned ? "📌 " : ""}${author}: ${truncate(preview?.content ?? "(no preview)", 160)}`]
    parts.push(`  ConversationID: ${c.conversationId}`)
    parts.push(`  Replies: ${c.replyCount} · Last active: ${new Date(c.lastActivityAt).toLocaleString()}`)
    if (c.ticketId) parts.push(`  TicketID: ${c.ticketId}`)
    return parts.join("\n")
  })

  return (
    `${rows.length} conversation(s) in channel ${channelId}:\n\n${lines.join("\n\n")}\n\n` +
    `Use a ConversationID with spaces-messages to read a thread, or with ` +
    `spaces-send-message to reply to it.`
  )
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

// ── Users ────────────────────────────────────────────────────────────

interface UserRow {
  id: string
  name: string
  email: string
  status: string
  userType: string
  picture?: string
}

export async function queryUsers(nameOrEmail: string, limit: number): Promise<string> {
  // Search by name or email based on input
  const isEmail = nameOrEmail.includes("@") || nameOrEmail.includes(".")
  const where = isEmail
    ? { email: { contains: nameOrEmail }, status: { equals: "ACTIVE" } }
    : { name: { contains: nameOrEmail }, status: { equals: "ACTIVE" } }

  const rows = (await query({
    model: "user",
    operation: "findMany",
    where,
    take: limit,
  })) as UserRow[]

  if (rows.length === 0) return `No users found matching "${nameOrEmail}".`

  const lines = rows.map((u) => `${u.name} (${u.email}) — ${u.userType}\n  ID: ${u.id}`)

  return `${rows.length} user(s):\n\n${lines.join("\n\n")}`
}

// ── User Activity ────────────────────────────────────────────────────

interface UserActivityRow {
  id: string
  actorAction: string
  classification?: string
  isRead: boolean
  createdAt: string
  channelId?: string
  ticketId?: string
  conversationId?: string
  messageId?: string
  actorId: string
}

export async function queryUserActivity(
  classification?: string,
  isRead?: boolean,
  limit?: number
): Promise<string> {
  const where: Record<string, unknown> = {}
  if (classification) where["classification"] = { equals: classification }
  if (isRead !== undefined) where["isRead"] = { equals: isRead }

  const rows = (await query({
    model: "activity",
    operation: "findMany",
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit ?? 20,
  })) as UserActivityRow[]

  if (rows.length === 0) return "No activity found."

  const lines = rows.map((a) => {
    const when = new Date(a.createdAt).toLocaleString()
    const read = a.isRead ? "" : " (unread)"
    const refs: string[] = []
    if (a.messageId) refs.push(`messageId: ${a.messageId}`)
    if (a.conversationId) refs.push(`conversationId: ${a.conversationId}`)
    if (a.ticketId) refs.push(`ticketId: ${a.ticketId}`)
    if (a.channelId) refs.push(`channelId: ${a.channelId}`)
    const refStr = refs.length > 0 ? `\n    ${refs.join(" · ")}` : ""
    return `[${when}] ${a.actorAction}${read}${a.classification ? ` · ${a.classification}` : ""}${refStr}`
  })

  return `${rows.length} activity entries:\n\n${lines.join("\n")}`
}

// ── Projects ────────────────────────────────────────────────────────

interface ProjectRow {
  id: string
  name: string
  description?: string
  createdAt?: string
  updatedAt?: string
}

export async function queryProjects(search?: string, limit?: number, offset?: number): Promise<string> {
  const where: Record<string, unknown> = {}
  if (search) where["name"] = { contains: search }

  const rows = (await query({
    model: "project",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit ?? 20,
    skip: offset ?? 0,
  })) as ProjectRow[]

  if (rows.length === 0) return search ? `No projects found matching "${search}".` : "No projects found."

  const lines = rows.map((p) => {
    const parts = [p.name]
    if (p.description) parts.push(`  ${p.description}`)
    parts.push(`  ID: ${p.id}`)
    if (p.updatedAt) parts.push(`  Updated: ${new Date(p.updatedAt).toLocaleString()}`)
    return parts.join("\n")
  })

  return `${rows.length} project(s):\n\n${lines.join("\n\n")}`
}

// ── Boards ──────────────────────────────────────────────────────────

interface BoardRow {
  id: string
  name: string
  description?: string
  projectId?: string
  project?: { name: string } | null
  createdAt?: string
  updatedAt?: string
}

export async function queryBoards(search?: string, projectId?: string, limit?: number, offset?: number): Promise<string> {
  const where: Record<string, unknown> = {}
  if (search) where["name"] = { contains: search }
  if (projectId) where["projectId"] = { equals: projectId }

  const rows = (await query({
    model: "board",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit ?? 20,
    skip: offset ?? 0,
    include: {
      project: { select: { name: true } },
    },
  })) as BoardRow[]

  if (rows.length === 0) return search ? `No boards found matching "${search}".` : "No boards found."

  const lines = rows.map((b) => {
    const parts = [b.name]
    if (b.description) parts.push(`  ${b.description}`)
    if (b.project) parts.push(`  Project: ${b.project.name}`)
    parts.push(`  ID: ${b.id}`)
    if (b.updatedAt) parts.push(`  Updated: ${new Date(b.updatedAt).toLocaleString()}`)
    return parts.join("\n")
  })

  return `${rows.length} board(s):\n\n${lines.join("\n\n")}`
}
