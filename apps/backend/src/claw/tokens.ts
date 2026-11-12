/**
 * Claw agent access tokens: how a Claw agent calls Spaces.
 *
 * claw-auth asks Spaces for a token (POST /api/claw-agents/service/token, with
 * its service assertion). Spaces decides the scopes from the agent's grants and
 * signs a 10-minute ES256 token with its own key. The token is accepted on the
 * scope-enforced app API (/api/apps/*, via authenticateApp): every call still
 * passes requirePermission, and scopes are re-checked against the current
 * grants on each request, so revoking a grant or disabling the agent takes
 * effect within seconds, not when the token expires.
 *
 * Two modes:
 *   agent        sub = the agent's bot user. For the agent acting as itself.
 *   on behalf of sub = a human user, act = the agent. Needs either a live,
 *                Spaces-vouched interaction with that user (their delegation
 *                token, forwarded by claw-auth) or a stored delegation grant
 *                from that user. Scopes are capped by the agent's own grants.
 *
 * Header typ "claw-agent+jwt"; claims { iss "xyne-spaces", aud "xyne-spaces-api",
 * sub, pid (principal), ws, scp [], obo (bool), dlg (bool: issued under a stored
 * delegation), iat, exp, jti }.
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { repositories } from '@/database/repositories';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import {
  CLAW_AUTH_AUDIENCE,
  SPACES_API_AUDIENCE,
  SPACES_ISSUER,
  signSpacesJwt,
  spacesPublicKey,
  verifyEs256,
} from './jwt';
import { requiredScopeFor, ROUTE_ENFORCED } from './routeScopes';
import {
  agentScopes,
  ClawAgentError,
  findPrincipal,
  isActive,
  onBehalfOfScopes,
  type PrincipalView,
} from './principals';

export const CLAW_AGENT_TYP = 'claw-agent+jwt';
export const CLAW_RENEW_TYP = 'claw-renew+jwt';
const TOKEN_LIFETIME_SECONDS = 600;
/** How long one live interaction (a mention, a chat turn) lets the agent keep acting for that user. */
const RENEWAL_LIFETIME_SECONDS = 2 * 60 * 60;
const SPACES_SELF_AUDIENCE = 'xyne-spaces';
const SCOPE_CACHE_MS = 30_000;

export interface IssuedAgentToken {
  token: string;
  expiresAt: string;
  scopes: string[];
  actingUserId: string;
  onBehalfOf: boolean;
  /**
   * Returned once, when a live interaction was proven by a delegation token:
   * lets claw-auth get fresh agent tokens for this user and agent for up to
   * RENEWAL_LIFETIME_SECONDS from that interaction. Never extended.
   */
  renewalToken?: string;
  renewalExpiresAt?: string;
}

/** A renewal token Spaces issued for this exact user, agent and workspace. */
function validRenewal(raw: unknown, userId: string, principal: PrincipalView): boolean {
  const r = verifyEs256(raw, spacesPublicKey, {
    issuer: SPACES_ISSUER,
    audience: SPACES_SELF_AUDIENCE,
    typ: CLAW_RENEW_TYP,
    maxLifetimeSeconds: RENEWAL_LIFETIME_SECONDS + 60,
  });
  return typeof r !== 'string' && r.payload.sub === userId && r.payload.pid === principal.id && r.payload.ws === principal.workspaceId;
}

/**
 * Verify a delegation or event token Spaces issued to claw-auth, forwarded back
 * as proof of a live interaction. Proof that names an agent (an event token's
 * `pid`, or a "session:<principalId>" delegation) only counts for that agent.
 */
function liveInteraction(raw: unknown, userId: string, principal: PrincipalView): boolean {
  const r = verifyEs256(raw, spacesPublicKey, {
    issuer: SPACES_ISSUER,
    audience: CLAW_AUTH_AUDIENCE,
    maxLifetimeSeconds: 600,
  });
  if (typeof r === 'string') return false;
  const p = r.payload;
  if (p.sub !== userId) return false;
  if (p.pid !== undefined && p.pid !== principal.id) return false;
  if (typeof p.prp === 'string' && p.prp.startsWith('session:') && p.prp !== `session:${principal.id}`) return false;
  // A delegation without a workspace claim proves the user, not the workspace: accept only when it matches if present.
  return p.ws === undefined || p.ws === principal.workspaceId;
}

