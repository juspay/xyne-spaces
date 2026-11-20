import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { attrsOf } from '@/workflowsV2/utils';

/** The tenant this run acts as. Throws rather than writing to the wrong one. */
export function workspaceOf(ctx: StepExecutionContext, stepType: string): string {
  const workspaceId = attrsOf(ctx.runtime.attributes)?.workspaceId;
  if (!workspaceId) throw new Error(`[${stepType}] workflow has no workspace`);
  return workspaceId;
}
