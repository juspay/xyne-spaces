/**
 * Deterministic file-memory tools (Memory v2, Phase 5).
 *
 * Complements the semantic `memory-search` tool with DETERMINISTIC, named
 * file access:
 *   - read-memory-file  — read a named memory file by key (or list them). No
 *     semantic search — exact fetch. Lets the agent read files that aren't in
 *     the always-loaded set (e.g. expertise.md).
 *   - write-memory-file — create / append / replace a named memory file mid-
 *     chat, so the agent can jot a new memory during a conversation. Written
 *     with provenance "agent"; the user sees it in the memory-files editor.
 *
 * Both are twin-scoped: they operate on (agentSlug, userId)'s files in claw-auth.
 * Registered per-session alongside memory-search when the agent is the twin.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SERVER } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory-file-tools");

const MAX_WRITE_CHARS = 20_000;

function s2sHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey, "x-user-id": userId } : {}),
  };
}

function baseUrl(): string {
  return SERVER.authServiceUrl.replace(/\/+$/, "");
}

export function buildMemoryFileTools(
  agentSlug: string,
  userId: string,
  _sessionId: string,
): ToolDefinition[] {
  const readTool: ToolDefinition = {
    name: "read-memory-file",
    label: "Read Memory File",
    description: [
      "Read one of the user's named memory files by exact name (deterministic — not a search).",
      "Files are the user's persona docs: soul.md, people.md, projects.md, playbook.md, expertise.md, plus any custom ones.",
      "Call with no `name` to list the available files first, then call again with a specific `name`.",
      "Use this for durable, structured facts; use memory-search for fuzzy recall of individual facts.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Exact file name to read (e.g. 'projects.md'). Omit to list all files.",
        },
      },
      required: [],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const name = typeof p["name"] === "string" ? p["name"].trim() : "";
      try {
        const qs = new URLSearchParams({ agentSlug, userId, ...(name ? { name } : {}) });
        const res = await fetch(`${baseUrl()}/claw/api/v1/memory/agent-file?${qs.toString()}`, {
          headers: s2sHeaders(userId),
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Could not read memory file (${res.status}).` }], details: {} };
        }
        const data = (await res.json()) as {
          data?: {
            file?: { name: string; content: string } | null;
            files?: Array<{ name: string; chars: number; loadInPrompt: boolean }>;
          };
        };
        if (name) {
          const file = data?.data?.file;
          if (!file) {
            return { content: [{ type: "text" as const, text: `No memory file named '${name}'.` }], details: {} };
          }
          return {
            content: [{ type: "text" as const, text: `${file.name}:\n\n${file.content}` }],
            details: { name: file.name },
          };
        }
        const files = data?.data?.files ?? [];
        if (files.length === 0) {
          return { content: [{ type: "text" as const, text: "No memory files yet." }], details: {} };
        }
        const list = files
          .map((f) => `- ${f.name} (${f.chars} chars${f.loadInPrompt ? ", loaded in prompt" : ""})`)
          .join("\n");
        return {
          content: [{ type: "text" as const, text: `Available memory files:\n${list}\n\nCall read-memory-file with a name to read one.` }],
          details: { count: files.length },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[read-memory-file] failed agent=${agentSlug}: ${msg}`);
        return { content: [{ type: "text" as const, text: `Memory file read failed: ${msg}` }], details: { error: true } };
      }
    },
  };

  const writeTool: ToolDefinition = {
    name: "write-memory-file",
    label: "Write Memory File",
    description: [
      "Save a new memory to one of the user's named memory files during the chat.",
      "Use this when you learn a durable fact worth remembering (a project update, a new preference, a person).",
      "mode='append' (default) adds to the file; mode='replace' overwrites it. Keep entries concrete and short.",
      "Write to the most fitting file: projects.md, people.md, playbook.md, expertise.md, or soul.md for voice/identity.",
      `Each file is capped at ${MAX_WRITE_CHARS} chars.`,
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Target file name (e.g. 'projects.md')." },
        content: { type: "string", description: "The memory text to save (markdown). One concrete fact/update." },
        mode: { type: "string", enum: ["append", "replace"], description: "append (default) or replace." },
      },
      required: ["name", "content"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params as Record<string, unknown> | undefined) ?? {};
      const name = typeof p["name"] === "string" ? p["name"].trim() : "";
      const content = typeof p["content"] === "string" ? p["content"] : "";
      const mode = p["mode"] === "replace" ? "replace" : "append";
      if (!name || !content.trim()) {
        return { content: [{ type: "text" as const, text: "Error: name and content are required." }], details: {} };
      }
      try {
        const res = await fetch(`${baseUrl()}/claw/api/v1/memory/agent-file`, {
          method: "POST",
          headers: s2sHeaders(userId),
          body: JSON.stringify({ agentSlug, userId, name, content: content.slice(0, MAX_WRITE_CHARS), mode }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          return { content: [{ type: "text" as const, text: `Could not save memory (${res.status}): ${txt.slice(0, 160)}` }], details: {} };
        }
        const data = (await res.json()) as { data?: { file?: { name: string; chars: number } } };
        const f = data?.data?.file;
        return {
          content: [{ type: "text" as const, text: `Saved to ${f?.name ?? name} (${mode}). It now has ${f?.chars ?? "?"} chars.` }],
          details: { name: f?.name ?? name },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[write-memory-file] failed agent=${agentSlug}: ${msg}`);
        return { content: [{ type: "text" as const, text: `Memory save failed: ${msg}` }], details: { error: true } };
      }
    },
  };

  return [readTool, writeTool];
}
