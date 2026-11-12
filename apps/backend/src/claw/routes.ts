/**
 * /api/claw-agents — Claw agents as first-party principals.
 *
 * User routes (Spaces session):
 *   POST   /delegation-token                         proof of a live session with an agent { clawAgentId }
 *   GET    /principals                              list agents in my workspace
 *   POST   /principals                   (admin + claw-auth assertion)
 *                                                  add an agent and approve its scopes { clawAgentId, name, scopes? }
 *   POST   /principals/:id/picture       (admin)    set the agent bot's profile picture (multipart "picture")
 *   DELETE /principals/:id               (admin)    disable it (tokens stop working)
 *   GET    /principals/:id/grants                   admin: all; member: agent grants + my delegations
 *   POST   /principals/:id/grants        (admin)    approve what the agent may do { scopes }
 *   POST   /principals/:id/delegations              let it act for me when I'm away { scopes, expiresAt? }
 *   DELETE /principals/:id/grants/:grantId          revoke (admin, or my own delegation)
 *
 * Bot API (agent tokens, the agent acting as itself — claw/botRoutes.ts):
 *   /bot/chat/postMessage, /bot/channel/openDm, /bot/files/filesUpload, ...
 *
 * Service routes (claw-auth's signed assertion, claw/serviceAuth.ts):
 *   GET    /service/principals?clawAgentId=&workspaceId=   one principal
 *   GET    /service/principals?clawAgentId=                the agent's active principals
 *   GET    /service/principals/:id
 *   POST   /service/token { principalId, onBehalfOf?: { userId, delegationToken? | renewalToken? } }
 *   GET    /service/users/:id                      directory: one user (minimal fields)
 *   GET    /service/users?workspaceId=&name= | email= | handle=   mention lookup (≤ 2 active users)
 *   GET    /service/groups?workspaceId=&alias=     mention lookup (≤ 2 active groups)
 */

import { Router, type Request, type Response } from 'express';
import { OrgRole, WorkspaceRole } from '@xyne/shared';
import { authMiddleware } from '@/middleware/auth';
import { uploadConfig } from '@/middleware/upload';
import { UserManagementService } from '@/services/userManagementService';
import { logger } from '@/utils/logger';
import { authenticateClawService } from './serviceAuth';
import { issueAgentToken } from './tokens';
import { clawBotRoutes } from './botRoutes';
import { directoryUser, groupsByAlias, usersByEmail, usersByHandle, usersByName } from './directory';
import { mintClawDelegationToken } from '@/services/clawDelegationToken';
import {
  addGrants,
  ClawAgentError,
  disablePrincipal,
  ensurePrincipal,
  findPrincipal,
  findActivePrincipalsForAgent,
  findPrincipalByAgent,
  isActive,
  knownScopes,
  listGrants,
  listPrincipals,
  revokeGrant,
  validateScopes,
  type PrincipalView,
} from './principals';

const DEFAULT_DELEGATION_DAYS = 90;
const MAX_DELEGATION_DAYS = 365;

function isAdmin(req: Request): boolean {
  const u = req.user;
  return (
    !!u &&
    (u.orgRole === OrgRole.OWNER ||
      u.orgRole === OrgRole.ADMIN ||
      u.role === WorkspaceRole.OWNER ||
      u.role === WorkspaceRole.ADMIN)
  );
}

function fail(res: Response, error: unknown): void {
  if (error instanceof ClawAgentError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  logger.error('[ClawAgents] request failed', { error: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ success: false, error: 'Internal error' });
}

/** The principal named in :id, only if it belongs to the caller's workspace. */
async function principalInMyWorkspace(req: Request): Promise<PrincipalView> {
  const principal = await findPrincipal(String(req.params.id ?? ''));
  if (!principal || principal.workspaceId !== req.user?.workspaceId) throw new ClawAgentError('agent not found', 404);
  return principal;
}

function parseExpiry(raw: unknown): Date {
  const max = Date.now() + MAX_DELEGATION_DAYS * 86_400_000;
  if (raw === undefined || raw === null || raw === '') return new Date(Date.now() + DEFAULT_DELEGATION_DAYS * 86_400_000);
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) throw new ClawAgentError('expiresAt must be a future date', 400);
  if (d.getTime() > max) throw new ClawAgentError(`expiresAt can be at most ${MAX_DELEGATION_DAYS} days ahead`, 400);
  return d;
}

