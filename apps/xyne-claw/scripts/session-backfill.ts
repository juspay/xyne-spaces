#!/usr/bin/env tsx
import { cp, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { gcsListSessionObjects } from "../src/gcs.js";
import { archiveSessionToGcsWithRetries, sessionDir } from "../src/session-store.js";
import { isSessionLockActive } from "../src/session-lock.js";
import { PATHS } from "../src/config.js";

interface Args {
  dir: string;
  dryRun: boolean;
}

interface LocalSummary {
  fileCount: number;
  sizeBytes: number;
  newestMtimeMs: number;
  files: Array<{ path: string; sizeBytes: number; mtimeMs: number }>;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let dir = "/pvc-sessions";
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") {
      dir = args[++i] ?? dir;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }
  return { dir, dryRun };
}

async function summarizeLocal(dir: string): Promise<LocalSummary> {
  const summary: LocalSummary = { fileCount: 0, sizeBytes: 0, newestMtimeMs: 0, files: [] };
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const s = await stat(abs);
        summary.fileCount++;
        summary.sizeBytes += s.size;
        summary.newestMtimeMs = Math.max(summary.newestMtimeMs, s.mtimeMs);
        summary.files.push({ path: rel, sizeBytes: s.size, mtimeMs: s.mtimeMs });
      }
    }
  }
  await walk(dir, "");
  summary.files.sort((a, b) => a.path.localeCompare(b.path));
  return summary;
}

function compareFiles(
  local: LocalSummary,
  remote: Array<{ path: string; sizeBytes: number; updatedMs: number }>,
): { missingPaths: string[]; mismatchedPaths: Array<{ path: string; localSizeBytes: number; gcsSizeBytes: number }> } {
  const remoteByPath = new Map(remote.map((f) => [f.path, f]));
  const missingPaths: string[] = [];
  const mismatchedPaths: Array<{ path: string; localSizeBytes: number; gcsSizeBytes: number }> = [];
  for (const localFile of local.files) {
    const remoteFile = remoteByPath.get(localFile.path);
    if (!remoteFile) {
      missingPaths.push(localFile.path);
    } else if (remoteFile.sizeBytes !== localFile.sizeBytes) {
      mismatchedPaths.push({
        path: localFile.path,
        localSizeBytes: localFile.sizeBytes,
        gcsSizeBytes: remoteFile.sizeBytes,
      });
    }
  }
  return { missingPaths, mismatchedPaths };
}

async function classify(
  conversationId: string,
  local: LocalSummary,
): Promise<{ status: "synced" | "stale-in-gcs" | "missing-from-gcs" | "error"; missingPaths: string[]; mismatchedPaths: Array<{ path: string; localSizeBytes: number; gcsSizeBytes: number }> }> {
  const remote = await gcsListSessionObjects(conversationId);
  if (remote === null) return { status: "error", missingPaths: [], mismatchedPaths: [] };
  const remoteFileCount = remote.length;
  const remoteNewestMs = remote.reduce((max, f) => Math.max(max, f.updatedMs), 0);
  if (remoteFileCount === 0) {
    return { status: "missing-from-gcs", missingPaths: local.files.map((f) => f.path), mismatchedPaths: [] };
  }
  const comparison = compareFiles(local, remote);
  if (comparison.missingPaths.length > 0 || comparison.mismatchedPaths.length > 0 || remoteNewestMs + 2_000 < local.newestMtimeMs) {
    return { status: "stale-in-gcs", ...comparison };
  }
  return { status: "synced", ...comparison };
}

async function archiveFromFallback(conversationId: string, sourceDir: string): Promise<boolean> {
  const target = sessionDir(conversationId);
  await rm(target, { recursive: true, force: true }).catch(() => {});
  await cp(sourceDir, target, { recursive: true });
  try {
    return await archiveSessionToGcsWithRetries(conversationId);
  } finally {
    await rm(target, { recursive: true, force: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const { dir, dryRun } = parseArgs();
  if (!existsSync(dir)) {
    throw new Error(`session dir does not exist: ${dir}`);
  }
  const sourceRoot = path.resolve(dir);
  const activeSessionsRoot = path.resolve(PATHS.dataDir, "sessions");
  if (sourceRoot === activeSessionsRoot) {
    throw new Error(`refusing to backfill from active sessions root: ${sourceRoot}`);
  }

  const totals = { synced: 0, backfilled: 0, skippedLocked: 0, dryRun: 0, failed: 0, error: 0, sessions: 0 };
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes(".stale-")) continue;
    const conversationId = entry.name;
    const source = path.join(dir, conversationId);
    const local = await summarizeLocal(source);
    if (local.fileCount === 0) continue;
    totals.sessions++;

    const classification = await classify(conversationId, local);
    const { status, missingPaths, mismatchedPaths } = classification;
    if (status === "synced") {
      totals.synced++;
      console.log(JSON.stringify({ conversationId, status: "synced" }));
      continue;
    }
    if (status === "error") {
      totals.error++;
      console.log(JSON.stringify({ conversationId, status: "error", reason: "gcs_unavailable", missingPaths, mismatchedPaths }));
      continue;
    }

    const locked = await isSessionLockActive(conversationId);
    if (locked) {
      totals.skippedLocked++;
      console.log(JSON.stringify({ conversationId, status, action: "skipped-locked", missingPaths, mismatchedPaths }));
      continue;
    }
    if (dryRun) {
      totals.dryRun++;
      console.log(JSON.stringify({ conversationId, status, action: "would-backfill", local, missingPaths, mismatchedPaths }));
      continue;
    }

    const ok = await archiveFromFallback(conversationId, source);
    if (ok) {
      totals.backfilled++;
      console.log(JSON.stringify({ conversationId, status, action: "backfilled", local, missingPaths, mismatchedPaths }));
    } else {
      totals.failed++;
      console.log(JSON.stringify({ conversationId, status, action: "failed", local, missingPaths, mismatchedPaths }));
    }
  }
  console.log(JSON.stringify({ totals }));
  if (totals.failed > 0 || totals.error > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
