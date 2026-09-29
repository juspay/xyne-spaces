import type { Prisma } from '@prisma/client';
import type { ServiceAccountResourceType } from '../constants';

export type Tx = Prisma.TransactionClient;

/**
 * One kind of thing a service account can be given and hand to its users (a channel today).
 * Adding a kind means one definition like this, registered in ./index.ts.
 */
export interface ResourceType<Prepared = unknown> {
  type: ServiceAccountResourceType;
  assertUsable(workspaceId: string, ids: string[]): Promise<void>;
  administeredBy(userId: string, ids: string[]): Promise<Set<string>>;
  prepare(ids: string[]): Promise<Prepared>;
  grant(tx: Tx, args: { workspaceId: string; userId: string; id: string; grantedBy: string }, prepared: Prepared): Promise<void>;
  revoke(tx: Tx, args: { workspaceId: string; userId: string; id: string }): Promise<void>;
  heldBy(workspaceId: string, userIds: string[]): Promise<Map<string, string[]>>;
  grantees(workspaceId: string, id: string, grantedBy: string): Promise<string[]>;
}
