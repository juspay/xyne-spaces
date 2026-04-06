import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpAdapter, McpCallResult, McpServerTools, McpToolInfo } from "./types.js";
import { grafanaAdapter } from "./adapters/grafana.js";
import { bitbucketAdapter } from "./adapters/bitbucket.js";
import { kibanaAdapter } from "./adapters/kibana.js";
import { xyneSpacesAdapter } from "./adapters/xyne-spaces.js";

const ADAPTERS: Record<string, McpAdapter> = {
  grafana: grafanaAdapter,
  bitbucket: bitbucketAdapter,
  kibana: kibanaAdapter,
  "xyne-spaces": xyneSpacesAdapter,
};

interface McpSession {
  client: Client;
  transport: StdioClientTransport;
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

  const adapter = ADAPTERS[serverType];
  if (!adapter) {
    throw new Error(`No adapter for server type: ${serverType}`);
  }

  const { cmd, args, env } = adapter.buildCommand(credentials);

  const transport = new StdioClientTransport({
    command: cmd,
    args,
    env: { ...process.env, ...env } as Record<string, string>,
  });

  const client = new Client({ name: "xyne-claw-auth", version: "0.1.0" });
  await client.connect(transport);

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

  return { serverType, serverName, tools };
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

    return { content: text };
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
  return serverType in ADAPTERS;
}

export function getAdapters(): Record<string, McpAdapter> {
  return ADAPTERS;
}
