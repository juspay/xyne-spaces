/**
 * People-KB merge — folds a day's findings into KB pages.
 *
 * Runs an hour after extraction (21:00 UTC / 2:30 AM IST) so it consumes a
 * complete day rather than a partial one. Same self-scheduling pattern as
 * kbExtractDaily and digitalTwinDaily.
 *
 * Reads people-kb/findings/dt=<day>/<CODE>/*.jsonl — one object per extraction
 * session — and dispatches them to the project's merge agent.
 *
 * SEQUENTIAL BY DESIGN. Batches write to overlapping pages and KbFs has no
 * compare-and-swap, so two concurrent merges would silently lose each other's
 * edits. A nightly job can afford the wall-clock.
 *
 * Every attempt lands in kb_runs as kind=MERGE, with the day as its subject. The
 * merge writes pages that cannot be deleted afterwards, so "what did this run
 * consume, and did it finish?" has to be answerable later — and those rows are
 * also how it RESUMES, since the days already completed are the days it skips.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { attachKbGrantsToConfig } from "../lib/spaces-kb.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";

const logger = createLogger("kb-merge");

/** Fallback when a project does not name its own merge agent. */
const DEFAULT_MERGE_AGENT = process.env["KB_MERGE_AGENT_SLUG"] ?? "kb-merge";

/**
 * Findings characters per batch.
 *
 * Smaller than the extractor's budget: the merge must also survey the existing
 * KB and write pages, so the model needs headroom the input would otherwise
 * consume.
 */
const BATCH_CHAR_BUDGET = 60_000;

/** How long one merge session may run before it is treated as stuck. */
const SESSION_WAIT_MS = Number(process.env["KB_MERGE_SESSION_WAIT_MS"] ?? 15 * 60 * 1000);

/** Object-storage prefix written by the extractor's emit-finding flush. */
const FINDINGS_PREFIX = "people-kb/findings";

