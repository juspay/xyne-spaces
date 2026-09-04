import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, unauthorized, forbidden, notFound, HttpError } from "../lib/http.js";
import {
  userProviderCredentialsRepository,
  userSubagentConfigRepository,
  sharedProviderCredentialRepository,
  agentProviderCredentialsRepository,
} from "../repositories/index.js";
import { getRequesterId, isClawAdmin , requireRequester} from "../middleware/agent-acl.js";
import { prisma } from "../db.js";
import { writeAuditLog } from "../lib/audit.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { redisService } from "../redis.js";
import { fetchAnthropicModels } from "./agents.js";
import { createLogger } from "../logger.js";

const log = createLogger("settings");

const router = Router();

const VALID_PROVIDERS = new Set(["spaces", "copilot", "claude", "codex", "litellm"]);

const GITHUB_CLIENT_ID = "Ov23li8tweQw6odWQebz";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEVICE_CODE_PREFIX = "gh-device-user:";
const DEVICE_CODE_TTL = 900;

// GET /settings/provider-credentials — list user's credentials (without raw keys)
router.get("/provider-credentials", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const rows = await userProviderCredentialsRepository.listByUser(userId);
  const data = rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    baseUrl: r.baseUrl,
    authType: r.authType,
    reasoningEffort: r.reasoningEffort,
    hasApiKey: Boolean(r.encryptedKey),
  }));
  ok(res, data);
}));

// PUT /settings/provider-credentials/:provider — upsert credentials for a provider
router.put("/provider-credentials/:provider", asyncHandler(async (req: Request<{ provider: string }>, res: Response) => {
  const userId = requireRequester(req);
  const { provider } = req.params;
  if (!VALID_PROVIDERS.has(provider)) {
    throw badRequest(`provider must be one of ${[...VALID_PROVIDERS].join(", ")}`);
  }
  const { apiKey, model, baseUrl, authType, reasoningEffort } = req.body as {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    authType?: string;
    reasoningEffort?: string | null;
  };

  const data: Record<string, unknown> = {};
  if (model !== undefined) data.model = model || null;
  if (baseUrl !== undefined) data.baseUrl = baseUrl || null;
  if (authType !== undefined) {
    if (authType !== "api_key" && authType !== "oauth_token") {
      throw badRequest("authType must be 'api_key' or 'oauth_token'");
    }
    // Claude + Codex OAuth were removed (vendor subscription tokens must not
    // be stored on a third-party server) — only API keys are accepted.
    if (authType === "oauth_token" && (provider === "claude" || provider === "codex")) {
      throw badRequest(`${provider} supports API keys only (oauth_token not allowed)`);
    }
    data.authType = authType;
  }
  if (reasoningEffort !== undefined) {
    // Empty string / null clears the override; otherwise must be a valid level.
    if (reasoningEffort === null || reasoningEffort === "") {
      data.reasoningEffort = null;
    } else if (reasoningEffort !== "low" && reasoningEffort !== "medium" && reasoningEffort !== "high") {
      throw badRequest("reasoningEffort must be 'low', 'medium', or 'high'");
    } else {
      data.reasoningEffort = reasoningEffort;
    }
  }

  if (apiKey) {
    const encrypted = encrypt(apiKey, CONFIG.encryptionKey);
    data.encryptedKey = encrypted.ciphertext;
    data.iv = encrypted.iv;
    data.authTag = encrypted.authTag;
  }

  const row = await userProviderCredentialsRepository.upsert(userId, provider, data);
  ok(res, {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    authType: row.authType,
    reasoningEffort: row.reasoningEffort,
    hasApiKey: Boolean(row.encryptedKey),
  });
}));

// DELETE /settings/provider-credentials/:provider
router.delete("/provider-credentials/:provider", asyncHandler(async (req: Request<{ provider: string }>, res: Response) => {
  const userId = requireRequester(req);
  await userProviderCredentialsRepository.delete(userId, req.params.provider);
  ok(res);
}));

