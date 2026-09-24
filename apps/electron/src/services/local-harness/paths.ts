import { mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

let cached: string | null = null;

export function localHarnessWorkspaceDir(): string {
  if (cached) return cached;
  const dir = join(app.getPath('userData'), 'local-harness', 'workspace');
  mkdirSync(dir, { recursive: true });
  cached = dir;
  return dir;
}

export function localHarnessRunsRoot(): string {
  const dir = join(localHarnessWorkspaceDir(), 'runs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sanitizeRunDirName(conversationId: string): string {
  const cleaned = conversationId.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 128);
  return cleaned || 'run';
}

export function localHarnessRunDir(conversationId: string): string {
  const dir = join(localHarnessRunsRoot(), sanitizeRunDirName(conversationId));
  mkdirSync(dir, { recursive: true });
  return dir;
}
