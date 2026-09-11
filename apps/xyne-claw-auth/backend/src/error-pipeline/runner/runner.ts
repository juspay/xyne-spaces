import { CONFIG, ERROR_PIPELINE } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { getQueue, type ClaimedItem } from "../queue.js";
import { laneNames } from "../rules.js";
import { redisService } from "../../redis.js";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { getFixRecord, saveFixRecord } from "./store.js";
import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { getLatestSessionForRun } from "../../queue/run-recovery-worker.js";
import { handleAutomationWebhook } from "../../routes/webhook.js";
import type { Request, Response } from "express";
import type { WorkItem } from "../types.js";

const log = createLogger("error-pipeline");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// The only stream the runner does NOT work: the dead-letter lane. `default`
// (unmatched errors) gets its own agent like every other lane.
const EXCLUDE = new Set(["needs-human"]);

// Don't re-work a shape we finished within this window (re-fires wipe the queue
// dedup marker on ack, so this is what stops re-work churn).
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// How often the runner polls the AgentRun row for a dispatched run to finalize.
const RUN_POLL_MS = 5_000;

/**
 * The runner: ONE worker per stream. Each worker owns its bucket, pulls items
 * one at a time, and spawns the agent (doctor-agent by default) to debug the
 * error and produce a detailed RCA (no PR/COE for now). Sequential
 * within a stream ("one completes, then the next"); streams run in parallel
 * (max = number of lanes).
 *
 * Lives in claw-auth (claw stays a stateless executor). Each run is dispatched
 * through the SAME automation path as /webhook/:agentSlug — we call
 * handleAutomationWebhook directly (a mock req/res, skipping the Spaces HMAC in
 * the route wrapper), which resolves org/agent/provider, persists the AgentRun,
 * and hands off to claw. The run finishes async via the result callback; we
 * poll the AgentRun row for the terminal status.
 */
const LEADER_KEY = "errpipe:runner-leader";
const LEADER_TTL_MS = 90_000;

class Runner {
  private stopped = false;
  private readonly workers = new Set<string>();
  private superviseTimer: ReturnType<typeof setInterval> | null = null;
  private leaderTimer: ReturnType<typeof setInterval> | null = null;
  private isLeader = false;
  private readonly holder = `${hostname()}:${process.pid}`;

  private async leaderTick(): Promise<void> {
    const r = redisService.getConnection();
    try {
      if (this.isLeader) {
        const owner = await r.get(LEADER_KEY);
        if (owner === this.holder) {
          await r.pexpire(LEADER_KEY, LEADER_TTL_MS);
        } else {
          this.isLeader = false;
          log.warn(`[runner] lost leadership to ${owner ?? "unknown"} — workers pausing`);
        }
      } else {
        const ok = await r.set(LEADER_KEY, this.holder, "PX", LEADER_TTL_MS, "NX");
        if (ok === "OK") {
          this.isLeader = true;
          log.info(`[runner] acquired leadership (${this.holder})`);
        }
      }
    } catch {
      // Redis down: queues are unreachable anyway; keep current state.
    }
  }

  /** Resolved service-user id; ERROR_PIPELINE_AGENT_USER_ID short-circuits the lookup. */
  private agentUserId = ERROR_PIPELINE.agentUserId;

  start(): void {
    // Only ever called on the dedicated runner pod (main.ts gates the import
    // on ERROR_PIPELINE_RUNNER_POD).
    void this.init();
  }

  // Idle rather than drain: until the service user resolves we can't run the
  // agent, and we don't want workers consuming the streams.
  private async init(): Promise<void> {
    while (!this.stopped && !this.agentUserId) {
      try {
        await this.resolveAgentUser();
        if (this.agentUserId) break;
        log.warn(`[runner] idle — agent "${ERROR_PIPELINE.agentSlug}" has no spacesAppUserId/ownerUserId; set ERROR_PIPELINE_AGENT_USER_ID to a Bitbucket-connected user`);
      } catch (err) {
        log.warn(`[runner] idle — agent lookup failed: ${errMsg(err)}`);
      }
      await sleep(60_000);
    }
    if (this.stopped) return;
    log.info(`[runner] starting — one worker per stream, agent=${ERROR_PIPELINE.agentSlug}, user=${this.agentUserId}`);
    await this.leaderTick();
    this.leaderTimer = setInterval(() => void this.leaderTick(), LEADER_TTL_MS / 3);
    void this.supervise();
    // Pick up buckets added later (a new lane created in admin).
    this.superviseTimer = setInterval(() => void this.supervise(), 30_000);
  }