// POST /settings/provider-credentials/:provider/share — "connect once, share
// to agents": promote the requester's PERSONAL credential into an org-level
// SharedProviderCredential and bind the given agents to it. The personal row
// becomes a binding too (NOT a sibling copy — two live copies of one OAuth
// account invalidate each other's sessions; see SharedProviderCredential).
// Re-calling with more agentIds reuses the existing shared credential.
// Agents must belong to the requester (or requester is CLAW_ADMIN).
router.post("/provider-credentials/:provider/share", asyncHandler(async (req: Request<{ provider: string }>, res: Response) => {
  const userId = requireRequester(req);
  const provider = req.params.provider;
  if (!VALID_PROVIDERS.has(provider) || provider === "spaces") {
    throw badRequest("Provider cannot be shared");
  }
  const { name, agentIds, platform } = req.body as { name?: string; agentIds?: string[]; platform?: boolean };
  const targetAgentIds = Array.isArray(agentIds) ? agentIds.filter((a): a is string => typeof a === "string" && !!a.trim()) : [];
  if (targetAgentIds.length === 0) {
    throw badRequest("agentIds (non-empty array) is required");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (!user?.orgId) throw badRequest("No org context");
  const admin = await isClawAdmin(userId);
  if (platform && !admin) {
    throw forbidden("Only CLAW_ADMIN can create platform-wide (cross-org) shared credentials");
  }

  // RAW row (not materialized): sharing a binding just reuses its shared cred.
  const raw = await prisma.userProviderCredentials.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!raw) {
    throw notFound(`Connect ${provider} in your settings first`);
  }

  let sharedId = raw.sharedCredentialId;
  if (!sharedId) {
    if (!raw.encryptedKey) {
      throw badRequest(`Your ${provider} credential has no key material — reconnect it first`);
    }
    const shared = await sharedProviderCredentialRepository.create({
      // platform:true (admin-only, checked above) → orgId NULL: bindable
      // by agents of ANY org.
      orgId: platform ? null : user.orgId,
      provider,
      name: name?.trim() || `${provider} (shared)`,
      encryptedKey: raw.encryptedKey,
      iv: raw.iv,
      authTag: raw.authTag,
      model: raw.model,
      baseUrl: raw.baseUrl,
      authType: raw.authType,
      reasoningEffort: raw.reasoningEffort,
      ownerUserId: userId,
    });
    sharedId = shared.id;
    // Convert the personal row into a binding, keeping the user's model/
    // effort choices as personal overrides.
    await userProviderCredentialsRepository.bindShared(userId, provider, sharedId, {
      model: raw.model,
      reasoningEffort: raw.reasoningEffort,
    });
    await writeAuditLog({
      actorUserId: userId,
      eventType: "PROVIDER_CREDENTIAL_PROMOTED",
      targetId: sharedId,
      description: `Promoted personal ${provider} credential to shared "${name?.trim() || `${provider} (shared)`}"`,
    });
  }

  // Scope check depends on the SHARED credential (may be a reused
  // platform-wide one), not the requester's org.
  const sharedRow = await sharedProviderCredentialRepository.findById(sharedId);
  const sharedOrgId = sharedRow?.orgId ?? null;

  const results: Array<{ agentId: string; ok: boolean; error?: string }> = [];
  for (const agentId of targetAgentIds) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, slug: true, orgId: true, ownerUserId: true },
    });
    // Platform-wide (orgId NULL) creds bind across orgs.
    if (!agent || (sharedOrgId !== null && agent.orgId !== sharedOrgId)) {
      results.push({ agentId, ok: false, error: "Agent not found in the credential's org" });
      continue;
    }
    if (agent.ownerUserId !== userId && !admin) {
      results.push({ agentId, ok: false, error: "You don't own this agent" });
      continue;
    }
    await agentProviderCredentialsRepository.bindShared(agent.id, provider, sharedId);
    await writeAuditLog({
      actorUserId: userId,
      eventType: "PROVIDER_CREDENTIAL_BOUND",
      targetId: sharedId,
      description: `Bound agent ${agent.slug} to shared ${provider} credential`,
    });
    results.push({ agentId, ok: true });
  }

  ok(res, { sharedCredentialId: sharedId, results });
}));

