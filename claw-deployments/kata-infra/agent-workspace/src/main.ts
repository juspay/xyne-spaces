import { execSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";

const execAsync = promisify(execCb);
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

const PORT = 8888;
const WORKSPACE_ROOT = "/workspace";
const MAX_COMMAND_BUFFER = 100 * 1024 * 1024;

interface ExecuteRequestBody {
  command?: unknown;
}

interface ExecuteResponseBody {
  stdout: string;
  stderr: string;
  exit_code: number;
}

interface FileEntryResponse {
  name: string;
  size: number;
  type: "file" | "directory";
  mod_time: number;
}

interface ExecSyncErrorLike {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  status?: number | null;
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();

// /write receives whole files as base64 JSON (video-explainer ships per-scene
// mp3 narration and inlined-library HTML); express's default 100kb 413s them.
app.use(express.json({ limit: "50mb" }));

function jsonError(response: Response, status: number, message: string): void {
  response.status(status).json({ message });
}

function isExecSyncErrorLike(value: unknown): value is ExecSyncErrorLike {
  return typeof value === "object" && value !== null;
}

function outputToString(output: string | Buffer | undefined): string {
  if (typeof output === "string") {
    return output;
  }

  if (output instanceof Buffer) {
    return output.toString("utf8");
  }

  return "";
}

function resolveWorkspacePath(requestPath: string): string {
  const normalizedPath = requestPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(WORKSPACE_ROOT, normalizedPath);
  const relativePath = path.relative(WORKSPACE_ROOT, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Access denied: Path must be within /workspace");
  }

  return resolvedPath;
}

async function ensureWithinWorkspace(resolvedPath: string): Promise<string> {
  const workspaceRoot = await realpath(WORKSPACE_ROOT);
  const realResolvedPath = await realpath(resolvedPath);
  const relativePath = path.relative(workspaceRoot, realResolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Access denied: Path must be within /workspace");
  }

  return realResolvedPath;
}

async function resolveExistingWorkspacePath(requestPath: string): Promise<string> {
  return ensureWithinWorkspace(resolveWorkspacePath(requestPath));
}

async function resolveWritableWorkspacePath(requestPath: string): Promise<string> {
  const resolvedPath = resolveWorkspacePath(requestPath);
  const parentDirectory = path.dirname(resolvedPath);
  await mkdir(parentDirectory, { recursive: true });
  await ensureWithinWorkspace(parentDirectory);
  return resolvedPath;
}

function getRoutePath(request: Request): string {
  const wildcardPath = request.params[0];
  if (typeof wildcardPath === "string") {
    return wildcardPath;
  }

  return "";
}

// Sandbox-side service-discovery endpoint. Read by xyne-claw via the
// kata-sdk's session.request('/services') so it can decide which port
// to send X-Sandbox-Port for tools like sandbox-pw__* (browser/CDP) and
// gate on backend/dashboard markers without scraping log files. All disk
// reads are async (node:fs/promises) — never blocks the event loop.
app.get("/services", async (_request, response) => {
  async function read(p: string): Promise<string | null> {
    try {
      return (await readFile(p, "utf8")).trim();
    } catch {
      return null;
    }
  }
  const [
    cdpUp, cdpPort,
    servicesUp, backendUp, dashboardUp,
    prebakeDone,
  ] = await Promise.all([
    read("/tmp/cdp-up"),         // marker; content irrelevant
    read("/tmp/cdp-port"),       // forwarder port (default 9223)
    read("/tmp/services-up"),    // postgres :5433, redis :6379, zero :4848
    read("/tmp/backend-up"),     // backend :3001
    read("/tmp/dashboard-up"),   // dashboard :5173
    read("/tmp/prebake-done"),   // npm ci × 3 + nix build complete
  ]);
  response.json({
    prebakeDone: prebakeDone !== null,
    services:    { up: servicesUp  !== null }, // ports baked into repo-config (5433/6379/4848)
    backend:     { up: backendUp   !== null, port: 3001 },
    dashboard:   { up: dashboardUp !== null, port: 5173 },
    cdp:         { up: cdpUp       !== null, port: cdpPort ? Number(cdpPort) : null },
  });
});

app.get("/", (_request, response) => {
  response.json({ status: "ok", message: "Kata Workspace Agent is active." });
});

app.post("/execute", async (request: Request<unknown, unknown, ExecuteRequestBody>, response: Response<ExecuteResponseBody | { message: string }>) => {
  if (typeof request.body.command !== "string" || request.body.command.trim().length === 0) {
    jsonError(response, 400, "Command must be a non-empty string.");
    return;
  }

  // Async exec — does NOT block the event loop. Previously this used
  // execSync which froze every other HTTP handler for the duration of
  // the command, causing sandbox-router to time out and return 500s
  // ("An unexpected error occurred"). Heavy commands like `npm install`
  // (which trigger cc1plus / native extension builds) made the pod look
  // dead even though it was 1/1 Ready.
  try {
    const { stdout, stderr } = await execAsync(request.body.command, {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
      shell: "/bin/bash",
      maxBuffer: MAX_COMMAND_BUFFER,
    });
    response.json({ stdout: outputToString(stdout), stderr: outputToString(stderr), exit_code: 0 });
  } catch (error: unknown) {
    if (isExecSyncErrorLike(error)) {
      response.json({
        stdout: outputToString(error.stdout),
        stderr: outputToString(error.stderr),
        exit_code: typeof error.status === "number" ? error.status : 1,
      });
      return;
    }
    jsonError(response, 500, "Failed to execute command.");
  }
});

interface Job {
  done: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const jobs = new Map<string, Job>();

app.post("/execute/detached", (request: Request<unknown, unknown, ExecuteRequestBody>, response: Response) => {
  if (typeof request.body.command !== "string" || request.body.command.trim().length === 0) {
    jsonError(response, 400, "Command must be a non-empty string.");
    return;
  }

  const jobId = randomBytes(8).toString("hex");
  const job: Job = { done: false, stdout: "", stderr: "", exitCode: null };
  jobs.set(jobId, job);

  const child = spawn("/bin/bash", ["-c", request.body.command], {
    cwd: WORKSPACE_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => { job.stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { job.stderr += chunk.toString("utf8"); });
  child.on("close", (code) => {
    job.exitCode = code ?? 1;
    job.done = true;
  });

  response.status(202).json({ jobId });
});

app.get("/jobs/:jobId", (request: Request<{ jobId: string }>, response: Response) => {
  const job = jobs.get(request.params.jobId);

  if (!job) {
    jsonError(response, 404, "Job not found.");
    return;
  }

  response.json(job);
});

app.post("/upload", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      jsonError(response, 400, "No file provided.");
      return;
    }

    const targetPath = await resolveWritableWorkspacePath(request.file.originalname);
    await writeFile(targetPath, request.file.buffer);

    response.json({ message: `File '${request.file.originalname}' uploaded successfully.` });
  } catch (error) {
    next(error);
  }
});

app.get("/download", (_request, response) => {
  jsonError(response, 400, "Path is required.");
});

app.get("/download/*", async (request, response, next) => {
  try {
    const targetPath = await resolveExistingWorkspacePath(getRoutePath(request));
    const fileStats = await stat(targetPath);

    if (!fileStats.isFile()) {
      jsonError(response, 404, "File not found.");
      return;
    }

    response.setHeader("Content-Type", "application/octet-stream");
    createReadStream(targetPath).pipe(response);
  } catch (error) {
    next(error);
  }
});

app.get("/list", async (_request, response, next) => {
  try {
    const entries = await readdir(WORKSPACE_ROOT, { withFileTypes: true });
    const result: FileEntryResponse[] = [];

    for (const entry of entries) {
      const entryPath = path.join(WORKSPACE_ROOT, entry.name);
      const entryStats = await stat(entryPath);
      result.push({
        name: entry.name,
        size: entryStats.size,
        type: entry.isDirectory() ? "directory" : "file",
        mod_time: entryStats.mtimeMs / 1000,
      });
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/list/*", async (request, response, next) => {
  try {
    const targetPath = await resolveExistingWorkspacePath(getRoutePath(request));
    const directoryStats = await stat(targetPath);

    if (!directoryStats.isDirectory()) {
      jsonError(response, 404, "Path is not a directory.");
      return;
    }

    const entries = await readdir(targetPath, { withFileTypes: true });
    const result: FileEntryResponse[] = [];

    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name);
      const entryStats = await stat(entryPath);
      result.push({
        name: entry.name,
        size: entryStats.size,
        type: entry.isDirectory() ? "directory" : "file",
        mod_time: entryStats.mtimeMs / 1000,
      });
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/exists", (_request, response) => {
  response.json({ exists: true });
});

interface WriteRequestBody {
  path?: unknown;
  content?: unknown;
  encoding?: unknown;
}

interface ReadResponse {
  content: string;
  encoding: "base64" | "utf8";
}

app.post("/write", async (request: Request<unknown, unknown, WriteRequestBody>, response: Response) => {
  if (typeof request.body.path !== "string" || request.body.path.trim().length === 0) {
    jsonError(response, 400, "path must be a non-empty string.");
    return;
  }
  if (typeof request.body.content !== "string") {
    jsonError(response, 400, "content must be a string.");
    return;
  }

  try {
    const targetPath = request.body.path.trim();
    const encoding = request.body.encoding === "base64" ? "base64" : "utf8";
    const buffer = Buffer.from(request.body.content, encoding);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buffer);
    response.json({ path: targetPath, written: true });
  } catch (error) {
    jsonError(response, 500, error instanceof Error ? error.message : "Failed to write file.");
  }
});

app.get("/read", async (request: Request, response: Response<ReadResponse | { message: string }>, next: NextFunction) => {
  const filePath = typeof request.query["path"] === "string" ? request.query["path"] : undefined;
  if (!filePath || filePath.trim().length === 0) {
    jsonError(response, 400, "path query parameter is required.");
    return;
  }

  try {
    const { readFile: fsReadFile } = await import("node:fs/promises");
    const buffer = await fsReadFile(filePath.trim());
    response.json({ content: buffer.toString("base64"), encoding: "base64" });
  } catch (error) {
    next(error);
  }
});

app.get("/exists/*", async (request, response, next) => {
  try {
    const targetPath = await resolveExistingWorkspacePath(getRoutePath(request));
    await stat(targetPath);
    response.json({ exists: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      response.json({ exists: false });
      return;
    }

    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof Error && error.message.startsWith("Access denied:")) {
    jsonError(response, 403, error.message);
    return;
  }

  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    jsonError(response, 404, "Path not found.");
    return;
  }

  if (error instanceof multer.MulterError) {
    jsonError(response, 400, error.message);
    return;
  }

  if (error instanceof SyntaxError) {
    jsonError(response, 400, "Invalid JSON body.");
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error.";
  jsonError(response, 500, message);
});

await mkdir(WORKSPACE_ROOT, { recursive: true });

app.listen(PORT, () => {
  console.log(`Kata Workspace Agent listening on port ${PORT}`);
});
