/**
 * `xyne-spaces-mcp writes [on|off]` — let agents use the write tools, or not.
 *
 * Sets `writes` in `~/.xyne/agent/spaces.json`, which every server on this
 * computer reads, so one command covers every client. Running servers pick it
 * up without a restart. With no argument, prints the current setting.
 *
 * Deliberately a command and never a tool: an agent that could switch on its
 * own writes could be talked into it by text it reads in a message or ticket.
 */

import { resolveWrites, saveWrites } from "./config.js";

const ENV_NOTE =
	"Note: XYNE_SPACES_READONLY is set in this shell, which overrides the file here. A client that sets it in its " +
	"own MCP config is likewise unaffected by this command.";

/** Run the command; resolves with the process exit code. */
export function runWritesCommand(arg: string | undefined): number {
	const choice = arg?.trim().toLowerCase();

	if (choice === undefined || choice === "") {
		const { enabled, source } = resolveWrites();
		console.log(`Writes are ${enabled ? "on" : "off"}${source === "env" ? " (set by XYNE_SPACES_READONLY)" : ""}.`);
		console.log(
			enabled
				? "Agents can send messages, create threads and update tickets. Turn off with `npx -y @xyne/spaces-mcp writes off`."
				: "Agents can only read. Turn on with `npx -y @xyne/spaces-mcp writes on`.",
		);
		return 0;
	}

	if (choice !== "on" && choice !== "off") {
		console.error("Usage: xyne-spaces-mcp writes [on|off]");
		return 1;
	}

	const enabled = choice === "on";
	const path = saveWrites(enabled);
	console.log(
		enabled
			? "Writes are on. Agents can now send messages, create threads and update tickets as you; other people see what they write."
			: "Writes are off. Agents can only read.",
	);
	console.log(`Saved to ${path}. Running servers pick this up without a restart.`);
	if (resolveWrites().source === "env") console.log(ENV_NOTE);
	return 0;
}