const router = Router();

// ── Service routes (claw-auth) ────────────────────────────────────────────────
router.get('/service/principals', authenticateClawService, async (req, res) => {
  try {
    const clawAgentId = String(req.query.clawAgentId ?? '').trim();
    const workspaceId = String(req.query.workspaceId ?? '').trim();
    if (!clawAgentId) throw new ClawAgentError('clawAgentId is required', 400);
    if (!workspaceId) {
      res.json({ success: true, principals: await findActivePrincipalsForAgent(clawAgentId) });
      return;
    }
    const principal = await findPrincipalByAgent(clawAgentId, workspaceId);
    if (!principal) throw new ClawAgentError('agent not in this workspace', 404);
    res.json({ success: true, principal });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/service/principals/:id', authenticateClawService, async (req, res) => {
  try {
    const principal = await findPrincipal(String(req.params.id ?? ''));
    if (!principal) throw new ClawAgentError('agent not found', 404);
    res.json({ success: true, principal });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/service/token', authenticateClawService, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      principalId?: unknown;
      onBehalfOf?: { userId?: unknown; delegationToken?: unknown; renewalToken?: unknown };
    };
    const principalId = String(body.principalId ?? '').trim();
    if (!principalId) throw new ClawAgentError('principalId is required', 400);
    const onBehalfOf = body.onBehalfOf
      ? {
          userId: String(body.onBehalfOf.userId ?? ''),
          ...(typeof body.onBehalfOf.delegationToken === 'string' ? { delegationToken: body.onBehalfOf.delegationToken } : {}),
          ...(typeof body.onBehalfOf.renewalToken === 'string' ? { renewalToken: body.onBehalfOf.renewalToken } : {}),
        }
      : undefined;
    const issued = await issueAgentToken({ principalId, ...(onBehalfOf ? { onBehalfOf } : {}) });
    res.json({ success: true, ...issued });
  } catch (error) {
    fail(res, error);
  }
});

// ── Directory (claw-auth; replaces its direct Spaces DB reads) ───────────────
const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).trim() : '');

