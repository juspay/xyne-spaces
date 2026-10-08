/**
 * Structured "search area" → YQL builder for the `spaces-vespa-search` MCP tool.
 *
 * The agent never writes YQL: it declares WHAT it wants (a search area + a
 * typed operator-bag filter set) and CODE — never the LLM — assembles the YQL
 * string.
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

import { esc, aclConditionForSchema, publicOnlyConditionForSchema } from "./vespa-direct.js";

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
  /** Fields the agent may pass to `groupBy`. Usually filter-field names, but may
   *  also be a curated raw attribute column that isn't a filter (e.g. the
   *  day-granular STRING `createdAt` = "12/05/2026" on ticket/message, grouped for
   *  per-day counts — distinct from the ms `createdAtTimestamp` used by date
   *  range FILTERS). Only list attribute columns; grouping needs an attribute. */
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

/**
 * Entities resolved by the nightly entity-extraction worker (xyne-spaces
 * backend: writeEntitiesToVespa in services/entityExtraction/channelSource.ts).
 * It writes the SAME three columns onto both `ticket` and `chat_message` docs,
 * so both areas share these defs.
 *
 * Only ONE of the three columns is exposed — `entityNames` (index + attribute +
 * bm25, token match on the canonical registry name). The other two are withheld
 * on purpose:
 *   - `entityIds` IS matchable (attribute, fast-search) but there is no way for
 *     the agent to learn an entity id: the registry lives in the xyne-spaces
 *     Postgres and claw has no tool that returns ids, so an id filter could only
 *     ever be hallucinated. Expose it once something hands the agent real ids.
 *   - `entitySurfaceForms` is `indexing: summary` ONLY in both .sd files — not
 *     matchable at all, so filtering on it would silently match nothing.
 *
 * entityNames is array<string> → containsAny (matches if ANY element hits).
 * containsAny is the ONLY operator exposed. `nin` is deliberately withheld until
 * the entity backfill lands: extraction only ever ran forward from its rollout,
 * so most docs have EMPTY entity arrays, and `!(entityNames contains "X")` would
 * match every un-extracted doc — presenting "not yet processed" as "does not
 * mention X". That reads as a confident negative and is wrong at scale. Add nin
 * back once the backfill is complete.
 *
 * It is multi-valued, so it must NOT be added to allowedGroupByFields (the
 * module-load guard below rejects grouping an array — one doc lands in one group
 * per element).
 */
const entityFields = (subject: string): FieldDef[] => [
  strField(
    "entityName",
    `Canonical name of an entity mentioned in the ${subject} (e.g. a product, customer or service), token-matched. Positive match only: a doc without this entity may simply not have been through extraction yet, so absence is NOT evidence the ${subject} is unrelated.`,
    ["containsAny"],
    "entityNames",
  ),
];

