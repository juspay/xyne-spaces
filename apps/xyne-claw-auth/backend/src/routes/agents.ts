import { Router, type Request, type RequestHandler, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { assertSafeOutboundUrl } from "../mcpgateway/services/http-client.js";
import multer from "multer";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { agentRepository, agentShareRepository, agentRequestRepository, userRepository, userAgentConfigRepository, userProviderCredentialsRepository, agentProviderCredentialsRepository, sharedProviderCredentialRepository, skillRepository } from "../repositories/index.js";
import { validateSubagentInput, ValidationError as SubagentValidationError } from "../lib/subagent-resolver.js";
import { getSubagentDefinition, buildCloneApprovalFlow, normalizeAgentPrivacy, parseAgentPrivacy } from "xyne-claw-shared";
import { spacesAppFetch } from "../lib/spaces-api.js";
import { getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { LOCAL_HARNESS_PROVIDERS } from "../lib/local-harness.js";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { encrypt, decrypt } from "../crypto.js";
import { checkHealth } from "../health.js";
import { fetchAndStoreSigningSecretFromSpacesApi } from "../lib/spaces-app-secret.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { extractClaudeBearer } from "../lib/claude-creds.js";
import { redisService } from "../redis.js";
import {
  requireClawAdmin,
  requireAgentOwnerOrAdmin,
  requireAgentOwnerContributorOrAdmin,
  getAgentEditAccess,
  getRequesterId,
  getOrgId,
  isClawAdmin,
  requireRequester,
} from "../middleware/agent-acl.js";
import { getRequesterAliases, matchesAuthenticatedUserId, pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { findUserByAnyId } from "../lib/users-jit.js";
import { s2sKeyMatches } from "../middleware/require-auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { buildAvailableToolsCatalog } from "./tools.js";
import { validateAgentModelConfig, validateAwakeningConfig } from "../lib/agent-config-validation.js";
import { syncAwakeningState } from "../awakening/lifecycle.js";
import { auditModelSettingsChange } from "../lib/model-settings-audit.js";
import { validateKbGrants } from "../lib/spaces-kb.js";
import { ORG_SCOPED_SLUGS } from "../lib/org-scoped-slugs.js";
import { getAdminOrgScope, getOrgNameMap, withOrgLabel } from "../lib/admin-org-scope.js";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, conflict, HttpError } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("agents");

const router = Router();

function decryptStoredToken(stored: string): string | null {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) return null;
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

function logAgentScopedMiss(req: Request, routeName: string, slug: string | undefined, orgId?: string | null): void {
  log.warn(`[${routeName}] agent org-scoped miss slug=${slug ?? "none"} orgId=${orgId ?? getOrgId(req) ?? "none"} userId=${getRequesterId(req) ?? "none"}`);
}

/**
 * Strip secret-bearing columns before an agent row is sent to a client.
 * `signingSecret` (webhook HMAC secret — lets an attacker forge
 * X-Xyne-Signature) and `spacesAppToken` (encrypted bot JWT) must never leave
 * the server; the owner relation is trimmed to non-sensitive identity fields.
 * Returns whether each secret is set so the UI can still show "(configured)".
 */
function sanitizeAgent<T extends Record<string, unknown>>(agent: T): T {
  if (!agent || typeof agent !== "object") return agent;
  const owner = agent["owner"] as { id?: string; name?: string; email?: string } | null | undefined;
  return {
    ...agent,
    signingSecret: agent["signingSecret"] ? "(set)" : null,
    spacesAppToken: agent["spacesAppToken"] ? "(set)" : null,
    ...(owner ? { owner: { id: owner.id, name: owner.name, email: owner.email } } : {}),
  } as unknown as T;
}

function lightAgentProjection(agent: Record<string, unknown>, orgNames?: Map<string, string>): Record<string, unknown> {
  const owner = agent["owner"] as { id?: string; name?: string; email?: string } | null | undefined;
  const orgId = typeof agent["orgId"] === "string" ? agent["orgId"] : null;
  // Derived flag for chat surfaces (Spaces Ask AI composer): whether this
  // agent has fast mode configured — a fast-mode provider profile and/or a
  // default speed in its model settings. The light list never exposes the
  // config itself, so consumers get just the boolean.
  const cfg = agent["config"] as Record<string, unknown> | null | undefined;
  const ms = cfg?.["modelSettings"] as Record<string, unknown> | undefined;
  const fastModeConfigured =
    ms?.["speed"] === "fast" || ms?.["speed"] === "standard" ||
    (cfg?.["fastModeProfile"] !== undefined && cfg?.["fastModeProfile"] !== null);
  return {
    id: agent["id"],
    slug: agent["slug"],
    name: agent["name"],
    description: agent["description"],
    color: agent["color"],
    scope: agent["scope"],
    delegationTier: agent["delegationTier"] ?? "standard",
    ownerUserId: agent["ownerUserId"],
    createdBy: agent["ownerUserId"],
    orgId: agent["orgId"],
    ...(orgNames && orgId ? { orgName: orgNames.get(orgId) ?? orgId } : {}),
    enabled: agent["enabled"],
    isDefault: agent["isDefault"],
    activePromptVersion: agent["activePromptVersion"],
    kbScope: agent["kbScope"],
    fastModeConfigured,
    modelId: agent["modelId"],
    spacesAppId: agent["spacesAppId"],
    spacesAppUserId: agent["spacesAppUserId"],
    spacesAppTokenConfigured: Boolean(agent["spacesAppToken"]),
    signingSecretConfigured: Boolean(agent["signingSecret"]),
    createdAt: agent["createdAt"],
    updatedAt: agent["updatedAt"],
    ...(owner ? { owner: { id: owner.id, name: owner.name, email: owner.email } } : {}),
  };
}

const DEFAULT_GATEWAY_TENANT = process.env.ALLOWED_TENANTS
  ?.split(",")
  .map((tenant) => tenant.trim())
  .find((tenant) => tenant.length > 0);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function configArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readConfigToolSelection(config: unknown): string[] {
  const record = asRecord(config);
  const tools = asRecord(record?.["tools"]);
  if (!tools) return [];
  const out: string[] = [];
  for (const key of ["subagents", "direct", "custom", "gateway"]) {
    for (const item of configArray(tools[key])) out.push(`${key}:${item}`);
  }
  return out;
}

function readTopLevelGatewaySelection(config: unknown): string[] {
  return configArray(asRecord(config)?.["gateway"]);
}

function diffStrings(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((item) => !b.has(item)),
    removed: before.filter((item) => !a.has(item)),
  };
}

function logAgentConfigWriteDiff(agentSlug: string, userId: string | undefined, beforeConfig: unknown, afterConfig: unknown): void {
  const toolsDiff = diffStrings(readConfigToolSelection(beforeConfig), readConfigToolSelection(afterConfig));
  const gatewayDiff = diffStrings(readTopLevelGatewaySelection(beforeConfig), readTopLevelGatewaySelection(afterConfig));
  const added = [...toolsDiff.added, ...gatewayDiff.added.map((item) => `config.gateway:${item}`)];
  const removed = [...toolsDiff.removed, ...gatewayDiff.removed.map((item) => `config.gateway:${item}`)];
  if (added.length === 0 && removed.length === 0) return;
  log.info(`[agents] config.tools changed agent=${agentSlug} by=${userId ?? "unknown"} added=[${added.join(",")}] removed=[${removed.join(",")}]`);
}

async function normalizeGatewayServicesInConfig(config: Record<string, unknown> | undefined): Promise<Record<string, unknown> | undefined> {
  if (!config) return config;

  const tools = asRecord(config["tools"]);
  if (!tools) return config;
  const gateway = tools["gateway"];
  if (!Array.isArray(gateway) || gateway.length === 0) return config;

  const normalized: string[] = [];
  const seen = new Set<string>();

  const gatewayTenant = DEFAULT_GATEWAY_TENANT;
  let serviceRows: Array<{ serviceName: string; tools: Prisma.JsonValue }> = [];
  if (gatewayTenant) {
    serviceRows = await prisma.serviceRegistry.findMany({
      where: { tenantUniqueId: gatewayTenant },
      select: { serviceName: true, tools: true },
    });
  }

  const serviceByTool = new Map<string, string>();
  const knownServices = new Set<string>();
  for (const row of serviceRows) {
    knownServices.add(row.serviceName);
    const rawTools = Array.isArray(row.tools) ? row.tools : [];
    for (const t of rawTools) {
      if (!t || typeof t !== "object" || Array.isArray(t)) continue;
      const name = (t as Record<string, unknown>)["name"];
      if (typeof name === "string" && name.trim()) {
        serviceByTool.set(name.trim(), row.serviceName);
      }
    }
  }

  for (const entry of gateway) {
    if (typeof entry !== "string") continue;
    const raw = entry.trim();
    if (!raw) continue;

    const mappedService = serviceByTool.get(raw);
    const resolved = mappedService
      ?? (knownServices.has(raw) ? raw : null)
      ?? raw;

    if (!seen.has(resolved)) {
      seen.add(resolved);
      normalized.push(resolved);
    }
  }

  return {
    ...config,
    tools: {
      ...tools,
      gateway: normalized,
    },
  };
}

// ── Generate prompt (proxy to xyne-claw) ─────────────────────────────

router.post("/generate-prompt", async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/generate-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(35_000),
    });

    const data = await clawRes.json();
    res.status(clawRes.status).json(data);
  } catch (err) {
    log.error("[agents] generate-prompt proxy error:", err);
    res.status(500).json({ success: false, error: "Failed to generate prompt" });
  }
});

// ── Generate output format (proxy to xyne-claw) ──────────────────────
// User describes the desired final-answer shape in plain text; xyne-claw
// generates the structured-output JSON Schema + markdown template pair.

router.post("/generate-output-format", async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/generate-output-format`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(60_000),
    });

    const data = await clawRes.json();
    res.status(clawRes.status).json(data);
  } catch (err) {
    log.error("[agents] generate-output-format proxy error:", err);
    res.status(500).json({ success: false, error: "Failed to generate output format" });
  }
});

// ── Suggest tools (proxy to xyne-claw, with catalog from this DB) ────
//
// Frontend sends { systemPrompt | description }. We attach a compressed
// catalog so xyne-claw doesn't need DB access, then forward to its
// /suggest-tools route which does the LLM call. The response is a
// proposal; the UI renders it as a diff for the user to accept.

router.post("/suggest-tools", async (req: Request, res: Response) => {
  try {
    const { systemPrompt, description } = req.body as {
      systemPrompt?: string;
      description?: string;
    };
    const intent = (systemPrompt && systemPrompt.trim()) || (description && description.trim());
    if (!intent) {
      res.status(400).json({ success: false, error: "systemPrompt or description is required" });
      return;
    }

    const requesterId = getRequesterId(req);
    const orgId = getOrgId(req)
      ?? (requesterId
        ? (await prisma.user.findUnique({ where: { id: requesterId }, select: { orgId: true } }))?.orgId
        : undefined);
    if (!orgId) {
      log.error(`[agents/suggest-tools] orgId is required; refusing global tools catalog userId=${requesterId ?? "none"}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }

    const full = await buildAvailableToolsCatalog(undefined, orgId);
    // Compress: drop fields the LLM doesn't need (mcpServers, customGroups,
    // serverTools, writeTools — all derivable from `integrations`).
    const catalog = {
      subagents: full.subagents.map((s) => ({ name: s.name, description: s.description })),
      integrations: full.integrations.map((i) => ({
        slug: i.slug,
        label: i.label,
        readTools: i.readTools.map((t) => ({
          name: t.name, description: t.description, riskLevel: t.riskLevel,
        })),
        writeTools: i.writeTools.map((t) => ({
          name: t.name, description: t.description, riskLevel: t.riskLevel,
        })),
      })),
    };

    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/suggest-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({ intent, catalog }),
      signal: AbortSignal.timeout(50_000),
    });

    const data = await clawRes.json();
    res.status(clawRes.status).json(data);
  } catch (err) {
    log.error("[agents] suggest-tools proxy error:", err);
    res.status(500).json({ success: false, error: "Failed to suggest tools" });
  }
});

// ── Name availability check ──────────────────────────────────────────

router.get("/check-name", asyncHandler(async (req: Request, res: Response, next) => {
  const name = (req.query["name"] as string ?? "").trim();
  const slug = (req.query["slug"] as string ?? "").trim();

  const orgId = getOrgId(req);
  const slugTaken = slug ? Boolean(await agentRepository.findBySlug(slug, orgId)) : false;

  let nameTaken = false;
  if (name) {
    const agentByName = await agentRepository.findByNameInsensitive(name, ORG_SCOPED_SLUGS ? orgId : undefined);
    nameTaken = Boolean(agentByName);
  }

  ok(res, { slugAvailable: !slugTaken, nameAvailable: !nameTaken });
}));

// ── Agent CRUD ───────────────────────────────────────────────────────

/** Union one name-sorted listVisible result per identity alias into a single
 *  name-sorted list, dropping the global agents every alias call returns. */
function mergeVisibleAgentLists(
  lists: Array<Awaited<ReturnType<typeof agentRepository.listVisible>>>,
): Awaited<ReturnType<typeof agentRepository.listVisible>> {
  const seen = new Set<string>();
  const merged = [];
  for (const list of lists) {
    for (const agent of list) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      merged.push(agent);
    }
  }
  merged.sort((a, b) => a.name.localeCompare(b.name));
  return merged;
}

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  // The caller-passed userId is honoured as a "scope" hint (lets a frontend
  // ask "what would user X see"), but the ADMIN bypass is determined from
  // the AUTHENTICATED user — requireAuth has already verified their cookie
  // and pinned the verified userId at req.headers["x-user-id"]. We never
  // trust the query string for that decision.
  const scopeUserId = (req.query["userId"] as string | undefined)?.trim() || undefined;
  const authedUserId = String(req.headers["x-user-id"] ?? "");
  const admin = authedUserId ? await isClawAdmin(authedUserId) : false;

  // Dashboard auth exposes the workspace-scoped Spaces user ID, while
  // Agent.ownerUserId stores the canonical Claw User ID. Resolve an explicit
  // scope through UserSurfaceIdentity before applying the visibility filter.
  // Non-admin callers may only request their own two equivalent identities.
  if (scopeUserId && !admin && !matchesAuthenticatedUserId(req, scopeUserId)) {
    throw forbidden("userId does not match authenticated session");
  }
  const scopedUser = scopeUserId ? await findUserByAnyId(scopeUserId) : null;
  if (scopeUserId && !scopedUser) {
    throw notFound("User not found");
  }
  const canonicalScopeUserId = (scopedUser?.id ?? authedUserId) || undefined;

  // Agent.ownerUserId / AgentShare.userId may be keyed by EITHER verified
  // representation of the scoped caller — the canonical Claw id OR the raw
  // workspace-scoped Spaces id (rows written before canonicalization, or by
  // clients posting their raw dashboard id as ownerUserId). listVisible
  // filters one id per call, so an OWN-scope read unions each alias's
  // results; an admin's explicit foreign scope resolves to the target's
  // canonical id only.
  const visibilityUserIds = (() => {
    if (scopedUser && !matchesAuthenticatedUserId(req, scopedUser.id)) {
      return [scopedUser.id];
    }
    const ids = getRequesterAliases(req);
    if (canonicalScopeUserId && !ids.includes(canonicalScopeUserId)) {
      ids.push(canonicalScopeUserId);
    }
    return ids;
  })();

  // The admin "see ALL agents" bypass is OPT-IN via ?scope=all. The default
  // list (e.g. the main "My Agents" view) stays filtered to
  // global ∪ owned ∪ shared even for admins — otherwise admins get every
  // user's private agents in their normal list (regression after the
  // 2026-06-06 blanket bypass). Only callers that genuinely need the full
  // roster (e.g. the metrics-page agent dropdown) pass ?scope=all.
  const wantAllAgents = req.query["scope"] === "all";
  const adminScope = getAdminOrgScope(req, "/agents", admin && wantAllAgents);
  const listOrgId = adminScope.orgId ?? getOrgId(req);
  const agents = visibilityUserIds.length > 0
    ? mergeVisibleAgentLists(
        await Promise.all(
          visibilityUserIds.map((id) =>
            agentRepository.listVisible({
              userId: id,
              ...(listOrgId ? { orgId: listOrgId } : {}),
              isAdmin: admin && wantAllAgents,
            }),
          ),
        ),
      )
    : await agentRepository.listVisible({
        ...(listOrgId ? { orgId: listOrgId } : {}),
        isAdmin: admin && wantAllAgents,
      });
  const orgNames = adminScope.allOrgs ? await getOrgNameMap(agents.map((a) => a.orgId)) : new Map();

  const view = req.query["view"] === "full" ? "full" : "light";
  const sanitized = agents.map((a: typeof agents[number]) => {
    if (view === "light") {
      return lightAgentProjection(a as unknown as Record<string, unknown>, adminScope.allOrgs ? orgNames : undefined);
    }
    const row = sanitizeAgent(a as unknown as Record<string, unknown>);
    return adminScope.allOrgs ? { ...row, ...withOrgLabel({ orgId: a.orgId }, orgNames) } : row;
  });

  ok(res, sanitized);
}));

router.get("/user-config", asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.query["userId"] as string | undefined)?.trim();
  if (!userId) throw badRequest("userId is required");
  const requesterId = requireRequester(req, "authenticated user required");
  if (!matchesAuthenticatedUserId(req, userId)) throw forbidden("userId does not match authenticated session");
  const orgId = getOrgId(req);
  if (!orgId) throw badRequest("Organization context is required");
  const configs = await userAgentConfigRepository.listByUser(userId, orgId);
  ok(res, {
    configs: configs.map((config) => ({
      agentSlug: config.agentSlug,
      provider: config.provider ?? "spaces",
      chainConfig: config.chainConfig ?? null,
      updatedAt: config.updatedAt,
    })),
  });
}));

router.get("/:slug", asyncHandler(async (req: Request<{ slug: string }>, res: Response, next) => {
  // Phase-2: org-scope this un-ACL'd read so agent metadata can't be read
  // across orgs by slug. For S2S callers with no derivable org (Spaces'
  // claw-client fetches agent metadata without a pinned user), fall back to
  // single-match-or-fail — safe while a slug matches exactly one agent,
  // loud 404 on cross-org ambiguity (same rule as the legacy webhook route).
  const orgId = getOrgId(req);
  const agent = orgId
    ? await agentRepository.findBySlugWithRelations(req.params.slug, orgId)
    : await agentRepository.findBySlugSingleMatchWithRelations(req.params.slug);

  if (!agent) {
    logAgentScopedMiss(req, "agents/get", req.params.slug, orgId);
    throw notFound("Agent not found");
  }

  const record = agent as unknown as Record<string, unknown>;
  const viewerId = getRequesterId(req);
  let canEdit = s2sKeyMatches(req.headers["x-s2s-key"]);
  if (!canEdit && viewerId) {
    const access = await getAgentEditAccess(viewerId, req.params.slug, getOrgId(req)).catch(() => null);
    canEdit = Boolean(access?.canEdit) || (await isClawAdmin(viewerId));
  }
  // Any org viewer may READ the full agent: sanitizeAgent scrubs the only
  // inline secrets (signingSecret/spacesAppToken), and provider/MCP creds live
  // behind their own ACL'd endpoints. Read-only is enforced by the write
  // routes, NOT by hiding fields — so return the full shape (non-admins get a
  // complete read-only view) plus a canEdit flag for the UI to gate editing.
  ok(res, { ...sanitizeAgent(record), canEdit });
}));

