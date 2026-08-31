import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, conflict, HttpError } from "../lib/http.js";
import { requireClawAdmin, getRequesterId, getOrgId, isClawAdmin, hasSearchEvalAccess , requireRequester} from "../middleware/agent-acl.js";
import { windowFromDays } from "../lib/time-window.js";
import { writeAuditLog } from "../lib/audit.js";
import { userRoleRepository, userRepository, auditLogRepository, agentRunRepository, agentRepository, sharedProviderCredentialRepository, agentProviderCredentialsRepository } from "../repositories/index.js";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { evictSession } from "../mcp/runner.js";
import { getDoctorBitbucketStats } from "../services/bitbucket-stats.js";
import { getAdminOrgScope, getOrgNameMap, withOrgLabel } from "../lib/admin-org-scope.js";

import jwt from "jsonwebtoken";
import { ERROR_PIPELINE } from "../config.js";
import { INGEST_JWT_AUDIENCE } from "./error-pipeline.js";
import { cloneBranchSession, piSessionStoreKey } from "./lib/branching.js";
import { chatMessageRepository } from "../repositories/index.js";
import { getQueue as epQueue } from "../error-pipeline/queue.js";
import { bucketStats as epBucketStats } from "../error-pipeline/buckets.js";
import { listFixRecords } from "../error-pipeline/runner/store.js";
import { createLogger } from "../logger.js";
const log = createLogger("admin");

const router = Router();

// Roles grantable through this generic endpoint. CLAW_ADMIN is the platform
// superset; SEARCH_EVAL_ACCESS is a narrower grant for the Search Evals
// feature (see middleware/agent-acl.ts hasSearchEvalAccess). Both routes stay
// gated by requireClawAdmin — granting the narrower role still requires full
// admin, so this isn't a privilege-escalation path.
const GRANTABLE_ROLES = ["CLAW_ADMIN", "SEARCH_EVAL_ACCESS"] as const;
type GrantableRole = (typeof GRANTABLE_ROLES)[number];

function parseRole(raw: unknown): GrantableRole | null {
  const r = typeof raw === "string" && raw.trim() ? raw.trim() : "CLAW_ADMIN";
  return (GRANTABLE_ROLES as readonly string[]).includes(r) ? (r as GrantableRole) : null;
}

router.get("/roles", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const role = parseRole(req.query["role"]);
  if (!role) throw badRequest(`role must be one of: ${GRANTABLE_ROLES.join(", ")}`);
  // TODO(admin-org-scope): user_roles has no orgId by design; keep grants platform-global.
  const roles = await userRoleRepository.listByRole(role);
  const orgNames = await getOrgNameMap(roles.map((r) => r.user.orgId));
  ok(res, roles.map((r) => ({
    ...r,
    user: withOrgLabel(r.user, orgNames),
  })));
}));

router.post("/roles", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)!;
  // Accept the field as `userId` (legacy) or `userIdOrEmail` (frontend
  // started passing emails too). Either is looked up first by ID then by
  // email — matches the pattern used by /subagents/:name/shares.
  const body = req.body as { userId?: string; userIdOrEmail?: string; role?: string };
  const raw = (body.userIdOrEmail ?? body.userId ?? "").trim();
  if (!raw) throw badRequest("userId or email is required");
  const role = parseRole(body.role);
  if (!role) throw badRequest(`role must be one of: ${GRANTABLE_ROLES.join(", ")}`);

  let targetUser = await userRepository.findById(raw);
  const requesterOrgId = getOrgId(req);
  if (!targetUser && requesterOrgId) {
    targetUser = await prisma.user.findFirst({ where: { email: raw, orgId: requesterOrgId } });
  }
  if (!targetUser) throw notFound(`No user matches "${raw}"`);

  const grantedRole = await userRoleRepository.upsert(targetUser.id, role, requesterId);
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "ROLE_GRANTED",
    targetId: targetUser.id,
    description: `${role} granted to ${targetUser.email}`,
    metadata: { targetEmail: targetUser.email, role },
  });
  log.info(`[admin] ${role} granted to user=${targetUser.id} by ${requesterId}`);
  res.status(201).json({ success: true, data: grantedRole });
}));

router.delete("/roles/:userId", requireClawAdmin, async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const { userId } = req.params;
    const role = parseRole(req.query["role"]);
    if (!role) {
      res.status(400).json({ success: false, error: `role must be one of: ${GRANTABLE_ROLES.join(", ")}` });
      return;
    }
    if (userId === requesterId) { res.status(400).json({ success: false, error: `Cannot revoke your own ${role} role` }); return; }

    const targetUser = await userRepository.findById(userId);
    if (!targetUser) { res.status(404).json({ success: false, error: "User not found" }); return; }

    await userRoleRepository.delete(userId, role);
    await writeAuditLog({ actorUserId: requesterId, eventType: "ROLE_REVOKED", targetId: userId, description: `${role} revoked from ${targetUser.email}`, metadata: { targetEmail: targetUser.email, role } });
    log.info(`[admin] ${role} revoked from user=${targetUser.id} by ${requesterId}`);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "User does not have that role" });
      return;
    }
    log.error("[admin] revoke role error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Self-check only. The `:userId` path param is preserved for backward
// compatibility with the existing frontend helper (checkIsAdmin) but is
// IGNORED — the admin lookup is always run against the authenticated
// caller resolved by requireAuth. This prevents a non-admin from probing
// arbitrary userIds to discover who in the org is a CLAW_ADMIN.
router.get("/roles/check/:userId", asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
  const requesterId = requireRequester(req, "Unauthenticated");
  const [admin, searchEvalAccess] = await Promise.all([
    isClawAdmin(requesterId),
    hasSearchEvalAccess(requesterId),
  ]);
  ok(res, { isAdmin: admin, hasSearchEvalAccess: searchEvalAccess });
}));

