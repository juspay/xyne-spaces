/**
 * Agent-automations — self-proposed, event-driven agent wakeups.
 *
 * An agent proposes an automation ("when a comment is added to PR #123, wake me
 * on this thread"); a human approves it; a generic signed webhook then wakes the
 * agent INSIDE the original conversation each time a matching event arrives.
 *
 * The design intentionally copies xyne-spaces' GENERIC external `WEBHOOK`
 * trigger (unique URL = identity, encrypted rotatable secret, declared
 * body/header schema, service-actor dispatch) rather than shipping per-vendor
 * (GitHub/Stripe) adapters. See ./agent-automations/README.md.
 *
 * Three routers, mounted separately in main.ts:
 *   agentAutomationsHooksRouter    — PUBLIC ingress (auth = the URL secret)
 *   agentAutomationsRouter         — authed management (propose/approve/list/revoke)
 *   agentAutomationsInternalRouter — S2S run-result callback
 */

import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { getRequesterId, getOrgId, isClawAdmin } from "../middleware/agent-acl.js";
import { assertMatchesSchema } from "../agent-automations/declared-schema.js";
import { matchesPredicate, type Predicate } from "../agent-automations/predicate.js";
import { issueSecret, serializeStoredSecret, storedSecretMatches, sealSecret, openSecret } from "../agent-automations/secret.js";
import { verifySignature, isKnownVerifier, knownVerifierSources } from "../agent-automations/verify.js";
import { dispatchAutomationRun } from "../agent-automations/dispatch.js";

const log = createLogger("agent-automations");

// Public base for the issued webhook URL. Falls back to the internal URL so a
// dev environment still returns a working (if internal) address.
const PUBLIC_BASE = (process.env["AUTH_SERVICE_PUBLIC_URL"] ?? CONFIG.internalUrl).replace(/\/+$/, "");
const HOOK_PATH = "/claw/api/v1/agent-automations/hooks";

const STATUS = {
  PENDING: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
} as const;

// Headers never forwarded into the run's trigger context (mirrors xyne-spaces
// webhook-trigger.handler.ts which drops authorization/cookie).
const STRIPPED_HEADERS = new Set(["authorization", "cookie", "x-org-id", "x-user-id", "x-s2s-key"]);

function safeHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (STRIPPED_HEADERS.has(k.toLowerCase())) continue;
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(", ");
  }
  return out;
}

// All headers, lower-cased, for signature verification (the signature header
// itself must survive — so this does NOT strip like safeHeaders).
function lowerHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (Array.isArray(v)) out[k.toLowerCase()] = v.join(", ");
  }
  return out;
}

