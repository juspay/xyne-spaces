import type { Citation as StructuredCitation } from "xyne-claw-shared";
import { iconUrlForKey } from "xyne-claw-shared";

/**
 * Re-attach the inline `data:` SVG icon onto each citation from its persisted
 * `iconKey`, returning NEW objects safe to send to the dashboard. We persist
 * only `iconKey` (a few bytes) — the heavy icon bytes are hydrated here on the
 * way OUT, so they never land in `agent_runs.toolInvocations`.
 *
 * Non-mutating and backward-compatible: the input is never modified, and
 * citations that already carry an `iconUrl` (legacy/path rows) or lack an
 * `iconKey` are passed through untouched.
 */
export function hydrateInvocationIcons(inv: unknown): unknown {
  if (!inv || typeof inv !== "object") return inv;
  const citations = (inv as Record<string, unknown>).citations;
  if (!Array.isArray(citations) || citations.length === 0) return inv;
  let changed = false;
  const hydrated = citations.map((c) => {
    if (!c || typeof c !== "object") return c;
    const cit = c as Record<string, unknown>;
    if (cit.iconUrl || !cit.iconKey) return c; // already hydrated, or no key
    const url = iconUrlForKey(cit.iconKey as string);
    if (!url) return c;
    changed = true;
    return { ...cit, iconUrl: url };
  });
  return changed ? { ...(inv as Record<string, unknown>), citations: hydrated } : inv;
}

/** Array variant of {@link hydrateInvocationIcons} for a full toolInvocations
 *  list (the reload path). Non-arrays pass through unchanged. */
export function hydrateCitationIcons<T>(invocations: T): T {
  if (!Array.isArray(invocations)) return invocations;
  return invocations.map(hydrateInvocationIcons) as unknown as T;
}

/**
 * Collect the de-duplicated `iconKey → data:` SVG URI map used across a list of
 * tool invocations. This is the payload-slimming alternative to per-citation
 * hydration: instead of stamping the (often identical) SVG bytes onto EVERY
 * citation — e.g. 6 thread chips each carrying the same ~1.6 KB Spaces mark —
 * the citations keep only their tiny `iconKey` and the bytes ship ONCE per
 * unique key in this map. The dashboard re-attaches them at render time.
 *
 * Only keys that resolve to a known icon are included. Citations without an
 * `iconKey` (legacy/path rows that carry an inline `iconUrl` instead) are
 * ignored here and rendered from their own `iconUrl` client-side.
 */
export function collectCitationIconUrls(
  invocations: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(invocations)) return out;
  for (const inv of invocations) {
    if (!inv || typeof inv !== "object") continue;
    const citations = (inv as Record<string, unknown>).citations;
    if (!Array.isArray(citations)) continue;
    for (const c of citations) {
      if (!c || typeof c !== "object") continue;
      const key = (c as Record<string, unknown>).iconKey;
      if (typeof key !== "string" || key in out) continue;
      const url = iconUrlForKey(key);
      if (url) out[key] = url;
    }
  }
  return out;
}

/**
 * The compact citation lookup baked into a bot thread message's metadata so a
 * re-opened Spaces thread can render clickable citation chips WITHOUT re-calling
 * claw. `clawCitations` is a slimmed toolInvocations list (only `toolCallId` +
 * `citations`, the two fields the frontend `findCitationForChunk` needs);
 * `clawCitationIcons` is the de-duplicated `iconKey → data:URI` map the sidebar
 * `/messages` payload ships as a top-level `icons` field.
 */
export interface ThreadCitationMeta {
  clawCitations: Array<{ toolCallId: string; citations: StructuredCitation[] }>;
  clawCitationIcons: Record<string, string>;
}

/** Safety backstop: never bake more than this many citations into a single
 *  message's metadata, so a pathological run can't bloat the Postgres row.
 *  Set well above a realistic cited-source count — token-scoping (below) is the
 *  real bound. Whole invocations are kept intact (never sliced mid-array) so a
 *  token's `#chunkIndex` always resolves. */
const MAX_THREAD_CITATIONS = 200;

