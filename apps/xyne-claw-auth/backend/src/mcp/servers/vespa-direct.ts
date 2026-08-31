/**
 * Direct Vespa access for the `spaces-vespa-search` MCP tool and the other
 * direct-Vespa callers (corpus scan, evidence pack, context assembler), gated
 * by DIRECT_VESPA_SEARCH. Callers hand queryDirect() a YQL string built in
 * code; it injects the per-schema ACL guard, picks a rank profile, runs the
 * query against VESPA_QUERY_ENDPOINT, and shapes the response.
 *
 * NOTE: this is NOT used by `spaces-search`. That tool always goes through the
 * Spaces backend /api/vespaSearch (the canonical YqlBuilder). An earlier
 * structured-params builder (searchDirect/buildYql) lived here too, but it was
 * a drift-prone second copy of YqlBuilder and was removed once spaces-search
 * was decoupled.
 *
 * ACL semantics below mirror backend/src/vespa/src/utils/YqlBuilder.ts — keep
 * aclConditionForSchema() in sync with any backend ACL/schema change.
 */

// ── Rank profiles ─────────────────────────────────────────────────────────────
// Mirrors the backend RankProfile enum (backend/src/vespa/src/types.ts):
//   RankProfile.nativeRank === "default_native"
// "default_native" is the only relevance profile defined across ALL queried
// schemas (ticket, mail, file, chat_message, …), so it is safe for multi-source
// YQL. NOTE: the literal "nativeRank" is the enum *key*, not a real Vespa
// profile — sending it makes Vespa reject the request with
// "No profile named 'nativeRank' exists in schemas [...]".   
const RANK_PROFILE_NATIVE = "default_native";
// Vespa's built-in no-op profile — used for filter-only / grouping / count
// queries that need no relevance scoring (and therefore no ranking inputs).
const RANK_PROFILE_UNRANKED = "unranked";

// The backend RankProfile enum *keys* are not the profile names Vespa knows.
// Map them to the real profile so a stray enum-key string can't reproduce the
// "No profile named 'nativeRank' exists in schemas" failure.
const PROFILE_ALIASES: Record<string, string> = {
  nativeRank: RANK_PROFILE_NATIVE,
  personalizedRank: "personalized",
  fuzzyRank: "default_fuzzy",
};

/**
 * Validate/normalize an agent-supplied rank profile name (read from a schema's
 * `rank-profile <name> { ... }` block). Returns null when absent or unsafe so
 * the caller falls back to auto-selection. Rejects anything that isn't a bare
 * identifier to prevent query-param injection.
 */
function resolveRankProfile(p: unknown): string | null {
  if (typeof p !== "string") return null;
  const t = p.trim();
  if (!t || !/^[A-Za-z0-9_]+$/.test(t)) return null;
  return PROFILE_ALIASES[t] ?? t;
}

/**
 * Map a rank-input name to its Vespa query-param key. Accepts bare (`alpha`),
 * wrapped (`query(alpha)`) or fully-qualified (`input.query(alpha)`) forms.
 * Returns null if no valid identifier remains.
 */
function rankInputKey(k: string): string | null {
  const m = k.trim().match(/query\(([^)]+)\)/i);
  const name = (m ? m[1]! : k.trim()).replace(/[^A-Za-z0-9_]/g, "");
  return name ? `input.query(${name})` : null;
}

/** Standard input set for the default_native relevance profile. */
export function defaultNativeInputs(query: string): Record<string, unknown> {
  const text = query.trim();
  return {
    "input.query(alpha)": 0.5,
    "input.query(query_length)": text.split(/\s+/).filter(Boolean).length || 0,
    "input.query(freshness_weight)": 0.0,
    "input.query(filtering_weight)": 0.0,
    "input.query(time_from)": 0,
    "input.query(time_to)": Date.now(),
    ...(text ? { "input.query(e)": "embed(hf-embedder, @query)" } : {}),
  };
}

// ── YQL value escaping ────────────────────────────────────────────────────────

/** Escape backslashes and double-quotes in values interpolated into YQL strings. */
export function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ── Date literal conversion ───────────────────────────────────────────────────
// The agent writes date filters inline in YQL as dd/mm/yy (or dd/mm/yyyy), with an
// OPTIONAL time — e.g. `createdAtTimestamp > 01/06/26` or `> 01/06/26 14:30` — instead
// of raw epoch ms. Rewrite each such literal to milliseconds since epoch before the
// YQL reaches Vespa, since the timestamp fields (createdAtTimestamp, updatedAt, …)
// are ms-since-epoch.
//
// Conversion is ANCHORED to a comparison operator (`> < >= <=`) — dates are only
// ever compared, never `contains`-matched. This is deliberate: a `dd/mm/yy`-shaped
// string can legitimately appear as literal TEXT (e.g. `content contains "meet
// 01/02/26"`, or a value the user is searching for), and that must be left alone.
// Only a date on the right of a comparison is treated as a real filter.
// The literal may be bare or quoted ("01/06/26 14:30"); quotes are stripped so the
// result is a numeric comparison, not a string one. Interpreted in IST to match the
// app's Asia/Kolkata display convention (see toIST): a bare date is IST midnight,
// and any supplied time is an IST wall-clock time. Time is HH:MM with optional :SS.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // Asia/Kolkata, fixed +05:30, no DST

