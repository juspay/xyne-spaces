/**
 * Knowledge Base MCP tool DEFINITIONS for the claw agent runtime.
 *
 * These tools are advertised to the LLM under the `xyne-spaces` server when
 * the running agent has at least one AgentCollection grant. Handlers are NOT
 * defined here — they run inline in routes/mcp.ts's `/mcp/call` handler so
 * they have direct access to claw-auth's Prisma DB (to read the agent's KB
 * scope) and the calling user's spaces auth context (to re-verify access).
 *
 * Every KB tool is read-only. Write access (uploads, deletes, sharing) lives
 * exclusively in the spaces UI; the LLM is intentionally read-only against
 * the user's KB.
 */

import type { McpToolInfo } from "./types.js";

export const KB_TOOL_NAMES = [
  "kb-list-resources",
  "kb-search",
  "kb-list-files",
  "kb-read-file",
  "kb-get-chunks",
  "kb-search-within-doc",
] as const;

export type KbToolName = (typeof KB_TOOL_NAMES)[number];

export const KB_TOOLS: McpToolInfo[] = [
  {
    name: "kb-list-resources",
    description:
      "Discovery: list the Knowledge Base resources this agent can read. ALWAYS call this first when the " +
      "user asks anything about 'documents', 'files', 'the knowledge base', or refers to a specific " +
      "document by name. The agent runs in one of two scoping modes:\n" +
      "  • Allowlist mode — returns the explicit collections/files granted on this agent.\n" +
      "  • User-scoped mode — returns the calling user's root collections (with file counts). Drill into a " +
      "specific one via `kb-list-files`, or hunt by name via `kb-search`.\n" +
      "This tool lists TOP-LEVEL entries only — it never shows what is inside a collection. `file_count` is " +
      "recursive and `folder_count` counts immediate sub-folders; when either is non-zero, call `kb-list-files` " +
      "(with `depth`) to see the actual layout before concluding anything about what the KB contains.\n" +
      "Either way, the result is the authoritative list of what you can read — do NOT attempt kb-read-file " +
      "on anything not surfaced here (or via kb-list-files / kb-search); it will be rejected at the access layer.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "kb-search",
    description:
      "Vespa-powered full-text search across the agent's allowed Knowledge Base scope. Matches against file " +
      "names AND extracted file contents (chunks), ranked by relevance — so use it for topic/keyword/phrase " +
      "lookups (e.g. 'Q3 forecast assumptions', 'auth migration rollback plan'), not just to find a file " +
      "named exactly like the user said.\n\n" +
      "Scope is fixed:\n" +
      "  • Allowlist-mode agents — only the granted collections / files are searched. There is no way to widen.\n" +
      "  • User-scoped agents — searches every KB collection the calling user can read in spaces.\n" +
      "Pass `collectionId` to narrow to ONE allowed collection (must be in your scope); leave it off to span all.\n\n" +
      "## Filters (all optional, AND-combined with the query)\n" +
      "- `createdBy` — userId of the uploader (resolve names → ids via `spaces-users` first; not email).\n" +
      "- `range` — natural time window: today | yesterday | this week | last 7 days | last 30 days. Prefer over before/after for natural windows.\n" +
      "- `before` / `after` — ISO 8601 or 'DD Mmm YY' style date cutoff. Use only when you need a specific date.\n" +
      "- `on` — ISO date for a single-day window.\n" +
      "- `offset` — pagination cursor.\n\n" +
      "## IMPORTANT — hits are SHALLOW SNIPPETS, not the full document\n" +
      "Each hit returns the file id, file name, parent collection, and only the single most relevant matching SNIPPET " +
      "from the file's content (ranked by Vespa) — NOT the full file. A snippet tells you WHICH file is relevant, not the " +
      "whole answer. Do NOT answer from the snippet alone.\n" +
      "Correct pattern: kb-search broad → pick the 1–3 most relevant fileIds from the hits → call `kb-read-file` on each " +
      "to read the FULL extracted text → then synthesize and cite. Only skip kb-read-file when the snippet itself " +
      "completely and unambiguously answers the question.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text query — keywords or natural-language phrase. Ranked by Vespa over file names + extracted content chunks." },
        collectionId: { type: "string", description: "Optional. Restrict to one allowed collection's id." },
        createdBy: { type: "string", description: "Optional. Filter to files uploaded by this userId. Must be a userId (cm…) — resolve names/emails first via spaces-users." },
        range: { type: "string", description: "Optional. Natural time window: today | yesterday | this week | last 7 days | last 30 days. Prefer over before/after for natural windows." },
        before: { type: "string", description: "Optional. Files created before this date — ISO 8601 or 'DD Mmm YY'." },
        after: { type: "string", description: "Optional. Files created after this date — ISO 8601 or 'DD Mmm YY'." },
        on: { type: "string", description: "Optional. Files created on this specific date — ISO 8601 or 'DD Mmm YY'." },
        limit: { type: "number", minimum: 1, maximum: 50, default: 10, description: "Max files to return (default 10, max 50)." },
        offset: { type: "number", minimum: 0, default: 0, description: "Pagination offset (default 0)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "kb-list-files",
    description:
      "Directory listing for an allowed collection — the `ls` of the Knowledge Base. Use when you want an " +
      "inventory of what exists rather than a relevance search. `collectionId` MUST be one that appears in " +
      "kb-list-resources (or a folder id returned by an earlier kb-list-files) — otherwise the call is rejected.\n\n" +
      "Returns BOTH:\n" +
      "  • `<file>` rows — with `id` (pass to kb-read-file / kb-search-within-doc) and `path` (the full path " +
      "from the root collection, e.g. `services/release-deploy/service.md`).\n" +
      "  • `<folder>` rows — sub-folders, with their `id`, a recursive `file_count`, and `folder_count`. " +
      "Collapsed folders are rendered self-closing; re-call with that folder's `id` to open it.\n\n" +
      "## Depth\n" +
      "`depth` defaults to 1: the collection's own files plus its immediate sub-folders, collapsed. Pass a " +
      "larger number to expand that many levels, or `-1` for the entire subtree. **If a collection looks " +
      "empty of files but reports folders, you have not seen its contents yet — expand them.** Many KBs keep " +
      "everything in sub-folders (`services/<area>/service.md`), so a depth-1 listing of the root is only the " +
      "skeleton. Prefer `depth: -1` on a small collection (a few hundred files) to get the whole map in one call; " +
      "output is capped at 400 rows and says so explicitly when it truncates.",
    inputSchema: {
      type: "object",
      properties: {
        collectionId: { type: "string", description: "Required. The collection or folder id to enumerate." },
        depth: {
          type: "number",
          minimum: -1,
          maximum: 10,
          default: 1,
          description:
            "How many levels to expand. 1 (default) = this collection's files + collapsed sub-folder rows. " +
            "N = expand N levels. -1 = the whole subtree. Use -1 or a high value when you need the full layout.",
        },
      },
      required: ["collectionId"],
      additionalProperties: false,
    },
  },
  {
    name: "kb-read-file",
    description:
      "Read the content of a file from the agent's allowed KB scope. Returns the file's extracted text " +
      "(when available) plus a citation back to the source. The `fileId` MUST be either (a) returned by " +
      "kb-list-resources / kb-search / kb-list-files, or (b) explicitly granted on this agent. Any other " +
      "id is rejected.\n\n" +
      "Large binary files (PDF / DOCX / images) are returned with whatever text the spaces ingestion " +
      "pipeline extracted; if nothing is extracted yet, the response says so.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Required. The collection_item id of the file to read." },
      },
      required: ["fileId"],
      additionalProperties: false,
    },
  },
  {
    name: "kb-get-chunks",
    description:
      "Read a contiguous range of chunks from a Knowledge Base document, given its `fileId` (from " +
      "`kb-search` / `kb-search-within-doc` / `kb-list-files`) and a 0-based `startChunkIndex`. Returns " +
      "up to 30 chunks starting at that index. Use this AFTER `kb-search` / `kb-search-within-doc` to " +
      "read the full surrounding context — semantic search only returns the best-matching snippet, but " +
      "complete answers usually need surrounding definitions, exceptions, and cross-references. Call " +
      "repeatedly with bumped `startChunkIndex` to walk through long documents in pages.\n\n" +
      "Access is gated by the agent's KB scope (same rule as `kb-read-file`): the `fileId` MUST be one " +
      "the agent is allowed to read.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description:
            "Required. The collection_item id of the file to read chunks from (from `kb-search` / `kb-search-within-doc` / `kb-list-files`).",
        },
        startChunkIndex: {
          type: "number",
          minimum: 0,
          description:
            "Required. 0-based chunk index to start at. Use the `chunk_index` from a `kb-search-within-doc` hit, then back up by 1–2 for surrounding context.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 30,
          default: 15,
          description: "Number of chunks to return (1–30). Default 15.",
        },
      },
      required: ["fileId", "startChunkIndex"],
      additionalProperties: false,
    },
  },
  {
    name: "kb-search-within-doc",
    description:
      "Semantic search within a single Knowledge Base document. Given a `fileId` (from `kb-search` " +
      "or `kb-list-files`) and a focused `query`, returns the most relevant chunks from that document " +
      "only — with each hit's `chunk_index` so you can follow up with `kb-get-chunks` to read full " +
      "context. Use this when you need to find related passages, definitions, exceptions, or cross-" +
      "references inside the same document without re-searching the whole knowledge base.\n\n" +
      "Access is gated by the agent's KB scope (same rule as `kb-read-file`).",
    inputSchema: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description:
            "Required. The collection_item id of the file to search within (from `kb-search` / `kb-list-files`).",
        },
        query: {
          type: "string",
          minLength: 2,
          maxLength: 200,
          description:
            "Required. Short keyword-style search phrase (e.g. 'definition of qualified institutional buyer').",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 30,
          default: 15,
          description: "Max matching chunks to return (1–30). Default 15.",
        },
      },
      required: ["fileId", "query"],
      additionalProperties: false,
    },
  },
];