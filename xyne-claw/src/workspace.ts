/**
 * Per-session workspace management.
 *
 * Ephemeral workspaces: isolated directory under {dataDir}/workspaces/{sessionId}.
 * Repo worktrees: git worktree from a persistent bare clone under REPO_BASE_DIR.
 *
 * All git operations use async exec to avoid blocking the event loop
 * (which would cause liveness probe timeouts under load).
 */

import { mkdir, rm, access, writeFile } from "node:fs/promises";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import path from "node:path";
import { PATHS } from "./config.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Repo / SSH constants
// ---------------------------------------------------------------------------
const REPO_BASE_DIR = process.env["XYNE_REPO_WORKSPACE"] ?? join(homedir(), ".xyne-claw", "repos");
const SSH_KEY_PATH = process.env["SSH_KEY_PATH"] ?? "/tmp/ssh-keys/id_rsa";
const GIT_SSH_ENV = { ...process.env, GIT_SSH_COMMAND: `ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no` };

// ---------------------------------------------------------------------------
// Ephemeral workspaces (non-repo sessions)
// ---------------------------------------------------------------------------

function workspacesRoot(): string {
  return path.join(PATHS.dataDir, "workspaces");
}

export function workspacePath(sessionId: string): string {
  return path.join(workspacesRoot(), sessionId);
}