router.get("/audit-logs", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/audit-logs");
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const eventType = req.query["eventType"] as string | undefined;
  const targetId = req.query["targetId"] as string | undefined;
  const startRaw = req.query["startDate"] as string | undefined;
  const endRaw = req.query["endDate"] as string | undefined;
  const startDate = startRaw ? new Date(startRaw) : undefined;
  const endDate = endRaw ? new Date(endRaw) : undefined;
  const validStart = startDate && !Number.isNaN(startDate.getTime()) ? startDate : undefined;
  const validEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : undefined;
  // TODO(admin-org-scope): agent_audit_logs has no orgId; scope through actor user org where possible.
  const actorIds = scope.orgId
    ? await prisma.user.findMany({
      where: { orgId: scope.orgId },
      select: { id: true },
    }).then((rows) => rows.map((u) => u.id))
    : null;
  const [logs, total] = await Promise.all([
    auditLogRepository.list({ eventType, targetId, startDate: validStart, endDate: validEnd, limit, offset, actorUserIds: actorIds ?? undefined }),
    auditLogRepository.count({ eventType, targetId, startDate: validStart, endDate: validEnd, actorUserIds: actorIds ?? undefined }),
  ]);
  const logActorIds = Array.from(new Set(logs.map((l) => l.actorUserId).filter((id): id is string => Boolean(id))));
  const actors = logActorIds.length
    ? await prisma.user.findMany({
      where: { id: { in: logActorIds } },
      select: { id: true, orgId: true },
    })
    : [];
  const actorOrgById = new Map(actors.map((u) => [u.id, u.orgId] as const));
  const orgNames = await getOrgNameMap(actors.map((u) => u.orgId));
  ok(res, logs.map((l) => {
    const orgId = l.actorUserId ? (actorOrgById.get(l.actorUserId) ?? null) : null;
    return scope.allOrgs ? withOrgLabel({ ...l, orgId }, orgNames) : l;
  }), { total, limit, offset });
}));

// Everything below this line is admin-only.
//
// Guarding each route individually meant a route added without the guard was
// served to any authenticated caller, and several were: the dashboard reads,
// the error-pipeline reads, and a fork-conversation write. Default-deny here
// makes the guard the property of the router rather than something each new
// route has to remember.
//
// This sits AFTER `/roles/check/:userId` deliberately. That route answers "is
// the caller an admin" for the frontend and must stay reachable by non-admins;
// it already resolves the requester itself and ignores the path parameter.
// Routes registered above keep their explicit `requireClawAdmin` — redundant
// now, but harmless, and removing them would make this ordering load-bearing
// in a way that is easy to break later.
router.use(requireClawAdmin);


// ── Ratings aggregation ──────────────────────────────────────────────

function cutoffFromDays(daysParam: unknown): Date | null {
  if (daysParam === "all") return null;
  const days = typeof daysParam === "string" ? parseInt(daysParam, 10) : NaN;
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

router.get("/ratings/stats", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/ratings/stats");
  const cutoff = cutoffFromDays(req.query["days"] ?? "30");
  const stats = await agentRunRepository.ratingStatsByAgent(cutoff, scope.orgId);
  ok(res, stats);
}));

router.get("/ratings/recent-downs", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/ratings/recent-downs");
  const cutoff = cutoffFromDays(req.query["days"] ?? "30");
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const rows = await agentRunRepository.recentDownRuns(cutoff, limit, scope.orgId);
  const orgNames = scope.allOrgs ? await getOrgNameMap(rows.map((r) => r.orgId)) : new Map();
  ok(res, rows.map((r) => (scope.allOrgs ? withOrgLabel(r, orgNames) : r)));
}));

// ── Usage aggregation (per-agent token + run counts) ─────────────────

router.get("/usage/stats", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/usage/stats");
  const cutoff = cutoffFromDays(req.query["days"] ?? "30");
  const rows = await prisma.agentRun.groupBy({
    by: scope.allOrgs ? ["orgId", "agentSlug"] : ["agentSlug"],
    where: {
      ...(cutoff ? { startedAt: { gte: cutoff } } : {}),
      ...(scope.orgId ? { orgId: scope.orgId } : {}),
    },
    _count: { _all: true },
    _sum: {
      tokensIn: true,
      tokensOut: true,
      tokensCacheRead: true,
      tokensCacheWrite: true,
    },
  });
  const orgNames = scope.allOrgs ? await getOrgNameMap(rows.map((r) => "orgId" in r ? r.orgId : null)) : new Map();
  const stats = rows
    .map((r) => ({
      agentSlug: r.agentSlug,
      ...("orgId" in r ? withOrgLabel({ orgId: r.orgId }, orgNames) : {}),
      runs: r._count._all,
      tokensIn: r._sum.tokensIn ?? 0,
      tokensOut: r._sum.tokensOut ?? 0,
      tokensCacheRead: r._sum.tokensCacheRead ?? 0,
      tokensCacheWrite: r._sum.tokensCacheWrite ?? 0,
    }))
    .sort((a, b) => (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut));
  ok(res, stats);
}));

// ── Scheduled jobs (admin-wide view) ─────────────────────────────────

