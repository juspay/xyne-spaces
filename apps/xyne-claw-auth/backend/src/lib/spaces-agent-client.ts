/**
 * How claw-auth acts in Spaces as a Claw agent — replacing users' Spaces
 * sessions read from the Spaces DB and the never-expiring app tokens.
 *
 * 1. Service assertion (x-claw-assertion): proves "this call is from claw-auth".
 *    ES256, signed with CLAW_SERVICE_PRIVATE_KEY (Spaces holds only the public
 *    key), single use, at most 60 s, bound to one method + path.
 * 2. Principal: a Claw agent in one Spaces workspace (Spaces decides; we look it up).
 * 3. Agent token: 10-minute ES256 token from Spaces, as the agent itself or on
 *    behalf of a user. On behalf of a user needs a live interaction (the user's
 *    delegation token, then the 2-hour renewal token Spaces returns) or a stored
 *    delegation the user gave the agent.
 *
 * Tokens are cached in memory until a minute before expiry.
 */

import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import type { SpacesEvent } from "./spaces-delegation.js";
import { createLogger } from "../logger.js";
import { SERVICE_ASSERTION_HEADER, ServiceAuthNotConfiguredError, serviceSigningConfigured, signServiceAssertion } from "./service-assertion.js";

const log = createLogger("spaces-agent-client");

const PRINCIPAL_CACHE_MS = 5 * 60_000;
const PRINCIPAL_MISS_CACHE_MS = 30_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const SERVICE_TIMEOUT_MS = 10_000;

export interface SpacesPrincipal {
  id: string;
  workspaceId: string;
  orgId: string;
  clawAgentId: string;
  name: string;
  botUserId: string;
  status: string;
}

export interface SpacesAgentAuth {
  /** Bearer token for Spaces: /api/claw-agents/bot/* (the agent itself) or allowlisted user routes (on behalf of). */
  agentToken: string;
  workspaceId: string;
  principalId: string;
  actingUserId: string;
  onBehalfOf: boolean;
  scopes: string[];
  expiresAt: number;
}

export class SpacesAgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ── Service assertion (lib/service-assertion.ts) ─────────────────────────────

export function agentCallsConfigured(): boolean {
  return serviceSigningConfigured();
}

/** One-shot assertion from claw-auth to Spaces for `method path`. */
export function mintServiceAssertion(method: string, path: string): string {
  try {
    return signServiceAssertion("xyne-spaces", method, path);
  } catch (err) {
    if (err instanceof ServiceAuthNotConfiguredError) throw new SpacesAgentError(err.message, 503);
    throw err;
  }
}

/** A signed claw-auth → Spaces service call (throws SpacesAgentError on non-2xx). */
export async function serviceCall<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const url = `${CONFIG.spacesInternalUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      [SERVICE_ASSERTION_HEADER]: mintServiceAssertion(method, path),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new SpacesAgentError(json.error ?? `Spaces ${method} ${path} failed (${res.status})`, res.status);
  return json;
}

// ── Principals ───────────────────────────────────────────────────────────────

const principalCache = new Map<string, { at: number; value: SpacesPrincipal | null }>();

function cached(key: string): SpacesPrincipal | null | undefined {
  const hit = principalCache.get(key);
  if (!hit) return undefined;
  const ttl = hit.value ? PRINCIPAL_CACHE_MS : PRINCIPAL_MISS_CACHE_MS;
  return Date.now() - hit.at < ttl ? hit.value : undefined;
}

function remember(key: string, value: SpacesPrincipal | null): void {
  principalCache.set(key, { at: Date.now(), value });
  if (value) principalCache.set(`id:${value.id}`, { at: Date.now(), value });
  if (principalCache.size > 5000) principalCache.clear();
}

/** The agent's principal in a workspace, or null when the agent was not added to it. */
export async function findPrincipalForAgent(clawAgentId: string, workspaceId: string): Promise<SpacesPrincipal | null> {
  const key = `agent:${clawAgentId}|${workspaceId}`;
  const hit = cached(key);
  if (hit !== undefined) return hit;
  try {
    const r = await serviceCall<{ principal: SpacesPrincipal }>(
      "GET",
      `/api/claw-agents/service/principals?clawAgentId=${encodeURIComponent(clawAgentId)}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    remember(key, r.principal);
    return r.principal;
  } catch (err) {
    if (err instanceof SpacesAgentError && err.status === 404) {
      remember(key, null);
      return null;
    }
    throw err;
  }
}

/** The agent's active principals across workspaces (when the caller does not know the workspace). */
export async function findActivePrincipalsForAgent(clawAgentId: string): Promise<SpacesPrincipal[]> {
  const key = `agent-all:${clawAgentId}`;
  const hit = cached(key);
  if (hit !== undefined) return hit ? [hit] : [];
  const r = await serviceCall<{ principals: SpacesPrincipal[] }>(
    "GET",
    `/api/claw-agents/service/principals?clawAgentId=${encodeURIComponent(clawAgentId)}`,
  );
  const active = (r.principals ?? []).filter((p) => p.status === "ACTIVE");
  // Cache only the unambiguous answer; several workspaces is the caller's problem.
  if (active.length <= 1) remember(key, active[0] ?? null);
  return active;
}

