import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
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
import { extractClaudeBearer } from "../lib/claude-creds.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { CONFIG, CLAUDE_OAUTH, claudeOAuthConfigured } from "../config.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { redisService } from "../redis.js";
import { fetchAnthropicModels } from "./agents.js";
import { createLogger } from "../logger.js";

const log = createLogger("settings");

const router = Router();

const VALID_PROVIDERS = new Set(["spaces", "copilot", "claude", "codex", "openrouter", "litellm"]);

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

// ── OpenAI Codex (ChatGPT) browser OAuth — PKCE ───────────────────────
// Uses the same public client_id as the OpenAI Codex CLI. OpenAI only whitelists
// `http://localhost:1455/auth/callback` for that client; we never actually serve
// that callback — instead `codex_cli_simplified_flow=true` makes OpenAI render
// the code on the redirect page so the user pastes it back into our UI.

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const CODEX_SCOPE = "openid profile email offline_access";
const CODEX_PKCE_PREFIX = "codex-pkce:";
const CODEX_PKCE_TTL = 600; // 10 min — user must finish OAuth in this window

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodexPkce(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}


router.post("/codex/oauth/start", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);

  const { verifier, challenge } = generateCodexPkce();
  const state = base64UrlEncode(crypto.randomBytes(16));

  const redis = redisService.getConnection();
  await redis.set(`${CODEX_PKCE_PREFIX}${userId}:${state}`, verifier, "EX", CODEX_PKCE_TTL);

  const url = new URL(CODEX_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", CODEX_REDIRECT_URI);
  url.searchParams.set("scope", CODEX_SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");

  ok(res, { url: url.toString(), state, expiresIn: CODEX_PKCE_TTL });
}));

router.post("/codex/oauth/exchange", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);

  let { code, state } = (req.body ?? {}) as { code?: string; state?: string };

  // Tolerate user pasting the full callback URL (?code=...&state=...) instead of a bare code.
  const raw = (code ?? "").trim();
  if (raw && (raw.startsWith("http") || raw.includes("code="))) {
    try {
      const u = raw.startsWith("http") ? new URL(raw) : new URL(`http://x?${raw}`);
      code = u.searchParams.get("code") ?? code;
      state = u.searchParams.get("state") ?? state;
    } catch { /* keep original */ }
  }

  if (!code || !state) throw badRequest("code and state are required");

  const redis = redisService.getConnection();
  const key = `${CODEX_PKCE_PREFIX}${userId}:${state}`;
  const verifier = await redis.get(key);
  if (!verifier) throw badRequest("PKCE verifier expired — start login again");
  await redis.del(key);

  const tokRes = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: CODEX_REDIRECT_URI,
    }),
  });

  if (!tokRes.ok) {
    const text = await tokRes.text().catch(() => "");
    throw new HttpError(502, `OpenAI token exchange failed: ${tokRes.status} ${text.slice(0, 200)}`);
  }

  const tokens = await tokRes.json() as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new HttpError(502, "OpenAI did not return tokens");
  }

  // Stash the bundle (access + refresh + expiry) as the encrypted payload so the
  // refresh flow can later mint new access tokens. Existing refreshAccessToken
  // logic (when added) will read this JSON, refresh, and rewrite it.
  const bundle = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 600) * 1000,
  });
  const enc = encrypt(bundle, CONFIG.encryptionKey);

  await userProviderCredentialsRepository.upsert(userId, "codex", {
    encryptedKey: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    authType: "oauth_token",
    baseUrl: "https://api.openai.com/v1",
    // Don't overwrite an existing model preference if one exists.
  });

  ok(res);
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
    const apiKey = extractClaudeBearer(decrypted);
    const models = await fetchAnthropicModels(apiKey, cred.baseUrl ?? undefined, cred.authType ?? undefined);
    ok(res, models);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Failed to fetch Claude models");
  }
}));

// ChatGPT OAuth tokens lack the Platform's `api.model.read` scope, so OpenAI's
// own /v1/models endpoint 403s. The Codex CLI works around this by hitting the
// ChatGPT backend's /models endpoint instead (https://chatgpt.com/backend-api/models),
// which IS authorized for ChatGPT tokens and returns the same authoritative list the
// CLI shows in its picker. Source: openai/codex codex-rs/backend-client/src/client.rs +
// codex-rs/login/src/auth/agent_identity.rs (DEFAULT_CHATGPT_BACKEND_BASE_URL).
const CODEX_CHATGPT_BACKEND = "https://chatgpt.com/backend-api";

interface CodexBackendModel {
  slug: string;
  display_name?: string;
  description?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
  visibility?: string;
  supported_in_api?: boolean;
  priority?: number;
}

