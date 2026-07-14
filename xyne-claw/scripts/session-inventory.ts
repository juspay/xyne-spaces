#!/usr/bin/env tsx
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { gcsListSessionObjects } from "../src/gcs.js";

interface Args {
  dir: string;
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir") {
      dir = args[++i] ?? dir;
    }
  }
  return { dir };
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

async function main(): Promise<void> {
  const { dir } = parseArgs();
  if (!existsSync(dir)) {
    throw new Error(`session dir does not exist: ${dir}`);
  }

  const totals = { synced: 0, stale: 0, missing: 0, error: 0, sessions: 0, files: 0, bytes: 0 };
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes(".stale-")) continue;
    const conversationId = entry.name;
    const local = await summarizeLocal(path.join(dir, conversationId));
    if (local.fileCount === 0) continue;
    totals.sessions++;
    totals.files += local.fileCount;
    totals.bytes += local.sizeBytes;

    const remote = await gcsListSessionObjects(conversationId);
    if (remote === null) {
      totals.error++;
      console.log(JSON.stringify({ conversationId, status: "error", reason: "gcs_unavailable", local }));
      continue;
    }
    const remoteFileCount = remote.length;
    const remoteSizeBytes = remote.reduce((sum, f) => sum + f.sizeBytes, 0);
    const remoteNewestMs = remote.reduce((max, f) => Math.max(max, f.updatedMs), 0);
    const comparison = compareFiles(local, remote);
    const status = remoteFileCount === 0
      ? "missing-from-gcs"
      : comparison.missingPaths.length > 0 || comparison.mismatchedPaths.length > 0 || remoteNewestMs + 2_000 < local.newestMtimeMs
        ? "stale-in-gcs"
        : "synced";
    if (status === "synced") totals.synced++;
    else if (status === "missing-from-gcs") totals.missing++;
    else totals.stale++;
    console.log(JSON.stringify({
      conversationId,
      status,
      local: { fileCount: local.fileCount, sizeBytes: local.sizeBytes, newestMtimeMs: local.newestMtimeMs },
      gcs: { fileCount: remoteFileCount, sizeBytes: remoteSizeBytes, newestUpdatedMs: remoteNewestMs },
      missingPaths: comparison.missingPaths,
      mismatchedPaths: comparison.mismatchedPaths,
    }));
  }
  console.log(JSON.stringify({ totals }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