router.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { slug, name, description, systemPrompt, scope, ownerUserId, color, modelId, config, skills, knowledgeBase, kbScope } = req.body as {
    slug?: string;
    name?: string;
    description?: string;
    systemPrompt?: string;
    scope?: string;
    ownerUserId?: string;
    color?: string;
    modelId?: string;
    config?: Record<string, unknown>;
    skills?: { name: string; content: string }[];
    knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>;
    kbScope?: string;
  };

  const normalizedConfig = await normalizeGatewayServicesInConfig(config);

  if (!slug || typeof slug !== "string" || slug.trim().length === 0) {
    throw badRequest("slug is required");
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw badRequest("name is required");
  }

  if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
    throw badRequest("systemPrompt is required");
  }

  const configCheck = validateAgentModelConfig(config);
  if (!configCheck.ok) {
    throw badRequest(configCheck.error);
  }

  // Determine scope: only admins can create global agents
  const requesterId = getRequesterId(req);
  const admin = requesterId ? await isClawAdmin(requesterId) : false;
  const effectiveScope = scope === "global" && admin ? "global" : "personal";

  // The auth boundary retains both representations of the caller, so accept
  // either the canonical Claw id or the verified Spaces id from the session.
  if (ownerUserId && !matchesAuthenticatedUserId(req, ownerUserId) && !admin) {
    throw forbidden("Only an admin can create an agent owned by another user");
  }
  // For personal agents, owner is required
  const effectiveOwner = ownerUserId ?? requesterId;
  if (effectiveScope === "personal" && !effectiveOwner) {
    throw badRequest("ownerUserId or x-user-id header required for personal agents");
  }

  // Normalize the KB scoping mode. Anything other than "USER" → "COLLECTIONS"
  // (the safe default), so a typo doesn't accidentally open the agent up to
  // the user's full KB.
  const effectiveKbScope: "COLLECTIONS" | "USER" = kbScope === "USER" ? "USER" : "COLLECTIONS";

  const createOrgId = getOrgId(req);
  if (!createOrgId) {
    log.warn(`[agents/create] orgId is required requesterId=${requesterId ?? "none"} ownerUserId=${ownerUserId ?? "none"} slug=${slug.trim()} scope=${scope ?? "none"}`);
    throw badRequest("orgId is required");
  }

  const data: Prisma.AgentCreateInput = {
    slug: slug.trim(),
    name: name.trim(),
    description: description?.trim() ?? "",
    systemPrompt: systemPrompt.trim(),
    scope: effectiveScope,
    color: color ?? "#6366f1",
    modelId: modelId ?? "",
    config: (normalizedConfig ?? {}) as Prisma.InputJsonValue,
    kbScope: effectiveKbScope,
    org: { connect: { id: createOrgId } },
  };
  if (effectiveOwner) {
    data.owner = { connect: { id: effectiveOwner } };
  }
  const agent = await agentRepository.create(data);

  // Attach skills by ID if provided
  if (skills && Array.isArray(skills) && skills.length > 0) {
    for (const skillId of skills) {
      if (typeof skillId === "string") {
        await agentRepository.upsertSkill(agent.id, skillId);
      }
    }
  }

  // Attach KB grants — only meaningful in COLLECTIONS scope. USER scope
  // means the agent inherits the caller's full KB at runtime, so we
  // intentionally ignore any knowledgeBase[] payload (a USER-scoped agent
  // never has stored grants — see PUT for the clear-on-mode-flip path).
  let rejectedKb: Array<{ collectionId: string; fileId: string | null; reason: string }> = [];
  if (
    effectiveKbScope === "COLLECTIONS" &&
    knowledgeBase &&
    Array.isArray(knowledgeBase) &&
    knowledgeBase.length > 0 &&
    requesterId
  ) {
    const { accepted, rejected } = await validateKbGrants(requesterId, knowledgeBase);
    rejectedKb = rejected;
    if (accepted.length > 0) {
      await agentRepository.replaceCollections(agent.id, accepted);
    }
  }

  res.status(201);
  ok(res, agent, rejectedKb.length > 0 ? { rejectedKnowledgeBase: rejectedKb } : {});
}));

router.patch("/:slug/design-system", asyncHandler(async (req: Request<{ slug: string }>, res: Response, next) => {
  const orgId = getOrgId(req);
  const requesterId = getRequesterId(req);
  if (!orgId) throw badRequest("Organization context is required");
  if (!requesterId) throw unauthorized("Authenticated user is required");

  const existing = await agentRepository.findBySlug(req.params.slug, orgId);
  if (!existing) {
    logAgentScopedMiss(req, "agents/design-system", req.params.slug, orgId);
    throw notFound("Agent not found");
  }

  const admin = await isClawAdmin(requesterId);
  const isOwner = existing.ownerUserId === requesterId;
  const share = await agentShareRepository.findByAgentAndUser(existing.id, requesterId);
  const isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";
  if (!admin && !isOwner && !isContributor) {
    throw forbidden("Only the agent owner, contributors, or admins can edit its design system");
  }

  const supplied = (req.body as { designSystem?: unknown }).designSystem;
  if (supplied !== null && typeof supplied !== "string") {
    throw badRequest("designSystem must be a string or null");
  }
  const designSystem = typeof supplied === "string" ? supplied.trim() : "";
  if (designSystem.length > 32_000) {
    throw badRequest("designSystem must be at most 32,000 characters");
  }

  // Optimistic retry prevents this narrow edit from replacing a concurrent
  // provider/tools/sandbox config write with a stale snapshot.
  let updated = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = await agentRepository.findById(existing.id);
    if (!fresh) {
      throw notFound("Agent not found");
    }
    const nextConfig = { ...(asRecord(fresh.config) ?? {}) };
    if (designSystem) nextConfig["designSystem"] = designSystem;
    else delete nextConfig["designSystem"];

    const configCheck = validateAgentModelConfig(nextConfig);
    if (!configCheck.ok) {
      throw badRequest(configCheck.error);
    }
    const result = await prisma.agent.updateMany({
      where: { id: fresh.id, updatedAt: fresh.updatedAt },
      data: { config: nextConfig as Prisma.InputJsonValue },
    });
    if (result.count === 1) {
      logAgentConfigWriteDiff(fresh.slug, requesterId, fresh.config, nextConfig);
      updated = await agentRepository.findById(fresh.id);
      break;
    }
  }

  if (!updated) {
    throw conflict("Agent settings changed while saving; please retry");
  }
  await writeAuditLog({
    actorUserId: requesterId,
    eventType: "AGENT_UPDATED",
    targetId: existing.id,
    description: `Agent "${existing.name}" (${existing.slug}) design system updated`,
    metadata: { changed: ["designSystem"], orgId: existing.orgId },
  });
  ok(res, sanitizeAgent(updated as unknown as Record<string, unknown>));
}));

router.put("/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) {
      res.status(400).json({ success: false, error: "Organization context is required" });
      return;
    }

    const existing = await agentRepository.findBySlug(req.params.slug, orgId);
    if (!existing) {
      logAgentScopedMiss(req, "agents/update", req.params.slug, orgId);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    // ACL: check edit permissions based on scope
    const requesterId = getRequesterId(req);
    if (requesterId) {
      const admin = await isClawAdmin(requesterId);
      const isOwner = existing.ownerUserId === requesterId;
      const share = await agentShareRepository.findByAgentAndUser(existing.id, requesterId);
      const isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";

      if (existing.scope === "global" && !admin && !isOwner && !isContributor) {
        res.status(403).json({ success: false, error: "Only admins, the original owner, or contributors can edit global agents" });
        return;
      }

      if (existing.scope === "personal" && existing.ownerUserId) {
        if (!admin && !isOwner && !isContributor) {
          res.status(403).json({ success: false, error: "Only the owner, contributors, or admins can update this agent" });
          return;
        }
      }
    }

    const { slug: nextSlug, name, description, systemPrompt, promptNote, enabled, color, modelId, config, skills, knowledgeBase, kbScope, delegationTier } = req.body as {
      slug?: string;
      name?: string;
      description?: string;
      systemPrompt?: string;
      promptNote?: string; // optional changelog note for the new prompt version
      enabled?: boolean;
      color?: string;
      modelId?: string;
      config?: Record<string, unknown>;
      skills?: string[]; // skill IDs to attach
      knowledgeBase?: Array<{ collectionId: string; fileId?: string | null }>;
      kbScope?: string;
      delegationTier?: string;
    };

    // Full-replace: the config the frontend sends is already the complete
    // desired state — every caller spreads the existing config, then adds or
    // `delete`s keys — so we persist it verbatim. Do NOT merge against
    // existing.config: a merge makes key deletion (how the UI turns a setting
    // OFF) a silent no-op, so disabled toggles snap back on. Any future
    // partial-PUT caller must spread the full existing config first.
    const normalizedConfig = await normalizeGatewayServicesInConfig(config);

    // Canonicalize the invocation-privacy block so a malformed/junk value can
    // never be stored (which could silently lock or unlock the agent). A junk
    // `privacy` is dropped → default "everyone"; a valid one is deduped/cleaned.
    // See isAgentInvocableBy — enforced at every dispatch chokepoint.
    if (normalizedConfig && "privacy" in normalizedConfig) {
      const normalizedPrivacy = normalizeAgentPrivacy(normalizedConfig["privacy"]);
      if (normalizedPrivacy) normalizedConfig["privacy"] = normalizedPrivacy;
      else delete normalizedConfig["privacy"];
    }

    const data: Prisma.AgentUpdateInput = {};

    // Slug rename — owner/admin-only on the route ACL above. Validate
    // format, length, and uniqueness; reject collisions with a typed 409
    // so the frontend can render a useful error.
    if (nextSlug !== undefined) {
      const trimmedSlug = nextSlug.trim().toLowerCase();
      if (trimmedSlug !== existing.slug) {
        if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(trimmedSlug)) {
          res.status(400).json({
            success: false,
            error: "Invalid handle. Use 2-64 lowercase letters, digits, or hyphens. No leading or trailing hyphen.",
            code: "INVALID_SLUG",
          });
          return;
        }
        const collision = await agentRepository.findBySlug(trimmedSlug, orgId);
        if (collision && collision.id !== existing.id) {
          res.status(409).json({
            success: false,
            error: `Handle "${trimmedSlug}" is already taken.`,
            code: "SLUG_TAKEN",
          });
          return;
        }
        data.slug = trimmedSlug;
      }
    }

    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description.trim();
    // NOTE: systemPrompt is deliberately NOT put in `data`. A prompt change is
    // routed through prompt versioning below, which creates a new immutable
    // version AND denormalizes systemPrompt + active pointers back onto the
    // agent. Putting it in `data` too would double-write (harmless but
    // redundant) and bypass version history.
    if (enabled !== undefined) data.enabled = enabled;
    if (color !== undefined) data.color = color;
    if (modelId !== undefined) data.modelId = modelId;
    if (delegationTier !== undefined) {
      if (delegationTier !== "standard" && delegationTier !== "orchestrator") {
        res.status(400).json({ success: false, error: "delegationTier must be 'standard' or 'orchestrator'" });
        return;
      }
      const requesterIsAdmin = requesterId ? await isClawAdmin(requesterId) : false;
      if (!requesterIsAdmin) {
        res.status(403).json({ success: false, error: "Only claw admins can change delegationTier" });
        return;
      }
      data.delegationTier = delegationTier;
    }
    if (normalizedConfig !== undefined) {
      const configCheck = validateAgentModelConfig(normalizedConfig as Record<string, unknown>);
      if (!configCheck.ok) {
        res.status(400).json({ success: false, error: configCheck.error });
        return;
      }
      const awakeningCheck = validateAwakeningConfig(normalizedConfig as Record<string, unknown>);
      if (!awakeningCheck.ok) {
        res.status(400).json({ success: false, error: awakeningCheck.error });
        return;
      }
      logAgentConfigWriteDiff(existing.slug, requesterId ?? undefined, existing.config, normalizedConfig);
      data.config = normalizedConfig as Prisma.InputJsonValue;
    }

    // If skills provided, replace all attached skills with new set
    if (skills !== undefined && Array.isArray(skills)) {
      await agentRepository.deleteAllSkills(existing.id);
      for (const skillId of skills) {
        if (typeof skillId === "string") {
          await agentRepository.upsertSkill(existing.id, skillId);
        }
      }
    }

    // KB scope mode flip. Anything other than the two known literals is
    // treated as "leave it alone" (omitted) — guards against typos opening
    // an agent up to the user's full KB by accident.
    const nextKbScope: "COLLECTIONS" | "USER" | null =
      kbScope === "USER" ? "USER" : kbScope === "COLLECTIONS" ? "COLLECTIONS" : null;
    if (nextKbScope !== null) {
      data.kbScope = nextKbScope;
    }
    const effectiveKbScope: "COLLECTIONS" | "USER" =
      nextKbScope ?? (existing.kbScope === "USER" ? "USER" : "COLLECTIONS");

    // KB grant write semantics:
    //   • USER scope  — stored grants are IGNORED at runtime (resolveKbContext
    //     drops them) but RETAINED in the DB so flipping back to COLLECTIONS
    //     restores the picker's previous selection. Any `knowledgeBase[]`
    //     payload arriving in USER mode is ignored — the UI hides the picker
    //     so this only happens if something talks to the API directly.
    //   • COLLECTIONS — replace ALL grants with the validated set when the
    //     UI sends `knowledgeBase[]` (mirrors skills' replace semantics).
    let rejectedKb: Array<{ collectionId: string; fileId: string | null; reason: string }> = [];
    if (effectiveKbScope === "COLLECTIONS" && knowledgeBase !== undefined && Array.isArray(knowledgeBase) && requesterId) {
      const { accepted, rejected } = await validateKbGrants(requesterId, knowledgeBase);
      rejectedKb = rejected;
      await agentRepository.replaceCollections(existing.id, accepted);
    }

    // Prompt versioning: only when the prompt actually changed. Creates a new
    // immutable version and makes it active (sets agent.systemPrompt +
    // active pointers). Done before the generic update so the row the update
    // returns reflects the new prompt.
    if (systemPrompt !== undefined && systemPrompt.trim() !== existing.systemPrompt) {
      await agentRepository.createAndActivatePromptVersion({
        agentId: existing.id,
        systemPrompt: systemPrompt.trim(),
        note: typeof promptNote === "string" ? (promptNote.trim() || null) : null,
        createdByUserId: requesterId ?? null,
      });
    }

    const agent = await agentRepository.update(req.params.slug, existing.orgId, data);

    // Create/park the scheduler state row so the awakening tick starts or
    // stops seeing this agent. Best-effort: a failure here must not fail the
    // config write — the next write, or a manual re-enable, reconciles it.
    if (normalizedConfig !== undefined) {
      await syncAwakeningState(existing.id, existing.orgId, normalizedConfig).catch((e) =>
        log.warn(`[agents] syncAwakeningState failed for ${existing.slug}:`, e instanceof Error ? e.message : e),
      );
    }

    // Model-settings audit — which model actually serves this agent's runs.
    // Written only when config.modelSettings really changed, so the
    // high-frequency config writes that don't touch it (tools, memory status,
    // scope flips) don't spam the audit table.
    if (normalizedConfig !== undefined) {
      await auditModelSettingsChange({
        agentId: existing.id,
        agentName: existing.name,
        agentSlug: existing.slug,
        orgId: existing.orgId,
        actorUserId: requesterId ?? undefined,
        beforeConfig: existing.config,
        afterConfig: normalizedConfig,
      });
    }

    // Audit general agent edits. `config` is deliberately excluded here to
    // avoid a duplicate/overlapping trail — model settings get their own
    // AGENT_CONFIG_UPDATED row above.
    const changedFields: string[] = [];
    if (data.slug && data.slug !== existing.slug) changedFields.push("slug");
    if (name !== undefined && name.trim() !== existing.name) changedFields.push("name");
    if (description !== undefined && description.trim() !== existing.description) changedFields.push("description");
    if (color !== undefined && color !== existing.color) changedFields.push("color");
    if (modelId !== undefined && modelId !== existing.modelId) changedFields.push("model");
    if (enabled !== undefined && enabled !== existing.enabled) changedFields.push("enabled");
    if (delegationTier !== undefined && delegationTier !== existing.delegationTier) changedFields.push("delegationTier");
    if (systemPrompt !== undefined && systemPrompt.trim() !== existing.systemPrompt) changedFields.push("prompt");
    const beforePrivacy = parseAgentPrivacy(existing.config as Record<string, unknown> | null);
    const afterPrivacy = parseAgentPrivacy(normalizedConfig ?? null);
    const privacyChanged =
      normalizedConfig !== undefined &&
      (beforePrivacy.mode !== afterPrivacy.mode ||
        [...beforePrivacy.whitelist].sort().join(",") !== [...afterPrivacy.whitelist].sort().join(","));
    if (privacyChanged) changedFields.push("privacy");
    if (changedFields.length > 0) {
      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_UPDATED",
        targetId: existing.id,
        description: `Agent "${existing.name}" (${existing.slug}) updated: ${changedFields.join(", ")}`,
        metadata: {
          changed: changedFields,
          orgId: existing.orgId,
          ...(privacyChanged ? { privacyBefore: beforePrivacy, privacyAfter: afterPrivacy } : {}),
        },
      });
    }

    res.json({
      success: true,
      data: sanitizeAgent(agent as unknown as Record<string, unknown>),
      ...(rejectedKb.length > 0 ? { rejectedKnowledgeBase: rejectedKb } : {}),
    });
  } catch (err) {
    log.error("[agents] update error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Prompt versions ──────────────────────────────────────────────────
// List an agent's prompt version history (newest first) + which is active.
router.get("/:slug/prompt-versions", requireAgentOwnerOrAdmin, asyncHandler(async (req: Request<{ slug: string }>, res: Response, next) => {
  const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
  if (!agent) {
    logAgentScopedMiss(req, "agents/prompt-versions", req.params.slug);
    throw notFound("Agent not found");
  }
  const versions = await agentRepository.listPromptVersions(agent.id);
  ok(res, { activeVersion: agent.activePromptVersion, versions });
}));

// Roll back to / re-activate a specific prompt version. Reuses the historical
// row (no new version created); the active pointer can move backwards.
router.post(
  "/:slug/prompt-versions/:version/activate",
  requireAgentOwnerOrAdmin,
  asyncHandler(async (req: Request<{ slug: string; version: string }>, res: Response, next) => {
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) {
      throw badRequest("Invalid version number");
    }
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/activate-prompt-version", req.params.slug);
      throw notFound("Agent not found");
    }
    const activated = await agentRepository.activatePromptVersion(agent.id, version);
    if (!activated) {
      throw notFound(`Version ${version} not found for this agent`);
    }
    const updated = await agentRepository.findBySlugWithRelations(req.params.slug, getOrgId(req));
    ok(res, sanitizeAgent(updated as unknown as Record<string, unknown>));
  }),
);