router.get("/codex/models", asyncHandler(async (req: Request, res: Response) => {
  const userId = requireRequester(req);
  const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, "codex");
  if (!cred?.encryptedKey || !cred.iv || !cred.authTag) {
    throw badRequest("OpenAI is not configured. Save an API key first.");
  }

  const decrypted = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
  const apiKey = extractCodexBearer(decrypted);

  // OAuth-mode → ChatGPT backend Codex endpoint (the same path the CLI hits:
  // /backend-api/codex/models, with originator=codex_cli_rs). Platform's /v1/models
  // refuses ChatGPT tokens (missing api.model.read scope).
  // API-key mode → standard Platform /v1/models.
  const isOauth = cred.authType === "oauth_token";
  const url = isOauth
    ? `${CODEX_CHATGPT_BACKEND}/codex/models?client_version=0.0.0`
    : `${(cred.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/models`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (isOauth) {
    // Match Codex CLI's default client — without `originator` the backend refuses.
    headers["originator"] = "codex_cli_rs";
    headers["User-Agent"] = "codex_cli_rs/0.0.0 (xyne-claw-auth)";
    // ChatGPT-Account-Id scopes the response to the user's workspace.
    const accountId = decodeJwtChatgptAccountId(apiKey);
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
  } else {
    headers["User-Agent"] = "codex-cli";
  }

  const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new HttpError(502, `Models endpoint ${upstream.status}: ${text.slice(0, 200)}`);
  }

  if (isOauth) {
    // ChatGPT backend wraps the list under `models` (ModelsResponse in codex-rs).
    // Exclude hidden entries (visibility: "hide"/"none") and sort by picker priority.
    const body = (await upstream.json()) as { models?: CodexBackendModel[] };
    const data = body.models ?? [];
    const models = data
      .filter((m) => m.slug)
      .filter((m) => m.visibility !== "hide" && m.visibility !== "none")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((m) => ({ id: m.slug, name: m.display_name ?? m.slug }));
    ok(res, models);
    return;
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

/** Pull the chatgpt_account_id from a Codex OAuth JWT (only used to set ChatGPT-Account-Id header). */
function decodeJwtChatgptAccountId(jwt: string): string | undefined {
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

// ── Claude browser sign-in (user-scoped) ──────────────────────────────────────
// Mirrors the agent-scoped flow in agents.ts, but writes the user's own
// credential. Anthropic's Claude Code flow is PKCE with the verifier doubling
// as `state`, and its redirect lands on localhost:53692 — a port only the
// Claude Code CLI listens on — so the browser cannot post back to us. The user
// copies the code (or the whole redirect URL) and pastes it into /exchange.
//
// Captures a REFRESHABLE token, unlike a pasted `claude setup-token` value.
const USER_CLAUDE_PKCE_TTL = 600;

function generateUserClaudePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

router.post("/provider-credentials/claude/oauth/start", oauthLimiter, async (req: Request, res: Response) => {
  try {
    if (!claudeOAuthConfigured()) {
      res.status(503).json({
        success: false,
        error: "Claude sign-in is not configured on this environment.",
      });
      return;
    }

    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "x-user-id header required" });
      return;
    }

    const { verifier, challenge } = generateUserClaudePkce();
    const state = verifier;
    await redisService
      .getConnection()
      .set(`${CLAUDE_OAUTH.pkcePrefix}${userId}:${state}`, verifier, "EX", USER_CLAUDE_PKCE_TTL);

    const url = new URL(CLAUDE_OAUTH.authorizeUrl);
    url.searchParams.set("code", "true");
    url.searchParams.set("client_id", CLAUDE_OAUTH.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", CLAUDE_OAUTH.redirectUri);
    url.searchParams.set("scope", CLAUDE_OAUTH.scopes);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);

    res.json({
      success: true,
      data: { url: url.toString(), state, expiresIn: USER_CLAUDE_PKCE_TTL },
    });
  } catch (err) {
    log.error("[settings] claude/oauth/start error:", err);
    res.status(500).json({ success: false, error: "Failed to start Claude login" });
  }
});

router.post("/provider-credentials/claude/oauth/exchange", oauthLimiter, async (req: Request, res: Response) => {
  try {
    if (!claudeOAuthConfigured()) {
      res.status(503).json({
        success: false,
        error: "Claude sign-in is not configured on this environment.",
      });
      return;
    }

    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "x-user-id header required" });
      return;
    }

    let { code, state } = (req.body ?? {}) as { code?: string; state?: string };

    // Tolerate a full redirect URL, "code#state", or a bare code — users paste
    // whichever of the three the browser happened to show them.
    let raw = (code ?? "").trim();
    if (raw.startsWith("http") || raw.includes("code=")) {
      try {
        const u = raw.startsWith("http") ? new URL(raw) : new URL(`http://x?${raw}`);
        code = u.searchParams.get("code") ?? code;
        state = u.searchParams.get("state") ?? state;
        raw = (code ?? "").trim();
      } catch {
        /* keep original */
      }
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
    const key = `${CLAUDE_OAUTH.pkcePrefix}${userId}:${state}`;
    const verifier = await redis.get(key);
    if (!verifier) {
      res.status(400).json({ success: false, error: "Sign-in expired — start again" });
      return;
    }
    await redis.del(key);

    const tokRes = await fetch(CLAUDE_OAUTH.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: CLAUDE_OAUTH.clientId,
        code,
        state,
        redirect_uri: CLAUDE_OAUTH.redirectUri,
        code_verifier: verifier,
      }),
    });
    if (!tokRes.ok) {
      const text = await tokRes.text().catch(() => "");
      res.status(502).json({
        success: false,
        error: `Anthropic token exchange failed: ${tokRes.status} ${text.slice(0, 200)}`,
      });
      return;
    }

    const tokens = (await tokRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
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
    await userProviderCredentialsRepository.upsert(userId, "claude", {
      encryptedKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      authType: "oauth_token",
      baseUrl: "https://api.anthropic.com",
    });

    res.json({ success: true, data: { connected: true } });
  } catch (err) {
    log.error("[settings] claude/oauth/exchange error:", err);
    res.status(500).json({ success: false, error: "Claude login exchange failed" });
  }
});

export const settingsRouter = router;
