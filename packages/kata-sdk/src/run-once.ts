import type { KataClient } from "./client.js";
import type { Session } from "./session.js";

/** A file written into the sandbox before the command runs. */
export interface RunOnceFile {
  /** Absolute path inside the sandbox, e.g. "/mnt/files/report.pdf". */
  path: string;
  content: Buffer | string;
}

export interface RunOnceOptions {
  /** Shell command, run with `bash -c` once the files are in place. */
  command: string;
  files?: RunOnceFile[];
  /** Wall-clock limit for the command, enforced inside the sandbox with `timeout`. Default 60s. */
  timeoutMs?: number;
  /** Directory the command starts in. Default: the sandbox user's $HOME. */
  workDir?: string;
  /** Files new or modified under this directory during the run are returned. Unset: none. */
  outputDir?: string;
  /** Output files larger than this are listed in `skippedOutputFiles` instead. Default 25 MiB. */
  maxOutputFileBytes?: number;
  /** Stop reading output files once this many bytes have been collected. Default 40 MiB. */
  maxOutputTotalBytes?: number;
  /** SandboxTemplate; defaults to the client's. */
  template?: string;
  namespace?: string;
  /** Time to get a ready sandbox (claim bound, pod running, agent answering). Default 120s. */
  readyTimeoutMs?: number;
}

export interface RunOnceOutputFile {
  path: string;
  size: number;
  content: Buffer;
}

export interface RunOnceResult {
  stdout: string;
  stderr: string;
  /** -1 when the job never reported one. */
  exitCode: number;
  /** The command hit `timeoutMs` and was killed. */
  timedOut: boolean;
  /** Time the command ran, excluding sandbox start-up and file transfer. */
  durationMs: number;
  outputFiles: RunOnceOutputFile[];
  /** Output files not returned because of the size limits. */
  skippedOutputFiles: { path: string; size: number }[];
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_TOTAL_BYTES = 40 * 1024 * 1024;
/** Past the command's own timeout: the `timeout -k` kill grace plus the final poll. */
const KILL_GRACE_MS = 15_000;
/** Past everything else, so the claim's shutdownTime never cuts a run short. */
const LIFETIME_SLACK_MS = 5 * 60 * 1000;
const JOB_POLL_MS = 500;
const HOUSEKEEPING_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Single-quote for bash: 'it'\''s' style. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface ListedFile {
  path: string;
  mtime: number;
  size: number;
}

async function listFiles(session: Session, dir: string): Promise<ListedFile[]> {
  const { stdout } = await session.commands.run(
    `find ${shellQuote(dir)} -type f -printf '%T@\\t%s\\t%p\\n' 2>/dev/null || true`,
    HOUSEKEEPING_TIMEOUT_MS,
  );
  return stdout.split("\n").flatMap((line) => {
    const [mtime, size, ...rest] = line.split("\t");
    const path = rest.join("\t");
    return path ? [{ path, mtime: Number(mtime) || 0, size: Number(size) || 0 }] : [];
  });
}

/**
 * Run one command in a fresh sandbox and tear it down: create → write files → run → collect
 * output files → destroy. Nothing outlives the call, so the caller never holds a sandbox handle.
 *
 * The command runs as a detached job polled through the router, so it can outlast the router's
 * proxy timeout. The sandbox is destroyed whatever happens, and its claim's shutdownTime is a
 * backstop if this process dies mid-run.
 *
 * Create the client with `minCreateSpacingMs: 0` for templates that don't clone a snapshot.
 */
export async function runOnce(client: KataClient, options: RunOnceOptions): Promise<RunOnceResult> {
  if (options.command.trim().length === 0) throw new Error("command must be a non-empty string.");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

  const session = await client.createSession({
    ...(options.template !== undefined && { template: options.template }),
    ...(options.namespace !== undefined && { namespace: options.namespace }),
    readyTimeoutMs,
    timeoutMs: readyTimeoutMs + timeoutMs + KILL_GRACE_MS + LIFETIME_SLACK_MS,
  });

  try {
    await session.waitUntilReady(readyTimeoutMs);

    for (const file of options.files ?? []) {
      await session.files.write(file.path, file.content);
    }

    const before = options.outputDir
      ? new Map((await listFiles(session, options.outputDir)).map((f) => [f.path, f.mtime]))
      : undefined;

    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const cd = options.workDir ? `cd ${shellQuote(options.workDir)}` : `cd "$HOME" 2>/dev/null || cd /workspace`;
    const startedAt = Date.now();
    const jobId = await session.commands.runDetached(
      `${cd}; timeout -k 5 ${String(secs)} bash -c ${shellQuote(options.command)}`,
    );

    const deadline = startedAt + timeoutMs + KILL_GRACE_MS;
    let run: Pick<RunOnceResult, "stdout" | "stderr" | "exitCode" | "timedOut"> | undefined;
    while (!run && Date.now() < deadline) {
      const job = await session.commands.pollJob(jobId);
      if (job.done) {
        const exitCode = job.exitCode ?? -1;
        // GNU timeout: 124 on TERM, 137 when -k had to SIGKILL.
        run = { stdout: job.stdout, stderr: job.stderr, exitCode, timedOut: exitCode === 124 || exitCode === 137 };
      } else {
        await sleep(JOB_POLL_MS);
      }
    }
    run ??= { stdout: "", stderr: "", exitCode: -1, timedOut: true };
    const durationMs = Date.now() - startedAt;

    const outputFiles: RunOnceOutputFile[] = [];
    const skippedOutputFiles: { path: string; size: number }[] = [];
    if (options.outputDir && before) {
      const maxFile = options.maxOutputFileBytes ?? DEFAULT_MAX_OUTPUT_FILE_BYTES;
      const maxTotal = options.maxOutputTotalBytes ?? DEFAULT_MAX_OUTPUT_TOTAL_BYTES;
      let total = 0;
      for (const f of await listFiles(session, options.outputDir)) {
        const prev = before.get(f.path);
        if (prev !== undefined && !(f.mtime > prev)) continue;
        if (f.size <= 0) continue;
        if (f.size > maxFile || total + f.size > maxTotal) {
          skippedOutputFiles.push({ path: f.path, size: f.size });
          continue;
        }
        const content = await session.files.read(f.path);
        total += content.byteLength;
        outputFiles.push({ path: f.path, size: content.byteLength, content });
      }
    }

    return { ...run, durationMs, outputFiles, skippedOutputFiles };
  } finally {
    // Best effort: the claim's shutdownTime reclaims it if this fails.
    await session.destroy().catch(() => {});
  }
}