interface FindingsObject {
  name: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Reading findings out of object storage
// ---------------------------------------------------------------------------

/**
 * Lists and downloads the day's findings for one project.
 *
 * Goes through the JSON API rather than a storage SDK so the same code works
 * against fake-gcs locally and real GCS in production — the emulator speaks the
 * same endpoints, and claw already writes through an equivalent path.
 */
async function fetchFindings(projectCode: string, day: string): Promise<FindingsObject[]> {
  const bucket = process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments";
  const host = storageHost();
  const prefix = `${FINDINGS_PREFIX}/dt=${day}/${projectCode}/`;

  const listUrl = `${host}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`;
  const listRes = await fetch(listUrl, { signal: AbortSignal.timeout(30_000) });
  if (!listRes.ok) {
    throw new Error(`findings list failed (${listRes.status}): ${await listRes.text()}`);
  }

  const listed = (await listRes.json()) as { items?: Array<{ name?: string }> };
  const names = (listed.items ?? []).map((i) => i.name).filter((n): n is string => Boolean(n));

  const objects: FindingsObject[] = [];
  for (const name of names) {
    const url = `${host}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      // One unreadable object should not cost the whole night's merge.
      logger.warn("[kb-merge] findings object unreadable; skipping", { name, status: String(res.status) });
      continue;
    }
    objects.push({ name, body: await res.text() });
  }
  return objects;
}

/**
 * Where object storage lives.
 *
 * FAKE_GCS_HOST points at the docker-compose emulator in dev; production talks
 * to Google directly. Mirrors normalizeFakeGcsHost() in claw's config.
 */
function storageHost(): string {
  const fake = process.env["FAKE_GCS_HOST"]?.trim();
  if (fake && process.env["NODE_ENV"] !== "production") {
    return fake.startsWith("http") ? fake : `http://${fake}`;
  }
  return "https://storage.googleapis.com";
}


/** Packs findings lines into batches the merge agent can hold. */
function packBatches(objects: FindingsObject[]): string[] {
  const lines = objects.flatMap((o) => o.body.split("\n").filter((l) => l.trim()));

  const batches: string[] = [];
  let current: string[] = [];
  let chars = 0;

  for (const line of lines) {
    if (current.length > 0 && chars + line.length > BATCH_CHAR_BUDGET) {
      batches.push(current.join("\n"));
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += line.length;
  }
  if (current.length > 0) batches.push(current.join("\n"));
  return batches;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function runBatch(
  runId: string,
  findings: string,
  project: { projectId: string; projectCode: string },
  agentSlug: string,
  day: string,
  index: number,
  total: number,
): Promise<void> {
  const agent = await prisma.agent.findFirst({ where: { slug: agentSlug } });
  if (!agent) throw new Error(`agent ${agentSlug} not found`);

  const agentConfig = await attachKbGrantsToConfig(
    agent.config as Record<string, unknown>,
    agent.id,
    prisma,
  );

  // Through claw-auth's own /internal/run: claw refuses a run without a
  // sessionId and sessionToken, and minting those is claw-auth's job.
  //
  // Consumed as SSE, so the call returns when the agent finishes rather than
  // when the session is minted. Waiting is the whole point of the merge, not a
  // nicety: without it every batch starts at once and the survey-first rule
  // collapses — each session lists a KB the others have not written to yet, so
  // they all independently invent folder names. That is what produced `vespa`
  // alongside `vespa-core`, and five `xyne-spaces-*` variants. A batch must see
  // what the previous one wrote.
  const stream = await consumeClawStream({
    url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
    s2sKey: CONFIG.xyneClawS2sKey,
    // A stalled merge must not hold the whole night's sequence open.
    signal: AbortSignal.timeout(SESSION_WAIT_MS),
    handlers: {
      onError: (sessionId, error) => {
        logger.error("[kb-merge] session error", { sessionId: sessionId ?? "?", error });
      },
    },
    body: {
      userId: agent.ownerUserId,
      agentSlug,
      systemPrompt: agent.systemPrompt,
      task: `Fold these findings into the KB. Batch ${index + 1} of ${total} for ${day}.`,
      context: `## Findings (JSONL)\n\n${findings}`,
      // Unique per ATTEMPT, not per day. A deterministic id resumes the prior
      // session, and a resumed merge sees its own transcript saying the pages
      // were already written — so a re-run after a wipe does nothing.
      conversationId: `kb-merge-${project.projectCode}-${day}-${index}-${runId}`,
      agentConfig,
    },
  });

  // Anything short of a clean `done` stops this project's day. Carrying on is
  // worse than giving up: a run that died halfway has written some pages and not
  // others, and the next batch would survey that half-written KB and name things
  // around what it found.
  if (stream.result?.status !== "completed") {
    throw new Error(
      `merge session ended as ${stream.result?.status ?? stream.errorReason ?? "no done frame"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Fails unless the project's KB can actually be read.
 *
 * Listing alone is not enough — the listing is served from the collection index
 * while page CONTENT comes from a separate download path, and it was exactly
 * that download path (and every write) that broke while listing kept answering
 * happily. So this reads a real page.
 *
 * Cheap: one list, one download, both of which the merge would do anyway.
 */
async function assertKbWritable(projectId: string): Promise<void> {
  const project = await prisma.kbProject.findFirst({ where: { projectId } });
  if (!project) throw new Error(`kb project ${projectId} not found`);

  const userId = project.enabledBy;
  if (!userId) throw new Error(`kb project ${project.projectCode} has no enabledBy — cannot reach the KB`);

  const headers = {
    ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey, "x-user-id": userId } : {}),
  };
  const params = new URLSearchParams({ collectionId: project.collectionId, userId });

  const listRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/kb/list?${params}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const listed = (await listRes.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: { paths?: string[] };
  };
  if (!listRes.ok || !listed.success) {
    throw new Error(`KB unreachable: list failed — ${listed.error ?? listRes.status}`);
  }

  // An empty KB is legitimate on the very first merge; there is simply nothing
  // to read back, and the first write will surface any problem itself.
  const first = (listed.data?.paths ?? []).find((p) => p.endsWith(".md"));
  if (!first) return;

  const readParams = new URLSearchParams({ collectionId: project.collectionId, userId, path: first });
  const readRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/kb/read?${readParams}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const read = (await readRes.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!readRes.ok || !read.success) {
    throw new Error(`KB unreachable: reading ${first} failed — ${read.error ?? readRes.status}`);
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Merges one day for one project, recording the attempt either way. */
async function mergeProjectDay(
  project: {
    projectId: string;
    projectCode: string;
    mergeAgent: string;
  },
  day: string,
): Promise<void> {
  const run = await prisma.kbRun.create({
    data: {
      kind: "MERGE",
      projectId: project.projectId,
      projectCode: project.projectCode,
      subject: day,
    },
  });

  try {
    // The KB has to be reachable BEFORE a model session is spent on it.
    //
    // Learned the hard way: with the Spaces DB behind its schema, every write
    // 500'd, the agent politely reported that it could not save anything, the
    // session ended cleanly — and this day was marked COMPLETED. The findings
    // were consumed and the day would never be retried. A run that cannot write
    // must fail loudly and early, not succeed quietly and late.
    await assertKbWritable(project.projectId);

    const objects = await fetchFindings(project.projectCode, day);
    const batches = packBatches(objects);
    const findingCount = objects.reduce(
      (n, o) => n + o.body.split("\n").filter((l) => l.trim()).length,
      0,
    );

    if (batches.length === 0) {
      // A quiet day is a normal outcome, not a failure — but it is recorded so
      // "nothing merged" can be told apart from "never ran".
      await prisma.kbRun.update({
        where: { id: run.id },
        data: {
          status: "NOTHING_TO_MERGE",
          metrics: { findingsFiles: objects.length },
          finishedAt: new Date(),
        },
      });
      logger.info("[kb-merge] nothing to merge", { code: project.projectCode, day });
      return;
    }

    let failed = 0;
    for (const [index, batch] of batches.entries()) {
      try {
        await runBatch(run.id, batch, project, project.mergeAgent, day, index, batches.length);
      } catch (err) {
        failed += 1;
        logger.error("[kb-merge] batch failed", {
          code: project.projectCode,
          batch: `${index + 1}/${batches.length}`,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await prisma.kbRun.update({
      where: { id: run.id },
      data: {
        metrics: {
          findingsFiles: objects.length,
          findings: findingCount,
          batches: batches.length,
        },
        status: failed > 0 ? "FAILED" : "COMPLETED",
        finishedAt: new Date(),
        ...(failed > 0 ? { error: `${failed} of ${batches.length} batches failed` } : {}),
      },
    });

    logger.info("[kb-merge] project done", {
      code: project.projectCode,
      day,
      findings: String(findingCount),
      batches: String(batches.length),
      failed: String(failed),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.kbRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    logger.error("[kb-merge] project failed", { code: project.projectCode, day, err: message });
  }
}

/**
 * Merges every day that has findings and has not been merged, oldest first.
 *
 * Order matters. Findings are partitioned by when the conversation happened, so
 * walking them chronologically means April's pages exist before May confirms
 * them — which is what makes the first/last/seen freshness markers mean
 * anything. Merging newest-first would set `first` from the wrong end.
 */
export async function runKbMergePending(onlyProjectCode?: string): Promise<void> {
  const projects = await prisma.kbProject.findMany({
    where: { enabled: true, ...(onlyProjectCode ? { projectCode: onlyProjectCode } : {}) },
  });

  for (const project of projects) {
    const days = await pendingDays(project.projectCode);
    if (days.length === 0) {
      logger.info("[kb-merge] nothing pending", { code: project.projectCode });
      continue;
    }
    logger.info("[kb-merge] pending days", {
      code: project.projectCode,
      days: String(days.length),
      from: days[0]!,
      to: days[days.length - 1]!,
    });
    for (const day of days) {
      await runKbMerge(day, project.projectCode);
    }
  }
}

/**
 * Days with findings that have not been merged yet, oldest first.
 *
 * Derived from what is in storage minus the days kb_runs already completed,
 * so a partial backfill resumes rather than re-merging ground already covered.
 */
async function pendingDays(projectCode: string): Promise<string[]> {
  const bucket = process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments";
  const url = `${storageHost()}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(FINDINGS_PREFIX + "/dt=")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return [];

  const listed = (await res.json()) as { items?: Array<{ name?: string }> };
  const days = new Set<string>();
  for (const item of listed.items ?? []) {
    // people-kb/findings/dt=2026-04-14/XYNE/<session>.jsonl
    const match = /\/dt=(\d{4}-\d{2}-\d{2})\/([^/]+)\//.exec(item.name ?? "");
    if (match && match[2] === projectCode) days.add(match[1]!);
  }

  const merged = await prisma.kbRun.findMany({
    where: { kind: "MERGE", projectCode, status: { in: ["COMPLETED", "NOTHING_TO_MERGE"] } },
    select: { subject: true },
  });
  for (const m of merged) days.delete(m.subject);

  return [...days].sort();
}

/**
 * Merges a day across every enabled project.
 *
 * `onlyProjectCode` narrows to one, which is how an admin triggers a merge on
 * demand instead of waiting for the nightly.
 */
export async function runKbMerge(day: string, onlyProjectCode?: string): Promise<void> {
  const projects = await prisma.kbProject.findMany({
    where: { enabled: true, ...(onlyProjectCode ? { projectCode: onlyProjectCode } : {}) },
  });

  if (projects.length === 0) {
    logger.info("[kb-merge] no enabled projects — nothing to do", {
      day,
      ...(onlyProjectCode ? { requested: onlyProjectCode } : {}),
    });
    return;
  }

  logger.info("[kb-merge] starting", { day, projects: projects.map((p) => p.projectCode).join(",") });

  for (const project of projects) {
    await mergeProjectDay(
      {
        projectId: project.projectId,
        projectCode: project.projectCode,
        mergeAgent: project.mergeAgentSlug ?? DEFAULT_MERGE_AGENT,
      },
      day,
    );
  }

  logger.info("[kb-merge] finished", { day });
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function scheduleNextRun(): void {
  const now = new Date();
  // 2:30 AM IST = 21:00 UTC — an hour after extraction, so the day is complete.
  const nextRun = new Date(now);
  nextRun.setUTCHours(21, 0, 0, 0);
  if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);

  logger.info("[kb-merge] next run scheduled", { nextRun: nextRun.toISOString() });

  setTimeout(async () => {
    try {
      if (await acquireCronLeaderLock("kb-merge-daily")) {
        // Everything outstanding, oldest first — so tonight's extraction is
        // merged tonight, and a backfill catches up across nights.
        await runKbMergePending();
      } else {
        logger.info("[kb-merge] skipped — another replica is running tonight's merge");
      }
    } catch (err) {
      logger.error("[kb-merge] unhandled error", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scheduleNextRun();
    }
  }, nextRun.getTime() - now.getTime());
}

export function initKbMergeDaily(): void {
  if (process.env["ENABLE_KB_MERGE_DAILY"] !== "true") {
    logger.info("[kb-merge] disabled (set ENABLE_KB_MERGE_DAILY=true to enable)");
    return;
  }
  logger.info("[kb-merge] initialising");
  scheduleNextRun();
}
