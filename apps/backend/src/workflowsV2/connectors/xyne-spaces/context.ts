import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { getAutomationsBotUserId } from '@/automations/steps/automations-bot';
import { attrsOf } from '@/workflowsV2/utils';

/**
 * The two things ported steps need that automations took from
 * `AutomationContext`, in one place so the mapping is stated once.
 */

/** The tenant this run acts as. Throws rather than writing to the wrong one. */
export function workspaceOf(ctx: StepExecutionContext, stepType: string): string {
  const workspaceId = attrsOf(ctx.runtime.attributes)?.workspaceId;
  if (!workspaceId) throw new Error(`[${stepType}] workflow has no workspace`);
  return workspaceId;
}

/**
 * Who a write is recorded as having been performed by.
 *
 * Automations names the rule's AUTHOR (`context.automation.createdById`). A
 * workflow run has no caller — a ticket was created, nobody clicked — and the
 * author did not perform this action either, so writes are attributed to the
 * workspace's automations bot. Three automations steps already do exactly this
 * for the same reason, and `isAutomation: true` is already on the rows.
 *
 * The consequence is visible: activity trails say the bot acted, not a person.
 */
export function actorOf(ctx: StepExecutionContext, stepType: string): Promise<string> {
  return getAutomationsBotUserId(workspaceOf(ctx, stepType));
}

/** The workflow's own id, where automations read `context.automation.id`. */
export function workflowIdOf(ctx: StepExecutionContext): string {
  return ctx.workflow.workflow.id;
}
