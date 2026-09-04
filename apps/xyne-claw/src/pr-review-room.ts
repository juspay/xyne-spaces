import { createHash, randomUUID } from "node:crypto";
import { posix } from "node:path";

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSandboxStoreKey, getSandboxSession } from "xyne-claw-shared";

import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { deleteSession, getLiveSession, snapshotLiveSessionHandle, type LiveSessionHandle } from "./session-store.js";
import {
  buildSubmitResultInstruction,
  buildSubmitResultTool,
  type OutputFormatConfig,
  type StructuredOutputRef,
} from "./agent-model-settings.js";
import {
  collectPrEvidence,
  evidenceForPrompt,
  type GitRunner,
  type GitRunResult,
  type PrEvidence,
} from "./pr-evidence.js";
import { coerceFindings, REVIEW_FINDINGS_JSON_SCHEMA, type ReviewFinding } from "./pr-review-findings.js";
import { renderReviewRoom, type ReviewRoomMeta } from "./pr-review-room-template.js";

const log = createLogger("pr-review-room");

const DELIVER_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 60_000;
const DISCOVERY_TIMEOUT_MS = 20_000;

type SandboxSession = NonNullable<ReturnType<typeof getSandboxSession>>;

export interface PrRunContext {
  userId: string;
  conversationId: string | undefined;
  cwd: string;
  provider: string | undefined;
  providerConfig: unknown;
  progressMeta: { conversationId?: string | null; agentSlug?: string | null } | undefined;
  modelSettings: unknown;
  automationRun: boolean | undefined;
}

const runContexts = new Map<string, PrRunContext>();
const inFlight = new Set<string>();

export function registerLivePrRunContext(sessionId: string | undefined, ctx: PrRunContext): void {
  if (sessionId) runContexts.set(sessionId, ctx);
}

export function unregisterLivePrRunContext(sessionId: string | undefined): void {
  if (sessionId) runContexts.delete(sessionId);
}

export interface PrRoomFact {
  provider: string;
  status: string;
  title: string;
  url?: string | undefined;
  desc?: string | undefined;
  ticketId?: string | undefined;
  number?: string | undefined;
  repo?: string | undefined;
  targetBranch?: string | undefined;
  sourceBranch?: string | undefined;
}

// ── Sandbox-side git ─────────────────────────────────────────────────────────
//
// The repo checkout and its git credentials live in the SANDBOX, never on the
// claw pod. Running `execFile("git", ["-C", cwd, …])` here returns empty output
// against a pod directory that is not a checkout, which is what made the
// original generate() exit silently at `if (!headSha)`.

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function sandboxGitRunner(session: SandboxSession, repoRoot: string): GitRunner {
  return async (args: string[]): Promise<GitRunResult> => {
    const cmd = ["git", "-C", repoRoot, "--no-pager", ...args].map(shellQuote).join(" ");
    const result = await session.commands.run(cmd, GIT_TIMEOUT_MS);
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
    return {
      ok: exitCode === 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode,
    };
  };
}

// ── Read-only repo tools for the findings run ────────────────────────────────
//
// The findings run overlaps the still-live parent run and shares its working
// tree, so the palette carries no shell primitive at all: these four tools take
// DATA (a path, a pattern, a line range) and build their own argv, so the model
// has no flag position to write into. create_pull_request stays out of the
// palette entirely so the room run can never re-trigger the PR hook that
// spawned it.

const ROOM_TOOL_TIMEOUT_MS = 30_000;
const ROOM_OUTPUT_LIMIT = 24_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_LOG_COMMITS = 50;
const MAX_LINE_NUMBER = 1_000_000;

