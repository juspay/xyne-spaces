/**
 * Structured "search area" → YQL builder for the `spaces-vespa-search` MCP tool.
 *
 * This is the SAFE, structured alternative to the raw-YQL `spaces-vespa-query`
 * escape hatch: the agent declares WHAT it wants (a search area + a typed
 * operator-bag filter set) and CODE — never the LLM — assembles the YQL string.
 * The built string is then handed to queryDirect() in ./vespa-direct.ts, which
 * still does dd/mm/yy→ms date conversion, (idempotent) ACL injection, rank-profile
 * selection and response/citation shaping.
 *
 * Two config layers:
 *   1. SEARCH_AREAS — a search area picks the Vespa `from sources <source>`, the
 *      baseline docType/subApp constraints, the correct per-schema ACL guard, the
 *      timestamp field date filters compare against, and the fields filterable in
 *      that area.
 *   2. FieldDef + operator DSL — each filterable field declares a dataType and the
 *      set of operators the agent may use (eq/in/nin/gt/gte/lt/lte/contains/
 *      containsAny), and CODE maps each (field, op, value) to one AND-able clause.
 *
 * Design mirrors, and is kept deliberately in lockstep with:
 *   - xyne-search's searchCore.ts / searchFilterConfig.ts (the operator-bag DSL
 *     and clause builder this file re-implements for the multi-schema case).
 *   - backend/src/vespa/src/utils/YqlBuilder.ts (the canonical builder; NOT
 *     importable here — separate package — so ACL/schema facts are hand-mirrored,
 *     same as aclConditionForSchema() in ./vespa-direct.ts).
 *
 * TIMESTAMP FIELDS are taken from the Vespa .sd ground truth, NOT from YqlBuilder:
 * `file`/`chat_container` expose `createdAt` (long, ms) and have NO
 * `createdAtTimestamp` (YqlBuilder.buildFileConditions compares the latter — a
 * latent backend bug; do not copy it). `ticket`/`chat_message` use
 * `createdAtTimestamp`; `mail` uses `timestamp`.
 */

import { esc, aclConditionForSchema } from "./vespa-direct.js";

// ── Operator DSL ──────────────────────────────────────────────────────────────

export type DataType = "string" | "number" | "date" | "boolean";
export type FilterTier = "exact" | "range";
export type Operator =
  | "eq" | "in" | "nin"
  | "gt" | "gte" | "lt" | "lte"
  | "contains" | "containsAny";

export interface FieldDef {
  /** Canonical name the agent uses in `filters`. */
  name: string;
  /** Shown in the tool description. */
  description: string;
  dataType: DataType;
  multiValued: boolean;
  /** Vespa column when it differs from `name` (e.g. `ticketId` → `docId`). */
  vespaField?: string;
  tier: FilterTier;
  /** Subset of operators legal for this field's (dataType, tier). */
  operators: Operator[];
  /** Reserved "mine"-style boolean: when eq=true, emits `<field> contains
   *  "<userId>"` using the caller's id (injected in code, never from the LLM).
   *  e.g. channel membership → `permissions contains "<userId>"`. */
  injectsUserIdInto?: string;
}

/** Legal operators per (dataType, tier). Mirrors searchFilterConfig's matrix. */
const ALLOWED_OPS: Record<DataType, Record<FilterTier, ReadonlySet<Operator>>> = {
  string: {
    exact: new Set<Operator>(["eq", "in", "nin", "contains", "containsAny"]),
    range: new Set<Operator>(),
  },
  number: {
    exact: new Set<Operator>(["eq", "in", "nin"]),
    range: new Set<Operator>(["eq", "in", "nin", "gt", "gte", "lt", "lte"]),
  },
  date: {
    exact: new Set<Operator>(),
    range: new Set<Operator>(["gt", "gte", "lt", "lte"]),
  },
  boolean: {
    exact: new Set<Operator>(["eq"]),
    range: new Set<Operator>(),
  },
};

const COMPARISON_SYMBOL: Record<"gt" | "gte" | "lt" | "lte", string> = {
  gt: ">", gte: ">=", lt: "<", lte: "<=",
};

// dd/mm/yy or dd/mm/yyyy, optionally with " HH:MM" / " HH:MM:SS". The actual
// ms conversion happens later in convertDateLiteralsToMs() (vespa-direct.ts);
// here we only shape-validate so a bad literal fails loudly at build time.
const DATE_LITERAL_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;