export async function createWorkspace(sessionId: string): Promise<string> {
  const dir = workspacePath(sessionId);
  await mkdir(dir, { recursive: true });
  console.log(`[workspace] Created ${dir}`);
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
    console.log(`[workspace] Deleted ${dir}`);
  } catch (err) {
    console.warn(`[workspace] Failed to delete ${dir}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Git worktree management (repo-backed sessions) — fully async
// ---------------------------------------------------------------------------

function repoSlug(repoUrl: string): string {
  return repoUrl.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/**
 * In-flight bare-repo setup promises keyed by bareDir. When N sessions arrive
 * concurrently for the same repo, only ONE performs the clone/fetch; the rest
 * await the same promise. Without this, concurrent `git fetch '+refs/heads/*'`
 * on the same bare repo crashes with lock-contention errors (we hit this in
 * prod: session 333b813a failed mid-fetch because session d8664d57 was still
 * cloning the same bareDir).
 *
 * The map entry is cleared once the setup resolves OR rejects, so the next
 * batch of sessions triggers a fresh fetch (to pick up new commits).
 */
const bareRepoSetupLocks = new Map<string, Promise<void>>();

async function ensureBareRepoReady(repoUrl: string, bareDir: string): Promise<void> {
  const existing = bareRepoSetupLocks.get(bareDir);
  if (existing) return existing;

  const setup = (async () => {
    if (await fileExists(join(bareDir, "HEAD"))) {
      console.log(`[workspace] Fetching all branches in ${bareDir}`);
      // Update remote-tracking refs (refs/remotes/origin/*) instead of local
      // branches (refs/heads/*). The local-branch form is unsafe in a bare repo
      // shared with linked worktrees: git refuses to fetch into a branch that
      // is currently checked out elsewhere with
      //   "fatal: refusing to fetch into branch 'refs/heads/<name>' checked
      //    out at '<worktree-path>'"
      // Worktrees can still resolve `origin/<branch>` for checkouts; this is
      // what `git fetch` is actually designed to update.
      await execAsync("git fetch origin '+refs/heads/*:refs/remotes/origin/*'", {
        cwd: bareDir,
        env: GIT_SSH_ENV,
      });
    } else {
      console.log(`[workspace] Cloning ${repoUrl} into ${bareDir} (bare)`);
      await execAsync(`git clone --bare ${repoUrl} ${bareDir}`, {
        env: GIT_SSH_ENV,
      });
    }

    // Persist the SSH command into the bare repo's config so every git operation
    // from any worktree (including the agent's later `git push`) uses the right key
    // automatically — without needing GIT_SSH_COMMAND to be in the subprocess env.
    await execAsync(
      `git config core.sshCommand "ssh -i ${SSH_KEY_PATH} -o StrictHostKeyChecking=no"`,
      { cwd: bareDir },
    );
  })();

  bareRepoSetupLocks.set(bareDir, setup);
  setup.finally(() => {
    if (bareRepoSetupLocks.get(bareDir) === setup) bareRepoSetupLocks.delete(bareDir);
  });
  return setup;
}

/**
 * Pre-warm bare repos at startup. Lets us amortize the cold clone away from
 * a user's first request.
 *
 * The default list is the union of every repo a registered agent might
 * worktree against. Override with env `XYNE_PRECLONE_REPOS=url1,url2` to
 * extend at deploy-time without a code change.
 */
const DEFAULT_PRECLONE_REPOS: string[] = [
];

export async function prewarmConfiguredRepos(): Promise<void> {
  const fromEnv = (process.env["XYNE_PRECLONE_REPOS"] ?? "").trim();
  const list = fromEnv
    ? fromEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_PRECLONE_REPOS;
  if (list.length === 0) return;

  await mkdir(REPO_BASE_DIR, { recursive: true });
  for (const repoUrl of list) {
    const bareDir = join(REPO_BASE_DIR, `${repoSlug(repoUrl)}.git`);
    try {
      console.log(`[workspace] Prewarming ${repoUrl}`);
      await ensureBareRepoReady(repoUrl, bareDir);
      console.log(`[workspace] Prewarmed ${bareDir}`);
    } catch (err) {
      console.warn(`[workspace] Prewarm failed for ${repoUrl}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Ensure a bare clone exists and is up-to-date, then create an isolated
 * git worktree for this session.
 *
 * Layout:
 *   REPO_BASE_DIR/{slug}.git                        -- persistent bare clone
 *   REPO_BASE_DIR/{slug}-worktrees/{sessionPrefix}  -- per-session worktree
 *
 * Returns the absolute path to the worktree directory.
 */
export async function ensureRepoWorktree(repoUrl: string, sessionId: string, agentSlug?: string): Promise<string> {
  await mkdir(REPO_BASE_DIR, { recursive: true });

  const slug = repoSlug(repoUrl);
  const bareDir = join(REPO_BASE_DIR, `${slug}.git`);
  const worktreesDir = join(REPO_BASE_DIR, `${slug}-worktrees`);
  const sessionPrefix = sessionId.slice(0, 8);
  const worktreeDir = join(worktreesDir, sessionPrefix);
  const agentName = agentSlug?.replace(/-agent$/, "") ?? "agent";
  const branch = `fix/${agentName}-${sessionPrefix}`;

  // Step 1: ensure bare clone exists and main is up-to-date.
  // Concurrent calls for the same bareDir share one in-flight setup promise.
  await ensureBareRepoReady(repoUrl, bareDir);

  // Step 2: create worktree with a new branch from main
  await mkdir(worktreesDir, { recursive: true });

  // Delete stale branch if it exists from a previous crashed session
  try {
    await execAsync(`git branch -D ${branch}`, { cwd: bareDir });
    console.log(`[workspace] Cleaned up stale branch ${branch}`);
  } catch { /* branch doesn't exist — fine */ }

  console.log(`[workspace] Creating worktree at ${worktreeDir} on branch ${branch}`);
  // Cut from `origin/main` (a remote-tracking ref) instead of `main` (a local
  // branch). The bare repo no longer has local branches after we switched the
  // fetch refspec to `+refs/heads/*:refs/remotes/origin/*` — only remote-
  // tracking refs are populated. `git worktree add -b <new> <path> origin/main`
  // creates the new branch starting at origin/main's commit.
  await execAsync(`git worktree add -b ${branch} ${worktreeDir} origin/main`, {
    cwd: bareDir,
  });

  console.log(`[workspace] Worktree ready at ${worktreeDir}`);
  return worktreeDir;
}

/**
 * Clean up a git worktree created by ensureRepoWorktree.
 */
export async function deleteRepoWorktree(repoUrl: string, sessionId: string, agentSlug?: string): Promise<void> {
  const slug = repoSlug(repoUrl);
  const bareDir = join(REPO_BASE_DIR, `${slug}.git`);
  const worktreesDir = join(REPO_BASE_DIR, `${slug}-worktrees`);
  const sessionPrefix = sessionId.slice(0, 8);
  const worktreeDir = join(worktreesDir, sessionPrefix);
  const agentName = agentSlug?.replace(/-agent$/, "") ?? "agent";
  const branch = `fix/${agentName}-${sessionPrefix}`;

  // Step 1: remove worktree via git
  try {
    await execAsync(`git worktree remove --force ${worktreeDir}`, { cwd: bareDir });
    console.log(`[workspace] Removed worktree ${worktreeDir}`);
  } catch {
    console.warn(`[workspace] git worktree remove failed, falling back to rm`);
    try {
      await rm(worktreeDir, { recursive: true, force: true });
    } catch {
      console.warn(`[workspace] Failed to rm ${worktreeDir}`);
    }
    try {
      await execAsync("git worktree prune", { cwd: bareDir });
    } catch { /* best effort */ }
  }

  // Step 2: delete the session branch from the bare repo
  try {
    await execAsync(`git branch -D ${branch}`, { cwd: bareDir });
    console.log(`[workspace] Deleted branch ${branch}`);
  } catch {
    // Branch may not exist if setup failed partway through
  }
}

/**
 * Prune stale worktree references for all bare repos under REPO_BASE_DIR.
 * Called on startup to recover from ungraceful shutdowns.
 */
export async function pruneStaleWorktrees(): Promise<void> {
  if (!existsSync(REPO_BASE_DIR)) return;

  try {
    const entries = readdirSync(REPO_BASE_DIR);
    for (const entry of entries) {
      if (!entry.endsWith(".git")) continue;
      const bareDir = join(REPO_BASE_DIR, entry);
      try {
        await execAsync("git worktree prune", { cwd: bareDir });
        console.log(`[workspace] Pruned stale worktrees in ${bareDir}`);
      } catch { /* best effort */ }
    }
  } catch { /* REPO_BASE_DIR may not exist yet */ }
}