export async function issueAgentToken(args: {
  principalId: string;
  onBehalfOf?: { userId: string; delegationToken?: string; renewalToken?: string };
}): Promise<IssuedAgentToken> {
  const principal = await findPrincipal(args.principalId);
  if (!isActive(principal)) throw new ClawAgentError('agent not found or disabled', 404);

  let sub = principal.botUserId;
  let scopes: string[];
  let obo = false;
  let dlg = false;
  let renewal: { token: string; exp: number } | undefined;

  if (args.onBehalfOf) {
    const userId = String(args.onBehalfOf.userId ?? '').trim();
    const user = userId ? await runAsSystem(() => repositories.users.findById(userId)) : null;
    if (!user || user.workspaceId !== principal.workspaceId || user.status !== 'ACTIVE') {
      throw new ClawAgentError('user not found in this workspace', 403);
    }
    const fromInteraction = liveInteraction(args.onBehalfOf.delegationToken, userId, principal);
    const live = fromInteraction || validRenewal(args.onBehalfOf.renewalToken, userId, principal);
    scopes = await onBehalfOfScopes(principal, userId, !live);
    if (!scopes.length) throw new ClawAgentError('no delegation from this user for this agent', 403);
    sub = userId;
    obo = true;
    dlg = !live;
    if (fromInteraction) {
      const t = Math.floor(Date.now() / 1000);
      const rt = signSpacesJwt(
        { iss: SPACES_ISSUER, aud: SPACES_SELF_AUDIENCE, sub: userId, pid: principal.id, ws: principal.workspaceId, iat: t, exp: t + RENEWAL_LIFETIME_SECONDS, jti: randomUUID() },
        CLAW_RENEW_TYP
      );
      if (rt) renewal = { token: rt, exp: t + RENEWAL_LIFETIME_SECONDS };
    }
  } else {
    scopes = await agentScopes(principal);
    if (!scopes.length) throw new ClawAgentError('agent has no approved scopes in this workspace', 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signSpacesJwt(
    {
      iss: SPACES_ISSUER,
      aud: SPACES_API_AUDIENCE,
      sub,
      pid: principal.id,
      ws: principal.workspaceId,
      scp: scopes,
      obo,
      dlg,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
      jti: randomUUID(),
    },
    CLAW_AGENT_TYP
  );
  if (!token) throw new ClawAgentError('Spaces signing key not configured', 503);
  logger.info('[ClawAgents] token issued', { principalId: principal.id, sub, obo, dlg, scopes });
  return {
    token,
    expiresAt: new Date((now + TOKEN_LIFETIME_SECONDS) * 1000).toISOString(),
    scopes,
    actingUserId: sub,
    onBehalfOf: obo,
    ...(renewal ? { renewalToken: renewal.token, renewalExpiresAt: new Date(renewal.exp * 1000).toISOString() } : {}),
  };
}

/** True when a bearer token is a Claw agent token (header typ), without verifying it. */
export function looksLikeAgentToken(raw: string): boolean {
  const head = raw.split('.')[0];
  if (!head) return false;
  try {
    return JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).typ === CLAW_AGENT_TYP;
  } catch {
    return false;
  }
}

const scopeCache = new Map<string, { at: number; scopes: Set<string>; principal: PrincipalView | null }>();

/** Current scopes for the token's principal and mode, cached briefly so revocation lands within SCOPE_CACHE_MS. */
async function currentScopes(pid: string, sub: string, obo: boolean, dlg: boolean): Promise<{ principal: PrincipalView | null; scopes: Set<string> }> {
  const key = `${pid}|${obo ? sub : ''}|${dlg ? 1 : 0}`;
  const hit = scopeCache.get(key);
  if (hit && Date.now() - hit.at < SCOPE_CACHE_MS) return hit;
  const principal = await findPrincipal(pid);
  let scopes = new Set<string>();
  if (isActive(principal)) {
    scopes = new Set(obo ? await onBehalfOfScopes(principal, sub, dlg) : await agentScopes(principal));
  }
  const entry = { at: Date.now(), scopes, principal };
  scopeCache.set(key, entry);
  if (scopeCache.size > 5000) scopeCache.clear();
  return entry;
}

function deny(res: Response): void {
  res.status(401).json({ success: false, message: 'Authentication failed' });
}

interface AgentRequest {
  principal: PrincipalView;
  permissions: string[];
  obo: boolean;
  user: NonNullable<Request['user']>;
}

/**
 * Verify a Claw agent bearer token and load who it acts as. Permissions are the
 * token's scopes ∩ the agent's current grants (so revocation lands within
 * SCOPE_CACHE_MS). Returns undefined when the token is not acceptable.
 */
async function resolveAgentRequest(req: Request): Promise<AgentRequest | undefined> {
  const header = req.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const result = verifyEs256(raw, spacesPublicKey, {
    issuer: SPACES_ISSUER,
    audience: SPACES_API_AUDIENCE,
    typ: CLAW_AGENT_TYP,
    maxLifetimeSeconds: TOKEN_LIFETIME_SECONDS + 60,
  });
  if (typeof result === 'string') {
    logger.warn('[ClawAgents] agent token rejected', { reason: result, path: req.path });
    return undefined;
  }
  const p = result.payload;
  const pid = typeof p.pid === 'string' ? p.pid : '';
  const sub = typeof p.sub === 'string' ? p.sub : '';
  const obo = p.obo === true;
  const dlg = p.dlg === true;
  const tokenScopes = Array.isArray(p.scp) ? p.scp.map(String) : [];
  if (!pid || !sub) return undefined;

  const { principal, scopes } = await currentScopes(pid, sub, obo, dlg);
  if (!isActive(principal) || principal.workspaceId !== p.ws) {
    logger.warn('[ClawAgents] agent token for a disabled or moved agent', { principalId: pid });
    return undefined;
  }
  // The acting user must be the agent's bot (agent mode) or a human (on behalf of).
  if (!obo && sub !== principal.botUserId) return undefined;
  if (obo && sub === principal.botUserId) return undefined;

  const user = await runAsSystem(() => repositories.users.findById(sub));
  if (!user || user.workspaceId !== principal.workspaceId || (obo && user.status !== 'ACTIVE')) return undefined;
  const orgMember = await runAsSystem(() => repositories.orgMembers.findById(user.orgMemberId));

  return {
    principal,
    obo,
    permissions: tokenScopes.filter((s) => scopes.has(s)),
    user: {
      id: user.id,
      googleId: user.providerUserId,
      email: user.email,
      name: user.name,
      displayName: (user as { displayName?: string | null }).displayName ?? undefined,
      workspaceId: user.workspaceId,
      memberId: user.orgMemberId,
      role: user.role,
      orgRole: orgMember?.role ?? 'MEMBER',
    } as NonNullable<Request['user']>,
  };
}

function attach(req: Request, a: AgentRequest): void {
  (req as any).auth = {
    // The principal id stands in for an app id: flow cards are stamped with it,
    // and an agent can never borrow another app's id (chatController falls back
    // to body.appId when this is unset).
    appId: a.principal.id,
    permissions: a.permissions,
    permissionsStale: false,
    clawAgent: { principalId: a.principal.id, botUserId: a.principal.botUserId, onBehalfOfUserId: a.obo ? a.user.id : null },
  };
  req.user = a.user;
}

/**
 * Bot API (/api/claw-agents/bot/*): the agent acting as itself. On-behalf-of
 * tokens are refused here (they belong on user routes), and app tokens never
 * reach this path. The routes' own requirePermission checks enforce scopes.
 */
export async function authenticateClawAgent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const a = await resolveAgentRequest(req);
    if (!a || a.obo) {
      if (a?.obo) logger.warn('[ClawAgents] on-behalf-of token refused on the bot API', { principalId: a.principal.id, path: req.path });
      deny(res);
      return;
    }
    attach(req, a);
    next();
  } catch (error) {
    logger.error('[ClawAgents] agent authentication failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, message: 'Authentication failed' });
  }
}