export async function findPrincipalById(principalId: string): Promise<SpacesPrincipal | null> {
  const key = `id:${principalId}`;
  const hit = cached(key);
  if (hit !== undefined) return hit;
  try {
    const r = await serviceCall<{ principal: SpacesPrincipal }>("GET", `/api/claw-agents/service/principals/${encodeURIComponent(principalId)}`);
    remember(key, r.principal);
    return r.principal;
  } catch (err) {
    if (err instanceof SpacesAgentError && err.status === 404) {
      remember(key, null);
      return null;
    }
    throw err;
  }
}

// ── Agent tokens ─────────────────────────────────────────────────────────────

const tokenCache = new Map<string, SpacesAgentAuth>();
/**
 * Renewal tokens from live interactions, per principal + user. Kept in Redis so
 * any claw-auth replica can renew during a run; this map is the per-replica
 * fallback when Redis is unavailable. A renewal is a bearer for at most 2 hours,
 * bound by Spaces to one user, agent and workspace.
 */
const renewals = new Map<string, { token: string; expiresAt: number }>();
const renewalKey = (cacheKey: string) => `claw:agent-renewal:${cacheKey}`;

async function saveRenewal(cacheKey: string, token: string, expiresAt: number): Promise<void> {
  renewals.set(cacheKey, { token, expiresAt });
  const ttl = Math.floor((expiresAt - Date.now()) / 1000);
  if (ttl <= 0) return;
  try {
    await redisService.getConnection().set(renewalKey(cacheKey), JSON.stringify({ token, expiresAt }), "EX", ttl);
  } catch (err) {
    log.warn("[spaces-agent-client] renewal not saved to Redis:", err instanceof Error ? err.message : err);
  }
}

