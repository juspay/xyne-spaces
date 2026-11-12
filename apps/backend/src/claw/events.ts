/**
 * Spaces → Claw events for agent principals (mentions, DMs, automation runs).
 *
 * Replaces the app webhook (per-app HMAC secret + userId in the body): each
 * event carries an event token signed by Spaces that names the sender as `sub`
 * and binds the exact body (`bh` = SHA-256 of the body, hex). claw-auth
 * verifies it with Spaces' public key, checks the hash, and takes the user from
 * the token — never from the body.
 *
 * Header `x-spaces-event: <JWT>`, typ "claw-event+jwt",
 * claims { iss "xyne-spaces", aud "xyne-claw-auth", sub, ws, pid, prp "event:<type>", bh, iat, exp (+5 min), jti }.
 */

import { createHash, randomUUID } from 'crypto';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { runAsSystem } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import type { BaseAppEvent } from '@/apps/types';
import { CLAW_AUTH_AUDIENCE, SPACES_ISSUER, signSpacesJwt } from './jwt';
import { PRINCIPAL_ACTIVE, type PrincipalView } from './principals';

export const CLAW_EVENT_HEADER = 'x-spaces-event';
export const CLAW_EVENT_TYP = 'claw-event+jwt';
const EVENT_TOKEN_LIFETIME_SECONDS = 300;
const DISPATCH_TIMEOUT_MS = 15_000;

/** Active agent principals whose bot user is among `userIds`. */
export async function agentPrincipalsForUsers(userIds: string[]): Promise<PrincipalView[]> {
  if (userIds.length === 0) return [];
  const rows = await runAsSystem(() =>
    db.clawAgentPrincipal.findMany({ where: { botUserId: { in: userIds }, status: PRINCIPAL_ACTIVE, revokedAt: null } })
  );
  return rows.map((p) => ({
    id: p.id,
    workspaceId: p.workspaceId,
    orgId: p.orgId,
    clawAgentId: p.clawAgentId,
    name: p.name,
    botUserId: p.botUserId,
    status: p.status,
  }));
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Event token for `body`, or undefined when Spaces has no signing key. */
export function mintEventToken(args: { principal: PrincipalView; senderUserId?: string; eventType: string; body: string }): string | undefined {
  const now = Math.floor(Date.now() / 1000);
  return signSpacesJwt(
    {
      iss: SPACES_ISSUER,
      aud: CLAW_AUTH_AUDIENCE,
      // A system event with no human sender is attributed to the agent's own bot user.
      sub: args.senderUserId || args.principal.botUserId,
      ws: args.principal.workspaceId,
      pid: args.principal.id,
      prp: `event:${args.eventType}`,
      bh: bodyHash(args.body),
      iat: now,
      exp: now + EVENT_TOKEN_LIFETIME_SECONDS,
      jti: randomUUID(),
    },
    CLAW_EVENT_TYP
  );
}

/** claw-auth endpoint for an agent principal (internal, trusted-config URL). */
export function agentEventUrl(principalId: string): string {
  const base = (config.xyneClaw.authUrl || '').replace(/\/+$/, '');
  return `${base}/claw/api/v1/webhook/agent/${encodeURIComponent(principalId)}`;
}

/** Deliver one event to one agent principal. Returns the HTTP status and parsed body. */
export async function dispatchAgentEvent(
  principal: PrincipalView,
  event: BaseAppEvent
): Promise<{ status: number; body: unknown }> {
  const body = JSON.stringify(event);
  const payload = event.payload as unknown as Record<string, unknown>;
  const senderUserId = typeof payload?.userId === 'string' ? payload.userId : undefined;
  if (typeof payload?.workspaceId === 'string' && payload.workspaceId !== principal.workspaceId) {
    throw new Error('event workspace does not match the agent principal');
  }
  const token = mintEventToken({ principal, ...(senderUserId ? { senderUserId } : {}), eventType: String(event.eventType), body });
  if (!token) throw new Error('Spaces signing key not configured; cannot deliver agent events');

  const response = await fetch(agentEventUrl(principal.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CLAW_EVENT_HEADER]: token, 'X-Source': 'XyneSpaces' },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`agent event delivery failed with status ${response.status}`);
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep raw text */
  }
  logger.info('[ClawAgents] event delivered', { principalId: principal.id, eventType: event.eventType, status: response.status });
  return { status: response.status, body: parsed };
}

/** claw-auth endpoint for a click on a flow card an agent posted. */
export function agentFlowActionUrl(principalId: string): string {
  const base = (config.xyneClaw.authUrl || '').replace(/\/+$/, '');
  return `${base}/claw/api/v1/flow/agent/${encodeURIComponent(principalId)}/action`;
}

/**
 * Send a flow-card click to the agent that posted the card. Same body as an app
 * flow action; instead of the app HMAC it carries an event token naming the
 * user who clicked (`sub`) and binding the body. Returns the raw response so
 * the caller handles errors and the next screen exactly as for apps.
 */
export async function postAgentFlowAction(principal: PrincipalView, clickingUserId: string, body: string): Promise<globalThis.Response> {
  const token = mintEventToken({ principal, senderUserId: clickingUserId, eventType: 'flow_action', body });
  if (!token) throw new Error('Spaces signing key not configured; cannot deliver agent flow actions');
  return fetch(agentFlowActionUrl(principal.id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CLAW_EVENT_HEADER]: token, 'X-Xyne-Event': 'flow_action', 'X-Source': 'XyneSpaces' },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
}
