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

// ── Current user ─────────────────────────────────────────────────────

export interface CurrentUser {
  id: string
  email?: string
  name?: string
  workspaceId?: string
  role?: string
  orgRole?: string
  memberId?: string
}

/**
 * Identity is cached for the process lifetime: it cannot change without a new
 * consent grant, and the tools that need it (drafts, notifications) would
 * otherwise pay a round trip on every call.
 */
let cachedUser: CurrentUser | undefined

export async function getCurrentUser(): Promise<CurrentUser> {
  if (cachedUser) return cachedUser

  const data = (await spacesFetch("/auth/me")) as {
    success?: boolean
    user?: CurrentUser
  }

  if (!data.user?.id) {
    throw new Error(
      "Could not resolve the current user. The Spaces desktop app may need to be updated — " +
        "this needs the /auth/me route."
    )
  }

  cachedUser = data.user
  return cachedUser
}

export async function queryWhoami(): Promise<string> {
  const me = await getCurrentUser()
  return [
    `You are signed in to Spaces as:`,
    `  Name: ${me.name ?? "(unknown)"}`,
    `  Email: ${me.email ?? "(unknown)"}`,
    `  UserID: ${me.id}`,
    `  WorkspaceID: ${me.workspaceId ?? "(unknown)"}`,
    ...(me.role ? [`  Role: ${me.role}`] : []),
    ...(me.orgRole ? [`  Org role: ${me.orgRole}`] : []),
    ``,
    `Use this UserID wherever a tool asks for a user — for example assignedTo in ` +
      `spaces-tickets, or assigneeId in spaces-update-ticket.`,
  ].join("\n")
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
    // TicketID, not just the key: spaces-update-ticket needs the cuid.
    parts.push(`  TicketID: ${t.id}`)
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

// ── Ticket detail ────────────────────────────────────────────────────

interface TicketDetailRow {
  id: string
  xyneId: string
  title: string
  description?: string
  status: string
  priority: string
  stageName?: string
  assignedTo?: string
  createdBy?: string
  boardId?: string
  projectId?: string
  conversationId?: string
  channelId?: string
  eta?: string
  isArchived?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Accepts either the cuid `id` or the human-facing `xyneId` (e.g. JUSPROD-1234).
 *
 * Two sequential lookups rather than one `OR`: the backend's where-schema accepts
 * arrays of strings/numbers only, so `OR: [{…}, {…}]` is rejected outright. The
 * key shape decides which field to try first, so the common case costs one query.
 */
async function findTicket(idOrKey: string): Promise<TicketDetailRow | undefined> {
  const looksLikeKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(idOrKey)
  const fields = looksLikeKey ? ["xyneId", "id"] : ["id", "xyneId"]

  for (const field of fields) {
    const rows = (await query({
      model: "ticket",
      operation: "findMany",
      where: { [field]: { equals: idOrKey } },
      take: 1,
    })) as TicketDetailRow[]
    if (rows.length > 0) return rows[0]
  }
  return undefined
}

export async function queryTicketDetail(idOrKey: string): Promise<string> {
  const t = await findTicket(idOrKey)
  if (!t) return `No ticket found matching "${idOrKey}".`

  const names = await lookupUserNames([t.assignedTo, t.createdBy])
  const subs = (await query({
    model: "subTicket",
    operation: "findMany",
    where: { mappedTicketId: { equals: t.id } },
    orderBy: [{ createdAt: "asc" }],
    take: 50,
  })) as Array<{ id: string; title: string; stageProgression?: string; assignedTo?: string }>

  const parts = [
    `[${t.xyneId}] ${t.title}`,
    `  Status: ${t.status} · Priority: ${t.priority}${t.stageName ? ` · Stage: ${t.stageName}` : ""}`,
    `  Assigned: ${t.assignedTo ? (names.get(t.assignedTo) ?? t.assignedTo) : "(unassigned)"}`,
    `  Created by: ${t.createdBy ? (names.get(t.createdBy) ?? t.createdBy) : "(unknown)"}`,
  ]
  if (t.eta) parts.push(`  ETA: ${new Date(t.eta).toLocaleDateString()}`)
  if (t.isArchived) parts.push(`  ARCHIVED`)
  parts.push(`  Updated: ${new Date(t.updatedAt).toLocaleString()}`)
  parts.push(`  TicketID: ${t.id}`)
  if (t.boardId) parts.push(`  BoardID: ${t.boardId}`)
  if (t.conversationId) parts.push(`  ConversationID: ${t.conversationId}`)
  if (t.description) parts.push(`\nDescription:\n${t.description}`)

  if (subs.length > 0) {
    parts.push(`\nSub-tickets (${subs.length}):`)
    for (const s of subs) {
      parts.push(`  - ${s.title}${s.stageProgression ? ` · ${s.stageProgression}` : ""}`)
    }
  }

  parts.push(
    `\nTo change this ticket use spaces-update-ticket with TicketID ${t.id}. ` +
      `Read the thread with spaces-messages using its ConversationID.`
  )
  return parts.join("\n")
}

// ── Board stages ─────────────────────────────────────────────────────

export async function queryBoardStages(boardId: string): Promise<string> {
  const rows = (await query({
    model: "stage",
    operation: "findMany",
    where: { boardId: { equals: boardId } },
    orderBy: [{ sequenceNumber: "asc" }],
    take: 100,
  })) as Array<{
    id: string
    name: string
    sequenceNumber: number
    defaultTicketStatus?: string
    requestApprovalOnEntry?: boolean
  }>

  if (rows.length === 0) return `No stages found for board ${boardId}.`

  const lines = rows.map(
    (s) =>
      `${s.sequenceNumber}. ${s.name}` +
      `${s.defaultTicketStatus ? ` (status: ${s.defaultTicketStatus})` : ""}` +
      `${s.requestApprovalOnEntry ? " · requires approval on entry" : ""}`
  )

  return (
    `${rows.length} stage(s) on board ${boardId}, in order:\n\n${lines.join("\n")}\n\n` +
    `Pass a stage NAME (not the number) as the 'stage' argument to spaces-update-ticket.`
  )
}

// ── Channel participants ─────────────────────────────────────────────

export async function queryChannelParticipants(channelId: string, limit: number): Promise<string> {
  const rows = (await query({
    model: "channelParticipant",
    operation: "findMany",
    where: { channelId: { equals: channelId } },
    orderBy: [{ joinedAt: "asc" }],
    take: limit,
  })) as Array<{ userId: string; role?: string; joinedAt?: string }>

  if (rows.length === 0) return `No participants found in channel ${channelId}.`

  const names = await lookupUserNames(rows.map((p) => p.userId))
  const lines = rows.map(
    (p) => `- ${names.get(p.userId) ?? "(unknown)"}${p.role ? ` · ${p.role}` : ""}\n  UserID: ${p.userId}`
  )

  return `${rows.length} participant(s) in channel ${channelId}:\n\n${lines.join("\n")}`
}

// ── Calls ────────────────────────────────────────────────────────────

export async function queryCalls(
  status: string | undefined,
  channelId: string | undefined,
  limit: number
): Promise<string> {
  const where: Record<string, unknown> = {}
  if (status) where["status"] = { equals: status }
  if (channelId) where["channelId"] = { equals: channelId }

  const rows = (await query({
    model: "call",
    operation: "findMany",
    where,
    orderBy: [{ startsAt: "desc" }],
    take: limit,
  })) as Array<{
    id: string
    title?: string
    status?: string
    callType?: string
    startsAt?: string
    endsAt?: string
    channelId?: string
    roomLink?: string
    organizerId?: string
    participantCount?: number
    aiSummary?: string
  }>

  if (rows.length === 0) return "No calls found."

  const names = await lookupUserNames(rows.map((c) => c.organizerId))
  const lines = rows.map((c) => {
    const parts = [`${c.title ?? "(untitled call)"}${c.status ? ` · ${c.status}` : ""}`]
    if (c.startsAt) parts.push(`  Starts: ${new Date(c.startsAt).toLocaleString()}`)
    if (c.organizerId) parts.push(`  Organizer: ${names.get(c.organizerId) ?? c.organizerId}`)
    if (typeof c.participantCount === "number") parts.push(`  Participants: ${c.participantCount}`)
    if (c.roomLink) parts.push(`  Link: ${c.roomLink}`)
    if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`)
    parts.push(`  CallID: ${c.id}`)
    return parts.join("\n")
  })

  return `${rows.length} call(s):\n\n${lines.join("\n\n")}`
}

// ── Canvases ─────────────────────────────────────────────────────────

export async function queryCanvases(
  channelId: string | undefined,
  projectId: string | undefined,
  limit: number
): Promise<string> {
  const where: Record<string, unknown> = {}
  if (channelId) where["channelId"] = { equals: channelId }
  if (projectId) where["projectId"] = { equals: projectId }

  const rows = (await query({
    model: "canvas",
    operation: "findMany",
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  })) as Array<{
    id: string
    title?: string
    docType?: string
    visibility?: string
    isCollaborative?: boolean
    createdBy?: string
    channelId?: string
    updatedAt?: string
  }>

  if (rows.length === 0) return "No canvases found."

  const names = await lookupUserNames(rows.map((c) => c.createdBy))
  const lines = rows.map((c) => {
    const parts = [`${c.title ?? "(untitled)"}${c.docType ? ` · ${c.docType}` : ""}`]
    if (c.createdBy) parts.push(`  Created by: ${names.get(c.createdBy) ?? c.createdBy}`)
    if (c.isCollaborative) parts.push(`  Collaborative (live-edited)`)
    if (c.updatedAt) parts.push(`  Updated: ${new Date(c.updatedAt).toLocaleString()}`)
    if (c.channelId) parts.push(`  ChannelID: ${c.channelId}`)
    parts.push(`  CanvasID: ${c.id}`)
    return parts.join("\n")
  })

  return `${rows.length} canvas(es):\n\n${lines.join("\n\n")}`
}

// ── Sub-tickets ──────────────────────────────────────────────────────

export async function querySubTickets(ticketId: string): Promise<string> {
  const rows = (await query({
    model: "subTicket",
    operation: "findMany",
    where: { mappedTicketId: { equals: ticketId } },
    orderBy: [{ createdAt: "asc" }],
    take: 100,
  })) as Array<{
    id: string
    title: string
    description?: string
    stageProgression?: string
    assignedTo?: string
    conversationId?: string
  }>

  if (rows.length === 0) return `No sub-tickets found for ticket ${ticketId}.`

  const names = await lookupUserNames(rows.map((s) => s.assignedTo))
  const lines = rows.map((s) => {
    const parts = [`${s.title}${s.stageProgression ? ` · ${s.stageProgression}` : ""}`]
    if (s.assignedTo) parts.push(`  Assigned: ${names.get(s.assignedTo) ?? s.assignedTo}`)
    if (s.description) parts.push(`  ${truncate(s.description, 200)}`)
    if (s.conversationId) parts.push(`  ConversationID: ${s.conversationId}`)
    parts.push(`  SubTicketID: ${s.id}`)
    return parts.join("\n")
  })

  return `${rows.length} sub-ticket(s) of ${ticketId}:\n\n${lines.join("\n\n")}`
}

// ── My drafts ────────────────────────────────────────────────────────

export async function queryMyDrafts(limit: number): Promise<string> {
  const me = await getCurrentUser()

  const rows = (await query({
    model: "draftMessage",
    operation: "findMany",
    where: { userId: { equals: me.id } },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  })) as Array<{
    id: string
    content?: string
    channelId?: string
    conversationId?: string
    hasAttachment?: boolean
    updatedAt?: string
  }>

  if (rows.length === 0) return "You have no saved drafts."

  const lines = rows.map((d) => {
    const parts = [`${truncate(d.content ?? "(empty draft)", 200)}${d.hasAttachment ? " 📎" : ""}`]
    if (d.updatedAt) parts.push(`  Updated: ${new Date(d.updatedAt).toLocaleString()}`)
    if (d.conversationId) parts.push(`  ConversationID: ${d.conversationId}`)
    else if (d.channelId) parts.push(`  ChannelID: ${d.channelId} (unsent new thread)`)
    return parts.join("\n")
  })

  return (
    `${rows.length} draft(s):\n\n${lines.join("\n\n")}\n\n` +
    `Drafts cannot be edited or sent from here — that needs the SDK path. ` +
    `To post the text, use spaces-send-message or spaces-create-conversation.`
  )
}

// ── Emails ───────────────────────────────────────────────────────────

export async function queryEmails(
  conversationId: string | undefined,
  channelId: string | undefined,
  limit: number
): Promise<string> {
  const where: Record<string, unknown> = {}
  if (conversationId) where["conversationId"] = { equals: conversationId }
  if (channelId) where["channelId"] = { equals: channelId }

  const rows = (await query({
    model: "email",
    operation: "findMany",
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  })) as Array<{
    id: string
    type?: string
    subject?: string
    body?: string
    from?: string
    to?: string
    conversationId?: string
    createdAt?: string
  }>

  if (rows.length === 0) return "No emails found."

  const lines = rows.map((e) => {
    const parts = [`${e.subject ?? "(no subject)"}${e.type ? ` · ${e.type}` : ""}`]
    if (e.from) parts.push(`  From: ${e.from}`)
    if (e.to) parts.push(`  To: ${e.to}`)
    if (e.createdAt) parts.push(`  ${new Date(e.createdAt).toLocaleString()}`)
    if (e.body) parts.push(`  ${truncate(e.body, 300)}`)
    if (e.conversationId) parts.push(`  ConversationID: ${e.conversationId}`)
    return parts.join("\n")
  })

  return `${rows.length} email(s):\n\n${lines.join("\n\n")}`
}

// ── Notifications ────────────────────────────────────────────────────

export async function queryNotifications(
  status: string | undefined,
  limit: number
): Promise<string> {
  const me = await getCurrentUser()

  const where: Record<string, unknown> = { userId: { equals: me.id } }
  if (status) where["status"] = { equals: status }

  const rows = (await query({
    model: "notification",
    operation: "findMany",
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  })) as Array<{
    id: string
    type?: string
    title?: string
    message?: string
    status?: string
    relatedEntityType?: string
    relatedEntityId?: string
    readAt?: string
    createdAt?: string
  }>

  if (rows.length === 0) return status ? `No ${status} notifications.` : "No notifications."

  const lines = rows.map((n) => {
    const parts = [`${n.title ?? n.type ?? "(notification)"}${n.status ? ` · ${n.status}` : ""}`]
    if (n.message) parts.push(`  ${truncate(n.message, 200)}`)
    if (n.createdAt) parts.push(`  ${new Date(n.createdAt).toLocaleString()}`)
    if (n.relatedEntityType && n.relatedEntityId) {
      parts.push(`  ${n.relatedEntityType}: ${n.relatedEntityId}`)
    }
    return parts.join("\n")
  })

  return `${rows.length} notification(s):\n\n${lines.join("\n\n")}`
}
