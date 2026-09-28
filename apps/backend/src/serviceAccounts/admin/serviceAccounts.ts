import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { withWorkspaceScope } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { ServiceAccountStatus } from '../constants';
import {
  ServiceAccountAdminPolicy,
  resourcesOf,
  toView,
  type AccountResource,
  type Caller,
  type ServiceAccountView,
} from './access';

export interface ServiceAccountKeyView {
  id: string;
  status: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdBy: string;
  createdAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
}

export function createServiceAccount(
  caller: Caller,
  input: { name: string; resources: AccountResource[] },
): Promise<ServiceAccountView> {
  return withWorkspaceScope(async () => {
    const policy = new ServiceAccountAdminPolicy(caller);
    const resources = input.resources.filter(
      (r, i, all) => all.findIndex((o) => o.type === r.type && o.id === r.id) === i,
    );
    for (const type of new Set(resources.map((r) => r.type))) {
      await policy.assertCanConnect(type, resources.filter((r) => r.type === type).map((r) => r.id));
    }

    const account = await db.$transaction(async (tx) => {
      const created = await tx.serviceAccount.create({
        data: {
          workspaceId: caller.workspaceId,
          name: input.name,
          status: ServiceAccountStatus.ACTIVE,
          createdBy: caller.id,
        },
      });
      await tx.serviceAccountResource.createMany({
        data: resources.map((r) => ({
          workspaceId: caller.workspaceId,
          serviceAccountId: created.id,
          resourceType: r.type,
          resourceId: r.id,
          addedBy: caller.id,
        })),
      });
      return created;
    });
    logger.info('[service-account] created', { serviceAccountId: account.id, by: caller.id, resources });
    return toView(account, resources);
  });
}

/** The ones the caller may manage. */
export function listServiceAccounts(caller: Caller): Promise<ServiceAccountView[]> {
  return withWorkspaceScope(async () => {
    const policy = new ServiceAccountAdminPolicy(caller);
    const all = await db.serviceAccount.findMany({ where: { workspaceId: caller.workspaceId }, orderBy: { createdAt: 'asc' } });
    const views: ServiceAccountView[] = [];
    for (const account of all) {
      const resources = await resourcesOf(account.id);
      if (await policy.canManage(account, resources)) views.push(toView(account, resources));
    }
    return views;
  });
}

export function getServiceAccount(caller: Caller, id: string): Promise<ServiceAccountView & { keys: ServiceAccountKeyView[] }> {
  return withWorkspaceScope(async () => {
    const { account, resources } = await new ServiceAccountAdminPolicy(caller).loadManaged(id);
    const keys = await db.serviceAccountKey.findMany({ where: { serviceAccountId: id }, orderBy: { createdAt: 'desc' } });
    return {
      ...toView(account, resources),
      keys: keys.map((key) => ({
        id: key.id,
        status: key.status,
        expiresAt: key.expiresAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        createdBy: key.createdBy,
        createdAt: key.createdAt.toISOString(),
        revokedBy: key.revokedBy,
        revokedAt: key.revokedAt?.toISOString() ?? null,
      })),
    };
  });
}

export function updateServiceAccount(
  caller: Caller,
  id: string,
  input: {
    name?: string;
    status?: ServiceAccountStatus;
  },
): Promise<ServiceAccountView> {
  return withWorkspaceScope(async () => {
    const { resources } = await new ServiceAccountAdminPolicy(caller).loadManaged(id);

    const data: Prisma.ServiceAccountUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.status !== undefined) data.status = input.status;
    const updated = await db.serviceAccount.update({ where: { id }, data });
    logger.info('[service-account] updated', { serviceAccountId: id, by: caller.id, fields: Object.keys(data) });
    return toView(updated, resources);
  });
}
