import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { createUser, listUsers, updateUser } from '@/serviceAccounts/users';

const email = z.string().trim().email().max(254);
const displayName = z.string().trim().min(1).max(80);
const channelIds = z.array(z.string().min(1).max(64)).min(1).max(100);
const status = z.enum(['ACTIVE', 'DEACTIVATED']);

const CreateUserSchema = z.object({ email, displayName, channelIds }).strict();

const ListUsersSchema = z
  .object({
    emails: z.array(email).min(1).max(100).optional(),
    channelId: z.string().min(1).max(64).optional(),
    status: status.optional(),
    limit: z.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();

const UpdateUserSchema = z
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

export class S2sUserController {
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = CreateUserSchema.parse(req.body);
      res.status(201).json(await createUser(req.serviceAccount!, input));
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = ListUsersSchema.parse(req.body ?? {});
      res.status(200).json(await listUsers(req.serviceAccount!, input));
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = UpdateUserSchema.parse(req.body);
      res.status(200).json(await updateUser(req.serviceAccount!, input));
    } catch (err) {
      next(err);
    }
  };
}