function deliveryIdFor(req: Request, body: unknown): string {
  const hdr =
    (req.headers["x-delivery-id"] as string) ||
    (req.headers["x-github-delivery"] as string) ||
    (req.headers["x-request-id"] as string);
  if (hdr && hdr.trim()) return hdr.trim().slice(0, 200);
  // Deterministic fallback so a duplicate re-POST with the same body dedups.
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

// ---------------------------------------------------------------------------
// PUBLIC INGRESS — auth is the URL secret. Always 202 on accept; the heavy run
// happens off the request path.
// ---------------------------------------------------------------------------
export const agentAutomationsHooksRouter = Router();

agentAutomationsHooksRouter.post("/:automationId/:secret", async (req: Request, res: Response) => {
  const automationId = String(req.params.automationId ?? "");
  const secret = String(req.params.secret ?? "");

  const auto = await prisma.agentAutomation.findFirst({ where: { id: automationId } }).catch(() => null);
  // Uniform 404 for "not found" AND "not active" so the endpoint can't be probed.
  if (!auto || auto.status !== STATUS.ACTIVE) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!auto.secret || !storedSecretMatches(secret, auto.secret)) {
    res.status(401).json({ error: "invalid secret" });
    return;
  }

  // Optional per-source signature verification (defense-in-depth on top of the
  // URL secret). Byte-exact: uses req.rawBody captured by main.ts, never a
  // re-serialised body. An unknown/misconfigured verifier fails closed.
  if (auto.verifySource) {
    if (!auto.signingSecret) {
      log.error(`[hooks] verifySource set without signingSecret automation=${auto.id}`);
      res.status(401).json({ error: "verification misconfigured" });
      return;
    }
    let signingSecret: string;
    try {
      signingSecret = openSecret(auto.signingSecret);
    } catch {
      res.status(401).json({ error: "verification misconfigured" });
      return;
    }
    const vr = verifySignature(auto.verifySource, {
      rawBody: (req as unknown as { rawBody?: Buffer }).rawBody,
      headers: lowerHeaders(req),
      signingSecret,
      signatureHeader: auto.signatureHeader,
    });
    if (!vr.ok) {
      res.status(401).json({ error: "signature verification failed" });
      return;
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Declared-schema gate → 400 (bad payload shape).
  if (auto.bodySchema) {
    try {
      assertMatchesSchema(body, auto.bodySchema as Record<string, unknown>);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "schema mismatch" });
      return;
    }
  }
  if (auto.headerSchema) {
    try {
      assertMatchesSchema(req.headers as Record<string, unknown>, auto.headerSchema as Record<string, unknown>);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "header schema mismatch" });
      return;
    }
  }

  // Per-resource predicate → 202 skipped (accepted but not a match; senders
  // that retry non-2xx should still see success).
  if (!matchesPredicate(body, (auto.matchPredicate as Predicate | null) ?? undefined)) {
    res.status(202).json({ status: "skipped", reason: "predicate" });
    return;
  }

  // Lifetime caps → 202 (accepted, not run). An expired automation is also
  // transitioned to EXPIRED so the ingress stops matching it (uniform 404
  // thereafter) and it drops out of the active set.
  if (auto.expiresAt && auto.expiresAt.getTime() < Date.now()) {
    await prisma.agentAutomation
      .update({ where: { id: auto.id }, data: { status: STATUS.EXPIRED, secret: null } })
      .catch(() => undefined);
    res.status(202).json({ status: "skipped", reason: "expired" });
    return;
  }
  if (auto.maxRuns != null && auto.runCount >= auto.maxRuns) {
    res.status(202).json({ status: "skipped", reason: "max-runs" });
    return;
  }

  const deliveryId = deliveryIdFor(req, body);

  // Idempotency: the unique (automationId, deliveryId) index is the dedup
  // boundary. A duplicate delivery loses the insert race and returns 202.
  let run;
  try {
    run = await prisma.agentAutomationRun.create({
      data: { automationId: auto.id, deliveryId, status: "PENDING" },
    });
  } catch (err) {
    // Prisma P2002 unique-constraint violation → already accepted this delivery.
    if ((err as { code?: string }).code === "P2002") {
      res.status(202).json({ status: "duplicate" });
      return;
    }
    log.error(`[hooks] run insert failed automation=${auto.id}: ${err instanceof Error ? err.message : err}`);
    res.status(500).json({ error: "internal" });
    return;
  }

  const trigger = { body, headers: safeHeaders(req), receivedAt: new Date().toISOString() };

  // Fire the run off the request path, then ack 202. runCount is advanced only
  // once the dispatch is accepted so a rejected dispatch doesn't burn quota.
  void dispatchAutomationRun({
    automationId: auto.id,
    runId: run.id,
    userId: auto.createdByUserId,
    orgId: auto.orgId,
    agentSlug: auto.agentSlug,
    conversationId: auto.conversationId,
    channelId: auto.channelId,
    task: auto.taskTemplate,
    trigger,
    deliveryId,
  })
    .then(async (r) => {
      await prisma.agentAutomationRun.update({
        where: { id: run.id },
        data: { status: r.success ? "DISPATCHED" : "FAILED", agentRunId: r.sessionId ?? null, error: r.error ?? null },
      });
      if (r.success) {
        await prisma.agentAutomation.update({
          where: { id: auto.id },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        });
      }
    })
    .catch((e) => log.error(`[hooks] dispatch tail failed run=${run.id}: ${e instanceof Error ? e.message : e}`));

  res.status(202).json({ status: "accepted", runId: run.id });
});

