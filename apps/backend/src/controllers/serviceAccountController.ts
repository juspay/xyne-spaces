import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../utils/logger';
import {
  connectResources,
  createKey,
  createServiceAccount,
  disconnectResource,
  getServiceAccount,
  listServiceAccounts,
  revokeKey,
  updateServiceAccount,
  type Caller,
} from '@/serviceAccounts/admin';
import { KEY_MAX_TTL_DAYS, ServiceAccountResourceType, ServiceAccountStatus } from '@/serviceAccounts/constants';
import { HTTP_STATUS, ServiceAccountError } from '@/serviceAccounts/errors';

const channelIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(100);

const CreateServiceAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const UpdateServiceAccountSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: z.nativeEnum(ServiceAccountStatus).optional(),
});

const ConnectChannelsSchema = z.object({ channelIds: channelIdsSchema });

const CreateKeySchema = z.object({ expiresInDays: z.number().int().min(1).max(KEY_MAX_TTL_DAYS) });

export class ServiceAccountController {
  private caller(req: Request): Caller {
    const user = req.user!;
    return { id: user.id, workspaceId: user.workspaceId, role: user.role };
  }

  private handleError(req: Request, res: Response, error: unknown): void {
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    if (error instanceof ServiceAccountError) {
      res.status(HTTP_STATUS[error.code]).json({ error: error.message });
      return;
    }
    logger.error('Error handling service account request:', { path: req.originalUrl, error });
    res.status(500).json({ error: 'Internal server error' });
  }

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json({ serviceAccounts: await listServiceAccounts(this.caller(req)) });
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name } = CreateServiceAccountSchema.parse(req.body);
      res.status(201).json(await createServiceAccount(this.caller(req), { name }));
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      res.status(200).json(await getServiceAccount(this.caller(req), req.params.id));
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const input = UpdateServiceAccountSchema.parse(req.body);
      res.status(200).json(await updateServiceAccount(this.caller(req), req.params.id, input));
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  connectChannels = async (req: Request, res: Response): Promise<void> => {
    try {
      const { channelIds } = ConnectChannelsSchema.parse(req.body);
      const view = await connectResources(this.caller(req), req.params.id, ServiceAccountResourceType.CHANNEL, channelIds);
      res.status(200).json(view);
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  disconnectChannel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, channelId } = req.params;
      res.status(200).json(await disconnectResource(this.caller(req), id, ServiceAccountResourceType.CHANNEL, channelId));
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  createKey = async (req: Request, res: Response): Promise<void> => {
    try {
      const { expiresInDays } = CreateKeySchema.parse(req.body);
      res.status(201).json(await createKey(this.caller(req), req.params.id, expiresInDays));
    } catch (error) {
      this.handleError(req, res, error);
    }
  };

  revokeKey = async (req: Request, res: Response): Promise<void> => {
    try {
      await revokeKey(this.caller(req), req.params.id, req.params.keyId);
      res.status(200).json({ success: true });
    } catch (error) {
      this.handleError(req, res, error);
    }
  };
}

export const serviceAccountController = new ServiceAccountController();