  /**
   * Resolve the identity the agent runs as — the same way the Spaces automation
   * engine does: the agent's own bot user `spacesAppUserId`, falling back to
   * its `ownerUserId`. Direct DB read (we own the agents table now).
   */
  private async resolveAgentUser(): Promise<void> {
    // Agents are org-scoped now (@@unique([orgId, slug])); the runner has no
    // org context, so mirror agentRepository.findBySlugSingleMatch: accept the
    // slug only when it's unambiguous across orgs.
    const matches = await prisma.agent.findMany({
      where: { slug: ERROR_PIPELINE.agentSlug },
      select: { spacesAppUserId: true, ownerUserId: true },
      take: 2,
    });
    if (matches.length > 1) {
      log.error(`[runner] agent slug "${ERROR_PIPELINE.agentSlug}" is ambiguous across orgs — set ERROR_PIPELINE_AGENT_USER_ID`);
      return;
    }
    const agent = matches[0];
    const resolved = agent?.spacesAppUserId || agent?.ownerUserId || "";
    if (resolved) {
      this.agentUserId = resolved;
      log.info(`[runner] agent user resolved from "${ERROR_PIPELINE.agentSlug}": ${resolved}`);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.superviseTimer) clearInterval(this.superviseTimer);
    if (this.leaderTimer) clearInterval(this.leaderTimer);
    // Release the lock so a surviving replica takes over immediately.
    if (this.isLeader) {
      redisService.getConnection().del(LEADER_KEY).catch(() => {});
    }
  }

  /** Ensure exactly one worker per current live lane (incl. default). */
  private async supervise(): Promise<void> {
    if (this.stopped) return;
    for (const bucket of (await laneNames()).filter((n) => !EXCLUDE.has(n))) {
      if (!this.workers.has(bucket)) {
        this.workers.add(bucket);
        void this.streamWorker(bucket);
      }
    }
  }

  private async streamWorker(bucket: string): Promise<void> {
    const consumer = `runner-${process.pid}-${bucket}`;
    log.info(`[runner] worker up for stream "${bucket}"`);
    while (!this.stopped) {
      let worked = false;
      try {
        if (!this.isLeader) {
          await sleep(ERROR_PIPELINE.runnerPollMs);
          continue;
        }
        const claimed = await getQueue().claimNext(bucket, consumer);
        if (claimed) {
          worked = true;
          await this.process(claimed);
        }
      } catch (err) {
        log.error(`[runner] ${bucket}: ${errMsg(err)}`);
      }
      if (!worked && !this.stopped) await sleep(ERROR_PIPELINE.runnerPollMs);
    }
    this.workers.delete(bucket);
  }

