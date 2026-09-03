#!/usr/bin/env node

/**
 * Xyne Spaces MCP server.
 *
 * A curated set of tools over the Spaces public API (`/api/sdk`), authenticated
 * with the same `xyne_sk_` API key `@xyne/spaces-sdk` uses. The API exposes 508
 * catalog operations; this exposes the few dozen an agent actually reaches for,
 * each with an exact schema rather than a generic escape hatch.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createSpacesSdk, KEY_SOURCE, resolveConfig } from "./config.js";
import { describeError, MissingApiKeyError } from "./errors.js";
import { asObject, err } from "./render.js";
import type { ToolContext, ToolDef } from "./tools/shared.js";
import { allTools } from "./tools/index.js";

const config = resolveConfig();
const ctx: ToolContext = { sdk: createSpacesSdk(config), baseUrl: config.baseUrl };

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
	"Call spaces_whoami first — other tools take user ids, and an API key carries no readable claims.",
	`Authentication is a xyne_sk_ API key in XYNE_SPACES_API_KEY, minted in ${KEY_SOURCE}.`,
	"A key acts as its user: anything that user cannot see, these tools cannot return.",
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
			return err(`${name} writes to Spaces and this server is running in read-only mode (XYNE_SPACES_READONLY).`) as CallToolResult;
		}
		return err(`Unknown tool: ${name}`) as CallToolResult;
	}

	// Checked here rather than per call: the SDK would omit the Authorization
	// header and let the server answer 401, which is a round trip to learn
	// something already known — and it would fail this way while offline too.
	if (!config.apiKey) {
		return err(describeError(new MissingApiKeyError(), config.baseUrl)) as CallToolResult;
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
