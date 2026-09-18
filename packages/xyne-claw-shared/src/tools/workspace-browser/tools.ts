import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { SANDBOX_PW_TOOLS } from "../sandbox-pw/tools.js";

const SOURCE = "custom:workspace-browser";

function sandboxTool(slug: string): ToolDefinition | undefined {
  return SANDBOX_PW_TOOLS.find((tool) => tool.slug === slug);
}

async function viaSandbox(
  slug: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<string> {
  const tool = sandboxTool(slug);
  if (!tool) return `Error: the sandbox browser is not available for ${slug}.`;
  return tool.execute(params, context);
}

const ONLY_ON_DESKTOP =
  " On the Xyne desktop app this acts on the page shown in the workspace panel beside the chat; on a server run it acts on the sandbox browser.";

export const pageRead: ToolDefinition = {
  slug: "page-read",
  name: "Page Read",
  description:
    "Read the page that is currently open: returns its title, URL and visible text. Use it to explain, summarise or answer questions about the open page." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute(_params, context) {
    return viaSandbox("sandbox-pw-snapshot", {}, context);
  },
};

export const pageSnapshot: ToolDefinition = {
  slug: "page-snapshot",
  name: "Page Snapshot",
  description:
    "List the interactive elements (links, buttons, inputs) of the open page with refs like e12. Take a snapshot before page-click or page-type so you have a valid ref." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute(_params, context) {
    return viaSandbox("sandbox-pw-snapshot", {}, context);
  },
};

export const pageNavigate: ToolDefinition = {
  slug: "page-navigate",
  name: "Page Navigate",
  description: "Navigate the open page to another URL and wait for it to load." + ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", description: "Absolute http(s) URL to load." } },
    required: ["url"],
  },
  async execute(params, context) {
    return viaSandbox("sandbox-pw-navigate", { url: params["url"] }, context);
  },
};

export const pageClick: ToolDefinition = {
  slug: "page-click",
  name: "Page Click",
  description: "Click an element on the open page by the ref returned from page-snapshot." + ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: { ref: { type: "string", description: "Element ref from the latest page-snapshot, e.g. e12." } },
    required: ["ref"],
  },
  async execute(params, context) {
    return viaSandbox("sandbox-pw-click", { element: String(params["ref"] ?? ""), ref: params["ref"] }, context);
  },
};

export const pageType: ToolDefinition = {
  slug: "page-type",
  name: "Page Type",
  description: "Type text into an input on the open page by ref, optionally pressing Enter afterwards." + ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from the latest page-snapshot." },
      text: { type: "string", description: "Text to type." },
      submit: { type: "boolean", description: "Press Enter after typing. Default false." },
    },
    required: ["ref", "text"],
  },
  async execute(params, context) {
    return viaSandbox(
      "sandbox-pw-type",
      { element: String(params["ref"] ?? ""), ref: params["ref"], text: params["text"], submit: params["submit"] === true },
      context,
    );
  },
};

export const pagePress: ToolDefinition = {
  slug: "page-press",
  name: "Page Press Key",
  description: "Press a keyboard key on the open page, e.g. Enter, Tab, Escape or ArrowDown." + ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: { key: { type: "string", description: "Key name to press." } },
    required: ["key"],
  },
  async execute(params, context) {
    return viaSandbox("sandbox-pw-press-key", { key: params["key"] }, context);
  },
};

export const pageScreenshot: ToolDefinition = {
  slug: "page-screenshot",
  name: "Page Screenshot",
  description:
    "Take a screenshot of the open page and look at it. Use it to check layout, colours and visual bugs that text cannot show." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute(_params, context) {
    return viaSandbox("sandbox-pw-screenshot", {}, context);
  },
};

export const WORKSPACE_BROWSER_TOOLS: ToolDefinition[] = [pageRead, pageSnapshot, pageNavigate, pageClick, pageType, pagePress, pageScreenshot];
