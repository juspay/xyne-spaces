/**
 * In-memory MCP service for runner tests: one session per key, restarted when
 * both fingerprints are set and differ; concurrent starts share one launch.
 * `connect` builds the MCP client for a launch.
 */
import { evictMatches, type LaunchSpec } from "xyne-claw-mcp-common/protocol";
import type { McpCallResult, McpServiceClient, McpSessionRef } from "xyne-claw-mcp-common/client";

export interface FakeMcpClient {
  listTools(): Promise<{ tools: Array<Record<string, unknown>> }>;
  callTool(request: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export function createFakeMcpService(connect: (launch: LaunchSpec) => Promise<FakeMcpClient>): McpServiceClient {
  const sessions = new Map<string, { serverType: string; fingerprint: string; client: FakeMcpClient }>();
  const starting = new Map<string, Promise<FakeMcpClient>>();

  async function session(ref: McpSessionRef): Promise<FakeMcpClient> {
    const live = sessions.get(ref.key);
    if (live && !(live.fingerprint && ref.fingerprint && live.fingerprint !== ref.fingerprint)) return live.client;
    if (live) {
      sessions.delete(ref.key);
      await live.client.close();
    }
    const pending = starting.get(ref.key);
    if (pending) return pending;
    const start = (async () => {
      const client = await connect(await ref.launch());
      sessions.set(ref.key, { serverType: ref.serverType, fingerprint: ref.fingerprint, client });
      return client;
    })().finally(() => starting.delete(ref.key));
    starting.set(ref.key, start);
    return start;
  }

  return {
    async listTools(ref) {
      const { tools } = await (await session(ref)).listTools();
      return tools.map((t) => ({
        name: String(t["name"]),
        description: typeof t["description"] === "string" ? t["description"] : "",
        inputSchema: (t["inputSchema"] ?? {}) as Record<string, unknown>,
      }));
    },
    async callTool(ref, tool, args, meta) {
      const client = await session(ref);
      return (await client.callTool({ name: tool, arguments: args, ...(meta ? { _meta: meta } : {}) })) as McpCallResult;
    },
    async evict(req) {
      for (const [key, s] of [...sessions]) {
        if (!evictMatches(key, req)) continue;
        sessions.delete(key);
        await s.client.close();
      }
    },
    async restart(serverType) {
      let closed = 0;
      for (const [key, s] of [...sessions]) {
        if (serverType && s.serverType !== serverType) continue;
        sessions.delete(key);
        await s.client.close();
        closed++;
      }
      return closed;
    },
  };
}
