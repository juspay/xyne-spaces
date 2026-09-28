import type { User } from '@prisma/client';
import { UserStatus } from '@xyne/shared';

/** A service account's users get providerUserId `service-account:<id>:<uuid>`, which never
 *  changes, unlike their guest_access rows. */
export function ownedUserPrefix(serviceAccountId: string): string {
  return `service-account:${serviceAccountId}:`;
}

export function isOwnedBy(user: Pick<User, 'providerUserId'>, serviceAccountId: string): boolean {
  return user.providerUserId.startsWith(ownedUserPrefix(serviceAccountId));
}

export function isActive(user: Pick<User, 'status' | 'leftAt'>): boolean {
  return user.status === UserStatus.ACTIVE && !user.leftAt;
}
