import { ShareableEntityType } from '@xyne/shared';
import { db } from '@/database/client';
import { WORKFLOWS_SCOPE } from '@/workflowsV2/constants';

/**
 * The resource kinds an admin can attach to an installed app. Adding one is an entry here
 * plus a `ShareableEntityType` value; storage, service, routes and UI are already generic.
 *
 * Enforcement is not, and cannot be: each feature decides where it calls `isAttached` and
 * what an attachment means. A `PROJECT` kind would be checked by resolving a ticket's
 * project and asking whether THAT is attached — same storage, different rule.
 */
export interface AttachableResource {
  /** URL segment, and the key the dashboard uses. */
  kind: string;
  entityType: ShareableEntityType;
  /**
   * Those of `ids` that exist in this workspace, named. The only lookup a kind implements:
   * it labels the UI, drops grants whose target was deleted, and by omission tells the
   * write path which ids to reject.
   */
  describe(ids: string[], workspaceId: string): Promise<{ id: string; name: string }[]>;
}

const workflows: AttachableResource = {
  kind: 'workflows',
  entityType: ShareableEntityType.WORKFLOW,

  async describe(ids, workspaceId) {
    const rows = await db.workflow.findMany({
      where: { id: { in: ids }, workspaceId, ...WORKFLOWS_SCOPE },
      select: { id: true, workflowName: true },
    });
    return rows.map(row => ({ id: row.id, name: row.workflowName ?? row.id }));
  },
};

const ATTACHABLE_RESOURCES: readonly AttachableResource[] = [workflows];

export const attachableResourceFor = (kind: string): AttachableResource | undefined =>
  ATTACHABLE_RESOURCES.find(resource => resource.kind === kind);