const SHARED_SANDBOX_NOTE =
  "The sandbox is shared with a run that is still in progress: only inspection is possible here, " +
  "and there is no way to modify the working tree from this room.";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function capOutput(text: string): string {
  if (text.length <= ROOM_OUTPUT_LIMIT) return text;
  return `${text.slice(0, ROOM_OUTPUT_LIMIT)}\n… truncated (${text.length - ROOM_OUTPUT_LIMIT} more characters)`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function optionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeRoot(root: string): string {
  const normalized = posix.normalize(root);
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

type ResolvedPath = { path: string } | { error: string };

function resolveInRoot(root: string, raw: unknown, label: string): ResolvedPath {
  if (raw === undefined || raw === null || raw === "") return { path: normalizeRoot(root) };
  if (typeof raw !== "string") return { error: `Rejected — \`${label}\` must be a string.` };
  if (raw.includes("\0")) return { error: `Rejected — \`${label}\` contains an invalid character.` };
  const rootPath = normalizeRoot(root);
  const joined = raw.startsWith("/") ? posix.normalize(raw) : posix.normalize(posix.join(rootPath, raw));
  const candidate = joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}/`)) {
    return {
      error:
        `Rejected — \`${label}\` resolves to ${candidate}, which is outside the repository checkout ` +
        `at ${rootPath}. Pass a path inside the checkout, relative to it.`,
    };
  }
  return { path: candidate };
}

async function runInSandbox(session: SandboxSession, cmd: string): Promise<string> {
  try {
    const result = await session.commands.run(cmd, ROOM_TOOL_TIMEOUT_MS);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
    if (!stdout.trim() && stderr.trim()) return capOutput(`(no output; stderr)\n${stderr}`);
    if (!stdout.trim()) return exitCode === 0 ? "(no output)" : `(no output; exit code ${exitCode})`;
    return capOutput(stdout);
  } catch (err) {
    return `The sandbox command failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function buildRoomTools(session: SandboxSession, repoRoot: string): ToolDefinition[] {
  const root = normalizeRoot(repoRoot);
  const quoted = (argv: string[]): string => argv.map(shellQuote).join(" ");

  const readFile: ToolDefinition = {
    name: "room-read-file",
    label: "Read File",
    description:
      `Read a file from the repository checkout at ${root}. \`path\` is a path inside that checkout ` +
      `(relative to it, or absolute under it) — not a command, not a glob, not a flag. Optionally pass ` +
      `\`startLine\` and \`endLine\` to read a slice. ${SHARED_SANDBOX_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path inside the repository checkout." },
        startLine: { type: "integer", description: "First line to return (1-based)." },
        endLine: { type: "integer", description: "Last line to return (1-based, inclusive)." },
      },
      required: ["path"],
    } as ToolDefinition["parameters"],
    async execute(_toolCallId: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      if (typeof p["path"] !== "string" || !p["path"].trim()) {
        return textResult("Rejected — `path` must be a non-empty string naming a file in the checkout.");
      }
      const resolved = resolveInRoot(root, p["path"], "path");
      if ("error" in resolved) return textResult(resolved.error);
      const start = optionalInt(p["startLine"], 1, MAX_LINE_NUMBER);
      const end = optionalInt(p["endLine"], 1, MAX_LINE_NUMBER);
      if (start !== undefined || end !== undefined) {
        const from = start ?? 1;
        const to = Math.max(from, end ?? from + 200);
        const cmd = quoted(["sed", "-n", `${from},${to}p`, "--", resolved.path]);
        return textResult(await runInSandbox(session, cmd));
      }
      return textResult(await runInSandbox(session, quoted(["cat", "--", resolved.path])));
    },
  };

  const search: ToolDefinition = {
    name: "room-search",
    label: "Search Repository",
    description:
      `Search file contents under the repository checkout at ${root}. \`pattern\` is a regular ` +
      `expression treated purely as search text — a pattern starting with \`-\` is fine and is never ` +
      `read as an option. \`dir\` narrows the search to a subdirectory of the checkout. ` +
      `${SHARED_SANDBOX_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
        dir: { type: "string", description: "Directory inside the checkout to search (defaults to the whole repo)." },
        maxResults: { type: "integer", description: `Maximum matching lines to return (max ${MAX_SEARCH_RESULTS}).` },
      },
      required: ["pattern"],
    } as ToolDefinition["parameters"],
    async execute(_toolCallId: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      const pattern = p["pattern"];
      if (typeof pattern !== "string" || pattern === "") {
        return textResult("Rejected — `pattern` must be a non-empty string.");
      }
      if (pattern.includes("\0")) return textResult("Rejected — `pattern` contains an invalid character.");
      const resolved = resolveInRoot(root, p["dir"], "dir");
      if ("error" in resolved) return textResult(resolved.error);
      const limit = clampInt(p["maxResults"], 1, MAX_SEARCH_RESULTS, 60);
      const rg = quoted([
        "rg",
        "--no-config",
        "--color",
        "never",
        "--line-number",
        "--with-filename",
        "--no-messages",
        "--max-columns",
        "400",
        "-e",
        pattern,
        "--",
        resolved.path,
      ]);
      const head = quoted(["head", "-n", String(limit)]);
      return textResult(await runInSandbox(session, `${rg} | ${head}`));
    },
  };

  const gitLog: ToolDefinition = {
    name: "room-git-log",
    label: "File History",
    description:
      `Show the commit history of one path in the repository checkout at ${root}. \`path\` is a file or ` +
      `directory inside the checkout. ${SHARED_SANDBOX_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path inside the repository checkout." },
        limit: { type: "integer", description: `Maximum commits to return (max ${MAX_LOG_COMMITS}).` },
      },
      required: ["path"],
    } as ToolDefinition["parameters"],
    async execute(_toolCallId: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      if (typeof p["path"] !== "string" || !p["path"].trim()) {
        return textResult("Rejected — `path` must be a non-empty string naming a path in the checkout.");
      }
      const resolved = resolveInRoot(root, p["path"], "path");
      if ("error" in resolved) return textResult(resolved.error);
      const limit = clampInt(p["limit"], 1, MAX_LOG_COMMITS, 10);
      const cmd = quoted([
        "git",
        "-C",
        root,
        "--no-pager",
        "log",
        "--date=short",
        "--format=%h %ad %an — %s",
        "-n",
        String(limit),
        "--",
        resolved.path,
      ]);
      return textResult(await runInSandbox(session, cmd));
    },
  };

  const listDir: ToolDefinition = {
    name: "room-list-dir",
    label: "List Directory",
    description:
      `List the entries of a directory inside the repository checkout at ${root}. ${SHARED_SANDBOX_NOTE}`,
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Directory path inside the repository checkout." },
      },
      required: ["dir"],
    } as ToolDefinition["parameters"],
    async execute(_toolCallId: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      if (typeof p["dir"] !== "string" || !p["dir"].trim()) {
        return textResult("Rejected — `dir` must be a non-empty string naming a directory in the checkout.");
      }
      const resolved = resolveInRoot(root, p["dir"], "dir");
      if ("error" in resolved) return textResult(resolved.error);
      return textResult(await runInSandbox(session, quoted(["ls", "-lA", "--", resolved.path])));
    },
  };

  return [readFile, search, gitLog, listDir];
}

async function discoverRepoRoot(session: SandboxSession, pr: PrRoomFact): Promise<string | undefined> {
  let listing = "";
  try {
    const result = await session.commands.run(
      "ls -d /workspace/.git /workspace/*/.git 2>/dev/null",
      DISCOVERY_TIMEOUT_MS,
    );
    listing = result.stdout ?? "";
  } catch (err) {
    log.warn(`[pr-room] sandbox repo discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
  const roots = listing
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith("/.git"))
    .map((l) => l.slice(0, -"/.git".length))
    .filter((l) => l.length > 0);
  if (roots.length === 0) return undefined;
  const wanted = (pr.repo ?? "").split("/").pop()?.trim().toLowerCase();
  if (wanted) {
    const match = roots.find((r) => r.split("/").pop()?.toLowerCase() === wanted);
    if (match) return match;
  }
  return roots[0];
}

