import type { ToolDefinition } from "../types.js";
import { SANDBOX_PW_TOOLS } from "../sandbox-pw/tools.js";

const navigate = SANDBOX_PW_TOOLS.find((tool) => tool.slug === "sandbox-pw-navigate");

export const openUrl: ToolDefinition = {
  slug: "open-url",
  name: "Open URL",
  description:
    "Open a web page for the user. On the Xyne AI screen this shows the page in the workspace panel beside the chat; " +
    "on a server run it opens the page in the sandbox browser and returns the page snapshot so you can keep working with it. " +
    "Use it when the user asks to open, launch, visit, or go to a specific page or link. Pass the absolute http(s) URL in `url`.",
  source: "custom:open-url",
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL to open, e.g. https://www.google.com" },
      title: { type: "string", description: "Optional short label for the link." },
    },
    required: ["url"],
  },
  async execute(params, context) {
    const url = typeof params["url"] === "string" ? params["url"].trim() : "";
    if (!/^https?:\/\//i.test(url)) {
      return "Error: url must be an absolute http(s) URL (starting with http:// or https://).";
    }
    if (!navigate) return `Error: the sandbox browser is not available, so ${url} could not be opened.`;
    const result = await navigate.execute({ url }, context);
    if (result.startsWith("Error")) return result;
    return `Opened ${url} in the sandbox browser.\n${result}`;
  },
};
