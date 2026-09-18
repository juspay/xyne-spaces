import type { ToolDefinition } from "../types.js";

const SOURCE = "custom:local-sessions";

const ONLY_ON_DESKTOP =
  " Only works on the Xyne desktop app: it reads the CLI history stored on the user's own machine, never on a server.";

export const listCliSessions: ToolDefinition = {
  slug: "list-cli-sessions",
  name: "List CLI Sessions",
  description:
    "List the user's recent Codex and Claude Code CLI sessions from this machine, newest first, with a provider, an id, " +
    "the working directory and the opening message. Use it when the user asks to pull, find, continue or look at work " +
    "they did in the terminal. Show the list and let them pick one; do not load a session without being asked." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["codex", "claude", "all"],
        description: "Which CLI to list. Defaults to all.",
      },
      limit: { type: "integer", description: "How many sessions to return (1-50, default 15)." },
      match: {
        type: "string",
        description: "Only list sessions whose opening message or working directory contains this text.",
      },
    },
    required: [],
  },
  async execute() {
    return "Error: list-cli-sessions only runs on the Xyne desktop app.";
  },
};

export const loadCliSession: ToolDefinition = {
  slug: "load-cli-session",
  name: "Load CLI Session",
  description:
    "Load one CLI session by its id and return its transcript, so the conversation that happened in the terminal becomes " +
    "part of this conversation's context. Call it after the user picks a session from list-cli-sessions. Long sessions " +
    "are trimmed to the most recent turns." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "The session id from list-cli-sessions." },
    },
    required: ["sessionId"],
  },
  async execute() {
    return "Error: load-cli-session only runs on the Xyne desktop app.";
  },
};

export const LOCAL_SESSION_TOOLS: ToolDefinition[] = [listCliSessions, loadCliSession];
