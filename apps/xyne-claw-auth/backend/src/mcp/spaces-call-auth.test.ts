import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { applySpacesCallAuth, spacesCallAuthMeta } from "./spaces-call-auth.js";
it("carries the per-call token through a real MCP client and server", async () => {
  const env: NodeJS.ProcessEnv = { XYNE_SPACES_TOKEN: "old" };
  const server = new Server({ name: "s", version: "0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    applySpacesCallAuth(req.params._meta, env);
    return { content: [{ type: "text", text: env["XYNE_SPACES_TOKEN"] ?? "" }] };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "c", version: "0" });
  await client.connect(a);
  const res = await client.callTool({ name: "x", arguments: {}, _meta: spacesCallAuthMeta({ token: "new", sessionId: "s" }) });
  expect((res.content as Array<{ text: string }>)[0]?.text).toBe("new");
  expect(env["XYNE_SPACES_SESSION_ID"]).toBe("s");
});
