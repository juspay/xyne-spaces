/**
 * KB filesystem tools — the coding-agent file tools, backed by a Spaces KB
 * collection instead of disk.
 *
 * Returned as a MAP keyed by pi's built-in tool names (read/ls/grep/write/edit),
 * so they take the place of the built-ins under the same names. The model is a
 * coding agent and already knows these tools; it simply finds markdown pages
 * where it expected files. Same substitution `scoped-tools.ts` performs for the
 * sandbox filesystem.
 *
 * Scope is closed over at construction — collection and user are arguments to
 * `createKbToolMap`, never tool parameters — so the model cannot widen its own
 * reach. That mirrors `createWriteTool(root)` being confined to the working
 * directory, and here it is the SOLE enforcement.
 *
 * There is deliberately no delete tool: itemIds are embedded in saved KB links,
 * so an obsolete page is rewritten as a redirect stub rather than removed.
 *
 * Everything runs over HTTP through claw-auth, which holds the Spaces session,
 * so a KB agent needs no working directory and no sandbox.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("kb-tools");

/** Cap so one oversized page cannot swamp the model's context. */
const MAX_READ_CHARS = 60_000;

/** A broad grep can match hundreds of lines; the head is the useful part. */
const MAX_GREP_MATCHES = 100;

/**
 * Which KB these tools act on. Named KbTarget, not KbTarget, because claw-auth
 * already uses `kbScope` for something different — the "COLLECTIONS" | "USER"
 * mode on an agent row.
 */
export interface KbTarget {
  collectionId: string;
  userId: string;
  scopeType?: string;
  scopeId?: string;
}

// ---------------------------------------------------------------------------
// Calling claw-auth
// ---------------------------------------------------------------------------

function s2sHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey, "x-user-id": userId } : {}),
  };
}

function kbUrl(endpoint: string): string {
  return `${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/kb/${endpoint}`;
}

/** Scope travels on every call. The model never supplies it. */
function scopeFields(scope: KbTarget): Record<string, string> {
  return {
    userId: scope.userId,
    collectionId: scope.collectionId,
    ...(scope.scopeType ? { scopeType: scope.scopeType } : {}),
    ...(scope.scopeId ? { scopeId: scope.scopeId } : {}),
  };
}

/**
 * Every KB route answers `{ success, data }` or `{ success: false, error }`.
 * Failures throw so each tool can catch once and hand the message to the model.
 */
async function readEnvelope<T>(response: Response, endpoint: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!response.ok || !body.success) {
    throw new Error(body.error ?? `kb ${endpoint} failed (${response.status})`);
  }
  return body.data as T;
}

async function kbGet<T>(
  endpoint: string,
  scope: KbTarget,
  params: Record<string, string>,
): Promise<T> {
  const query = new URLSearchParams({ ...scopeFields(scope), ...params });
  const response = await fetch(`${kbUrl(endpoint)}?${query}`, {
    method: "GET",
    headers: s2sHeaders(scope.userId),
    signal: AbortSignal.timeout(60_000),
  });
  return readEnvelope<T>(response, endpoint);
}

async function kbPost<T>(
  endpoint: string,
  scope: KbTarget,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(kbUrl(endpoint), {
    method: "POST",
    headers: s2sHeaders(scope.userId),
    body: JSON.stringify({ ...scopeFields(scope), ...payload }),
    signal: AbortSignal.timeout(120_000),
  });
  return readEnvelope<T>(response, endpoint);
}

// ---------------------------------------------------------------------------
// Reading what the model passed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * One line per tool call, with its outcome and duration.
 *
 * An agent session IS its sequence of tool calls, so these lines are how you
 * reconstruct what it did — which pages it looked at, what it searched for and
 * whether it found anything, what it changed. Contents are never logged: pages
 * are large and may be sensitive, and the path plus the outcome is what makes
 * a run reproducible.
 */
function logCall(tool: string, summary: string, startedAt: number): void {
  log.info(`[kb ${tool}] ${summary} (${Date.now() - startedAt}ms)`);
}

function logFailure(tool: string, subject: string, err: unknown, startedAt: number): string {
  const message = err instanceof Error ? err.message : String(err);
  log.warn(`[kb ${tool}] ${subject} FAILED after ${Date.now() - startedAt}ms: ${message}`);
  return message;
}

