import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { GuestError, createGuest, issueGuestToken, listGuests, updateGuest, type GuestApp } from '../core/guestUtils';

const email = z.string().trim().email().max(254);
const displayName = z.string().trim().min(1).max(80);
const channelIds = z.array(z.string().min(1).max(64)).min(1).max(100);

const CreateGuestBodySchema = z.object({ email, displayName, channelIds }).strict();

const ListGuestsBodySchema = z
  .object({
    emails: z.array(email).min(1).max(100).optional(),
    channelId: z.string().min(1).max(64).optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

const UpdateGuestBodySchema = z
  .object({
    email,
    displayName: displayName.optional(),
    addChannelIds: channelIds.optional(),
    removeChannelIds: channelIds.optional(),
    status: z.literal('DEACTIVATED').optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.displayName !== undefined ||
      body.addChannelIds !== undefined ||
      body.removeChannelIds !== undefined ||
      body.status !== undefined,
    { message: 'Send at least one field to change besides email.' },
  );

const GuestTokenBodySchema = z.object({ email }).strict();

/** The app from its verified token: authenticateApp sets req.auth and req.user (the app's bot). */
function guestApp(req: Request): GuestApp {
  return {
    installedAppId: (req as any).auth.installedAppId,
    botUserId: req.user!.id,
    workspaceId: req.user!.workspaceId!,
  };
}

export class GuestController {
  /**
   * Create a guest in channels the app created
   * POST /api/apps/guests/create
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = CreateGuestBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    try {
      res.status(201).json(await createGuest(guestApp(req), bodyResult.data));
    } catch (error) {
      this.fail(res, error, 'create');
    }
  };

  /**
   * List the app's guests
   * POST /api/apps/guests/get
   */
  list = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = ListGuestsBodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    try {
      res.status(200).json(await listGuests(guestApp(req), bodyResult.data));
    } catch (error) {
      this.fail(res, error, 'list');
    }
  };

  /**
   * Rename a guest, change its channels, or deactivate it
   * POST /api/apps/guests/update
   */
  update = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = UpdateGuestBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    try {
      res.status(200).json(await updateGuest(guestApp(req), bodyResult.data));
    } catch (error) {
      this.fail(res, error, 'update');
    }
  };

  /**
   * A Spaces SDK token for one of the app's guests
   * POST /api/apps/guests/token
   */
  token = async (req: Request, res: Response): Promise<void> => {
    const bodyResult = GuestTokenBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: bodyResult.error.errors });
      return;
    }
    try {
      res.status(200).json(await issueGuestToken(guestApp(req), bodyResult.data.email));
    } catch (error) {
      this.fail(res, error, 'token');
    }
  };

  private fail(res: Response, error: unknown, action: string): void {
    if (error instanceof GuestError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    logger.error(`[APP-GUESTS] Guest ${action} failed:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
