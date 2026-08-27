import { db } from '@/database/client';

/**
 * Resolve the caller's editor role for an app.
 *
 * The app creator is always an implicit ADMIN (fallback for apps the collaborator backfill
 * hasn't reached); otherwise the role comes from the app_collaborators row, if any.
 */
export async function getAppEditorRole(
  appId: string,
  userId: string,
): Promise<string | null> {
  const app = await db.apps.findUnique({ where: { id: appId }, select: { createdBy: true } });
  if (!app) {
    throw new Error(`App with ID ${appId} not found`);
  }
  if (app.createdBy === userId) {
    return 'ADMIN';
  }

  const collaborator = await db.appCollaborator.findUnique({
    where: { appId_userId: { appId, userId } },
    select: { collaboratorType: true },
  });
  return collaborator?.collaboratorType ?? null;
}

/** Throws unless the user may edit the app template (creator or any collaborator). */
export async function assertCanEditApp(appId: string, userId: string): Promise<void> {
  const role = await getAppEditorRole(appId, userId);
  if (!role) {
    throw new Error('Unauthorized: only the app creator or a collaborator can modify this app');
  }
}

/** Throws unless the user may manage collaborators (creator or ADMIN collaborator). */
export async function assertCanManageCollaborators(appId: string, userId: string): Promise<void> {
  const role = await getAppEditorRole(appId, userId);
  if (role !== 'ADMIN') {
    throw new Error('Unauthorized: only an app admin can manage collaborators');
  }
}
