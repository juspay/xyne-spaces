#!/usr/bin/env node

/**
 * Xyne Spaces MCP server.
 *
 * A curated set of tools over the Spaces public API (`/api/sdk`), authenticated
 * with a Spaces session from Xyne SSO — see `src/login.ts`. The API exposes 508
 * catalog operations; this exposes the few dozen an agent actually reaches for,
 * each with an exact schema rather than a generic escape hatch.
 *
 * `xyne-spaces-mcp login` signs in from a terminal instead of starting the server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createSpacesSdk, resolveConfig } from "./config.js";
import { describeError, NotSignedInError } from "./errors.js";
import { pendingLogin } from "./login.js";
import { runLoginCommand } from "./login-command.js";
import { asObject, err } from "./render.js";
import type { ToolContext, ToolDef } from "./tools/shared.js";
import { allTools } from "./tools/index.js";

if (process.argv[2] === "login") {
	process.exit(await runLoginCommand());
}

const config = resolveConfig();
const ctx: ToolContext = { sdk: createSpacesSdk(config), baseUrl: config.baseUrl, config };

/**
 * `XYNE_SPACES_READONLY` removes write tools from the listing rather than
 * refusing them at call time. A tool the model cannot see is a tool it cannot
 * decide to use — cheaper and more reliable than declining afterwards.
 */
const enabledTools = config.readOnly ? allTools.filter((tool) => !tool.write) : allTools;

const byName = new Map(enabledTools.map((tool) => [tool.name, tool] as const));

const listing: Tool[] = enabledTools.map((tool) => ({
	name: tool.name,
	description: tool.description,
	inputSchema: tool.inputSchema as Tool["inputSchema"],
}));

const instructions = [
	"Tools for Xyne Spaces: channels, threads, messages, tickets, and search.",
	"Call spaces_whoami first — other tools take user ids.",
	"Authentication is a Spaces session from Xyne SSO, lasting as long as a Spaces login. If a tool reports you are not signed in or the " +
		"session has expired, call spaces_login and ask the user to approve the link it returns.",
	"A session acts as its user: anything that user cannot see, these tools cannot return.",
	config.readOnly
		? ""
		: "To mention someone in a message, write @Name[userId] with their user id; a bare @Name notifies nobody.",
	config.readOnly ? "This server is in read-only mode; no write tools are available." : "",
]
	.filter(Boolean)
	.join(" ");

const server = new Server(
	{ name: "xyne-spaces-mcp", version: "0.1.0" },
	{ capabilities: { tools: {} }, instructions },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listing }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
	const name = request.params.name;
	const tool = byName.get(name);
	if (!tool) {
		const known = allTools.find((t) => t.name === name);
		if (known && config.readOnly) {
			return err(`${name} writes to Spaces and this server is running in read-only mode. Set XYNE_SPACES_READONLY=0 and restart the server to enable write tools.`) as CallToolResult;
		}
		return err(`Unknown tool: ${name}`) as CallToolResult;
	}

	// Checked here rather than per call: the session and its expiry are known
	// locally, so sending a request would be a round trip to learn something
	// already known — and it would fail this way while offline too.
	if (tool.name !== "spaces_login") {
		const waiting = pendingLogin();
		const session = config.session;
		if (!session || session.expiresAt <= Date.now()) {
			if (waiting) {
				return err(
					`Sign-in is waiting for approval. Ask the user to open ${waiting.link}, check it shows the code ` +
						`${waiting.userCode}, and approve, then retry.`,
				) as CallToolResult;
			}
			const notSignedIn = new NotSignedInError(session ? "expired" : "missing", config.sessionSource === "env");
			return err(describeError(notSignedIn, config.baseUrl)) as CallToolResult;
		}
	}

	try {
		return (await tool.handler(asObject(request.params.arguments), ctx)) as CallToolResult;
	} catch (error) {
		return err(describeError(error, config.baseUrl)) as CallToolResult;
	}
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
