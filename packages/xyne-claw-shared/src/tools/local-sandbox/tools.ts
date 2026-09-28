import type { ToolDefinition } from "../types.js";

const SOURCE = "custom:local-sandbox";

export const deliverFiles: ToolDefinition = {
  slug: "deliver-files",
  name: "Deliver Files",
  description:
    "LOCAL-HARNESS delivery: send finished files from the LOCAL working directory to the user " +
    "(workspace-relative paths). They appear in the workspace panel, and /design and /dashboard also get a " +
    "live share link.\n\n" +
    "Pick the right delivery tool — all three send a file, from different places:\n" +
    "- `deliver-files` (this one) — files on the USER'S machine, desktop app only.\n" +
    "- `sandbox-deliver-files` — files inside the server Kata/QEMU sandbox. Use on any server run.\n" +
    "- `send-attachment` — a file you already hold as bytes in this turn, posted to the channel.",
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