router.get("/scheduled-jobs", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const scope = getAdminOrgScope(req, "/admin/scheduled-jobs");
  const { status, agentSlug, userId } = req.query as {
    status?: string;
    agentSlug?: string;
    userId?: string;
  };
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

  const where: Record<string, unknown> = {};
  if (scope.orgId) where["orgId"] = scope.orgId;
  if (status) where["status"] = status;
  if (agentSlug) where["agentSlug"] = agentSlug;
  if (userId) where["userId"] = userId;

  const [rows, total] = await Promise.all([
    prisma.scheduledJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.scheduledJob.count({ where }),
  ]);

  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const users = await userRepository.findByIds(userIds);
  const userById = new Map(users.map((u) => [u.id, u]));
  const orgNames = scope.allOrgs ? await getOrgNameMap(rows.map((r) => r.orgId)) : new Map();

  ok(res, {
    rows: rows.map((r) => ({
      ...r,
      ...(scope.allOrgs ? withOrgLabel({ orgId: r.orgId }, orgNames) : {}),
      delayMs: r.delayMs != null ? Number(r.delayMs) : null,
      user: userById.get(r.userId) ?? null,
    })),
    total,
  });
}));

// ── Global MCP credentials (admin-only fallback creds) ──────────────────────

router.get("/mcp-servers", requireClawAdmin, asyncHandler(async (_req: Request, res: Response) => {
  // Platform-global by design: the Global MCP tab manages shared fallback registry/credentials.
  const servers = await prisma.mcpServer.findMany({
    include: { globalCredentials: true },
    orderBy: { name: "asc" },
  });
  ok(res, servers.map((s) => {
    // Legacy top-level fields reflect the deployment-wide default row
    // (orgId NULL); org overrides are listed separately.
    const defaultCreds = s.globalCredentials.find((c) => c.orgId === null) ?? null;
    return {
      id: s.id,
      type: s.type,
      name: s.name,
      description: s.description,
      enabled: s.enabled,
      allowGlobalFallback: s.allowGlobalFallback,
      hasGlobalCredentials: Boolean(defaultCreds),
      globalCredentialsUpdatedAt: defaultCreds?.updatedAt ?? null,
      globalCredentialsSetByUserId: defaultCreds?.setByUserId ?? null,
      orgGlobalCredentials: s.globalCredentials
        .filter((c) => c.orgId !== null)
        .map((c) => ({ orgId: c.orgId, updatedAt: c.updatedAt, setByUserId: c.setByUserId })),
    };
  }));
}));

router.put("/mcp-servers/:type/global-fallback", requireClawAdmin, asyncHandler(async (req: Request<{ type: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { allow } = req.body as { allow?: boolean };
  if (typeof allow !== "boolean") throw badRequest("allow (boolean) is required");
  const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
  if (!server) throw notFound("MCP server not found");

  await prisma.mcpServer.update({ where: { id: server.id }, data: { allowGlobalFallback: allow } });
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: allow ? "MCP_GLOBAL_FALLBACK_ENABLED" : "MCP_GLOBAL_FALLBACK_DISABLED",
    targetId: server.id,
    description: `Global fallback ${allow ? "enabled" : "disabled"} for MCP server ${server.type}`,
  });
  ok(res, { type: server.type, allowGlobalFallback: allow });
}));

router.put("/mcp-servers/:type/global-credentials", requireClawAdmin, asyncHandler(async (req: Request<{ type: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { credentials, orgId } = req.body as { credentials?: Record<string, unknown>; orgId?: string };
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) throw badRequest("credentials object is required");
  // orgId omitted → deployment-wide default row (legacy behavior).
  const credOrgId = typeof orgId === "string" && orgId.trim() ? orgId.trim() : null;
  if (credOrgId) {
    const org = await prisma.organization.findUnique({ where: { id: credOrgId } });
    if (!org) throw notFound("Organization not found");
  }
  const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
  if (!server) throw notFound("MCP server not found");

  const enc = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
  // Manual upsert: the composite unique includes a nullable orgId, which
  // Prisma's upsert-where can't address for the NULL default row.
  const existing = await prisma.globalMcpCredentials.findFirst({
    where: { mcpServerId: server.id, orgId: credOrgId },
  });
  const data = {
    encryptedCreds: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    setByUserId: requesterId,
  };
  const row = existing
    ? await prisma.globalMcpCredentials.update({ where: { id: existing.id }, data })
    : await prisma.globalMcpCredentials.create({
        data: { ...data, mcpServerId: server.id, orgId: credOrgId },
      });

  // Evict every cached MCP child whose env was baked from the OLD global
  // creds — running children belong to users who don't have personal creds
  // and were resolved via the global path. We don't track that mapping
  // explicitly, so the safe move is best-effort: nothing to do for sessions
  // not in memory; the next callTool will spawn a fresh child with new env.
  // (User-owned sessions never used these creds, so they're unaffected.)
  await evictSession("__global__", server.type).catch(() => {});

  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "MCP_GLOBAL_CREDENTIALS_SET",
    targetId: server.id,
    description: `Global credentials updated for MCP server ${server.type}${credOrgId ? ` (org ${credOrgId})` : " (default)"}`,
  });

  ok(res, {
    type: server.type,
    orgId: credOrgId,
    updatedAt: row.updatedAt,
    setByUserId: row.setByUserId,
  });
}));