async function refExists(git: GitRunner, ref: string): Promise<boolean> {
  const resolved = await git(["rev-parse", "--verify", "--quiet", ref]);
  return resolved.ok && resolved.stdout.trim().length > 0;
}

function normalizeBranchName(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/^refs\/heads\//, "").replace(/^origin\//, "");
  if (!trimmed || trimmed === "HEAD" || /[\s~^:?*\[\\]/.test(trimmed)) return undefined;
  return trimmed;
}

export async function resolveBaseRef(git: GitRunner, targetBranch?: string | undefined): Promise<string | undefined> {
  const branch = targetBranch ? normalizeBranchName(targetBranch) : undefined;
  if (branch) {
    if (await refExists(git, `origin/${branch}`)) return `origin/${branch}`;
    const fetched = await git([
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
    if (fetched.ok && (await refExists(git, `origin/${branch}`))) return `origin/${branch}`;
    if (!fetched.ok) {
      log.info(`[pr-room] fetch origin ${branch} failed: ${fetched.stderr.slice(0, 200)}`);
    }
    if (await refExists(git, branch)) return branch;
  }

  const symbolic = await git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (symbolic.ok && symbolic.stdout.trim()) {
    return symbolic.stdout.trim().replace("refs/remotes/", "");
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master", "origin/develop", "develop"]) {
    if (await refExists(git, candidate)) return candidate;
  }
  // No fallback to HEAD~1. That silently produces evidence describing only the
  // last commit while the room presents it as the whole PR — a wrong room is
  // worse than no room.
  return undefined;
}

export function reviewRoomConversationId(pr: PrRoomFact, headSha: string): string {
  const identity = [pr.repo ?? "", pr.number ?? "", pr.url ?? "", headSha].join("|");
  const digest = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 32);
  return `review-room_${digest}`;
}

const findingsOutputFormat: OutputFormatConfig = {
  type: "json",
  schema: REVIEW_FINDINGS_JSON_SCHEMA,
  requireToolsBeforeSubmit: ["room-read-file", "room-search"],
};

function buildFindingsPrompt(pr: PrRoomFact, evidence: PrEvidence): string {
  return `You are writing the FINDINGS for a pull-request review room. The room's job is to teach a reviewer the TERRITORY this change landed in — not to summarize the change, and not to praise it.

Do NOT summarize what was done. Do NOT restate the diff. Do NOT produce a verdict, a score, or an approval.

You are ADVERSARIAL toward the change on the reviewer's behalf. For every edit to an EXISTING file, answer, in this order of priority:

  1. Does this edit touch a path that code UNRELATED to this feature also runs through? If so, NAME THE INSTALL SITE — the file and symbol where the edited thing is registered, mounted, exported, or wired in — and say whose traffic now flows through these new lines. This is the single most valuable finding type; lead with it.
  2. For each edited existing file: what does the NEIGHBOURING code in that same file already do differently, and why did the author diverge from it? Name the sibling (function, const, route, middleware) explicitly.
  3. Which specific line will a reviewer MISREAD, and what will they wrongly think it means? A one-line change whose meaning is the opposite of how it scans is a finding even when the change is correct.
  4. What was DECIDED without being VERIFIED? Assumptions the change depends on that nobody has established either way.

The change's own new files are usually not the job. Say so where it is true.

GROUND TRUTH — this is computed from git, not from you. You MUST NOT invent, guess, or alter any of it:

${evidenceForPrompt(evidence)}

PULL REQUEST
  title: ${pr.title}
  repo: ${pr.repo ?? "unknown"}
  number: ${pr.number ?? "unknown"}
  url: ${pr.url ?? "unknown"}
  description: ${pr.desc ?? "(none)"}

HARD RULES
  - NEVER write a line number, commit sha, or test-file name that does not appear verbatim in the ground truth above. If you want to cite a line number you were not given, describe the code instead.
  - The "history" field must quote only shas and subjects present in the ground truth. Omit the field entirely if you have none.
  - "file" MUST be one of the exact paths listed above.
  - The reviewer already has the diff. Tell them what the diff cannot.

READING THE REPOSITORY
  The checkout is in the sandbox at ${evidence.repoRoot}. These four tools are your ONLY way to inspect it:
    - \`room-read-file\` — read a file (optionally a startLine/endLine slice).
    - \`room-search\` — search file contents for a regular expression, optionally under one directory.
    - \`room-git-log\` — the commit history of one path.
    - \`room-list-dir\` — list a directory.
  They take paths and patterns, not commands or flags, and they only reach inside ${evidence.repoRoot}.
  The sandbox is shared with a run that is still in progress, so only inspection is possible — there is no
  way to modify anything from this room, and no shell. Read before you assert — you must actually open a
  file before you can claim an install site or a neighbouring-code divergence.

MARKING WHAT YOU COULD NOT ESTABLISH
  Set "unverified": true on a finding you DECIDED but could not confirm from the ground truth or from a
  file you actually read. Those — and only those — reach the reviewer's "not verified" wall. Everything
  else is presented as established, so do not set the flag on a finding you did confirm.

Inline HTML tags <code>, <b>, <i> are allowed inside what/why/blast/history/note/ask.

${buildSubmitResultInstruction(findingsOutputFormat)}`;
}

function buildFindingsPalette(
  session: SandboxSession,
  repoRoot: string,
  structuredOutputRef: StructuredOutputRef,
): ToolDefinition[] {
  // The findings run reaches the repo through the PARENT run's live sandbox
  // session — the same one the deterministic evidence collector uses — so the
  // room never keys an empty sandbox with no repo and never pays a cold
  // ~12-minute setup.
  return [
    ...buildRoomTools(session, repoRoot),
    buildSubmitResultTool(findingsOutputFormat, structuredOutputRef),
  ];
}

export interface FindingsAttempt {
  provider: string | undefined;
  providerConfig: unknown;
  sessionId: string;
}

export interface FindingsFallbackArgs {
  roomConversationId: string;
  provider: string | undefined;
  providerConfig: unknown;
  sessionId: string;
  run: (attempt: FindingsAttempt) => Promise<void>;
  isFallbackEligible: (err: unknown) => boolean;
}

/**
 * One findings attempt on the run's own provider, and — when that provider
 * fails the same way run.ts's fallback walk would advance on (quota, bad
 * credential, transient/terminal provider error) — exactly one more on the
 * platform provider. The retry carries no providerConfig, which is what makes
 * runTask resolve it to "spaces"/LiteLLM, and a fresh session id so it can
 * never land on the first attempt's session files.
 */
export async function runFindingsWithFallback(
  args: FindingsFallbackArgs,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const primary: FindingsAttempt = {
    provider: args.provider,
    providerConfig: args.providerConfig,
    sessionId: args.sessionId,
  };
  try {
    await args.run(primary);
    return { ok: true };
  } catch (err) {
    const from = args.provider ?? "spaces";
    if (from === "spaces" || !args.isFallbackEligible(err)) return { ok: false, error: err };
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`[pr-room] findings provider fallback: ${from} → spaces (${reason.slice(0, 200)})`);
    metric.count("pr_room_provider_fallback", { from });
    try {
      await args.run({
        provider: undefined,
        providerConfig: undefined,
        sessionId: `${args.sessionId}_fb${randomUUID().slice(0, 8)}`,
      });
      return { ok: true };
    } catch (retryErr) {
      return { ok: false, error: retryErr };
    }
  }
}

async function requestFindings(
  roomConversationId: string,
  ctx: PrRunContext,
  parentConversationId: string,
  agentSlug: string,
  pr: PrRoomFact,
  evidence: PrEvidence,
  session: SandboxSession,
): Promise<ReviewFinding[] | undefined> {
  const { runTask, isProviderFallbackEligibleError } = await import("./agent.js");
  const findingsSessionId = `${roomConversationId}_${randomUUID().slice(0, 8)}`;
  const structuredOutputRef: StructuredOutputRef = {};
  const customTools = buildFindingsPalette(session, evidence.repoRoot, structuredOutputRef);

  const outcome = await runFindingsWithFallback({
    roomConversationId,
    provider: ctx.provider,
    providerConfig: ctx.providerConfig,
    sessionId: findingsSessionId,
    isFallbackEligible: isProviderFallbackEligibleError,
    run: (attempt) =>
      runTask({
        userId: ctx.userId,
        task: buildFindingsPrompt(pr, evidence),
        conversationId: roomConversationId,
        sessionId: attempt.sessionId,
        cwd: ctx.cwd,
        customTools,
        structuredOutputRef,
        provider: attempt.provider,
        providerConfig: attempt.providerConfig as never,
        modelSettings: ctx.modelSettings as never,
        progressMeta: {
          conversationId: parentConversationId,
          ...(agentSlug ? { agentSlug } : {}),
        },
        automationRun: true,
      }).then(() => undefined),
  });
  if (!outcome.ok) {
    log.warn(
      `[pr-room] findings run failed for ${roomConversationId}: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
    );
    return undefined;
  }

  if (structuredOutputRef.value === undefined) {
    log.warn(`[pr-room] findings run for ${roomConversationId} never called submit-result`);
    return undefined;
  }
  const parsed = coerceFindings(structuredOutputRef.value);
  if (!parsed.ok) {
    log.warn(`[pr-room] submitted findings payload rejected for ${roomConversationId}: ${parsed.error}`);
    return undefined;
  }
  log.info(`[pr-room] findings accepted count=${parsed.findings.length} conv=${roomConversationId}`);
  return parsed.findings;
}

function buildMeta(pr: PrRoomFact, evidence: PrEvidence, findings: ReviewFinding[], roomKey: string): ReviewRoomMeta {
  const weighty = findings.filter((f) => f.weight || f.sev === "hi");
  const untested = [...evidence.editedFiles].filter((f) => f.testFiles.length === 0);

  // The unknowns wall is for what was NOT established: deterministic coverage
  // gaps, plus findings the model explicitly flagged as unverified. Pushing
  // every finding's `ask` here rendered each finding twice — once as a card
  // stating a claim, once on the wall as an open question.
  const unknowns: string[] = [];
  if (untested.length) {
    unknowns.push(
      `<b>No test file covers ${untested.length} of the ${evidence.editedFileCount} edited existing files.</b> ` +
        untested.slice(0, 8).map((f) => `<code>${f.path}</code>`).join(", "),
    );
  }
  for (const f of findings) {
    if (f.unverified) unknowns.push(`<b>${f.title}</b> — ${f.ask}`);
  }

  const reviewPath = [
    ...weighty.map((f) => ({
      title: `<b>${f.file}</b> — ${f.title}`,
      note: f.blast,
    })),
    {
      title: `<b>The ${evidence.newFileCount} new files are additive and self-contained.</b>`,
      note: `${evidence.newFileLines} of the ${evidence.newFileLines + evidence.editedFileLines} lines. Skim, don't study.`,
    },
  ];

  const unverifiedCount = findings.filter((f) => f.unverified).length;

  return {
    title: pr.title,
    prUrl: pr.url,
    prNumber: pr.number,
    repo: pr.repo,
    author: undefined,
    baseRef: evidence.baseRef,
    headSha: evidence.headSha,
    roomKey,
    shapeAnswer: `${evidence.newFileCount > 0 ? "Additive" : "In-place"} change, ${evidence.newFileCount} new files.`,
    shapeNote: `+${evidence.insertions} / −${evidence.deletions} across ${evidence.filesChanged} files. ${evidence.editedFileCount} of them already existed.`,
    hurtAnswer: weighty.length
      ? `${weighty.length} edit${weighty.length === 1 ? "" : "s"} reach past <span style="color:var(--hi)">this feature</span>.`
      : "Nothing here reaches past the feature.",
    hurtNote: weighty.length ? weighty.map((f) => f.blast).join(" ") : "Every edit is scoped to files this change owns.",
    unknownAnswer: untested.length ? `${untested.length} edited files, no tests.` : "Coverage exists on every edit.",
    unknownNote:
      `Test search is a deterministic path match over the repo index, not a judgement call.` +
      (unverifiedCount
        ? ` ${unverifiedCount} finding${unverifiedCount === 1 ? " was" : "s were"} decided but not verified.`
        : ""),
    unknowns,
    reviewPath,
  };
}

async function deliverRoom(sessionId: string, roomConversationId: string, pr: PrRoomFact, html: string): Promise<boolean> {
  if (!SERVER.authServiceUrl) {
    log.warn(`[pr-room] no auth service URL configured — room for ${roomConversationId} not delivered`);
    return false;
  }
  const url = `${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/webhook/review-room`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({
      sessionId,
      roomConversationId,
      pr: { title: pr.title, url: pr.url, number: pr.number, repo: pr.repo },
      html: Buffer.from(html, "utf8").toString("base64"),
      fileName: `review-room-${pr.number ?? roomConversationId}.html`,
    }),
    signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
  });
  if (!res.ok) {
    log.warn(`[pr-room] deliver responded ${res.status} for ${roomConversationId}`);
    return false;
  }
  log.info(`[pr-room] delivered room ${roomConversationId} for session ${sessionId}`);
  return true;
}

