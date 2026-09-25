import { UserStatus } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';

const prisma = DatabaseClient.getInstance();

export const ASSIGNEE_INACTIVE_CODE = 'ASSIGNEE_INACTIVE';

/**
 * Explicit assignments — an integration naming an assignee, an automation with a
 * fixed user — skip the assignment engine, and with it the engine's filter on
 * deactivated users. Without this check a departed user keeps receiving tickets
 * from any stale integration mapping or automation rule, with nothing surfacing it.
 */
export function isInactiveUser(user: { status: string } | null | undefined): boolean {
  return user?.status === UserStatus.INACTIVE;
}

export async function isInactiveUserId(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  return isInactiveUser(user);
}

export function inactiveAssigneeMessage(userLabel: string): string {
  return `User ${userLabel} is deactivated and cannot be assigned`;
}
