// The xyne-spaces authorizer — the policy decision point the SDK's enforcement
// calls.
//
// Access to the v2 engine is the WORKFLOW-STUDIO ACL resource (see
// accessControl.ts), so within a workspace everything is visible to everyone
// holding that grant — the same flat model automations use. Cross-workspace is
// a hard deny. The one distinction this makes is the ADMIN grant, which adds
// approving paused executions and managing credentials; the gate resolved it
// once for the request and put it on ctx.

import { db } from '@/database/client';
import type { WorkflowAuthorizer, ResourceRef, Action } from '@xyne/workflow-sdk';
import {
  WORKFLOW_ACTIONS,
  FOLDER_ACTIONS,
  CONTAINER_ACTIONS,
  EXECUTION_ACTIONS,
  CREDENTIAL_ACTIONS,
} from '@xyne/workflow-sdk';
import { SDK_WORKFLOW_TYPE } from './acl';
import type { XyneCtx, XyneFilter, XyneResourceAttrs } from './acl';

const WF_FULL: readonly Action[] = WORKFLOW_ACTIONS;
const FLD_FULL: readonly Action[] = [...FOLDER_ACTIONS, ...CONTAINER_ACTIONS];
const EXEC_FULL: readonly Action[] = EXECUTION_ACTIONS;
const EXEC_NON_ADMIN: readonly Action[] = EXECUTION_ACTIONS.filter(a => a !== 'execution:approve');
const CREDENTIAL_FULL: readonly Action[] = CREDENTIAL_ACTIONS;
const CREDENTIAL_VIEW: readonly Action[] = ['credential:read'];

const attrsOf = (ref: ResourceRef): XyneResourceAttrs | undefined =>
  ref.type === 'root'
    ? undefined
    : ((ref.record as { attributes?: unknown }).attributes as XyneResourceAttrs | undefined);

export class XyneWorkflowAuthorizer implements WorkflowAuthorizer<XyneCtx, XyneFilter> {
  async permissions(ctx: XyneCtx, ref: ResourceRef): Promise<readonly Action[]> {
    // Creating anything needs only the grant; `credential:manage` here is what
    // gates creating a credential, so it follows the ADMIN rule.
    if (ref.type === 'root') {
      return ctx.isAdmin ? [...CONTAINER_ACTIONS, 'credential:manage'] : CONTAINER_ACTIONS;
    }

    if (ref.type === 'execution') {
      // Executions carry only workflowId — resolve the owning workflow's
      // workspace off the shared legacy table.
      const wf = await db.workflow.findFirst({
        where: { id: ref.record.workflowId, workflowType: SDK_WORKFLOW_TYPE },
        select: { workspaceId: true },
      });
      if (!wf || wf.workspaceId !== ctx.workspaceId) return [];
      return ctx.isAdmin ? EXEC_FULL : EXEC_NON_ADMIN;
    }

    if (ref.type === 'workflow' || ref.type === 'folder' || ref.type === 'credential') {
      const a = attrsOf(ref);
      if (a?.workspaceId !== ctx.workspaceId) return []; // cross-workspace hard deny
      if (ref.type === 'workflow') return WF_FULL;
      if (ref.type === 'folder') return FLD_FULL;
      return ctx.isAdmin ? CREDENTIAL_FULL : CREDENTIAL_VIEW;
    }

    return []; // approvalStep — deferred
  }

  async permissionsBatch(
    ctx: XyneCtx,
    refs: readonly ResourceRef[],
  ): Promise<ReadonlyArray<readonly Action[]>> {
    return Promise.all(refs.map(ref => this.permissions(ctx, ref)));
  }

  visibleFilter(ctx: XyneCtx): Promise<XyneFilter> {
    return Promise.resolve({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
  }
}