router.delete("/mcp-servers/:type/global-credentials", requireClawAdmin, asyncHandler(async (req: Request<{ type: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  // ?orgId=<id> deletes that org's override; omitted → the default row.
  const orgIdParam = typeof req.query["orgId"] === "string" && req.query["orgId"].trim() ? req.query["orgId"].trim() : null;
  const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
  if (!server) throw notFound("MCP server not found");

  const { count } = await prisma.globalMcpCredentials.deleteMany({
    where: { mcpServerId: server.id, orgId: orgIdParam },
  });
  if (count === 0) throw notFound("No global credentials set");
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "MCP_GLOBAL_CREDENTIALS_REMOVED",
    targetId: server.id,
    description: `Global credentials removed for MCP server ${server.type}${orgIdParam ? ` (org ${orgIdParam})` : " (default)"}`,
  });
  ok(res);
}));

router.get("/mcp-servers/:type/global-credentials", requireClawAdmin, asyncHandler(async (req: Request<{ type: string }>, res: Response) => {
  // ?orgId=<id> inspects that org's override; omitted → the default row.
  const orgIdParam = typeof req.query["orgId"] === "string" && req.query["orgId"].trim() ? req.query["orgId"].trim() : null;
  const server = await prisma.mcpServer.findUnique({ where: { type: req.params.type } });
  if (!server) throw notFound("MCP server not found");
  const row = await prisma.globalMcpCredentials.findFirst({
    where: { mcpServerId: server.id, orgId: orgIdParam },
  });
  if (!row) {
    ok(res, { type: server.type, orgId: orgIdParam, hasCredentials: false });
    return;
  }
  const decrypted = decrypt(row.encryptedCreds, row.iv, row.authTag, CONFIG.encryptionKey);
  const creds = JSON.parse(decrypted) as Record<string, unknown>;
  // Don't return secret values — only field names so the admin UI can show
  // "[set]" indicators. Admin sets new creds via PUT.
  ok(res, {
    type: server.type,
    orgId: orgIdParam,
    hasCredentials: true,
    credentialKeys: Object.keys(creds),
    updatedAt: row.updatedAt,
    setByUserId: row.setByUserId,
  });
}));

// ── Shared provider credentials (org-level, bound to selected agents) ───────
// One stored OAuth bundle / API key (e.g. "Team Codex") referenced by many
// agents via AgentProviderCredentials.sharedCredentialId. Kills the per-agent
// token-copy pattern where every re-auth of one copy invalidated the others.

const SHAREABLE_PROVIDERS = new Set(["codex", "claude", "copilot", "openrouter", "litellm"]);

router.get("/provider-credentials", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const orgId = (typeof req.query["orgId"] === "string" && req.query["orgId"].trim()) || getOrgId(req);
  if (!orgId) throw badRequest("No org context");
  const rows = await sharedProviderCredentialRepository.listByOrg(orgId);
  ok(res, rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    name: r.name,
    model: r.model,
    authType: r.authType,
    hasKey: Boolean(r.encryptedKey),
    ownerUserId: r.ownerUserId,
    updatedAt: r.updatedAt,
    boundAgents: r.agentBindings.map((b) => ({
      agentId: b.agentId,
      slug: b.agent.slug,
      name: b.agent.name,
      modelOverride: b.model,
    })),
  })));
}));

/** Promote an agent's existing DEDICATED credential into a shared org
 *  credential and re-bind that agent to it. The natural creation flow: connect
 *  the provider on one agent via the existing UI, then promote + bind others. */
router.post("/provider-credentials/promote", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { agentId, provider, name, platform } = req.body as { agentId?: string; provider?: string; name?: string; platform?: boolean };
  if (!agentId || !provider || !name?.trim()) throw badRequest("agentId, provider and name are required");
  if (!SHAREABLE_PROVIDERS.has(provider)) throw badRequest(`provider must be one of: ${[...SHAREABLE_PROVIDERS].join(", ")}`);
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, orgId: true, slug: true } });
  if (!agent) throw notFound("Agent not found");
  // Read the RAW row (not the materialized view) — promoting a binding would
  // otherwise copy the other shared cred's material into a new row.
  const raw = await prisma.agentProviderCredentials.findUnique({
    where: { agentId_provider: { agentId, provider } },
  });
  if (!raw?.encryptedKey || raw.sharedCredentialId) throw badRequest("Agent has no dedicated credential for this provider to promote");
  const shared = await sharedProviderCredentialRepository.create({
    // platform:true → orgId NULL: bindable across orgs (this route is
    // already CLAW_ADMIN-gated, which is the required privilege).
    orgId: platform ? null : agent.orgId,
    provider,
    name: name.trim(),
    encryptedKey: raw.encryptedKey,
    iv: raw.iv,
    authTag: raw.authTag,
    model: raw.model,
    baseUrl: raw.baseUrl,
    authType: raw.authType,
    reasoningEffort: raw.reasoningEffort,
    ownerUserId: requesterId,
  });
  await agentProviderCredentialsRepository.bindShared(agentId, provider, shared.id, {
    model: null, // shared default applies; set an override via bind if needed
    reasoningEffort: null,
  });
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "PROVIDER_CREDENTIAL_PROMOTED",
    targetId: shared.id,
    description: `Promoted ${provider} credential from agent ${agent.slug} to shared "${name.trim()}"`,
  });
  ok(res, { id: shared.id, provider, name: shared.name });
}));

