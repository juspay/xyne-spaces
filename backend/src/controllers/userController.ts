import { Request, Response } from 'express';
import { createId } from '@paralleldrive/cuid2';
import { DatabaseClient } from '@/database/client';
import {logger} from '@/utils/logger';

const prisma = DatabaseClient.getInstance();

export const createUser = async (req: Request, res: Response) => {
  const { name, email } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.API_KEY_USER) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
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
      },
    });

    const resources = await prisma.resource.findMany({
      where: {
        name: {
          notIn: ['USER-MANAGEMENT', 'USER-GROUPS'],
        },
      },
    });

    for (const resource of resources) {
      await prisma.resourceAccess.create({
        data: {
          userId: newUser.id,
          resourceId: resource.id,
          accessType: 'READ',
        },
      });
    }

    return res.status(201).json(newUser);
  } catch (error) {
    logger.error('Error creating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