// ── FieldDef constructors (reduce per-area repetition) ─────────────────────────

const strField = (
  name: string,
  description: string,
  operators: Operator[],
  vespaField?: string,
): FieldDef => ({
  name,
  description,
  dataType: "string",
  multiValued: operators.includes("containsAny") || operators.includes("in"),
  ...(vespaField ? { vespaField } : {}),
  tier: "exact",
  operators,
});

/** A plain boolean filter (eq true/false → `<vespaField> contains "true"|"false"`). */
const boolField = (name: string, description: string, vespaField: string): FieldDef => ({
  name,
  description,
  dataType: "boolean",
  multiValued: false,
  vespaField,
  tier: "exact",
  operators: ["eq"],
});

/** A boolean "mine" filter: when eq=true, restricts to rows where `vespaField`
 *  contains the caller's userId (e.g. permissions → channel membership). */
const mineField = (name: string, description: string, vespaField: string): FieldDef => ({
  name,
  description,
  dataType: "boolean",
  multiValued: false,
  tier: "exact",
  operators: ["eq"],
  injectsUserIdInto: vespaField,
});

/** A date range field. `vespaField` is the area's timestamp column. */
const dateField = (name: string, description: string, vespaField: string): FieldDef => ({
  name,
  description,
  dataType: "date",
  multiValued: false,
  vespaField,
  tier: "range",
  operators: ["gt", "gte", "lt", "lte"],
});

// ── Search-area registry ───────────────────────────────────────────────────────

export interface SearchArea {
  /** YQL `from sources <source>`. */
  source: string;
  /** ANDed unconditionally (docType/subApp scoping). */
  baseConditions: string[];
  /** Selects the ACL clause via aclConditionForSchema(); null = no guard. */
  aclSchemaKey: string | null;
  /** Column the date-typed fields compare against (verified vs .sd). */
  timestampField: string;
  /** Filterable fields for this area. */
  fields: FieldDef[];
  /** Fields the agent may pass to `groupBy`. */
  allowedGroupByFields: string[];
  /** Rank profiles that actually EXIST on this area's source (verified vs the
   *  .sd files). Omitted → BASE_RANK_PROFILES (default_native + unranked, valid
   *  everywhere). Used to validate an agent-supplied rankProfile early. */
  allowedRankProfiles?: string[];
  /** docType values allowed for the optional `docType` narrowing. When absent,
   *  passing `docType` is rejected (the area's docType is fixed by baseConditions). */
  allowedDocTypes?: string[];
  /** HNSW embedding tensor field(s) on this schema (verified vs .sd). When a
   *  free-text query is scored, nearestNeighbor(<field>, e) is OR'd with the
   *  lexical userInput for hybrid retrieval. Empty/absent → lexical only. */
  embeddingFields?: string[];
}

const chatFields = (tsField: string): FieldDef[] => [
  strField("conversationId", "Conversation/thread id.", ["in"], "threadId"),
  strField("channelId", "Channel the message belongs to.", ["contains", "in"]),
  strField("senderId", "User id of the message sender.", ["contains"], "userId"),
  strField("senderEmail", "Email of the message sender.", ["contains"], "userEmail"),
  strField("messageType", "Message type (USER/BOT/SYSTEM/FORWARDED).", ["in", "nin"]),
  boolField("isDM", "Set true for messages in a direct-message (1:1) channel.", "isIm"),
  boolField("isGroupDM", "Set true for messages in a group-DM channel.", "isMpim"),
  dateField("createdDate", "Message creation date (dd/mm/yy, IST).", tsField),
];

const fileLikeFields = (tsField: string, extra: FieldDef[] = []): FieldDef[] => [
  // channelId is imported from channelRef and set only when the file is tied to
  // a conversation/channel — may be empty for standalone files. (projectId is a
  // schema field but ingestion never populates it on file docs, so it's omitted.)
  strField("channelId", "Channel the file is associated with (may be unset).", ["contains"]),
  strField("ownerId", "Owner user id (creator/uploader).", ["contains"]),
  mineField("mine", "Set true to return only files you own (created).", "ownerId"),
  dateField("createdDate", "File creation date (dd/mm/yy, IST).", tsField),
  dateField("updatedDate", "File last-updated/edited date (dd/mm/yy, IST).", "updatedAt"),
  ...extra,
];

