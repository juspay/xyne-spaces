/**
 * Server-to-server workspace JWT minting.
 *   POST /api/internal/auth/token  — S2S (x-s2s-key): { userId | accountId, workspaceId } →
 *                                    { token, expiresIn, workspaceId, userId }, only while the
 *                                    account has an ACTIVE session somewhere (claw-auth).
 *
 * There is no public token endpoint any more: browsers, Electron and mobile hold the
 * per-workspace access JWT in the `xw_<ws>` cookie, refreshed inline by the middleware from the
 * `xs` session cookie (or explicitly via GET /auth/refresh-session).
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { findMembership, findOrgMember, findUserById, listAccountSessions } from '@/bypassAcl/authSessionServices';
import { recordTokenMinted } from '@/services/otel/authMetrics';
import { mintWorkspaceJwt } from '@/auth/sessionIssuer';
import type { SessionPlatform, WorkspaceTokenResponse } from '@/auth/types';

const internalBodySchema = z
  .object({
    userId: z.string().min(1).optional(),
    accountId: z.string().min(1).optional(),
    workspaceId: z.string().min(1),
  })
  .refine((b) => !!b.userId || !!b.accountId, { message: 'userId or accountId is required' });

function send(res: Response, body: WorkspaceTokenResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json(body);
}

export class AuthTokenController {
  /** Internal (S2S): mint for a user/account that still has a live session somewhere. */
  static issueInternalToken = async (req: Request, res: Response): Promise<void> => {
    const parsed = internalBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
      return;
    }
    const { workspaceId } = parsed.data;
    let accountId = parsed.data.accountId ?? null;
    if (!accountId && parsed.data.userId) {
      const user = await findUserById(parsed.data.userId);
      accountId = user?.orgMemberId ?? null;
    }
    if (!accountId) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    const sessions = await listAccountSessions(accountId);
    if (sessions.length === 0) {
      res.status(409).json({ error: 'no_active_session' });
      return;
    }
    // The token carries `orgId` / `orgRole` as claims (the resolver builds `req.user` from them
    // without a DB read), so the org membership must still be live here.
    const orgMember = await findOrgMember(accountId);
    if (!orgMember || orgMember.leftAt) {
      res.status(403).json({ error: 'account_left' });
      return;
    }
    const membership = await findMembership(accountId, workspaceId);
    if (!membership) {
      res.status(403).json({ error: 'workspace_forbidden' });
      return;
    }
    const expiresIn = config.session.workspaceTokenTtlSeconds;
    const token = mintWorkspaceJwt({
      user: membership,
      memberId: accountId,
      workspaceId,
      sid: sessions[0].id,
      orgId: orgMember.orgId,
      orgRole: orgMember.role,
      platform: sessions[0].platform as SessionPlatform,
      expiresInSeconds: expiresIn,
    });
    recordTokenMinted({ audience: 'internal' });
    logger.debug('[AUTH] internal token minted', { accountId, workspaceId, sid: sessions[0].id });
    send(res, { token, expiresIn, workspaceId, userId: membership.id });
  };
}
