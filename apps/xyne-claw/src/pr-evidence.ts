import path from "node:path";

import { createLogger } from "./logger.js";

const log = createLogger("pr-evidence");

const MAX_HISTORY_PER_FILE = 6;
const MAX_TESTS_PER_FILE = 8;
const MAX_HUNK_CHARS = 24_000;
const LOG_SEP = "\u001f";

export type PrFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "other";

export interface PrCommitRef {
  sha: string;
  shortSha: string;
  subject: string;
  date: string;
  author: string;
}

export interface PrFileEvidence {
  path: string;
  status: PrFileStatus;
  isNewFile: boolean;
  insertions: number;
  deletions: number;
  hunks: string;
  history: PrCommitRef[];
  testFiles: string[];
}

export interface PrEvidence {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  collectedAt: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  newFileCount: number;
  editedFileCount: number;
  newFileLines: number;
  editedFileLines: number;
  newFiles: PrFileEvidence[];
  editedFiles: PrFileEvidence[];
}

/** Result of one git invocation. `stdout` is only meaningful when `ok`. */
export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs `git <args>` against the checkout and returns its output.
 *
 * The repository and its credentials live in the SANDBOX, not on the claw pod,
 * so this is always backed by the sandbox exec path — never a local child
 * process. The caller owns the transport; this module only shapes the argv.
 */
export type GitRunner = (args: string[]) => Promise<GitRunResult>;

export interface CollectPrEvidenceOptions {
  git: GitRunner;
  repoRoot: string;
  baseRef: string;
  headRef: string;
  maxFiles?: number | undefined;
}