// ---------------------------------------------------------------------------
// MANAGEMENT (authed) — propose / approve / list / revoke
// ---------------------------------------------------------------------------
export const agentAutomationsRouter = Router();

async function resolveOrgId(req: Request, userId: string): Promise<string | undefined> {
  const fromHeader = getOrgId(req);
  if (fromHeader) return fromHeader;
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }).catch(() => null);
  return owner?.orgId ?? undefined;
}

// Propose — creates a PENDING_APPROVAL automation. Callable by a browser user
// or by the runtime (S2S) on behalf of the owning user via the propose tool.
agentAutomationsRouter.post("/", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  const b = req.body as {
    userId?: string;
    agentSlug?: string;
    conversationId?: string;
    channelId?: string;
    workspaceId?: string;
    source?: string;
    eventType?: string;
    bodySchema?: Record<string, unknown>;
    headerSchema?: Record<string, unknown>;
    matchPredicate?: Predicate;
    taskTemplate?: string;
    maxRuns?: number;
    expiresAt?: string;
    verifySource?: string;
    signingSecret?: string;
    signatureHeader?: string;
  };

  // Force ownership to the authed requester; only S2S or admins may set another.
  const userId = requesterId
    ? b.userId && b.userId !== requesterId && (await isClawAdmin(requesterId))
      ? b.userId
      : requesterId
    : b.userId;

  if (!userId || !b.agentSlug || !b.conversationId || !b.taskTemplate) {
    res.status(400).json({ success: false, error: "userId, agentSlug, conversationId and taskTemplate are required" });
    return;
  }

  const orgId = await resolveOrgId(req, userId);
  if (!orgId) {
    res.status(400).json({ success: false, error: "orgId is required" });
    return;
  }

  const agent = await prisma.agent.findFirst({ where: { slug: b.agentSlug, orgId }, select: { orgId: true } });
  if (!agent) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }

  // Optional signature verification config. Reject an unknown verifier at
  // propose-time (fail loud) rather than letting it silently no-op at ingress.
  // A verifier requires a signing secret; we seal it (AES-256-GCM) before store.
  let sealedSigningSecret: string | null = null;
  if (b.verifySource) {
    if (!isKnownVerifier(b.verifySource)) {
      res.status(400).json({ success: false, error: `unknown verifySource; known: ${knownVerifierSources().join(", ")}` });
      return;
    }
    if (!b.signingSecret) {
      res.status(400).json({ success: false, error: "signingSecret is required when verifySource is set" });
      return;
    }
    sealedSigningSecret = sealSecret(b.signingSecret);
  }

  const created = await prisma.agentAutomation.create({
    data: {
      orgId,
      createdByUserId: userId,
      agentSlug: b.agentSlug,
      conversationId: b.conversationId,
      channelId: b.channelId ?? null,
      workspaceId: b.workspaceId ?? null,
      source: b.source ?? "generic",
      eventType: b.eventType ?? "webhook",
      bodySchema: b.bodySchema ?? undefined,
      headerSchema: b.headerSchema ?? undefined,
      matchPredicate: b.matchPredicate ?? undefined,
      taskTemplate: b.taskTemplate,
      status: STATUS.PENDING,
      maxRuns: b.maxRuns ?? null,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      verifySource: b.verifySource ?? null,
      signingSecret: sealedSigningSecret,
      signatureHeader: b.signatureHeader ?? null,
    },
  });

  res.status(201).json({ success: true, id: created.id, status: created.status });
});

