import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Attachment } from "./agent.js";
import { SERVER } from "./config.js";
import { promoteIfOversized } from "./tool-output.js";
import { writeAttachmentToContext } from "./attachment-write.js";
import { readFile, realpath } from "node:fs/promises";
import { resolve as resolvePath, isAbsolute, sep } from "node:path";
import crypto from "node:crypto";

import { createLogger } from "./logger.js";
const log = createLogger("mcp");

/**
 * `spaces-fetch-attachment` returns a `[SPACES_ATTACHMENT:fileName:mimeType]\n<base64>`
 * marker. Decode the base64 and hand it to the same `writeAttachmentToContext`
 * helper the webhook flow uses — so xlsx/pdf get the same auto-extraction
 * (multi-sheet markdown / unpdf), text gets utf-8 decoded, images and
 * unknown binaries are written as-is. Returns null if no marker is found.
 */
export async function persistSpacesAttachmentIfMarker(
  workspaceDir: string,
  content: string,
): Promise<string | null> {
  // Match the first line as the marker; everything after the newline is base64.
  const match = /^\[SPACES_ATTACHMENT:([^:]+):([^\]]+)\]\n([\s\S]*)$/.exec(content);
  if (!match) return null;
  const fileName = match[1]!;
  const mimeType = match[2]!;
  const base64 = match[3]!.trim();
  try {
    const buf = Buffer.from(base64, "base64");
    const { relPath, kind, byteSize } = await writeAttachmentToContext(
      workspaceDir,
      fileName,
      mimeType,
      buf,
    );
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    return [
      `Saved attachment to \`${relPath}\` (${kind}, ${byteSize} bytes). Use the read tool to view it.`,
      `Workspace file marker: {{file:${relPath}}}`,
      `Attachment metadata: ${JSON.stringify({ fileName, mimeType, sha256 })}`,
    ].join("\n");
  } catch (err) {
    return `Failed to persist attachment ${fileName}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// MCP and custom/sandbox tools share the same over-large-output handling —
// spill to a file under .context/ and hand the model a preview + path. See
// tool-output.ts for the implementation (promoteIfOversized).

interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly serviceName?: string;
  readonly backendId?: string;
  readonly selectionKey?: string;
}

interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly displayName?: string;
  readonly tools: McpToolInfo[];
  readonly writeTools: readonly string[];
}

interface AuthResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export type { TrustedMcpToolBindings } from "xyne-claw-shared";
import type { TrustedMcpToolBindings } from "xyne-claw-shared";

export function schemaWithTrustedMcpBindings(
  inputSchema: Record<string, unknown>,
  bindings: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!bindings || Object.keys(bindings).length === 0) return inputSchema;
  const required = Array.isArray(inputSchema["required"])
    ? (inputSchema["required"] as unknown[]).filter(
        (value) => typeof value !== "string" || !(value in bindings),
      )
    : undefined;
  return required ? { ...inputSchema, required } : inputSchema;
}

export function applyTrustedMcpBindings(
  params: Record<string, unknown>,
  bindings: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return bindings ? { ...params, ...bindings } : params;
}

async function authFetch<T>(path: string, sessionToken: string, init?: RequestInit): Promise<T> {
  const url = `${SERVER.authServiceUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      "x-s2s-key": SERVER.s2sKey,
      ...init?.headers,
    },
  });
  const body = (await res.json()) as AuthResponse<T>;
  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `Auth service error: ${res.status}`);
  }
  return body.data;
}

function injectToolCallIdIntoClawCitations(content: string, toolCallId: string): string {
  if (!content || !toolCallId) return content;
  return content.split("__TOOL_CALL_ID__").join(toolCallId);
}

/** A group of MCP tools from one server, with write tool info preserved */
export interface McpToolGroup {
  serverType: string;
  serverName: string;
  tools: ToolDefinition[];
  writeTools: string[];
}

