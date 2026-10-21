import type {
  Action,
  ResourceRef,
  ResourceType,
  WorkflowAuthorizer,
} from '@xyne/workflow-sdk';
import {
  CONTAINER_ACTIONS,
  CREDENTIAL_ACTIONS,
  EXECUTION_ACTIONS,
  FOLDER_ACTIONS,
  WORKFLOW_ACTIONS,
} from '@xyne/workflow-sdk';
import { AccessType } from '@xyne/shared';
import { executionWorkspacesQuery } from '@/bypassAcl/workflowServices';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { attrsOf } from './utils';
import type { XyneCtx, XyneFilter } from './types';

const FOLDER_FULL: readonly Action[] = [...FOLDER_ACTIONS, ...CONTAINER_ACTIONS];

const ROOT_FULL: readonly Action[] = [...CONTAINER_ACTIONS, ...CREDENTIAL_ACTIONS];

const DENIED: readonly Action[] = [];

const APPROVE: Action = 'workflow:approve';

const WORKFLOW_MAKER: readonly Action[] = WORKFLOW_ACTIONS.filter((a) => a !== APPROVE);

const AUTOMATIONS_RESOURCE_NAME = 'AUTOMATIONS';

export class XyneWorkflowAuthorizer implements WorkflowAuthorizer<XyneCtx, XyneFilter> {
  async permissions(ctx: XyneCtx, ref: ResourceRef): Promise<readonly Action[]> {
    const [actions] = await this.permissionsBatch(ctx, [ref]);
    return actions ?? DENIED;
  }

  async permissionsBatch(
    ctx: XyneCtx,
    refs: readonly ResourceRef[],
  ): Promise<ReadonlyArray<readonly Action[]>> {
    const executionIds = refs.flatMap((ref) => (ref.type === 'execution' ? [ref.id] : []));
    const [workspaceOf, mayApprove] = await Promise.all([
      this.executionWorkspaces(executionIds),
      this.mayApprove(ctx),
    ]);
    return refs.map((ref) => this.decide(ctx, ref, workspaceOf, mayApprove));
  }

  visibleFilter(ctx: XyneCtx, _type: ResourceType): Promise<XyneFilter> {
    return Promise.resolve({ workspaceId: ctx.workspaceId });
  }

  private async mayApprove(ctx: XyneCtx): Promise<boolean> {
    try {
      const resource = await repositories.resources.findByName(AUTOMATIONS_RESOURCE_NAME);
      if (!resource) {
        logger.warn(
          '[workflows] AUTOMATIONS resource is not configured — nobody can approve a gated workflow. Run scripts/seed-acl.ts.',
        );
        return false;
      }
      return await repositories.resourceAccess.hasAccess(
        ctx.userId,
        resource.id,
        AccessType.ADMIN,
      );
    } catch (err) {
      logger.error('[workflows] could not decide approval rights:', err);
      return false;
    }
  }

  private decide(
    ctx: XyneCtx,
    ref: ResourceRef,
    workspaceOf: ReadonlyMap<string, string>,
    mayApprove: boolean,
  ): readonly Action[] {
    switch (ref.type) {
      case 'root':
        return mayApprove ? [...ROOT_FULL, APPROVE] : ROOT_FULL;

      case 'workflow':
        if (!this.sameWorkspace(ctx, ref.record.attributes)) return DENIED;
        return mayApprove ? WORKFLOW_ACTIONS : WORKFLOW_MAKER;

      case 'folder':
        return this.sameWorkspace(ctx, ref.record.attributes) ? FOLDER_FULL : DENIED;

      case 'credential':
        return this.sameWorkspace(ctx, ref.record.attributes)
          ? CREDENTIAL_ACTIONS
          : DENIED;

      case 'execution':
        return workspaceOf.get(ref.id) === ctx.workspaceId ? EXECUTION_ACTIONS : DENIED;

      case 'approvalStep':
        return DENIED;
    }
  }

  /**
   * The workspace each run belongs to, from the run's own tenant key. Execution
   * records carry no attributes, and runs are read across workspaces (the worker
   * needs any of them), so this is the check that keeps a run inside its workspace.
   */
  private async executionWorkspaces(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await executionWorkspacesQuery(ids);
    return new Map(rows.map((row) => [row.id, row.workspaceId]));
  }

  private sameWorkspace(ctx: XyneCtx, attributes: unknown): boolean {
    const workspaceId = attrsOf(attributes)?.workspaceId;
    return workspaceId !== undefined && workspaceId === ctx.workspaceId;
  }
}