router.post("/provider-credentials/:id/bind", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { agentId, model, reasoningEffort } = req.body as { agentId?: string; model?: string; reasoningEffort?: string };
  if (!agentId) throw badRequest("agentId is required");
  const shared = await sharedProviderCredentialRepository.findById(req.params.id);
  if (!shared) throw notFound("Shared credential not found");
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, orgId: true, slug: true } });
  if (!agent) throw notFound("Agent not found");
  // orgId NULL = platform-wide credential, bindable by any org's agents.
  if (shared.orgId && agent.orgId !== shared.orgId) throw forbidden("Agent and credential belong to different orgs");
  await agentProviderCredentialsRepository.bindShared(agentId, shared.provider, shared.id, {
    model: model?.trim() || null,
    reasoningEffort: reasoningEffort?.trim() || null,
  });
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "PROVIDER_CREDENTIAL_BOUND",
    targetId: shared.id,
    description: `Bound agent ${agent.slug} to shared ${shared.provider} credential "${shared.name}"`,
  });
  ok(res, { agentId, provider: shared.provider, sharedCredentialId: shared.id });
}));

router.post("/provider-credentials/:id/unbind", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { agentId } = req.body as { agentId?: string };
  if (!agentId) throw badRequest("agentId is required");
  const shared = await sharedProviderCredentialRepository.findById(req.params.id);
  if (!shared) throw notFound("Shared credential not found");
  const { count } = await prisma.agentProviderCredentials.deleteMany({
    where: { agentId, provider: shared.provider, sharedCredentialId: shared.id },
  });
  if (count === 0) throw notFound("Agent is not bound to this credential");
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "PROVIDER_CREDENTIAL_UNBOUND",
    targetId: shared.id,
    description: `Unbound agent ${agentId} from shared ${shared.provider} credential "${shared.name}"`,
  });
  ok(res);
}));

/** Re-auth path: after reconnecting the provider on ONE agent (existing UI
 *  flow writes a fresh dedicated bundle to that agent), adopt that bundle into
 *  the shared row and re-bind the agent. Every bound agent picks up the new
 *  session on its next run — no per-agent reconnects. */
router.post("/provider-credentials/:id/adopt", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { agentId } = req.body as { agentId?: string };
  if (!agentId) throw badRequest("agentId is required");
  const shared = await sharedProviderCredentialRepository.findById(req.params.id);
  if (!shared) throw notFound("Shared credential not found");
  const raw = await prisma.agentProviderCredentials.findUnique({
    where: { agentId_provider: { agentId, provider: shared.provider } },
  });
  if (!raw?.encryptedKey || raw.sharedCredentialId) throw badRequest("Agent has no fresh dedicated credential to adopt — reconnect the provider on it first");
  await sharedProviderCredentialRepository.updateCredential(shared.id, {
    encryptedKey: raw.encryptedKey,
    iv: raw.iv,
    authTag: raw.authTag,
    authType: raw.authType,
  });
  await agentProviderCredentialsRepository.bindShared(agentId, shared.provider, shared.id, {
    model: raw.model,
    reasoningEffort: raw.reasoningEffort,
  });
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "PROVIDER_CREDENTIAL_ADOPTED",
    targetId: shared.id,
    description: `Adopted fresh ${shared.provider} credential from agent ${agentId} into shared "${shared.name}"`,
  });
  ok(res);
}));

router.delete("/provider-credentials/:id", requireClawAdmin, asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const shared = await sharedProviderCredentialRepository.findById(req.params.id);
  if (!shared) throw notFound("Shared credential not found");
  const bindings = await sharedProviderCredentialRepository.countBindings(shared.id);
  if (bindings > 0) throw conflict(`Credential has ${bindings} bound agent(s) — unbind them first`);
  await sharedProviderCredentialRepository.delete(shared.id);
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "PROVIDER_CREDENTIAL_DELETED",
    targetId: shared.id,
    description: `Deleted shared ${shared.provider} credential "${shared.name}"`,
  });
  ok(res);
}));

// ── Agent Dashboard (single payload endpoint) ───────────────────────────────

