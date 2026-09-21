/**
 * S2S debug-artifact server.
 *
 * Debug artifacts are written to THIS pod's PVC under
 * {dataDir}/sessions/<storeKey>/debug. claw-auth runs in a separate pod and
 * cannot see this PVC, so its debugger view must fetch them over S2S instead of
 * reading its own filesystem.
 *
 * The retrieval rule this file exists to enforce: **a run that exists anywhere
 * must never come back as "not found"**. Every previous 404 came from one lookup
 * being treated as authoritative — a storeKey guess that missed a branch/twin
 * key, a session dir that existed but had no `debug/`, a run that had been
 * uploaded to GCS and evicted from the PVC. So the lookup is LAYERED, and each
 * layer only ADDS runs:
 *
 *   1. PVC          — new-format run dirs + legacy `debug-run-*.json`
 *   2. GCS index    — `_index/<convId>/<runId>~<storeKey>.json` markers, written
 *                     at run START; the storeKey is in the name, so this layer
 *                     is authoritative rather than a guess
 *   3. GCS runs     — per storeKey (index ∪ guessed ∪ on-disk), v1 snapshots and
 *                     packed v2 objects
 *   4. Archive      — only when 1–3 found nothing: restore from the session
 *                     archive and redo layer 1
 *
 * 404 therefore means "genuinely nothing anywhere", and everything swallowed on
 * the way there is reported in `warnings` — silent degradation is how a partial
 * trace passes for a complete one.
 */

import { Router, type Request, type Response } from "express";
import type { Dirent } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";
import { validateS2SKey } from "../middleware/auth.js";
import { restoreSessionFromArchive } from "../session-store.js";
import {
  gcsDirectConfigured,
  gcsDownloadDebugObject,
  gcsDownloadDebugRun,
  gcsListDebugIndex,
  gcsListDebugRuns,
} from "../storage.js";
import { isSafeId } from "../safe-id.js";
import { metric } from "../metrics.js";
import { isCaptureFileName, watchdogDir } from "../loop-watchdog.js";
import {
  candidateStoreKeys,
  compareRunIdsNewestFirst,
  debugDirFor,
  isStartingRunObjectName,
  listRunDirs,
  packedRunObjectName,
  parseIndexObjectName,
  parsePackedRunObjectName,
  parseRunFileName,
  readRun,
  runFileNameFor,
  safeRunToken,
  sessionDirMatchesConversation,
  startingRunObjectName,
  toV1Snapshot,
  toV2Run,
  unpackRun,
  type BlobLine,
  type ReadRun,
  type RunHeader,
} from "../debug/index.js";

import { createLogger } from "../logger.js";
const log = createLogger("debug");

const router = Router();