/** A model-supplied string, trimmed. For paths and patterns. */
function param(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A model-supplied string with whitespace intact. For page content and edit
 * snippets: trimming an `oldText` would break the exact-match guarantee that
 * makes `edit` safe.
 */
function exactParam(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function createReadPageTool(scope: KbTarget): ToolDefinition {
  return {
    name: "read",
    label: "Read KB Page",
    description: [
      "Read a knowledge-base page by its exact path, e.g. 'services/livekit/service.md'.",
      "Paths are relative to the collection root. Use `ls` first if you do not know the path.",
      "Returns the page's full markdown, including frontmatter.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Page path, e.g. 'services/livekit/service.md'.",
        },
      },
      required: ["path"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const path = param(params, "path");
      if (!path) {
        return { content: [{ type: "text" as const, text: "Error: path is required." }], details: {} };
      }

      const startedAt = Date.now();
      try {
        const page = await kbGet<{ found: boolean; content: string | null }>("read", scope, { path });

        if (!page.found || page.content === null) {
          logCall("read", `${path} -> NOT FOUND`, startedAt);
          return { content: [{ type: "text" as const, text: `Not found: ${path}` }], details: {} };
        }

        const truncated = page.content.length > MAX_READ_CHARS;
        logCall(
          "read",
          `${path} -> ${page.content.length} chars${truncated ? " (truncated)" : ""}`,
          startedAt,
        );

        const text = truncated
          ? `${page.content.slice(0, MAX_READ_CHARS)}\n\n[truncated at ${MAX_READ_CHARS} chars]`
          : page.content;

        return { content: [{ type: "text" as const, text }], details: { path } };
      } catch (err) {
        const message = logFailure("read", path, err, startedAt);
        return {
          content: [{ type: "text" as const, text: `Read failed: ${message}` }],
          details: { error: true },
        };
      }
    },
  };
}

function createListPagesTool(scope: KbTarget): ToolDefinition {
  return {
    name: "ls",
    label: "List KB Pages",
    description: [
      "List knowledge-base page paths, optionally under a prefix (e.g. 'services/').",
      "Cheap and complete — it lists every page, so prefer it over guessing whether a page exists.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Optional prefix filter, e.g. 'services/'. Omit to list everything.",
        },
      },
      required: [],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const prefix = param(params, "path");

      const startedAt = Date.now();
      try {
        const result = await kbGet<{ paths: string[] }>(
          "list",
          scope,
          prefix ? { prefix } : {},
        );

        logCall("ls", `${prefix || "(all)"} -> ${result.paths.length} paths`, startedAt);

        if (result.paths.length === 0) {
          const text = prefix ? `No pages under ${prefix}` : "The KB is empty.";
          return { content: [{ type: "text" as const, text }], details: {} };
        }

        const text = `${result.paths.length} pages:\n${result.paths.join("\n")}`;
        return { content: [{ type: "text" as const, text }], details: { count: result.paths.length } };
      } catch (err) {
        const message = logFailure("ls", prefix || "(all)", err, startedAt);
        return {
          content: [{ type: "text" as const, text: `List failed: ${message}` }],
          details: { error: true },
        };
      }
    },
  };
}

function createGrepPagesTool(scope: KbTarget): ToolDefinition {
  return {
    name: "grep",
    label: "Search KB Pages",
    description: [
      "Search page contents for a literal string or regex. Returns path:line matches.",
      "Exact and complete — every page is read rather than ranked, so no match means the text is genuinely absent.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        pattern: {
          type: "string",
          description: "Literal text or regular expression to find.",
        },
        path: {
          type: "string",
          description: "Optional prefix to restrict the search, e.g. 'services/'.",
        },
      },
      required: ["pattern"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const pattern = param(params, "pattern");
      if (!pattern) {
        return {
          content: [{ type: "text" as const, text: "Error: pattern is required." }],
          details: {},
        };
      }

      const prefix = param(params, "path");

      const startedAt = Date.now();
      try {
        const result = await kbGet<{
          matches: Array<{ path: string; line: number; text: string }>;
        }>("grep", scope, { pattern, ...(prefix ? { prefix } : {}) });

        if (result.matches.length === 0) {
          // Worth a warn, not an info: an empty grep is usually the step before
          // the agent decides nothing covers this and writes a new page. If a
          // duplicate shows up later, this line is where the trail starts.
          log.warn(
            `[kb grep] "${pattern}"${prefix ? ` under ${prefix}` : ""} -> NO MATCHES ` +
              `(${Date.now() - startedAt}ms)`,
          );
          return {
            content: [{ type: "text" as const, text: `No matches for ${pattern}` }],
            details: {},
          };
        }

        logCall(
          "grep",
          `"${pattern}"${prefix ? ` under ${prefix}` : ""} -> ${result.matches.length} matches ` +
            `in ${new Set(result.matches.map((m) => m.path)).size} pages`,
          startedAt,
        );

        const shown = result.matches.slice(0, MAX_GREP_MATCHES);
        const hidden = result.matches.length - shown.length;
        const lines = shown.map((match) => `${match.path}:${match.line}: ${match.text}`);
        const text = lines.join("\n") + (hidden > 0 ? `\n[+${hidden} more matches]` : "");

        return { content: [{ type: "text" as const, text }], details: { count: result.matches.length } };
      } catch (err) {
        const message = logFailure("grep", `"${pattern}"`, err, startedAt);
        return {
          content: [{ type: "text" as const, text: `Grep failed: ${message}` }],
          details: { error: true },
        };
      }
    },
  };
}

