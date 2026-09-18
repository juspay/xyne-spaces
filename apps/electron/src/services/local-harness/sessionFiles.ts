import { promises as fs, realpathSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const MAX_SESSION_BYTES = 32 * 1024 * 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

export function codexSessionsRoot(): string {
  return join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'sessions');
}

export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function claudeProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

async function walk(dir: string, depth: number, match: (name: string) => boolean): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(entry.name);
    } else if (entry.isFile() && match(entry.name)) {
      return join(dir, entry.name);
    }
  }
  if (depth <= 0) return null;
  for (const name of dirs) {
    const found = await walk(join(dir, name), depth - 1, match);
    if (found) return found;
  }
  return null;
}

export async function locateCodexSession(threadId: string): Promise<string | null> {
  if (!isValidSessionId(threadId)) return null;
  const suffix = `-${threadId}.jsonl`;
  return walk(codexSessionsRoot(), 3, (name) => name.endsWith(suffix));
}

export function codexSessionWritePath(threadId: string, now: Date = new Date()): string | null {
  if (!isValidSessionId(threadId)) return null;
  const pad = (value: number): string => String(value).padStart(2, '0');
  const year = String(now.getFullYear());
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const stamp = `${year}-${month}-${day}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return join(codexSessionsRoot(), year, month, day, `rollout-${stamp}-${threadId}.jsonl`);
}

function claudeCandidateDirs(cwd: string): string[] {
  const dirs = [join(claudeProjectsRoot(), claudeProjectSlug(cwd))];
  try {
    const real = realpathSync(cwd);
    if (real !== cwd) dirs.push(join(claudeProjectsRoot(), claudeProjectSlug(real)));
  } catch {
    return dirs;
  }
  return dirs;
}

export async function locateClaudeSession(sessionId: string, cwd: string): Promise<string | null> {
  if (!isValidSessionId(sessionId)) return null;
  for (const dir of claudeCandidateDirs(cwd)) {
    const candidate = join(dir, `${sessionId}.jsonl`);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function claudeSessionWritePath(sessionId: string, cwd: string): string | null {
  if (!isValidSessionId(sessionId)) return null;
  return join(claudeProjectsRoot(), claudeProjectSlug(cwd), `${sessionId}.jsonl`);
}