/**
 * Normal user routes (via authMiddleware.authenticate). Only on-behalf-of
 * tokens: the request runs as the user, so the user's own permissions apply,
 * and the route must be listed in CLAW_ROUTE_SCOPES with a scope the token
 * carries. Everything else is denied (403), even if the user could call it.
 */
export async function authenticateClawAgentOnBehalfOf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const a = await resolveAgentRequest(req);
    if (!a || !a.obo) {
      deny(res);
      return;
    }
    const path = (req.originalUrl || req.url || '').split('?')[0] ?? '';
    const needed = requiredScopeFor(req.method, path);
    if (!needed || (needed !== ROUTE_ENFORCED && !a.permissions.includes(needed))) {
      logger.warn('[ClawAgents] agent call outside its scopes', {
        principalId: a.principal.id,
        userId: a.user.id,
        method: req.method,
        path,
        needed: needed ?? '(route not open to agents)',
      });
      res.status(403).json({ success: false, error: 'agent_scope_denied', required: needed ?? null });
      return;
    }
    attach(req, a);
    logger.info('[ClawAgents] agent acting for user', {
      principalId: a.principal.id,
      userId: a.user.id,
      method: req.method,
      path,
      scope: needed,
    });
    next();
  } catch (error) {
    logger.error('[ClawAgents] agent authentication failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ success: false, message: 'Authentication failed' });
  }
}
