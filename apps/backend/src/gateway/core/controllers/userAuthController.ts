import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { getBackendUrl, getFrontendUrl, logger } from '../../re-exports';
import { GatewayError } from '../errors';
import { asyncRoute } from '../middleware/errorHandler';
import type { UserAuthService, UserAuthSession } from '../services/userAuthService';

const ConnectQuerySchema = z.object({
  // A path in the dashboard, never another site.
  returnTo: z
    .string()
    .max(500)
    .regex(/^\/(?![/\\])/)
    .optional(),
  platform: z.enum(['web', 'electron']).default('web'),
});
const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/** A person signs in with the provider so their messages from Spaces are posted as them, like desk's. */
export class UserAuthController {
  constructor(private readonly userAuth: UserAuthService) {}

  getStatus: RequestHandler = asyncRoute(async (req, res) => {
    res.json(await this.userAuth.getStatus(req.user!.id));
  });

  /** A browser navigation, so failures go back to the dashboard instead of showing JSON. */
  connect: RequestHandler = asyncRoute(async (req, res) => {
    const query = ConnectQuerySchema.parse(req.query);
    const session: UserAuthSession = {
      userId: req.user!.id,
      workspaceId: req.user!.workspaceId!,
      returnTo: query.returnTo ?? `/${req.user!.workspaceId}`,
      platform: query.platform,
    };
    try {
      res.redirect(await this.userAuth.buildConnectUrl(session, this.callbackUrl(req)));
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      res.redirect(this.dashboardUrl(req, session, `gatewayAuthError=${error.code}`));
    }
  });

  /** The provider's redirect after sign-in. No login: the one-time state says who signed in. */
  callback: RequestHandler = asyncRoute(async (req, res) => {
    const query = CallbackQuerySchema.parse(req.query);
    const session = query.state ? await this.userAuth.takeSession(query.state) : null;
    if (!session) {
      res.redirect(`${getFrontendUrl(req)}/?gatewayAuthError=EXPIRED`);
      return;
    }

    let result = 'gatewayAuth=connected';
    try {
      if (query.error || !query.code) {
        throw new GatewayError('VALIDATION_ERROR', query.error ?? 'No sign-in code');
      }
      await this.userAuth.saveUserToken(session, query.code, this.callbackUrl(req));
    } catch (error) {
      logger.warn('[Gateway] Sign-in failed', { userId: session.userId, error });
      result = `gatewayAuthError=${error instanceof GatewayError ? error.code : 'INTERNAL'}`;
    }
    res.redirect(this.dashboardUrl(req, session, result));
  });

  disconnect: RequestHandler = asyncRoute(async (req, res) => {
    await this.userAuth.disconnect(req.user!.id);
    res.status(204).send();
  });

  /** Under the provider's own routes, e.g. `/api/gateway/slack/user/callback`. */
  private callbackUrl(req: Request): string {
    return `${getBackendUrl(req)}${req.baseUrl}/user/callback`;
  }

  private dashboardUrl(req: Request, session: UserAuthSession, query: string): string {
    const path = `${session.returnTo}${session.returnTo.includes('?') ? '&' : '?'}${query}`;
    return session.platform === 'electron'
      ? `${getFrontendUrl(req)}/launch?path=${encodeURIComponent(path)}`
      : `${getFrontendUrl(req)}${path}`;
  }
}
