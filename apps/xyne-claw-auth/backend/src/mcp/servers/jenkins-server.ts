/**
 * Jenkins MCP server — standalone process spawned by the jenkins adapter.
 * Same skeleton as xyne-dashboard-server; serves the Jenkins CI toolset
 * (see jenkins-tools.ts).
 *
 * Reads JENKINS_BASE_URL, JENKINS_JOB_PATH, JENKINS_USERNAME and
 * JENKINS_API_TOKEN from environment variables (injected per-connection by the
 * adapter). USERNAME + API_TOKEN are mandatory; BASE_URL / JOB_PATH fall back to
 * the standard xyne-spaces job path when omitted.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, type JenkinsConfig } from "./jenkins-tools.js";

const username = process.env["JENKINS_USERNAME"];
const apiToken = process.env["JENKINS_API_TOKEN"];

if (!username || !apiToken) {
  process.stderr.write(
    "jenkins-server: JENKINS_USERNAME and JENKINS_API_TOKEN must be set\n",
  );
  process.exit(1);
}

const config: JenkinsConfig = {
  baseUrl: (process.env["JENKINS_BASE_URL"] || "").replace(/\/+$/, ""),
  jobPath: process.env["JENKINS_JOB_PATH"] || "/job/xyne/job/xyne-spaces",
  username,
  apiToken,
};

const server = new Server(
  { name: "jenkins", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  return tool.handler(args ?? {}, { config });
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
