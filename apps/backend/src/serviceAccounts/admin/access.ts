// Who may manage service accounts from Spaces: connecting a resource needs admin of it; managing an
// account needs being a workspace owner/admin, its creator, or admin of all its resources. Guests can do neither.
import type { ServiceAccount } from '@prisma/client';
import { WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import type { ServiceAccountResourceType } from '../constants';
import { ServiceAccountError } from '../errors';
import { resourceType } from '../resources';

/** The signed-in user making the change. */
export interface Caller {
  id: string;
  workspaceId: string;
  role: string;
}

export interface AccountResource {
  type: ServiceAccountResourceType;
  id: string;
}

export interface ServiceAccountView {
  id: string;
  name: string;
  status: string;
  resources: AccountResource[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function toView(account: ServiceAccount, resources: AccountResource[]): ServiceAccountView {
  return {
    id: account.id,
    name: account.name,
    status: account.status,
    resources,
    createdBy: account.createdBy,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export async function resourcesOf(serviceAccountId: string): Promise<AccountResource[]> {
  const rows = await db.serviceAccountResource.findMany({
    where: { serviceAccountId },
    select: { resourceType: true, resourceId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({ type: row.resourceType as ServiceAccountResourceType, id: row.resourceId }));
}

function byType(resources: AccountResource[]): Map<ServiceAccountResourceType, string[]> {
  const grouped = new Map<ServiceAccountResourceType, string[]>();
  for (const resource of resources) grouped.set(resource.type, [...(grouped.get(resource.type) ?? []), resource.id]);
  return grouped;
}

export class ServiceAccountAdminPolicy {
  constructor(readonly caller: Caller) {
    if (caller.role === WorkspaceRole.GUEST) {
      throw new ServiceAccountError('forbidden', 'Guests cannot manage service accounts.');
    }
  }

  async administers(type: ServiceAccountResourceType, ids: string[]): Promise<Set<string>> {
    return resourceType(type).administeredBy(this.caller.id, ids);
  }

  async canManage(account: ServiceAccount, resources: AccountResource[]): Promise<boolean> {
    if (this.caller.role === WorkspaceRole.OWNER || this.caller.role === WorkspaceRole.ADMIN) return true;
    if (account.createdBy === this.caller.id) return true;
    if (resources.length === 0) return false;
    for (const [type, ids] of byType(resources)) {
      const administered = await this.administers(type, ids);
      if (!ids.every((id) => administered.has(id))) return false;
    }
    return true;
  }

  /** A service account in the caller's workspace, whether or not they may manage it. */
  async load(id: string): Promise<{ account: ServiceAccount; resources: AccountResource[] }> {
    const account = await db.serviceAccount.findFirst({ where: { id, workspaceId: this.caller.workspaceId } });
    if (!account) throw new ServiceAccountError('not_found', 'Service account not found.');
    return { account, resources: await resourcesOf(id) };
  }

  /** Accounts the caller can't manage are reported as missing. */
  async loadManaged(id: string): Promise<{ account: ServiceAccount; resources: AccountResource[] }> {
    const loaded = await this.load(id);
    if (!(await this.canManage(loaded.account, loaded.resources))) {
      throw new ServiceAccountError('not_found', 'Service account not found.');
    }
    return loaded;
  }

  async assertCanConnect(type: ServiceAccountResourceType, ids: string[]): Promise<void> {
    await resourceType(type).assertUsable(this.caller.workspaceId, ids);
    const administered = await this.administers(type, ids);
    const notAdmin = ids.filter((id) => !administered.has(id));
    if (notAdmin.length > 0) {
      throw new ServiceAccountError('forbidden', `You must be an admin of ${notAdmin.join(', ')} to connect it.`);
    }
  }

  async assertCanDisconnect(account: ServiceAccount, resources: AccountResource[], resource: AccountResource): Promise<void> {
    if ((await this.administers(resource.type, [resource.id])).has(resource.id)) return;
    if (await this.canManage(account, resources)) return;
    throw new ServiceAccountError('forbidden', 'You must be an admin of it or able to manage this service account.');
  }
}