function createWritePageTool(scope: KbTarget): ToolDefinition {
  return {
    name: "write",
    label: "Write KB Page",
    description: [
      "Create a knowledge-base page, or replace an existing one at that path.",
      "Folders are created automatically from the path — no need to make them first.",
      "If the content is identical to what is already there, nothing is written and no version is created.",
      "Prefer `edit` for a small change; use `write` for a new page or a full rewrite.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Page path, e.g. 'services/livekit/service.md'.",
        },
        content: {
          type: "string",
          description: "Full markdown content of the page, including frontmatter.",
        },
      },
      required: ["path", "content"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const path = param(params, "path");
      const content = exactParam(params, "content");
      if (!path || !content) {
        return {
          content: [{ type: "text" as const, text: "Error: path and content are required." }],
          details: {},
        };
      }

      const startedAt = Date.now();
      try {
        const outcome = await kbPost<{ path: string; status: string }>("write", scope, {
          path,
          content,
        });
        // created / updated / unchanged. A run that is mostly "unchanged" is
        // healthy; a run that is mostly "created" means paths are not matching
        // existing pages and duplicates are accumulating.
        logCall("write", `${path} -> ${outcome.status} (${content.length} chars)`, startedAt);
        return {
          content: [{ type: "text" as const, text: `${outcome.status}: ${outcome.path}` }],
          details: { path: outcome.path, status: outcome.status },
        };
      } catch (err) {
        const message = logFailure("write", path, err, startedAt);
        return {
          content: [{ type: "text" as const, text: `Write failed: ${message}` }],
          details: { error: true },
        };
      }
    },
  };
}

function createEditPageTool(scope: KbTarget): ToolDefinition {
  return {
    name: "edit",
    label: "Edit KB Page",
    description: [
      "Replace an exact snippet in an existing page.",
      "`oldText` must appear EXACTLY ONCE — include enough surrounding context to make it unique.",
      "Fails without changing anything if the text is missing or appears more than once.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        path: {
          type: "string",
          description: "Page path to edit.",
        },
        oldText: {
          type: "string",
          description: "Exact text to replace. Must appear exactly once in the page.",
        },
        newText: {
          type: "string",
          description: "Replacement text. An empty string deletes the snippet.",
        },
      },
      required: ["path", "oldText", "newText"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const path = param(params, "path");
      const oldText = exactParam(params, "oldText");
      const newText = exactParam(params, "newText");
      if (!path || !oldText) {
        return {
          content: [{ type: "text" as const, text: "Error: path and oldText are required." }],
          details: {},
        };
      }

      const startedAt = Date.now();
      try {
        const outcome = await kbPost<{ path: string; status: string }>("edit", scope, {
          path,
          oldText,
          newText,
        });
        logCall(
          "edit",
          `${path} -> ${outcome.status} (${oldText.length} -> ${newText.length} chars)`,
          startedAt,
        );
        return {
          content: [{ type: "text" as const, text: `${outcome.status}: ${outcome.path}` }],
          details: { path: outcome.path, status: outcome.status },
        };
      } catch (err) {
        // "not found" and "not unique (3 occurrences)" are actionable: the model
        // widens its snippet and retries. Surface them verbatim — and log them,
        // because repeated "not unique" on one path means the page has grown
        // boilerplate the agent cannot address precisely.
        const message = logFailure("edit", path, err, startedAt);
        return {
          content: [{ type: "text" as const, text: `Edit failed: ${message}` }],
          details: { error: true },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Keyed by pi's built-in tool names, so these replace the filesystem versions.
 *
 * These exist for curating a KB, which means writing to it — an agent that only
 * needs to read one uses Vespa retrieval instead and never gets this map.
 */
export function createKbToolMap(target: KbTarget): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    read: createReadPageTool(target),
    ls: createListPagesTool(target),
    grep: createGrepPagesTool(target),
    write: createWritePageTool(target),
    edit: createEditPageTool(target),
  };
  log.info(
    `[kb-tools] collection=${target.collectionId} tools=[${Object.keys(tools).join(", ")}]`,
  );
  return tools;
}

/** Array form, for registration paths that take a tool list. */
export function createKbTools(target: KbTarget): ToolDefinition[] {
  return Object.values(createKbToolMap(target));
}