  private async process(claimed: ClaimedItem): Promise<void> {
    const q = getQueue();
    const { item, bucket } = claimed;

    // Dedup: this shape was already worked recently — skip. The prior RCA is
    // findable by the [errpipe:<key>] marker embedded in its report.
    const prior = await getFixRecord(item.errorKey);
    if (prior && prior.status === "completed" && Date.now() - prior.updatedAt < COOLDOWN_MS) {
      const remainingSeconds = Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - prior.updatedAt)) / 1000));
      log.info(`[runner] ${item.errorKey} completed recently — ack, skip (hold dedup ${remainingSeconds}s)`);
      await q.ack(claimed, { keepDedupForSeconds: remainingSeconds });
      return;
    }

    // Invariant: sequential-per-lane means at most ONE true run per lane —
    // so any OTHER "running" record in this lane is a corpse from a killed
    // process. Demote it NOW (not on the 5-min sweep) so the UI can never
    // show two agents running in one lane.
    try {
      const { listFixRecords, saveFixRecord } = await import("./store.js");
      for (const rec of await listFixRecords(300)) {
        if (rec.status === "running" && rec.bucket === bucket && rec.errorKey !== item.errorKey) {
          await saveFixRecord({ ...rec, status: "failed", summary: "interrupted (service restarted mid-run) — the queue will retry" });
        }
      }
    } catch { /* cosmetic cleanup — never block the real run */ }

    // Dispatch the agent via the automation path; poll the run row to completion.
    await this.record(item, bucket, { status: "running", attempts: claimed.deliveries });
    const task = this.buildTask(item);
    const outcome = await this.runAgent(item, bucket, task, claimed.deliveries);
    if (!outcome) {
      // Couldn't even start — leave unacked so it retries (queue reclaim), then
      // dead-letters past maxAttempts. Correct the record so the UI doesn't
      // show a phantom "running" in the meantime (retry flips it back).
      await this.record(item, bucket, {
        status: "failed",
        summary: "could not start the agent (dispatch failed) — the queue will retry",
        attempts: claimed.deliveries,
      });
      log.error(`[runner] failed to start agent for ${item.errorKey}`);
      return;
    }

    const status: "completed" | "failed" = outcome.status === "completed" ? "completed" : "failed";
    await this.record(item, bucket, {
      status,
      ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
      ...(outcome.conversationId ? { conversationId: outcome.conversationId } : {}),
      summary: outcome.result, // FULL agent response, no cap — the UI renders all of it
      attempts: claimed.deliveries,
    });
    log.info(`[runner] ${bucket} ${item.errorKey}: ${status}`);
    // On success, hold the dedup marker for the full cooldown so Grafana's
    // re-fires of this now-fixed error are dropped at ingest (no re-queue → skip
    // churn). On failure, release it (default) so a later occurrence can retry.
    await q.ack(claimed, status === "completed" ? { keepDedupForSeconds: Math.ceil(COOLDOWN_MS / 1000) } : undefined);
  }

  // The detailed "how to debug / how to use the sandbox" flow lives in the
  // agent's own system prompt (DB-backed, editable without a deploy), so the
  // task stays a plain, natural ask: here's the error → check Grafana →
  // replicate → full technical RCA. Deliberately NO PR / COE step for now —
  // the deliverable is the RCA report itself. The one non-obvious bit it must
  // carry: the doctor prompt is written for an interactive human loop, but a
  // pipeline run is HEADLESS — nobody confirms — so we tell it to go
  // end-to-end without pausing, or it stalls mid-investigation. The errpipe
  // marker is per-run and must ride along in the report so a later run (or a
  // human) can find prior work on the same error shape.
  private buildTask(item: WorkItem): string {
    return [
      `${item.error.message}`,
      "",
      "This is an error we're seeing in production. Check Grafana for the logs and surrounding context, reproduce the error, and produce a full, detailed technical root-cause analysis.",
      "Do NOT raise a PR or open a COE — the deliverable is the RCA report only.",
      "The RCA must include:",
      "- What happened: the exact failure, where in the code it originates (file/function), and the error's blast radius.",
      "- Root cause: the precise chain from trigger to failure, backed by the log evidence you found.",
      "- Reproduction: concrete step-by-step instructions (requests, payloads, preconditions) so anyone can replicate the error independently.",
      "- Suggested fix: what you would change and why — described, not implemented.",
      "This is an automated, unattended run — work through it end to end (investigate → replicate → RCA) without pausing for confirmation. If you can't pin down the root cause, report exactly what you ruled out and what's still unknown.",
      "",
      `bucket: ${item.classification.bucket}`,
      `requestId: ${item.error.sampleRequestId ?? "unknown"}`,
      `occurrences in alert window: ${item.error.count ?? "unknown"}`,
      `alert fired at: ${item.error.occurredAt ? new Date(item.error.occurredAt).toISOString() : "unknown"}`,
      `Include [errpipe:${item.errorKey}] in the RCA report.`,
    ].join("\n");
  }

  /**
   * Run the agent WITHOUT holding a connection open for the whole run.
   *
   * We POST /internal/run fire-and-forget (plain JSON, no SSE) — it persists the
   * AgentRun (status "running"), dispatches to claw, and returns {sessionId}
   * immediately. claw runs headless and POSTs its result back to the injected
   * /webhook/result callback, which finalizes the AgentRun row (status +
   * result). We then POLL that row from our own DB until it's terminal.
   *
   * Why not hold the SSE stream: that connection spans two hops (runner→auth,
   * auth→claw) for up to 45 min; any proxy/LB/conntrack idle-reset on the path
   * kills it mid-run ("sse stream broken"). Polling a DB row the callback writes
   * has no long-lived connection to break — the same pattern Spaces automations
   * already use reliably.
   *
   * Returns null when the run couldn't START (item left unacked for retry). A
   * run that started but ended badly / timed out returns "failed" (recorded +
   * acked rather than clogging the lane).
   */
  private async runAgent(
    item: WorkItem,
    bucket: string,
    task: string,
    attempts: number,
  ): Promise<{ sessionId?: string; conversationId?: string; status: string; result: string } | null> {
    const conversationId = randomUUID();
    const callbackUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/error-pipeline/run-result`;
    let sessionId: string;
    try {
      let capStatus = 200;
      let capBody: unknown;
      const mockRes = {
        status(n: number) { capStatus = n; return this; },
        json(o: unknown) { capBody = o; return this; },
        type(_: string) { return this; },
        send(t: unknown) { capBody = t; return this; },
      } as unknown as Response;
      const mockReq = {
        body: { sessionId: randomUUID(), userId: this.agentUserId, agentSlug: ERROR_PIPELINE.agentSlug, task, callbackUrl, conversationId, allowWriteInReadOnlyJob: true },
      } as unknown as Request;
      await handleAutomationWebhook(mockReq, mockRes, ERROR_PIPELINE.agentSlug);
      if (capStatus < 200 || capStatus >= 300) {
        log.error(`[runner] automation dispatch HTTP ${capStatus}: ${JSON.stringify(capBody).slice(0, 200)}`);
        return null;
      }
      const parsed = (typeof capBody === "string" ? JSON.parse(capBody) : capBody) as { sessionId?: string };
      if (!parsed?.sessionId) {
        log.error(`[runner] automation dispatch returned no sessionId: ${JSON.stringify(capBody).slice(0, 150)}`);
        return null;
      }
      sessionId = parsed.sessionId;
    } catch (err) {
      log.error(`[runner] dispatch failed: ${errMsg(err)}`);
      return null;
    }

    await this.record(item, bucket, { status: "running", sessionId, conversationId, attempts });
    log.info(`[runner] ${bucket} ${item.errorKey}: agent spawned, session ${sessionId}`);

    // Poll the AgentRun row until the callback finalizes it. The run is NOT
    // tied to this loop's liveness (fire-and-forget) — we're just watching the
    // row the run-result callback writes. No heartbeat: the runner isn't keeping
    // the run alive, so there's nothing to "keep fresh".
    // Session we're watching — reassigned when a run hands off (see below).
    let watchSessionId = sessionId;
    const deadline = Date.now() + ERROR_PIPELINE.agentTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(RUN_POLL_MS);
      let run: Awaited<ReturnType<typeof agentRunRepository.findBySessionId>>;
      try {
        run = await agentRunRepository.findBySessionId(watchSessionId);
      } catch (err) {
        log.warn(`[runner] poll error (session ${watchSessionId}): ${errMsg(err)}`);
        continue;
      }
      if (!run) continue; // row not visible yet
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        const text = run.result ?? run.error ?? "";
        if (text.trim()) {
          return { sessionId: watchSessionId, conversationId, status: run.status, result: text };
        }
        // Terminal but EMPTY. A run that hits claw's turn limit doesn't end —
        // it checkpoints and is RE-DISPATCHED under a new sessionId, so this
        // row is finalized with no text while the real answer (and its
        // attachments) land on the continuation. Ask the recovery worker which
        // session the run is on NOW: it records the chain when it performs the
        // handoff, so this is the authoritative link — not "some newer run in
        // the same conversation", which could match a human's follow-up chat.
        const latest = await getLatestSessionForRun(watchSessionId).catch(() => null);
        if (latest && latest !== watchSessionId) {
          log.info(`[runner] ${watchSessionId} handed off → following continuation ${latest}`);
          watchSessionId = latest;
          continue;
        }
        return { sessionId: watchSessionId, conversationId, status: run.status, result: text };
      }
    }
    log.warn(`[runner] run ${watchSessionId} did not finalize within timeout — marking failed`);
    return { sessionId: watchSessionId, conversationId, status: "failed", result: "run did not finalize within the timeout" };
  }

  private async record(item: WorkItem, bucket: string, patch: Partial<import("./store.js").FixRecord> & { status: import("./store.js").FixStatus; attempts: number }): Promise<void> {
    await saveFixRecord({
      errorKey: item.errorKey,
      bucket,
      message: item.error.message.slice(0, 20_000),
      updatedAt: 0, // stamped in saveFixRecord
      ...patch,
    });
  }
}

export const runner = new Runner();
