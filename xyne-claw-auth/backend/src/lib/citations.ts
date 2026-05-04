import type { Citation as StructuredCitation } from "xyne-claw-shared";

interface Citation {
  label: string;
  url: string;
}

interface CitationBuildOptions {
  baseUrl: string;
  defaultChannelId?: string;
  maxCitations?: number;
}

interface InvocationLike {
  toolName?: unknown;
  args?: unknown;
  result?: unknown;
  citations?: unknown;
}

function isStructuredCitation(v: unknown): v is StructuredCitation {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return r["kind"] === "thread" || r["kind"] === "canvas" || r["kind"] === "ticket" || r["kind"] === "external";
}

function addStructuredCitation(
  target: Citation[],
  seenUrls: Set<string>,
  baseUrl: string,
  c: StructuredCitation,
): void {
  if (c.kind === "thread" && c.channelId && c.conversationId) {
    addThreadCitation(target, seenUrls, baseUrl, c.conversationId, c.channelId, c.label, c.channelName, c.channelType);
    return;
  }
  if (c.kind === "canvas" && c.viewAccessId) {
    addCitation(target, seenUrls, c.label ?? `Canvas ${c.viewAccessId}`, buildCanvasUrl(baseUrl, c.viewAccessId));
    return;
  }
  if (c.kind === "external" && c.url) {
    addCitation(target, seenUrls, c.label ?? "Source link", c.url);
    return;
  }
  // Tickets currently have no direct ticket-page URL — skip silently. Once
  // Spaces exposes a ticket URL pattern, plumb it here.
}

