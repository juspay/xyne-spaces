/**
 * S2S debug-artifact server.
 *
 * Debug artifacts (debug-session.json, debug-events.json, debug-run-*.json,
 * subagents-*.json) are written to THIS pod's PVC under
 * {dataDir}/sessions/<storeKey>/debug. claw-auth runs in a separate pod and
 * cannot see this PVC, so its debugger view must fetch the artifacts from here
 * over S2S instead of reading its own filesystem. If the session was archived
 * to GCS and evicted from the PVC, we lazily restore it first.
 */

import { Router, type Request, type Response } from "express";
import { readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";
import { validateS2SKey } from "../middleware/auth.js";
import { restoreSessionFromArchive } from "../session-store.js";
import { gcsListDebugRuns, gcsDownloadDebugRun } from "../storage.js";
import { isSafeId } from "../safe-id.js";
import { metric } from "../metrics.js";
import { isCaptureFileName, watchdogDir } from "../loop-watchdog.js";

import { createLogger } from "../logger.js";
const log = createLogger("debug");

const router = Router();

function sessionsRoot(): string {
  return path.join(PATHS.dataDir, "sessions");
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Resolve all on-disk session dirs for a RAW conversationId. The dir name is
 * the storeKey, which depending on the caller is `<convId>`,
 * `<convId>_<agentSlug>`, `<userId>_<convId>_<agentSlug>` (agent-chat
 * threads prefix the owner's userId), or the per-user Digital Twin form
 * `<convId>-<userId>_<agentSlug>` (buildSandboxStoreKey hyphen-folds the
 * userId into the conv segment). Match the convId as an exact name, a
 * prefix segment, or an embedded `_`-delimited segment — prefix-only matching
 * 404'd every userId-prefixed thread (prod, 2026-06-12).
 *
 * Branching produces MULTIPLE matching dirs for one conversation: the root
 * `<convId>_<slug>` plus each branch `<convId>__branch__<assistantId>_<slug>`.
 * Both shapes start with `<convId>_`, so the old single-result lookup picked
 * a random one and the debugger lost every run that lived on the others.
 * We return all matches so the caller can merge their debug artifacts.
 *
 * The returned root dir (`<convId>_<slug>` without `__branch__`) is FIRST in
 * the list — callers that need a single "primary" dir for storeKey-style
 * uses (e.g. GCS listing) pick the head, and it's stable across calls.
 */
function resolveSessionDirs(convId: string): string[] {
  const root = sessionsRoot();
  const matches = new Set<string>();
  const exact = path.join(root, convId);
  if (existsSync(exact)) matches.add(exact);
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      if (
        name === convId ||
        name.startsWith(`${convId}_`) ||
        // Per-user Digital Twin fold: buildSandboxStoreKey joins the userId to
        // the conv segment with a HYPHEN (`<convId>-<userId>_<slug>`), so the
        // char after convId is `-` not `_` and none of the other patterns hit.
        // Without this clause every twin session 404'd here even though the
        // dir sat on the PVC (the GCS-restore fallback below already knew the
        // form, but it re-resolves through this matcher and inherited the miss).
        name.startsWith(`${convId}-`) ||
        name.includes(`_${convId}_`) ||
        name.endsWith(`_${convId}`)
      ) {
        matches.add(path.join(root, name));
      }
    }
  } catch {
    // sessions root may not exist yet
  }
  // Stable ordering: root (non-branch) dirs first, then branches. Callers
  // that need one "primary" dir (e.g. for GCS storeKey heuristics) get the
  // root deterministically.
  return [...matches].sort((a, b) => {
    const aBranch = path.basename(a).includes("__branch__");
    const bBranch = path.basename(b).includes("__branch__");
    if (aBranch !== bBranch) return aBranch ? 1 : -1;
    return a.localeCompare(b);
  });
}

async function readSubagentArtifacts(
  debugDirs: string[],
): Promise<Array<{ fileName: string; data: Record<string, unknown> }>> {
  const artifacts = await Promise.all(
    debugDirs.map(async (debugDir) => {
      try {
        const entries = await readdir(debugDir, { withFileTypes: true });
        return await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.startsWith("subagents-") && entry.name.endsWith(".json"))
            .map(async (entry) => {
              const data = await readJsonIfExists<Record<string, unknown>>(path.join(debugDir, entry.name));
              return data ? { fileName: `${path.basename(path.dirname(debugDir))}/${entry.name}`, data } : null;
            }),
        );
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  return artifacts.flat().filter((item): item is { fileName: string; data: Record<string, unknown> } => {
    if (!item) return false;
    const key = `${String(item.data["parentSessionId"] ?? "")}:${String(item.data["parentToolCallId"] ?? "")}:${String(item.data["subagentName"] ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// GET /internal/sessions/:convId/debug?agentSlug=<slug>
// Serves the debugger artifacts for a conversation from this pod's PVC.
router.get("/internal/sessions/:convId/debug", validateS2SKey, async (req: Request<{ convId: string }>, res: Response) => {
  try {
    const { convId } = req.params;
    const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : undefined;
    // All three ids end up in filesystem paths under the sessions root —
    // reject anything outside the safe charset before touching the disk.
    if (!isSafeId(convId) || (agentSlug !== undefined && !isSafeId(agentSlug)) || (userId !== undefined && !isSafeId(userId))) {
      res.status(400).json({ success: false, error: "Invalid conversation id, agent slug, or user id" });
      return;
    }

    let sessionDirPaths = resolveSessionDirs(convId);
    if (sessionDirPaths.length === 0) {
      // Not on the PVC — try restoring from the GCS archive under every
      // storeKey form claw uses on disk: `<convId>`, `<convId>_<agentSlug>`,
      // the agent-chat form `<userId>_<convId>_<agentSlug>`, and the per-user
      // Digital Twin form `<convId>-<userId>_<agentSlug>` (buildSandboxStoreKey
      // folds userId into the conv segment for agentSlug==="digital-twin").
      const keys = [
        convId,
        ...(agentSlug ? [`${convId}_${agentSlug}`] : []),
        ...(userId ? [`${userId}_${convId}`] : []),
        ...(userId && agentSlug ? [`${userId}_${convId}_${agentSlug}`] : []),
        ...(userId && agentSlug ? [`${convId}-${userId}_${agentSlug}`] : []),
      ];
      for (const k of keys) {
        if (await restoreSessionFromArchive(k).catch(() => false)) break;
      }
      sessionDirPaths = resolveSessionDirs(convId);
    }

    if (sessionDirPaths.length === 0) {
      res.status(404).json({ success: false, error: "Debug artifacts not found" });
      return;
    }

    // Branching: one conversation can have many session dirs — the root
    // `<convId>_<slug>` plus each branch `<convId>__branch__<assistantId>_<slug>`.
    // The debugger needs runs from ALL of them merged into one bundle so it
    // can pin by AgentRun.sessionId across branches.
    const debugDirs = sessionDirPaths
      .map((p) => path.join(p, "debug"))
      .filter((d) => existsSync(d));
    if (debugDirs.length === 0) {
      res.status(404).json({ success: false, error: "Debug artifacts not found" });
      return;
    }

    const primaryDebugDir = debugDirs[0]!;
    // debug-session.json + debug-events.json are per-session-dir and represent
    // the LATEST live trace recorded in that dir. The frontend treats these as
    // "live" info; for branched conversations the most useful one is the root.
    // Pick the primary (root preferred by resolveSessionDirs ordering).
    const debugSession = await readJsonIfExists<Record<string, unknown>>(path.join(primaryDebugDir, "debug-session.json"));
    const debugEvents = await readJsonIfExists<Record<string, unknown>[]>(path.join(primaryDebugDir, "debug-events.json"));

    // Aggregate debug-run-*.json files across every matching dir. The same
    // run file name only ever exists in one dir (it's session-id scoped), so
    // a plain Map by fileName is enough to dedupe.
    const runsByName = new Map<string, { fileName: string; data: Record<string, unknown> }>();
    for (const dir of debugDirs) {
      const dirEntries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of dirEntries) {
        if (!entry.isFile() || !entry.name.startsWith("debug-run-") || !entry.name.endsWith(".json")) continue;
        const data = await readJsonIfExists<Record<string, unknown>>(path.join(dir, entry.name));
        if (data && !runsByName.has(entry.name)) {
          runsByName.set(entry.name, { fileName: entry.name, data });
        }
      }
    }
    const runs = [...runsByName.values()];

    // Per-run snapshots now live in GCS (claw-debug-runs/<storeKey>/) instead
    // of the PVC — see agent.ts. Merge them in per storeKey (one per session
    // dir), newest first, capped TOTAL so a long-running thread doesn't turn
    // this endpoint into a bulk download.
    const MAX_GCS_RUNS = 50;
    const localNames = new Set(runs.map((r) => r.fileName));
    const gcsCandidates: Array<{ storeKey: string; name: string }> = [];
    for (const dir of debugDirs) {
      const storeKey = path.basename(path.dirname(dir));
      const gcsNames = (await gcsListDebugRuns(storeKey)) ?? [];
      for (const name of gcsNames) {
        if (!name.startsWith("debug-run-") || !name.endsWith(".json")) continue;
        if (localNames.has(name)) continue;
        gcsCandidates.push({ storeKey, name });
      }
    }
    // Filename starts with a millisecond timestamp; sort descending is
    // newest-first, even across mixed storeKeys.
    gcsCandidates.sort((a, b) => b.name.localeCompare(a.name));
    if (gcsCandidates.length > MAX_GCS_RUNS) {
      log.info(`[debug] ${convId}: serving newest ${MAX_GCS_RUNS} of ${gcsCandidates.length} GCS debug runs across ${debugDirs.length} dir(s)`);
    }
    const newest = gcsCandidates.slice(0, MAX_GCS_RUNS);
    const gcsRuns = (
      await Promise.all(
        newest.map(async ({ storeKey, name }) => {
          const buf = await gcsDownloadDebugRun(storeKey, name);
          if (!buf) return null;
          try {
            return { fileName: name, data: JSON.parse(buf.toString("utf8")) as Record<string, unknown> };
          } catch {
            return null;
          }
        }),
      )
    ).filter((x): x is { fileName: string; data: Record<string, unknown> } => x !== null);
    runs.push(...gcsRuns);

    // Subagent artifacts can live under the parent session's debug dir AND under
    // each referenced parent sessionId's dir (mirrors claw-auth's old logic).
    const parentSessionIds = new Set<string>();
    const collect = (d: Record<string, unknown> | null): void => {
      const id = d && typeof d["sessionId"] === "string" ? d["sessionId"] : "";
      // sessionIds come from artifact file contents, not the request — still
      // joined into paths below, so apply the same charset guard.
      if (id && isSafeId(id)) parentSessionIds.add(id);
    };
    collect(debugSession);
    for (const r of runs) collect(r.data);
    const root = sessionsRoot();
    const subagentDebugDirs = [...debugDirs, ...[...parentSessionIds].map((id) => path.join(root, id, "debug"))];
    const subagents = await readSubagentArtifacts(subagentDebugDirs);

    res.json({
      success: true,
      data: { conversationId: convId, debugDir: primaryDebugDir, debugSession, debugEvents, runs, subagents },
    });
  } catch (err) {
    log.error("[debug] artifacts error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.get("/debug/loop-watchdog", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const dir = watchdogDir();
    const requested = typeof req.query["file"] === "string" ? req.query["file"] : undefined;

    if (requested !== undefined) {
      if (!isCaptureFileName(requested)) {
        res.status(400).json({ success: false, error: "Invalid capture file name" });
        return;
      }
      const filePath = path.join(dir, requested);
      if (!existsSync(filePath)) {
        res.status(404).json({ success: false, error: "Capture not found" });
        return;
      }
      res.type("application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${requested}"`);
      createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
      return;
    }

    const names = await readdir(dir).catch(() => [] as string[]);
    const captures = names
      .filter(isCaptureFileName)
      .sort()
      .reverse()
      .map((name) => {
        let size: number | null = null;
        let mtime: string | null = null;
        try {
          const s = statSync(path.join(dir, name));
          size = s.size;
          mtime = s.mtime.toISOString();
        } catch {
          size = null;
        }
        return { name, size, mtime };
      });

    res.json({ success: true, data: { dir, captures } });
  } catch (err) {
    log.error("[debug] loop-watchdog error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as debugRouter };