// Approve — HITL gate. Requires an INTERACTIVE requester (a real user via the
// browser); an S2S / agent call has no x-user-id and is rejected, so an agent
// can never self-activate its own proposal. Issues the secret + returns the
// webhook URL exactly ONCE.
agentAutomationsRouter.post("/:id/approve", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(403).json({ success: false, error: "approval requires an interactive user" });
    return;
  }

  const auto = await prisma.agentAutomation.findFirst({ where: { id: req.params.id } });
  if (!auto) {
    res.status(404).json({ success: false, error: "not found" });
    return;
  }
  if (auto.status !== STATUS.PENDING) {
    res.status(409).json({ success: false, error: `cannot approve from status ${auto.status}` });
    return;
  }
  // Same-org check; admins may approve cross-user within the org.
  const orgId = await resolveOrgId(req, requesterId);
  if (orgId !== auto.orgId && !(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "not permitted" });
    return;
  }

  const { plaintext, stored } = issueSecret();
  await prisma.agentAutomation.update({
    where: { id: auto.id },
    data: { status: STATUS.ACTIVE, approvedByUserId: requesterId, secret: serializeStoredSecret(stored) },
  });

  const url = `${PUBLIC_BASE}${HOOK_PATH}/${auto.id}/${plaintext}`;
  res.json({ success: true, id: auto.id, status: STATUS.ACTIVE, webhookUrl: url });
});

// Rotate the URL secret — interactive requester only, same-org (admins may
// cross-user). Invalidates the previous URL immediately and returns the new one
// exactly ONCE. Only meaningful for an ACTIVE automation.
agentAutomationsRouter.post("/:id/rotate-secret", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(403).json({ success: false, error: "rotation requires an interactive user" });
    return;
  }
  const auto = await prisma.agentAutomation.findFirst({ where: { id: req.params.id } });
  if (!auto) {
    res.status(404).json({ success: false, error: "not found" });
    return;
  }
  if (auto.status !== STATUS.ACTIVE) {
    res.status(409).json({ success: false, error: `cannot rotate from status ${auto.status}` });
    return;
  }
  if (auto.createdByUserId !== requesterId && !(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "not permitted" });
    return;
  }
  const { plaintext, stored } = issueSecret();
  await prisma.agentAutomation.update({ where: { id: auto.id }, data: { secret: serializeStoredSecret(stored) } });
  const url = `${PUBLIC_BASE}${HOOK_PATH}/${auto.id}/${plaintext}`;
  res.json({ success: true, id: auto.id, webhookUrl: url });
});

agentAutomationsRouter.get("/", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  const where = requesterId ? { createdByUserId: requesterId } : {};
  const rows = await prisma.agentAutomation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, agentSlug: true, conversationId: true, source: true, eventType: true,
      status: true, runCount: true, maxRuns: true, expiresAt: true, lastRunAt: true, createdAt: true,
    },
  });
  res.json({ success: true, automations: rows });
});

agentAutomationsRouter.post("/:id/revoke", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  const auto = await prisma.agentAutomation.findFirst({ where: { id: req.params.id } });
  if (!auto) {
    res.status(404).json({ success: false, error: "not found" });
    return;
  }
  if (requesterId && auto.createdByUserId !== requesterId && !(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "not permitted" });
    return;
  }
  await prisma.agentAutomation.update({ where: { id: auto.id }, data: { status: STATUS.REVOKED, secret: null } });
  res.json({ success: true, id: auto.id, status: STATUS.REVOKED });
});

// ---------------------------------------------------------------------------
// INTERNAL (S2S) — run-result callback. Mounted under requireStrictS2S.
// ---------------------------------------------------------------------------
export const agentAutomationsInternalRouter = Router();

agentAutomationsInternalRouter.post("/runs/:runId/result", async (req: Request, res: Response) => {
  const { status, error } = (req.body ?? {}) as { status?: string; error?: string };
  await prisma.agentAutomationRun
    .update({
      where: { id: req.params.runId },
      data: { status: status ?? "COMPLETED", error: error ?? null, completedAt: new Date() },
    })
    .catch((e: unknown) => log.warn(`[result] update failed run=${req.params.runId}: ${e instanceof Error ? e.message : e}`));
  res.json({ success: true });
});
