import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '@/database/client';

/** Body of the "start OAuth" call for desks connected by a provider redirect (Instagram, Facebook). */
export const oauthDeskStartSchema = z.object({
  name: z.string().trim().min(1).max(120),
  projectId: z.string().min(1),
  boardId: z.string().min(1).optional(),
  assigneeUserGroupId: z.preprocess(v => (typeof v === 'string' ? v.trim() || undefined : undefined), z.string().min(1).optional()),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'public', 'private']).default('PUBLIC'),
  platform: z.enum(['web', 'electron']).default('web'),
});

/**
 * Add-account and reconnect take only a platform. Reject a bad one here: otherwise it fails the
 * OAuth state check after the user has gone through the whole provider login. Sends the error itself.
 */
export function parseOAuthPlatform(req: Request, res: Response): 'web' | 'electron' | null {
  const parsed = oauthDeskStartSchema.shape.platform.safeParse(req.body?.platform);
  if (!parsed.success) {
    res.status(400).json({ error: 'platform must be "web" or "electron"' });
    return null;
  }
  return parsed.data;
}

/** Checks the chosen project/board/group exist and the channel name is free. Sends the error response itself. */
export async function validateOAuthDeskSetup(
  input: z.infer<typeof oauthDeskStartSchema>,
  workspaceId: string,
  res: Response,
): Promise<boolean> {
  const [project, board, group, duplicateChannel] = await Promise.all([
    db.project.findFirst({
      where: { id: input.projectId, workspaceId },
      select: { id: true },
    }),
    input.boardId
      ? db.board.findFirst({
          where: { id: input.boardId, projectId: input.projectId, workspaceId },
          select: { id: true },
        })
      : null,
    input.assigneeUserGroupId
      ? db.userGroup.findFirst({
          where: { id: input.assigneeUserGroupId, workspaceId, isActive: true },
          select: { id: true },
        })
      : null,
    db.channel.findFirst({
      where: { workspaceId, name: input.name },
      select: { id: true },
    }),
  ]);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return false;
  }
  if (input.boardId && !board) {
    res.status(404).json({ error: 'Board not found' });
    return false;
  }
  if (input.assigneeUserGroupId && !group) {
    res.status(404).json({ error: 'Assignee group not found' });
    return false;
  }
  if (duplicateChannel) {
    res.status(409).json({ error: 'A channel with this display name already exists' });
    return false;
  }
  return true;
}
