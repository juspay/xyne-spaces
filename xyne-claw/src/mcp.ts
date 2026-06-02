import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { SERVER } from "./config.js";
import { writeAttachmentToContext } from "./attachment-write.js";

/**
 * `spaces-fetch-attachment` returns a `[SPACES_ATTACHMENT:fileName:mimeType]\n<base64>`
 * marker. Decode the base64 and hand it to the same `writeAttachmentToContext`
 * helper the webhook flow uses — so xlsx/pdf get the same auto-extraction
 * (multi-sheet markdown / unpdf), text gets utf-8 decoded, images and
 * unknown binaries are written as-is. Returns null if no marker is found.
 */
async function persistSpacesAttachmentIfMarker(
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
    return `Saved attachment to \`${relPath}\` (${kind}, ${byteSize} bytes). Use the read tool to view it.`;
  } catch (err) {
    return `Failed to persist attachment ${fileName}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// File-promotion threshold for MCP tool results. Mirrors pi-coding-agent's
// built-in DEFAULT_MAX_BYTES (50KB) for bash/read/ls/grep/find — pi promotes
// over-large output to a temp file and embeds the path in the tool_result so
// the LLM can `read` it. That logic only applies to pi's OWN built-in tools.
// MCP tool results take a different code path (customTools), so pi never
// sees them at the truncation layer. This wrapper applies the same pattern
// to anything an MCP server returns.
//
// We use a tighter 32KB cap (vs pi's 50KB for bash) because MCP tool results
// often include JSON which is structure-heavy — the model has to skim more
// tokens per useful fact than it does with raw shell output.
const MCP_RESULT_INLINE_CAP_BYTES = 32 * 1024;
// Show the agent a small preview before the path so it doesn't have to
// blindly read the file when it could already answer from the head.
const MCP_RESULT_PREVIEW_BYTES = 2 * 1024;

/**
 * If the MCP tool result is over MCP_RESULT_INLINE_CAP_BYTES, dump it to
 * `<workspaceDir>/.context/mcp-results/<safeServerType>-<safeToolName>-<ts>.json`
 * and replace the LLM-visible content with a preview + the relative path.
 *
 * Path is RELATIVE to workspaceDir so it matches how the agent already
 * references other `.context/` files (read tool resolves relative paths
 * against its scoped cwd, which IS workspaceDir).
 */
async function promoteIfOversized(
  workspaceDir: string,
  serverType: string,
  toolName: string,
  rawContent: string,
): Promise<string> {
  if (rawContent.length <= MCP_RESULT_INLINE_CAP_BYTES) {
    return rawContent;
  }
  const safeServer = serverType.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  // ISO-like timestamp without colons/dots for filename safety.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relPath = `.context/mcp-results/${safeServer}-${safeTool}-${stamp}.json`;
  const absPath = joinPath(workspaceDir, relPath);
  try {
    await mkdir(joinPath(workspaceDir, ".context", "mcp-results"), { recursive: true });
    await writeFile(absPath, rawContent, { encoding: "utf8" });
  } catch (err) {
    // Disk write failed — fall back to inline with truncation note so the
    // agent at least sees the head + a clear signal that data was lost.
    const truncated = rawContent.slice(0, MCP_RESULT_INLINE_CAP_BYTES);
    return [
      `[Tool returned ${rawContent.length} chars — full result could not be saved to disk:`,
      `   ${err instanceof Error ? err.message : String(err)}`,
      `   Showing only the first ${MCP_RESULT_INLINE_CAP_BYTES} chars; the tail was dropped.]`,
      ``,
      truncated,
    ].join("\n");
  }
  const preview = rawContent.slice(0, MCP_RESULT_PREVIEW_BYTES);
  console.log(`[mcp/promotion] ${safeServer}/${safeTool} result ${rawContent.length}b → ${relPath}`);
  return [
    `[Tool returned ${rawContent.length} chars — full result saved to ${relPath}.`,
    `Use the read tool on that path (with offset/limit) or grep on it to inspect.`,
    `If you're looking for specific entries, consider re-calling the tool with narrower filters.]`,
    ``,
    `## Preview (first ${MCP_RESULT_PREVIEW_BYTES} chars)`,
    preview,
  ].join("\n");
}

interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly tools: McpToolInfo[];
  readonly writeTools: readonly string[];
}

interface AuthResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

async function authFetch<T>(path: string, sessionToken: string, init?: RequestInit): Promise<T> {
  const url = `${SERVER.authServiceUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      ...init?.headers,
    },
  });
  const body = (await res.json()) as AuthResponse<T>;
  if (!body.success || body.data === undefined) {
    throw new Error(body.error ?? `Auth service error: ${res.status}`);
  }
  return body.data;
}

/** A group of MCP tools from one server, with write tool info preserved */
export interface McpToolGroup {
  serverType: string;
  serverName: string;
  tools: ToolDefinition[];
  writeTools: string[];
}

export async function loadMcpToolsForUser(
  sessionId: string,
  sessionToken: string,
  workspaceDir: string,
  toolPermissions?: Record<string, string>,
  agentSlug?: string,
): Promise<{
  groups: McpToolGroup[];
  cleanup: () => Promise<void>;
  getPendingActions: () => Array<Record<string, unknown>>;
}> {
  const permissions = toolPermissions ?? {};
  const servers = await authFetch<McpServerTools[]>(
    `/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/tools`,
    sessionToken,
  );

  if (servers.length === 0) {
    return { groups: [], cleanup: async () => {}, getPendingActions: () => [] };
  }

  const pendingActions: Array<Record<string, unknown>> = [];
  const groups: McpToolGroup[] = [];

  for (const server of servers) {
    // query-routing tools are only available to the investigation-agent
    if (server.serverType === "query-routing" && agentSlug !== "investigation-agent") {
      continue;
    }

    const tools: ToolDefinition[] = [];

    for (const mcpTool of server.tools) {
      const toolKey = `${server.serverType}__${mcpTool.name}`;
      const permission = permissions[toolKey] ?? "allow";

      // Tool names must be LLM-API safe: only [a-zA-Z0-9_-] allowed.
      // Dots (e.g. from "Customer.io") cause models to truncate the name at
      // the last dot, breaking tool dispatch. Replace everything except
      // alphanumerics, underscores, and hyphens.
      const safeName = `${server.serverName}__${mcpTool.name}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
      const definition: ToolDefinition = {
        name: safeName,
        label: `${server.serverName}/${mcpTool.name}`,
        description: mcpTool.description || `Tool ${mcpTool.name} from ${server.serverName}`,
        parameters: Type.Unsafe(mcpTool.inputSchema),
        async execute(_toolCallId, params) {
          const result = await authFetch<{
            content: string;
            citations?: import("xyne-claw-shared").Citation[];
            pendingAction?: Record<string, unknown>;
          }>(
            `/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/call`,
            sessionToken,
            {
              method: "POST",
              body: JSON.stringify({
                serverType: server.serverType,
                tool: mcpTool.name,
                params: params as Record<string, unknown>,
                permission,
                agentSlug,
              }),
            },
          );

          if (result.pendingAction) {
            pendingActions.push(result.pendingAction);
          }

          // Stash structured citations keyed by toolCallId so agent.ts can
          // attach them to the recorded ToolInvocation in tool_execution_end.
          if (result.citations && result.citations.length > 0) {
            const { recordCitations } = await import("./citations.js");
            recordCitations(_toolCallId, result.citations);
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

          // Mirror pi-coding-agent's bash-tool pattern for over-large output:
          // dump to a file under .context/, embed the relative path in the
          // result, return a small preview. Without this, MCP tools that
          // return tens-of-MB blobs (iswitch_list_resources, etc.) blow
          // through the LLM's context window in a single turn.
          const promotedText = await promoteIfOversized(
            workspaceDir,
            server.serverType,
            mcpTool.name,
            persistedAttachmentText ?? result.content,
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
  console.log(`[mcp] Loaded ${totalTools} tools in ${groups.length} groups for session ${sessionId}`);

  return { groups, cleanup: async () => {}, getPendingActions: () => pendingActions };
}
