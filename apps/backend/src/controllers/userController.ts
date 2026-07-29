import { Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { WorkspaceRole } from '@prisma/client';
import { DatabaseClient, db } from '@/database/client';
import {logger} from '@/utils/logger';
import { grantPermissionsForRole } from '../services/permissionMatrix';

const prisma = DatabaseClient.getInstance();

export const createUser = async (req: Request, res: Response) => {
  const { name, email, workspaceId } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.API_KEY_USER) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!name || !email || !workspaceId) {
    return res.status(400).json({ error: 'Name, email and workspaceId are required' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email_workspaceId: { email, workspaceId } },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Fetch existing orgMember by email
    const orgMember = await db.orgMember.findUnique({
      where: { email },
      select: { memberId: true }
    });

    if (!orgMember) {
      return res.status(400).json({ error: 'User must be invited to the organization first' });
    }

    const userId = createId();
    const providerUserId = `manual-${email}`;

    const newUser = await prisma.user.create({
      data: {
        id: userId,
        name,
        email,
        providerUserId,
        authProvider: 'API_KEY',
        workspace: { connect: { id: workspaceId } },
        orgMember: { connect: { memberId: orgMember.memberId } },
      },
    });

    await grantPermissionsForRole(newUser.id, newUser.email, WorkspaceRole.MEMBER, newUser.workspaceId);

    return res.status(201).json(newUser);
  } catch (error) {
    logger.error('Error creating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