async function loadRenewal(cacheKey: string): Promise<{ token: string; expiresAt: number } | undefined> {
  const local = renewals.get(cacheKey);
  if (local && local.expiresAt > Date.now()) return local;
  try {
    const raw = await redisService.getConnection().get(renewalKey(cacheKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token === "string" && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()) {
      const value = { token: parsed.token, expiresAt: parsed.expiresAt };
      renewals.set(cacheKey, value);
      return value;
    }
  } catch (err) {
    log.warn("[spaces-agent-client] renewal not read from Redis:", err instanceof Error ? err.message : err);
  }
  return undefined;
}

interface TokenResponse {
  token: string;
  expiresAt: string;
  scopes: string[];
  actingUserId: string;
  onBehalfOf: boolean;
  renewalToken?: string;
  renewalExpiresAt?: string;
}

/**
 * Spaces auth for an agent: as itself (no `onBehalfOfUserId`), or on behalf of
 * a user. `delegationToken` is the user's Spaces delegation/event token from a
 * live interaction; after the first exchange the renewal token is reused, so
 * later calls in the same run need no proof. Without either, Spaces only
 * issues a token if the user gave the agent a stored delegation.
 */
export async function getAgentAuth(args: {
  principalId: string;
  onBehalfOfUserId?: string;
  delegationToken?: string;
}): Promise<SpacesAgentAuth> {
  const userKey = args.onBehalfOfUserId ?? "";
  const cacheKey = `${args.principalId}|${userKey}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return hit;

  let onBehalfOf: Record<string, string> | undefined;
  if (args.onBehalfOfUserId) {
    onBehalfOf = { userId: args.onBehalfOfUserId };
    if (args.delegationToken) {
      onBehalfOf["delegationToken"] = args.delegationToken;
    } else {
      const renewal = await loadRenewal(cacheKey);
      if (renewal) onBehalfOf["renewalToken"] = renewal.token;
    }
  }

  const r = await serviceCall<TokenResponse>("POST", "/api/claw-agents/service/token", {
    principalId: args.principalId,
    ...(onBehalfOf ? { onBehalfOf } : {}),
  });
  if (r.renewalToken && r.renewalExpiresAt) {
    await saveRenewal(cacheKey, r.renewalToken, Date.parse(r.renewalExpiresAt));
  }
  const principal = await findPrincipalById(args.principalId);
  const auth: SpacesAgentAuth = {
    agentToken: r.token,
    workspaceId: principal?.workspaceId ?? "",
    principalId: args.principalId,
    actingUserId: r.actingUserId,
    onBehalfOf: r.onBehalfOf,
    scopes: r.scopes,
    expiresAt: Date.parse(r.expiresAt),
  };
  tokenCache.set(cacheKey, auth);
  if (tokenCache.size > 5000) tokenCache.clear();
  log.info(
    `[spaces-agent-client] token principal=${args.principalId} obo=${auth.onBehalfOf} user=${auth.actingUserId} scopes=${auth.scopes.length}`,
  );
  return auth;
}

/** Forget cached tokens for a principal (e.g. after Spaces answered 401/403). */
export function dropAgentAuth(principalId: string, onBehalfOfUserId?: string): void {
  tokenCache.delete(`${principalId}|${onBehalfOfUserId ?? ""}`);
}

/** Test hook. */
/** Forget cached principal lookups for one agent (after it is added to a workspace). */
export function forgetPrincipalsForAgent(clawAgentId: string): void {
  for (const key of [...principalCache.keys()]) {
    if (key.startsWith(`agent:${clawAgentId}|`) || key === `agent-all:${clawAgentId}`) principalCache.delete(key);
  }
}

export function resetAgentClientCaches(): void {
  principalCache.clear();
  tokenCache.clear();
  renewals.clear();
}

// ── Live proof at run start, and the accessor everything else uses ──────────

/**
 * Browser-started run (chat): the user is present, so ask Spaces — with the
 * user's own forwarded cookie — for a delegation token for this agent, and
 * exchange it. Afterwards getSpacesAuthForAgent works for this user and agent
 * for up to 2 hours (renewal), from any replica.
 */
export async function primeAgentAuthFromCookie(args: {
  cookie: string;
  workspaceId: string;
  clawAgentId: string;
  spacesUserId: string;
}): Promise<SpacesAgentAuth | null> {
  if (!args.cookie || !args.clawAgentId || !args.spacesUserId) return null;
  try {
    const url = `${CONFIG.spacesInternalUrl.replace(/\/+$/, "")}/api/claw-agents/delegation-token`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: args.cookie,
        ...(args.workspaceId ? { "x-workspace-id": args.workspaceId } : {}),
      },
      body: JSON.stringify({ clawAgentId: args.clawAgentId }),
      redirect: "manual",
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.info(`[spaces-agent-client] no delegation for agent=${args.clawAgentId} status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { delegationToken?: string; principalId?: string };
    if (!body.delegationToken || !body.principalId) return null;
    return await getAgentAuth({
      principalId: body.principalId,
      onBehalfOfUserId: args.spacesUserId,
      delegationToken: body.delegationToken,
    });
  } catch (err) {
    log.warn(`[spaces-agent-client] prime from cookie failed agent=${args.clawAgentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Event-started run (mention, DM): the event token itself is the live proof. */
export async function primeAgentAuthFromEvent(ev: SpacesEvent): Promise<SpacesAgentAuth | null> {
  try {
    const principal = await findPrincipalById(ev.principalId);
    // A system event attributed to the agent's own bot carries no user to act for.
    if (!principal || ev.spacesUserId === principal.botUserId) return null;
    return await getAgentAuth({ principalId: ev.principalId, onBehalfOfUserId: ev.spacesUserId, delegationToken: ev.token });
  } catch (err) {
    log.warn(`[spaces-agent-client] prime from event failed principal=${ev.principalId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Spaces auth for `clawAgentId` acting for `spacesUserId` in `workspaceId`.
 * Works while a renewal from a live interaction is valid (≤2 h after it), or
 * when the user gave the agent a stored delegation in Spaces. Returns null when
 * the agent isn't in that workspace or Spaces won't let it act for the user.
 */
export async function getSpacesAuthForAgent(args: {
  clawAgentId: string;
  spacesUserId: string;
  workspaceId: string;
}): Promise<SpacesAgentAuth | null> {
  if (!args.clawAgentId || !args.spacesUserId || !args.workspaceId) return null;
  try {
    const principal = await findPrincipalForAgent(args.clawAgentId, args.workspaceId);
    if (!principal || principal.status !== "ACTIVE") return null;
    return await getAgentAuth({ principalId: principal.id, onBehalfOfUserId: args.spacesUserId });
  } catch (err) {
    if (err instanceof SpacesAgentError && (err.status === 403 || err.status === 404)) {
      log.info(`[spaces-agent-client] agent=${args.clawAgentId} may not act for user=${args.spacesUserId}: ${err.message}`);
      return null;
    }
    log.warn(`[spaces-agent-client] agent auth failed agent=${args.clawAgentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** The agent acting as itself (bot posts in channels it was added to). */
export async function getSpacesAuthForAgentItself(clawAgentId: string, workspaceId: string): Promise<SpacesAgentAuth | null> {
  try {
    const principal = await findPrincipalForAgent(clawAgentId, workspaceId);
    if (!principal || principal.status !== "ACTIVE") return null;
    return await getAgentAuth({ principalId: principal.id });
  } catch (err) {
    log.warn(`[spaces-agent-client] agent self auth failed agent=${clawAgentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