// ── A2A delegation grants ────────────────────────────────────────────
// Agent-owner/admin API for the fail-closed caller -> callee allow-list used by
// callable-agent delegation at runtime. Callee resolution is org-scoped just
// like agent config routes; no cross-org grants.
async function postDelegationDmWithCalleeIdentity(args: {
  callee: {
    slug: string;
    name: string;
    spacesAppId: string | null;
    spacesAppToken: string | null;
    spacesAppUserId: string | null;
  };
  targetUserId: string | null;
  text: string;
  logContext: string;
}): Promise<void> {
  const { callee, targetUserId, text, logContext } = args;
  if (!targetUserId) return;
  if (!callee.spacesAppId || !callee.spacesAppToken || !callee.spacesAppUserId) {
    log.info(`[agents/delegation] DM skipped ${logContext}: callee agent ${callee.slug} not Spaces-registered`);
    return;
  }
  const token = decryptStoredToken(callee.spacesAppToken);
  if (!token) {
    log.warn(`[agents/delegation] DM skipped ${logContext}: invalid app token for callee agent ${callee.slug}`);
    return;
  }
  const workspaceId = await getWorkspaceIdForUser(targetUserId, "clone-owner-dm");
  if (!workspaceId) {
    log.warn(`[agents/delegation] DM skipped ${logContext}: no workspaceId for user ${targetUserId}`);
    return;
  }

  const dm = (await spacesAppFetch("/channel/openDm", {
    targetUserId,
    workspaceId,
  }, token)) as { channelId: string };

  await spacesAppFetch("/chat/postMessage", {
    channelId: dm.channelId,
    markdownText: text,
    userId: callee.spacesAppUserId,
    workspaceId,
    metadata: { contentFormat: "markdown" },
  }, token);
}

async function notifyOwnerOfDelegationRequestInSpaces(args: {
  caller: { slug: string; name: string; ownerUserId: string | null };
  requestReason?: string | null;
  callee: {
    slug: string;
    name: string;
    ownerUserId: string | null;
    spacesAppId: string | null;
    spacesAppToken: string | null;
    spacesAppUserId: string | null;
  };
}): Promise<void> {
  const { caller, callee, requestReason } = args;
  const reasonLine = requestReason?.trim() ? `\n\nReason: ${requestReason.trim()}` : "";
  const owner = caller.ownerUserId ? await userRepository.findById(caller.ownerUserId).catch(() => null) : null;
  const ownerName = owner?.name ?? owner?.email ?? caller.ownerUserId ?? "unknown owner";
  const dashboardLink = `${CONFIG.spacesAppUrl.replace(/\/+$/, "")}/claw/v3/agents/${encodeURIComponent(callee.slug)}`;
  await postDelegationDmWithCalleeIdentity({
    callee,
    targetUserId: callee.ownerUserId,
    text: `🤝 Delegation request: agent ${caller.name} (${ownerName}) wants to delegate tasks to your agent ${callee.name}.${reasonLine}\n\nApprove or reject: ${dashboardLink}`,
    logContext: `request caller=${caller.slug} callee=${callee.slug}`,
  });
}

async function notifyDelegationRequesterOfDecisionInSpaces(args: {
  grant: { createdByUserId: string | null; status: string };
  caller: { slug: string; name: string };
  callee: {
    slug: string;
    name: string;
    spacesAppId: string | null;
    spacesAppToken: string | null;
    spacesAppUserId: string | null;
  };
  deciderUserId: string;
}): Promise<void> {
  const { grant, caller, callee, deciderUserId } = args;
  if (grant.status !== "approved" && grant.status !== "rejected") return;
  const decider = await userRepository.findById(deciderUserId).catch(() => null);
  const deciderName = decider?.name ?? decider?.email ?? deciderUserId;
  const emoji = grant.status === "approved" ? "✅" : "❌";
  await postDelegationDmWithCalleeIdentity({
    callee,
    targetUserId: grant.createdByUserId,
    text: `${emoji} your delegation request for ${caller.name} → ${callee.name} was ${grant.status} by ${deciderName}`,
    logContext: `decision caller=${caller.slug} callee=${callee.slug}`,
  });
}

router.get("/delegation-requests/pending-for-me", asyncHandler(async (req: Request, res: Response) => {
  const requesterId = requireRequester(req, "x-user-id required");
  const orgId = getOrgId(req);
  const requests = await prisma.agentDelegationGrant.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
  });
  if (requests.length === 0) {
    ok(res, []);
    return;
  }

  const [callers, callees] = await Promise.all([
    prisma.agent.findMany({
      where: {
        id: { in: [...new Set(requests.map((r) => r.callerAgentId))] },
        ...(orgId ? { orgId } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        enabled: true,
        ownerUserId: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.agent.findMany({
      where: {
        id: { in: [...new Set(requests.map((r) => r.calleeAgentId))] },
        ...(orgId ? { orgId } : {}),
        ownerUserId: requesterId,
      },
      select: { id: true, slug: true, name: true, description: true, enabled: true, ownerUserId: true },
    }),
  ]);
  const callerById = new Map(callers.map((a) => [a.id, a]));
  const calleeById = new Map(callees.map((a) => [a.id, a]));
  const data = requests
    .filter((grant) => calleeById.has(grant.calleeAgentId))
    .map((grant) => ({
      id: grant.id,
      callerAgentId: grant.callerAgentId,
      calleeAgentId: grant.calleeAgentId,
      identityMode: grant.identityMode,
      enabled: grant.enabled,
      status: grant.status,
      approvedByUserId: grant.approvedByUserId,
      approvedAt: grant.approvedAt,
      createdByUserId: grant.createdByUserId,
      requestReason: grant.requestReason,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      caller: callerById.get(grant.callerAgentId) ?? null,
      callee: calleeById.get(grant.calleeAgentId) ?? null,
    }));
  ok(res, data);
}));

router.get(
  "/:slug/delegation-grants",
  requireAgentOwnerOrAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const caller = req.agentContext!.agent;
    const grants = await prisma.agentDelegationGrant.findMany({
      where: { callerAgentId: caller.id },
      orderBy: { createdAt: "desc" },
    });
    const callees = grants.length > 0
      ? await prisma.agent.findMany({
          where: {
            id: { in: grants.map((g) => g.calleeAgentId) },
            orgId: caller.orgId,
          },
          select: { id: true, slug: true, name: true, description: true, enabled: true },
        })
      : [];
    const byId = new Map(callees.map((a) => [a.id, a]));
    ok(res, grants.map((g) => ({
      id: g.id,
      callerAgentId: g.callerAgentId,
      calleeAgentId: g.calleeAgentId,
      identityMode: g.identityMode,
      enabled: g.enabled,
      status: g.status,
      approvedByUserId: g.approvedByUserId,
      approvedAt: g.approvedAt,
      createdByUserId: g.createdByUserId,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      requestReason: g.requestReason,
      callee: byId.get(g.calleeAgentId) ?? null,
    })));
  }),
);