export const SEARCH_AREAS: Record<string, SearchArea> = {
  channel: {
    source: "chat_container",
    baseConditions: [],
    aclSchemaKey: "channel",
    timestampField: "createdAt",
    fields: [
      strField("channelId", "The channel's own id.", ["in"], "docId"),
      strField("scopeType", "Channel scope: DEFAULT (regular channel), DM, GROUP_DM, TICKET, DOCUMENT.", ["in", "nin"]),
      strField("visibility", "Channel visibility: PUBLIC or PRIVATE.", ["in"]),
      strField("projectId", "Project the channel belongs to.", ["in", "contains"]),
      mineField("mine", "Set true to return only channels you are a member of (excludes public channels you haven't joined).", "permissions"),
      dateField("createdDate", "Channel creation date (dd/mm/yy, IST).", "createdAt"),
      dateField("lastActiveDate", "Channel last-activity date (dd/mm/yy, IST).", "lastActivityAt"),
    ],
    allowedGroupByFields: ["scopeType", "visibility", "projectId"],
  },

  message: {
    source: "chat_message",
    baseConditions: ['docType contains "message"'],
    aclSchemaKey: "message",
    timestampField: "createdAtTimestamp",
    fields: chatFields("createdAtTimestamp"),
    allowedGroupByFields: ["channelId", "userId", "messageType"],
  },

  ticket: {
    source: "ticket",
    baseConditions: ['docType contains "ticket"'],
    aclSchemaKey: "ticket",
    timestampField: "createdAtTimestamp",
    fields: [
      strField("status", "Ticket status: TODO/STARTED/PAUSED/COMPLETED/CANCELLED.", ["in", "nin"]),
      strField("priority", "Ticket priority: HIGH/MEDIUM/LOW.", ["in", "nin"]),
      strField("stage", "Workflow stage — free-form label, e.g. 'PR Review', 'In Progress', 'QA'.", ["in", "nin"]),
      strField("assignedTo", "Assignee user id.", ["contains"]),
      strField("createdBy", "Creator user id (or email).", ["contains"]),
      strField("channelId", "Channel the ticket belongs to.", ["contains"]),
      strField("projectId", "Project the ticket belongs to.", ["contains", "in"]),
      strField("boardId", "Board id.", ["contains"]),
      strField("tags", "Ticket tags (BM25-tokenised).", ["containsAny"]),
      strField("xyneId", "Human ticket id, e.g. XYNE-13292 (what people cite).", ["in", "contains"]),
      strField("ticketId", "Internal ticket doc id — prefer xyneId for the human-facing id.", ["in"], "docId"),
      strField("conversationId", "Ticket conversation/thread id.", ["in"], "convId"),
      dateField("createdDate", "Ticket creation date (dd/mm/yy, IST).", "createdAtTimestamp"),
    ],
    allowedGroupByFields: ["status", "priority", "stage", "assignedTo", "projectId", "channelId", "boardId"],
  },

  // Chat attachments are ingested into the `file` schema with subApp
  // CHAT_ATTACHMENT (the standalone `chat_attachment` schema is legacy/unused),
  // so this area scopes `file` accordingly. For ticket attachments use the
  // `file` area with subApp=TICKET_ATTACHMENT.
  attachment: {
    source: "file",
    baseConditions: ['docType contains "file"', 'subApp contains "CHAT_ATTACHMENT"'],
    aclSchemaKey: "file",
    timestampField: "createdAt",
    fields: [
      strField("channelId", "Channel the attachment belongs to (may be unset).", ["contains"]),
      strField("uploaderId", "Uploader user id.", ["contains"], "ownerId"),
      mineField("mine", "Set true to return only attachments you uploaded.", "ownerId"),
      strField("messageId", "Parent message id.", ["in"]),
      strField("conversationId", "Conversation/thread the attachment belongs to.", ["in"], "conversationId"),
      dateField("createdDate", "Attachment creation date (dd/mm/yy, IST).", "createdAt"),
    ],
    allowedGroupByFields: ["channelId"],
  },

  canvas: {
    source: "file",
    baseConditions: ['docType contains "file"', 'subApp contains "CANVAS"'],
    aclSchemaKey: "file",
    timestampField: "createdAt",
    fields: fileLikeFields("createdAt"),
    allowedGroupByFields: ["channelId", "ownerId"],
  },

  transcript: {
    source: "file",
    baseConditions: ['docType contains "file"', 'subApp contains "TRANSCRIPT"'],
    aclSchemaKey: "file",
    timestampField: "createdAt",
    fields: fileLikeFields("createdAt", [
      strField("conversationId", "Conversation/call this transcript belongs to.", ["in"], "conversationId"),
      strField("callType", "Call type of the transcript.", ["in"], "callType"),
    ]),
    allowedGroupByFields: ["channelId", "ownerId", "callType"],
  },

  file: {
    source: "file",
    baseConditions: ['docType contains "file"'],
    aclSchemaKey: "file",
    timestampField: "createdAt",
    fields: fileLikeFields("createdAt", [
      strField("subApp", "File sub-type (exact case): CANVAS, CHAT_ATTACHMENT, TICKET_ATTACHMENT, TRANSCRIPT, RCA, or collections (KB files; lowercase).", ["in"]),
      strField("messageId", "Parent message id (chat attachments).", ["in"]),
      strField("ticketId", "Ticket id (ticket attachments).", ["in"]),
      strField("conversationId", "Conversation/thread the file belongs to.", ["in"]),
      strField("callType", "Call type (transcripts).", ["in"]),
      strField("collectionId", "Knowledge-base collection id (collections subApp).", ["in"], "clId"),
      strField("folderId", "Knowledge-base folder id (collections subApp).", ["in"], "clFd"),
    ]),
    allowedGroupByFields: ["channelId", "ownerId", "subApp"],
  },

  mail: {
    source: "mail",
    baseConditions: [],
    aclSchemaKey: "mail",
    timestampField: "timestamp",
    fields: [
      strField("channelId", "Support/desk channel the mail belongs to.", ["contains", "in"]),
      strField("from", "Sender email.", ["contains"]),
      strField("to", "Recipient email(s).", ["containsAny"]),
      strField("cc", "CC recipient email(s).", ["containsAny"]),
      strField("bcc", "BCC recipient email(s).", ["containsAny"]),
      strField("subject", "Email subject (token match).", ["contains"]),
      strField("attachmentName", "Attachment filename(s).", ["containsAny"], "attachmentFilenames"),
      strField("labels", "Gmail labels.", ["containsAny"]),
      strField("mailId", "Gmail message id (this single email).", ["in"]),
      strField("threadId", "Desk conversation id (the channel conversation this email belongs to).", ["in"]),
      strField("gmailThreadId", "Underlying Gmail thread id — groups the actual email thread (a mail + all its replies).", ["in"], "parentThreadId"),
      dateField("createdDate", "Mail date (dd/mm/yy, IST).", "timestamp"),
    ],
    allowedGroupByFields: ["from", "channelId"],
  },

  user: {
    source: "user",
    baseConditions: ['docType contains "user"'],
    aclSchemaKey: null,
    timestampField: "createdAt",
    fields: [
      strField("email", "User email.", ["contains"]),
      strField("status", "User status (e.g. ACTIVE).", ["in"]),
      dateField("createdDate", "User creation date (dd/mm/yy, IST).", "createdAt"),
    ],
    allowedGroupByFields: ["status"],
  },

  memory: {
    source: "memory",
    baseConditions: [],
    aclSchemaKey: "memory",
    timestampField: "createdAt",
    fields: [
      strField("reviewStatus", "Review status (pending/verified/rejected).", ["in"]),
      strField("agentUsed", "Agent that produced the memory.", ["contains"]),
      strField("tags", "Memory tags.", ["containsAny"]),
      dateField("createdDate", "Memory creation date (dd/mm/yy, IST).", "createdAt"),
    ],
    allowedGroupByFields: ["reviewStatus"],
    allowedDocTypes: ["FACT", "SOP"],
  },

  project: {
    source: "project",
    baseConditions: ['docType contains "project"'],
    aclSchemaKey: null,
    timestampField: "createdAt",
    fields: [
      strField("createdBy", "Creator user id.", ["contains"]),
      dateField("createdDate", "Project creation date (dd/mm/yy, IST).", "createdAt"),
    ],
    allowedGroupByFields: [],
  },
};

