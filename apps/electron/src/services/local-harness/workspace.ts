import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import { homedir } from 'os';
import { isAbsolute, relative, resolve, sep } from 'path';
import log from 'electron-log/main';
import type { LocalHarnessWorkspaceDiff, LocalHarnessWorkspaceSpec } from './contract';

export const WORKSPACE_MAX_PATCH_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_MAX_STAT_BYTES = 20 * 1024;
export const WORKSPACE_LIST_LIMIT = 50;

const GIT_META_TIMEOUT_MS = 3000;
const GIT_DIFF_TIMEOUT_MS = 10000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const TRUNCATION_NOTE = '\n[truncated]\n';

export interface LocalWorkspaceEntry {
  path: string;
  name: string;
  addedAt: string;
}

function runGit(cwd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: GIT_MAX_BUFFER, shell: false, windowsHide: true },
      (err, stdout) => {
        const text = typeof stdout === 'string' ? stdout : String(stdout ?? '');
        resolvePromise({ ok: !err, stdout: text });
      },
    );
  });
}

export function isPathInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function realPathOrNull(target: string): Promise<string | null> {
  try {
    return await fsp.realpath(target);
  } catch {
    return null;
  }
}

export async function isExistingDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function isRejectedWorkspacePath(realPath: string, userDataDir: string): string | null {
  const home = resolve(homedir());
  const root = resolve(sep);
  if (resolve(realPath) === root) return 'filesystem root';
  if (resolve(realPath) === home) return 'home directory';
  if (isPathInside(userDataDir, realPath)) return 'app data directory';
  return null;
}

export async function readGitMetadata(cwd: string): Promise<{ branch?: string; remote?: string }> {
  const meta: { branch?: string; remote?: string } = {};
  const branch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], GIT_META_TIMEOUT_MS);
  if (branch.ok) {
    const value = branch.stdout.trim();
    if (value) meta.branch = value;
  }
  const remote = await runGit(cwd, ['remote', 'get-url', 'origin'], GIT_META_TIMEOUT_MS);
  if (remote.ok) {
    const value = remote.stdout.trim();
    if (value) meta.remote = value;
  }
  return meta;
}

export function buildWorkspacePromptSection(workspace: LocalHarnessWorkspaceSpec): string {
  const branchLine = workspace.branch ? ` (git branch \`${workspace.branch}\`)` : '';
  return [
    '## Repository workspace',
    '',
    `Your working directory is \`${workspace.path}\`${branchLine}.`,
    '',
    "- This is the user's own checkout on their machine. Edit the files in place.",
    '- Do not create files outside this directory.',
    '- Run tests and builds with the shell when they help you verify a change.',
    '- Commit only when the user asks, and never push without being asked.',
    '- Finished files are already visible to the user in the folder, so only use `deliver-files` for things they want in the chat.',
  ].join('\n');
}

function clamp(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const room = maxBytes - Buffer.byteLength(TRUNCATION_NOTE, 'utf8');
  const sliced = Buffer.from(text, 'utf8').subarray(0, Math.max(0, room)).toString('utf8');
  return `${sliced}${TRUNCATION_NOTE}`;
}

function untrackedPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (!line.startsWith('?? ')) continue;
    let value = line.slice(3).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        continue;
      }
    }
    if (value && !value.endsWith('/')) paths.push(value);
  }
  return paths;
}

export async function collectWorkspaceDiff(cwd: string): Promise<LocalHarnessWorkspaceDiff | null> {
  try {
    const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], GIT_DIFF_TIMEOUT_MS);
    if (!inside.ok || inside.stdout.trim() !== 'true') return null;

    const [branchRes, statusRes, statRes, patchRes] = [
      await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], GIT_DIFF_TIMEOUT_MS),
      await runGit(cwd, ['status', '--porcelain'], GIT_DIFF_TIMEOUT_MS),
      await runGit(cwd, ['diff', '--stat', 'HEAD'], GIT_DIFF_TIMEOUT_MS),
      await runGit(cwd, ['diff', 'HEAD'], GIT_DIFF_TIMEOUT_MS),
    ];

    const statusLines = statusRes.stdout.split('\n').filter((line) => line.trim().length > 0);
    const changedFiles = statusLines.length;
    if (changedFiles === 0) return null;

    let patch = patchRes.ok ? patchRes.stdout : '';
    for (const rel of untrackedPaths(statusRes.stdout)) {
      if (Buffer.byteLength(patch, 'utf8') >= WORKSPACE_MAX_PATCH_BYTES) break;
      const added = await runGit(cwd, ['diff', '--no-index', '/dev/null', rel], GIT_DIFF_TIMEOUT_MS);
      const text = added.stdout;
      if (!text || text.includes('Binary files')) continue;
      patch += text;
    }

    return {
      branch: branchRes.ok ? branchRes.stdout.trim() : '',
      changedFiles,
      stat: clamp(statRes.ok ? statRes.stdout : '', WORKSPACE_MAX_STAT_BYTES),
      patch: clamp(patch, WORKSPACE_MAX_PATCH_BYTES),
    };
  } catch (err) {
    log.warn('[LocalHarness] workspace diff collection failed:', err);
    return null;
  }
}
