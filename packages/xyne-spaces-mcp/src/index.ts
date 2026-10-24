#!/usr/bin/env node

/**
 * Xyne Spaces MCP server.
 *
 * A curated set of tools over the Spaces public API (`/api/sdk`), authenticated
 * with a Spaces session from Xyne SSO — see `src/login.ts`. The API exposes 508
 * catalog operations; this exposes the few dozen an agent actually reaches for,
 * each with an exact schema rather than a generic escape hatch.
 *
 * `xyne-spaces-mcp login` signs in from a terminal instead of starting the server,
 * and `xyne-spaces-mcp writes [on|off]` turns the write tools on or off.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createSpacesSdk, isSessionUsable, loadSavedSession, resolveConfig, resolveWrites } from "./config.js";
import { describeError, NotSignedInError } from "./errors.js";
import { pendingLogin } from "./login.js";
import { runLoginCommand } from "./login-command.js";
import { watchSharedConfig } from "./watch.js";
import { runWritesCommand } from "./writes-command.js";
import { asObject, err } from "./render.js";
import { dropSession, useSession } from "./tools/login.js";
import type { ToolContext, ToolDef } from "./tools/shared.js";
import { allTools } from "./tools/index.js";

if (process.argv[2] === "login") {
	process.exit(await runLoginCommand());
}

if (process.argv[2] === "writes") {
	process.exit(runWritesCommand(process.argv[3]));
}

const config = resolveConfig();
const ctx: ToolContext = { sdk: createSpacesSdk(config), baseUrl: config.baseUrl, config };

const byName = new Map(allTools.map((tool) => [tool.name, tool] as const));

/**
 * The tools an agent may see right now. Write tools are left out unless writes
 * are on, rather than refused at call time: a tool the model cannot see is a
 * tool it cannot decide to use. Worked out per request, since the setting can
 * change while the server runs.
 */
function listTools(writes: boolean): Tool[] {
	return allTools
		.filter((tool) => writes || !tool.write)
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema as Tool["inputSchema"],
		}));
}

/** Why a write tool was refused, and how the person turns writes on. */
function writesOffMessage(name: string, source: "env" | "file"): string {
	return source === "env"
		? `${name} writes to Spaces, and this client keeps the server read-only with XYNE_SPACES_READONLY in its MCP ` +
				"config. Set it to 0 there, or remove it, and restart the client."
		: `${name} writes to Spaces, and writes are turned off. Ask the user to run \`npx -y @xyne/spaces-mcp writes on\` ` +
				"in a terminal; this server picks it up without a restart.";
}

// Sent once, when a client connects, so it holds for either writes setting.
const instructions = [
	"Tools for Xyne Spaces: channels, threads, messages, tickets, and search.",
	"Call spaces_whoami first — other tools take user ids.",
	"Authentication is a Spaces session from Xyne SSO, lasting as long as a Spaces login. If a tool reports you are not signed in or the " +
		"session has expired, call spaces_login and ask the user to approve the link it returns.",
	"A session acts as its user: anything that user cannot see, these tools cannot return.",
	"Write tools (sending messages, updating tickets) are listed only while the user has turned writes on; they can " +
		"do so with `npx -y @xyne/spaces-mcp writes on`. You cannot turn them on yourself.",
	"To mention someone in a message, write @Name[userId] with their user id; a bare @Name notifies nobody.",
].join(" ");

const server = new Server(
	{ name: "xyne-spaces-mcp", version: "0.2.0" },
	{ capabilities: { tools: { listChanged: true } }, instructions },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools(resolveWrites().enabled) }));

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
	const name = request.params.name;
	const tool = byName.get(name);
	if (!tool) {
		return err(`Unknown tool: ${name}`) as CallToolResult;
	}

	// Checked again here: a client may still hold a list from before writes
	// were turned off.
	if (tool.write) {
		const writes = resolveWrites();
		if (!writes.enabled) return err(writesOffMessage(name, writes.source)) as CallToolResult;
	}

	// Checked here rather than per call: the session and its expiry are known
	// locally, so sending a request would be a round trip to learn something
	// already known — and it would fail this way while offline too. An expired
	// cookie that can still be renewed passes: the SDK renews it first.
	if (tool.name !== "spaces_login") {
		const waiting = pendingLogin();
		// Another process may have signed in, or renewed, since this one started
		if (config.sessionSource !== "env" && !(config.session && isSessionUsable(config.session))) {
			const saved = loadSavedSession();
			if (saved && isSessionUsable(saved)) useSession(ctx, saved);
		}
		const session = config.session;
		if (!session || !isSessionUsable(session)) {
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

// `spaces.json` is shared by every server on this computer and changed from
// outside: `writes on|off`, a sign-in from another client or the desktop app.
// Follow it so those take effect here without a restart.
let writesListed = resolveWrites().enabled;
watchSharedConfig(({ writes, session, signedOut }) => {
	if (writes !== writesListed) {
		writesListed = writes;
		void server.sendToolListChanged().catch(() => {});
	}
	if (config.sessionSource !== "env") {
		if (signedOut) {
			if (config.session) dropSession(ctx);
		} else if (session && isSessionUsable(session) && session.cookie.value !== config.session?.cookie.value) {
			useSession(ctx, session);
		}
	}
});

process.on("SIGINT", async () => {
	await server.close();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await server.close();
	process.exit(0);
});