/**
 * Extract the set of `toolCallId`s that the reply text actually cites, from its
 * inline `[clf-<toolCallId>#<n>]` tokens. Returns null when the text has no
 * tokens (caller then falls back to baking every citeable invocation).
 *
 * IMPORTANT: nested-subagent runs surface a PARENT wrapper invocation whose
 * `citations` are the concatenated aggregate of its children (with duplicated
 * chunk indices) — the tokens never reference that wrapper, only the child
 * invocations. Scoping to the referenced ids drops the useless aggregate and
 * keeps exactly the child rows `findCitationForChunk` needs.
 */
function extractCitedToolCallIds(text: unknown): Set<string> | null {
  if (typeof text !== "string" || !text.includes("clf-")) return null;
  const ids = new Set<string>();
  const re = /\[clf-([^\][]+?)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    if (!body) continue;
    const hashIdx = body.lastIndexOf("#");
    if (hashIdx <= 0) continue;
    if (!/^\d+$/.test(body.slice(hashIdx + 1))) continue;
    ids.add(body.slice(0, hashIdx));
  }
  return ids.size > 0 ? ids : null;
}

/**
 * Build {@link ThreadCitationMeta} from a run's tool invocations. Returns null
 * when nothing citeable is present (so callers can omit the keys entirely).
 *
 * `replyText` is the assistant message being posted; when it carries inline
 * `[clf-…]` tokens we bake ONLY the invocations those tokens reference (see
 * {@link extractCitedToolCallIds}). The citation objects are forwarded whole —
 * they already carry `iconKey` (stamped by claw's `recordCitations`) and every
 * routing field the frontend `buildClawCitationUrl` reads.
 */
export function buildThreadCitationMeta(
  toolInvocations: unknown,
  replyText?: unknown,
): ThreadCitationMeta | null {
  if (!Array.isArray(toolInvocations)) return null;
  const citedIds = extractCitedToolCallIds(replyText);
  // When the caller gave us the reply text but it cites nothing, bake nothing —
  // don't dump every citation into a token-less message. The include-everything
  // fallback only applies when no text was passed at all (citedIds === null AND
  // no replyText), which keeps older callers working.
  if (typeof replyText === "string" && !citedIds) return null;
  const clawCitations: Array<{
    toolCallId: string;
    citations: StructuredCitation[];
  }> = [];
  const usedInvocations: unknown[] = [];
  let total = 0;
  for (const inv of toolInvocations) {
    if (total >= MAX_THREAD_CITATIONS) break;
    if (!inv || typeof inv !== "object") continue;
    const rec = inv as Record<string, unknown>;
    const toolCallId =
      typeof rec["toolCallId"] === "string" ? rec["toolCallId"] : undefined;
    const citations = rec["citations"];
    if (!toolCallId || !Array.isArray(citations) || citations.length === 0)
      continue;
    // Only bake what the reply actually cites (when we can tell). Drops the
    // redundant subagent parent-wrapper aggregate and bounds the row size.
    if (citedIds && !citedIds.has(toolCallId)) continue;
    const structured = citations.filter((c): c is StructuredCitation =>
      isStructuredCitation(c),
    );
    if (structured.length === 0) continue;
    // Keep whole invocations intact so `#chunkIndex` always resolves — stop
    // adding once we'd blow the backstop rather than truncating an array.
    if (total > 0 && total + structured.length > MAX_THREAD_CITATIONS) break;
    clawCitations.push({ toolCallId, citations: structured });
    usedInvocations.push(inv);
    total += structured.length;
  }
  if (clawCitations.length === 0) return null;
  return {
    clawCitations,
    clawCitationIcons: collectCitationIconUrls(usedInvocations),
  };
}

interface Citation {
  label: string;
  url: string;
}

interface CitationBuildOptions {
  baseUrl: string;
  defaultChannelId?: string;
  maxCitations?: number;
  /** When false, returns the markdown unchanged. Defaults to true for backward compat.
   *  Set on an agent's config under `replyOptions.includeCitations` and threaded through
   *  from webhook.ts / agent-chat.ts based on the agent's preference. */
  includeCitations?: boolean;
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
  return (
    r["kind"] === "thread" ||
    r["kind"] === "canvas" ||
    r["kind"] === "ticket" ||
    r["kind"] === "external" ||
    r["kind"] === "collection-item" ||
    r["kind"] === "recording"
  );
}

