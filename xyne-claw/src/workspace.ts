/**
 * Per-session workspace management.
 *
 * Creates an isolated directory for each agent session under {dataDir}/workspaces/{sessionId}.
 * The agent runs inside this directory. Cleaned up after the result is sent.
 */

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./config.js";

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

export async function deleteWorkspace(sessionId: string): Promise<void> {
  const dir = workspacePath(sessionId);
  try {
    await rm(dir, { recursive: true, force: true });
    console.log(`[workspace] Deleted ${dir}`);
  } catch (err) {
    console.warn(`[workspace] Failed to delete ${dir}:`, err);
  }
}