function sessionsRoot(): string {
  return path.join(PATHS.dataDir, "sessions");
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * Warnings are a diagnostic channel, not a log: they ride back on the response
 * so the debugger can say "this trace is partial and here is why". Deduped and
 * capped so one GCS outage across a dozen storeKeys doesn't produce a dozen
 * identical lines (or an unbounded payload).
 */
const MAX_WARNINGS = 60;

function pushWarning(warnings: string[], message: string): void {
  if (warnings.length >= MAX_WARNINGS || warnings.includes(message)) return;
  warnings.push(message);
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

// ── Run discovery ───────────────────────────────────────────────────────────

/**
 * Where a run was found. Ranked: a local new-format run beats a GCS copy, and
 * the start-of-run placeholder is dead last — it is a header with zero events,
 * written so a run that never finished is still *discoverable*, never so it can
 * stand in for a copy that has a trace in it.
 */
type RunSource = "pvc" | "pvc-legacy" | "gcs" | "gcs-starting";

const SOURCE_RANK: Record<RunSource, number> = {
  pvc: 0,
  "pvc-legacy": 1,
  gcs: 2,
  "gcs-starting": 3,
};

export interface RunLocation {
  runId: string;
  /** Legacy v1 artifact name — the identity every existing reader keys on. */
  fileName: string;
  storeKey: string;
  source: RunSource;
  /** New-format run dir on the PVC (`…/debug/runs/<runId>`). */
  runDir?: string;
  /** Legacy v1 snapshot file on the PVC. */
  filePath?: string;
  /** This sighting came from a GCS discovery marker rather than a real listing. */
  viaIndex?: boolean;
  /** EVERY sighting was a marker — nothing anywhere claims the bytes exist. */
  indexOnly?: boolean;
  /**
   * Subagent/delegated child run, per its header. `undefined` = the header has
   * not been read yet (a GCS-only run), which the caller treats as a parent
   * until hydration proves otherwise.
   */
  isChild?: boolean;
  /** Parent run this child belongs to, when its header named one. */
  parentRunId?: string;
}

/**
 * Dedupe by runId — the same run legitimately appears on the PVC, in the GCS
 * index and in the GCS run listing — keeping the richest copy, then order
 * newest-first by the epoch inside the runId (never by filename string: a
 * 13-digit epoch and a 14-digit one sort backwards lexically).
 */
export function mergeRunLocations(locations: readonly RunLocation[]): RunLocation[] {
  const best = new Map<string, RunLocation>();
  // Parentage and index-only-ness are properties of the RUN, not of whichever
  // sighting happened to win the rank comparison: only the PVC sighting has a
  // header to read, and only the marker sighting knows it came from a marker.
  const classified = new Map<string, { isChild: boolean; parentRunId?: string }>();
  const corroborated = new Set<string>();

  for (const loc of locations) {
    if (loc.viaIndex !== true) corroborated.add(loc.runId);
    if (loc.isChild !== undefined && !classified.has(loc.runId)) {
      classified.set(loc.runId, {
        isChild: loc.isChild,
        ...(loc.parentRunId !== undefined ? { parentRunId: loc.parentRunId } : {}),
      });
    }
    const prev = best.get(loc.runId);
    if (!prev || SOURCE_RANK[loc.source] < SOURCE_RANK[prev.source]) best.set(loc.runId, loc);
  }

  return [...best.values()]
    .map((loc) => ({
      ...loc,
      ...(classified.get(loc.runId) ?? {}),
      ...(corroborated.has(loc.runId) ? {} : { indexOnly: true }),
    }))
    .sort((a, b) => compareRunIdsNewestFirst(a.runId, b.runId));
}

/**
 * Split discovered runs into turns and subagent children.
 *
 * A child run is a run — it has its own header, events and blobs — but it is
 * NOT a turn. Left in `runs[]` it renders as a phantom "Turn N" in the drawer,
 * and worse, it eats the page budget and evicts the real turn it was spawned
 * from. An unclassified run counts as a parent: we cannot prove otherwise
 * without its header, and hydration re-checks.
 */
export function partitionRunLocations(locations: readonly RunLocation[]): {
  parents: RunLocation[];
  children: RunLocation[];
} {
  const parents: RunLocation[] = [];
  const children: RunLocation[] = [];
  for (const loc of locations) (loc.isChild === true ? children : parents).push(loc);
  return { parents, children };
}

/**
 * Ceiling on child runs hydrated alongside one page. A single turn can spawn
 * dozens of subagents; without a cap, "page of 25 turns" is an unbounded
 * download by another name.
 */
export const MAX_CHILD_RUNS_PER_PAGE = 100;

/**
 * The children belonging to the turns on this page.
 *
 * Matched by `parentRunId`. A child whose header never recorded one is kept
 * regardless: the drawer keys those off `parentSessionId`, and dropping them
 * would lose the trace entirely — but they are matched last so a real parent's
 * children never lose their slot to one.
 */
export function childrenForPage(
  children: readonly RunLocation[],
  page: readonly RunLocation[],
  cap: number = MAX_CHILD_RUNS_PER_PAGE,
): { hydrate: RunLocation[]; withheld: number } {
  const pageIds = new Set(page.map((p) => p.runId));
  const matched = children.filter((c) => c.parentRunId !== undefined && pageIds.has(c.parentRunId));
  const unattached = children.filter((c) => c.parentRunId === undefined);
  const ordered = [...matched, ...unattached];
  return { hydrate: ordered.slice(0, cap), withheld: Math.max(0, ordered.length - cap) };
}

/**
 * Session dirs belonging to `convId`, root dirs before branch dirs.
 *
 * One conversation legitimately owns several dirs: the root `<convId>_<slug>`
 * plus each branch `<convId>__branch__<assistantId>_<slug>`. Callers that need
 * a single "primary" dir take the head, which is stable across calls.
 */
export function orderSessionDirNames(names: readonly string[], convId: string): string[] {
  return names
    .filter((n) => sessionDirMatchesConversation(n, convId))
    .sort((a, b) => {
      const aBranch = a.includes("__branch__");
      const bBranch = b.includes("__branch__");
      if (aBranch !== bBranch) return aBranch ? 1 : -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
}

async function listSessionDirNames(warnings: string[]): Promise<string[]> {
  try {
    const entries = await readdir(sessionsRoot(), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    // A pod that has never run anything has no sessions root — that is not a
    // degradation. Anything else is.
    if (!isEnoent(err)) pushWarning(warnings, `sessions root unreadable: ${errText(err)}`);
    return [];
  }
}

/** Mirrors `SESSION_FILE` in debug/store.ts — the per-run header. */
const RUN_HEADER_FILE = "session.json";

/**
 * Read ONLY the header of an on-disk run, to learn whether it is a turn or a
 * subagent child.
 *
 * This has to happen during discovery, before pagination, and that is the
 * awkward part: you cannot know a run is a child until something reads its
 * header, but reading whole runs before paginating is exactly the cost
 * pagination exists to avoid. The header is the cheap half — one small
 * `session.json`, versus `events.jsonl` + `blobs.jsonl` that routinely run to
 * megabytes — so classification pays a per-run stat-and-parse and hydration
 * still only touches the page.
 */
async function classifyRunDir(runDir: string): Promise<Pick<RunLocation, "isChild" | "parentRunId">> {
  const header = await readJsonIfExists<Partial<RunHeader>>(path.join(runDir, RUN_HEADER_FILE));
  // An unreadable header leaves the run unclassified rather than guessing:
  // hydration will read it properly and can still demote it.
  if (!header) return {};
  const parentRunId = typeof header.parentRunId === "string" ? header.parentRunId : undefined;
  const isChild = parentRunId !== undefined || typeof header.parentToolCallId === "string";
  return { isChild, ...(parentRunId !== undefined ? { parentRunId } : {}) };
}

async function collectPvcLocations(storeKey: string, warnings: string[]): Promise<RunLocation[]> {
  const debugDir = debugDirFor(storeKey);
  const out: RunLocation[] = [];

  const runDirs = await listRunDirs(debugDir);
  const classes = await Promise.all(runDirs.map((d) => classifyRunDir(d)));
  for (const [i, runDir] of runDirs.entries()) {
    const runId = path.basename(runDir);
    out.push({
      runId,
      fileName: runFileNameFor(runId),
      storeKey,
      source: "pvc",
      runDir,
      ...(classes[i] ?? {}),
    });
  }

  const entries = await readdir(debugDir, { withFileTypes: true }).catch((err: unknown) => {
    if (!isEnoent(err)) pushWarning(warnings, `debug dir ${storeKey} unreadable: ${errText(err)}`);
    return [] as Dirent[];
  });
  for (const e of entries) {
    if (!e.isFile() || !e.name.startsWith("debug-run-") || !e.name.endsWith(".json")) continue;
    // A legacy name that doesn't parse still identifies a run: fall back to the
    // raw token rather than dropping an artifact that is sitting right there.
    const runId = parseRunFileName(e.name)?.runId ?? e.name.slice("debug-run-".length, -".json".length);
    if (!runId) continue;
    out.push({
      runId,
      fileName: e.name,
      storeKey,
      source: "pvc-legacy",
      filePath: path.join(debugDir, e.name),
    });
  }
  return out;
}

/**
 * Layer 2: the discovery markers. Their names carry the run's REAL storeKey, so
 * branch keys, per-user twin keys and userId-prefixed keys need no guessing.
 */
async function collectIndexLocations(
  convId: string,
  warnings: string[],
): Promise<{ locations: RunLocation[]; storeKeys: string[] }> {
  const names = await gcsListDebugIndex(convId);
  if (names === null) {
    // A pod with no object store is a supported deployment, not a degraded one:
    // warning here painted every healthy local-dev run as a partial trace.
    if (gcsDirectConfigured()) {
      pushWarning(warnings, "GCS discovery index unavailable; falling back to storeKey guessing");
    }
    return { locations: [], storeKeys: [] };
  }
  const locations: RunLocation[] = [];
  const storeKeys: string[] = [];
  for (const name of names) {
    const parsed = parseIndexObjectName(name);
    if (!parsed) {
      pushWarning(warnings, `unparsable discovery marker ${name}`);
      continue;
    }
    storeKeys.push(parsed.storeKey);
    locations.push({
      runId: parsed.runId,
      fileName: runFileNameFor(parsed.runId),
      storeKey: parsed.storeKey,
      source: "gcs",
      viaIndex: true,
    });
  }
  return { locations, storeKeys: unique(storeKeys) };
}

/**
 * Object names under one storeKey → locations. Pure, because the one thing that
 * must not regress here is how a start-of-run placeholder ranks against a real
 * artifact.
 */
export function gcsLocationsFromNames(storeKey: string, names: readonly string[]): RunLocation[] {
  const out: RunLocation[] = [];
  for (const name of names) {
    // Checked BEFORE the generic `debug-run-*.json` branch: a placeholder also
    // ends in `.json`, and the generic parse would mint the phantom runId
    // `<runId>.starting` — a second, empty row for a run that already exists.
    if (isStartingRunObjectName(name)) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      const runId = base.slice("debug-run-".length, -".starting.json".length);
      if (runId) out.push({ runId, fileName: runFileNameFor(runId), storeKey, source: "gcs-starting" });
      continue;
    }
    if (name.startsWith("debug-run-") && name.endsWith(".json")) {
      const runId = parseRunFileName(name)?.runId ?? name.slice("debug-run-".length, -".json".length);
      if (runId) out.push({ runId, fileName: name, storeKey, source: "gcs" });
      continue;
    }
    // A run whose v1 upload failed but whose packed v2 object landed is still a
    // run; hydration knows how to read it.
    const packed = parsePackedRunObjectName(name);
    if (packed) {
      out.push({ runId: packed.runId, fileName: runFileNameFor(packed.runId), storeKey, source: "gcs" });
    }
  }
  return out;
}

async function collectGcsLocations(storeKey: string, warnings: string[]): Promise<RunLocation[]> {
  const names = await gcsListDebugRuns(storeKey);
  if (names === null) {
    // Same reasoning as the index listing: "not configured" is not a failure.
    if (gcsDirectConfigured()) pushWarning(warnings, `GCS run listing unavailable for ${storeKey}`);
    return [];
  }
  return gcsLocationsFromNames(storeKey, names);
}

// ── Pagination ──────────────────────────────────────────────────────────────

export const DEFAULT_RUN_LIMIT = 25;
export const MAX_RUN_LIMIT = 100;

export function parseRunLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RUN_LIMIT;
  return Math.min(Math.floor(n), MAX_RUN_LIMIT);
}

export interface RunPage<T> {
  page: T[];
  totalRuns: number;
  truncated: boolean;
  /** Runs OLDER than this page — what a `before` cursor would fetch next. */
  remaining: number;
}

/**
 * Cursor pagination over the newest-first list. `before` is a runId: the page
 * starts at the run immediately OLDER than it, so a caller can walk a long
 * thread instead of hitting a silent cap. A cursor that no longer resolves to a
 * known run still positions correctly — we fall back to the epoch comparison.
 */
export function paginateRuns<T extends { runId: string }>(
  sorted: readonly T[],
  limit: number,
  before?: string,
): RunPage<T> {
  let start = 0;
  if (before !== undefined) {
    const exact = sorted.findIndex((r) => r.runId === before);
    if (exact >= 0) {
      start = exact + 1;
    } else {
      // Cursor no longer in the list (run aged out, or a client-held id): take
      // the first run that sorts strictly older than it.
      const older = sorted.findIndex((r) => compareRunIdsNewestFirst(before, r.runId) < 0);
      start = older >= 0 ? older : sorted.length;
    }
  }
  const page = sorted.slice(start, start + limit);
  const remaining = sorted.length - (start + page.length);
  return { page, totalRuns: sorted.length, truncated: remaining > 0, remaining };
}

// ── Hydration ───────────────────────────────────────────────────────────────

/**
 * Total bytes of re-inlined transcript we are willing to materialize for ONE
 * response. materialize.ts budgets per run; a page of 25 runs each taking the
 * default 8 MB would be 200 MB of JSON, so the budget is split across the page.
 */

interface HydratedRun {
  loc: RunLocation;
  /** Present when the full v2 run was readable (PVC dir or packed GCS object). */
  run?: ReadRun;
  snapshot: Record<string, unknown>;
}

async function readRunFromDisk(loc: RunLocation, warnings: string[]): Promise<ReadRun | null> {
  if (!loc.runDir) return null;
  try {
    const run = await readRun(loc.runDir);
    if (!run) {
      pushWarning(warnings, `run ${loc.runId}: header missing or unreadable on disk`);
      return null;
    }
    for (const w of run.warnings) pushWarning(warnings, `run ${loc.runId}: ${w}`);
    return run;
  } catch (err) {
    pushWarning(warnings, `run ${loc.runId}: unreadable on disk (${errText(err)})`);
    return null;
  }
}

async function readPackedFromGcs(loc: RunLocation, warnings: string[]): Promise<ReadRun | null> {
  const buf = await gcsDownloadDebugObject(`${loc.storeKey}/${packedRunObjectName(loc.runId)}`);
  if (!buf) return null;
  const run = unpackRun(buf);
  if (!run) {
    pushWarning(warnings, `run ${loc.runId}: packed GCS object unreadable`);
    return null;
  }
  for (const w of run.warnings) pushWarning(warnings, `run ${loc.runId}: ${w}`);
  return run;
}

async function parseV1(
  buf: Buffer | null,
  loc: RunLocation,
  warnings: string[],
): Promise<Record<string, unknown> | null> {
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
  } catch (err) {
    pushWarning(warnings, `run ${loc.runId}: GCS snapshot is not valid JSON (${errText(err)})`);
    return null;
  }
}

async function readV1FromGcs(loc: RunLocation, warnings: string[]): Promise<Record<string, unknown> | null> {
  return parseV1(await gcsDownloadDebugRun(loc.storeKey, loc.fileName), loc, warnings);
}

async function readStartingFromGcs(loc: RunLocation, warnings: string[]): Promise<Record<string, unknown> | null> {
  return parseV1(
    await gcsDownloadDebugObject(`${loc.storeKey}/${startingRunObjectName(loc.runId)}`),
    loc,
    warnings,
  );
}

/**
 * The artifact sources hydration walks, most-complete first. Injected rather
 * than called directly because the ORDER is the correctness property — a
 * header-only copy winning over one with events is the exact bug this shape
 * exists to keep tested.
 */
export interface RunArtifactSources {
  localRun(loc: RunLocation, warnings: string[]): Promise<ReadRun | null>;
  localV1(loc: RunLocation, warnings: string[]): Promise<Record<string, unknown> | null>;
  packedRun(loc: RunLocation, warnings: string[]): Promise<ReadRun | null>;
  remoteV1(loc: RunLocation, warnings: string[]): Promise<Record<string, unknown> | null>;
  startingV1(loc: RunLocation, warnings: string[]): Promise<Record<string, unknown> | null>;
}

export const defaultRunArtifactSources: RunArtifactSources = {
  localRun: readRunFromDisk,
  localV1: async (loc, warnings) => {
    if (!loc.filePath) return null;
    const data = await readJsonIfExists<Record<string, unknown>>(loc.filePath);
    if (!data) pushWarning(warnings, `run ${loc.runId}: local snapshot ${loc.fileName} unreadable`);
    return data;
  },
  packedRun: readPackedFromGcs,
  remoteV1: readV1FromGcs,
  startingV1: readStartingFromGcs,
};

/**
 * Everything that discovered this run turned out to be a marker, and the bytes
 * are gone — the shape `/clear` leaves behind. Distinguished from a genuine
 * read failure because the caller drops these from the response entirely
 * instead of reporting a run it cannot show.
 */
function pushMissingWarning(loc: RunLocation, warnings: string[]): void {
  if (loc.indexOnly === true) {
    pushWarning(warnings, `run ${loc.runId}: discovery marker with no surviving artifact (session cleared?); dropped`);
  } else {
    pushWarning(warnings, `run ${loc.runId}: discovered but no readable artifact on PVC or GCS`);
  }
}

/** Every source in richest-first order; the run is only "missing" if all miss. */
export async function hydrateV1(
  loc: RunLocation,
  warnings: string[],
  src: RunArtifactSources = defaultRunArtifactSources,
): Promise<HydratedRun | null> {
  const local = await src.localRun(loc, warnings);
  if (local) {
    return { loc, run: local, snapshot: toV1Snapshot(local) as unknown as Record<string, unknown> };
  }
  const localV1 = await src.localV1(loc, warnings);
  if (localV1) return { loc, snapshot: localV1 };
  // Packed v2 BEFORE the remote v1 snapshot. Both legitimately exist for one
  // run, and the v1 object may be a truncated upload — or, before it moved to
  // its own name, the header-only start placeholder — so preferring it served
  // an empty trace for a run whose events were sitting right there.
  const packed = await src.packedRun(loc, warnings);
  if (packed) {
    return { loc, run: packed, snapshot: toV1Snapshot(packed) as unknown as Record<string, unknown> };
  }
  const remote = await src.remoteV1(loc, warnings);
  if (remote) return { loc, snapshot: remote };
  // Last resort: the placeholder. Zero events by construction — its whole job
  // is keeping a run that died before finishing visible at all.
  const starting = await src.startingV1(loc, warnings);
  if (starting) {
    pushWarning(warnings, `run ${loc.runId}: only the start-of-run placeholder survives; the run never finished uploading`);
    return { loc, snapshot: starting };
  }
  pushMissingWarning(loc, warnings);
  return null;
}

interface V2RunPayload {
  runId: string;
  header: RunHeader | Record<string, unknown>;
  events: unknown[];
  blobIndex: Array<Omit<BlobLine, "content">>;
  /** The v2 form was gone; this is the v1 snapshot reshaped, not a real trace. */
  derivedFromV1?: true;
}

async function hydrateV2(
  loc: RunLocation,
  warnings: string[],
  src: RunArtifactSources = defaultRunArtifactSources,
): Promise<V2RunPayload | null> {
  const run = (await src.localRun(loc, warnings)) ?? (await src.packedRun(loc, warnings));
  if (run) return toV2Run(run);
  // Older runs exist only as v1 snapshots. Reshaping one loses blob refs but
  // keeps the run visible, which beats dropping it from the list. The
  // placeholder is tried last for the same reason it ranks last everywhere:
  // header only, no events.
  const local =
    (await src.localV1(loc, warnings)) ??
    (await src.remoteV1(loc, warnings)) ??
    (await src.startingV1(loc, warnings));
  if (!local) {
    pushMissingWarning(loc, warnings);
    return null;
  }
  pushWarning(warnings, `run ${loc.runId}: no v2 form available; derived from the v1 snapshot`);
  return {
    runId: loc.runId,
    header: local,
    events: Array.isArray(local["events"]) ? (local["events"] as unknown[]) : [],
    blobIndex: [],
    derivedFromV1: true,
  };
}

/**
 * How many of this page's locations turned out not to be turns: a dropped
 * discovery marker, or a run whose header (unreadable before hydration, because
 * it lived only in GCS) names a parent. Subtracted from `totalRuns` so the count
 * the drawer paginates against matches what it can actually render.
 */
function countUnservedParents(
  page: readonly RunLocation[],
  hydrated: ReadonlyArray<V2RunPayload | null>,
): number {
  let n = 0;
  for (const [i, loc] of page.entries()) {
    const r = hydrated[i];
    if (!r) {
      if (loc.indexOnly === true) n += 1;
      continue;
    }
    const h = r.header as Record<string, unknown>;
    if (typeof h["parentRunId"] === "string" || typeof h["parentToolCallId"] === "string") n += 1;
  }
  return n;
}

// ── Subagent artifacts ──────────────────────────────────────────────────────

interface SubagentArtifact {
  fileName: string;
  data: Record<string, unknown>;
}

async function readLegacySubagentArtifacts(debugDirs: string[]): Promise<SubagentArtifact[]> {
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
  return artifacts.flat().filter((item): item is SubagentArtifact => item !== null);
}

/**
 * A child run recorded in the new format is a first-class run with a
 * `parentRunId`/`parentToolCallId` header. The drawer only knows the legacy
 * `subagents-*.json` shape, so project it into that shape rather than teaching
 * the UI a second one. `sessionId` on a child header is the PARENT's session
 * (subagent-tools reuses it), which is exactly what `parentSessionId` means here.
 */
function subagentFromChildRun(h: RunHeader, snapshot: Record<string, unknown>): SubagentArtifact | null {
  if (h.parentRunId === undefined && h.parentToolCallId === undefined) return null;
  const name = h.subagentName ?? "subagent";
  const token = safeRunToken(`${name}-${h.parentToolCallId ?? h.runId}`);
  return {
    fileName: `subagents-${token}.json`,
    data: {
      ...snapshot,
      schemaVersion: 1,
      parentSessionId: h.sessionId ?? h.parentRunId ?? "",
      ...(h.parentToolCallId !== undefined ? { parentToolCallId: h.parentToolCallId } : {}),
      subagentName: name,
      ...(h.question !== undefined ? { question: h.question } : {}),
    },
  };
}

/** Legacy files win over derived ones — they carry the child's own transcript. */
function dedupeSubagents(items: readonly SubagentArtifact[]): SubagentArtifact[] {
  const seen = new Set<string>();
  const out: SubagentArtifact[] = [];
  for (const item of items) {
    const key = `${String(item.data["parentSessionId"] ?? "")}:${String(item.data["parentToolCallId"] ?? "")}:${String(item.data["subagentName"] ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ── GET /internal/sessions/:convId/debug ────────────────────────────────────

function fail(res: Response, status: number, error: string, code: "invalid_id" | "not_found" | "internal", extra?: Record<string, unknown>): void {
  metric.count("debug_bundle", { result: code });
  res.status(status).json({ success: false, error, code, ...(extra ?? {}) });
}

router.get("/internal/sessions/:convId/debug", validateS2SKey, async (req: Request<{ convId: string }>, res: Response) => {
  try {
    const { convId } = req.params;
    const agentSlug = typeof req.query["agentSlug"] === "string" ? req.query["agentSlug"] : undefined;
    const userId = typeof req.query["userId"] === "string" ? req.query["userId"] : undefined;
    // All three ids end up in filesystem paths under the sessions root —
    // reject anything outside the safe charset before touching the disk.
    if (!isSafeId(convId) || (agentSlug !== undefined && !isSafeId(agentSlug)) || (userId !== undefined && !isSafeId(userId))) {
      fail(res, 400, "Invalid conversation id, agent slug, or user id", "invalid_id");
      return;
    }

    const warnings: string[] = [];
    const format = req.query["format"] === "v2" ? "v2" : "v1";
    const limit = parseRunLimit(req.query["limit"]);
    const rawBefore = req.query["before"];
    let before: string | undefined;
    if (typeof rawBefore === "string" && rawBefore !== "") {
      if (isSafeId(rawBefore)) before = rawBefore;
      else pushWarning(warnings, `ignoring malformed 'before' cursor ${rawBefore}`);
    }

    // 1. PVC.
    let dirNames = orderSessionDirNames(await listSessionDirNames(warnings), convId);
    let pvcLocations = (await Promise.all(dirNames.map((n) => collectPvcLocations(n, warnings)))).flat();

    // 2. Discovery index — authoritative storeKeys, no guessing.
    const index = await collectIndexLocations(convId, warnings);

    // 3. GCS runs for every key anyone knows about.
    const guessedKeys = candidateStoreKeys(convId, agentSlug, userId);
    const gcsKeys = unique([...index.storeKeys, ...guessedKeys, ...dirNames]);
    const gcsLocations = (await Promise.all(gcsKeys.map((k) => collectGcsLocations(k, warnings)))).flat();

    let locations = mergeRunLocations([...pvcLocations, ...index.locations, ...gcsLocations]);

    // 4. Archive restore. Last resort only: it pulls a whole session onto the
    // PVC. Keyed on the dir NAME, not just "no dir exists" — a dir that exists
    // but lost its `debug/` (eviction mid-write) used to skip restore entirely.
    if (locations.length === 0) {
      let restored = false;
      for (const key of unique([...index.storeKeys, ...guessedKeys, ...dirNames])) {
        try {
          if (await restoreSessionFromArchive(key)) restored = true;
        } catch (err) {
          pushWarning(warnings, `archive restore failed for ${key}: ${errText(err)}`);
        }
      }
      if (restored) {
        dirNames = orderSessionDirNames(await listSessionDirNames(warnings), convId);
        pvcLocations = (await Promise.all(dirNames.map((n) => collectPvcLocations(n, warnings)))).flat();
        locations = mergeRunLocations([...pvcLocations, ...index.locations, ...gcsLocations]);
      }
    }

    const debugDirs: string[] = [];
    for (const name of dirNames) {
      const dir = debugDirFor(name);
      if (await pathExists(dir)) debugDirs.push(dir);
    }
    const primaryDebugDir = debugDirs[0] ?? null;

    // Turns and subagent children are paginated separately: the page budget
    // belongs to turns, and children ride along with the turn that spawned them.
    const { parents, children } = partitionRunLocations(locations);
    const { page, totalRuns, truncated, remaining } = paginateRuns(parents, limit, before);
    const childPage = childrenForPage(children, page);
    if (childPage.withheld > 0) {
      pushWarning(warnings, `${childPage.withheld} subagent run(s) withheld from this page (cap ${MAX_CHILD_RUNS_PER_PAGE})`);
    }
    if (truncated) {
      // The cap stays — a 400-turn thread must not be a bulk download — but a
      // caller that never passed `limit` has to be TOLD it got a slice, or 25
      // runs read as "that's the whole conversation".
      pushWarning(
        warnings,
        `showing ${page.length} of ${totalRuns} runs; ${remaining} older run(s) withheld — page with ?before=${page[page.length - 1]?.runId ?? ""} or raise ?limit= (max ${MAX_RUN_LIMIT})`,
      );
    }

    if (format === "v2") {
      if (totalRuns === 0 && childPage.hydrate.length === 0) {
        fail(res, 404, "Debug artifacts not found", "not_found", { warnings });
        return;
      }
      const pageV2 = await Promise.all(page.map((loc) => hydrateV2(loc, warnings)));
      const childV2 = await Promise.all(childPage.hydrate.map((loc) => hydrateV2(loc, warnings)));
      // v2 consumers nest by `header.parentRunId` themselves, so children stay
      // in the list — but they never counted toward `totalRuns`, which is a
      // count of TURNS.
      const v2Runs = [...pageV2, ...childV2].filter((r): r is V2RunPayload => r !== null);
      const adjustedTotal = Math.max(0, totalRuns - countUnservedParents(page, pageV2));
      if (adjustedTotal === 0 && v2Runs.length === 0) {
        fail(res, 404, "Debug artifacts not found", "not_found", { warnings });
        return;
      }
      metric.count("debug_bundle", { result: "ok", format: "v2" });
      res.json({
        success: true,
        data: { format: "v2", conversationId: convId, runs: v2Runs, totalRuns: adjustedTotal, truncated, warnings },
      });
      return;
    }

    const toHydrate = [...page, ...childPage.hydrate];
    const results = await Promise.all(toHydrate.map((loc) => hydrateV1(loc, warnings)));

    const hydrated: HydratedRun[] = [];
    const childHydrated: HydratedRun[] = [];
    let notTurns = 0;
    for (const [i, loc] of page.entries()) {
      const r = results[i];
      if (!r) {
        // Nothing anywhere. An index-only location was never a run to begin
        // with (see pushMissingWarning); stop counting it as one.
        if (loc.indexOnly === true) notTurns += 1;
        continue;
      }
      // A GCS-only run could not be classified before pagination — no header
      // without a download. Now that hydration produced one, demote it instead
      // of rendering a phantom turn.
      if (r.run && (r.run.header.parentRunId !== undefined || r.run.header.parentToolCallId !== undefined)) {
        childHydrated.push(r);
        notTurns += 1;
        continue;
      }
      hydrated.push(r);
    }
    for (const r of results.slice(page.length)) if (r) childHydrated.push(r);

    // `totalRuns` counted every discovered parent-or-unclassified location;
    // subtract what this page proved was not a turn. Locations on OTHER pages
    // stay counted — reading them to find out is the cost pagination avoids.
    const adjustedTotal = Math.max(hydrated.length, totalRuns - notTurns);
    const runs = hydrated.map((h) => ({ fileName: h.loc.fileName, data: h.snapshot }));

    // debug-session.json / debug-events.json are the per-dir "latest live trace"
    // the frontend renders as session-level info. They are only materialized at
    // finish, so fall back to the newest run rather than showing nothing while a
    // run is in flight.
    let debugSession = primaryDebugDir
      ? await readJsonIfExists<Record<string, unknown>>(path.join(primaryDebugDir, "debug-session.json"))
      : null;
    let debugEvents = primaryDebugDir
      ? await readJsonIfExists<Record<string, unknown>[]>(path.join(primaryDebugDir, "debug-events.json"))
      : null;
    const newest = hydrated[0];
    if (!debugSession && newest) debugSession = newest.snapshot;
    if (!debugEvents && newest && Array.isArray(newest.snapshot["events"])) {
      debugEvents = newest.snapshot["events"] as Record<string, unknown>[];
    }

    // Subagent artifacts can live under the parent session's debug dir AND under
    // each referenced parent sessionId's dir (mirrors claw-auth's old logic).
    const parentSessionIds = new Set<string>();
    const collect = (d: Record<string, unknown> | null): void => {
      const id = d && typeof d["sessionId"] === "string" ? d["sessionId"] : "";
      // sessionIds come from artifact contents, not the request — still joined
      // into paths below, so apply the same charset guard.
      if (id && isSafeId(id)) parentSessionIds.add(id);
    };
    collect(debugSession);
    for (const r of runs) collect(r.data);
    const root = sessionsRoot();
    const subagentDirs = [...debugDirs, ...[...parentSessionIds].map((id) => path.join(root, id, "debug"))];
    // Children go here and ONLY here — the drawer renders `subagents` nested
    // under their turn, so a child that also appeared in `runs` was a duplicate
    // rendered as a phantom turn. A child with no v2 header (v1 snapshot only)
    // cannot be projected into the legacy shape and is simply omitted.
    const derived = childHydrated
      .map((h) => (h.run ? subagentFromChildRun(h.run.header, h.snapshot) : null))
      .filter((s): s is SubagentArtifact => s !== null);
    const subagents = dedupeSubagents([...(await readLegacySubagentArtifacts(subagentDirs)), ...derived]);

    if (adjustedTotal === 0 && !debugSession && subagents.length === 0) {
      fail(res, 404, "Debug artifacts not found", "not_found", { warnings });
      return;
    }

    if (truncated) {
      log.info(`[debug] ${convId}: serving ${runs.length} of ${adjustedTotal} runs (limit ${limit})`);
    }
    metric.count("debug_bundle", { result: "ok", format: "v1" });
    res.json({
      success: true,
      data: {
        conversationId: convId,
        debugDir: primaryDebugDir,
        debugSession,
        debugEvents,
        runs,
        subagents,
        totalRuns: adjustedTotal,
        truncated,
        warnings,
      },
    });
  } catch (err) {
    log.error("[debug] artifacts error:", err);
    fail(res, 500, "Internal server error", "internal");
  }
});

// ── GET /internal/sessions/:convId/debug/blob/:hash ─────────────────────────

/** Blob hashes are the first 16 hex chars of a sha256; accept any hex prefix length. */
const BLOB_HASH_RE = /^[a-f0-9]{8,64}$/;

router.get(
  "/internal/sessions/:convId/debug/blob/:hash",
  validateS2SKey,
  async (req: Request<{ convId: string; hash: string }>, res: Response) => {
    try {
      const { convId, hash } = req.params;
      const runId = typeof req.query["runId"] === "string" ? req.query["runId"] : undefined;
      const storeKey = typeof req.query["storeKey"] === "string" ? req.query["storeKey"] : undefined;
      if (
        !isSafeId(convId) ||
        !BLOB_HASH_RE.test(hash) ||
        runId === undefined ||
        !isSafeId(runId) ||
        (storeKey !== undefined && !isSafeId(storeKey))
      ) {
        metric.count("debug_blob", { result: "invalid_id" });
        res.status(400).json({ success: false, error: "Invalid conversation id, hash, run id, or store key", code: "invalid_id" });
        return;
      }

      const warnings: string[] = [];
      const keys = storeKey
        ? [storeKey]
        : unique([...orderSessionDirNames(await listSessionDirNames(warnings), convId), ...candidateStoreKeys(convId)]);

      let run: ReadRun | null = null;
      for (const key of keys) {
        const runDir = path.join(debugDirFor(key), "runs", runId);
        if (!(await pathExists(runDir))) continue;
        run = await readRunFromDisk({ runId, fileName: runFileNameFor(runId), storeKey: key, source: "pvc", runDir }, warnings);
        if (run) break;
      }
      if (!run) {
        for (const key of keys) {
          run = await readPackedFromGcs({ runId, fileName: runFileNameFor(runId), storeKey: key, source: "gcs" }, warnings);
          if (run) break;
        }
      }

      const content = run?.blobs.get(hash);
      if (content === undefined) {
        metric.count("debug_blob", { result: "not_found" });
        res.status(404).json({ success: false, error: "Blob not found", code: "not_found" });
        return;
      }

      // Content-addressed: the bytes behind a hash can never change, so this is
      // safe to cache forever. Private — a trace can contain user content.
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.type("text/plain; charset=utf-8");
      metric.count("debug_blob", { result: "ok" });
      res.send(content);
    } catch (err) {
      log.error("[debug] blob error:", err);
      metric.count("debug_blob", { result: "internal" });
      res.status(500).json({ success: false, error: "Internal server error", code: "internal" });
    }
  },
);

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