router.post(
  "/:slug/delegation-grants",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const caller = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const { calleeSlug, identityMode, requestReason } = (req.body ?? {}) as {
        calleeSlug?: string;
        identityMode?: string;
        requestReason?: string;
      };
      const calleeHandle = typeof calleeSlug === "string" ? calleeSlug.trim() : "";
      const reason = typeof requestReason === "string" ? requestReason.trim() : "";
      if (!calleeHandle) {
        res.status(400).json({ success: false, error: "calleeSlug is required" });
        return;
      }
      if (identityMode === "callee_app") {
        res.status(400).json({ success: false, error: "not supported yet" });
        return;
      }
      const mode = identityMode === undefined || identityMode === "user" ? "user" : null;
      if (!mode) {
        res.status(400).json({ success: false, error: "identityMode must be 'user' or 'callee_app'" });
        return;
      }
      const callee = await prisma.agent.findUnique({
        where: { orgId_slug: { orgId: caller.orgId, slug: calleeHandle } },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          enabled: true,
          ownerUserId: true,
          // Owner display name — the caller-side UI names who must approve.
          owner: { select: { name: true, email: true } },
          spacesAppId: true,
          spacesAppToken: true,
          spacesAppUserId: true,
        },
      });
      if (!callee) {
        res.status(404).json({ success: false, error: "Callee agent not found" });
        return;
      }
      if (callee.id === caller.id) {
        res.status(400).json({ success: false, error: "An agent cannot delegate to itself" });
        return;
      }
      // Auto-approve ONLY when the requester owns both sides — their click IS
      // the callee owner's approval. Deliberately NO admin bypass (owner
      // decision 2026-07-14): delegation exercises the callee's provider
      // credentials/quota, so the callee owner is always consulted, even for
      // grants created by claw admins.
      const autoApprove = !!caller.ownerUserId && caller.ownerUserId === callee.ownerUserId;
      if (!autoApprove && reason.length < 3) {
        res.status(400).json({ success: false, error: "requestReason is required when delegating to an agent owned by someone else" });
        return;
      }
      if (reason.length > 1000) {
        res.status(400).json({ success: false, error: "requestReason must be 1000 characters or less" });
        return;
      }
      const existingGrant = await prisma.agentDelegationGrant.findUnique({
        where: {
          callerAgentId_calleeAgentId: {
            callerAgentId: caller.id,
            calleeAgentId: callee.id,
          },
        },
      });
      const status = autoApprove ? "approved" : existingGrant?.status === "approved" ? "approved" : "pending";
      const approvedByUserId = autoApprove
        ? requesterId ?? null
        : status === "approved"
          ? existingGrant?.approvedByUserId ?? null
          : null;
      const approvedAt = autoApprove
        ? new Date()
        : status === "approved"
          ? existingGrant?.approvedAt ?? null
          : null;
      const grant = await prisma.agentDelegationGrant.upsert({
        where: {
          callerAgentId_calleeAgentId: {
            callerAgentId: caller.id,
            calleeAgentId: callee.id,
          },
        },
        create: {
          callerAgentId: caller.id,
          calleeAgentId: callee.id,
          identityMode: mode,
          enabled: true,
          status,
          approvedByUserId,
          approvedAt,
          createdByUserId: requesterId ?? null,
          requestReason: reason || null,
        },
        update: {
          identityMode: mode,
          enabled: true,
          status,
          approvedByUserId,
          approvedAt,
          requestReason: reason || existingGrant?.requestReason || null,
        },
      });
      if (grant.status === "pending" && existingGrant?.status !== "pending") {
        void notifyOwnerOfDelegationRequestInSpaces({
          caller: { slug: caller.slug, name: caller.name, ownerUserId: caller.ownerUserId },
          requestReason: grant.requestReason,
          callee,
        }).catch((err) => {
          log.warn("[agents/delegation] request DM failed:", errMsg(err));
        });
      }
      res.status(201).json({
        success: true,
        data: {
          ...grant,
          requestReason: grant.requestReason,
          callee: {
            id: callee.id,
            slug: callee.slug,
            name: callee.name,
            description: callee.description,
            enabled: callee.enabled,
            ownerUserId: callee.ownerUserId,
            ownerName: callee.owner?.name ?? callee.owner?.email ?? null,
          },
        },
      });
    } catch (err) {
      log.error("[agents] create delegation grant error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/:slug/delegation-requests",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const callee = req.agentContext!.agent;
      const requests = await prisma.agentDelegationGrant.findMany({
        where: { calleeAgentId: callee.id, status: { in: ["pending", "approved"] } },
        orderBy: { createdAt: "desc" },
      });
      const callers = requests.length > 0
        ? await prisma.agent.findMany({
            where: {
              id: { in: requests.map((r) => r.callerAgentId) },
              orgId: callee.orgId,
            },
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              enabled: true,
              ownerUserId: true,
              owner: { select: { id: true, name: true, email: true } },
            },
          })
        : [];
      const callerById = new Map(callers.map((a) => [a.id, a]));
      res.json({
        success: true,
        data: requests.map((grant) => ({
          id: grant.id,
          callerAgentId: grant.callerAgentId,
          calleeAgentId: grant.calleeAgentId,
          identityMode: grant.identityMode,
          enabled: grant.enabled,
          status: grant.status,
          approvedByUserId: grant.approvedByUserId,
          approvedAt: grant.approvedAt,
          createdByUserId: grant.createdByUserId,
          createdAt: grant.createdAt,
          updatedAt: grant.updatedAt,
          requestReason: grant.requestReason,
          caller: callerById.get(grant.callerAgentId) ?? null,
        })),
      });
    } catch (err) {
      log.error("[agents] list delegation requests error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/:slug/delegation-requests/:grantId/decision",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; grantId: string }>, res: Response) => {
    try {
      const callee = req.agentContext!.agent;
      const requesterId = getRequesterId(req)!;
      const { approve } = (req.body ?? {}) as { approve?: unknown };
      if (typeof approve !== "boolean") {
        res.status(400).json({ success: false, error: "approve must be boolean" });
        return;
      }
      const decidedAt = new Date();
      const result = await prisma.agentDelegationGrant.updateMany({
        where: {
          id: req.params.grantId,
          calleeAgentId: callee.id,
          status: { in: ["pending", "approved"] },
        },
        data: {
          status: approve ? "approved" : "rejected",
          approvedByUserId: requesterId,
          approvedAt: decidedAt,
        },
      });
      if (result.count === 0) {
        res.status(404).json({ success: false, error: "Delegation request not found or already processed" });
        return;
      }
      const grant = await prisma.agentDelegationGrant.findUnique({ where: { id: req.params.grantId } });
      if (grant) {
        void (async () => {
          const [callerAgent, calleeAgent] = await Promise.all([
            prisma.agent.findUnique({
              where: { id: grant.callerAgentId },
              select: { id: true, slug: true, name: true },
            }),
            prisma.agent.findUnique({
              where: { id: grant.calleeAgentId },
              select: { id: true, slug: true, name: true, spacesAppId: true, spacesAppToken: true, spacesAppUserId: true },
            }),
          ]);
          if (!callerAgent || !calleeAgent) return;
          await notifyDelegationRequesterOfDecisionInSpaces({
            grant,
            caller: callerAgent,
            callee: calleeAgent,
            deciderUserId: requesterId,
          });
        })().catch((err) => {
          log.warn("[agents/delegation] decision DM failed:", errMsg(err));
        });
      }
      res.json({ success: true, data: grant });
    } catch (err) {
      log.error("[agents] decide delegation request error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/:slug/delegation-requests/:grantId/revoke",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; grantId: string }>, res: Response) => {
    try {
      const callee = req.agentContext!.agent;
      const requesterId = getRequesterId(req)!;
      const decidedAt = new Date();
      const result = await prisma.agentDelegationGrant.updateMany({
        where: {
          id: req.params.grantId,
          calleeAgentId: callee.id,
          status: { in: ["pending", "approved"] },
        },
        data: {
          status: "rejected",
          approvedByUserId: requesterId,
          approvedAt: decidedAt,
        },
      });
      if (result.count === 0) {
        res.status(404).json({ success: false, error: "Delegation request not found or already processed" });
        return;
      }
      const grant = await prisma.agentDelegationGrant.findUnique({ where: { id: req.params.grantId } });
      if (grant) {
        void (async () => {
          const [callerAgent, calleeAgent] = await Promise.all([
            prisma.agent.findUnique({
              where: { id: grant.callerAgentId },
              select: { id: true, slug: true, name: true },
            }),
            prisma.agent.findUnique({
              where: { id: grant.calleeAgentId },
              select: { id: true, slug: true, name: true, spacesAppId: true, spacesAppToken: true, spacesAppUserId: true },
            }),
          ]);
          if (!callerAgent || !calleeAgent) return;
          await notifyDelegationRequesterOfDecisionInSpaces({
            grant,
            caller: callerAgent,
            callee: calleeAgent,
            deciderUserId: requesterId,
          });
        })().catch((err) => {
          log.warn("[agents/delegation] revoke DM failed:", errMsg(err));
        });
      }
      res.json({ success: true, data: grant });
    } catch (err) {
      log.error("[agents] revoke delegation request error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.delete(
  "/:slug/delegation-grants/:grantId",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; grantId: string }>, res: Response) => {
    try {
      const caller = req.agentContext!.agent;
      const deleted = await prisma.agentDelegationGrant.deleteMany({
        where: {
          id: req.params.grantId,
          callerAgentId: caller.id,
        },
      });
      if (deleted.count === 0) {
        res.status(404).json({ success: false, error: "Delegation grant not found" });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      log.error("[agents] delete delegation grant error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.delete("/:slug", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/delete", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    await agentRepository.delete(req.params.slug, agent.orgId);

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_DELETED",
      targetId: agent.id,
      description: `Agent "${agent.name}" (${agent.slug}) deleted`,
    });

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      logAgentScopedMiss(req, "agents/delete", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    log.error("[agents] delete error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent Requests (Push to Spaces / Push to Global) ──────────────────────────

// POST /agents/:slug/request — user submits request
router.post("/:slug/request", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const { requestType } = req.body as { requestType?: string };
    if (!requestType || !["push_to_spaces", "push_to_global"].includes(requestType)) {
      res.status(400).json({ success: false, error: "requestType must be 'push_to_spaces' or 'push_to_global'" });
      return;
    }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/request", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (agent.ownerUserId !== requesterId) { res.status(403).json({ success: false, error: "Only the owner can request this" }); return; }

    // Check for existing pending request
    const existing = await agentRequestRepository.findPending(agent.id, requestType);
    if (existing) { res.status(409).json({ success: false, error: "A pending request already exists" }); return; }

    const request = await agentRequestRepository.create({ agentId: agent.id, agentSlug: agent.slug, requestType, requesterId, orgId: agent.orgId ?? getOrgId(req) ?? null });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: agent.id,
      description: `${requestType} request for "${agent.name}"`,
    });

    res.status(201).json({ success: true, data: request });
  } catch (err) {
    log.error("[agents] request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/requests/pending — admin lists pending requests
router.get("/requests/pending", requireClawAdmin, async (req: Request, res: Response) => {
  try {
    const scope = getAdminOrgScope(req, "/agents/requests/pending");
    const requests = await agentRequestRepository.listPending(scope.orgId);

    // Batch-fetch agents, skills, requesters, and agent owners to avoid N+1
    const agentIds = [...new Set(requests.map((r) => r.agentId).filter((id): id is string => !!id))];
    const skillIds = [...new Set(requests.map((r) => r.skillId).filter((id): id is string => !!id))];
    const requesterIds = [...new Set(requests.map((r) => r.requesterId))];
    const [agents, skills, requesters] = await Promise.all([
      agentRepository.findByIds(agentIds),
      skillRepository.findByIds(skillIds),
      userRepository.findByIds(requesterIds),
    ]);
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const skillMap = new Map(skills.map((s) => [s.id, s]));
    const requesterMap = new Map(requesters.map((u) => [u.id, u]));

    // Batch-fetch agent owners (distinct from requesters)
    const ownerIds = [...new Set(agents.map((a) => a.ownerUserId).filter((id): id is string => !!id))];
    const owners = await userRepository.findByIds(ownerIds);
    const ownerMap = new Map(owners.map((u) => [u.id, u]));
    const orgNames = scope.allOrgs ? await getOrgNameMap(requests.map((r) => r.orgId)) : new Map();

    const enriched = requests.map((r) => {
      const agent = r.agentId ? agentMap.get(r.agentId) : undefined;
      const skill = r.skillId ? skillMap.get(r.skillId) : undefined;
      const requester = requesterMap.get(r.requesterId);
      const agentOwner = agent?.ownerUserId ? ownerMap.get(agent.ownerUserId) : undefined;
      return {
        ...r,
        ...(scope.allOrgs ? withOrgLabel({ orgId: r.orgId }, orgNames) : {}),
        agentName: agent?.name ?? r.agentSlug,
        skillName: skill?.name,
        requesterName: requester?.name,
        requesterEmail: requester?.email,
        agentOwnerName: agentOwner?.name,
        agentOwnerEmail: agentOwner?.email,
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    log.error("[agents] list requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/requests/:requestId/approve — admin approves
router.post("/requests/:requestId/approve", requireClawAdmin, async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const request = await agentRequestRepository.findById(req.params.requestId);
    if (!request || request.status !== "pending") {
      res.status(404).json({ success: false, error: "Request not found or already processed" });
      return;
    }

    // Execute the action based on target type
    if (request.targetType === "skill" && request.skillId) {
      const skill = await skillRepository.findById(request.skillId);
      if (!skill) { res.status(404).json({ success: false, error: "Skill not found" }); return; }

      if (request.requestType === "push_to_global") {
        await skillRepository.update(skill.slug, skill.orgId, { scope: "global", promotedBy: reviewerId, promotedAt: new Date() });
      }

      await agentRequestRepository.updateStatus(request.id, "approved", reviewerId);
      await writeAuditLog({
        actorUserId: reviewerId,
        eventType: "REQUEST_APPROVED",
        targetId: skill.id,
        description: `Approved ${request.requestType} for skill "${skill.name}"`,
      });
    } else {
      const agent = request.agentId ? await agentRepository.findById(request.agentId) : null;
      if (!agent) { res.status(404).json({ success: false, error: "Agent not found" }); return; }

      if (request.requestType === "push_to_spaces") {
        // Approved — admin will use Create App / Install / Configure Webhook buttons separately
      } else if (request.requestType === "push_to_global") {
        await agentRepository.updateById(agent.id, { scope: "global", promotedBy: reviewerId, promotedAt: new Date() });
      }

      await agentRequestRepository.updateStatus(request.id, "approved", reviewerId);
      await writeAuditLog({
        actorUserId: reviewerId,
        eventType: "REQUEST_APPROVED",
        targetId: agent.id,
        description: `Approved ${request.requestType} for "${agent.name}"`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    log.error("[agents] approve request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/requests/:requestId/reject — admin rejects
router.post("/requests/:requestId/reject", requireClawAdmin, async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req)!;
    const { note } = req.body as { note?: string };

    const request = await agentRequestRepository.findById(req.params.requestId);
    if (!request || request.status !== "pending") {
      res.status(404).json({ success: false, error: "Request not found or already processed" });
      return;
    }

    await agentRequestRepository.updateStatus(request.id, "rejected", reviewerId, note);

    await writeAuditLog({
      actorUserId: reviewerId,
      eventType: "REQUEST_REJECTED",
      targetId: request.agentId ?? request.skillId ?? request.id,
      description: `Rejected ${request.requestType} for "${request.agentSlug ?? request.skillSlug}"${note ? `: ${note}` : ""}`,
    });

    res.json({ success: true });
  } catch (err) {
    log.error("[agents] reject request error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent cloning ─────────────────────────────────────────────────────────────
// Clone copies the source agent's prompt, config (tools/subagents/behaviour),
// tools, skills, KB grants and MCP connections into a new PERSONAL agent owned
// by the caller. Spaces app identity, shares, provider credentials, delegation
// grants and prompt history stay behind (see agentRepository.cloneAgentForUser).
// Owners / contributors / admins clone instantly; everyone else raises a
// "clone" AgentRequest that the SOURCE agent's owner reviews — surfaced both on
// this frontend (GET /clone-requests/incoming) and, best-effort, as an
// Approve/Decline DM in Spaces.

/**
 * Turn a clone error into a client-safe, actionable message. Schema-drift
 * errors (P2022 missing column / P2021 missing table) mean a Prisma migration
 * hasn't been applied — surface that explicitly instead of a blank 500, so the
 * UI shows something you can act on rather than "Internal server error".
 */
function describeCloneError(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (err.meta ?? {}) as { column?: string; table?: string };
    if (err.code === "P2022") {
      return `Database schema out of date — missing column "${meta.column ?? "?"}". Run pending migrations (prisma migrate deploy).`;
    }
    if (err.code === "P2021") {
      return `Database schema out of date — missing table "${meta.table ?? "?"}". Run pending migrations (prisma migrate deploy).`;
    }
    // Last line of a Prisma error is usually the human-readable cause.
    return `Database error ${err.code}: ${err.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? err.message}`;
  }
  return err instanceof Error ? err.message : "Internal server error";
}

/**
 * Best-effort Spaces DM to the source agent's owner announcing a pending clone
 * request. Silent no-op (logged) when the source agent has no Spaces app
 * identity or the DM API fails — the frontend inbox is the authoritative
 * surface, so notification failure must never fail the clone request.
 */
async function notifyOwnerOfCloneRequestInSpaces(args: {
  agent: { slug: string; name: string; ownerUserId: string | null; spacesAppId: string | null; spacesAppToken: string | null; spacesAppUserId: string | null };
  requestId: string;
  requesterName: string;
}): Promise<void> {
  const { agent, requestId, requesterName } = args;
  if (!agent.ownerUserId) return;
  if (!agent.spacesAppId || !agent.spacesAppToken || !agent.spacesAppUserId) {
    log.info(`[agents/clone] owner DM skipped for ${agent.slug}: source agent not Spaces-registered`);
    return;
  }
  try {
    const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
    if (!ciphertext || !iv || !authTag) return;
    const token = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
    // openDm requires the owner's own workspace. Resolve from the Spaces user
    // row (or the claw SurfaceTenantLink fallback inside getWorkspaceIdForUser);
    // never pin a per-user DM to the deployment-wide default workspace.
    const workspaceId = (await getWorkspaceIdForUser(agent.ownerUserId, "clone-owner-dm")) ?? "";
    if (!workspaceId) {
      log.warn(`[agents/clone] owner DM skipped for ${agent.slug}: no workspaceId for owner ${agent.ownerUserId}`);
      return;
    }

    const dm = (await spacesAppFetch("/channel/openDm", {
      targetUserId: agent.ownerUserId,
      workspaceId,
    }, token)) as { channelId: string };

    const flow = buildCloneApprovalFlow({
      requestId,
      ownerUserId: agent.ownerUserId,
      agentSlug: agent.slug,
      agentName: agent.name,
      requesterName,
      spacesBaseUrl: CONFIG.spacesAppUrl,
    });

    await spacesAppFetch("/chat/postMessage", {
      channelId: dm.channelId,
      flow,
      userId: agent.spacesAppUserId,
    }, token);

    log.info(`[agents/clone] sent clone-approval DM to owner ${agent.ownerUserId} for agent ${agent.slug}`);
  } catch (err) {
    log.warn(`[agents/clone] owner DM failed for ${agent.slug}:`, errMsg(err));
  }
}

/**
 * Resolve the caller's relationship to an agent: owner (real ownership, not
 * admin-derived), contributor (EDITOR/CONTRIBUTOR share), or admin.
 */
async function resolveCloneRelation(agent: { id: string; ownerUserId: string | null }, requesterId: string) {
  const isOwner = agent.ownerUserId === requesterId;
  const admin = await isClawAdmin(requesterId);
  let isContributor = false;
  if (!isOwner && !admin) {
    const share = await agentShareRepository.findByAgentAndUser(agent.id, requesterId);
    isContributor = share?.role === "EDITOR" || share?.role === "CONTRIBUTOR";
  }
  return { isOwner, admin, isContributor, privileged: isOwner || admin || isContributor };
}

// POST /agents/:slug/clone — clone now (privileged) or raise a clone request.
router.post("/:slug/clone", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/clone", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }

    const { name } = req.body as { name?: string };
    const { privileged } = await resolveCloneRelation(agent, requesterId);

    if (privileged) {
      // Retry once on a slug uniqueness race (P2002) — buildCloneSlug pre-checks
      // but the DB unique index is the real guard under concurrency.
      const cloneOpts = name ? { name } : {};
      let clone;
      try {
        clone = await agentRepository.cloneAgentForUser(agent.id, requesterId, cloneOpts);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          clone = await agentRepository.cloneAgentForUser(agent.id, requesterId, cloneOpts);
        } else {
          throw e;
        }
      }
      if (!clone) { res.status(404).json({ success: false, error: "Agent not found" }); return; }
      await writeAuditLog({
        actorUserId: requesterId,
        eventType: "AGENT_CREATED",
        targetId: clone.id,
        description: `Cloned "${agent.name}" (${agent.slug}) → "${clone.name}" (${clone.slug})`,
      });
      res.status(201).json({ success: true, data: clone, cloned: true });
      return;
    }

    // Non-privileged → owner-approval path. Dedupe on an existing pending
    // request from the same user for the same agent.
    const existing = await agentRequestRepository.findPendingClone(agent.id, requesterId);
    if (existing) {
      res.status(409).json({ success: false, error: "You already have a pending clone request for this agent", data: existing });
      return;
    }

    const request = await agentRequestRepository.create({
      agentId: agent.id,
      agentSlug: agent.slug,
      requestType: "clone",
      requesterId,
      orgId: agent.orgId ?? getOrgId(req) ?? null,
      // Carry the requester's chosen name so the clone the owner approves later
      // uses it (falls back to "<source> (Copy)" when unset).
      requestedName: name?.trim() || null,
    });
    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "REQUEST_CREATED",
      targetId: agent.id,
      description: `clone request for "${agent.name}"`,
    });

    // Best-effort Spaces notification (does not block the response).
    const requester = await userRepository.findById(requesterId);
    void notifyOwnerOfCloneRequestInSpaces({
      agent,
      requestId: request.id,
      requesterName: requester?.name ?? requester?.email ?? "A user",
    });

    res.status(202).json({ success: true, data: request, cloned: false, status: "pending_approval" });
  } catch (err) {
    log.error("[agents] clone error:", err);
    res.status(500).json({ success: false, error: describeCloneError(err) });
  }
});

// GET /agents/clone-requests/incoming — clone requests awaiting MY approval
// (agents I own). Admins see all pending clone requests.
router.get("/clone-requests/incoming", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const admin = await isClawAdmin(requesterId);

    const requests = await agentRequestRepository.listPendingClones();
    const agentIds = [...new Set(requests.map((r) => r.agentId).filter((id): id is string => !!id))];
    const requesterIds = [...new Set(requests.map((r) => r.requesterId))];
    const [agents, requesters] = await Promise.all([
      agentRepository.findByIds(agentIds),
      userRepository.findByIds(requesterIds),
    ]);
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    const requesterMap = new Map(requesters.map((u) => [u.id, u]));

    const mine = requests.filter((r) => {
      const a = r.agentId ? agentMap.get(r.agentId) : undefined;
      return a && (admin || a.ownerUserId === requesterId);
    });

    const enriched = mine.map((r) => {
      const a = r.agentId ? agentMap.get(r.agentId) : undefined;
      const u = requesterMap.get(r.requesterId);
      return {
        ...r,
        agentName: a?.name ?? r.agentSlug,
        agentSlug: a?.slug ?? r.agentSlug,
        requesterName: u?.name,
        requesterEmail: u?.email,
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    log.error("[agents] list incoming clone requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/clone-requests/outgoing — clone requests I raised (their status).
router.get("/clone-requests/outgoing", async (req: Request, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const requests = await agentRequestRepository.listCloneRequestsByRequester(requesterId);
    res.json({ success: true, data: requests });
  } catch (err) {
    log.error("[agents] list outgoing clone requests error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Shared approve/reject core — used by both the REST endpoints below and the
// Spaces flow-action clone branch. Authorization: only the SOURCE agent's owner
// or an admin may resolve. Idempotent: a non-pending request short-circuits.
export async function resolveCloneRequest(
  requestId: string,
  reviewerId: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<
  | { ok: true; status: "approved" | "rejected"; alreadyResolved?: boolean; clone?: unknown }
  | { ok: false; code: 400 | 403 | 404; error: string }
> {
  const request = await agentRequestRepository.findById(requestId);
  if (!request || request.requestType !== "clone") {
    return { ok: false, code: 404, error: "Clone request not found" };
  }
  const agent = request.agentId ? await agentRepository.findById(request.agentId) : null;
  if (!agent) return { ok: false, code: 404, error: "Source agent not found" };

  const admin = await isClawAdmin(reviewerId);
  if (agent.ownerUserId !== reviewerId && !admin) {
    return { ok: false, code: 403, error: "Only the agent owner or an admin can resolve this request" };
  }

  // Fast-path idempotency (also enforced atomically by the claim below): if it
  // is already resolved, don't attempt to re-clone.
  if (request.status !== "pending") {
    return { ok: true, status: request.status === "approved" ? "approved" : "rejected", alreadyResolved: true };
  }

  // Helper: resolve the "lost the race" case by reading the fresh status.
  const alreadyResolvedResult = async () => {
    const fresh = await agentRequestRepository.findById(request.id);
    return { ok: true as const, status: (fresh?.status === "approved" ? "approved" : "rejected") as "approved" | "rejected", alreadyResolved: true };
  };

  if (decision === "reject") {
    // Atomic claim: only the caller that flips pending→rejected owns the action.
    const claim = await agentRequestRepository.claimPendingClone(request.id, "rejected", reviewerId, note ?? null);
    if (claim.count === 0) return alreadyResolvedResult();
    await writeAuditLog({
      actorUserId: reviewerId,
      eventType: "REQUEST_REJECTED",
      targetId: agent.id,
      description: `Rejected clone of "${agent.name}"${note ? `: ${note}` : ""}`,
    });
    return { ok: true, status: "rejected" };
  }

  // approve → atomically claim the request FIRST, so two concurrent approvals
  // can't both create a clone. Only the winner (count === 1) proceeds to clone;
  // the loser reports already-resolved.
  const claim = await agentRequestRepository.claimPendingClone(request.id, "approved", reviewerId, note ?? null);
  if (claim.count === 0) return alreadyResolvedResult();

  // We own the approval — create the clone for the original requester. If clone
  // creation fails terminally, roll the claim back to pending so it can be
  // retried rather than being stuck "approved" with no clone.
  const cloneOpts = request.requestedName ? { name: request.requestedName } : {};
  let clone;
  try {
    clone = await agentRepository.cloneAgentForUser(agent.id, request.requesterId, cloneOpts);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      try {
        clone = await agentRepository.cloneAgentForUser(agent.id, request.requesterId, cloneOpts);
      } catch (e2) {
        await agentRequestRepository.revertClaimToPending(request.id).catch(() => {});
        throw e2;
      }
    } else {
      await agentRequestRepository.revertClaimToPending(request.id).catch(() => {});
      throw e;
    }
  }
  if (!clone) {
    await agentRequestRepository.revertClaimToPending(request.id).catch(() => {});
    return { ok: false, code: 404, error: "Source agent not found" };
  }

  await agentRequestRepository.resolveClone(request.id, "approved", reviewerId, { resultAgentId: clone.id, reviewNote: note ?? null });
  await writeAuditLog({
    actorUserId: reviewerId,
    eventType: "REQUEST_APPROVED",
    targetId: agent.id,
    description: `Approved clone of "${agent.name}" for ${request.requesterId}`,
  });
  await writeAuditLog({
    actorUserId: request.requesterId,
    eventType: "AGENT_CREATED",
    targetId: clone.id,
    description: `Clone of "${agent.name}" created via owner approval`,
  });
  return { ok: true, status: "approved", clone };
}

// POST /agents/clone-requests/:requestId/approve — owner/admin approves.
router.post("/clone-requests/:requestId/approve", async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req);
    if (!reviewerId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const result = await resolveCloneRequest(req.params.requestId, reviewerId, "approve");
    if (!result.ok) { res.status(result.code).json({ success: false, error: result.error }); return; }
    res.json({ success: true, data: result.clone ?? null, alreadyResolved: result.alreadyResolved ?? false });
  } catch (err) {
    log.error("[agents] approve clone request error:", err);
    res.status(500).json({ success: false, error: describeCloneError(err) });
  }
});

// POST /agents/clone-requests/:requestId/reject — owner/admin rejects.
router.post("/clone-requests/:requestId/reject", async (req: Request<{ requestId: string }>, res: Response) => {
  try {
    const reviewerId = getRequesterId(req);
    if (!reviewerId) { res.status(401).json({ success: false, error: "x-user-id required" }); return; }
    const { note } = req.body as { note?: string };
    const result = await resolveCloneRequest(req.params.requestId, reviewerId, "reject", note);
    if (!result.ok) { res.status(result.code).json({ success: false, error: result.error }); return; }
    res.json({ success: true, alreadyResolved: result.alreadyResolved ?? false });
  } catch (err) {
    log.error("[agents] reject clone request error:", err);
    res.status(500).json({ success: false, error: describeCloneError(err) });
  }
});

// ── Promote / Demote (Admin only) ─────────────────────────────────────────────

// POST /agents/:slug/promote — move agent from personal → global
router.post("/:slug/promote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/promote", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agent.scope === "global") {
      res.status(400).json({ success: false, error: "Agent is already global" });
      return;
    }

    const updated = await agentRepository.update(req.params.slug, agent.orgId, { scope: "global", promotedBy: requesterId, promotedAt: new Date() });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_PROMOTED",
      targetId: agent.id,
      description: `Agent "${agent.name}" (${agent.slug}) promoted to global scope`,
      metadata: { previousOwner: agent.ownerUserId },
    });

    log.info(`[agents] ${req.params.slug} promoted to global by ${requesterId}`);
    res.json({ success: true, data: sanitizeAgent(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    log.error("[agents] promote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/demote — move agent from global → personal (back to owner)
router.post("/:slug/demote", requireClawAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/demote", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agent.scope !== "global") {
      res.status(400).json({ success: false, error: "Agent is not global" });
      return;
    }

    const updated = await agentRepository.update(req.params.slug, agent.orgId, { scope: "personal", promotedBy: null, promotedAt: null });

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_DEMOTED",
      targetId: agent.id,
      description: `Agent "${agent.name}" (${agent.slug}) demoted from global to personal scope`,
      metadata: { ownerId: agent.ownerUserId },
    });

    log.info(`[agents] ${req.params.slug} demoted from global by ${requesterId}`);
    res.json({ success: true, data: sanitizeAgent(updated as unknown as Record<string, unknown>) });
  } catch (err) {
    log.error("[agents] demote error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent sharing (owner or admin can share a personal agent) ─────────────────

// POST /agents/:slug/shares — share agent with a user
//
// ACL:
//   - Personal agent  → owner / admin only (preventing contributor-driven
//                       privilege expansion on private agents)
//   - Global agent    → owner / admin / contributors. Contributors can
//                       co-manage the team because everyone can see the
//                       agent anyway; this is about granting EDIT rights.
router.post("/:slug/shares", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const agent = ctx.agent;
    // Contributors can only add new contributors on GLOBAL agents.
    // On personal agents they must be promoted to owner/admin first.
    if (!ctx.isOwner && !ctx.isAdmin && agent.scope !== "global") {
      res.status(403).json({
        success: false,
        error: "Contributors can only add other contributors on global agents",
      });
      return;
    }

    const { userId, role } = req.body as { userId?: string; role?: string };
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }
    if (userId === agent.ownerUserId) {
      res.status(400).json({ success: false, error: "Cannot share with the agent owner" });
      return;
    }

    // The body userId may be a canonical Claw id OR a Spaces alias — resolve
    // before keying the share row so it always references the canonical user.
    const targetUser = await findUserByAnyId(userId);
    if (!targetUser) {
      res.status(404).json({ success: false, error: "Target user not found" });
      return;
    }
    // Phase-2 (Gap 4): reject cross-org shares. A user can only be granted access
    // to an agent in their OWN org. (Existing cross-org share rows are already
    // inert — listVisible's org filter + the org-scoped ACL lookup hide them — but
    // reject at write time too. Guarded on agent.orgId being set so a legacy
    // null-org agent doesn't block sharing.)
    if (agent.orgId && targetUser.orgId !== agent.orgId) {
      res.status(403).json({ success: false, error: "Cannot share an agent with a user in a different organization" });
      return;
    }

    const VALID_ROLES = ["VIEWER", "EDITOR", "CONTRIBUTOR"];
    const shareRole = VALID_ROLES.includes(role ?? "") ? (role as string) : "VIEWER";
    const share = await agentShareRepository.upsert(agent.id, targetUser.id, shareRole, requesterId);

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_SHARED",
      targetId: agent.id,
      description: `Agent "${agent.name}" shared with ${targetUser.email} as ${shareRole}`,
      metadata: { sharedWithUserId: userId, role: shareRole },
    });

    res.status(201).json({ success: true, data: share });
  } catch (err) {
    log.error("[agents] share error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /agents/:slug/shares/:userId — remove share
//
// Same scope-aware ACL as POST: contributors can remove a share only on
// global agents. On personal agents, owner/admin only.
router.delete("/:slug/shares/:userId", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req)!;
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const agent = ctx.agent;
    if (!ctx.isOwner && !ctx.isAdmin && agent.scope !== "global") {
      res.status(403).json({
        success: false,
        error: "Contributors can only manage shares on global agents",
      });
      return;
    }

    await agentShareRepository.delete(agent.id, req.params.userId);

    await writeAuditLog({
      actorUserId: requesterId,
      eventType: "AGENT_UNSHARED",
      targetId: agent.id,
      description: `Agent "${agent.name}" share removed for user ${req.params.userId}`,
    });

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Share not found" });
      return;
    }
    log.error("[agents] unshare error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/shares — list who an agent is shared with.
// Visible to owner, admin, and contributors so contributors can see who
// else is on the team. Read-only — no privilege-escalation risk.
router.get("/:slug/shares", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const ctx = (req as Request & { agentContext: import("../middleware/agent-acl.js").AgentContext }).agentContext;
    const shares = await agentShareRepository.listByAgent(ctx.agent.id);
    res.json({ success: true, data: shares });
  } catch (err) {
    log.error("[agents] list shares error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Tool attach/detach ───────────────────────────────────────────────

router.post("/:slug/tools", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/attach-tool", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const { toolId, permission } = req.body as { toolId?: string; permission?: string };

    if (!toolId || typeof toolId !== "string") {
      res.status(400).json({ success: false, error: "toolId is required" });
      return;
    }

    const tool = await agentRepository.findToolById(toolId);
    if (!tool) {
      res.status(404).json({ success: false, error: "Tool not found" });
      return;
    }

    const agentTool = await agentRepository.upsertTool(agent.id, toolId, permission ?? "allow");

    res.status(201).json({ success: true, data: agentTool });
  } catch (err) {
    log.error("[agents] attach tool error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/tools/:toolId", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string; toolId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/delete-tool", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    await agentRepository.deleteTool(agent.id, req.params.toolId);

    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Tool not attached to this agent" });
      return;
    }
    log.error("[agents] detach tool error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── POST /:slug/register-app (manual) ────────────────────────────────

function getCookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Claims we care about from a Spaces authV2 workspace JWT. Payload only —
 *  this is never a trust decision, Spaces verifies the signature. We read it
 *  solely to keep the token, the workspace and the session pointing at the
 *  same identity before forwarding them. */
interface WorkspaceTokenClaims {
  sub?: string;
  workspaceId?: string;
}

function decodeWorkspaceToken(token: string): WorkspaceTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const claims = JSON.parse(json) as WorkspaceTokenClaims;
    return typeof claims === "object" && claims !== null ? claims : null;
  } catch {
    return null;
  }
}

/** Every `xyne_ws_<workspaceId>_token` cookie on the request. */
function workspaceTokenCookies(req: Request): Array<{ workspaceId: string; token: string }> {
  const cookie = req.headers["cookie"] ?? "";
  const out: Array<{ workspaceId: string; token: string }> = [];
  for (const match of cookie.matchAll(/(?:^|;\s*)xyne_ws_([^=;]+)_token=([^;]*)/g)) {
    const workspaceId = match[1];
    const raw = match[2];
    if (!workspaceId || !raw) continue;
    out.push({ workspaceId, token: decodeURIComponent(raw) });
  }
  return out;
}

/**
 * The Spaces credentials to forward, resolved as ONE consistent triple.
 *
 * Why this is not three independent lookups: a browser holds a SEPARATE
 * `xyne_ws_<id>_token` per workspace but only ONE `user_session_id`. When the
 * same human has two Spaces user rows (observed live: one email owning both
 * `cmgjk5fcz…` and `cmqsf2vlq…`, in different orgs), picking the bearer by
 * `xyne_last_workspace` while taking the session from its own cookie forwards a
 * token for user A alongside a session for user B. Spaces then resolves an
 * inconsistent principal and `req.user.workspaceId` comes back unusable —
 * surfacing downstream as a misleading `ORG_REQUIRED`, with every workspace row
 * involved perfectly healthy.
 *
 * So: the workspace is taken FROM the chosen token's own claims (falling back
 * to the cookie name that carried it), never from an independent cookie read,
 * and a token whose `sub` disagrees with the other workspace tokens is logged
 * rather than silently forwarded.
 */
function resolveSpacesUserAuth(req: Request): {
  token?: string | undefined;
  workspaceId?: string | undefined;
  sub?: string | undefined;
} {
  const explicitWorkspace = typeof req.headers["x-workspace-id"] === "string" && req.headers["x-workspace-id"]
    ? (req.headers["x-workspace-id"] as string)
    : undefined;

  // An explicitly supplied token wins — the caller has already decided.
  const bodyToken = (req.body as { userToken?: string } | undefined)?.userToken;
  const authHeader = req.headers["authorization"];
  const explicitToken = bodyToken
    ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
  if (explicitToken) {
    const claims = decodeWorkspaceToken(explicitToken);
    return {
      token: explicitToken,
      ...(explicitWorkspace ?? claims?.workspaceId ? { workspaceId: explicitWorkspace ?? claims?.workspaceId } : {}),
      ...(claims?.sub ? { sub: claims.sub } : {}),
    };
  }

  const wsTokens = workspaceTokenCookies(req);
  if (wsTokens.length > 0) {
    const preferred = explicitWorkspace ?? getCookieValue(req, "xyne_last_workspace");
    const chosen = wsTokens.find((t) => t.workspaceId === preferred) ?? wsTokens[0]!;
    const claims = decodeWorkspaceToken(chosen.token);

    // Two workspace tokens for two DIFFERENT users is the ambiguity above. We
    // cannot tell from here which one `user_session_id` belongs to, so forward
    // the chosen one but make the situation visible instead of mysterious.
    const subs = new Set(
      wsTokens.map((t) => decodeWorkspaceToken(t.token)?.sub).filter((v): v is string => Boolean(v)),
    );
    if (subs.size > 1) {
      log.warn(
        `[agents] multiple Spaces identities on one request — forwarding sub=${claims?.sub ?? "unknown"} ` +
        `for workspace=${claims?.workspaceId ?? chosen.workspaceId}; all subs=[${[...subs].join(", ")}]. ` +
        `If Spaces rejects this (e.g. ORG_REQUIRED), the session cookie likely belongs to a different one.`,
      );
    }

    // Workspace comes from the token we are actually sending, so the pair can
    // never disagree — the cookie name is only a fallback for a malformed JWT.
    return {
      token: chosen.token,
      workspaceId: claims?.workspaceId ?? chosen.workspaceId,
      ...(claims?.sub ? { sub: claims.sub } : {}),
    };
  }

  // Fall back to legacy google_access_token — but ONLY if it looks like a JWT.
  // During the authV2 pending-auth window this cookie holds a JSON blob, which
  // is not a valid bearer token.
  const legacy = getCookieValue(req, "google_access_token");
  if (legacy && legacy.split(".").length === 3) {
    const claims = decodeWorkspaceToken(legacy);
    return {
      token: legacy,
      ...(explicitWorkspace ?? claims?.workspaceId ? { workspaceId: explicitWorkspace ?? claims?.workspaceId } : {}),
      ...(claims?.sub ? { sub: claims.sub } : {}),
    };
  }

  return { ...(explicitWorkspace ? { workspaceId: explicitWorkspace } : {}) };
}

function extractUserToken(req: Request): string | undefined {
  return resolveSpacesUserAuth(req).token;
}

function extractSessionId(req: Request): string | undefined {
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header) return header;
  return getCookieValue(req, "xyne_session") ?? getCookieValue(req, "user_session_id");
}

function extractWorkspaceId(req: Request): string | undefined {
  // Derived from the SAME resolution as the bearer token, so the two can never
  // point at different workspaces. See resolveSpacesUserAuth.
  return resolveSpacesUserAuth(req).workspaceId ?? getCookieValue(req, "xyne_last_workspace");
}

// /api/apps/* routes are mounted on Spaces' legacy `auth.ts` middleware, which
// reads the session ONLY from the `xyne_session` cookie (gated behind a
// truthy workspaceId). Send both Cookie + headers so we work on both legacy
// and authV2 routes; otherwise these calls 401 ~15min after the JWT issues.
function spacesUserAuthHeaders(
  userToken: string,
  sessionId: string | undefined,
  workspaceId: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${userToken}` };
  if (sessionId) headers["x-session-id"] = sessionId;
  if (workspaceId) headers["x-workspace-id"] = workspaceId;
  const cookieParts: string[] = [];
  if (sessionId) cookieParts.push(`xyne_session=${sessionId}`);
  if (workspaceId) cookieParts.push(`xyne_last_workspace=${workspaceId}`);
  if (cookieParts.length > 0) headers["Cookie"] = cookieParts.join("; ");
  return headers;
}

// ── Step-by-step Spaces App registration (3 separate buttons) ────────

router.post("/:slug/create-app", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/create-app", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (agent.spacesAppId) { res.status(400).json({ success: false, error: "Agent already has a Spaces App" }); return; }

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const createRes = await fetch(`${spacesUrl}/api/apps/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
      body: JSON.stringify({ name: agent.name, description: agent.description }),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      // ORG_REQUIRED from Spaces means it could not resolve an org for
      // `req.user.workspaceId` — which, when the workspace itself is healthy,
      // means the principal it resolved is not the one we think we sent. Say so
      // here: chasing this from the Spaces-side message alone leads through the
      // workspace, its orgId and the org mapping, all of which look fine.
      if (text.includes("ORG_REQUIRED")) {
        const auth = resolveSpacesUserAuth(req);
        log.warn(
          `[agents] create-app ORG_REQUIRED slug=${req.params.slug} ` +
          `forwardedSub=${auth.sub ?? "unknown"} forwardedWorkspace=${auth.workspaceId ?? "none"} ` +
          `sessionId=${sessionId ? "present" : "MISSING"}`,
        );
        res.status(400).json({
          success: false,
          error:
            `Spaces could not resolve an organization for workspace ${auth.workspaceId ?? "(none sent)"}. ` +
            `This usually means the workspace token and the login session belong to different Spaces users. ` +
            `Switch to the workspace you normally work in and retry.`,
        });
        return;
      }
      res.status(createRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    const body = (await createRes.json()) as { id?: string };
    if (!body.id) { res.status(500).json({ success: false, error: "Spaces did not return app ID" }); return; }

    await agentRepository.update(req.params.slug, agent.orgId, { spacesAppId: body.id });

    log.info(`[agents] Created Spaces App ${body.id} for ${req.params.slug}`);
    res.json({ success: true, data: { spacesAppId: body.id } });
  } catch (err) {
    log.error("[agents] create-app error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/install-app", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/install-app", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }
    if (agent.spacesAppToken) { res.status(400).json({ success: false, error: "App already installed" }); return; }

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const installRes = await fetch(`${spacesUrl}/api/apps/install/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
    });

    if (!installRes.ok) {
      const text = await installRes.text().catch(() => "");
      res.status(installRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    const body = (await installRes.json()) as { jwtToken?: string };
    if (!body.jwtToken) { res.status(500).json({ success: false, error: "Spaces did not return JWT token" }); return; }

    // Decode JWT to extract appUserId
    let appUserId: string | null = null;
    const jwtParts = body.jwtToken.split(".");
    if (jwtParts[1]) {
      try {
        const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
        appUserId = decoded.userId ?? null;
      } catch { /* ignore */ }
    }

    const encToken = encrypt(body.jwtToken, CONFIG.encryptionKey);
    await agentRepository.update(req.params.slug, agent.orgId, {
      spacesAppUserId: appUserId,
      spacesAppToken: `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`,
    });

    log.info(`[agents] Installed Spaces App ${agent.spacesAppId} for ${req.params.slug} (botUser=${appUserId})`);
    res.json({ success: true, data: { spacesAppUserId: appUserId } });
  } catch (err) {
    log.error("[agents] install-app error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/configure-webhook", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/configure-webhook", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const webhookUrl = `${CONFIG.selfUrl}/claw/api/v1/webhook/app/${agent.spacesAppId}`;

    const configRes = await fetch(`${spacesUrl}/api/apps/configureWebhook/${agent.spacesAppId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) },
      body: JSON.stringify({ webhookUrl }),
    });

    if (!configRes.ok) {
      const text = await configRes.text().catch(() => "");
      res.status(configRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
      return;
    }

    log.info(`[agents] Configured webhook for ${req.params.slug}: ${webhookUrl}`);

    // Fetch + persist the per-app signingSecret so verify-spaces-signature can
    // HMAC-check inbound webhook bodies. Best-effort — if Spaces is reachable
    // for configureWebhook (just succeeded above) it's almost certainly
    // reachable for signing-secret too. On failure we log and leave the
    // signature column null; fail-closed verification rejects this agent's
    // webhooks until a future call (or the backfill script) succeeds.
    await fetchAndStoreSigningSecretFromSpacesApi({
      agentId: agent.id,
      spacesAppId: agent.spacesAppId,
      userAuthHeaders: spacesUserAuthHeaders(userToken, sessionId, workspaceId),
    }).catch((err) => {
      log.warn(`[agents] signing-secret fetch swallowed for ${req.params.slug}: ${errMsg(err)}`);
      return false;
    });

    res.json({ success: true, data: { webhookUrl } });
  } catch (err) {
    log.error("[agents] configure-webhook error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Full app-permission set a Claw agent bot needs to operate against Spaces'
// /api/apps/* routes (mirrors the `requirePermission(...)` gates: chat:write
// for posting results/progress, channels/users/usergroups reads for resolving
// mentions, tickets + files + im + email for the spaces tools). Granted as ONE
// set so every spaces tool works; tighten per-agent later if needed.
const CLAW_APP_PERMISSIONS = [
  "chat:write",
  "channels:read",
  "users:read",
  "usergroups:read",
  "tickets:read",
  "tickets:write",
  "files:read",
  "files:write",
  "im:write",
  "email:read",
];

// Final registration step: grant the bot its app permissions and re-install so
// they take effect. Spaces loads an app's permissions per-request from
// installed_app_permissions (NOT from the JWT), and a post-install setPermissions
// lands as UNAPPROVED until the app is re-installed — so we must setPermissions
// THEN install (the existing-installation branch re-approves + re-issues the JWT).
// Without this the bot 403s with `missing_permission required:chat:write granted:[]`
// the moment it tries to post a result back to the thread.
router.post("/:slug/grant-permissions", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const userToken = extractUserToken(req);
    if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/grant-permissions", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

    const spacesUrl = CONFIG.spacesInternalUrl;
    const sessionId = extractSessionId(req);
    const workspaceId = extractWorkspaceId(req);
    const headers = { "Content-Type": "application/json", ...spacesUserAuthHeaders(userToken, sessionId, workspaceId) };

    // 1. Grant the bot its permissions. The set of AVAILABLE permissions is
    //    environment-specific — the Spaces `availableAppPermission` registry may
    //    be only partially seeded (e.g. local has 5 of the 10). setPermissions
    //    400s with "Unknown permissions: …" if we send a scope the registry
    //    doesn't know, so fetch the registry and grant only the intersection of
    //    what we want and what exists. Robust across local / staging / prod.
    let grantScopes = CLAW_APP_PERMISSIONS;
    try {
      const availRes = await fetch(`${spacesUrl}/api/apps/permissions`, { method: "GET", headers });
      if (availRes.ok) {
        const availBody = (await availRes.json()) as { permissions?: Array<{ name?: string; type?: string }> };
        const available = new Set(
          (availBody.permissions ?? [])
            .filter((p) => p?.name && p?.type)
            .map((p) => `${p.name}:${String(p.type).toLowerCase()}`),
        );
        if (available.size > 0) {
          grantScopes = CLAW_APP_PERMISSIONS.filter((s) => available.has(s));
        }
      }
    } catch (err) {
      log.warn(`[agents] grant-permissions: registry fetch failed for ${req.params.slug}; using full desired set — ${errMsg(err)}`);
    }
    if (grantScopes.length === 0) {
      res.status(400).json({ success: false, error: "No grantable permissions — the Spaces permission registry has none of the bot's scopes." });
      return;
    }

    // Replace the app's permission set with the grantable scopes.
    const permRes = await fetch(`${spacesUrl}/api/apps/permissions/${agent.spacesAppId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ permissions: grantScopes }),
    });
    if (!permRes.ok) {
      const text = await permRes.text().catch(() => "");
      res.status(permRes.status).json({ success: false, error: `Spaces (setPermissions): ${text.slice(0, 300)}` });
      return;
    }

    // 2. Re-install to APPROVE the just-granted permissions + re-issue the JWT.
    const installRes = await fetch(`${spacesUrl}/api/apps/install/${agent.spacesAppId}`, {
      method: "POST",
      headers,
    });
    if (!installRes.ok) {
      const text = await installRes.text().catch(() => "");
      res.status(installRes.status).json({ success: false, error: `Spaces (reinstall): ${text.slice(0, 300)}` });
      return;
    }

    // 3. Persist the refreshed token (re-signed with the same secret). Permissions
    //    are read from the DB per request, but re-storing keeps the bot token fresh
    //    and mirrors install-app's persistence.
    const body = (await installRes.json()) as { jwtToken?: string };
    if (body.jwtToken) {
      let appUserId: string | null = agent.spacesAppUserId ?? null;
      const jwtParts = body.jwtToken.split(".");
      if (jwtParts[1]) {
        try {
          const decoded = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString()) as { userId?: string };
          appUserId = decoded.userId ?? appUserId;
        } catch { /* keep prior appUserId */ }
      }
      const encToken = encrypt(body.jwtToken, CONFIG.encryptionKey);
      await agentRepository.update(req.params.slug, agent.orgId, {
        spacesAppToken: `${encToken.ciphertext}:${encToken.iv}:${encToken.authTag}`,
        ...(appUserId ? { spacesAppUserId: appUserId } : {}),
      });
    }

    log.info(`[agents] Granted ${grantScopes.length} permissions (${grantScopes.join(", ")}) + reinstalled ${agent.spacesAppId} for ${req.params.slug}`);
    res.json({ success: true, data: { permissions: grantScopes } });
  } catch (err) {
    log.error("[agents] grant-permissions error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Upload bot picture (proxies to spaces /api/apps/upload-picture/:appId) ──────────
const pictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/:slug/upload-picture",
  requireAgentOwnerOrAdmin,
  pictureUpload.single("picture") as unknown as RequestHandler<{ slug: string }>,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const userToken = extractUserToken(req);
      if (!userToken) { res.status(401).json({ success: false, error: "User token required" }); return; }

      const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
      if (!agent) { logAgentScopedMiss(req, "agents/upload-picture", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
      if (!agent.spacesAppId) { res.status(400).json({ success: false, error: "Create app first" }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ success: false, error: "picture file is required" }); return; }

      const form = new FormData();
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      form.append("picture", blob, file.originalname);

      const spacesUrl = CONFIG.spacesInternalUrl;
      const sessionId = extractSessionId(req);
      const workspaceId = extractWorkspaceId(req);
      const uploadRes = await fetch(`${spacesUrl}/api/apps/upload-picture/${agent.spacesAppId}`, {
        method: "POST",
        headers: spacesUserAuthHeaders(userToken, sessionId, workspaceId),
        body: form,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        res.status(uploadRes.status).json({ success: false, error: `Spaces: ${text.slice(0, 300)}` });
        return;
      }

      const body = await uploadRes.json().catch(() => ({})) as { pictureUrl?: string };
      log.info(`[agents] Uploaded picture for ${req.params.slug}`);
      res.json({ success: true, data: body });
    } catch (err) {
      log.error("[agents] upload-picture error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// ── User Agent Config (per-user provider override) ──────────────────

router.get("/:slug/user-config/:userId", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/get-user-config", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    const config = await userAgentConfigRepository.findByUserAndAgent(req.params.userId, agent.orgId, req.params.slug);
    res.json({
      success: true,
      // `inherited` separates "never picked one" from an explicit "spaces" pick.
      // Both report provider "spaces", but only the former follows the user's
      // account-wide default harness (User.localHarnessDefaultProvider).
      data: { provider: config?.provider ?? "spaces", inherited: !config },
    });
  } catch (err) {
    log.error("[agents] get user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug/user-config/:userId", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const { provider } = req.body as { provider?: string };
    const allowedProviders = [
      "spaces",
      "copilot",
      "claude",
      "codex",
      ...(CONFIG.localHarnessEnabled ? LOCAL_HARNESS_PROVIDERS : []),
    ];
    if (!provider || !allowedProviders.includes(provider)) {
      res.status(400).json({ success: false, error: `provider must be one of: ${allowedProviders.join(", ")}` });
      return;
    }
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/upsert-user-config", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    const config = await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { provider }, agent.orgId);
    res.json({ success: true, data: { provider: config.provider } });
  } catch (err) {
    log.error("[agents] upsert user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── User Chain Config (per-user agent chaining) ──────────────────────

router.get("/:slug/chain-config/:userId", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/get-chain-config", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    const config = await userAgentConfigRepository.findByUserAndAgent(req.params.userId, agent.orgId, req.params.slug);
    res.json({ success: true, data: config?.chainConfig ?? null });
  } catch (err) {
    log.error("[agents] get chain-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.put("/:slug/chain-config/:userId", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const chainConfig = req.body.chainConfig ?? null;

    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { logAgentScopedMiss(req, "agents/upsert-chain-config", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
    await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { chainConfig }, agent.orgId);

    res.json({ success: true, data: chainConfig });
  } catch (err) {
    log.error("[agents] upsert chain-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/user-config/:userId", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) { res.json({ success: true }); return; }
    await userAgentConfigRepository.delete(req.params.userId, agent.orgId, req.params.slug);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.json({ success: true }); // already deleted
      return;
    }
    log.error("[agents] delete user-config error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── GitHub Copilot Device Code OAuth ────────────────────────────────

const GITHUB_CLIENT_ID = "Ov23li8tweQw6odWQebz"; // Same as OpenCode / GitHub Copilot CLI
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_CODE_PREFIX = "gh-device:";
const DEVICE_CODE_TTL = 900; // 15 minutes

const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface ClaudeModelInfo {
  id: string;
  displayName: string;
}

export async function fetchAnthropicModels(apiKey: string, baseUrl?: string, authType?: string): Promise<ClaudeModelInfo[]> {
  const root = (baseUrl?.trim() || ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  // Anthropic OAuth tokens (Pro/Max via `claude setup-token`) authenticate
  // with Authorization: Bearer + anthropic-beta=oauth-2025-04-20. The API
  // key path (Console keys) uses x-api-key. Sending the OAuth token as
  // x-api-key returns 401 "invalid x-api-key".
  const isOAuth = authType === "oauth_token";
  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
  if (isOAuth) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }
  await assertSafeOutboundUrl(`${root}/v1/models`);
  const res = await fetch(`${root}/v1/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ id?: string; display_name?: string }>;
  };

  return (body.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => Boolean(m.id))
    .map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
    }));
}

router.post("/:slug/user-config/:userId/github-login", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const ghRes = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
    });

    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => "");
      res.status(502).json({ success: false, error: `GitHub error: ${text.slice(0, 200)}` });
      return;
    }

    const data = await ghRes.json() as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    // Store device_code in Redis so poll endpoint can use it
    const key = `${DEVICE_CODE_PREFIX}${req.params.userId}:${req.params.slug}`;
    const redis = redisService.getConnection();
    await redis.set(key, JSON.stringify({
      device_code: data.device_code,
      interval: data.interval,
    }), "EX", DEVICE_CODE_TTL);

    res.json({
      success: true,
      data: {
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn: data.expires_in,
        interval: data.interval,
      },
    });
  } catch (err) {
    log.error("[agents] github-login error:", err);
    res.status(500).json({ success: false, error: "Failed to initiate GitHub login" });
  }
});

router.post("/:slug/user-config/:userId/github-poll", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const key = `${DEVICE_CODE_PREFIX}${req.params.userId}:${req.params.slug}`;
    const redis = redisService.getConnection();
    const raw = await redis.get(key);

    if (!raw) {
      res.status(400).json({ success: false, error: "No pending login — start again" });
      return;
    }

    const { device_code } = JSON.parse(raw) as { device_code: string; interval: number };

    const ghRes = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await ghRes.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) {
      // Success — encrypt and store the token at user-level
      const encrypted = encrypt(data.access_token, CONFIG.encryptionKey);

      await userProviderCredentialsRepository.upsert(req.params.userId, "copilot", {
        encryptedKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        model: "gpt-4o",
        baseUrl: "https://api.githubcopilot.com",
      });
      // Also flip this agent's provider to copilot
      const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
      if (!agent) { logAgentScopedMiss(req, "agents/copilot-login-poll", req.params.slug); res.status(404).json({ success: false, error: "Agent not found" }); return; }
      await userAgentConfigRepository.upsert(req.params.userId, req.params.slug, { provider: "copilot" }, agent.orgId);

      // Cleanup Redis
      await redis.del(key);

      log.info(`[agents] GitHub Copilot login success for user ${req.params.userId} / agent ${req.params.slug}`);
      res.json({ success: true, data: { status: "approved" } });
      return;
    }

    if (data.error === "authorization_pending") {
      res.json({ success: true, data: { status: "pending" } });
      return;
    }

    if (data.error === "slow_down") {
      res.json({ success: true, data: { status: "slow_down" } });
      return;
    }

    // Other error
    await redis.del(key);
    res.json({ success: false, error: data.error_description ?? data.error ?? "Authorization failed" });
  } catch (err) {
    log.error("[agents] github-poll error:", err);
    res.status(500).json({ success: false, error: "Failed to poll GitHub" });
  }
});

router.post("/:slug/user-config/:userId/claude-models", pinUserIdParam, async (req: Request<{ slug: string; userId: string }>, res: Response) => {
  try {
    const { apiKey, baseUrl, authType } = req.body as { apiKey?: string; baseUrl?: string; authType?: string };
    let resolvedApiKey = apiKey?.trim();
    let resolvedAuthType: string | undefined = authType;
    let resolvedBaseUrl: string | undefined = baseUrl;

    // No key in the body → resolve a stored cred. Try the user's personal cred
    // first, then fall back to the AGENT's cred (the /v1/models list is
    // account-wide, so either works to populate the dropdown). Use
    // extractClaudeBearer so an OAuth *bundle* ({access_token,…}) yields the
    // bare token instead of the JSON blob.
    if (!resolvedApiKey) {
      const userCred = await userProviderCredentialsRepository.findByUserAndProvider(req.params.userId, "claude");
      if (userCred?.encryptedKey && userCred.iv && userCred.authTag) {
        resolvedApiKey = extractClaudeBearer(decrypt(userCred.encryptedKey, userCred.iv, userCred.authTag, CONFIG.encryptionKey));
        if (!resolvedAuthType) resolvedAuthType = userCred.authType ?? undefined;
        resolvedBaseUrl = resolvedBaseUrl ?? userCred.baseUrl ?? undefined;
      } else {
        const agentRow = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
        const agentCred = agentRow ? await agentProviderCredentialsRepository.findByAgentAndProvider(agentRow.id, "claude") : null;
        if (agentCred?.encryptedKey && agentCred.iv && agentCred.authTag) {
          resolvedApiKey = extractClaudeBearer(decrypt(agentCred.encryptedKey, agentCred.iv, agentCred.authTag, CONFIG.encryptionKey));
          if (!resolvedAuthType) resolvedAuthType = agentCred.authType ?? undefined;
          resolvedBaseUrl = resolvedBaseUrl ?? agentCred.baseUrl ?? undefined;
        }
      }
    }

    if (!resolvedApiKey) {
      res.status(400).json({ success: false, error: "apiKey is required" });
      return;
    }

    const models = await fetchAnthropicModels(resolvedApiKey, resolvedBaseUrl, resolvedAuthType);
    res.json({ success: true, data: models });
  } catch (err) {
    log.error("[agents] claude-models error:", err);
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Failed to fetch Claude models" });
  }
});

// ── Agent Knowledge Base (mirrors skills pattern) ────────────────────

router.get("/:slug/knowledge-base", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/knowledge-base", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const grants = await agentRepository.listCollections(agent.id);
    res.json({ success: true, data: grants });
  } catch (err) {
    log.error("[agents] list knowledge-base error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent Skill attach/detach (mirrors tool pattern) ──────────────────

router.get("/:slug/skills", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/list-skills", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const skills = await agentRepository.listSkills(agent.id);
    res.json({ success: true, data: skills });
  } catch (err) {
    log.error("[agents] list skills error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.post("/:slug/skills", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/attach-skill", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const { skillId } = req.body as { skillId?: string };
    if (!skillId || typeof skillId !== "string") {
      res.status(400).json({ success: false, error: "skillId is required" });
      return;
    }
    const agentSkill = await agentRepository.upsertSkill(agent.id, skillId);
    res.status(201).json({ success: true, data: agentSkill });
  } catch (err) {
    log.error("[agents] attach skill error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete("/:slug/skills/:skillId", requireAgentOwnerOrAdmin, async (req: Request<{ slug: string; skillId: string }>, res: Response) => {
  try {
    const agent = await agentRepository.findBySlug(req.params.slug, getOrgId(req));
    if (!agent) {
      logAgentScopedMiss(req, "agents/delete-skill", req.params.slug);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    await agentRepository.deleteSkill(agent.id, req.params.skillId);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "P2025") {
      res.status(404).json({ success: false, error: "Skill not attached to this agent" });
      return;
    }
    log.error("[agents] detach skill error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Agent-scoped MCP connections ─────────────────────────────────────
//
// Each row pins a specific MCP credential set to this agent. At session
// time, the credentials-resolver checks here BEFORE UserMcpConnection so
// the agent owner's pinned creds always win for that agent's runs.
//
// All writes gated by requireAgentOwnerOrAdmin (same ACL as agent edit).
// GET is gated the same way so we never leak "which MCPs are pinned"
// metadata to non-editors. Decrypted credentials are never returned —
// only { mcpServerId, mcpServerType, mcpServerName, createdByUserId,
// createdAt }. To replace creds, callers POST the full new set; there's
// no partial update.

// Validate an instance slug: lowercase alphanumeric + hyphen, 1-32 chars.
// Used to avoid funny chars leaking into the tool-prefix surface later
// (`<serverType>-<slug>__<tool>`). 'default' is reserved for backfill.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isValidSlug = (s: unknown): s is string =>
  typeof s === "string" && SLUG_RE.test(s);

router.get("/:slug/mcp/connections", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const connections = await prisma.agentMcpConnection.findMany({
      where: { agentId: agent.id },
      include: { mcpServer: { select: { id: true, type: true, name: true } } },
      orderBy: [{ mcpServerId: "asc" }, { createdAt: "asc" }],
    });
    res.json({
      success: true,
      data: connections.map((c) => ({
        id: c.id,
        mcpServerId: c.mcpServerId,
        mcpServerType: c.mcpServer.type,
        mcpServerName: c.mcpServer.name,
        slug: c.slug,
        displayName: c.displayName ?? c.mcpServer.name,
        createdByUserId: c.createdByUserId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    });
  } catch (err) {
    log.error("[agents] list mcp connections error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Create a new agent-MCP instance OR update an existing one in place.
// Identified by (agent, mcpServerType, slug). slug defaults to 'default'
// (same key the backfill migration writes), so old single-instance callers
// that didn't send a slug keep working — they always upsert the same row.
router.post("/:slug/mcp/connections", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const requesterId = getRequesterId(req);
    const { mcpServerType, slug: rawSlug, displayName, credentials } = req.body as {
      mcpServerType?: string;
      slug?: string;
      displayName?: string;
      credentials?: Record<string, unknown>;
    };
    if (!mcpServerType || typeof mcpServerType !== "string") {
      res.status(400).json({ success: false, error: "mcpServerType is required" });
      return;
    }
    if (!credentials || typeof credentials !== "object") {
      res.status(400).json({ success: false, error: "credentials object is required" });
      return;
    }
    const instanceSlug = rawSlug ?? "default";
    if (!isValidSlug(instanceSlug)) {
      res.status(400).json({ success: false, error: "slug must be lowercase alphanumeric + hyphen, 1-32 chars" });
      return;
    }
    const server = await prisma.mcpServer.findUnique({ where: { type: mcpServerType } });
    if (!server) {
      res.status(404).json({ success: false, error: `Unknown mcpServerType: ${mcpServerType}` });
      return;
    }

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
    const cleanDisplayName = typeof displayName === "string" && displayName.trim().length > 0
      ? displayName.trim()
      : null;

    const row = await prisma.agentMcpConnection.upsert({
      where: { agentId_mcpServerId_slug: { agentId: agent.id, mcpServerId: server.id, slug: instanceSlug } },
      create: {
        agentId: agent.id,
        mcpServerId: server.id,
        slug: instanceSlug,
        displayName: cleanDisplayName,
        encryptedCreds: ciphertext,
        iv,
        authTag,
        ...(requesterId ? { createdByUserId: requesterId } : {}),
      },
      update: {
        encryptedCreds: ciphertext,
        iv,
        authTag,
        // Only overwrite displayName when caller explicitly sent one.
        // Stops a creds-only update from blowing away a previously-set label.
        ...(cleanDisplayName !== null ? { displayName: cleanDisplayName } : {}),
      },
    });

    await writeAuditLog({
      ...(requesterId ? { actorUserId: requesterId } : {}),
      eventType: "AGENT_SHARED", // closest existing enum — TODO: add AGENT_MCP_UPDATED
      targetId: agent.id,
      description: `Updated MCP "${mcpServerType}" / instance "${instanceSlug}" on agent "${agent.slug}"`,
    });

    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        mcpServerId: row.mcpServerId,
        mcpServerType: server.type,
        mcpServerName: server.name,
        slug: row.slug,
        displayName: row.displayName ?? server.name,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (err) {
    log.error("[agents] upsert mcp connection error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

router.delete(
  "/:slug/mcp/connections/:mcpServerType/:instanceSlug",
  requireAgentOwnerContributorOrAdmin,
  async (req: Request<{ slug: string; mcpServerType: string; instanceSlug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const { mcpServerType, instanceSlug } = req.params;
      if (!isValidSlug(instanceSlug)) {
        res.status(400).json({ success: false, error: "Invalid instance slug" });
        return;
      }
      const server = await prisma.mcpServer.findUnique({ where: { type: mcpServerType } });
      if (!server) {
        res.status(404).json({ success: false, error: `Unknown mcpServerType: ${mcpServerType}` });
        return;
      }
      await prisma.agentMcpConnection.delete({
        where: { agentId_mcpServerId_slug: { agentId: agent.id, mcpServerId: server.id, slug: instanceSlug } },
      }).catch(() => undefined);

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_UNSHARED", // closest existing enum — TODO: add AGENT_MCP_DELETED
        targetId: agent.id,
        description: `Removed MCP "${mcpServerType}" / instance "${instanceSlug}" from agent "${agent.slug}"`,
      });

      res.json({ success: true });
    } catch (err) {
      log.error("[agents] delete mcp connection error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// Health-check a single agent-pinned MCP instance. Mirrors the global
// connection health route (routes/connections.ts) but loads credentials
// from agentMcpConnection instead of userMcpConnection, so an agent owner
// can see whether a pinned token (e.g. an expired Grafana token) is
// actually reachable. The agent MCP tab previously showed a hardcoded
// "connected" badge that never reflected reality.
//
// The first arg to checkHealth() is used purely as an MCP session-cache
// key. We pass a synthetic `agent:<agentId>:<slug>` id (NEVER a real
// userId) so probing an agent connection cannot evict or rebuild the
// requesting user's own GLOBAL MCP session for the same server type.
router.get(
  "/:slug/mcp/connections/:mcpServerType/:instanceSlug/health",
  requireAgentOwnerContributorOrAdmin,
  async (req: Request<{ slug: string; mcpServerType: string; instanceSlug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const { mcpServerType, instanceSlug } = req.params;
      if (!isValidSlug(instanceSlug)) {
        res.status(400).json({ success: false, error: "Invalid instance slug" });
        return;
      }
      const server = await prisma.mcpServer.findUnique({ where: { type: mcpServerType } });
      if (!server) {
        res.status(404).json({ success: false, error: `Unknown mcpServerType: ${mcpServerType}` });
        return;
      }
      const connection = await prisma.agentMcpConnection.findUnique({
        where: { agentId_mcpServerId_slug: { agentId: agent.id, mcpServerId: server.id, slug: instanceSlug } },
      });
      if (!connection) {
        res.status(404).json({ success: false, error: "Connection not found" });
        return;
      }

      const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
      const credentials = JSON.parse(decrypted) as Record<string, unknown>;

      // Isolated session key - never a real userId (see note above).
      const healthSessionId = `agent:${agent.id}:${instanceSlug}`;

      // Google / Microsoft are OAuth-token connectors, not MCP adapters -
      // check them directly, mirroring the global connection health route.
      if (server.type === "google") {
        const start = Date.now();
        const token = (credentials as { accessToken?: string }).accessToken;
        if (!token) {
          res.json({ success: true, data: { healthy: false, message: "No access token stored", latencyMs: 0 } });
          return;
        }
        try {
          const gRes = await fetch("https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + encodeURIComponent(token));
          const latencyMs = Date.now() - start;
          if (gRes.ok) {
            const info = (await gRes.json()) as { email?: string; expires_in?: number };
            res.json({ success: true, data: { healthy: true, message: `Connected as ${info.email ?? "unknown"} (expires in ${info.expires_in ?? "?"}s)`, latencyMs } });
          } else {
            const refreshToken = (credentials as { refreshToken?: string }).refreshToken;
            res.json({ success: true, data: refreshToken
              ? { healthy: true, message: "Token expired but refresh token available - will auto-refresh on next use", latencyMs }
              : { healthy: false, message: "Token expired and no refresh token", latencyMs } });
          }
        } catch (err) {
          res.json({ success: true, data: { healthy: false, message: err instanceof Error ? err.message : "Health check failed", latencyMs: Date.now() - start } });
        }
        return;
      }

      if (server.type === "microsoft") {
        const start = Date.now();
        const token = (credentials as { accessToken?: string }).accessToken;
        if (!token) {
          res.json({ success: true, data: { healthy: false, message: "No access token stored", latencyMs: 0 } });
          return;
        }
        try {
          const msRes = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${token}` } });
          const latencyMs = Date.now() - start;
          if (msRes.ok) {
            const info = (await msRes.json()) as { displayName?: string; mail?: string };
            res.json({ success: true, data: { healthy: true, message: `Connected as ${info.displayName ?? info.mail ?? "unknown"}`, latencyMs } });
          } else if (msRes.status === 401) {
            const refreshToken = (credentials as { refreshToken?: string }).refreshToken;
            res.json({ success: true, data: refreshToken
              ? { healthy: true, message: "Token expired but refresh token available - will auto-refresh on next use", latencyMs }
              : { healthy: false, message: "Token expired and no refresh token", latencyMs } });
          } else {
            res.json({ success: true, data: { healthy: false, message: `Health check failed (HTTP ${msRes.status})`, latencyMs } });
          }
        } catch (err) {
          res.json({ success: true, data: { healthy: false, message: err instanceof Error ? err.message : "Health check failed", latencyMs: Date.now() - start } });
        }
        return;
      }

      const result = await checkHealth(healthSessionId, server.type, server.name, credentials);
      res.json({ success: true, data: result });
    } catch (err) {
      log.error("[agents] agent mcp health check error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// ── POST /:slug/fork-subagent ────────────────────────────────────────
//
// One-click "fork a subagent for this agent's MCP instance" — primary
// surface for the multi-instance MCP workflow. Lives on the agent route
// (not the subagent route) because the agent's owner is the one who
// knows BOTH which MCP instances they have AND which subagents they want
// to specialize. The caller picks a source subagent and a slug map; we
// copy the source's prompt/tools/skills into a NEW SubagentDefinition
// with `mcpInstanceMap` set, and optionally enable the new subagent on
// this agent in one shot.
//
// Body:
//   {
//     sourceName: string,                           // existing subagent to fork
//     newName: string,                              // new SubagentDefinition.name
//     mcpInstanceMap: Record<string, string>,       // pin map for the new fork
//     enableOnAgent?: boolean = true,               // append to agent.config.tools.subagents
//   }
//
// Note on builtins: forking a builtin is not supported in this slice — we
// don't carry the builtin's tool surface into a custom row cleanly without
// inventing a tool config. Caller should pick a CUSTOM source. Builtin
// forking is a separate v1.5 follow-up.
router.post("/:slug/fork-subagent", requireAgentOwnerContributorOrAdmin, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const agent = req.agentContext!.agent;
    const requesterId = getRequesterId(req);
    const { sourceName, newName, mcpInstanceMap, enableOnAgent } = req.body as {
      sourceName?: string;
      newName?: string;
      mcpInstanceMap?: Record<string, string>;
      enableOnAgent?: boolean;
    };
    if (!sourceName || typeof sourceName !== "string") {
      res.status(400).json({ success: false, error: "sourceName is required" });
      return;
    }
    if (!newName || typeof newName !== "string") {
      res.status(400).json({ success: false, error: "newName is required" });
      return;
    }
    if (sourceName === newName) {
      res.status(400).json({ success: false, error: "newName must differ from sourceName" });
      return;
    }
    if (!mcpInstanceMap || typeof mcpInstanceMap !== "object" || Array.isArray(mcpInstanceMap)) {
      res.status(400).json({ success: false, error: "mcpInstanceMap is required and must be an object" });
      return;
    }

    // 1) Resolve source. Try DB (custom subagents) first, then fall back to
    //    the in-code SUBAGENT_DEFINITIONS (builtins like "sandbox", "spaces",
    //    "bitbucket", etc.). Forking a builtin creates a NEW custom subagent
    //    in the DB seeded from the builtin's prompt + param shape — the
    //    builtin itself stays untouched.
    // `progressLabels` and `tools` are typed `unknown` here because the
    // validator accepts those shapes broadly — Prisma returns JsonValue
    // shapes that don't narrow cleanly to string[] without a runtime guard
    // we already trust the validator to perform.
    type ForkSource = {
      description: string;
      progressLabels: unknown;
      systemPrompt: string;
      paramName: string;
      paramDescription: string;
      tools: unknown;
      skillIds: string[];
    };

    let source: ForkSource | null = null;
    const orgId = getOrgId(req);
    if (!orgId) {
      log.warn(`[agents/fork-subagent] orgId is required requesterId=${requesterId ?? "none"} agentId=${agent.id} agentSlug=${req.params.slug} sourceName=${sourceName} newName=${newName}`);
      res.status(400).json({ success: false, error: "orgId is required" });
      return;
    }

    const customSource = await prisma.subagentDefinition.findUnique({
      where: { orgId_name: { orgId, name: sourceName } },
      include: { skills: { include: { skill: true } } },
    });
    if (customSource) {
      source = {
        description: customSource.description,
        progressLabels: customSource.progressLabels,
        systemPrompt: customSource.systemPrompt,
        paramName: customSource.paramName,
        paramDescription: customSource.paramDescription,
        tools: customSource.tools,
        skillIds: customSource.skills.map((s) => s.skill.id),
      };
    } else {
      // Builtin fallback. Builtin definitions don't carry `tools` or `skills`
      // — the new custom subagent starts with an empty palette and inherits
      // the builtin's MCP server via `mcpInstanceMap` from the request body.
      // Admins can edit the resulting subagent to add tools/skills if needed.
      const builtin = getSubagentDefinition(sourceName);
      if (builtin) {
        source = {
          description: builtin.description,
          progressLabels: builtin.progressLabels,
          systemPrompt: builtin.systemPrompt,
          paramName: builtin.paramName,
          paramDescription: builtin.paramDescription,
          tools: [],
          skillIds: [],
        };
      }
    }

    if (!source) {
      res.status(404).json({
        success: false,
        error: `Source subagent "${sourceName}" not found (neither a custom subagent nor a builtin)`,
      });
      return;
    }

    // 2) Reject duplicate newName up front — friendlier than the unique-key error.
    const collision = await prisma.subagentDefinition.findUnique({
      where: { orgId_name: { orgId, name: newName } },
      select: { id: true },
    });
    if (collision) {
      res.status(409).json({ success: false, error: `A subagent named "${newName}" already exists` });
      return;
    }

    // 3) Validate the rest via the standard validator, reusing the source's
    //    fields. validateSubagentInput catches name shape, mcpInstanceMap
    //    shape, and the source's tools/skills format.
    const validated = await validateSubagentInput(
      prisma,
      {
        name: newName,
        description: source.description,
        progressLabels: source.progressLabels,
        systemPrompt: source.systemPrompt,
        paramName: source.paramName,
        paramDescription: source.paramDescription,
        tools: source.tools,
        skillIds: source.skillIds,
        mcpInstanceMap,
      },
      { isCreate: true, orgId },
    );

    // 4) Create the new SubagentDefinition AND (optionally) enable it on the
    //    agent in one transaction. If the agent update fails, we don't want
    //    to leak an orphan subagent — Postgres rollback keeps both sides
    //    consistent. Read-back of the agent inside the txn so we work off
    //    fresh config in case someone else just edited it.
    const { created, updatedAgent } = await prisma.$transaction(async (tx) => {
      const createdRow = await tx.subagentDefinition.create({
        data: {
          name: validated.name,
          description: validated.description,
          progressLabels: validated.progressLabels,
          systemPrompt: validated.systemPrompt,
          paramName: validated.paramName,
          paramDescription: validated.paramDescription,
          tools: validated.tools as Prisma.InputJsonValue,
          mcpInstanceMap: Object.keys(validated.mcpInstanceMap).length > 0
            ? (validated.mcpInstanceMap as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
          // Phase-2: stamp the creating org (prevents null-org subagent rows).
          org: { connect: { id: orgId } },
          ...(validated.skillIds.length > 0
            ? { skills: { create: validated.skillIds.map((skillId) => ({ skillId })) } }
            : {}),
        },
        include: { skills: { include: { skill: true } } },
      });

      let nextAgent = agent;
      if (enableOnAgent !== false) {
        const fresh = await tx.agent.findUnique({ where: { id: agent.id } });
        const cfg = (fresh?.config as Record<string, unknown> | null) ?? {};
        const tools = (cfg["tools"] as Record<string, unknown> | undefined) ?? {};
        const existingSubagents = Array.isArray(tools["subagents"]) ? (tools["subagents"] as string[]) : [];
        if (!existingSubagents.includes(createdRow.name)) {
          const nextTools = { ...tools, subagents: [...existingSubagents, createdRow.name] };
          const nextConfig = { ...cfg, tools: nextTools };
          nextAgent = await tx.agent.update({
            where: { id: agent.id },
            data: { config: nextConfig as Prisma.InputJsonValue },
          });
        } else if (fresh) {
          nextAgent = fresh;
        }
      }
      return { created: createdRow, updatedAgent: nextAgent };
    });

    await writeAuditLog({
      ...(requesterId ? { actorUserId: requesterId } : {}),
      eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_SUBAGENT_FORKED
      targetId: agent.id,
      description: `Forked subagent "${sourceName}" → "${newName}" on agent "${agent.slug}" with mcpInstanceMap=${JSON.stringify(validated.mcpInstanceMap)}`,
    });

    res.status(201).json({
      success: true,
      data: {
        subagent: {
          id: created.id,
          name: created.name,
          description: created.description,
          systemPrompt: created.systemPrompt,
          paramName: created.paramName,
          paramDescription: created.paramDescription,
          tools: created.tools,
          mcpInstanceMap: created.mcpInstanceMap ?? {},
          createdByUserId: created.createdByUserId,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          skills: created.skills.map((s) => ({
            id: s.skill.id,
            slug: s.skill.slug,
            name: s.skill.name,
          })),
        },
        agent: {
          slug: updatedAgent.slug,
          subagents: ((((updatedAgent.config as Record<string, unknown> | null) ?? {})["tools"] as Record<string, unknown> | undefined)?.["subagents"] as string[] | undefined) ?? [],
        },
      },
    });
  } catch (err) {
    // Surface validation errors as 400, everything else as 500.
    if (err instanceof SubagentValidationError) {
      res.status(400).json({ success: false, error: err.message, field: err.field });
      return;
    }
    log.error("[agents] fork-subagent error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// `decrypt` is exported from crypto and used by other routes; keep the import
// active here even if we don't decrypt in this slice — future "test connection"
// endpoint will need it.
void decrypt;

// ─────────────────────────────────────────────────────────────────────────────
// Agent-scoped OAuth flows (Codex ChatGPT PKCE + GitHub Copilot device code)
//
// Mirror of the user-scoped flows in routes/settings.ts but targets are:
//   - Redis keys are scoped to (agentId, state) instead of (userId, state)
//   - The minted credential bundle lands in agentProviderCredentials, not
//     userProviderCredentials.
//   - Gated by `requireAgentOwnerOrAdmin` — only owner/admin can wire up the
//     team's Codex sub (or Copilot account) to the shared agent slot.
//
// Why duplicate rather than parameterize the existing user-scoped routes:
//   - The user-scoped routes mix request identity (req.headers["x-user-id"])
//     with storage targeting. Threading an "agentSlug" param into them would
//     require both flows to live in one handler with a permission switch,
//     which is harder to audit. Mirroring keeps each handler's permission
//     contract simple: agent-scoped routes go through `requireAgentOwnerOrAdmin`,
//     user-scoped routes go through user-session middleware. No shared mutable
//     state path.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AGENT_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const AGENT_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const AGENT_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const AGENT_CODEX_SCOPE = "openid profile email offline_access";
const AGENT_CODEX_PKCE_PREFIX = "codex-pkce-agent:";
const AGENT_CODEX_PKCE_TTL = 600;

function agentBase64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateAgentCodexPkce(): { verifier: string; challenge: string } {
  const verifier = agentBase64UrlEncode(crypto.randomBytes(32));
  const challenge = agentBase64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

router.post(
  "/:slug/provider-credentials/codex/oauth/start",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const { verifier, challenge } = generateAgentCodexPkce();
      const state = agentBase64UrlEncode(crypto.randomBytes(16));

      const redis = redisService.getConnection();
      await redis.set(`${AGENT_CODEX_PKCE_PREFIX}${agent.id}:${state}`, verifier, "EX", AGENT_CODEX_PKCE_TTL);

      const url = new URL(AGENT_CODEX_AUTHORIZE_URL);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", AGENT_CODEX_CLIENT_ID);
      url.searchParams.set("redirect_uri", AGENT_CODEX_REDIRECT_URI);
      url.searchParams.set("scope", AGENT_CODEX_SCOPE);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("id_token_add_organizations", "true");
      url.searchParams.set("codex_cli_simplified_flow", "true");
      url.searchParams.set("originator", "codex_cli_rs");

      res.json({ success: true, data: { url: url.toString(), state, expiresIn: AGENT_CODEX_PKCE_TTL } });
    } catch (err) {
      log.error("[agents] codex/oauth/start error:", err);
      res.status(500).json({ success: false, error: "Failed to start Codex login" });
    }
  },
);

router.post(
  "/:slug/provider-credentials/codex/oauth/exchange",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      let { code, state } = (req.body ?? {}) as { code?: string; state?: string };

      // Tolerate user pasting the full callback URL instead of bare code.
      const raw = (code ?? "").trim();
      if (raw && (raw.startsWith("http") || raw.includes("code="))) {
        try {
          const u = raw.startsWith("http") ? new URL(raw) : new URL(`http://x?${raw}`);
          code = u.searchParams.get("code") ?? code;
          state = u.searchParams.get("state") ?? state;
        } catch { /* keep original */ }
      }

      if (!code || !state) {
        res.status(400).json({ success: false, error: "code and state are required" });
        return;
      }

      const redis = redisService.getConnection();
      const key = `${AGENT_CODEX_PKCE_PREFIX}${agent.id}:${state}`;
      const verifier = await redis.get(key);
      if (!verifier) {
        res.status(400).json({ success: false, error: "PKCE verifier expired — start login again" });
        return;
      }
      await redis.del(key);

      const tokRes = await fetch(AGENT_CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: AGENT_CODEX_CLIENT_ID,
          code,
          code_verifier: verifier,
          redirect_uri: AGENT_CODEX_REDIRECT_URI,
        }),
      });

      if (!tokRes.ok) {
        const text = await tokRes.text().catch(() => "");
        res.status(502).json({ success: false, error: `OpenAI token exchange failed: ${tokRes.status} ${text.slice(0, 200)}` });
        return;
      }

      const tokens = (await tokRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokens.access_token || !tokens.refresh_token) {
        res.status(502).json({ success: false, error: "OpenAI did not return tokens" });
        return;
      }

      // Store the bundle (access + refresh + expiry) so a future refresh flow
      // can mint new access tokens without re-prompting.
      const bundle = JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 600) * 1000,
      });
      const enc = encrypt(bundle, CONFIG.encryptionKey);

      await agentProviderCredentialsRepository.upsert(agent.id, "codex", {
        encryptedKey: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        authType: "oauth_token",
        baseUrl: "https://api.openai.com/v1",
        ...(requesterId ? { createdByUserId: requesterId } : {}),
      });

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED",
        targetId: agent.id,
        description: `Configured Codex OAuth credentials on agent "${agent.slug}" via ChatGPT sign-in`,
      });

      res.json({ success: true });
    } catch (err) {
      log.error("[agents] codex/oauth/exchange error:", err);
      res.status(500).json({ success: false, error: "Codex login exchange failed" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level Claude (Anthropic) OAuth. Captures the {access_token,
// refresh_token, expires_at} bundle so the access token can be AUTO-REFRESHED
// (see lib/claude-oauth-refresh.ts) — pasting a bare token (the old way) gave us
// no refresh token, so it just expired → 401. Same endpoints/scopes the Claude
// Code CLI uses (via pi-ai). Browser-paste flow like codex: open the URL,
// complete login, paste back the code (or the full redirect URL / "code#state").
// ─────────────────────────────────────────────────────────────────────────────
const AGENT_CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AGENT_CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const AGENT_CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const AGENT_CLAUDE_REDIRECT_URI = "http://localhost:53692/callback";
const AGENT_CLAUDE_SCOPES = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const AGENT_CLAUDE_PKCE_PREFIX = "claude-pkce-agent:";
const AGENT_CLAUDE_PKCE_TTL = 600;

router.post(
  "/:slug/provider-credentials/claude/oauth/start",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const { verifier, challenge } = generateAgentCodexPkce(); // generic S256 PKCE
      // Anthropic's flow uses the verifier as `state` (matches pi-ai's Claude
      // Code flow). Stash it so the exchange can recover the verifier.
      const state = verifier;
      await redisService.getConnection().set(`${AGENT_CLAUDE_PKCE_PREFIX}${agent.id}:${state}`, verifier, "EX", AGENT_CLAUDE_PKCE_TTL);

      const url = new URL(AGENT_CLAUDE_AUTHORIZE_URL);
      url.searchParams.set("code", "true");
      url.searchParams.set("client_id", AGENT_CLAUDE_CLIENT_ID);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", AGENT_CLAUDE_REDIRECT_URI);
      url.searchParams.set("scope", AGENT_CLAUDE_SCOPES);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);

      res.json({ success: true, data: { url: url.toString(), state, expiresIn: AGENT_CLAUDE_PKCE_TTL } });
    } catch (err) {
      log.error("[agents] claude/oauth/start error:", err);
      res.status(500).json({ success: false, error: "Failed to start Claude login" });
    }
  },
);

router.post(
  "/:slug/provider-credentials/claude/oauth/exchange",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      let { code, state } = (req.body ?? {}) as { code?: string; state?: string };

      // Tolerate: full redirect URL, "code#state", or bare code.
      let raw = (code ?? "").trim();
      if (raw.startsWith("http") || raw.includes("code=")) {
        try {
          const u = raw.startsWith("http") ? new URL(raw) : new URL(`http://x?${raw}`);
          code = u.searchParams.get("code") ?? code;
          state = u.searchParams.get("state") ?? state;
          raw = (code ?? "").trim();
        } catch { /* keep original */ }
      }
      if (raw.includes("#")) {
        const [c, s] = raw.split("#", 2);
        code = c;
        if (!state && s) state = s;
      }

      if (!code || !state) {
        res.status(400).json({ success: false, error: "code and state are required" });
        return;
      }

      const redis = redisService.getConnection();
      const key = `${AGENT_CLAUDE_PKCE_PREFIX}${agent.id}:${state}`;
      const verifier = await redis.get(key);
      if (!verifier) {
        res.status(400).json({ success: false, error: "PKCE verifier expired — start login again" });
        return;
      }
      await redis.del(key);

      const tokRes = await fetch(AGENT_CLAUDE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: AGENT_CLAUDE_CLIENT_ID,
          code,
          state,
          redirect_uri: AGENT_CLAUDE_REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      if (!tokRes.ok) {
        const text = await tokRes.text().catch(() => "");
        res.status(502).json({ success: false, error: `Anthropic token exchange failed: ${tokRes.status} ${text.slice(0, 200)}` });
        return;
      }

      const tokens = (await tokRes.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokens.access_token || !tokens.refresh_token) {
        res.status(502).json({ success: false, error: "Anthropic did not return tokens" });
        return;
      }

      const bundle = JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      });
      const enc = encrypt(bundle, CONFIG.encryptionKey);
      await agentProviderCredentialsRepository.upsert(agent.id, "claude", {
        encryptedKey: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        authType: "oauth_token",
        baseUrl: "https://api.anthropic.com",
        ...(requesterId ? { createdByUserId: requesterId } : {}),
      });

      res.json({ success: true, data: { connected: true } });
    } catch (err) {
      log.error("[agents] claude/oauth/exchange error:", err);
      res.status(500).json({ success: false, error: "Claude login exchange failed" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level Codex model list — mirror of `/settings/codex/models` but reads
// the agent-scoped credential. ChatGPT OAuth tokens cannot hit OpenAI's
// `/v1/models` (missing `api.model.read` scope, returns 403); Codex CLI works
// around this by calling the ChatGPT backend's `/codex/models` endpoint with
// `originator=codex_cli_rs`, which IS authorized for ChatGPT tokens and
// returns the exact model picker list (gpt-5.5, gpt-5.4, gpt-5.3-codex, etc.).
// API-key mode uses the standard Platform `/v1/models`.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_CODEX_CHATGPT_BACKEND = "https://chatgpt.com/backend-api";

interface AgentCodexBackendModel {
  slug: string;
  display_name?: string;
  visibility?: string;
  priority?: number;
}

function decodeAgentChatgptAccountId(jwt: string): string | undefined {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[1]) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    const accountId = auth?.["chatgpt_account_id"];
    return typeof accountId === "string" ? accountId : undefined;
  } catch {
    return undefined;
  }
}

router.get(
  "/:slug/provider-credentials/codex/models",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const cred = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, "codex");
      if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
        res.status(400).json({ success: false, error: "Codex is not configured on this agent. Sign in or save an API key first." });
        return;
      }

      const decrypted = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
      const apiKey = extractCodexBearer(decrypted);
      const isOauth = cred.authType === "oauth_token";

      const url = isOauth
        ? `${AGENT_CODEX_CHATGPT_BACKEND}/codex/models?client_version=0.0.0`
        : `${(cred.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;

      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
      if (isOauth) {
        headers["originator"] = "codex_cli_rs";
        headers["User-Agent"] = "codex_cli_rs/0.0.0 (xyne-claw-auth)";
        const accountId = decodeAgentChatgptAccountId(apiKey);
        if (accountId) headers["ChatGPT-Account-Id"] = accountId;
      } else {
        headers["User-Agent"] = "codex-cli";
      }

      await assertSafeOutboundUrl(url);
      const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        res.status(502).json({ success: false, error: `Models endpoint ${upstream.status}: ${text.slice(0, 200)}` });
        return;
      }

      if (isOauth) {
        const body = (await upstream.json()) as { models?: AgentCodexBackendModel[] };
        const data = body.models ?? [];
        const models = data
          .filter((m) => m.slug)
          .filter((m) => m.visibility !== "hide" && m.visibility !== "none")
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
          .map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
        res.json({ success: true, data: models });
        return;
      }

      const body = (await upstream.json()) as { data?: Array<{ id?: string }> };
      const models = (body.data ?? [])
        .filter((m): m is { id: string } => Boolean(m.id))
        .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }));
      res.json({ success: true, data: models });
    } catch (err) {
      log.error("[agents] codex/models error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to fetch models" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level LiteLLM model list — lists the models the owner's LiteLLM key can
// access on the proxy. Unlike Codex/Claude (GET) this is a POST so the add-
// credential form can populate the model dropdown for a JUST-TYPED key BEFORE
// the credential is saved. With no `apiKey` in the body we fall back to
// decrypting the saved `litellm` cred. Models come from the proxy's OpenAI-
// compatible `/v1/models`, which LiteLLM scopes to the key's allowed models —
// so the dropdown already reflects exactly what this key may use. Base URL
// precedence: body → saved cred → platform default (CONFIG.litellmBaseUrl).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:slug/provider-credentials/litellm/models",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const body = (req.body ?? {}) as { apiKey?: string; baseUrl?: string };
      const typedKey = (body.apiKey ?? "").trim();

      let apiKey = typedKey;
      let baseUrl = (body.baseUrl ?? "").trim();
      if (!apiKey) {
        // No key in the body → list against the already-saved credential.
        const cred = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, "litellm");
        if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
          res.status(400).json({ success: false, error: "LiteLLM is not configured on this agent. Enter an API key first." });
          return;
        }
        apiKey = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
        if (!baseUrl) baseUrl = cred.baseUrl ?? "";
      }

      const root = (baseUrl || CONFIG.litellmBaseUrl).replace(/\/+$/, "");
      log.info(`[agents] litellm/models fetching ${root}/v1/models (keyLen=${apiKey.length}, source=${typedKey ? "typed" : "saved-cred"})`);
      await assertSafeOutboundUrl(`${root}/v1/models`);
      const upstream = await fetch(`${root}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "xyne-claw-auth" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        log.warn(`[agents] litellm/models upstream ${upstream.status} at ${root}/v1/models: ${text.slice(0, 200)}`);
        res.status(502).json({ success: false, error: `Models endpoint ${upstream.status}: ${text.slice(0, 200)}` });
        return;
      }

      const payload = (await upstream.json()) as { data?: Array<{ id?: string }> };
      const models = (payload.data ?? [])
        .filter((m): m is { id: string } => Boolean(m.id))
        .map((m) => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ success: true, data: models });
    } catch (err) {
      log.error("[agents] litellm/models error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Failed to fetch models" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent-level provider credentials
//
// Shared API keys (Codex sub, team Anthropic key, OpenRouter, etc.) configured
// at the AGENT level. Used as the fallback when a user runs the agent without
// their own personal provider in Settings → Providers.
//
// Permission model:
//   - Write (POST/PATCH/DELETE) → AGENT_OWNER or admin (requireAgentOwnerOrAdmin)
//   - Read status (GET — never the decrypted key) → OWNER / CONTRIBUTOR / admin
//     (requireAgentOwnerContributorOrAdmin)
//   - The decrypted apiKey is NEVER returned by any endpoint; it is only ever
//     decrypted in-process at dispatch time (webhook.ts / agent-chat.ts) and
//     forwarded to xyne-claw inside the /run payload.
//
// Resolution precedence at session dispatch (see webhook.ts ≈ line 962):
//   1. user's personal provider (userAgentConfig + userProviderCredentials)
//   2. agent-level provider (agent.config.provider + THIS TABLE)
//   3. "spaces" / LiteLLM platform default
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_PROVIDERS = new Set(["copilot", "claude", "codex", "openrouter", "litellm"]);

router.get(
  "/:slug/provider-credentials",
  requireAgentOwnerContributorOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const rows = await agentProviderCredentialsRepository.listByAgent(agent.id);
      // Shared-credential display names (materialized rows only carry the id).
      const sharedIds = [...new Set(rows.map((r) => r.sharedCredentialId).filter((id): id is string => !!id))];
      const sharedNames = sharedIds.length
        ? new Map(
            (await prisma.sharedProviderCredential.findMany({
              where: { id: { in: sharedIds } },
              select: { id: true, name: true },
            })).map((s) => [s.id, s.name]),
          )
        : new Map<string, string>();
      // Return STATUS only — provider/model/baseUrl/authType + metadata.
      // Never echo encryptedKey, iv, or authTag.
      res.json({
        success: true,
        data: {
          providers: rows.map((r) => ({
            provider: r.provider,
            model: r.model ?? null,
            baseUrl: r.baseUrl ?? null,
            authType: r.authType ?? null,
            reasoningEffort: r.reasoningEffort ?? null,
            configured: Boolean(r.encryptedKey && r.iv && r.authTag),
            createdByUserId: r.createdByUserId ?? null,
            sharedCredentialId: r.sharedCredentialId ?? null,
            sharedCredentialName: r.sharedCredentialId ? (sharedNames.get(r.sharedCredentialId) ?? null) : null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          })),
        },
      });
    } catch (err) {
      log.error("[agents] list provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// POST /:slug/provider-credentials/:provider/share — promote THIS agent's
// credential into an org-level SharedProviderCredential and bind the given
// agents to it. One stored OAuth session shared by every bound agent — the
// fix for per-agent token copies of one ChatGPT account invalidating each
// other on every re-auth. Re-calling on an already-shared credential just
// binds the additional agents. Target agents must be owned by the requester
// (or requester is CLAW_ADMIN).
router.post(
  "/:slug/provider-credentials/:provider/share",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; provider: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req)!;
      const provider = req.params.provider;
      if (!ALLOWED_PROVIDERS.has(provider)) {
        res.status(400).json({ success: false, error: `provider must be one of: ${[...ALLOWED_PROVIDERS].join(", ")}` });
        return;
      }
      const { name, agentIds, platform } = req.body as { name?: string; agentIds?: string[]; platform?: boolean };
      const targetAgentIds = Array.isArray(agentIds)
        ? agentIds.filter((a): a is string => typeof a === "string" && !!a.trim() && a !== agent.id)
        : [];
      if (targetAgentIds.length === 0) {
        res.status(400).json({ success: false, error: "agentIds (non-empty array of other agents) is required" });
        return;
      }
      const admin = await isClawAdmin(requesterId);
      if (platform && !admin) {
        res.status(403).json({ success: false, error: "Only CLAW_ADMIN can create platform-wide (cross-org) shared credentials" });
        return;
      }

      // RAW row (not materialized) — sharing an existing binding reuses its
      // shared credential instead of duplicating the bundle.
      const raw = await prisma.agentProviderCredentials.findUnique({
        where: { agentId_provider: { agentId: agent.id, provider } },
      });
      if (!raw) {
        res.status(404).json({ success: false, error: `Agent has no ${provider} credential to share — connect it first` });
        return;
      }

      let sharedId = raw.sharedCredentialId;
      if (!sharedId) {
        if (!raw.encryptedKey) {
          res.status(400).json({ success: false, error: `Agent's ${provider} credential has no key material — reconnect it first` });
          return;
        }
        const shared = await sharedProviderCredentialRepository.create({
          // platform:true (admin-only, checked above) → orgId NULL: bindable
          // by agents of ANY org — e.g. one Codex account for Juspay + NY.
          orgId: platform ? null : agent.orgId,
          provider,
          name: name?.trim() || `${provider} (shared from ${agent.slug})`,
          encryptedKey: raw.encryptedKey,
          iv: raw.iv,
          authTag: raw.authTag,
          model: raw.model,
          baseUrl: raw.baseUrl,
          authType: raw.authType,
          reasoningEffort: raw.reasoningEffort,
          ownerUserId: requesterId,
        });
        sharedId = shared.id;
        // Convert the source agent's row into a binding (keeping its model/
        // effort as overrides) so no dedicated copy of the session survives.
        await agentProviderCredentialsRepository.bindShared(agent.id, provider, sharedId, {
          model: raw.model,
          reasoningEffort: raw.reasoningEffort,
        });
        await writeAuditLog({
          actorUserId: requesterId,
          eventType: "PROVIDER_CREDENTIAL_PROMOTED",
          targetId: sharedId,
          description: `Promoted ${provider} credential from agent ${agent.slug} to shared "${name?.trim() || `${provider} (shared from ${agent.slug})`}"`,
        });
      }

      // Scope check depends on the SHARED credential (it may be a reused
      // platform-wide one), not the source agent's org.
      const sharedRow = await sharedProviderCredentialRepository.findById(sharedId);
      const sharedOrgId = sharedRow?.orgId ?? null;

      const results: Array<{ agentId: string; slug?: string; ok: boolean; error?: string }> = [];
      for (const targetId of targetAgentIds) {
        const target = await prisma.agent.findUnique({
          where: { id: targetId },
          select: { id: true, slug: true, orgId: true, ownerUserId: true },
        });
        // Platform-wide (orgId NULL) creds bind across orgs; org-scoped creds
        // only within their org.
        if (!target || (sharedOrgId !== null && target.orgId !== sharedOrgId)) {
          results.push({ agentId: targetId, ok: false, error: "Agent not found in the credential's org" });
          continue;
        }
        if (target.ownerUserId !== requesterId && !admin) {
          results.push({ agentId: targetId, slug: target.slug, ok: false, error: "You don't own this agent" });
          continue;
        }
        await agentProviderCredentialsRepository.bindShared(target.id, provider, sharedId);
        await writeAuditLog({
          actorUserId: requesterId,
          eventType: "PROVIDER_CREDENTIAL_BOUND",
          targetId: sharedId,
          description: `Bound agent ${target.slug} to shared ${provider} credential`,
        });
        results.push({ agentId: targetId, slug: target.slug, ok: true });
      }

      res.json({ success: true, data: { sharedCredentialId: sharedId, results } });
    } catch (err) {
      log.error("[agents] share provider-credential error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/:slug/provider-credentials",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const body = req.body as {
        provider?: string;
        apiKey?: string;
        model?: string;
        baseUrl?: string;
        authType?: string;
        reasoningEffort?: string | null;
      };

      const provider = (body.provider ?? "").trim();
      const apiKey = (body.apiKey ?? "").trim();
      const model = (body.model ?? "").trim() || null;
      const baseUrl = (body.baseUrl ?? "").trim() || null;
      const authType = (body.authType ?? "").trim() || null;
      const rawEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim() : body.reasoningEffort;
      let reasoningEffort: string | null;
      if (rawEffort === undefined || rawEffort === null || rawEffort === "") {
        reasoningEffort = null;
      } else if (rawEffort !== "low" && rawEffort !== "medium" && rawEffort !== "high") {
        res.status(400).json({ success: false, error: "reasoningEffort must be 'low', 'medium', or 'high'" });
        return;
      } else {
        reasoningEffort = rawEffort;
      }

      if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
        res.status(400).json({
          success: false,
          error: `provider must be one of: ${[...ALLOWED_PROVIDERS].join(", ")}`,
        });
        return;
      }
      if (authType && authType !== "api_key" && authType !== "oauth_token") {
        res.status(400).json({ success: false, error: "authType must be 'api_key' or 'oauth_token'" });
        return;
      }

      const existing = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, provider);

      // Allow model-only / baseUrl-only updates when the credential already
      // exists (no apiKey supplied). The OAuth flow saves the bundle first
      // with no model, then the UI calls back with the chosen model from the
      // dropdown — we must not require apiKey for that follow-up update.
      if (!apiKey && !existing) {
        res.status(400).json({ success: false, error: "apiKey is required for the first save" });
        return;
      }

      if (apiKey) {
        const { ciphertext, iv, authTag } = encrypt(apiKey, CONFIG.encryptionKey);
        await agentProviderCredentialsRepository.upsert(agent.id, provider, {
          encryptedKey: ciphertext,
          iv,
          authTag,
          model,
          baseUrl,
          authType,
          reasoningEffort,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
        });
      } else {
        // Update metadata only — preserve the existing encrypted bundle, iv,
        // authTag, and (where unspecified) authType. Useful for: pick model
        // from dropdown after OAuth, rename baseUrl, etc.
        await agentProviderCredentialsRepository.upsert(agent.id, provider, {
          encryptedKey: existing!.encryptedKey,
          iv: existing!.iv,
          authTag: existing!.authTag,
          model,
          baseUrl: baseUrl ?? existing!.baseUrl,
          authType: authType ?? existing!.authType,
          reasoningEffort: rawEffort === undefined ? existing!.reasoningEffort : reasoningEffort,
          ...(requesterId ? { createdByUserId: requesterId } : {}),
        });
      }

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_PROVIDER_CRED_SET
        targetId: agent.id,
        description: `${existing ? "Updated" : "Set"} ${provider} provider credentials on agent "${agent.slug}" (model=${model ?? "default"}, authType=${authType ?? "api_key"})`,
      });

      res.status(existing ? 200 : 201).json({
        success: true,
        data: {
          provider,
          model,
          baseUrl,
          authType,
          reasoningEffort: rawEffort === undefined ? existing?.reasoningEffort ?? null : reasoningEffort,
          configured: true,
        },
      });
    } catch (err) {
      log.error("[agents] set provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

router.delete(
  "/:slug/provider-credentials/:provider",
  requireAgentOwnerOrAdmin,
  async (req: Request<{ slug: string; provider: string }>, res: Response) => {
    try {
      const agent = req.agentContext!.agent;
      const requesterId = getRequesterId(req);
      const provider = req.params.provider;

      if (!ALLOWED_PROVIDERS.has(provider)) {
        res.status(400).json({ success: false, error: "invalid provider" });
        return;
      }

      try {
        await agentProviderCredentialsRepository.delete(agent.id, provider);
      } catch (err) {
        // Prisma throws P2025 when the row doesn't exist — treat as idempotent 404.
        const code = (err as { code?: string } | undefined)?.code;
        if (code === "P2025") {
          res.status(404).json({ success: false, error: "no credentials configured for that provider" });
          return;
        }
        throw err;
      }

      await writeAuditLog({
        ...(requesterId ? { actorUserId: requesterId } : {}),
        eventType: "AGENT_SHARED", // closest existing enum — TODO: AGENT_PROVIDER_CRED_DELETED
        targetId: agent.id,
        description: `Deleted ${provider} provider credentials from agent "${agent.slug}"`,
      });

      res.json({ success: true });
    } catch (err) {
      log.error("[agents] delete provider-credentials error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

export { router as agentsRouter };
