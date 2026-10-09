import type { ToolDefinition } from "../types.js";

const SOURCE = "custom:local-container";

const SERVER_HINT = "Use the sandbox-* tools on server runs.";

export const containerRun: ToolDefinition = {
  slug: "container-run",
  name: "Container Run",
  description:
    "Run a shell command inside the isolated container; /workspace is your working folder. " +
    "Use for installs, builds, tests and scripts.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to run inside the container." },
      timeoutMs: { type: "number", description: "Optional timeout in milliseconds." },
    },
    required: ["command"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const containerRunDetached: ToolDefinition = {
  slug: "container-run-detached",
  name: "Container Run Detached",
  description: "Start a long command in the background inside the container and get a job id back.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to start in the background." },
    },
    required: ["command"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const containerPollJob: ToolDefinition = {
  slug: "container-poll-job",
  name: "Container Poll Job",
  description:
    "Check a background job started with container-run-detached: running state, exit code and the output tail.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "Job id returned by container-run-detached." },
    },
    required: ["jobId"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const containerWriteFile: ToolDefinition = {
  slug: "container-write-file",
  name: "Container Write File",
  description: "Create or overwrite a file in the workspace (workspace-relative path).",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path of the file to write." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const containerReadFile: ToolDefinition = {
  slug: "container-read-file",
  name: "Container Read File",
  description: "Read a workspace file.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path of the file to read." },
    },
    required: ["path"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const containerEditFile: ToolDefinition = {
  slug: "container-edit-file",
  name: "Container Edit File",
  description: "Replace exactly one occurrence of oldText with newText in a workspace file.",
  source: SOURCE,
  harness: "local",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path of the file to edit." },
      oldText: { type: "string", description: "Exact text to replace; must occur exactly once." },
      newText: { type: "string", description: "Replacement text." },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute() {
    return SERVER_HINT;
  },
};

export const LOCAL_CONTAINER_TOOLS: ToolDefinition[] = [
  containerRun,
  containerRunDetached,
  containerPollJob,
  containerWriteFile,
  containerReadFile,
  containerEditFile,
];