// GET /settings/subagent-routing — list user's per-subagent provider preferences
router.get("/subagent-routing", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const rows = await userSubagentConfigRepository.listByUser(userId);
  const data = rows.map((r) => ({ subagentName: r.subagentName, provider: r.provider }));
  ok(res, data);
}));

// PUT /settings/subagent-routing/:subagentName — set provider for a subagent
router.put("/subagent-routing/:subagentName", asyncHandler(async (req: Request<{ subagentName: string }>, res: Response) => {
  const userId = requireRequester(req);
  const { provider } = req.body as { provider?: string };
  if (!provider || !VALID_PROVIDERS.has(provider)) {
    throw badRequest(`provider must be one of ${[...VALID_PROVIDERS].join(", ")}`);
  }
  const row = await userSubagentConfigRepository.upsert(userId, req.params.subagentName, provider);
  ok(res, { subagentName: row.subagentName, provider: row.provider });
}));

// DELETE /settings/subagent-routing/:subagentName — clear override (falls back to parent agent provider)
router.delete("/subagent-routing/:subagentName", asyncHandler(async (req: Request<{ subagentName: string }>, res: Response) => {
  const userId = requireRequester(req);
  await userSubagentConfigRepository.delete(userId, req.params.subagentName);
  ok(res);
}));

// ── GitHub Copilot device-code login (user-level) ──────────────────

router.post("/copilot/github-login", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const ghRes = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
  });
  if (!ghRes.ok) {
    const text = await ghRes.text().catch(() => "");
    throw new HttpError(502, `GitHub error: ${text.slice(0, 200)}`);
  }
  const data = await ghRes.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  const key = `${DEVICE_CODE_PREFIX}${userId}`;
  const redis = redisService.getConnection();
  await redis.set(key, JSON.stringify({ device_code: data.device_code, interval: data.interval }), "EX", DEVICE_CODE_TTL);
  ok(res, {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  });
}));

router.post("/copilot/github-poll", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const key = `${DEVICE_CODE_PREFIX}${userId}`;
  const redis = redisService.getConnection();
  const raw = await redis.get(key);
  if (!raw) throw badRequest("No pending login — start again");
  const { device_code } = JSON.parse(raw) as { device_code: string };

  const ghRes = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const data = await ghRes.json() as { access_token?: string; error?: string; error_description?: string };

  if (data.access_token) {
    const encrypted = encrypt(data.access_token, CONFIG.encryptionKey);
    await userProviderCredentialsRepository.upsert(userId, "copilot", {
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      model: "gpt-4o",
      baseUrl: "https://api.githubcopilot.com",
    });
    await redis.del(key);
    ok(res, { status: "approved" });
    return;
  }
  if (data.error === "authorization_pending") {
    ok(res, { status: "pending" });
    return;
  }
  if (data.error === "slow_down") {
    ok(res, { status: "slow_down" });
    return;
  }
  await redis.del(key);
  throw new HttpError(400, data.error_description ?? data.error ?? "Authorization failed");
}));

// ── Model catalog fetchers (live, keyed on user's stored credentials) ─

interface CopilotModel { id: string; name: string }