// Open to any authenticated user (not gated by requireClawAdmin) — DELIBERATE.
// The org-wide agent dashboard is a core surface for everyone with a Spaces
// login: /v3/home (insight strip, needs-attention, recent runs) and
// /v3/dashboard are built on these endpoints for non-admins. Mount-level
// requireAuth still applies. Restricting these to admins is a product
// decision, not an auth fix — don't add requireClawAdmin here without also
// reworking those frontend surfaces.
router.get("/dashboard", asyncHandler(async (req: Request, res: Response) => {
  const window = windowFromDays(req.query["days"] ?? "30");
  const cutoff = window?.start ?? null;
  const limit = Math.min(Number(req.query["topUsersLimit"] ?? 10), 50);

  const [agentStats, overview, agentRunStats, rawUserActivity, ratingStats, agentsForDashboard, skillUsage, subagentUsage] = await Promise.all([
    agentRepository.dashboardStats(),
    agentRunRepository.globalOverviewStats(cutoff),
    agentRunRepository.runStatsByAgent(cutoff),
    agentRunRepository.userActivityBreakdown(cutoff, limit),
    agentRunRepository.ratingStatsByAgent(cutoff),
    agentRepository.listForDashboard(),
    agentRepository.skillUsageByGlobalAgents(),
    agentRepository.subagentUsageByGlobalAgents(),
  ]);

  const ratingBySlug = new Map(ratingStats.map((r) => [r.agentSlug, r] as const));
  const runStatsBySlug = new Map(agentRunStats.map((r) => [r.agentSlug, r] as const));

  const buildRow = (slug: string, run: typeof agentRunStats[number] | undefined, meta: typeof agentsForDashboard[number] | undefined) => {
    const rating = ratingBySlug.get(slug);
    return {
      agentSlug: slug,
      totalRuns: run?.totalRuns ?? 0,
      uniqueUsers: run?.uniqueUsers ?? 0,
      completedRuns: run?.completedRuns ?? 0,
      failedRuns: run?.failedRuns ?? 0,
      avgDurationMs: run?.avgDurationMs ?? null,
      totalTokensIn: run?.totalTokensIn ?? 0,
      totalTokensOut: run?.totalTokensOut ?? 0,
      upCount: rating?.upCount ?? 0,
      downCount: rating?.downCount ?? 0,
      ratedCount: rating?.ratedCount ?? 0,
      negativeRate: rating?.negativeRate ?? 0,
      agentName: meta?.name ?? slug,
      agentScope: meta?.scope ?? null,
      agentEnabled: meta?.enabled ?? null,
      agentRegistered: meta?.spacesAppId != null,
      ownerEmail: meta?.owner?.email ?? null,
    };
  };

  // Only include global-scope agents; orphan slugs (deleted) appended below.
  const agentTable = agentsForDashboard
    .filter((meta) => meta.scope === "global")
    .map((meta) => buildRow(meta.slug, runStatsBySlug.get(meta.slug), meta));

  // Runs for slugs not in agents table (deleted agents, typos) — append at end.
  for (const run of agentRunStats) {
    if (!agentsForDashboard.some((a) => a.slug === run.agentSlug)) {
      agentTable.push(buildRow(run.agentSlug, run, undefined));
    }
  }

  agentTable.sort((a, b) => b.totalRuns - a.totalRuns || a.agentName.localeCompare(b.agentName));

  const agents = agentsForDashboard.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    scope: a.scope,
    enabled: a.enabled,
    ownerUserId: a.ownerUserId,
    spacesAppId: a.spacesAppId,
    createdAt: a.createdAt,
    promotedAt: a.promotedAt,
    owner: a.owner,
    _count: a._count,
  }));

  // Build unified user activity rows: top users + per-agent breakdown (global agents only)
  const userActivityBreakdown = rawUserActivity.map((u) => {
    const agentRows = u.perAgent
      .filter((a) => {
        const meta = agentsForDashboard.find((m) => m.slug === a.agentSlug);
        return meta?.scope === "global";
      })
      .map((a) => {
      const meta = agentsForDashboard.find((m) => m.slug === a.agentSlug);
      return {
        agentSlug: a.agentSlug,
        agentName: meta?.name ?? a.agentSlug,
        agentScope: "global" as const,
        agentEnabled: meta?.enabled ?? null,
        agentRegistered: meta?.spacesAppId != null,
        owned: false,
        runCount: a.runCount,
        completedRuns: a.completedRuns,
        failedRuns: a.failedRuns,
        avgDurationMs: a.avgDurationMs,
        lastRunAt: a.lastRunAt,
        totalTokens: a.tokensIn + a.tokensOut,
      };
    });

    return {
      userId: u.userId,
      name: u.name,
      email: u.email,
      totalRuns: u.totalRuns,
      uniqueAgents: u.uniqueAgents,
      totalTokensIn: u.totalTokensIn,
      totalTokensOut: u.totalTokensOut,
      agents: agentRows,
    };
  });

  ok(res, {
    agentStats,
    overview,
    agentTable,
    agents,
    userActivityBreakdown,
    skillUsage,
    subagentUsage,
  });
}));

// ── Project Insights ─────────────────────────────────────────────────────────

/** GET /api/v1/admin/dashboard/projects?days=all
 *  Returns distinct projects seen in agent_runs (for the dropdown). */
router.get("/dashboard/projects", asyncHandler(async (req: Request, res: Response) => {
  const window = windowFromDays(req.query["days"] ?? "all");
  const cutoff = window?.start ?? null;
  const projects = await agentRunRepository.listProjectsForDashboard(cutoff);
  ok(res, projects);
}));

/** GET /api/v1/admin/dashboard/project-insights?projectId=...&days=30
 *  Returns agent usage, top users, and skill usage scoped to one project. */
router.get("/dashboard/project-insights", asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query["projectId"] as string | undefined;
  if (!projectId) throw badRequest("projectId is required");
  const window = windowFromDays(req.query["days"] ?? "30");
  const cutoff = window?.start ?? null;

  const [agentUsage, topUsers, skillUsage, subagentUsage] = await Promise.all([
    agentRunRepository.projectAgentUsage(projectId, cutoff),
    agentRunRepository.projectTopUsers(projectId, cutoff, 10),
    agentRunRepository.projectSkillUsage(projectId, cutoff),
    agentRunRepository.projectSubagentUsage(projectId, cutoff),
  ]);

  // Enrich agent rows with name / scope / enabled from agent metadata
  const agentMeta = await agentRepository.listForDashboard();
  const metaBySlug = new Map(agentMeta.map((a) => [a.slug, a]));
  const enrichedAgentUsage = agentUsage.map((r) => ({
    ...r,
    agentName: metaBySlug.get(r.agentSlug)?.name ?? r.agentSlug,
    agentEnabled: metaBySlug.get(r.agentSlug)?.enabled ?? null,
    agentScope: (metaBySlug.get(r.agentSlug)?.scope ?? null) as "global" | "personal" | null,
  }));

  ok(res, { projectId, agentUsage: enrichedAgentUsage, topUsers, skillUsage, subagentUsage });
}));