export function buildReviewRoomNoticeBody(
  sessionId: string,
  roomConversationId: string,
  pr: PrRoomFact,
  reason: string,
): Record<string, unknown> {
  return {
    sessionId,
    roomConversationId,
    failed: true,
    reason: reason.slice(0, 200),
    pr: { number: pr.number, url: pr.url },
  };
}

/**
 * Every abort inside generate() used to be visible only in claw's own logs: the
 * thread that was promised a room simply never got one. This posts the same
 * webhook the delivered room uses, with `failed: true`, so claw-auth can say in
 * the thread what stopped it.
 */
async function postReviewRoomNotice(
  sessionId: string,
  roomConversationId: string,
  pr: PrRoomFact,
  reason: string,
): Promise<void> {
  if (!SERVER.authServiceUrl) return;
  try {
    const url = `${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/webhook/review-room`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
      },
      body: JSON.stringify(buildReviewRoomNoticeBody(sessionId, roomConversationId, pr, reason)),
      signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
    });
    if (!res.ok) log.warn(`[pr-room] notice responded ${res.status} for ${roomConversationId}`);
  } catch (err) {
    log.warn(`[pr-room] notice failed for ${roomConversationId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function generate(sessionId: string, pr: PrRoomFact, handle: LiveSessionHandle): Promise<void> {
  const ctx = runContexts.get(sessionId);
  if (!ctx) {
    log.info(`[pr-room] no live run context for session ${sessionId} — skipping room`);
    return;
  }

  const parentConversationId = ctx.progressMeta?.conversationId?.trim();
  if (!parentConversationId) {
    log.info(`[pr-room] session ${sessionId} has no parent conversationId — skipping room`);
    return;
  }
  const agentSlug = ctx.progressMeta?.agentSlug?.trim() ?? "";

  const storeKey =
    buildSandboxStoreKey(ctx.userId, parentConversationId, agentSlug) ?? ctx.conversationId;
  const sandboxGone = "the run's sandbox was gone before the room could be built";
  const earlyRoomId = reviewRoomConversationId(pr, "");

  const session = storeKey ? getSandboxSession(storeKey) : undefined;
  if (!session) {
    log.info(`[pr-room] no live sandbox for storeKey ${storeKey ?? "(none)"} — skipping room`);
    await postReviewRoomNotice(sessionId, earlyRoomId, pr, sandboxGone);
    return;
  }

  const repoRoot = await discoverRepoRoot(session, pr);
  if (!repoRoot) {
    log.info(`[pr-room] no git checkout found in the sandbox — skipping room`);
    await postReviewRoomNotice(sessionId, earlyRoomId, pr, sandboxGone);
    return;
  }

  const git = sandboxGitRunner(session, repoRoot);
  const head = await git(["rev-parse", "HEAD"]);
  const headSha = head.ok ? head.stdout.trim() : "";
  if (!headSha) {
    log.info(`[pr-room] ${repoRoot} in the sandbox is not a git checkout — skipping room`);
    await postReviewRoomNotice(sessionId, earlyRoomId, pr, sandboxGone);
    return;
  }

  const roomConversationId = reviewRoomConversationId(pr, headSha);
  if (inFlight.has(roomConversationId)) {
    log.info(`[pr-room] ${roomConversationId} already generating — skipping duplicate`);
    return;
  }
  inFlight.add(roomConversationId);
  let snapshotWritten = false;
  let roomDelivered = false;
  try {
    const snapshot = await snapshotLiveSessionHandle(handle, roomConversationId, sessionId, { overwrite: true });
    if (!snapshot.ok) {
      log.warn(`[pr-room] snapshot failed (${snapshot.reason}) — room for ${roomConversationId} aborted`);
      await postReviewRoomNotice(sessionId, roomConversationId, pr, sandboxGone);
      return;
    }
    snapshotWritten = true;

    const baseRef = await resolveBaseRef(git, pr.targetBranch);
    if (!baseRef) {
      log.warn(
        `[pr-room] could not resolve a base ref in ${repoRoot} — room ${roomConversationId} aborted rather than described against HEAD~1`,
      );
      await postReviewRoomNotice(sessionId, roomConversationId, pr, "no base branch could be resolved for the PR");
      return;
    }

    const evidence = await collectPrEvidence({ git, repoRoot, baseRef, headRef: headSha });
    if (evidence.diffFailure) {
      log.warn(`[pr-room] evidence diff failed (${evidence.diffFailure}) — room ${roomConversationId} aborted`);
      await postReviewRoomNotice(
        sessionId,
        roomConversationId,
        pr,
        "the diff between base and head could not be read",
      );
      return;
    }
    if (evidence.filesChanged === 0) {
      log.info(`[pr-room] no changed files between ${baseRef} and ${headSha.slice(0, 10)} — skipping room`);
      await postReviewRoomNotice(sessionId, roomConversationId, pr, "no changed files between base and head");
      return;
    }

    const findings = await requestFindings(
      roomConversationId,
      ctx,
      parentConversationId,
      agentSlug,
      pr,
      evidence,
      session,
    );
    if (!findings) {
      log.warn(`[pr-room] no valid findings — room ${roomConversationId} aborted`);
      await postReviewRoomNotice(sessionId, roomConversationId, pr, "the findings model failed on every provider");
      return;
    }

    const html = renderReviewRoom({
      meta: buildMeta(pr, evidence, findings, roomConversationId),
      evidence,
      findings,
    });
    roomDelivered = await deliverRoom(sessionId, roomConversationId, pr, html).catch(async (err) => {
      log.warn(
        `[pr-room] deliver threw for ${roomConversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    });
    if (!roomDelivered) {
      await postReviewRoomNotice(sessionId, roomConversationId, pr, "review room could not be delivered");
    }
  } finally {
    inFlight.delete(roomConversationId);
    if (snapshotWritten && !roomDelivered) {
      await deleteSession(roomConversationId).catch((err) =>
        log.warn(
          `[pr-room] cleanup of aborted room session ${roomConversationId} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }
}

export function buildPublishReviewRoomTool(sessionId: string): ToolDefinition {
  return {
    name: "publish-review-room",
    label: "Publish Review Room",
    description:
      "Publish the review room for a pull request created during this run by any means (gh CLI, git push, a github/bitbucket subagent, or an MCP tool). Call it once, right after the PR exists, with the PR URL. Skip it if a review room was already announced for this PR.",
    parameters: Type.Object({
      url: Type.String({ description: "Full https URL of the newly created pull request." }),
      title: Type.Optional(Type.String({ description: "PR title." })),
      number: Type.Optional(Type.String({ description: "PR number, digits only." })),
      repo: Type.Optional(Type.String({ description: "Repository, e.g. org/name." })),
      targetBranch: Type.Optional(Type.String()),
      sourceBranch: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: unknown) {
      const p = (params ?? {}) as Record<string, unknown>;
      const url = typeof p["url"] === "string" ? p["url"].trim() : "";
      if (!/^https?:\/\//i.test(url)) {
        return {
          content: [{ type: "text" as const, text: "Error: url must be the full https URL of the pull request." }],
          details: {},
        };
      }
      const host = url.toLowerCase();
      const provider = host.includes("github")
        ? "github"
        : host.includes("bitbucket")
          ? "bitbucket"
          : host.includes("gitlab")
            ? "gitlab"
            : "other";
      const str = (k: string): string | undefined => {
        const v = p[k];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };
      const numberFromUrl = /\/(?:pull|pull-requests|merge_requests)\/(\d+)/.exec(url)?.[1];
      kickOffPrReviewRoom(sessionId, {
        provider,
        status: "created",
        title: str("title") ?? (numberFromUrl ? `PR #${numberFromUrl}` : "Pull request"),
        url,
        number: str("number") ?? numberFromUrl,
        repo: str("repo"),
        targetBranch: str("targetBranch"),
        sourceBranch: str("sourceBranch"),
      });
      return {
        content: [{ type: "text" as const, text: `Review room generation started for ${url}. The link is posted to the thread when ready.` }],
        details: {},
      };
    },
  };
}

export function kickOffPrReviewRoom(sessionId: string, pr: PrRoomFact): void {
  try {
    if (!sessionId || pr.status !== "created") return;
    if (String(process.env["PR_REVIEW_ROOM_ENABLED"] ?? "true").toLowerCase() === "false") return;
    // Take the live-session handle SYNCHRONOUSLY, before anything awaits. PR
    // creation lands near the end of a run, so by the time the sandbox and git
    // work finished the parent's `finally` has usually already called
    // unregisterLiveSession and the lookup would come back empty.
    const handle = getLiveSession(sessionId);
    if (!handle) {
      log.info(`[pr-room] no live session handle for ${sessionId} — skipping room`);
      return;
    }
    void generate(sessionId, pr, handle).catch((err) => {
      log.warn(`[pr-room] generation failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    log.warn(`[pr-room] kickoff failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
