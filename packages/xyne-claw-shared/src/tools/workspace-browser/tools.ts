import type { ToolDefinition, ToolExecutionContext } from "../types.js";
import { SANDBOX_PW_TOOLS } from "../sandbox-pw/tools.js";
import { requestSurfaceCall, surfaceResultText } from "../surface-call.js";

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

async function viaDesktop(
  slug: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): Promise<string | null> {
  if (!context?.sessionId || !context.meta?.["userId"]) return null;
  const outcome = await requestSurfaceCall(slug, params, context);
  if ("error" in outcome || outcome.result.unavailable) return null;
  return surfaceResultText(outcome.result, slug);
}

const ONLY_ON_DESKTOP =
  " On the Xyne desktop app this acts on the page shown in the workspace panel beside the chat — or, given `tab`, on that tab's page; on a server run it acts on the sandbox browser.";

/** Which of the workspace panel's tabs a page tool acts in; the shown one without it. */
const TAB = {
  tab: {
    type: "string",
    description:
      "Desktop app only: the id of the workspace panel tab to act in, as page-tabs lists it. Defaults to the tab the user sees.",
  },
};

export const pageTabs: ToolDefinition = {
  slug: "page-tabs",
  name: "Page Tabs",
  description:
    "List the tabs open in the workspace panel beside the chat: each tab's id, title and URL, and which one the user sees. " +
    "Every tab stays loaded, so pass a tab's id as `tab` to the other page tools to work in it instead of opening its page again. " +
    "On a server run there is one tab, the sandbox browser's.",
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: {}, required: [] },
  async execute(params, context) {
    const desktop = await viaDesktop("page-tabs", params, context);
    if (desktop !== null) return desktop;
    return viaSandbox(
      "sandbox-pw-evaluate",
      { function: "() => `One tab, shown: ${document.title || '(untitled)'} — ${location.href}`" },
      context,
    );
  },
};

export const pageRead: ToolDefinition = {
  slug: "page-read",
  name: "Page Read",
  description:
    "Read the page that is currently open: returns its title, URL and visible text. Use it to explain, summarise or answer questions about the open page." +
    ONLY_ON_DESKTOP,
  source: SOURCE,
  harness: "local",
  inputSchema: { type: "object", properties: { ...TAB }, required: [] },
  async execute(params, context) {
    const desktop = await viaDesktop("page-read", params, context);
    if (desktop !== null) return desktop;
    // Server-side fallback only — the desktop path runs READ_SCRIPT in the
    // webview (dashboard executePageTool). This used to call
    // `sandbox-pw-snapshot`, which returns the ARIA element tree, so a
    // page-read on the fallback path silently answered with element refs
    // instead of the page's title/URL/text this tool promises.
    return viaSandbox(
      "sandbox-pw-evaluate",
      {
        function:
          "() => ({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })",
      },
      context,
    );
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
  inputSchema: { type: "object", properties: { ...TAB }, required: [] },
  async execute(params, context) {
    const desktop = await viaDesktop("page-snapshot", params, context);
    if (desktop !== null) return desktop;
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
    properties: { url: { type: "string", description: "Absolute http(s) URL to load." }, ...TAB },
    required: ["url"],
  },
  async execute(params, context) {
    const desktop = await viaDesktop("page-navigate", params, context);
    if (desktop !== null) return desktop;
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
    properties: { ref: { type: "string", description: "Element ref from the latest page-snapshot, e.g. e12." }, ...TAB },
    required: ["ref"],
  },
  async execute(params, context) {
    const desktop = await viaDesktop("page-click", params, context);
    if (desktop !== null) return desktop;
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
      ...TAB,
    },
    required: ["ref", "text"],
  },
  async execute(params, context) {
    const desktop = await viaDesktop("page-type", params, context);
    if (desktop !== null) return desktop;
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
    properties: { key: { type: "string", description: "Key name to press." }, ...TAB },
    required: ["key"],
  },
  async execute(params, context) {
    const desktop = await viaDesktop("page-press", params, context);
    if (desktop !== null) return desktop;
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
  inputSchema: { type: "object", properties: { ...TAB }, required: [] },
  async execute(params, context) {
    const desktop = await viaDesktop("page-screenshot", params, context);
    if (desktop !== null) return desktop;
    return viaSandbox("sandbox-pw-screenshot", {}, context);
  },
};

export const WORKSPACE_BROWSER_TOOLS: ToolDefinition[] = [pageTabs, pageRead, pageSnapshot, pageNavigate, pageClick, pageType, pagePress, pageScreenshot];