// ── xyne-doctor PR / commit counts from Bitbucket ──────────────────────────
// Returns the live count of PRs and commits authored by the bot identity
// (default `john.doe@gmail.com`) in Bitbucket Server. The service caches
// for ~15 min and warms a background refresh on startup, so this endpoint is
// effectively a memory read.
// Open to any authenticated user — the dashboard renders this card for
// everyone, not just admins. Same rationale as /dashboard above.
router.get("/dashboard/bitbucket-stats", asyncHandler(async (_req: Request, res: Response) => {
  const data = await getDoctorBitbucketStats();
  ok(res, data);
}));

// Mint the Grafana error-pipeline ingest JWT. Claw admins only. The signing
// secret never leaves xyne-claw's env — this proxies to claw's internal
// mint endpoint (gated by the S2S key that only services hold) and returns
// the expiring, aud=error-pipeline token to paste into Grafana's webhook
// Authorization field. No kubectl, no secret handling.
router.post("/error-pipeline/token", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)!;
  if (!ERROR_PIPELINE.jwtSecret) throw new HttpError(503, "ERROR_PIPELINE_JWT_SECRET not configured");
  const days = Number((req.body as { days?: unknown })?.days ?? 90);
  if (!Number.isFinite(days) || days <= 0 || days > 365) throw badRequest("days must be 1-365");
  const token = jwt.sign(
    { iss: "xyne-claw-auth", sub: "grafana-webhook" },
    ERROR_PIPELINE.jwtSecret,
    { algorithm: "HS256", audience: INGEST_JWT_AUDIENCE, expiresIn: `${days}d` },
  );
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  // Traceability without a schema change: AgentAuditEvent is a Prisma enum
  // and token minting doesn't fit any existing value; the actor + expiry are
  // queryable in logs.
  log.info(`[admin] error-pipeline ingest JWT minted by ${requesterId} (expires ${expiresAt})`);
  ok(res, { token, expiresAt });
}));

// Error-pipeline inspection — the pipeline lives in THIS service now, so
// these read the queue/store directly (the old S2S proxies to claw are gone).
// READ endpoints (items/buckets/fixes/rules GET) are open to any
// authenticated user (the /admin mount already runs requireAuth) so the
// Error Pipeline page is viewable org-wide; every WRITE (rule save/delete,
// flush, seed, token mint) stays CLAW_ADMIN-gated.
router.get("/error-pipeline/items/:bucket", asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 100) || 100, 500);
  const bucket = String(req.params["bucket"] ?? "default");
  const items = await epQueue().peekItems(bucket, limit);
  ok(res, { bucket, count: items.length, items });
}));

// Seed / factory-reset the error-pipeline bucket taxonomy (12 buckets with
// the grounded markers from the backend code scan). Idempotent upsert by
// name — same admin-endpoint pattern as the signing-secret backfill; NOTE:
// overwrites any markers/matchOrder/description edited via admin since.
router.post("/error-pipeline/seed", requireClawAdmin, asyncHandler(async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const { ERROR_BUCKET_SEED } = await import("../lib/error-bucket-seed.js");
  for (const b of ERROR_BUCKET_SEED) {
    await prisma.errorBucket.upsert({
      where: { name: b.name },
      create: { name: b.name, description: b.description, keywords: b.keywords ?? [], matchOrder: b.matchOrder, markers: b.markers ?? "" },
      update: { description: b.description, keywords: b.keywords ?? [], matchOrder: b.matchOrder, markers: b.markers ?? "" },
    });
  }
  const total = await prisma.errorBucket.count();
  log.info(`[admin] error-pipeline buckets seeded by ${requesterId} (${ERROR_BUCKET_SEED.length} upserted, ${total} total)`);
  ok(res, { upserted: ERROR_BUCKET_SEED.length, total });
}));

router.get("/error-pipeline/buckets", asyncHandler(async (_req: Request, res: Response) => {
  ok(res, { buckets: await epBucketStats() });
}));

