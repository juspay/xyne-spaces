import type { ToolDefinition } from "../types.js";

const SOURCE = "custom:local-container";

/**
 * Every container-* description carries this. The container tools and the
 * sandbox-* tools have near-identical names and overlapping jobs, and the model
 * picks wrongly when nothing says which environment it is standing in.
 *
 * container-* = the user's OWN machine, via the desktop app's local harness.
 * sandbox-*   = a server-side Kata/QEMU microVM.
 *
 * They are not interchangeable: only container-* can see the user's local files
 * and only sandbox-* exists on a server run.
 */
/** Returned at runtime when a container-* tool is called on a server run. */
const SERVER_HINT = "Use the sandbox-* tools on server runs.";

const LOCAL_ONLY =
  " Runs on the USER'S OWN MACHINE (desktop app local harness) — it can see their local " +
  "files, and it does not exist on server runs. On a server run use the sandbox-* tools instead.";

export const containerRun: ToolDefinition = {
  slug: "container-run",
  name: "Container Run",
  description:
    "Run a SHORT shell command inside the isolated container; /workspace is your working folder. " +
    "Use for greps, file inspection, small scripts, git status/log. For installs, builds and test " +
    "suites use container-run-detached instead — this call blocks and will time out." + LOCAL_ONLY,
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
  description:
    "Start a LONG command in the background inside the container and get a job id back; poll it with " +
    "container-poll-job. Correct tool for dependency installs, builds and test suites." + LOCAL_ONLY,
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
  description:
    "Create or overwrite a file in the container workspace (workspace-relative path). To SEND a finished " +
    "file to the user afterwards, call deliver-files — writing a file does not deliver it." + LOCAL_ONLY,
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
  description: "Read a file from the container workspace back into your context." + LOCAL_ONLY,
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
  description:
    "Replace exactly one occurrence of oldText with newText in a container workspace file — cheaper than " +
    "rewriting the whole file with container-write-file." + LOCAL_ONLY,
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
