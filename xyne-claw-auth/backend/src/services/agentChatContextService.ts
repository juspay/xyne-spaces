import { interact, type SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";

export type ContextType = "channel" | "ticket" | "canvas" | "call" | "activity";
export type ContextSearchType = Exclude<ContextType, "activity"> | "all";

export interface ContextItem {
  id: string;
  type: ContextType;
  title: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
}

export interface AttachedContextRef {
  type: ContextType;
  id: string;
  title: string;
  threadId?: string;
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

export interface ActivityContext {
  eventName: string;
  eventCategory?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
  relatedData?: Record<string, unknown>;
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
const PER_TYPE_LIMIT = 5;
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
  };

  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { items: [], error: "attachedContext contains invalid entries" };
    const obj = raw as Record<string, unknown>;
    const type = obj["type"];
    const id = obj["id"];
    const title = obj["title"];
    if (!isContextType(type)) return { items: [], error: "attachedContext.type must be one of channel|ticket|canvas|call|activity" };
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
    const item: AttachedContextRef = {
      type,
      id: id.trim(),
      title: title.trim(),
      ...(typeof threadId === "string" && threadId.trim().length > 0 ? { threadId: threadId.trim() } : {}),
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
  return searchCalls(query, safeLimit, auth);
}

export async function buildAttachedContextPayload(items: AttachedContextRef[], auth?: SpacesAuthContext): Promise<{ promptPrefix?: string; contextFiles: ContextFile[] }> {
  if (items.length === 0) return { contextFiles: [] };

  const sections = await Promise.all(items.map(async (item) => {
    try {
      return await resolveSection(item, auth);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        header: `${labelForType(item.type)} "${item.title}" (id=${item.id})`,
        inlineText: `Unable to resolve attached context: ${message}`,
      } satisfies ResolvedContextSection;
    }
  }));

  const lines: string[] = ["# Attached context"];
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
  return resolveCallSection(item, auth);
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
    `Channel: #${channel.name}`,
    `Channel id: ${item.id}`,
    `Scope: ${channel.scopeType ?? "UNKNOWN"} · Visibility: ${channel.visibility ?? "UNKNOWN"}`,
    `Participants: ${typeof channel.participantCount === "number" ? channel.participantCount : "unknown"}`,
    ...(threadId ? [`Thread conversationId: ${threadId}`] : []),
    "",
    "Use spaces subagent tools to inspect this context (fresh data):",
    `- spaces-channels with channelId=${item.id}`,
    threadId
      ? `- spaces-messages with conversationId=${threadId} to read this thread`
      : `- spaces-activity with channelId=${item.id} to discover conversationId, then spaces-messages`,
    `- spaces-activity with channelId=${item.id} for recent events`,
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

async function resolveCanvasSection(item: AttachedContextRef, auth?: SpacesAuthContext): Promise<ResolvedContextSection> {
  const rows = (await interact({
    model: "canvas",
    operation: "findMany",
    where: { id: { equals: item.id } },
    take: 1,
  }, auth)) as CanvasRow[];
  const row = rows[0];

  const title = row?.title ?? item.title;
  const header = `Canvas "${title}" (id=${item.id})`;
  const inlineText = [
    `Canvas title: ${title}`,
    `Canvas id: ${item.id}`,
    "Use the spaces-canvases MCP tool with this id to read full content on demand.",
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
  const lines = [
    `Call title: ${call.title?.trim() || "(untitled call)"}`,
    `Call id: ${item.id}`,
    `Status: ${call.status ?? "UNKNOWN"} · Type: ${call.callType ?? "UNKNOWN"}`,
    ...(call.channelId ? [`Channel id: ${call.channelId}`] : []),
    ...(threadId ? [`Thread conversationId: ${threadId}`] : []),
    ...(call.startsAt ? [`Starts: ${formatDate(call.startsAt)}`] : []),
    ...(call.endsAt ? [`Ends: ${formatDate(call.endsAt)}`] : []),
    "",
    "Use spaces subagent tools to inspect this call (fresh data):",
    ...(call.channelId
      ? [`- spaces-calls with channelId=${call.channelId} and search=\"${(call.title?.trim() || item.title).replace(/"/g, "'")}\"`]
      : [`- spaces-calls with search=\"${(call.title?.trim() || item.title).replace(/"/g, "'")}\"`]),
    threadId
      ? `- spaces-messages with conversationId=${threadId} to read call thread`
      : "- spaces-activity (or spaces-calls result refs) to discover conversationId, then spaces-messages",
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
  return value === "channel" || value === "ticket" || value === "canvas" || value === "call" || value === "activity";
}

function labelForType(type: ContextType): string {
  if (type === "channel") return "Channel";
  if (type === "ticket") return "Ticket";
  if (type === "canvas") return "Canvas";
  if (type === "activity") return "Activity";
  return "Call";
}