// Flush a lane's queue — drops all queued/pending items + their dedup markers
// for that lane (admin escape hatch for a junk-flooded lane; no redis-cli
// needed). The taxonomy row stays; only the Redis stream is cleared.
router.post("/error-pipeline/buckets/:name/flush", requireClawAdmin, asyncHandler(async (req: Request<{ name: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const name = String(req.params.name).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw badRequest("Invalid bucket name");
  const dropped = await epQueue().flushBucket(name);
  log.warn(`[admin] error-pipeline bucket "${name}" flushed by ${requesterId} (${dropped} items)`);
  ok(res, { bucket: name, dropped });
}));

/**
 * POST /error-pipeline/fork-conversation — private per-user thread for an error.
 *
 * The pipeline conversation belongs to no user and is READ-ONLY: claw keys
 * agent sessions by conversation+agent (not by user), so if several people
 * chatted on the same error they'd share ONE session — the UI hides their
 * messages from each other, but the model would still see everyone's turns and
 * could answer one person using another's question. Every user therefore gets
 * `<conv>__u__<userId>`, seeded with a FULL clone of the run's session so the
 * error, the RCA and the tool history all carry over. The canonical run thread
 * is never written to, so a later user forks from the clean run rather than
 * from someone else's tangent. Idempotent: repeat calls return the same id.
 */
router.post("/error-pipeline/fork-conversation", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id is required");
  const { conversationId } = (req.body ?? {}) as { conversationId?: string };
  if (!conversationId || !/^[A-Za-z0-9_-]{1,80}$/.test(conversationId)) throw badRequest("valid conversationId is required");
  const forkId = `${conversationId}__u__${requesterId}`;
  // Session ids ride filesystem paths in claw (isSafeId: [A-Za-z0-9_-]{1,128}).
  if (forkId.length > 128) throw badRequest("conversationId too long to fork");
  const slug = ERROR_PIPELINE.agentSlug;

  // AUTHORIZATION: only a PIPELINE conversation may be forked. Without this
  // the endpoint would clone ANY conversation's session into the caller's own
  // fork — letting them read someone else's private chat history through it.
  // A pipeline conversation is one owned by an automation run of the pipeline
  // agent, run as the pipeline's service user.
  const pipelineRun = await prisma.agentRun.findFirst({
    where: { conversationId, agentSlug: slug, triggerSource: "automation" },
    select: { id: true },
  });
  if (!pipelineRun) {
    log.warn(`[admin] fork-conversation refused: ${conversationId} is not an error-pipeline conversation (requester ${requesterId})`);
    throw notFound("Not an error-pipeline conversation");
  }

  // Already forked? The presence of messages is the cheap marker; the session
  // clone below is itself idempotent (claw skips when the target exists).
  const existing = await chatMessageRepository.findByConversationAndAgent(forkId, slug).catch(() => []);
  if (existing.length > 0) {
    ok(res, { conversationId: forkId, created: false });
    return;
  }

  const clone = await cloneBranchSession({
    sourceConversationId: piSessionStoreKey(conversationId, slug),
    targetConversationId: piSessionStoreKey(forkId, slug),
    branchMode: "full",
  }).catch((err) => ({ success: false, error: errMsg(err) }));
  // A missing source session (very old run, swept from disk+GCS) is NOT fatal:
  // the fork still works, the agent just starts without the run's history.
  if (!clone.success) {
    log.warn(`[admin] fork-conversation: session clone failed ${conversationId} → ${forkId}: ${clone.error ?? "unknown"}`);
  }
  log.info(`[admin] error-pipeline conversation forked for ${requesterId}: ${forkId} (session cloned=${clone.success})`);
  ok(res, { conversationId: forkId, created: true, sessionCloned: clone.success });
}));

router.get("/error-pipeline/fixes", asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 200) || 200, 500);
  ok(res, { fixes: await listFixRecords(limit) });
}));

// ── Error-pipeline bucket rule editing (CRUD on error_buckets) ───────
// claw-auth owns the table, so these write directly; xyne-claw's classifier
// picks up changes within ~60s (its in-memory rules-cache TTL). This is the
// whole point of the DB-backed taxonomy: when a new subsystem merges, add a
// lane or tune an existing lane's markers from the UI — no deploy.

router.get("/error-pipeline/rules", asyncHandler(async (_req: Request, res: Response) => {
  const rules = await prisma.errorBucket.findMany({
    orderBy: { matchOrder: "asc" },
    select: { name: true, description: true, keywords: true, markers: true, matchOrder: true, enabled: true, updatedAt: true },
  });
  ok(res, rules);
}));

router.put("/error-pipeline/rules/:name", requireClawAdmin, asyncHandler(async (req: Request<{ name: string }>, res: Response) => {
  const requesterId = getRequesterId(req)!;
  const name = String(req.params.name).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw badRequest("Bucket name must be lowercase letters, digits and dashes (e.g. tickets-desk).");

  if (name === "needs-human") throw badRequest('"needs-human" is reserved (dead-letter lane).');
  const body = req.body as { description?: string; keywords?: string[]; markers?: string; matchOrder?: number; enabled?: boolean };

  if (name === "default" && body.enabled === false) throw badRequest("The default bucket cannot be disabled — it is the routing fallback.");
  const markers = typeof body.markers === "string" ? body.markers.trim() : "";
  // Reject an invalid regex so a typo can't silently kill a lane's matching.
  if (markers) {
    try { new RegExp(markers); }
    catch (e) { throw badRequest(`Invalid advanced regex: ${e instanceof Error ? e.message : "bad pattern"}`); }
  }
  const keywords = Array.isArray(body.keywords)
    ? body.keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const matchOrder = Number.isInteger(body.matchOrder) ? (body.matchOrder as number) : 20;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  const saved = await prisma.errorBucket.upsert({
    where: { name },
    create: { name, description, keywords, markers, matchOrder, enabled },
    update: { description, keywords, markers, matchOrder, enabled },
  });
  log.info(`[admin] error-pipeline rule "${name}" saved by ${requesterId}`);
  ok(res, saved);
}));

router.delete("/error-pipeline/rules/:name", requireClawAdmin, async (req: Request<{ name: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const name = String(req.params.name).trim().toLowerCase();
    if (name === "default") {
      res.status(400).json({ success: false, error: "The default bucket is the fallback lane and cannot be deleted." });
      return;
    }
    // Refuse to strand queued work: after a restart no worker or stats row
    // would cover this lane's stream, silently losing the items.
    const depth = (await epQueue().stats([name]))[name];
    if (depth && depth.queued + depth.pending > 0) {
      res.status(409).json({ success: false, error: `Bucket "${name}" still has ${depth.queued + depth.pending} queued/in-flight item(s) — let them drain (or reroute them) before deleting.` });
      return;
    }
    await prisma.errorBucket.delete({ where: { name } });
    log.info(`[admin] error-pipeline rule "${name}" deleted by ${requesterId}`);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Bucket not found" });
      return;
    }
    log.error("[admin] error-pipeline rule delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as adminRouter };
