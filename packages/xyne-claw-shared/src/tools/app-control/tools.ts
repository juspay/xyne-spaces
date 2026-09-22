import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { clawAuthUrl } from "../claw-auth-url.js";

const SOURCE = "custom:app-control";

const SURFACE_TIMEOUT_MS = 20_000;

async function viaSurface(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<string> {
  const userId = context?.meta?.["userId"] ?? "";
  if (!userId) {
    return "Error: this run has no user, so there is no Xyne window to reach.";
  }
  const authUrl = clawAuthUrl();

  try {
    const res = await fetch(`${authUrl}/claw/api/v1/internal/surface/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(context?.s2sKey ? { "x-s2s-key": context.s2sKey } : {}),
      },
      body: JSON.stringify({
        userId,
        sessionId: context?.sessionId ?? null,
        toolName,
        params,
      }),
      signal: AbortSignal.timeout(SURFACE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return `Error: the Xyne app could not be reached (status ${res.status}).`;
    }
    const body = (await res.json()) as {
      data?: { ok?: boolean; content?: string; image?: { data: string; mimeType: string } };
    };
    const result = body.data;
    if (!result) return "Error: the Xyne app returned nothing.";
    if (result.image?.data) {
      return `${result.content ?? ""}\n\ndata:${result.image.mimeType};base64,${result.image.data}`;
    }
    return result.content ?? "";
  } catch (err) {
    return `Error: reaching the Xyne app failed — ${err instanceof Error ? err.message : String(err)}`;
  }
}

const DESKTOP_ONLY =
  " Only works on the Xyne desktop app: it drives the window the user is looking at.";

const COURTESY =
  " The user is working in this window, so move their view only when they asked for it or you told them you were about to.";

export const appNavigate: ToolDefinition = {
  slug: "app-navigate",
  name: "App Navigate",
  description:
    "Open a screen in the Xyne app: a new chat, an AI conversation, a direct message, a channel, a ticket, a canvas, " +
    "knowledge, agents or settings. Direct messages and channels both take a CHANNEL id — resolve a person's name to " +
    "their DM channel with spaces-channels first, and use target \"dm\" for it. Prefer this over clicking through the " +
    "interface: it asks for an outcome instead of a button." +
    DESKTOP_ONLY +
    COURTESY,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        enum: ["new-chat", "conversation", "dm", "channel", "ticket", "canvas", "knowledge", "agents", "settings"],
        description: "Which screen to open.",
      },
      id: {
        type: "string",
        description:
          "The id of the AI conversation, DM channel, channel, ticket or canvas. Not needed for the other targets.",
      },
    },
    required: ["target"],
  },
  execute: (params, context) => viaSurface("app-navigate", params, context),
};

export const appDescribe: ToolDefinition = {
  slug: "app-describe",
  name: "App Describe",
  description:
    "Read what is currently on screen in the Xyne app: the route, the title and the visible text. Use it to answer " +
    "questions about what the user is looking at." +
    DESKTOP_ONLY,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  execute: (params, context) => viaSurface("app-describe", params, context),
};

export const appSnapshot: ToolDefinition = {
  slug: "app-snapshot",
  name: "App Snapshot",
  description:
    "List the interactive elements of the Xyne app screen with refs like a12, so you can click or type into one. Take a " +
    "fresh snapshot after anything that changes the screen; refs go stale." +
    DESKTOP_ONLY,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  execute: (params, context) => viaSurface("app-snapshot", params, context),
};

export const appClick: ToolDefinition = {
  slug: "app-click",
  name: "App Click",
  description:
    "Click one element in the Xyne app by its ref from app-snapshot. Use app-navigate for anything that is simply going " +
    "to a screen. Never click something whose label suggests it deletes, removes, revokes, pays or sends, unless the user " +
    "asked for that exact action in this conversation." +
    DESKTOP_ONLY +
    COURTESY,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string", description: "Element ref from app-snapshot, e.g. a12." } },
    required: ["ref"],
  },
  execute: (params, context) => viaSurface("app-click", params, context),
};

export const appType: ToolDefinition = {
  slug: "app-type",
  name: "App Type",
  description:
    "Type text into a field in the Xyne app by its ref from app-snapshot. It fills the field; it does not submit." +
    DESKTOP_ONLY +
    COURTESY,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Field ref from app-snapshot." },
      text: { type: "string", description: "The text to put in the field." },
    },
    required: ["ref", "text"],
  },
  execute: (params, context) => viaSurface("app-type", params, context),
};

export const appScreenshot: ToolDefinition = {
  slug: "app-screenshot",
  name: "App Screenshot",
  description:
    "Capture what the Xyne app window looks like right now. Use it when the question is about appearance or layout " +
    "rather than content, which app-describe answers more cheaply." +
    DESKTOP_ONLY,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  execute: (params, context) => viaSurface("app-screenshot", params, context),
};

export const APP_CONTROL_TOOLS: ToolDefinition[] = [
  appNavigate,
  appDescribe,
  appSnapshot,
  appClick,
  appType,
  appScreenshot,
];
