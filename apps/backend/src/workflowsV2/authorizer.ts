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
import { attrsOf } from './utils';
import type { XyneCtx, XyneFilter } from './types';

const FOLDER_FULL: readonly Action[] = [...FOLDER_ACTIONS, ...CONTAINER_ACTIONS];

const ROOT_FULL: readonly Action[] = [...CONTAINER_ACTIONS, ...CREDENTIAL_ACTIONS];

const DENIED: readonly Action[] = [];

export class XyneWorkflowAuthorizer implements WorkflowAuthorizer<XyneCtx, XyneFilter> {
  async permissions(ctx: XyneCtx, ref: ResourceRef): Promise<readonly Action[]> {
    return Promise.resolve(this.decide(ctx, ref));
  }

  async permissionsBatch(
    ctx: XyneCtx,
    refs: readonly ResourceRef[],
  ): Promise<ReadonlyArray<readonly Action[]>> {
    return Promise.resolve(refs.map((ref) => this.decide(ctx, ref)));
  }

  visibleFilter(ctx: XyneCtx, _type: ResourceType): Promise<XyneFilter> {
    return Promise.resolve({ workspaceId: ctx.workspaceId });
  }

  private decide(ctx: XyneCtx, ref: ResourceRef): readonly Action[] {
    switch (ref.type) {
      case 'root':
        // Every workspace member may create at the top level and manage credentials.
        return ROOT_FULL;

      case 'workflow':
        return this.sameWorkspace(ctx, ref.record.attributes) ? WORKFLOW_ACTIONS : DENIED;

      case 'folder':
        return this.sameWorkspace(ctx, ref.record.attributes) ? FOLDER_FULL : DENIED;

      case 'credential':
        return this.sameWorkspace(ctx, ref.record.attributes)
          ? CREDENTIAL_ACTIONS
          : DENIED;

      case 'execution':
      case 'approvalStep':
        return ref.type === 'execution' ? EXECUTION_ACTIONS : DENIED;
    }
  }

  private sameWorkspace(ctx: XyneCtx, attributes: unknown): boolean {
    const workspaceId = attrsOf(attributes)?.workspaceId;
    return workspaceId !== undefined && workspaceId === ctx.workspaceId;
  }
}