/** Recording detail route. Keyed by the call's `externalId`, matching the
 *  dashboard route `recordings/:recordingId` (AppRoot.tsx). */
function buildRecordingUrl(_baseUrl: string, recordingId: string): string {
  return `/recordings/${encodeURIComponent(recordingId)}`;
}

function buildTicketUrl(
  _baseUrl: string,
  channelId: string,
  conversationId: string,
  ticketId: string,
): string {
  return `/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}/${encodeURIComponent(ticketId)}`;
}

function addStructuredCitation(
  target: Citation[],
  seenUrls: Set<string>,
  baseUrl: string,
  c: StructuredCitation,
): void {
  if (c.kind === "thread" && c.channelId && c.conversationId) {
    addThreadCitation(
      target,
      seenUrls,
      baseUrl,
      c.conversationId,
      c.channelId,
      c.label,
      c.channelName,
      c.channelType,
    );
    return;
  }
  if (c.kind === "canvas" && c.viewAccessId) {
    addCitation(
      target,
      seenUrls,
      c.label ?? `Canvas ${c.viewAccessId}`,
      buildCanvasUrl(baseUrl, c.viewAccessId),
    );
    return;
  }
  if (c.kind === "ticket" && c.ticketId) {
    if (c.channelId && c.conversationId) {
      addCitation(
        target,
        seenUrls,
        c.label ?? `Ticket ${c.ticketId}`,
        buildTicketUrl(baseUrl, c.channelId, c.conversationId, c.ticketId),
      );
    } else {
      // channel/conversation not available — render as plain text (no link)
      target.push({ label: c.label ?? `Ticket ${c.ticketId}`, url: "" });
    }
    return;
  }
  if (c.kind === "recording" && c.recordingId) {
    addCitation(
      target,
      seenUrls,
      c.label ?? "Recording",
      buildRecordingUrl(baseUrl, c.recordingId),
    );
    return;
  }
  if (c.kind === "external" && c.url) {
    addCitation(target, seenUrls, c.label ?? "Source link", c.url);
    return;
  }
  // KB tools (kb-search / kb-read-file / kb-get-chunks / kb-search-within-doc)
  // attach `url` directly (built via deepLinkForFile in kb-handlers.ts), so the
  // structured-citation path just forwards it through. Drop the citation when
  // url is missing — happens for collections we don't have full tree metadata
  // for (e.g. workspace-scoped instead of channel-scoped).
  if (c.kind === "collection-item" && c.url) {
    addCitation(
      target,
      seenUrls,
      c.label ?? c.fileName ?? "Knowledge base file",
      c.url,
    );
    return;
  }
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
  const noPrefix = raw.includes("__")
    ? raw.split("__").slice(1).join("__")
    : raw;
  return noPrefix.includes(":")
    ? (noPrefix.split(":").slice(-1)[0] ?? noPrefix)
    : noPrefix;
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

function normalizeHttpUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeSourceUrl(
  rawUrl: string,
  baseOrigin?: string,
): string | undefined {
  const normalized = normalizeHttpUrl(rawUrl);
  if (!normalized) return undefined;

  const parsed = new URL(normalized);
  if (baseOrigin && parsed.origin !== baseOrigin) return undefined;

  const path = parsed.pathname;
  const isThreadPath = path.startsWith("/chat/dir/");
  const isCanvasPath =
    path.startsWith("/chat/canvas/") || path.startsWith("/canvas/");
  if (!isThreadPath && !isCanvasPath) return undefined;

  return normalized;
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

function buildThreadUrl(
  _baseUrl: string,
  channelId: string,
  conversationId: string,
): string {
  return `/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}

function buildCanvasUrl(_baseUrl: string, viewAccessId: string): string {
  return `/chat/canvas/${encodeURIComponent(viewAccessId)}`;
}

function addCitation(
  target: Citation[],
  seenUrls: Set<string>,
  label: string,
  url: string,
): void {
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
  const prefix =
    labelPrefix && labelPrefix.trim().length > 0 ? labelPrefix.trim() : "";
  const channel = channelName ? `#${channelName}` : "";
  const typeLabel = formatChannelType(channelType);
  let label = prefix;
  if (channel) label = label ? `${label} in ${channel}` : channel;
  if (typeLabel) label = label ? `${label} (${typeLabel})` : typeLabel;
  if (!label) label = "Spaces thread";
  addCitation(
    target,
    seenUrls,
    label,
    buildThreadUrl(baseUrl, channelId, conversationId),
  );
}

interface KeyPointEntry {
  point: string;
  label: string;
  url: string;
}

function resolveLlmCitation(
  baseUrl: string,
  c: StructuredCitation,
): { label: string; url: string } | null {
  if (c.kind === "thread" && c.channelId && c.conversationId) {
    const label = c.label?.trim() || "Spaces thread";
    return {
      label,
      url: buildThreadUrl(baseUrl, c.channelId, c.conversationId),
    };
  }
  if (c.kind === "canvas" && c.viewAccessId) {
    return {
      label: c.label || `Canvas ${c.viewAccessId}`,
      url: buildCanvasUrl(baseUrl, c.viewAccessId),
    };
  }
  if (c.kind === "ticket" && c.ticketId && c.channelId && c.conversationId) {
    return {
      label: c.label || `Ticket ${c.ticketId}`,
      url: buildTicketUrl(baseUrl, c.channelId, c.conversationId, c.ticketId),
    };
  }
  if (c.kind === "recording" && c.recordingId) {
    return {
      label: c.label?.trim() || "Recording",
      url: buildRecordingUrl(baseUrl, c.recordingId),
    };
  }
  if (c.kind === "external" && c.url) {
    const normalizedUrl = normalizeHttpUrl(c.url);
    if (!normalizedUrl) return null;
    return { label: c.label || "Source link", url: normalizedUrl };
  }
  if (c.kind === "collection-item" && c.url) {
    return {
      label: c.label || c.fileName || "Knowledge base file",
      url: c.url,
    };
  }
  return null;
}

function formatChannelType(t: string | undefined): string {
  if (!t) return "";
  switch (t.toUpperCase()) {
    case "DM":
      return "DM";
    case "GROUP_DM":
      return "Group DM";
    case "DEFAULT":
      return "Channel";
    case "TICKET":
      return "Ticket Channel";
    case "DOCUMENT":
      return "Doc Channel";
    default:
      return t;
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

function extractIdsFromLine(line: string): {
  conversationIds: string[];
  channelIds: string[];
  ticketId: string | undefined;
  canvasId: string | undefined;
} {
  const conversationIds = collectCaptures(
    line,
    /(?:conversationId|ConversationID)\s*[:=]\s*([A-Za-z0-9_-]+)/g,
  );
  const channelIds = collectCaptures(
    line,
    /(?:channelId|ChannelID)\s*[:=]\s*([A-Za-z0-9_-]+)/g,
  );
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
    const { conversationIds, channelIds, ticketId, canvasId } =
      extractIdsFromLine(line);

    if (channelIds.length > 0)
      lastChannelId = channelIds[channelIds.length - 1];

    for (const conversationId of conversationIds) {
      const channelId = channelIds[0] ?? lastChannelId ?? defaultChannelId;
      addThreadCitation(
        target,
        seenUrls,
        baseUrl,
        conversationId,
        channelId,
        ticketId ? `Ticket ${ticketId}` : undefined,
      );
    }

    if (canvasId) {
      addCitation(
        target,
        seenUrls,
        `Canvas ${canvasId}`,
        buildCanvasUrl(baseUrl, canvasId),
      );
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
  const argChannelId =
    asString(args?.["channelId"]) ?? asString(args?.["in"]) ?? defaultChannelId;
  const viewAccessId = asString(args?.["viewAccessId"]);

  if (argConversationId) {
    const label = toolName ? `${toolName}` : undefined;
    addThreadCitation(
      target,
      seenUrls,
      baseUrl,
      argConversationId,
      argChannelId,
      label,
    );
  }

  if (viewAccessId) {
    addCitation(
      target,
      seenUrls,
      `Canvas ${viewAccessId}`,
      buildCanvasUrl(baseUrl, viewAccessId),
    );
  }

  collectFromText(
    target,
    seenUrls,
    toText(invocation.result),
    baseUrl,
    baseOrigin,
    argChannelId ?? defaultChannelId,
  );
}

function hasCitationSection(markdown: string): boolean {
  return /(^|\n)###\s+Citations\b/i.test(markdown);
}

/** Interface for LLM-provided citations from add_citations tool */
interface LlmKeyPoint {
  point: string;
  citation: StructuredCitation;
}

function isLlmKeyPoint(v: unknown): v is LlmKeyPoint {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r["point"] === "string" && isStructuredCitation(r["citation"]);
}

export function appendCitations(
  markdown: string,
  toolInvocations: unknown,
  options: CitationBuildOptions,
  llmCitations?: unknown,
): string {
  // Legacy regex-based tool-invocation citations are retired. Only LLM-provided
  // citations from the add_citations tool are used now.
  const skipLegacyCitations = true;
  // const skipLegacyCitations = false;

  if (!markdown.trim() || hasCitationSection(markdown)) {
    return markdown;
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) {
    return markdown;
  }

  const baseOrigin = getBaseOrigin(baseUrl);
  const citations: Citation[] = [];
  const seenUrls = new Set<string>();

  if (Array.isArray(toolInvocations) && !skipLegacyCitations) {
    // Pass 1: prefer structured citations (Tier 1 propagation). Tools attach
    // these via MCP `_meta.citations` and the worker forwards them on each
    // invocation. Subagents aggregate child citations into their wrapper.
    for (const inv of toolInvocations as InvocationLike[]) {
      if (Array.isArray(inv.citations)) {
        for (const c of inv.citations) {
          if (isStructuredCitation(c))
            addStructuredCitation(citations, seenUrls, baseUrl, c);
        }
      }
    }
    // Pass 2: regex fallback. Catches tools that haven't migrated yet and
    // any IDs the agent itself emitted into a child tool's text result.
    for (const inv of toolInvocations as InvocationLike[]) {
      collectFromInvocation(
        citations,
        seenUrls,
        inv,
        baseUrl,
        baseOrigin,
        options.defaultChannelId,
      );
    }
  }

  // Pass 3: LLM-provided citations from add_citations tool — ALWAYS included.
  const keyPointEntries: KeyPointEntry[] = [];
  if (Array.isArray(llmCitations)) {
    for (const kp of llmCitations as unknown[]) {
      const r =
        kp && typeof kp === "object" ? (kp as Record<string, unknown>) : {};
      const citation = r["citation"];
      if (isLlmKeyPoint(kp)) {
        const resolved = resolveLlmCitation(baseUrl, kp.citation);
        if (resolved) {
          keyPointEntries.push({
            point: kp.point,
            label: resolved.label,
            url: resolved.url,
          });
          if (resolved.url) seenUrls.add(resolved.url);
        }
      }
    }
  }

  // Final fallback: parse the assistant markdown itself for direct links / IDs.
  // Skip this when includeCitations is false (legacy mode only).
  if (!skipLegacyCitations) {
    collectFromText(
      citations,
      seenUrls,
      markdown,
      baseUrl,
      baseOrigin,
      options.defaultChannelId,
    );
  }

  const limit = options.maxCitations ?? 8;
  const finalCitations = citations.slice(0, limit);
  if (finalCitations.length === 0 && keyPointEntries.length === 0) {
    return markdown;
  }

  let citationBlock = "";
  if (keyPointEntries.length > 0) {
    const lines = keyPointEntries.map(
      (kp, idx) => `${idx + 1}. ${kp.point} ||| [${kp.label}](${kp.url})`,
    );
    citationBlock = `<citation>\n${lines.join("\n")}\n</citation>`;
  } else if (finalCitations.length > 0) {
    const lines = finalCitations.map((c, idx) =>
      c.url ? `${idx + 1}. [${c.label}](${c.url})` : `${idx + 1}. ${c.label}`,
    );
    citationBlock = `<citation>\n${lines.join("\n")}\n</citation>`;
  }
  const appended = `${markdown.trimEnd()}\n\n${citationBlock}`;
  return appended;
}