const MAX_TEXT_SCAN_CHARS = 120_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeToolName(raw: string): string {
  const noPrefix = raw.includes("__") ? raw.split("__").slice(1).join("__") : raw;
  return noPrefix.includes(":") ? noPrefix.split(":").slice(-1)[0] ?? noPrefix : noPrefix;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function getBaseOrigin(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

function normalizeSourceUrl(rawUrl: string, baseOrigin?: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (baseOrigin && parsed.origin !== baseOrigin) return undefined;

    const path = parsed.pathname;
    const isThreadPath = path.startsWith("/chat/dir/");
    const isCanvasPath = path.startsWith("/chat/canvas/") || path.startsWith("/canvas/");
    if (!isThreadPath && !isCanvasPath) return undefined;

    return parsed.toString();
  } catch {
    return undefined;
  }
}

function toText(result: unknown): string {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") {
          const nested = toText(parsed);
          if (nested) return nested;
        }
      } catch {
        // Keep raw string when JSON parse fails.
      }
    }
    return result;
  }

  const obj = asRecord(result);
  if (!obj) return "";

  if (Array.isArray(obj["content"])) {
    const parts: string[] = [];
    for (const entry of obj["content"] as unknown[]) {
      const row = asRecord(entry);
      if (row?.["type"] === "text" && typeof row["text"] === "string") {
        parts.push(row["text"]);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }

  if (typeof obj["text"] === "string") return obj["text"];
  return "";
}

function buildThreadUrl(baseUrl: string, channelId: string, conversationId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}

function buildCanvasUrl(baseUrl: string, viewAccessId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/canvas/${encodeURIComponent(viewAccessId)}`;
}

function addCitation(target: Citation[], seenUrls: Set<string>, label: string, url: string): void {
  if (!url || seenUrls.has(url)) return;
  seenUrls.add(url);
  target.push({ label, url });
}

function addThreadCitation(
  target: Citation[],
  seenUrls: Set<string>,
  baseUrl: string,
  conversationId: string,
  channelId: string | undefined,
  labelPrefix?: string,
  channelName?: string,
  channelType?: string,
): void {
  if (!channelId) return;
  // Render: "<labelPrefix> in #<channelName> (<TYPE>)" — falls back gracefully
  // when channel info or label is missing. Channel type is normalized to
  // sentence case (DM stays DM; GROUP_DM → "Group DM"; DEFAULT → "Channel").
  const prefix = labelPrefix && labelPrefix.trim().length > 0 ? labelPrefix.trim() : "";
  const channel = channelName ? `#${channelName}` : "";
  const typeLabel = formatChannelType(channelType);
  let label = prefix;
  if (channel) label = label ? `${label} in ${channel}` : channel;
  if (typeLabel) label = label ? `${label} (${typeLabel})` : typeLabel;
  if (!label) label = "Spaces thread";
  addCitation(target, seenUrls, label, buildThreadUrl(baseUrl, channelId, conversationId));
}

function formatChannelType(t: string | undefined): string {
  if (!t) return "";
  switch (t.toUpperCase()) {
    case "DM": return "DM";
    case "GROUP_DM": return "Group DM";
    case "DEFAULT": return "Channel";
    case "TICKET": return "Ticket Channel";
    case "DOCUMENT": return "Doc Channel";
    default: return t;
  }
}

function collectCaptures(line: string, regex: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

function extractIdsFromLine(line: string): { conversationIds: string[]; channelIds: string[]; ticketId: string | undefined; canvasId: string | undefined } {
  const conversationIds = collectCaptures(line, /(?:conversationId|ConversationID)\s*[:=]\s*([A-Za-z0-9_-]+)/g);
  const channelIds = collectCaptures(line, /(?:channelId|ChannelID)\s*[:=]\s*([A-Za-z0-9_-]+)/g);
  const ticketId = line.match(/\[([A-Z]+-\d+)\]/)?.[1];
  const canvasId = line.match(/\/chat\/canvas\/([A-Za-z0-9_-]+)/)?.[1];
  return { conversationIds, channelIds, ticketId, canvasId };
}

function collectFromText(
  target: Citation[],
  seenUrls: Set<string>,
  text: string,
  baseUrl: string,
  baseOrigin: string | undefined,
  defaultChannelId?: string,
): void {
  let lastChannelId: string | undefined = defaultChannelId;
  const lines = text.slice(0, MAX_TEXT_SCAN_CHARS).split(/\r?\n/);

  for (const line of lines) {
    const { conversationIds, channelIds, ticketId, canvasId } = extractIdsFromLine(line);

    if (channelIds.length > 0) lastChannelId = channelIds[channelIds.length - 1];

    for (const conversationId of conversationIds) {
      const channelId = channelIds[0] ?? lastChannelId ?? defaultChannelId;
      addThreadCitation(target, seenUrls, baseUrl, conversationId, channelId, ticketId ? `Ticket ${ticketId}` : undefined);
    }

    if (canvasId) {
      addCitation(target, seenUrls, `Canvas ${canvasId}`, buildCanvasUrl(baseUrl, canvasId));
    }

    const urls = collectCaptures(line, /(https?:\/\/[^\s)]+)/g);
    for (const url of urls) {
      const normalizedUrl = normalizeSourceUrl(url, baseOrigin);
      if (normalizedUrl) {
        addCitation(target, seenUrls, "Source link", normalizedUrl);
      }
    }
  }
}

function collectFromInvocation(
  target: Citation[],
  seenUrls: Set<string>,
  invocation: InvocationLike,
  baseUrl: string,
  baseOrigin: string | undefined,
  defaultChannelId?: string,
): void {
  const rawToolName = asString(invocation.toolName) ?? "";
  const toolName = normalizeToolName(rawToolName);
  const args = asRecord(invocation.args);

  const argConversationId = asString(args?.["conversationId"]);
  const argChannelId = asString(args?.["channelId"]) ?? asString(args?.["in"]) ?? defaultChannelId;
  const viewAccessId = asString(args?.["viewAccessId"]);

  if (argConversationId) {
    const label = toolName ? `${toolName}` : undefined;
    addThreadCitation(target, seenUrls, baseUrl, argConversationId, argChannelId, label);
  }

  if (viewAccessId) {
    addCitation(target, seenUrls, `Canvas ${viewAccessId}`, buildCanvasUrl(baseUrl, viewAccessId));
  }

  collectFromText(target, seenUrls, toText(invocation.result), baseUrl, baseOrigin, argChannelId ?? defaultChannelId);
}

function hasCitationSection(markdown: string): boolean {
  return /(^|\n)###\s+Citations\b/i.test(markdown);
}

export function appendCitations(
  markdown: string,
  toolInvocations: unknown,
  options: CitationBuildOptions,
): string {
  if (!markdown.trim() || hasCitationSection(markdown)) return markdown;

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return markdown;

  const baseOrigin = getBaseOrigin(baseUrl);
  const citations: Citation[] = [];
  const seenUrls = new Set<string>();

  if (Array.isArray(toolInvocations)) {
    // Pass 1: prefer structured citations (Tier 1 propagation). Tools attach
    // these via MCP `_meta.citations` and the worker forwards them on each
    // invocation. Subagents aggregate child citations into their wrapper.
    for (const inv of toolInvocations as InvocationLike[]) {
      if (Array.isArray(inv.citations)) {
        for (const c of inv.citations) {
          if (isStructuredCitation(c)) addStructuredCitation(citations, seenUrls, baseUrl, c);
        }
      }
    }
    // Pass 2: regex fallback. Catches tools that haven't migrated yet and
    // any IDs the agent itself emitted into a child tool's text result.
    for (const inv of toolInvocations as InvocationLike[]) {
      collectFromInvocation(citations, seenUrls, inv, baseUrl, baseOrigin, options.defaultChannelId);
    }
  }

  // Final fallback: parse the assistant markdown itself for direct links / IDs.
  collectFromText(citations, seenUrls, markdown, baseUrl, baseOrigin, options.defaultChannelId);

  const limit = options.maxCitations ?? 8;
  const finalCitations = citations.slice(0, limit);
  if (finalCitations.length === 0) return markdown;

  const lines = finalCitations.map((c, idx) => `${idx + 1}. [${c.label}](${c.url})`);
  return `${markdown.trimEnd()}\n\n### Citations\n${lines.join("\n")}`;
}