router.get('/service/users/:id', authenticateClawService, async (req, res) => {
  try {
    const user = await directoryUser(String(req.params.id ?? ''));
    if (!user) throw new ClawAgentError('user not found', 404);
    res.json({ success: true, user });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/service/users', authenticateClawService, async (req, res) => {
  try {
    const workspaceId = q(req, 'workspaceId') || undefined;
    const [name, email, handle] = [q(req, 'name'), q(req, 'email'), q(req, 'handle')];
    if ([name, email, handle].filter(Boolean).length !== 1) throw new ClawAgentError('give exactly one of name, email, handle', 400);
    const users = name ? await usersByName(name, workspaceId) : email ? await usersByEmail(email, workspaceId) : await usersByHandle(handle, workspaceId);
    res.json({ success: true, users });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/service/groups', authenticateClawService, async (req, res) => {
  try {
    const alias = q(req, 'alias');
    if (!alias) throw new ClawAgentError('alias is required', 400);
    res.json({ success: true, groups: await groupsByAlias(alias, q(req, 'workspaceId') || undefined) });
  } catch (error) {
    fail(res, error);
  }
});

// ── Bot API (agent tokens) — before the user-session middleware below ─────────
router.use('/bot', clawBotRoutes);

// ── User routes (Spaces session) ──────────────────────────────────────────────
router.use(authMiddleware.authenticate);

/**
 * A delegation token for the signed-in user and one agent they are using: the
 * proof of a live interaction claw-auth exchanges for an on-behalf-of agent
 * token (+ a 2-hour renewal). Only for an agent active in the user's workspace.
 * Agent tokens can't reach this route (not in the agent route allowlist).
 */
router.post('/delegation-token', async (req, res) => {
  try {
    const clawAgentId = String((req.body ?? {}).clawAgentId ?? '').trim();
    if (!clawAgentId) throw new ClawAgentError('clawAgentId is required', 400);
    const principal = await findPrincipalByAgent(clawAgentId, req.user!.workspaceId);
    if (!isActive(principal)) throw new ClawAgentError('agent not active in this workspace', 404);
    const delegationToken = mintClawDelegationToken({
      spacesUserId: req.user!.id,
      workspaceId: principal.workspaceId,
      purpose: `session:${principal.id}`,
    });
    if (!delegationToken) throw new ClawAgentError('Spaces signing key not configured', 503);
    res.json({ success: true, delegationToken, principalId: principal.id });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/principals', async (req, res) => {
  try {
    res.json({ success: true, principals: await listPrincipals(req.user!.workspaceId, req.user!.id) });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Add a Claw agent to the caller's workspace and approve its scopes, in one step.
 * Needs both consents: a workspace admin's session (this request's user) AND
 * claw-auth's signed assertion, which claw-auth only sends after checking the
 * caller owns or administers that agent there. So a workspace admin can't attach
 * an arbitrary agent id, and claw-auth can't add an agent to a workspace alone.
 * Scopes Spaces doesn't know are dropped (registries differ per environment).
 */
router.post('/principals', authMiddleware.requireAdminOrOwner, authenticateClawService, async (req, res) => {
  try {
    const { clawAgentId, name, scopes } = (req.body ?? {}) as { clawAgentId?: unknown; name?: unknown; scopes?: unknown };
    const principal = await ensurePrincipal({
      clawAgentId: String(clawAgentId ?? ''),
      name: String(name ?? ''),
      workspaceId: req.user!.workspaceId,
      createdBy: req.user!.id,
    });
    let granted: string[] = [];
    let skipped: string[] = [];
    if (Array.isArray(scopes) && scopes.length > 0) {
      const known = await knownScopes();
      const wanted = [...new Set(scopes.map((x) => String(x).trim().toLowerCase()))];
      skipped = wanted.filter((x) => !known.has(x));
      const approved = wanted.filter((x) => known.has(x));
      if (approved.length) {
        await addGrants({ principal, scopes: approved, grantedBy: req.user!.id, onBehalfOfUserId: null });
        granted = approved;
      }
    }
    res.status(201).json({ success: true, principal, granted, skipped });
  } catch (error) {
    fail(res, error);
  }
});

const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PICTURE_MAX_BYTES = 5 * 1024 * 1024;

router.post('/principals/:id/picture', authMiddleware.requireAdminOrOwner, uploadConfig.single('picture'), async (req, res) => {
  try {
    const principal = await principalInMyWorkspace(req);
    const file = req.file;
    if (!file) throw new ClawAgentError('No file provided', 400);
    if (!PICTURE_TYPES.has(file.mimetype)) throw new ClawAgentError('Only JPG, PNG and WebP images are allowed', 400);
    if (file.size > PICTURE_MAX_BYTES) throw new ClawAgentError('Image is larger than 5 MB', 413);
    const picture = await UserManagementService.getInstance().uploadProfilePicture(principal.botUserId, file);
    res.json({ success: true, picture });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/principals/:id', authMiddleware.requireAdminOrOwner, async (req, res) => {
  try {
    await disablePrincipal(await principalInMyWorkspace(req), req.user!.id);
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/principals/:id/grants', async (req, res) => {
  try {
    const principal = await principalInMyWorkspace(req);
    const all = await listGrants(principal);
    const visible = isAdmin(req)
      ? all
      : all.filter((g) => g.onBehalfOfUserId === null || g.onBehalfOfUserId === req.user!.id);
    res.json({ success: true, grants: visible });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/principals/:id/grants', authMiddleware.requireAdminOrOwner, async (req, res) => {
  try {
    const principal = await principalInMyWorkspace(req);
    const scopes = await validateScopes((req.body ?? {}).scopes);
    const added = await addGrants({ principal, scopes, grantedBy: req.user!.id, onBehalfOfUserId: null });
    res.status(201).json({ success: true, added });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/principals/:id/delegations', async (req, res) => {
  try {
    const principal = await principalInMyWorkspace(req);
    const scopes = await validateScopes((req.body ?? {}).scopes);
    const expiresAt = parseExpiry((req.body ?? {}).expiresAt);
    const added = await addGrants({
      principal,
      scopes,
      grantedBy: req.user!.id,
      onBehalfOfUserId: req.user!.id,
      expiresAt,
    });
    res.status(201).json({ success: true, added, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/principals/:id/grants/:grantId', async (req, res) => {
  try {
    await revokeGrant({
      principal: await principalInMyWorkspace(req),
      grantId: String(req.params.grantId ?? ''),
      actorUserId: req.user!.id,
      actorIsAdmin: isAdmin(req),
    });
    res.json({ success: true });
  } catch (error) {
    fail(res, error);
  }
});

export { router as clawAgentRoutes };