// Rank-profile allow-list. `unranked` is a Vespa built-in present on every
// schema; `default_native` exists on every queried source. Every area exposes
// only these two for now. (Some sources also define default_fuzzy / personalized
// / etc., but they are intentionally NOT exposed yet — set an area's
// allowedRankProfiles to opt one in later.)
export const BASE_RANK_PROFILES = ["default_native", "unranked"];

/** Rank profiles valid for an area (defaults to BASE when unset). */
export function rankProfilesForArea(area: SearchArea): string[] {
  return area.allowedRankProfiles ?? BASE_RANK_PROFILES;
}

// Vector-embedding tensor fields per area (verified against each schema's .sd
// HNSW/angular tensor fields) — used for hybrid retrieval on scored free-text
// queries. `user` and `project` have no embedding field → lexical only.
SEARCH_AREAS["message"]!.embeddingFields = ["text_embeddings"];
SEARCH_AREAS["channel"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["ticket"]!.embeddingFields = ["combined_embeddings"];
SEARCH_AREAS["attachment"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["canvas"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["transcript"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["file"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["mail"]!.embeddingFields = ["chunk_embeddings"];
SEARCH_AREAS["memory"]!.embeddingFields = ["summary_embeddings"];

// Fail fast at module load if a registry field declares an operator that is not
// legal for its (dataType, tier) — a copy/paste authoring guard. Mirrors the
// operator×dataType×tier matrix enforcement in searchFilterConfig.ts.
for (const [areaName, area] of Object.entries(SEARCH_AREAS)) {
  for (const f of area.fields) {
    const legal = ALLOWED_OPS[f.dataType][f.tier];
    for (const op of f.operators) {
      if (!legal.has(op)) {
        throw new Error(`vespa-search-areas: area "${areaName}" field "${f.name}" declares op "${op}" illegal for ${f.dataType}/${f.tier}.`);
      }
    }
  }
}

/** Aliases the agent may use → canonical area key. */
export const AREA_ALIASES: Record<string, string> = {
  chat: "message",
  // A "conversation" is a thread of chat_message docs — same source/ACL/fields as
  // `message` (scope to one thread via the `conversationId` filter → threadId).
  conversation: "message",
  people: "user",
  chat_attachment: "attachment",
};

export const AREA_NAMES: string[] = Object.keys(SEARCH_AREAS);

/** Resolve an area name (through aliases). Returns null when unknown. */
export function resolveArea(name: string): SearchArea | null {
  const key = (name ?? "").trim().toLowerCase();
  const canonical = AREA_ALIASES[key] ?? key;
  return SEARCH_AREAS[canonical] ?? null;
}

// ── Operator → YQL clause ──────────────────────────────────────────────────────

const vespaCol = (f: FieldDef): string => f.vespaField ?? f.name;

const quotedContains = (col: string, v: string): string => `${col} contains "${esc(v)}"`;

/** Coerce a raw value to a non-empty string list. */
const asStringList = (v: unknown): string[] => {
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(x => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "")).filter(s => s.length > 0);
};

/** Coerce a raw value to a finite-number list. */
const asNumberList = (v: unknown): number[] => {
  const arr = Array.isArray(v) ? v : [v];
  const out: number[] = [];
  for (const x of arr) {
    const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
};

/**
 * Build one AND-able YQL clause for a (field, op, value) triple, or null when
 * the value is missing / wrong-shaped (silently dropped, mirroring searchCore's
 * clauseForFieldOp). Throws only for a malformed DATE literal — dates are
 * shape-validated so a typo fails loudly instead of matching nothing.
 *
 * String equality is emitted as Vespa token `contains` (matching YqlBuilder's
 * `status contains "OPEN"` convention), NOT `field = "v"`.
 */
export function clauseForFieldOp(field: FieldDef, op: Operator, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const col = vespaCol(field);

  if (field.dataType === "string") {
    switch (op) {
      case "eq":
      case "contains": {
        const s = asStringList(value);
        return s.length ? quotedContains(col, s[0]!) : null;
      }
      case "in":
      case "containsAny": {
        const s = asStringList(value);
        if (!s.length) return null;
        return s.length === 1 ? quotedContains(col, s[0]!) : `(${s.map(v => quotedContains(col, v)).join(" or ")})`;
      }
      case "nin": {
        const s = asStringList(value);
        if (!s.length) return null;
        const inner = s.map(v => quotedContains(col, v)).join(" or ");
        return `!(${inner})`;
      }
      default:
        return null;
    }
  }

  if (field.dataType === "number") {
    switch (op) {
      case "eq": {
        const n = asNumberList(value);
        return n.length ? `${col} = ${n[0]}` : null;
      }
      case "in": {
        const n = asNumberList(value);
        return n.length ? `${col} in (${n.join(", ")})` : null;
      }
      case "nin": {
        const n = asNumberList(value);
        return n.length ? `!(${col} in (${n.join(", ")}))` : null;
      }
      case "gt": case "gte": case "lt": case "lte": {
        const n = asNumberList(value);
        return n.length ? `${col} ${COMPARISON_SYMBOL[op]} ${n[0]}` : null;
      }
      default:
        return null;
    }
  }

  if (field.dataType === "date") {
    // Emit the dd/mm/yy literal bare; convertDateLiteralsToMs() rewrites it to
    // epoch ms downstream (only after a comparison operator — hence date fields
    // are range-only).
    const raw = Array.isArray(value) ? value[0] : value;
    const lit = typeof raw === "string" ? raw.trim() : "";
    if (!DATE_LITERAL_RE.test(lit)) {
      throw new Error(`Filter "${field.name}.${op}" must be a date as dd/mm/yy (e.g. 01/06/26), got "${String(raw)}".`);
    }
    if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
      return `${col} ${COMPARISON_SYMBOL[op]} ${lit}`;
    }
    return null;
  }

  // boolean
  if (op === "eq") {
    const b = typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
    return `${col} contains "${b ? "true" : "false"}"`;
  }
  return null;
}

// ── Grouping ────────────────────────────────────────────────────────────────
// Mirrors YqlBuilder.buildGroupingClause but always emits count() so
// queryDirect's extractGroups() can surface accurate per-group counts.

// Grouping knobs — LLM-driven with defaults + hard caps. `hits` (document-hit
// count) is independent of these; a count-by-field query typically passes hits:0
// but still needs its groups.
// Kept small by default — each group materializes hitsPerGroup docs, so large
// values here bloat Vespa memory. The LLM can raise them when it genuinely needs
// more, up to the caps.
const DEFAULT_MAX_GROUPS = 20;     // groups returned when the caller doesn't specify
const MAX_GROUPS_CAP = 50;         // hard ceiling
const DEFAULT_HITS_PER_GROUP = 5;  // sample docs per group
const HITS_PER_GROUP_CAP = 5;      // hard ceiling

interface GroupOpts {
  order: "asc" | "desc";
  maxGroups: number;
  hitsPerGroup: number;
}

function buildGroupingClause(field: string, opts: GroupOpts): string {
  // order(-count()) = groups by count DESCENDING (largest first); order(count())
  // = ascending. Ordering runs BEFORE the max(N) cap, so the cap keeps the top-N
  // by count rather than an arbitrary N.
  const orderExpr = opts.order === "asc" ? "count()" : "-count()";
  return `all(group(${field}) order(${orderExpr}) max(${opts.maxGroups}) each(output(count()) max(${opts.hitsPerGroup}) each(output(summary()))))`;
}

// ── Public builder ──────────────────────────────────────────────────────────

export interface StructuredQueryParams {
  searchArea: string;
  docType?: string;
  filters?: Record<string, Record<string, unknown>>;
  query?: string;
  groupBy?: string;
  /** Order groups by count: "desc" (largest first, default) or "asc". */
  groupOrder?: "asc" | "desc";
  /** Max distinct groups to return (default 20, cap 50). */
  maxGroups?: number;
  /** Sample docs materialized per group (default 5, min 1, cap 5). */
  hitsPerGroup?: number;
  sort?: { by: string; dir?: "asc" | "desc" };
  hits?: number;
  rankProfile?: string;
}

/** Clamp n to [lo, hi]; fall back to `dflt` when n is not a finite number. */
function clampInt(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : dflt;
  return Math.min(Math.max(v, lo), hi);
}

/** Field NAMES sortable for an area — the date/number attributes (meaningful for
 *  order by, and Vespa requires attribute fields). Returns the user-facing
 *  names; resolve the Vespa column via the FieldDef's vespaField. */
export function sortableFieldsForArea(area: SearchArea): string[] {
  return area.fields.filter(f => f.dataType === "date" || f.dataType === "number").map(f => f.name);
}

export interface BuiltQuery {
  yql: string;
  query: string;
  /** Validated rank profile (undefined → let queryDirect auto-pick: default_native
   *  for free-text, unranked for filter-only/grouping). */
  rankProfile?: string;
}

/**
 * Assemble a Vespa YQL string from structured params. All field names and the
 * ACL clause come from the registry (never the model), so no field-name or
 * clause injection is possible; every value passes through esc().
 * Throws (caught by the tool handler → err(...)) on any validation failure.
 */
export function buildYqlFromParams(params: StructuredQueryParams, userId: string, workspaceId: string): BuiltQuery {
  const area = resolveArea(params.searchArea);
  if (!area) {
    throw new Error(`Unknown searchArea "${params.searchArea}". Valid areas: ${AREA_NAMES.join(", ")}.`);
  }

  const clauses: string[] = [];
  const query = (params.query ?? "").trim();

  // 1. Retrieval primitive — hybrid when the query will be SCORED: OR the
  // lexical userInput with a vector nearestNeighbor on the schema's embedding
  // field(s). queryDirect supplies input.query(e)=embed(@query) for scoring
  // profiles, so `e` is only available then — skip the NN when the query would
  // run unranked (grouping, or an explicit `unranked` profile) or when the
  // schema has no embedding field (user/project). Mirrors backend YqlBuilder.
  if (query) {
    const emb = area.embeddingFields ?? [];
    // Hybrid works with grouping too — buildYqlFromParams pins default_native
    // below whenever a query is present, so queryDirect sends input.query(e).
    // Only an explicit `unranked` (or a schema with no embedding) drops the NN.
    const scored = emb.length > 0 && params.rankProfile !== "unranked";
    if (scored) {
      const targetHits = Math.max(params.hits ?? 20, 100);
      const nn = emb.map(f => `({targetHits:${targetHits}} nearestNeighbor(${f}, e))`).join(" or ");
      clauses.push(`(userInput(@query) or ${nn})`);
    } else {
      clauses.push("userInput(@query)");
    }
  }

  // 2. Baseline area constraints.
  clauses.push(...area.baseConditions);

  // 2a. Workspace isolation — every schema carries workspaceId (top-level, or
  // imported from channelRef on chat_message/ticket). Always scope so a query
  // can never cross tenants, regardless of area or filters.
  if (workspaceId) clauses.push(`workspaceId contains "${esc(workspaceId)}"`);

  // 3. Optional docType narrowing.
  if (params.docType != null && params.docType !== "") {
    if (!area.allowedDocTypes) {
      throw new Error(`docType is not applicable for area "${params.searchArea}" (its docType is fixed).`);
    }
    if (!area.allowedDocTypes.includes(params.docType)) {
      throw new Error(`docType "${params.docType}" is not allowed for area "${params.searchArea}". Allowed: ${area.allowedDocTypes.join(", ")}.`);
    }
    clauses.push(`docType contains "${esc(params.docType)}"`);
  }

  // 4. Filters — strict: unknown field or unknown op errors.
  const fieldByName = new Map(area.fields.map(f => [f.name, f]));
  for (const [fieldName, bag] of Object.entries(params.filters ?? {})) {
    const field = fieldByName.get(fieldName);
    if (!field) {
      throw new Error(`"${fieldName}" is not a valid filter for area "${params.searchArea}". Allowed: ${area.fields.map(f => f.name).join(", ")}.`);
    }
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) {
      throw new Error(`Filter "${fieldName}" must be an operator object, e.g. { in: [...] } or { contains: "..." }.`);
    }
    // Reserved "mine"-style membership filter — emits `<field> contains "<userId>"`
    // (userId injected in code, never taken from the LLM).
    if (field.injectsUserIdInto) {
      for (const [op, val] of Object.entries(bag)) {
        if (op !== "eq") {
          throw new Error(`op "${op}" is not allowed for filter "${fieldName}". Allowed ops: eq.`);
        }
        const on = val === true || String(val).toLowerCase() === "true";
        if (on) {
          clauses.push(`${field.injectsUserIdInto} contains "${esc(userId)}"`);
        }
      }
      continue;
    }
    for (const [op, val] of Object.entries(bag)) {
      if (!field.operators.includes(op as Operator)) {
        throw new Error(`op "${op}" is not allowed for filter "${fieldName}". Allowed ops: ${field.operators.join("/")}.`);
      }
      const clause = clauseForFieldOp(field, op as Operator, val);
      if (clause) {
        clauses.push(clause);
      }
    }
  }

  // 5. ACL — code-controlled, always appended (never LLM-supplied).
  if (area.aclSchemaKey) {
    const acl = aclConditionForSchema(area.aclSchemaKey, userId, "");
    if (acl) clauses.push(acl);
  }

  // Guard only against a genuinely empty WHERE (Vespa rejects it). null-ACL
  // areas (project/user) still carry their docType base condition, so listing
  // them with no query/filter is allowed — they are workspace-isolated, not
  // per-user ACL'd.
  if (clauses.length === 0) clauses.push("true");

  const hasGroupBy = params.groupBy != null && params.groupBy !== "";
  const hasSort = params.sort != null && !!params.sort.by;
  // Vespa ignores `order by` under a grouping pipe — reject the combination
  // rather than silently drop the sort.
  if (hasGroupBy && hasSort) {
    throw new Error(`groupBy and sort cannot be combined — Vespa grouping ignores order by. Use one or the other.`);
  }

  let yql = `select * from sources ${area.source} where ${clauses.join(" and ")}`;

  // 7a. Sort — order by an allowed (date/number attribute) field, asc/desc.
  if (hasSort) {
    const sortable = sortableFieldsForArea(area);
    if (!sortable.includes(params.sort!.by)) {
      throw new Error(`sort field "${params.sort!.by}" is not sortable for area "${params.searchArea}". Sortable: ${sortable.join(", ") || "(none)"}.`);
    }
    const field = area.fields.find(f => f.name === params.sort!.by)!;
    const col = field.vespaField ?? field.name;
    const dir = params.sort!.dir === "asc" ? "asc" : "desc";
    yql += ` order by ${col} ${dir}`;
  }

  // 7b. Grouping (validated field).
  if (hasGroupBy) {
    if (!area.allowedGroupByFields.includes(params.groupBy!)) {
      throw new Error(`groupBy "${params.groupBy}" is not allowed for area "${params.searchArea}". Allowed: ${area.allowedGroupByFields.join(", ") || "(none)"}.`);
    }
    yql += ` | ${buildGroupingClause(params.groupBy!, {
      order: params.groupOrder === "asc" ? "asc" : "desc",
      maxGroups: clampInt(params.maxGroups, 1, MAX_GROUPS_CAP, DEFAULT_MAX_GROUPS),
      hitsPerGroup: clampInt(params.hitsPerGroup, 1, HITS_PER_GROUP_CAP, DEFAULT_HITS_PER_GROUP),
    })}`;
  }

  // 8. Validate an agent-supplied rank profile early, against the profiles that
  //    actually exist on this area's source — fail with the allowed list rather
  //    than let Vespa 400 or silently fall back.
  let rankProfile: string | undefined;
  if (params.rankProfile != null && params.rankProfile !== "") {
    const allowed = rankProfilesForArea(area);
    if (!allowed.includes(params.rankProfile)) {
      throw new Error(`rankProfile "${params.rankProfile}" is not available for area "${params.searchArea}". Allowed: ${allowed.join(", ")}.`);
    }
    rankProfile = params.rankProfile;
  } else if (query) {
    // A text query always scores (hybrid retrieval), EVEN when grouping — pin
    // default_native so queryDirect sends input.query(e)=embed(@query) that the
    // nearestNeighbor clause needs. (Its auto-pick would fall to `unranked` for
    // a grouping query and drop `e`, breaking the vector clause.)
    rankProfile = "default_native";
  }

  return { yql, query, ...(rankProfile ? { rankProfile } : {}) };
}

// ── Prompt / schema helpers for the tool layer ─────────────────────────────────

/** Human-readable per-area catalog for the tool description — one block per
 *  area listing each filter field with its ops AND its description (which
 *  carries the allowed enum values), so the LLM knows exactly what to pass. */
export function describeAreasForPrompt(): string {
  const aliasesByCanonical: Record<string, string[]> = {};
  for (const [alias, canon] of Object.entries(AREA_ALIASES)) {
    (aliasesByCanonical[canon] ??= []).push(alias);
  }
  const blocks: string[] = [];
  for (const [name, area] of Object.entries(SEARCH_AREAS)) {
    const alias = aliasesByCanonical[name] ? ` (aka ${aliasesByCanonical[name].join(", ")})` : "";
    const lines: string[] = [`### ${name}${alias}`];
    for (const f of area.fields) {
      // For a "mine"-style membership flag, show it as a boolean toggle.
      const ops = f.injectsUserIdInto ? "eq:true" : f.operators.join("/");
      lines.push(`    - ${f.name} [${f.dataType}; ${ops}] — ${f.description}`);
    }
    if (area.allowedDocTypes) lines.push(`    - docType (narrowing): ${area.allowedDocTypes.join(", ")}`);
    if (area.allowedGroupByFields.length) lines.push(`    groupBy: ${area.allowedGroupByFields.join(", ")}`);
    const sortable = sortableFieldsForArea(area);
    if (sortable.length) lines.push(`    sortBy: ${sortable.join(", ")} (asc|desc)`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n");
}
