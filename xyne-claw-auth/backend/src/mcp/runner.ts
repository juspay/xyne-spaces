import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpAdapter, McpCallResult, McpServerTools, McpToolInfo } from "./types.js";
import { STATIC_ADAPTERS } from "./static-adapters.js";
import { resolveConnectorDefinition } from "./connector-definitions.js";

interface McpSession {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const sessions = new Map<string, McpSession>();

function sessionKey(userId: string, serverType: string): string {
  return `${userId}:${serverType}`;
}

async function getOrCreateSession(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
): Promise<Client> {
  const key = sessionKey(userId, serverType);
  const existing = sessions.get(key);
  if (existing) {
    return existing.client;
  }

  const definition = await resolveConnectorDefinition(serverType);
  if (!definition) {
    throw new Error(`No connector definition for server type: ${serverType}`);
  }

  let transport: StdioClientTransport | StreamableHTTPClientTransport;

  if (definition.transport === "http") {
    // Remote MCP server — connect over Streamable HTTP
    const { url, headers } = definition.buildHttpConfig(credentials);
    if (!url) throw new Error(`Missing HTTP URL in connector definition for ${serverType}`);
    transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers,
      },
    });
  } else {
    // Local MCP server — spawn child process over stdio
    const { cmd, args, env } = definition.buildStdioCommand(credentials);
    if (!cmd) throw new Error(`Missing stdio command in connector definition for ${serverType}`);
    transport = new StdioClientTransport({
      command: cmd,
      args: [...args],
      env: { ...process.env, ...env } as Record<string, string>,
    });
  }

  const client = new Client({ name: "xyne-claw-auth", version: "0.1.0" });
  await client.connect(transport as Parameters<typeof client.connect>[0]);

  transport.onclose = () => {
    sessions.delete(key);
  };

  sessions.set(key, { client, transport });
  return client;
}

export async function listToolsForUser(
  userId: string,
  serverType: string,
  serverName: string,
  credentials: Record<string, unknown>,
): Promise<McpServerTools> {
  const client = await getOrCreateSession(userId, serverType, credentials);
  const result = await client.listTools();

  const tools: McpToolInfo[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  const definition = await resolveConnectorDefinition(serverType);
  const writeTools = definition?.writeTools ?? [];
  return { serverType, serverName, tools, writeTools };
}

export async function callTool(
  userId: string,
  serverType: string,
  credentials: Record<string, unknown>,
  tool: string,
  params: Record<string, unknown>,
): Promise<McpCallResult> {
  const client = await getOrCreateSession(userId, serverType, credentials);

  const result = await client.callTool({ name: tool, arguments: params });

  if ("content" in result && Array.isArray(result.content)) {
    const text = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if ("isError" in result && result.isError === true) {
      throw new Error(text || "MCP tool returned an error");
    }

    // MCP `_meta` is a free-form metadata field. Tools surface structured
    // citations there so we can attach them to the invocation record without
    // grepping the markdown body for IDs (Tier 1 citation propagation).
    const meta = (result as { _meta?: { citations?: unknown } })._meta;
    const citations = Array.isArray(meta?.citations) ? meta.citations as McpCallResult["citations"] : undefined;
    return citations && citations.length > 0
      ? { content: text, citations }
      : { content: text };
  }

  return { content: JSON.stringify(result) };
}

export async function evictSession(userId: string, serverType: string): Promise<void> {
  const key = sessionKey(userId, serverType);
  const session = sessions.get(key);
  if (session) {
    sessions.delete(key);
    await session.transport.close().catch(() => {});
  }
}

export async function evictAllSessionsForUser(userId: string): Promise<void> {
  const prefix = `${userId}:`;
  const evictions: Promise<void>[] = [];
  for (const [key, session] of sessions) {
    if (key.startsWith(prefix)) {
      sessions.delete(key);
      evictions.push(session.transport.close().catch(() => {}));
    }
  }
  await Promise.all(evictions);
}

export function hasAdapter(serverType: string): boolean {
  return serverType in STATIC_ADAPTERS;
}

export function getAdapter(serverType: string): McpAdapter | undefined {
  return STATIC_ADAPTERS[serverType];
}

export function getAdapters(): Record<string, McpAdapter> {
  return STATIC_ADAPTERS;
}