export function convertDateLiteralsToMs(yql: string): string {
  return yql.replace(
    /([<>]=?\s*)(['"]?)(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\2/g,
    (_m, op: string, _q: string, dd: string, mm: string, yy: string, HH?: string, MM?: string, SS?: string) => {
      const literal = _m.slice(op.length).replace(/^['"]|['"]$/g, "");
      const bad = () => {
        throw new Error(`Invalid date literal "${literal}" in YQL — expected dd/mm/yy or "dd/mm/yy HH:MM" (e.g. 01/06/26 or "01/06/26 14:30").`);
      };
      const day = Number(dd);
      const month = Number(mm);
      const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
      const hour = HH != null ? Number(HH) : 0;
      const min = MM != null ? Number(MM) : 0;
      const sec = SS != null ? Number(SS) : 0;
      if (month < 1 || month > 12 || day < 1 || day > 31) bad();
      if (hour > 23 || min > 59 || sec > 59) bad();
      // IST wall-clock (midnight if no time given), expressed as epoch ms.
      const ms = Date.UTC(year, month - 1, day, hour, min, sec) - IST_OFFSET_MS;
      if (Number.isNaN(ms)) bad();
      // Preserve the operator + spacing; only the value becomes ms.
      return `${op}${ms}`;
    },
  );
}

// ── ACL conditions ────────────────────────────────────────────────────────────
// Referenced by injectAclGuard()/aclConditionForSchema() to harden agent-written
// raw YQL. Mirrors the per-schema ACL in backend/src/vespa/src/utils/YqlBuilder.ts.

/** Bench lane (onyx-ask-ai child spawned with ONYX_BENCH_VESPA=true): the
 *  benchmark ingest marks its channels `permissions: ["*"]` = everyone in the
 *  workspace can read */
const isBenchLane = (): boolean => (process.env["ONYX_BENCH_VESPA"] ?? "").trim() === "true";

export const ACL = {
  simple: (userId: string) =>
    isBenchLane()
      ? `(permissions contains "${esc(userId)}" or permissions contains "*")`
      : `permissions contains "${esc(userId)}"`,

  // Member-or-public guard, shared by channel (chat_container) AND ticket:
  // visible if the user is in `permissions` (member list) OR the (owning) channel
  // is public (`isPrivate` false). chat_container has a direct `permissions` +
  // `isPrivate` bool; ticket imports both from its channelRef. public == isPrivate
  // false (same convention as file ACL).
  channel: (userId: string) =>
    `(permissions contains "${esc(userId)}" or isPrivate contains "false")`,

  // Mirrors buildPermGuard for the file schema — the mandatory outer AND that main applies
  // on top of buildFileConditions. Used by injectAclGuard so agent-written file queries
  // get the same hard guard as the backend applies.
  // file schema has: ownerId=true, channelPermissions=true, isPrivate=true.
  filePerm: (userId: string) =>
    `(permissions contains "${esc(userId)}" or ownerId contains "${esc(userId)}" or channelPermissions contains "${esc(userId)}" or isPrivate contains "false")`,
};

// ── Result transformer ────────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  context?: string;
  relevanceScore?: number;
  metadata?: Record<string, unknown>;
  searchContext?: Record<string, unknown>;
  rawFields?: Record<string, unknown>;
  /** Per-hit rank feature breakdown (bm25(text), vector_score, combined_nativeRank,
   *  etc.) — whatever the active rank profile's `match-features {}` block declares.
   *  Vespa attaches these to `fields.matchfeatures`/`rankfeatures` automatically
   *  whenever the profile declares them; mirrors resultTransform.ts's debugInfo. */
  debugInfo?: { matchfeatures?: Record<string, unknown>; rankfeatures?: Record<string, unknown> };
}

/**
 * Parse a file doc's `metadata` JSON string. Ingestion stashes per-subApp
 * deep-link ids there instead of as top-level fields (see backend mapper.ts):
 * CANVAS → viewAccessId/editAccessId/channelId; RCA → ticketId. Returns {} on
 * a missing/corrupt blob so callers can read keys unconditionally.
 */
function parseFileMetadata(f: Record<string, unknown>): Record<string, unknown> {
  const raw = f["metadata"];
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** First non-empty value, stringified — searchContext fields are all strings. */
function str(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s) return s;
  }
  return undefined;
}

export function transformHit(
  hit: Record<string, unknown>,
  includeRawFields = false,
): SearchResult {
  const f = (hit["fields"] ?? {}) as Record<string, unknown>;
  const docType = String(f["docType"] ?? f["sddocname"] ?? "unknown");
  const relevance = typeof hit["relevance"] === "number" ? hit["relevance"] : 0;

  // Title
  let title = "";
  let subtitle: string | undefined;
  let context: string | undefined;

  const textVal = Array.isArray(f["text"]) ? (f["text"] as string[]).join(" ") : String(f["text"] ?? "");

  if (docType === "message" || docType === "chat") {
    // chat_message's channel name is `messageChannelName` (not `channelName`), and
    // the sender's display name is `username` — both were dropped, leaving a raw
    // channelId title and a nameless sender.
    title = String(f["messageChannelName"] ?? f["channelName"] ?? f["channelId"] ?? "Message");
    subtitle = String(f["username"] ?? f["userId"] ?? f["senderId"] ?? "");
    context = textVal;
  } else if (docType === "ticket") {
    title = String(f["title"] ?? f["xyneId"] ?? "Ticket");
    subtitle = String(f["xyneId"] ?? "");
    context = String(f["description"] ?? f["initialMessage"] ?? textVal);
  } else if (docType === "file") {
    // fileName comes back with Vespa <hi>…</hi> highlight markup on query
    // matches — strip it; this string becomes the citation chip label / KB
    // fileName (a raw `<hi>` label leaks into the deep-linked file chip).
    title = String(f["fileName"] ?? f["title"] ?? "File").replace(/<\/?hi>/gi, "");
    subtitle = String(f["subApp"] ?? "");
    // file content lives in `description` + `chunks` (both in the default
    // summary; `text` doesn't exist on file). description is the summary
    // (transcripts put their summary/action-items here); chunks are the
    // best-matching body snippets. Surface both so the LLM gets real content.
    const chunksVal = Array.isArray(f["chunks"]) ? (f["chunks"] as string[]).join("\n") : String(f["chunks"] ?? "");
    context = [String(f["description"] ?? ""), chunksVal].filter(Boolean).join("\n") || textVal;
  } else if (docType === "user") {
    title = String(f["name"] ?? f["email"] ?? "User");
    subtitle = String(f["email"] ?? "");
  } else if (docType === "channel") {
    title = String(f["name"] ?? f["channelName"] ?? "Channel");
    subtitle = String(f["scopeType"] ?? "");
    // channel body: description + topic (either may be empty).
    context = [String(f["description"] ?? ""), String(f["topic"] ?? "")].filter(Boolean).join(" — ") || undefined;
  } else if (docType === "attachment") {
    title = String(f["fileName"] ?? f["filename"] ?? f["title"] ?? "Attachment");
    subtitle = String(f["channelName"] ?? "");
    // Same as file: content is in the best-matching `chunks` (+ description if
    // present); `text` doesn't exist on the attachment schema.
    const chunksVal = Array.isArray(f["chunks"]) ? (f["chunks"] as string[]).join("\n") : String(f["chunks"] ?? "");
    context = [String(f["description"] ?? ""), chunksVal].filter(Boolean).join("\n") || textVal;
  } else if (docType === "sam_transcript") {
    title = String(f["title"] ?? f["meetingTitle"] ?? "Transcript");
    context = String(f["meetingSummary"] ?? textVal);
  } else if (docType === "mail") {
    // subject comes back with Vespa <hi>…</hi> highlight markup on query
    // matches (`bolding: on` in mail.sd) — strip it; this string becomes the
    // citation chip label. Empty subject falls back to "Email".
    title = str(String(f["subject"] ?? "").replace(/<\/?hi>/gi, "")) ?? "Email";
    subtitle = String(f["from"] ?? "");
    context = Array.isArray(f["chunks"]) ? (f["chunks"] as string[]).join(" ") : textVal;
  } else if (docType === "project") {
    // project's name field (not `title`) is the human label; description is body.
    title = String(f["name"] ?? f["title"] ?? f["docId"] ?? "Project");
    context = String(f["description"] ?? textVal);
  } else {
    title = String(f["title"] ?? f["docId"] ?? docType);
    // Surface whatever body the schema/summary provides: description +
    // best-matching chunks + text, whichever are present.
    const chunksVal = Array.isArray(f["chunks"]) ? (f["chunks"] as string[]).join("\n") : String(f["chunks"] ?? "");
    context = [String(f["description"] ?? ""), chunksVal, textVal].filter(Boolean).join("\n");
  }

  // Timestamp field differs by schema
  const rawTs = f["timestamp"] ?? f["createdAtTimestamp"] ?? f["dateTime"] ?? f["createdAt"];
  const tsStr = rawTs != null ? String(rawTs) : "";

  // Per-schema id normalization — the raw schemas name the citation-routing ids
  // differently, and reading only the canonical names silently drops them (the
  // original cause of channel-level-only / uncited rows from the direct tools).
  // Mirrors backend resultTransform.ts so both search paths route identically:
  //   chat_message: thread id is `threadId`, the message's own id is `docId`
  //   ticket:       conversation id is `convId`
  //   chat_container: the doc IS the channel — its id is `docId`
  //   mail:         `docId` IS the Postgres email.id (the FE's ?mail= param);
  //                 channel/ticket ids need a Postgres join (renderDirectResult)
  //   file:         CANVAS viewAccessId + RCA ticketId live in metadata JSON
  // Include the raw sddocname fallbacks — a hit missing docType in its summary
  // reports its schema name instead.
  const isMessage = docType === "message" || docType === "chat" || docType === "chat_message";
  const isChannel = docType === "channel" || docType === "chat_container";
  const fileMeta = docType === "file" ? parseFileMetadata(f) : {};

  const channelId = str(f["channelId"], isChannel ? f["docId"] : undefined, fileMeta["channelId"]);
  const conversationId = str(
    f["conversationId"],
    isMessage ? f["threadId"] : undefined,
    docType === "ticket" ? f["convId"] : undefined,
  );
  const messageId = str(f["messageId"], isMessage ? f["docId"] : undefined);
  const viewAccessId = str(f["viewAccessId"], fileMeta["viewAccessId"]);
  const ticketId = docType === "file" ? str(f["ticketId"], fileMeta["ticketId"]) : undefined;
  const mailId = docType === "mail" ? str(f["docId"]) : undefined;
  // KB collection files carry their deep-link ids denormalized on the doc
  // (ingest mapper.ts mapFile): clId=root collection, clFd=parent folder,
  // projectId=owning channel's project. channelId is imported from channelRef.
  // Surfacing them lets renderDirectResult build the /knowledge-base file URL
  // (a collection-item citation) instead of a channel-level thread chip.
  const collectionId = docType === "file" ? str(f["clId"], fileMeta["clId"]) : undefined;
  const folderId = docType === "file" ? str(f["clFd"], fileMeta["clFd"]) : undefined;
  const projectId = docType === "file" ? str(f["projectId"], fileMeta["projectId"]) : undefined;

  // Broaden the surfaced fields — the raw doc carries structured attributes
  // (assignee/creator/board/project names, priority/stage, owner, mime/size, mail
  // recipients, tags) that the renderer already supports but the transform used to
  // drop. Include whatever is present so the LLM sees the real metadata, not just
  // title/context. Arrays are joined; ids kept so the agent can reuse them.
  const tags = Array.isArray(f["tags"]) ? (f["tags"] as string[]).filter(Boolean).join(", ") : str(f["tags"]);
  const toList = Array.isArray(f["to"]) ? (f["to"] as string[]).join(", ") : str(f["to"]);
  const ccList = Array.isArray(f["cc"]) ? (f["cc"] as string[]).join(", ") : str(f["cc"]);
  const labelList = Array.isArray(f["labels"]) ? (f["labels"] as string[]).join(", ") : str(f["labels"]);
  // Mail-specific extras (gated on docType so message/ticket — which also have a
  // `threadId`/`generatedTags` — don't pick these up redundantly). Arrays joined.
  const isMail = docType === "mail";
  const join = (v: unknown) => (Array.isArray(v) ? (v as string[]).filter(Boolean).join(", ") : str(v));
  const bccList = isMail ? join(f["bcc"]) : undefined;
  const attachNames = isMail ? join(f["attachmentFilenames"]) : undefined;
  const mailPeople = isMail ? join(f["entityPeople"]) : undefined;
  const mailProducts = isMail ? join(f["entityProducts"]) : undefined;
  const mailMerchants = isMail ? join(f["entityMerchants"]) : undefined;
  const mailGenTags = isMail ? join(f["generatedTags"]) : undefined;

  return {
    id: String(f["docId"] ?? hit["id"] ?? ""),
    type: docType,
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(context ? { context } : {}),
    relevanceScore: relevance,
    metadata: {
      ...(tsStr ? { timestamp: tsStr } : {}),
      ...(f["updatedAt"] ? { updatedAt: String(f["updatedAt"]) } : {}),
      ...(f["channelName"] ? { channelName: String(f["channelName"]) } : {}),
      ...(f["status"] ? { status: String(f["status"]) } : {}),
      ...(f["priority"] ? { priority: String(f["priority"]) } : {}),
      ...(f["stage"] ? { stage: String(f["stage"]) } : {}),
      ...(f["messageType"] ? { messageType: String(f["messageType"]) } : {}),
      // channel attributes.
      ...(f["visibility"] ? { visibility: String(f["visibility"]) } : {}),
      ...(typeof f["memberCount"] === "number" ? { memberCount: f["memberCount"] } : {}),
      ...(f["lastActivityAt"] ? { lastActivityAt: String(f["lastActivityAt"]) } : {}),
    },
    searchContext: {
      ...(channelId ? { channelId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(f["userId"] ? { senderId: String(f["userId"]) } : {}),
      ...(f["userEmail"] ? { senderEmail: String(f["userEmail"]) } : {}),
      ...(f["username"] ? { senderName: String(f["username"]) } : {}),
      ...(typeof f["replyCount"] === "number" && f["replyCount"] > 0 ? { replyCount: f["replyCount"] } : {}),
      ...(f["xyneId"] ? { xyneId: String(f["xyneId"]) } : {}),
      ...(f["subApp"] ? { subApp: String(f["subApp"]) } : {}),
      // Ticket people (names for display, ids for follow-up queries).
      ...(f["createdByName"] ? { creatorName: String(f["createdByName"]) } : {}),
      ...(f["assignedToName"] ? { assigneeName: String(f["assignedToName"]) } : {}),
      ...(f["closedByName"] ? { closedByName: String(f["closedByName"]) } : {}),
      ...(f["createdBy"] ? { createdBy: String(f["createdBy"]) } : {}),
      ...(f["assignedTo"] ? { assignedTo: String(f["assignedTo"]) } : {}),
      ...(f["boardName"] ? { boardName: String(f["boardName"]) } : {}),
      ...(f["projectName"] ? { projectName: String(f["projectName"]) } : {}),
      ...(f["projectId"] ? { projectId: String(f["projectId"]) } : {}),
      ...(tags ? { tags } : {}),
      // File owner + type/size.
      ...(f["ownerId"] ? { ownerId: String(f["ownerId"]) } : {}),
      ...(f["ownerEmail"] ? { ownerEmail: String(f["ownerEmail"]) } : {}),
      ...(f["mimeType"] ? { mimeType: String(f["mimeType"]) } : {}),
      ...(typeof f["fileSize"] === "number" ? { fileSize: f["fileSize"] } : {}),
      // Mail recipients / labels.
      ...(toList ? { to: toList } : {}),
      ...(ccList ? { cc: ccList } : {}),
      ...(bccList ? { bcc: bccList } : {}),
      ...(labelList ? { labels: labelList } : {}),
      // Mail thread ids (to pull the full reply thread), attachments, extracted
      // entities, and provenance.
      ...(isMail && f["threadId"] ? { threadId: String(f["threadId"]) } : {}),
      ...(isMail && f["parentThreadId"] ? { gmailThreadId: String(f["parentThreadId"]) } : {}),
      ...(attachNames ? { attachments: attachNames } : {}),
      ...(mailPeople ? { people: mailPeople } : {}),
      ...(mailProducts ? { products: mailProducts } : {}),
      ...(mailMerchants ? { merchants: mailMerchants } : {}),
      ...(mailGenTags ? { generatedTags: mailGenTags } : {}),
      ...(isMail && f["entity"] ? { entity: String(f["entity"]) } : {}),
      ...(isMail && f["app"] ? { app: String(f["app"]) } : {}),
      ...(isMail && f["fileType"] ? { fileType: String(f["fileType"]) } : {}),
      ...(viewAccessId ? { viewAccessId } : {}),
      ...(ticketId ? { ticketId } : {}),
      ...(mailId ? { mailId } : {}),
      ...(collectionId ? { collectionId } : {}),
      ...(folderId ? { folderId } : {}),
      ...(projectId ? { projectId } : {}),
    },
    ...("matchfeatures" in f || "rankfeatures" in f
      ? {
          debugInfo: {
            ...("matchfeatures" in f ? { matchfeatures: f["matchfeatures"] as Record<string, unknown> } : {}),
            ...("rankfeatures" in f ? { rankfeatures: f["rankfeatures"] as Record<string, unknown> } : {}),
          },
        }
      : {}),
    ...(includeRawFields ? { rawFields: f } : {}),
  };
}

// ── Grouped response parser (mirrors backend's parseVespaResults) ─────────────

interface GroupResult {
  groupBy: string;
  groupValue: string;
  hits: Record<string, unknown>[];
  vespaCount?: number;
}

function extractGroups(
  items: Record<string, unknown>[],
  groups: GroupResult[],
  groupByField?: string,
  groupValue?: string,
): void {
  for (const item of items) {
    const id = String(item["id"] ?? "");
    if (id.startsWith("grouplist:")) {
      const field = String((item as Record<string, unknown>)["label"] ?? id.replace("grouplist:", ""));
      if (Array.isArray(item["children"])) {
        extractGroups(item["children"] as Record<string, unknown>[], groups, field);
      }
    } else if (id.startsWith("group:")) {
      const val = String((item as Record<string, unknown>)["value"] ?? id.split(":").pop() ?? "");
      const rawCount = (item as Record<string, unknown>)["fields"];
      const vespaCount = rawCount && typeof (rawCount as Record<string, unknown>)["count()"] === "number"
        ? (rawCount as Record<string, unknown>)["count()"] as number
        : undefined;
      if (groupByField) {
        const existing = groups.find(g => g.groupBy === groupByField && g.groupValue === val);
        if (!existing) {
          const newGroup: GroupResult = { groupBy: groupByField, groupValue: val, hits: [] };
          if (vespaCount !== undefined) newGroup.vespaCount = vespaCount;
          groups.push(newGroup);
        } else if (vespaCount !== undefined) {
          existing.vespaCount = vespaCount;
        }
      }
      if (Array.isArray(item["children"])) {
        extractGroups(item["children"] as Record<string, unknown>[], groups, groupByField, val);
      }
    } else if ((item as Record<string, unknown>)["fields"] && groupByField && groupValue) {
      const existing = groups.find(g => g.groupBy === groupByField && g.groupValue === groupValue);
      if (existing) {
        existing.hits.push(item);
      } else {
        groups.push({ groupBy: groupByField, groupValue, hits: [item] });
      }
    } else if (Array.isArray(item["children"])) {
      extractGroups(item["children"] as Record<string, unknown>[], groups, groupByField, groupValue);
    }
  }
}

// ── Vespa HTTP client ─────────────────────────────────────────────────────────

/** Raw Vespa /search/ POST — no ACL/workspace logic of its own; callers (queryDirect,
 *  and the ACL-bypassing search-eval-vespa.ts) are responsible for what's in `payload.yql`. */
export async function callVespa(payload: Record<string, unknown>, endpoint: string): Promise<Record<string, unknown>> {
  const url = `${endpoint}/search/`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Vespa search ${response.status}: ${text.slice(0, 400)}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

// ── ACL guard injector ────────────────────────────────────────────────────────

/**
 * Derive the ACL condition for a schema, matching backend YqlBuilder exactly.
 *
 * - message / attachment / mail / mail_attachment / memory:
 *     permissions contains "<userId>"  (buildChatConditions)
 * - ticket:
 *     Member-or-public: `permissions contains "<userId>" or isPrivate contains "false"`
 *     (permissions + isPrivate are imported from the ticket's channelRef).
 * - file:
 *     per-subApp OR'd guards (buildFileConditions, all-subApps path)
 * - channel (chat_container):
 *     A channel the user is a member of OR a public channel
 *     (`permissions contains <userId> or isPrivate contains "false"`).
 * - user / project / sam_transcript / memory:
 *     NO permissions field exists, so a membership guard is impossible. These
 *     are public / workspace-isolated by design (workspaceId at top level).
 * - default:
 *     Fail closed — an unrecognized source gets the simple membership guard
 *     rather than running unscoped. If the source has no `permissions` field
 *     Vespa rejects the query, which is the safe outcome for an unknown source.
 *
 * The `schema` passed here is already stripped of any cluster prefix by the
 * caller (e.g. `my_content.chat_message` → `chat_message`).
 */
export function aclConditionForSchema(schema: string, userId: string, _yql: string): string | null {
  switch (schema.toLowerCase()) {
    // `permissions` (imported from the channel, or direct) is the boundary.
    case "message":
    case "chat_message":
    case "attachment":
    case "chat_attachment":
    case "mail":
    case "mail_attachment":
    case "memory":
      return ACL.simple(userId);
    case "ticket":
      // Ticket imports permissions + isPrivate from its channel, so the guard is
      // the member-or-public-channel rule: in permissions OR the channel is public.
      return ACL.channel(userId);
    case "file":
      // Use filePerm (buildPermGuard equivalent) not fileAll (buildFileConditions inner conditions).
      // The guard is what main AND's on top; it covers all subApps including RCA.
      return ACL.filePerm(userId);
    case "channel":
    case "chat_container":
      return ACL.channel(userId);
    // No `permissions` field — public / workspace-isolated, left unguarded.
    case "user":
    case "project":
    case "sam_transcript":
      return null;
    default:
      // Fail closed: unknown source still gets a membership guard.
      return ACL.simple(userId);
  }
}

/**
 * Public-only visibility condition for a schema — matches content anyone
 * could see, no channel membership required. Used by search-eval-vespa.ts's
 * "without permission" mode: that path has no real authenticated user to
 * check `permissions` against, so it must never fall back to "no restriction
 * at all" (that was the prior, unsafe behavior — it exposed private channels
 * and DMs). This is the honest alternative: public content only.
 *
 * - message/channel/ticket/file: each carries (or imports from its channel) an
 *   `isPrivate` bool — public == `isPrivate contains "false"` (same field
 *   ACL.channel/ACL.filePerm OR into their real per-user guard).
 * - mail: there is no public/private concept for email — every message has a
 *   fixed recipient set, so nothing can ever legitimately be "public mail".
 *   Returns a condition that's always false (checked against the real `docType`
 *   field so Vespa doesn't hard-error like it would on a genuinely missing
 *   field) rather than throwing, so an "All types" run still returns the
 *   other schemas' public results instead of aborting entirely.
 */
export function publicOnlyConditionForSchema(schema: string): string {
  switch (schema.toLowerCase()) {
    case "message":
    case "chat_message":
    case "channel":
    case "chat_container":
    case "ticket":
    case "file":
      return `isPrivate contains "false"`;
    case "mail":
    case "mail_attachment":
      return `docType contains "__no_public_mail__"`;
    default:
      throw new Error(`publicOnlyConditionForSchema: no public/private policy defined for schema "${schema}".`);
  }
}

/**
 * Locate the `where` clause body and the start of the trailing clauses
 * (order by / limit / offset / timeout / grouping `|`) in a YQL statement.
 * Scans at top level only: keywords inside quoted strings ("rate limit 5")
 * or inside parentheses (nested annotations) are not clause boundaries.
 *
 * Returns `whereStart` = index just past the `where` keyword (null if the
 * statement has no where clause) and `tailStart` = index of the first trailing
 * clause (yql.length if none).
 */
function splitYqlClauses(yql: string): { whereStart: number | null; tailStart: number } {
  let inQuote: string | null = null;
  let depth = 0;
  let whereStart: number | null = null;
  for (let i = 0; i < yql.length; i++) {
    const ch = yql[i]!;
    if (inQuote) {
      if (ch === "\\") i++;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === "(") { depth++; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === "|") return { whereStart, tailStart: i };
    // Keyword must start at a word boundary (not mid-identifier like `mylimit`).
    if (/[A-Za-z]/.test(ch) && (i === 0 || !/[\w.]/.test(yql[i - 1]!))) {
      const m = yql.slice(i).match(/^(order\s+by|limit|offset|timeout|where)\b/i);
      if (m) {
        if (m[1]!.toLowerCase() === "where") {
          if (whereStart === null) whereStart = i + m[0]!.length;
          i += m[0]!.length - 1;
          continue;
        }
        return { whereStart, tailStart: i };
      }
    }
  }
  return { whereStart, tailStart: yql.length };
}

/**
 * Inject the correct per-schema ACL guard into agent-written YQL if missing.
 * Matches the ACL logic of backend YqlBuilder exactly.
 *
 * The guard must land INSIDE the where clause — before any `order by` /
 * `limit` / `offset` / `timeout` / grouping `|` tail — and the existing where
 * body is wrapped in parens so a top-level `or` can't escape the guard
 * (`where a or b and ACL` would parse as `a or (b and ACL)`).
 */
function injectAclGuard(yql: string, userId: string): string {
  // If any ACL field is already present, trust the agent.
  // Use \b to avoid false match on "channelPermissions contains" for the bare "permissions" check.
  if (/\bpermissions\s+contains|ownerId\s+contains|channelPermissions\s+contains/i.test(yql)) return yql;

  // Extract the source from `from sources <source>`. The source may be
  // cluster-qualified (e.g. `my_content.chat_message`), so capture the full
  // dotted token and use the last segment as the schema name.
  const sourceMatch = yql.match(/from\s+sources\s+([\w.]+)/i);
  const schema = (sourceMatch?.[1] ?? "").split(".").pop() ?? "";
  const acl = aclConditionForSchema(schema, userId, yql);
  if (!acl) return yql; // no guard needed for this schema

  const { whereStart, tailStart } = splitYqlClauses(yql);
  const tail = yql.slice(tailStart).trim();
  if (whereStart === null) {
    // No where clause at all (e.g. bare grouping/count query) — add one.
    const head = yql.slice(0, tailStart).trimEnd();
    return tail ? `${head} where ${acl} ${tail}` : `${head} where ${acl}`;
  }
  const head = yql.slice(0, whereStart); // ends with the `where` keyword
  const body = yql.slice(whereStart, tailStart).trim();
  return tail ? `${head} (${body}) and ${acl} ${tail}` : `${head} (${body}) and ${acl}`;
}

function injectWorkspaceGuard(yql: string, workspaceId: string): string {
  const workspace = `workspaceId contains "${esc(workspaceId)}"`;
  const { whereStart, tailStart } = splitYqlClauses(yql);
  const tail = yql.slice(tailStart).trim();
  if (whereStart === null) {
    const head = yql.slice(0, tailStart).trimEnd();
    return tail ? `${head} where ${workspace} ${tail}` : `${head} where ${workspace}`;
  }
  const head = yql.slice(0, whereStart);
  const body = yql.slice(whereStart, tailStart).trim();
  return tail ? `${head} (${body}) and ${workspace} ${tail}` : `${head} (${body}) and ${workspace}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DirectSearchResponse {
  success: true;
  data: {
    grouped: boolean;
    groups?: Array<{ groupValue: string; count: number; results: SearchResult[] }>;
    results?: SearchResult[];
    totalCount?: number;
    debug?: { payloads: Array<{ stage: string; yql: string; vespaParams: Record<string, unknown> }> };
  };
}

/**
 * Execute a raw agent-written YQL query directly against Vespa.
 * ACL guard (`permissions contains "<userId>"`) is injected automatically
 * if the agent omitted it.
 */
export async function queryDirect(
  yql: string,
  query: string,
  userId: string,
  hits: number,
  offset: number,
  vespaQueryEndpoint: string,
  rankProfile?: string,
  rankInputs?: Record<string, unknown>,
  workspaceId?: string,
  includeRawFields = false,
): Promise<DirectSearchResponse> {
  if (!userId) throw new Error("queryDirect: userId is required for ACL enforcement — XYNE_USER_ID is not set.");
  if (workspaceId !== undefined && !workspaceId.trim()) throw new Error("queryDirect: workspaceId is required for workspace enforcement.");
  // Rewrite any dd/mm/yy date literals the agent wrote inline to epoch ms before
  // ACL injection / execution — the timestamp fields Vespa compares against are ms.
  const datedYql = convertDateLiteralsToMs(yql.trim());
  const aclYql = injectAclGuard(datedYql, userId);
  const safeYql = workspaceId ? injectWorkspaceGuard(aclYql, workspaceId.trim()) : aclYql;

  // Rank profile selection:
  //  1. An explicit profile wins — the caller (agent) reads the schema's
  //     `rank-profile` blocks and passes the one it wants. Validated/aliased.
  //  2. Otherwise auto-pick. Ranking is only meaningful for free-text relevance
  //     search; a filter-only or grouping/count query (e.g.
  //     `... | all(group(status) each(output(count())))`) has nothing to rank,
  //     so it uses the built-in `unranked` profile. Free-text → `default_native`.
  const pipeIdx = safeYql.indexOf("|");
  const isGrouping = pipeIdx !== -1 && /group\s*\(/i.test(safeYql.slice(pipeIdx));
  const hasText = !!query.trim();
  const explicitProfile = resolveRankProfile(rankProfile);
  const profile = explicitProfile ?? (isGrouping || !hasText ? RANK_PROFILE_UNRANKED : RANK_PROFILE_NATIVE);

  const payload: Record<string, unknown> = {
    yql: safeYql,
    query: query || "",
    hits,
    offset,
    timeout: "30s",
    tracelevel: 0,
    "ranking.profile": profile,
  };

  // `unranked` takes no inputs. For any scoring profile, send the inputs the
  // agent supplied (read from the profile's `inputs {}` block); fall back to the
  // standard default_native input set when none were given.
  if (profile !== RANK_PROFILE_UNRANKED) {
    const explicit = rankInputs && typeof rankInputs === "object"
      ? Object.fromEntries(
          Object.entries(rankInputs)
            .map(([k, v]) => [rankInputKey(k), v] as const)
            .filter((e): e is [string, unknown] => e[0] !== null),
        )
      : {};
    Object.assign(payload, Object.keys(explicit).length > 0 ? explicit : defaultNativeInputs(query));
  }

  const debug = { payloads: [{ stage: "direct", yql: safeYql, vespaParams: {} as Record<string, unknown> }] };

  let raw: Record<string, unknown>;
  try {
    raw = await callVespa(payload, vespaQueryEndpoint);
  } catch (e) {
    // Attach the query that actually hit Vespa (ACL-injected + select-normalized)
    // so the tool layer can show the REAL executed query on failure — the raw
    // agent YQL in the tool args is not what ran.
    if (e instanceof Error) (e as Error & { executedYql?: string }).executedYql = safeYql;
    throw e;
  }
  const root = (raw["root"] ?? {}) as Record<string, unknown>;
  const rootFields = (root["fields"] ?? {}) as Record<string, unknown>;
  const totalCount = typeof rootFields["totalCount"] === "number" ? rootFields["totalCount"] : undefined;
  const children = Array.isArray(root["children"]) ? (root["children"] as Record<string, unknown>[]) : [];

  const hasGrouping = children.some(c => {
    const id = String(c["id"] ?? "");
    return id.startsWith("group:") || id.startsWith("grouplist:");
  });

  if (hasGrouping) {
    const groups: GroupResult[] = [];
    extractGroups(children, groups);
    return {
      success: true,
      data: {
        grouped: true,
        groups: groups.map(g => ({
          groupValue: g.groupValue,
          count: g.vespaCount ?? g.hits.length,
          results: g.hits.map(h => transformHit(h, includeRawFields)),
        })),
        debug,
      },
    };
  }

  const results = children.map(h => transformHit(h, includeRawFields));
  return {
    success: true,
    data: {
      grouped: false,
      results,
      ...(totalCount !== undefined ? { totalCount } : {}),
      debug,
    },
  };
}
