import type { ToolDefinition } from "../types.js";

const SOURCE = "custom:local-sandbox";

export const deliverFiles: ToolDefinition = {
  slug: "deliver-files",
  name: "Deliver Files",
  description:
    "Deliver finished files from your working directory to the user: pass workspace-relative paths. " +
    "The user sees them in the workspace panel and, for /design and /dashboard, gets a live share link.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Workspace-relative paths of the files to deliver.",
      },
    },
    required: ["paths"],
  },
  async execute() {
    return "Use sandbox-deliver-files on server runs.";
  },
};

export const pageOpenFile: ToolDefinition = {
  slug: "page-open-file",
  name: "Page Open File",
  description:
    "Open an HTML file from your working directory in the workspace panel beside the chat so you can inspect it with " +
    "page-read/page-snapshot. Pass a workspace-relative path.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path of the HTML file to open." },
    },
    required: ["path"],
  },
  async execute() {
    return "Use sandbox-pw-navigate on server runs.";
  },
};

export const LOCAL_SANDBOX_TOOLS: ToolDefinition[] = [deliverFiles, pageOpenFile];
