import { Request, Response } from 'express';
import { UserGroupRepository } from '@/database/repositories/userGroups';
import {logger} from '@/utils/logger';

const userGroupRepository = new UserGroupRepository();

export class UserGroupController {
  // Removed: getAllGroups, getGroupById - moved to Zero queries

  /**
   * Create user group
   */
  createGroup = async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, alias, description, metadata, userIds } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      // Validate userIds if provided
      if (userIds && Array.isArray(userIds)) {
        // Basic validation - users should be strings
        for (const userId of userIds) {
          if (!userId || typeof userId !== 'string') {
            res.status(400).json({ error: 'All user IDs must be valid strings' });
            return;
          }
        }
      }

      const group = await userGroupRepository.createWithUsers({
        name,
        alias: alias || null, // Allow null if alias not provided
        description,
        metadata,
        userIds: userIds && userIds.length > 0 ? userIds : undefined,
        workspace: { connect: { id: req.user!.workspaceId! } }
      }, req.user?.id);

      res.status(201).json(group);
    } catch (error: any) {
      logger.error('Error creating user group:', error);

      // Handle validation errors from repository
      if (error.message.includes('alias')) {
        res.status(400).json({ error: error.message });
        return;
      }

      // Handle Prisma unique constraint error (duplicate name or alias)
      if (error.code === 'P2002') {
        const constraint = error.meta?.target;
        if (constraint?.includes('alias')) {
          res.status(400).json({ error: 'Group alias is already taken' });
        } else {
          res.status(400).json({ error: 'A group with this name already exists' });
        }
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  };

}
