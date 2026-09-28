import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { MessageType } from '@xyne/shared';
import { conversationService } from '@/services/conversationService';
import { AutomationRunStatus } from '@/automations/types/status';
import { AUTOMATION_WORKFLOW_TYPE } from '@/automations/types/workflow-adapter';
import { runDeskLabelBackfill } from '@/automations/services/desk-label-backfill.service';
import type { AutomationExecutor } from '@/automations/engine/automation-executor';
import type { AutomationWorker } from '@/automations/queue/automation.worker';
import { asService } from './base';

/**
 * Relocated from automations/queue/automation-schedule.worker.ts's runJob. Background job → no
 * HTTP tenant scope; the executor's step writes all read the ambient workspace, so this opens
 * one from the schedule's own workspaceId.
 */
export function runScheduledAutomation(
  workspaceId: string,
  executor: AutomationExecutor,
  executionId: string,
): ReturnType<AutomationExecutor['runExecution']> {
  return asService(
    ['WorkflowExecution'],
    'scheduled automation run: background job has no request context, executor writes read the ambient workspace',
    'automation',
    workspaceId,
    () => executor.runExecution(executionId),
  );
}

/**
 * Relocated from automations/queue/automation.worker.ts's processJob. Same reasoning as
 * runScheduledAutomation: a queue job has no caller, the executor's writes need an open scope.
 */
export function runAutomationQueueJob(
  worker: AutomationWorker,
  workspaceId: string,
  ...args: Parameters<AutomationWorker['runJob']>
): Promise<void> {
  return asService(
    ['WorkflowExecution'],
    'automation queue job: background job has no request context, executor writes read the ambient workspace',
    'automation',
    workspaceId,
    () => worker.runJob(...args),
  );
}

/**
 * Relocated from automations/engine/event-router.ts's routeEvent. Creates the root execution +
 * state row for a matched automation. Event routing runs off a dispatched event, not a request,
 * so there is no caller to scope to — workspaceId comes from the event itself.
 */
export function createAutomationExecutionForEvent(input: {
  workspaceId: string;
  workflowId: string;
  workflowType: string | null;
  initialContext: unknown;
}) {
  const { workspaceId, workflowId, workflowType, initialContext } = input;
  return asService(
    ['WorkflowExecution', 'WorkflowExecutionState'],
    'event-routed automation: dispatched event has no caller, workspaceId comes from the event',
    'automation',
    workspaceId,
    () =>
      db.$transaction(async tx => {
        const created = await tx.workflowExecution.create({
          data: {
            workflowId,
            workflowType,
            status: AutomationRunStatus.PENDING,
            tag: 'root',
            workspaceId,
          },
        });
        await tx.workflowExecutionState.create({
          data: {
            workflowExecutionId: created.id,
            context: JSON.stringify(initialContext),
            workspaceId,
          },
        });
        return created;
      }),
  );
}

/**
 * Relocated from automations/engine/event-router.ts's scopeMismatches. Reads a ticket's
 * board/project/channel to judge whether a candidate automation's scope filter can match, under
 * the same tenant scope the worker later hydrates under.
 */
export function ticketScopeForAutomationEvent(
  workspaceId: string,
  ticketId: string,
): Promise<{ boardId: string | null; projectId: string | null; channelId: string } | null> {
  return asService(
    ['Ticket'],
    'event routing pre-filter: ticket scope lookup under the same tenant scope the worker hydrates under',
    'automation',
    workspaceId,
    () =>
      db.ticket
        .findUnique({
          where: { id: ticketId },
          select: { boardId: true, projectId: true, channelId: true },
        })
        .catch(() => null),
  );
}

/**
 * Relocated from automations/routes/webhook-trigger.handler.ts's handler. Unauthenticated
 * webhook — no HTTP session to derive the tenant from, so this opens a scope explicitly off the
 * workflow's workspaceId, stamping it onto the execution row and the downstream job's writes.
 */
export function createAutomationExecutionForWebhook(input: {
  workspaceId: string;
  workflowId: string;
  initialContext: unknown;
}) {
  const { workspaceId, workflowId, initialContext } = input;
  return asService(
    ['WorkflowExecution', 'WorkflowExecutionState'],
    'unauthenticated webhook trigger: no HTTP session to derive the tenant from, scope opened off the workflow\'s own workspaceId',
    'automation-webhook',
    workspaceId,
    () =>
      db.$transaction(async tx => {
        const created = await tx.workflowExecution.create({
          data: {
            workflowId,
            workflowType: AUTOMATION_WORKFLOW_TYPE,
            status: AutomationRunStatus.PENDING,
            tag: 'root',
            workspaceId,
          },
        });
        await tx.workflowExecutionState.create({
          data: {
            workflowExecutionId: created.id,
            context: JSON.stringify(initialContext),
            workspaceId,
          },
        });
        return created;
      }),
  );
}

/**
 * Relocated from automations/services/approval-notifications.ts's sendApprovalDm. Sends a DM as
 * the approval requester — actor is the real user, not a fixed service marker, since the message
 * must display as sent by them.
 */
export function sendApprovalNotificationAsUser(
  fromUserId: string,
  toUserId: string,
  workspaceId: string,
  content: string,
): Promise<void> {
  return asService(
    ['Channel', 'ChannelParticipant', 'Conversation', 'Message'],
    'approval DM notification: sent as the requesting user, background job has no request context',
    fromUserId,
    workspaceId,
    async () => {
      const channelId = await repositories.channels.findOrCreateDMChannel(
        fromUserId,
        [toUserId],
        repositories.channelParticipants,
        workspaceId,
      );
      await conversationService.createConversationWithMessage({
        channelId,
        userId: fromUserId,
        content,
        msgType: MessageType.BOT,
        isBot: true,
      });
    },
  );
}

/**
 * Relocated from automations/queue/desk-label-backfill.worker.ts's processJob. Background job →
 * no HTTP tenant scope; opens one from the backfill rule's own workspaceId so every write in the
 * run gets workspaceId stamped.
 */
export function runDeskLabelBackfillForRule(
  rule: Parameters<typeof runDeskLabelBackfill>[0],
  onProgress: Parameters<typeof runDeskLabelBackfill>[1],
): ReturnType<typeof runDeskLabelBackfill> {
  return asService(
    ['Email', 'Conversation', 'ConversationLabelMapping'],
    'desk label backfill: background job has no request context, every write in the run needs workspaceId stamped',
    'desk-label-backfill',
    rule.workspaceId,
    () => runDeskLabelBackfill(rule, onProgress),
  );
}
