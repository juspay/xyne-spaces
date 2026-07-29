/**
 * Per-session workspace management.
 *
 * Ephemeral workspaces: isolated directory under {dataDir}/workspaces/{sessionId}.
 *
 * NOTE: host-side repo cloning/worktrees were removed. Repositories are now
 * cloned and operated on entirely inside the sandbox (sbx). The previous
 * `git clone --bare ${repoUrl}` path interpolated a request-controlled value
 * straight into a `/bin/sh -c` command (RCE); there is no longer any host
 * process that touches a caller-supplied repo URL.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("workspace");

// ---------------------------------------------------------------------------
// Ephemeral workspaces (non-repo sessions)
// ---------------------------------------------------------------------------

function workspacesRoot(): string {
  return path.join(PATHS.dataDir, "workspaces");
}

export function workspacePath(sessionId: string): string {
  return path.join(workspacesRoot(), sessionId);
}

/**
 * Containment check for the caller-supplied `cwd` field on /run.
 *
 * The cwd becomes the agent's working directory AND the root that
 * contextFiles/attachments are written under, so accepting it verbatim is an
 * arbitrary-host-write primitive for anyone holding the S2S key. Only allow
 * paths under the workspaces root, or under a root explicitly allowlisted via
 * XYNE_CLAW_ALLOWED_CWD_ROOTS (comma-separated absolute paths).
 */
const ALLOWED_CWD_ROOTS: readonly string[] = (process.env["XYNE_CLAW_ALLOWED_CWD_ROOTS"] ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

export function isAllowedCwd(raw: string): boolean {
  if (!path.isAbsolute(raw)) return false;
  const resolved = path.resolve(raw);
  for (const root of [path.resolve(workspacesRoot()), ...ALLOWED_CWD_ROOTS]) {
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) return true;
  }
  return false;
}

export async function createWorkspace(sessionId: string): Promise<string> {
  const dir = workspacePath(sessionId);
  await mkdir(dir, { recursive: true });
  log.info(`[workspace] Created ${dir}`);
  return dir;
}

export interface WorkspaceTextFile {
  path: string;
  content: string;
}

function sanitizeRelativePath(input: string): string {
  const rawSegments = input.split(/[/\\]+/);
  const cleaned: string[] = [];
  for (const seg of rawSegments) {
    if (!seg || seg === "." || seg === "..") continue;
    const safe = seg.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safe) continue;
    cleaned.push(safe);
  }
  if (cleaned.length === 0) return ".context/attached-context.md";
  if (cleaned[0] !== ".context") cleaned.unshift(".context");
  return cleaned.join("/");
}

export async function writeWorkspaceTextFiles(baseDir: string, files: WorkspaceTextFile[]): Promise<string[]> {
  const root = path.resolve(baseDir);
  const written: string[] = [];

  for (const file of files) {
    const safeRelative = sanitizeRelativePath(file.path);
    const destination = path.resolve(root, safeRelative);
    if (!destination.startsWith(`${root}${path.sep}`)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content, "utf8");
    written.push(safeRelative);
  }

  return written;
}

export interface WorkspaceBinaryFile {
  /** Relative path under .context/ (already namespaced — same sanitizer as text). */
  path: string;
  data: Buffer;
}

/**
 * Write raw binary blobs under .context/ — used to keep the original PDF
 * bytes alongside the extracted markdown so tools that need the raw file
 * (fill-pdf-form, inspect-pdf-form) can read it directly. Text path stays
 * unchanged. Same path-traversal protection as writeWorkspaceTextFiles.
 */
export async function writeWorkspaceBinaryFiles(baseDir: string, files: WorkspaceBinaryFile[]): Promise<string[]> {
  const root = path.resolve(baseDir);
  const written: string[] = [];

  for (const file of files) {
    const safeRelative = sanitizeRelativePath(file.path);
    const destination = path.resolve(root, safeRelative);
    if (!destination.startsWith(`${root}${path.sep}`)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.data);
    written.push(safeRelative);
  }

  return written;
}

export async function deleteWorkspace(sessionId: string): Promise<void> {
  const dir = workspacePath(sessionId);
  try {
    await rm(dir, { recursive: true, force: true });
    log.info(`[workspace] Deleted ${dir}`);
  } catch (err) {
    log.warn(`[workspace] Failed to delete ${dir}:`, err);
  }
}
