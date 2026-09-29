// What a service account may do. Endpoints never check access themselves; they ask this.
import type { ServiceAccount, User } from '@prisma/client';
import { db } from '@/database/client';
import type { ServiceAccountResourceType } from './constants';
import { ServiceAccountError } from './errors';
import { isOwnedBy } from './ownership';

export class ServiceAccountPolicy {
  constructor(readonly account: ServiceAccount) {}

  get workspaceId(): string {
    return this.account.workspaceId;
  }

  /** Refuses any resource the account wasn't given. */
  async assertCanGrant(type: ServiceAccountResourceType, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await db.serviceAccountResource.findMany({
      where: { serviceAccountId: this.account.id, resourceType: type, resourceId: { in: ids } },
      select: { resourceId: true },
    });
    const allowed = new Set(rows.map((row) => row.resourceId));
    const notAllowed = ids.filter((id) => !allowed.has(id));
    if (notAllowed.length > 0) {
      throw new ServiceAccountError(
        'forbidden',
        `${notAllowed.join(', ')} ${notAllowed.length === 1 ? 'is' : 'are'} not allowed for this service account.`,
        { reason: `${type.toLowerCase()}_not_allowed` },
      );
    }
  }

  /** The ids of this type the account was given. */
  async connectedIds(type: ServiceAccountResourceType): Promise<Set<string>> {
    const rows = await db.serviceAccountResource.findMany({
      where: { serviceAccountId: this.account.id, resourceType: type },
      select: { resourceId: true },
    });
    return new Set(rows.map((row) => row.resourceId));
  }

  canManageUser(user: Pick<User, 'providerUserId'>): boolean {
    return isOwnedBy(user, this.account.id);
  }
}