const chatFields = (tsField: string): FieldDef[] => [
  strField("conversationId", "Conversation/thread id.", ["in"], "threadId"),
  strField("channelId", "Channel the message belongs to.", ["contains", "in"]),
  strField("senderId", "User id of the message sender.", ["contains"], "userId"),
  strField("senderEmail", "Email of the message sender.", ["contains"], "userEmail"),
  strField("messageType", "Message type (USER/BOT/SYSTEM/FORWARDED).", ["in", "nin"]),
  boolField("isDM", "Set true for messages in a direct-message (1:1) channel.", "isIm"),
  boolField("isGroupDM", "Set true for messages in a group-DM channel.", "isMpim"),
  ...entityFields("message's thread"),
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

// Real rank-profile names per schema, read directly off the source .sd files in
// the sibling vespa-core repo (/Users/priyanshu.c/Desktop/codeeee/vespa-core/
// vespa/common/schemas/<schema>.sd — cross-checked against what's actually
// deployed too, byte-identical apart from a DIMS→384 template substitution).
// Each schema's `tunable` profile (message/ticket/file/mail — chat_container has
// none) declares its OWN distinct `inputs {}` block with different names/
// defaults; see TUNABLE_INPUTS_BY_AREA in the frontend (SearchEvalsPageV3.tsx)
// for the mirrored values driving the "Tunable" UI. `default_native` and
// `unranked` are always valid (BASE_RANK_PROFILES) — listed explicitly here too
// since setting allowedRankProfiles replaces the base list, not extends it.
const MESSAGE_RANK_PROFILES = [
  "default_native", "unranked", "tunable", "personalized", "default_random", "default_fuzzy",
  "default_native_tb", "default_native_tb2",
  ...Array.from({ length: 23 }, (_, i) => `default_native_${i}`),
];
const TICKET_RANK_PROFILES = ["default_native", "unranked", "tunable", "semantic_ranking", "default_fuzzy"];
const FILE_RANK_PROFILES = ["default_native", "unranked", "tunable", "default_fuzzy"];
const CHANNEL_RANK_PROFILES = ["default_native", "unranked", "default_fuzzy", "autocomplete"];
const MAIL_RANK_PROFILES = [
  "default_native", "unranked", "tunable", "global_sorted", "default_bm25", "default_ai", "default_fuzzy",
  "default_native_best_chunk_025", "default_native_top_chunk_lexical_025",
];

export const SEARCH_AREAS: Record<string, SearchArea> = {
  channel: {
    source: "chat_container",
    baseConditions: [],
    aclSchemaKey: "channel",
    timestampField: "createdAt",
    fields: [
      strField("channelId", "The channel's own id.", ["in"], "docId"),
      // Name → id resolution. Mapped to `channelName_fuzzy`, NOT the bare
      // `channelName`: the latter is `attribute | summary` with no index, so a
      // `contains` on it is a whole-value exact match and "#xyne-spaces" would
      // only ever match a channel called exactly that. `channelName_fuzzy` is
      // `input channelName | index` with 3-gram matching + bm25 — built for
      // exactly this lookup, and it survives partial names and typos.
      strField("channelName", "Channel name — partial, case-insensitive (3-gram fuzzy index).", ["contains", "in"], "channelName_fuzzy"),
      strField("scopeType", "Channel scope: DEFAULT (regular channel), DM, GROUP_DM, TICKET, DOCUMENT.", ["in", "nin"]),
      strField("visibility", "Channel visibility: PUBLIC or PRIVATE.", ["in"]),
      strField("projectId", "Project the channel belongs to.", ["in", "contains"]),
      mineField("mine", "Set true to return only channels you are a member of (excludes public channels you haven't joined).", "permissions"),
      dateField("createdDate", "Channel creation date (dd/mm/yy, IST).", "createdAt"),
      dateField("lastActiveDate", "Channel last-activity date (dd/mm/yy, IST).", "lastActivityAt"),
    ],
    allowedGroupByFields: ["scopeType", "visibility", "projectId"],
    allowedRankProfiles: CHANNEL_RANK_PROFILES,
  },

  message: {
    source: "chat_message",
    baseConditions: ['docType contains "message"'],
    aclSchemaKey: "message",
    timestampField: "createdAtTimestamp",
    fields: chatFields("createdAtTimestamp"),
    // createdAt = day-string ("12/05/2026") → per-day grouping (not the ms timestamp).
    allowedGroupByFields: ["channelId", "senderId", "senderEmail", "messageType", "conversationId", "createdAt"],
    allowedRankProfiles: MESSAGE_RANK_PROFILES,
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
      ...entityFields("ticket"),
      dateField("createdDate", "Ticket creation date (dd/mm/yy, IST).", "createdAtTimestamp"),
    ],
    // createdAt = day-string ("12/05/2026") → per-day grouping (not the ms timestamp).
    allowedGroupByFields: ["status", "priority", "stage", "assignedTo", "createdBy", "projectId", "channelId", "boardId", "createdAt"],
    allowedRankProfiles: TICKET_RANK_PROFILES,
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
    allowedGroupByFields: ["channelId", "uploaderId", "conversationId"],
    allowedRankProfiles: FILE_RANK_PROFILES,
  },

  canvas: {
    source: "file",
    baseConditions: ['docType contains "file"', 'subApp contains "CANVAS"'],
    aclSchemaKey: "file",
    timestampField: "createdAt",
    fields: fileLikeFields("createdAt"),
    allowedGroupByFields: ["channelId", "ownerId"],
    allowedRankProfiles: FILE_RANK_PROFILES,
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
    allowedGroupByFields: ["channelId", "ownerId", "callType", "conversationId"],
    allowedRankProfiles: FILE_RANK_PROFILES,
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
    allowedGroupByFields: ["channelId", "ownerId", "subApp", "callType", "conversationId", "collectionId", "folderId"],
    allowedRankProfiles: FILE_RANK_PROFILES,
  },

  mail: {
    source: "mail",
    baseConditions: [],
    aclSchemaKey: "mail",
    timestampField: "timestamp",
    allowedRankProfiles: MAIL_RANK_PROFILES,
    fields: [
      strField("channelId", "Support/desk channel the mail belongs to.", ["contains", "in"]),
      strField("from", "Sender email.", ["contains"]),
      strField("to", "Recipient email(s).", ["containsAny"]),
      strField("cc", "CC recipient email(s).", ["containsAny"]),
      strField("bcc", "BCC recipient email(s).", ["containsAny"]),
      strField("subject", "Email subject (token match).", ["contains"]),
      strField("attachmentName", "Attachment filename(s).", ["containsAny"], "attachmentFilenames"),
      strField("mailId", "Gmail message id (this single email).", ["in"]),
      strField("threadId", "Desk conversation id (the channel conversation this email belongs to).", ["in"]),
      strField("gmailThreadId", "Underlying Gmail thread id — groups the actual email thread (a mail + all its replies).", ["in"], "parentThreadId"),
      dateField("createdDate", "Mail date (dd/mm/yy, IST).", "timestamp"),
    ],
    allowedGroupByFields: ["from", "threadId", "channelId"],
  },

  user: {
    source: "user",
    baseConditions: ['docType contains "user"'],
    aclSchemaKey: null,
    timestampField: "createdAt",
    fields: [
      strField("email", "User email.", ["contains"]),
      // `name_fuzzy` is `input name | index | attribute` with 3-gram + bm25 —
      // partial names and misspellings resolve, which a plain attribute match
      // would not.
      strField("name", "User name — partial (3-gram fuzzy index).", ["contains", "in"], "name_fuzzy"),
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
    allowedGroupByFields: ["reviewStatus", "agentUsed"],
    allowedDocTypes: ["FACT", "SOP"],
  },

  project: {
    source: "project",
    baseConditions: ['docType contains "project"'],
    aclSchemaKey: null,
    timestampField: "createdAt",
    fields: [
      // `project.name` is `index | attribute | summary` with bm25, so `contains`
      // is a real tokenised match. `projectId` mirrors the channel area's
      // docId mapping so a project resolved by name can be re-queried by id
      // (and a channel row's `projectId` can be followed back to its project).
      strField("projectId", "The project's own id.", ["in"], "docId"),
      strField("name", "Project name.", ["contains", "in"]),
      strField("createdBy", "Creator user id.", ["contains"]),
      dateField("createdDate", "Project creation date (dd/mm/yy, IST).", "createdAt"),
    ],
    allowedGroupByFields: ["createdBy"],
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
  // Every groupBy entry must be a real filter field of the area (grouping resolves
  // name → FieldDef.vespaField). Also guards against grouping a non-attribute:
  // date fields aren't attributes-you'd-group and shouldn't be listed.
  for (const g of area.allowedGroupByFields) {
    const gf = area.fields.find(f => f.name === g);
    // A groupBy entry that isn't a filter field is a curated raw attribute column
    // (e.g. the day-string `createdAt` for per-day grouping) — trusted as-is.
    if (!gf) continue;
    if (gf.dataType === "boolean") {
      throw new Error(`vespa-search-areas: area "${areaName}" groupBy "${g}" is a boolean field — a trivial 2-way split; use a filter instead.`);
    }
    // A date FILTER field maps to the ms timestamp (unique per doc → one singleton
    // group each). To group by day, list the day-string column (e.g. createdAt).
    if (gf.dataType === "date") {
      throw new Error(`vespa-search-areas: area "${areaName}" groupBy "${g}" is a date filter field (ms timestamp). Group by the day-string column instead.`);
    }
    // Multi-valued (array<string>) fields — flagged by a containsAny operator —
    // must not be grouped: Vespa puts one doc into a group PER element, so counts
    // overlap and no longer partition the docs (e.g. a mail with 5 `to`s → 5 groups).
    if (gf.operators.includes("containsAny")) {
      throw new Error(`vespa-search-areas: area "${areaName}" groupBy "${g}" is multi-valued — grouping an array double-counts docs. Group by a single-valued field.`);
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
  /**
   * Optional projection. Replaces `select *` with just these columns, so the
   * summary fetch skips message bodies entirely. Measured on chat_message:
   * 60 hits went 461 KB -> 19.9 KB (23x) with no change in which rows match.
   *
   * For CALLERS THAT ONLY NEED IDS (prefetch's channel probe). Never a way to
   * reach a column the area does not already expose: every entry is validated
   * against the area's own field list plus the render-critical columns below,
   * so nothing user-supplied is interpolated into the YQL.
   */
  fields?: string[];
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
 * Builds the AND-able clause list for ONE area (retrieval primitive, base
 * conditions, workspace isolation, docType narrowing, filters, ACL) — the
 * shared core both buildYqlFromParams (single `from sources <one schema>`,
 * used by the spaces-vespa-search MCP tool) and buildFederatedYqlFromParams
 * (one `from sources <n schemas>` with each area's clause-group OR'd
 * together, used by search-eval-vespa.ts's "All types") build on. Does NOT
 * handle sort/groupBy/rankProfile — those are single-area-only concerns
 * (federating across schemas with different field names/rank-profile inputs
 * makes "sort by X" or "groupBy X" ambiguous, so federated callers don't get
 * them) and stay in buildYqlFromParams.
 */
function buildAreaClauses(
  area: SearchArea,
  areaName: string,
  params: StructuredQueryParams,
  userId: string,
  workspaceId: string,
  opts?: { publicOnly?: boolean },
): { source: string; clauses: string[]; query: string } {
  const clauses: string[] = [];
  const query = (params.query ?? "").trim();

  // 1. Retrieval primitive — hybrid when the query will be SCORED: OR the
  // lexical userInput with a vector nearestNeighbor on the schema's embedding
  // field(s). queryDirect supplies input.query(e)=embed(hf-embedder, @query) for scoring
  // profiles, so `e` is only available then — skip the NN when the query would
  // run unranked (grouping, or an explicit `unranked` profile) or when the
  // schema has no embedding field (user/project). Mirrors backend YqlBuilder.
  if (query) {
    const emb = area.embeddingFields ?? [];
    // Hybrid works with grouping too — buildYqlFromParams pins default_native
    // below whenever a query is present, so queryDirect sends input.query(e).
    // An explicit `unranked`, a schema with no embedding, or a SORT drops the
    // NN: sorted queries run unranked (`order by` replaces ranking, and file's
    // default_native has a global-phase rerank Vespa refuses to sort under),
    // so `e` is never supplied and the vector clause would break.
    const scored = emb.length > 0 && params.rankProfile !== "unranked" && !params.sort?.by;
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
      throw new Error(`docType is not applicable for area "${areaName}" (its docType is fixed).`);
    }
    if (!area.allowedDocTypes.includes(params.docType)) {
      throw new Error(`docType "${params.docType}" is not allowed for area "${areaName}". Allowed: ${area.allowedDocTypes.join(", ")}.`);
    }
    clauses.push(`docType contains "${esc(params.docType)}"`);
  }

  // 4. Filters — strict: unknown field or unknown op errors.
  const fieldByName = new Map(area.fields.map(f => [f.name, f]));
  for (const [fieldName, bag] of Object.entries(params.filters ?? {})) {
    const field = fieldByName.get(fieldName);
    if (!field) {
      throw new Error(`"${fieldName}" is not a valid filter for area "${areaName}". Allowed: ${area.fields.map(f => f.name).join(", ")}.`);
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

  // 5. ACL — code-controlled, always appended (never LLM-supplied). opts.publicOnly
  // substitutes the real per-user guard for a public-only condition (see the doc
  // comment above) — visibility is always restricted one way or the other, never skipped.
  if (area.aclSchemaKey) {
    if (opts?.publicOnly) {
      clauses.push(publicOnlyConditionForSchema(area.aclSchemaKey));
    } else {
      const acl = aclConditionForSchema(area.aclSchemaKey, userId, "");
      if (acl) clauses.push(acl);
    }
  }

  // Guard only against a genuinely empty WHERE (Vespa rejects it). null-ACL
  // areas (project/user) still carry their docType base condition, so listing
  // them with no query/filter is allowed — they are workspace-isolated, not
  // per-user ACL'd.
  if (clauses.length === 0) clauses.push("true");

  return { source: area.source, clauses, query };
}

/**
 * Assemble a Vespa YQL string from structured params. All field names and the
 * ACL clause come from the registry (never the model), so no field-name or
 * clause injection is possible; every value passes through esc().
 * Throws (caught by the tool handler → err(...)) on any validation failure.
 *
 * `opts.publicOnly` is code-only (never LLM/agent-reachable) — the MCP tool call
 * sites never pass it. It exists solely for search-eval-vespa.ts's
 * "without permission" mode: instead of the real per-user ACL guard, it
 * substitutes a public-only visibility condition (see
 * publicOnlyConditionForSchema() in ./vespa-direct.ts) — never a true
 * unrestricted bypass.
 */
export function buildYqlFromParams(
  params: StructuredQueryParams,
  userId: string,
  workspaceId: string,
  opts?: { publicOnly?: boolean },
): BuiltQuery {
  const area = resolveArea(params.searchArea);
  if (!area) {
    throw new Error(`Unknown searchArea "${params.searchArea}". Valid areas: ${AREA_NAMES.join(", ")}.`);
  }

  const { source, clauses, query } = buildAreaClauses(area, params.searchArea, params, userId, workspaceId, opts);

  const hasGroupBy = params.groupBy != null && params.groupBy !== "";
  const hasSort = params.sort != null && !!params.sort.by;
  // Vespa ignores `order by` under a grouping pipe — reject the combination
  // rather than silently drop the sort.
  if (hasGroupBy && hasSort) {
    throw new Error(`groupBy and sort cannot be combined — Vespa grouping ignores order by. Use one or the other.`);
  }

  // Projection (optional). `transformHit` classifies rows off docType/sddocname
  // and titles a message from messageChannelName/channelName + username — drop
  // those and every row renders as an untyped, nameless blob, so they are always
  // allowed through even when the caller does not ask for them.
  const RENDER_CRITICAL = ["docType", "sddocname", "channelId", "channelName", "messageChannelName", "username", "userId"];
  let projection = "*";
  if (params.fields && params.fields.length > 0) {
    const allowed = new Set<string>([
      ...RENDER_CRITICAL,
      ...area.fields.map(f => f.vespaField ?? f.name),
      ...area.fields.map(f => f.name),
    ]);
    const picked: string[] = [];
    for (const f of params.fields) {
      const name = String(f).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error(`fields entry "${name}" is not a valid column name.`);
      }
      if (!allowed.has(name)) {
        throw new Error(`fields entry "${name}" is not a column of area "${params.searchArea}". Allowed: ${[...allowed].sort().join(", ")}.`);
      }
      if (!picked.includes(name)) picked.push(name);
    }
    for (const rc of RENDER_CRITICAL) if (!picked.includes(rc)) picked.push(rc);
    projection = picked.join(", ");
  }
  let yql = `select ${projection} from sources ${source} where ${clauses.join(" and ")}`;

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

  // 7b. Grouping (validated field). groupBy takes a FILTER field name (what the
  // LLM already knows); resolve it to the underlying Vespa column so grouping and
  // filtering share one vocabulary (e.g. senderId → group(userId)).
  if (hasGroupBy) {
    if (!area.allowedGroupByFields.includes(params.groupBy!)) {
      throw new Error(`groupBy "${params.groupBy}" is not allowed for area "${params.searchArea}". Allowed: ${area.allowedGroupByFields.join(", ") || "(none)"}.`);
    }
    // Filter field → its Vespa column (senderId → userId); a curated raw column
    // (e.g. createdAt) → as-is.
    const gf = area.fields.find(f => f.name === params.groupBy);
    const groupCol = gf?.vespaField ?? params.groupBy!;
    yql += ` | ${buildGroupingClause(groupCol, {
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
    // default_native so queryDirect sends input.query(e)=embed(hf-embedder, @query) that the
    // nearestNeighbor clause needs. (Its auto-pick would fall to `unranked` for
    // a grouping query and drop `e`, breaking the vector clause.)
    // EXCEPT under sort: `order by` replaces ranking entirely, and schemas
    // whose default_native carries a global-phase rerank (file) 400 with
    // "Sorting is not supported with global phase" — so sorted queries run
    // unranked (buildAreaClauses drops their NN clause for the same reason).
    rankProfile = hasSort ? "unranked" : "default_native";
  }

  return { yql, query, ...(rankProfile ? { rankProfile } : {}) };
}

export interface FederatedBuiltQuery {
  yql: string;
  query: string;
  /** Same rules as BuiltQuery.rankProfile — undefined lets queryDirect auto-pick. */
  rankProfile?: string;
  /** The distinct Vespa schema names in the `from sources` clause, in order. */
  sources: string[];
}

/**
 * One federated Vespa query across MULTIPLE search areas — `select * from
 * sources <schema1>, <schema2>, ... where (<area1's clauses>) or (<area2's
 * clauses>) or ...` — each area's own clause-group (retrieval/base/workspace/
 * docType/filters/ACL, via buildAreaClauses) stays self-contained inside its
 * own parens, so a doc matches if it satisfies ANY one area's full condition.
 * Mirrors how the main backend's YqlBuilder federates multiple schemas into
 * one query (guardedParts joined with " or "), rather than issuing N separate
 * single-schema queries and merging results client-side.
 *
 * Vespa applies exactly ONE ranking.profile to the whole query, so it must be
 * a profile that exists on every involved source — only "default_native"
 * (present on message/file/ticket/channel/mail) and "unranked" qualify;
 * anything else throws. No sort/groupBy here — federating differing schemas'
 * field vocabularies under one sort/group key isn't well-defined, and no
 * caller currently needs it (search-eval-vespa.ts's only use is a plain
 * "All types" query+date-filter, never sort/groupBy).
 */
export function buildFederatedYqlFromParams(
  areaNames: string[],
  params: Omit<StructuredQueryParams, "searchArea">,
  userId: string,
  workspaceId: string,
  opts?: { publicOnly?: boolean },
): FederatedBuiltQuery {
  if (areaNames.length === 0) {
    throw new Error("buildFederatedYqlFromParams: at least one area is required.");
  }

  const query = (params.query ?? "").trim();
  const sources: string[] = [];
  const groups: string[] = [];
  for (const areaName of areaNames) {
    const area = resolveArea(areaName);
    if (!area) {
      throw new Error(`Unknown searchArea "${areaName}". Valid areas: ${AREA_NAMES.join(", ")}.`);
    }
    const { source, clauses } = buildAreaClauses(area, areaName, { ...params, searchArea: areaName }, userId, workspaceId, opts);
    sources.push(source);
    groups.push(clauses.join(" and "));
  }

  const yql = `select * from sources ${sources.join(", ")} where ${groups.map(g => `(${g})`).join(" or ")}`;

  let rankProfile: string | undefined;
  if (params.rankProfile != null && params.rankProfile !== "") {
    if (!BASE_RANK_PROFILES.includes(params.rankProfile)) {
      throw new Error(`rankProfile "${params.rankProfile}" is not valid for a federated ("All types") query — it must exist on every involved source. Allowed: ${BASE_RANK_PROFILES.join(", ")}.`);
    }
    rankProfile = params.rankProfile;
  } else if (query) {
    rankProfile = "default_native";
  }

  return { yql, query, ...(rankProfile ? { rankProfile } : {}), sources };
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