router.get("/copilot/models", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, "copilot");
  if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
    throw badRequest("Copilot is not configured. Log in with GitHub first.");
  }
  const githubToken = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);

  // Mirror opencode's CopilotAuthPlugin: use the GitHub OAuth token directly
  // as Bearer for api.githubcopilot.com. GitHub's edge handles session-scoped
  // token derivation server-side. No client-side /copilot_internal/v2/token
  // exchange is needed (and that endpoint 404s for our OAuth scope anyway).
  const modelsRes = await fetch("https://api.githubcopilot.com/models", {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "User-Agent": "opencode/0.3.118",
      "Openai-Intent": "conversation-edits",
      "Editor-Version": "vscode/1.95.0",
      "Copilot-Integration-Id": "vscode-chat",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!modelsRes.ok) {
    const text = await modelsRes.text().catch(() => "");
    throw new HttpError(502, `Copilot /models failed: ${modelsRes.status} ${text.slice(0, 200)}`);
  }
  const body = (await modelsRes.json()) as {
    data?: Array<{ id?: string; name?: string; model_picker_enabled?: boolean; capabilities?: { type?: string } }>;
  };
  const models: CopilotModel[] = (body.data ?? [])
    .filter((m) => m.id && m.capabilities?.type === "chat" && m.model_picker_enabled !== false)
    .map((m) => ({ id: m.id as string, name: m.name ?? m.id as string }));
  ok(res, models);
}));

router.get("/claude/models", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, "claude");
  if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
    throw badRequest("Claude is not configured. Save an API key first.");
  }
  try {
    const decrypted = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
    // Claude creds are API-key-only (OAuth sign-in + pasted setup-tokens were
    // removed — storing subscription OAuth tokens here is not permitted).
    const apiKey = decrypted.trim();
    const models = await fetchAnthropicModels(apiKey, cred.baseUrl ?? undefined);
    ok(res, models);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Failed to fetch Claude models");
  }
}));

router.get("/codex/models", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, "codex");
  if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
    throw badRequest("OpenAI is not configured. Save an API key first.");
  }

  const apiKey = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey).trim();

  // API keys only (ChatGPT OAuth removed) → standard Platform /v1/models.
  const url = `${(cred.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": "codex-cli",
  };

  const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new HttpError(502, `Models endpoint ${upstream.status}: ${text.slice(0, 200)}`);
  }

  // Platform /v1/models returns { data: [{ id }] } — filter to chat-capable families.
  const body = (await upstream.json()) as { data?: Array<{ id?: string }> };
  const models = (body.data ?? [])
    .filter((m): m is { id: string } => Boolean(m.id))
    .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id))
    .map((m) => ({ id: m.id, name: m.id }));
  ok(res, models);
}));


// POST /settings/provider-credentials/litellm/models — list models for a just-typed
// or saved personal LiteLLM/Grid key. Mirrors the agent-scoped endpoint so the
// user settings screen can show exactly the models this key is allowed to call
// before the credential is saved. Never returns or logs the raw key.
router.post("/provider-credentials/litellm/models", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const body = (req.body ?? {}) as { apiKey?: string; baseUrl?: string };
  const typedKey = (body.apiKey ?? "").trim();

  let apiKey = typedKey;
  let baseUrl = (body.baseUrl ?? "").trim();
  if (!apiKey) {
    const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, "litellm");
    if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
      throw badRequest("LiteLLM is not configured. Enter an API key first.");
    }
    apiKey = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
    if (!baseUrl) baseUrl = cred.baseUrl ?? "";
  }

  const root = (baseUrl || CONFIG.litellmBaseUrl).replace(/\/+$/, "");
  log.info(`[settings] litellm/models fetching ${root}/v1/models (keyLen=${apiKey.length}, source=${typedKey ? "typed" : "saved-cred"})`);
  const upstream = await fetch(`${root}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "xyne-claw-auth" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    log.warn(`[settings] litellm/models upstream ${upstream.status} at ${root}/v1/models: ${text.slice(0, 200)}`);
    throw new HttpError(502, `Models endpoint ${upstream.status}: ${text.slice(0, 200)}`);
  }

  const payload = (await upstream.json()) as { data?: Array<{ id?: string }> };
  const models = (payload.data ?? [])
    .filter((m): m is { id: string } => Boolean(m.id))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  ok(res, models);
}));


export const settingsRouter = router;