async function gitOrEmpty(git: GitRunner, args: string[]): Promise<string> {
  try {
    const out = await git(args);
    if (!out.ok) {
      log.warn(`[pr-evidence] git ${args[0]} exited ${out.exitCode}: ${out.stderr.slice(0, 300)}`);
      return "";
    }
    return out.stdout;
  } catch (err) {
    log.warn(`[pr-evidence] git ${args[0]} threw: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
}

async function gitOrThrow(git: GitRunner, args: string[]): Promise<string> {
  const out = await git(args);
  if (!out.ok) {
    throw new Error(`git ${args.join(" ")} exited ${out.exitCode}: ${out.stderr.slice(0, 300)}`);
  }
  return out.stdout;
}

function mapStatus(code: string): PrFileStatus {
  const c = code.charAt(0).toUpperCase();
  if (c === "A") return "added";
  if (c === "M") return "modified";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "C") return "copied";
  return "other";
}

function parseNameStatus(raw: string): Map<string, PrFileStatus> {
  const out = new Map<string, PrFileStatus>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0];
    if (!code) continue;
    const target = parts.length >= 3 ? parts[2] : parts[1];
    if (!target) continue;
    out.set(target, mapStatus(code));
  }
  return out;
}

function parseNumstat(raw: string): Map<string, { insertions: number; deletions: number }> {
  const out = new Map<string, { insertions: number; deletions: number }>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const target = parts.length >= 4 ? parts[3] : parts[2];
    if (!target) continue;
    const ins = Number(parts[0]);
    const del = Number(parts[1]);
    out.set(target, {
      insertions: Number.isFinite(ins) ? ins : 0,
      deletions: Number.isFinite(del) ? del : 0,
    });
  }
  return out;
}

function parseLog(raw: string): PrCommitRef[] {
  const out: PrCommitRef[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [sha, date, author, ...rest] = line.split(LOG_SEP);
    if (!sha) continue;
    out.push({
      sha,
      shortSha: sha.slice(0, 10),
      date: date ?? "",
      author: author ?? "",
      subject: rest.join(LOG_SEP),
    });
  }
  return out;
}

const TEST_MARKERS = [".test.", ".spec.", "_test.", "-test."];

function isTestPath(p: string): boolean {
  const lower = p.toLowerCase();
  if (TEST_MARKERS.some((m) => lower.includes(m))) return true;
  const segments = lower.split("/");
  return segments.some((s) => s === "__tests__" || s === "tests" || s === "test");
}

function testFilesFor(changedPath: string, allTestFiles: string[]): string[] {
  if (isTestPath(changedPath)) return [];
  const dir = path.posix.dirname(changedPath);
  const base = path.posix.basename(changedPath);
  const stem = base.replace(/\.[^.]+$/, "").toLowerCase();
  if (!stem) return [];

  const hits: string[] = [];
  for (const t of allTestFiles) {
    const tDir = path.posix.dirname(t);
    const tStem = path.posix.basename(t).replace(/\.[^.]+$/, "").toLowerCase();
    const siblingDir = tDir === `${dir}/__tests__` || tDir === `${dir}/tests` || tDir === `${dir}/test`;
    if (tDir !== dir && !siblingDir) continue;
    const byName = tStem === stem || tStem.startsWith(`${stem}.`) || tStem.startsWith(`${stem}-`) || tStem.startsWith(`${stem}_`);
    if (byName) hits.push(t);
    if (hits.length >= MAX_TESTS_PER_FILE) break;
  }
  return hits;
}

async function fileDiff(git: GitRunner, baseSha: string, headSha: string, filePath: string): Promise<string> {
  const raw = await gitOrEmpty(git, [
    "diff",
    "--no-color",
    "--unified=6",
    `${baseSha}...${headSha}`,
    "--",
    filePath,
  ]);
  const body = raw
    .split("\n")
    .filter((l) => !l.startsWith("diff --git ") && !l.startsWith("index ") && !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("new file mode ") && !l.startsWith("deleted file mode ") && !l.startsWith("similarity index ") && !l.startsWith("rename from ") && !l.startsWith("rename to "))
    .join("\n")
    .trim();
  return body.length > MAX_HUNK_CHARS ? `${body.slice(0, MAX_HUNK_CHARS)}\n… diff truncated …` : body;
}

async function fileHistory(git: GitRunner, baseSha: string, filePath: string): Promise<PrCommitRef[]> {
  const raw = await gitOrEmpty(git, [
    "log",
    `--max-count=${MAX_HISTORY_PER_FILE}`,
    "--follow",
    "--date=short",
    "--format=%H%x1f%ad%x1f%an%x1f%s",
    baseSha,
    "--",
    filePath,
  ]);
  return parseLog(raw);
}

export async function collectPrEvidence(opts: CollectPrEvidenceOptions): Promise<PrEvidence> {
  const { git, repoRoot, baseRef, headRef } = opts;
  const maxFiles = opts.maxFiles ?? 60;

  const headSha = (await gitOrThrow(git, ["rev-parse", headRef])).trim();
  const mergeBase = (await gitOrEmpty(git, ["merge-base", baseRef, headRef])).trim();
  const baseSha = mergeBase || (await gitOrThrow(git, ["rev-parse", baseRef])).trim();

  const range = `${baseSha}...${headSha}`;
  const statuses = parseNameStatus(await gitOrEmpty(git, ["diff", "--name-status", "-M", range]));
  const stats = parseNumstat(await gitOrEmpty(git, ["diff", "--numstat", "-M", range]));

  const allTestFiles = (await gitOrEmpty(git, ["ls-files"]))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && isTestPath(l));

  const paths = [...statuses.keys()].slice(0, maxFiles);

  const files: PrFileEvidence[] = [];
  for (const p of paths) {
    const status = statuses.get(p) ?? "other";
    const isNewFile = status === "added";
    const stat = stats.get(p) ?? { insertions: 0, deletions: 0 };
    files.push({
      path: p,
      status,
      isNewFile,
      insertions: stat.insertions,
      deletions: stat.deletions,
      hunks: await fileDiff(git, baseSha, headSha, p),
      history: isNewFile ? [] : await fileHistory(git, baseSha, p),
      testFiles: testFilesFor(p, allTestFiles),
    });
  }

  const newFiles = files.filter((f) => f.isNewFile);
  const editedFiles = files.filter((f) => !f.isNewFile);
  const sum = (list: PrFileEvidence[], pick: (f: PrFileEvidence) => number): number =>
    list.reduce((acc, f) => acc + pick(f), 0);

  return {
    repoRoot,
    baseRef,
    headRef,
    baseSha,
    headSha,
    collectedAt: new Date().toISOString(),
    filesChanged: files.length,
    insertions: sum(files, (f) => f.insertions),
    deletions: sum(files, (f) => f.deletions),
    newFileCount: newFiles.length,
    editedFileCount: editedFiles.length,
    newFileLines: sum(newFiles, (f) => f.insertions + f.deletions),
    editedFileLines: sum(editedFiles, (f) => f.insertions + f.deletions),
    newFiles,
    editedFiles,
  };
}

export function evidenceForPrompt(evidence: PrEvidence): string {
  const lines: string[] = [];
  lines.push(`base=${evidence.baseSha.slice(0, 10)} head=${evidence.headSha.slice(0, 10)}`);
  lines.push(
    `${evidence.filesChanged} files changed, +${evidence.insertions} / -${evidence.deletions} ` +
      `(${evidence.newFileCount} new files = ${evidence.newFileLines} lines, ` +
      `${evidence.editedFileCount} edits to existing files = ${evidence.editedFileLines} lines)`,
  );
  lines.push("");
  lines.push("EDITS TO EXISTING FILES (the review surface):");
  for (const f of evidence.editedFiles) {
    lines.push(`  ${f.path}  +${f.insertions}/-${f.deletions}  status=${f.status}`);
    lines.push(`    tests: ${f.testFiles.length ? f.testFiles.join(", ") : "NONE FOUND"}`);
    for (const c of f.history) lines.push(`    history: ${c.shortSha} ${c.date} ${c.subject}`);
    lines.push("    diff:");
    for (const l of f.hunks.split("\n")) lines.push(`      ${l}`);
    lines.push("");
  }
  lines.push("NEW FILES (self-contained, low review risk):");
  for (const f of evidence.newFiles) {
    lines.push(`  ${f.path}  +${f.insertions}  tests: ${f.testFiles.length ? f.testFiles.join(", ") : "NONE FOUND"}`);
  }
  return lines.join("\n");
}
