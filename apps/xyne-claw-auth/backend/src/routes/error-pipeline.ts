/**
 * Grafana → error-pipeline ingest (lives in claw-auth: this service owns the
 * bucket rules, the Redis, and the run dispatch — claw stays a stateless
 * executor).
 *
 * Auth WITHOUT handing Grafana any raw secret: Grafana sends
 * `Authorization: Bearer <JWT>` signed with ERROR_PIPELINE_JWT_SECRET (only in
 * this service's env). The token verifies only here (aud=error-pipeline), so a
 * leaked webhook credential is useless against any other route. Internal
 * callers may use the master x-s2s-key instead. Mint tokens via the admin API
 * (POST /claw/api/v1/admin/error-pipeline/token — CLAW_ADMIN).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { errMsg } from "../lib/errors.js";
import jwt from "jsonwebtoken";
import { s2sKeyMatches } from "../middleware/require-auth.js";
import { ERROR_PIPELINE } from "../config.js";
import { classify } from "../error-pipeline/classify.js";
import { routeError } from "../error-pipeline/buckets.js";
import { agentRunRepository } from "../repositories/agentRunRepository.js";
import type { IncomingError } from "../error-pipeline/types.js";
import { createLogger } from "../logger.js";
import { prisma } from "../db.js";
import { persistRunStreamResult } from "./run-stream.js";

const log = createLogger("error-pipeline");

export const errorPipelineIngestRouter = Router();

/**
 * Internal callback the runner points its dispatched runs at (mounted under
 * requireStrictS2S). claw POSTs the terminal result here when a headless
 * automation run finishes — we do ONE thing: finalize the AgentRun row (status
 * + result). The runner polls that row, so a guaranteed finalize is what lets
 * its poll terminate. Await the finalize BEFORE acking and return non-2xx on
 * failure so Claw retries (2xx must mean the row is durably written, never just
 * received). Conversation/message storage is the platform's job, not ours — we
 * don't persist the reply here.
 */
export const errorPipelineInternalRouter = Router();

errorPipelineInternalRouter.post("/run-result", async (req: Request, res: Response) => {
  const p = req.body as {
    sessionId?: string;
    status?: string;
    result?: string;
    error?: string;
    userId?: string;
    agentSlug?: string;
    conversationId?: string | null;
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
  };
  if (!p.sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }
  const status = p.status === "completed" ? "completed" : "failed";
  try {
    await agentRunRepository.finalize(p.sessionId, {
      status,
      result: p.result ?? null,
      error: p.error ?? null,
      toolsUsed: [],
    });
  } catch (err) {
    log.error(`[run-result] finalize ${p.sessionId} failed — returning 500 so Claw retries: ${errMsg(err)}`);
    res.status(500).json({ success: false, error: "finalize failed" });
    return;
  }
  res.json({ success: true });
  log.info(`[run-result] finalized ${p.sessionId} → ${status} (attachments=${p.attachments?.length ?? 0})`);

  // Persist the assistant turn into the run's conversation AFTER acking (claw
  // only needs the AgentRun finalized). Without this, the report files the
  // agent attaches exist only in this callback payload and vanish — the
  // pipeline UI's Attachments section and "Open chat" had nothing to show.
  // Best-effort: a persistence failure must never make claw retry the ack.
  // persistRunStreamResult dedupes on sessionId across claw's retries.
  if (p.conversationId && p.userId && (p.result || p.attachments?.length)) {
    try {
      const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { orgId: true } });
      if (user?.orgId) {
        await persistRunStreamResult({
          conversationId: p.conversationId,
          agentSlug: p.agentSlug ?? ERROR_PIPELINE.agentSlug,
          userId: p.userId,
          content: p.result ?? "",
          status: status === "completed" ? "completed" : "failed",
          orgId: user.orgId,
          sessionId: p.sessionId,
          ...(p.attachments?.length ? { attachments: p.attachments } : {}),
        });
        log.info(`[run-result] persisted assistant turn for ${p.sessionId} (conv ${p.conversationId}, ${p.attachments?.length ?? 0} attachments)`);
      } else {
        log.warn(`[run-result] no orgId for user ${p.userId} — skipping conversation persistence`);
      }
    } catch (err) {
      log.warn(`[run-result] conversation persistence failed for ${p.sessionId}: ${errMsg(err)}`);
    }
  }
});

export const INGEST_JWT_AUDIENCE = "error-pipeline";

function validateIngestAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    if (!ERROR_PIPELINE.jwtSecret) {
      log.error("[auth] Bearer attempt but ERROR_PIPELINE_JWT_SECRET is not configured — refusing.");
      res.status(503).json({ success: false, error: "Ingest JWT secret not configured" });
      return;
    }
    try {
      jwt.verify(authHeader.slice("Bearer ".length), ERROR_PIPELINE.jwtSecret, {
        algorithms: ["HS256"],
        audience: INGEST_JWT_AUDIENCE,
      });
      next();
      return;
    } catch (err) {
      log.warn(`[auth] ingest JWT rejected: ${errMsg(err)}`);
      res.status(401).json({ success: false, error: "Invalid or expired ingest token" });
      return;
    }
  }
  // No Bearer header: allow internal S2S callers, otherwise say what this
  // route accepts.
  if (s2sKeyMatches(req.headers["x-s2s-key"] as string | undefined)) {
    next();
    return;
  }
  res.status(401).json({
    success: false,
    error: "Missing credentials: send `Authorization: Bearer <ingest JWT>` (or `x-s2s-key` for internal services)",
  });
}

function isIncomingError(x: unknown): x is IncomingError {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as IncomingError).source === "string" &&
    typeof (x as IncomingError).message === "string"
  );
}

interface GrafanaAlert {
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  values?: Record<string, unknown>;
  startsAt?: string;
}

/**
 * The alert's numeric values map holds one entry per refId: the LogsQL
 * count() (large), its reduce (same number), and possibly a 0/1 threshold
 * expression. The max is therefore always the occurrence count.
 */
function countFromValues(values: Record<string, unknown> | undefined): number | undefined {
  const nums = Object.values(values ?? {}).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length > 0 ? Math.max(...nums) : undefined;
}

/**
 * Grafana's NATIVE webhook payload → our items. Preferred over a custom
 * payload template: Grafana's own serializer escapes JSON correctly, whereas
 * hand-built templates broke on error text containing backslashes/quotes.
 * The alert labels carry what we need — `full` (real error), `message`
 * (normalized dedup key), `requestId` — all produced by the LogsQL query.
 * Resolved alerts are skipped.
 */
function fromGrafanaPayload(body: unknown): IncomingError[] | null {
  const alerts = (body as { alerts?: unknown })?.alerts;
  if (!Array.isArray(alerts)) return null;
  const items: IncomingError[] = [];
  for (const a of alerts as GrafanaAlert[]) {
    if (a?.status === "resolved") continue;
    const labels = a?.labels ?? {};
    const message = labels["full"] || labels["message"] || a?.annotations?.["summary"] || labels["alertname"] || "";
    if (!message) continue;
    const count = countFromValues(a?.values);
    const occurredAt = a?.startsAt ? Date.parse(a.startsAt) : NaN;
    items.push({
      source: labels["source"] || "backend",
      message: message.slice(0, 20_000),
      ...(labels["message"] ? { normMessage: labels["message"] } : {}),
      ...(labels["requestId"] ? { sampleRequestId: labels["requestId"] } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(Number.isFinite(occurredAt) ? { occurredAt } : {}),
    });
  }
  return items;
}

/**
 * Ingest. Accepts Grafana's native payload, `{ items: [...] }`, or a single
 * item. Routes each error to a lane by the DB keyword/regex rules (no match →
 * default) and enqueues it on the lane's Redis stream. Responds fast (202);
 * the per-stream doctor-agents work the queues asynchronously.
 */
errorPipelineIngestRouter.post("/ingest", validateIngestAuth, async (req: Request, res: Response) => {
  const body = req.body as unknown;
  const grafanaItems = fromGrafanaPayload(body);
  const rawItems: unknown[] = grafanaItems ?? (Array.isArray((body as { items?: unknown[] })?.items)
    ? (body as { items: unknown[] }).items
    : [body]);

  const summary = {
    received: rawItems.length,
    queued: 0,
    deduped: 0,
    invalid: 0,
    failed: 0, // queue backend errors (redis down etc.)
    byBucket: {} as Record<string, number>,
  };

  for (const raw of rawItems) {
    if (!isIncomingError(raw)) {
      summary.invalid++;
      continue;
    }
    try {
      const classification = await classify(raw);
      const { outcome, bucket } = await routeError(raw, classification);
      if (outcome === "queued") {
        summary.queued++;
        summary.byBucket[bucket] = (summary.byBucket[bucket] ?? 0) + 1;
      } else {
        summary.deduped++;
      }
    } catch (err) {
      summary.failed++;
      log.error(`[ingest] enqueue failed: ${errMsg(err)}`);
    }
  }

  if (summary.invalid > 0) {
    log.warn(`[ingest] ${summary.invalid}/${summary.received} items invalid (missing source/message)`);
  }
  log.info(
    `[ingest] received=${summary.received} queued=${summary.queued} deduped=${summary.deduped} failed=${summary.failed}`,
  );

  if (summary.failed > 0 && summary.queued === 0 && summary.deduped === 0) {
    res.status(503).json({ ok: false, ...summary });
    return;
  }
  res.status(202).json({ ok: true, ...summary });
});