// ── Inbound file forwarding (INPUT counterpart of claw-auth file forwarding) ──
//
// Some MCP tools need an actual file as input (e.g. "upload this document").
// MCP tool calls carry only JSON params, so the agent references a file already
// present in the claw workspace via a `{{file:<relpath>}}` marker; for
// whitelisted servers we read that file, base64-encode it, and substitute it
// into the param BEFORE the call leaves claw. The base64 never enters the
// model's context — the model only ever emits the short marker.
//
// SECURITY: forwarding raw bytes to a remote MCP server can leak confidential
// workspace files, so it is gated by a server allowlist. Path resolution is
// confined to the session workspace (no absolute paths, no `..` traversal, no
// symlink escape) so the agent cannot exfiltrate host files (claw-auth secrets,
// /etc/*, or another session's data).
//
// Allowlist source: the CLAW_FILE_INPUT_FORWARDING_SERVERS env var (comma-
// separated serverTypes). Mirrors claw-auth's FILE_FORWARDING_SERVERS pattern.
const FILE_INPUT_FORWARDING_SERVERS = new Set<string>(
  (process.env["CLAW_FILE_INPUT_FORWARDING_SERVERS"] ?? "github")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

function isFileInputForwardingServer(serverType: string): boolean {
  return FILE_INPUT_FORWARDING_SERVERS.has(serverType);
}

// Cap on a single forwarded file (base64 inflates ~33%; both the call body and
// the remote server must tolerate it). Configurable; defaults to 25 MiB.
const MAX_FORWARDED_FILE_BYTES = Number(
  process.env["CLAW_MAX_FORWARDED_FILE_BYTES"] ?? 25 * 1024 * 1024,
);

// Exact-match marker for a string param value: `{{file:<relpath>}}`.
const FILE_MARKER_RE = /^\{\{file:(.+)\}\}$/;

const FILE_INPUT_HINT =
  "\n\nFile input: to send a workspace file as a parameter value, set that " +
  "parameter to `{{file:<relative/path>}}` (e.g. `{{file:.context/report.pdf}}`). " +
  "The file's bytes are base64-encoded and forwarded in place of the marker. " +
  "Only files inside this session's workspace can be forwarded.";

/**
 * Read a workspace-relative file, refusing anything that resolves outside
 * `workspaceDir` (absolute paths, `..` traversal, or symlink escape).
 */
export async function readWorkspaceFile(workspaceDir: string, relPath: string): Promise<Buffer> {
  if (isAbsolute(relPath)) {
    throw new Error(`absolute paths are not allowed: ${relPath}`);
  }
  const base = await realpath(workspaceDir);
  const target = resolvePath(base, relPath);
  // realpath resolves symlinks and throws if the file is missing.
  const real = await realpath(target);
  if (real !== base && !real.startsWith(base + sep)) {
    throw new Error(`refusing to forward a file outside the workspace: ${relPath}`);
  }
  const buf = await readFile(real);
  if (buf.byteLength > MAX_FORWARDED_FILE_BYTES) {
    throw new Error(
      `file ${relPath} is ${buf.byteLength} bytes, exceeding the ${MAX_FORWARDED_FILE_BYTES}-byte forwarding limit`,
    );
  }
  return buf;
}

/**
 * Deep-scan tool params for `{{file:<relpath>}}` markers and replace each with
 * the base64 content of the referenced workspace file. Returns the rewritten
 * params and the list of forwarded relative paths (for logging).
 */
export async function injectForwardedFiles(
  params: Record<string, unknown>,
  workspaceDir: string,
): Promise<{ params: Record<string, unknown>; forwarded: string[] }> {
  const forwarded: string[] = [];
  async function walk(val: unknown): Promise<unknown> {
    if (typeof val === "string") {
      const m = FILE_MARKER_RE.exec(val.trim());
      if (!m) return val;
      const rel = m[1]!.trim();
      const buf = await readWorkspaceFile(workspaceDir, rel);
      forwarded.push(rel);
      return buf.toString("base64");
    }
    if (Array.isArray(val)) {
      const out: unknown[] = [];
      for (const item of val) out.push(await walk(item));
      return out;
    }
    if (val && typeof val === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = await walk(v);
      return out;
    }
    return val;
  }
  const rewritten = (await walk(params)) as Record<string, unknown>;
  return { params: rewritten, forwarded };
}

export async function loadMcpToolsForUser(
  sessionId: string,
  sessionToken: string,
  workspaceDir: string,
  toolPermissions?: Record<string, string>,
  agentSlug?: string,
  // Base dir for over-large tool-result offload. Defaults to the ephemeral
  // workspace, but callers with a conversation should pass the persistent
  // session dir (toolOutputBaseDir) so spilled files survive resume + are
  // reachable by the read/grep tools and the sandbox on later turns. Binary
  // attachments still land in workspaceDir (they're inputs for this run).
  toolOutputDir: string = workspaceDir,
  // Streaming sink for files forwarded from MCP tools (FILE_FORWARDING_TOOLS in
  // claw-auth). Same callback custom-tools uses → pushes to the user mid-run.
  onAttachment?: (a: Attachment) => void,
  // Server-owned values injected after model argument generation. This keeps
  // execution identity stable across context compaction and prevents a model
  // from omitting or replacing trusted run bindings.
  trustedToolBindings?: TrustedMcpToolBindings,
): Promise<{
  groups: McpToolGroup[];
  cleanup: () => Promise<void>;
  getPendingActions: () => Array<Record<string, unknown>>;
  getAttachments: () => Attachment[];
}> {
  const permissions = toolPermissions ?? {};
  const servers = await authFetch<McpServerTools[]>(
    `/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/tools`,
    sessionToken,
  );

  if (servers.length === 0) {
    return { groups: [], cleanup: async () => {}, getPendingActions: () => [], getAttachments: () => [] };
  }

  const pendingActions: Array<Record<string, unknown>> = [];
  const mcpAttachments: Attachment[] = [];
  const groups: McpToolGroup[] = [];

  for (const server of servers) {
    const tools: ToolDefinition[] = [];
    const displayName = server.displayName ?? server.serverName;

    for (const mcpTool of server.tools) {
      const toolKey = `${server.serverType}__${mcpTool.name}`;
      const permission = permissions[toolKey] ?? "allow";

      // Tool names must be LLM-API safe: only [a-zA-Z0-9_-] allowed.
      // Dots (e.g. from "Customer.io") cause models to truncate the name at
      // the last dot, breaking tool dispatch. Replace everything except
      // alphanumerics, underscores, and hyphens.
      const safeName = `${server.serverName}__${mcpTool.name}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
      const acceptsFiles = isFileInputForwardingServer(server.serverType);
      const trustedBindings = trustedToolBindings?.[mcpTool.name];
      const baseDescription = mcpTool.description || `Tool ${mcpTool.name} from ${displayName}`;
      const definition: ToolDefinition & { serviceName?: string; backendId?: string; selectionKey?: string } = {
        name: safeName,
        label: `${displayName}/${mcpTool.name}`,
        ...(typeof mcpTool.serviceName === "string" && mcpTool.serviceName.length > 0
          ? { serviceName: mcpTool.serviceName }
          : {}),
        ...(typeof mcpTool.backendId === "string" && mcpTool.backendId.length > 0
          ? { backendId: mcpTool.backendId }
          : {}),
        ...(typeof mcpTool.selectionKey === "string" && mcpTool.selectionKey.length > 0
          ? { selectionKey: mcpTool.selectionKey }
          : {}),
        description:
          (acceptsFiles ? baseDescription + FILE_INPUT_HINT : baseDescription) +
          (trustedBindings
            ? " Trusted SDLC identity is bound by the server; do not supply repository, execution, workspace, or actor identity fields."
            : ""),
        parameters: Type.Unsafe(schemaWithTrustedMcpBindings(mcpTool.inputSchema, trustedBindings)),
        async execute(_toolCallId, params) {
          // For allowlisted servers, replace any `{{file:<relpath>}}` markers in
          // the params with the base64 content of the referenced workspace file
          // before the call leaves claw. The model never sees the bytes.
          let callParams = params as Record<string, unknown>;
          if (acceptsFiles) {
            try {
              const sub = await injectForwardedFiles(callParams, workspaceDir);
              callParams = sub.params;
              if (sub.forwarded.length > 0) {
                log.info(
                  `[mcp] forwarded ${sub.forwarded.length} workspace file(s) to ${server.serverType}: ${sub.forwarded.join(", ")}`,
                );
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn(`[mcp] file forwarding failed for ${server.serverType}/${mcpTool.name}: ${msg}`);
              return { content: [{ type: "text" as const, text: `File forwarding failed: ${msg}` }], details: {} };
            }
          }
          callParams = applyTrustedMcpBindings(callParams, trustedBindings);
          const result = await authFetch<{
            content: string;
            citations?: import("xyne-claw-shared").Citation[];
            pendingAction?: Record<string, unknown>;
            attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
            /** Out-of-band debug payload (currently the Vespa YQL from kb-search /
             *  spaces-search). Stashed via recordDebug for tool_execution_end
             *  to attach to the persisted ToolInvocation — never reaches the LLM. */
            debug?: Record<string, unknown>;
          }>(
            `/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/call`,
            sessionToken,
            {
              method: "POST",
              body: JSON.stringify({
                serverType: server.serverType,
                tool: mcpTool.name,
                params: callParams,
                permission,
                agentSlug,
              }),
            },
          );

          if (result.pendingAction) {
            pendingActions.push(result.pendingAction);
          }

          // File forwarding: claw-auth lifted binary output (e.g. a generated
          // PDF report) into `attachments` for allowlisted tools. Collect them
          // so run.ts includes them in the run's final attachments, and stream
          // each to the user immediately via onAttachment. The base64 is NOT in
          // result.content (claw-auth replaced it with a short summary), so the
          // model never sees the blob.
          if (result.attachments && result.attachments.length > 0) {
            for (const att of result.attachments) {
              mcpAttachments.push(att);
              try { onAttachment?.(att); } catch (err) {
                log.warn(`[mcp] onAttachment threw for ${att.fileName}:`, err instanceof Error ? err.message : err);
              }
            }
          }

          // Stash structured citations keyed by toolCallId so agent.ts can
          // attach them to the recorded ToolInvocation in tool_execution_end.
          if (result.citations && result.citations.length > 0) {
            const { recordCitations } = await import("./citations.js");
            recordCitations(_toolCallId, result.citations);
          }

          // Stash MCP debug metadata (currently the Vespa YQL from kb-search /
          // spaces-search). Same lifecycle as citations — recorded here on
          // tool return, lifted by takeDebug() in tool_execution_end so it
          // lands on the persisted ToolInvocation. Never enters tool content.
          if (result.debug && typeof result.debug === "object" && Object.keys(result.debug).length > 0) {
            const { recordDebug } = await import("./citations.js");
            recordDebug(_toolCallId, result.debug);
          }

          // Spaces attachment marker: when spaces-fetch-attachment returns,
          // decode the base64 payload and write the binary to .context/<file>
          // so the agent can `read` it normally. Replaces the giant base64
          // blob with a short status line, which also keeps it well under
          // promoteIfOversized's cap.
          const persistedAttachmentText =
            mcpTool.name === "spaces-fetch-attachment"
              ? await persistSpacesAttachmentIfMarker(workspaceDir, result.content)
              : null;

          const renderedContent = injectToolCallIdIntoClawCitations(result.content, _toolCallId);

          // Mirror pi-coding-agent's bash-tool pattern for over-large output:
          // dump to a file under .context/, embed the relative path in the
          // result, return a small preview. Without this, MCP tools that
          // return tens-of-MB blobs (iswitch_list_resources, etc.) blow
          // through the LLM's context window in a single turn.
          const promotedText = await promoteIfOversized(
            toolOutputDir,
            server.serverType,
            mcpTool.name,
            persistedAttachmentText ?? renderedContent,
          );
          return {
            content: [{ type: "text" as const, text: promotedText }],
            details: {},
          };
        },
      };
      tools.push(definition);
    }

    groups.push({
      serverType: server.serverType,
      serverName: server.serverName,
      tools,
      writeTools: [...(server.writeTools ?? [])],
    });
  }

  const totalTools = groups.reduce((sum, g) => sum + g.tools.length, 0);
  log.info(`[mcp] Loaded ${totalTools} tools in ${groups.length} groups for session ${sessionId}`);

  return { groups, cleanup: async () => {}, getPendingActions: () => pendingActions, getAttachments: () => mcpAttachments };
}
