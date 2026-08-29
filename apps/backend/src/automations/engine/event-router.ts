import type { Workflow } from '@prisma/client';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { currentUpstreamChain } from './automation-context-storage';
import {
  AUTOMATION_WORKFLOW_TYPE,
  DESK_AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  parseAutomationMetadata,
  triggerTypeToEventType,
} from '../types/workflow-adapter';
import { AutomationStatus, AutomationRunStatus } from '../types/status';
import { automationQueue } from '../queue/automation.queue';
import type { AutomationEvent } from '../types/automation-events';
import { EMAIL_RECEIVED_EVENT } from '../triggers/email-received.trigger';
import {
  MESSAGE_RECEIVED_EVENT,
  MessageLocation,
  messageLocationMatches,
} from '../types/message-received-event';

class EventRouter {
  async emit(event: AutomationEvent, workspaceId: string): Promise<void> {
    const { type: eventType, payload } = event;
    const chain = currentUpstreamChain();

    const candidates = await this.findCandidates(event, workspaceId);

    if (candidates.length === 0) {
      logger.debug?.(
        `[EVENT-ROUTER] event=${eventType} workspaceId=${workspaceId} — 0 active automations match, dropping`,
      );
      return;
    }

    let enqueued = 0;

    for (const workflow of candidates) {
      try {
        const metadata = parseAutomationMetadata(workflow.metadata);
        const initialContext = {
          automation: {
            id: workflow.id,
            workspaceId: workflow.workspaceId,
            createdById: metadata.createdById,
          },
          trigger: { type: eventType, ...payload, data: payload },
          steps: {},
          __meta: { error: null, chain },
        };

        const execution = await runAsServiceActor('automation', workspaceId,
          () =>
            db.$transaction(async tx => {
              const created = await tx.workflowExecution.create({
                data: {
                  workflowId: workflow.id,
                  workflowType: workflow.workflowType,
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

        await automationQueue.enqueueRun({ executionId: execution.id });
        enqueued += 1;
      } catch (err) {
        logger.error(
          `[EVENT-ROUTER] failed to enqueue automation=${workflow.id} event=${eventType}:`,
          err,
        );
      }
    }

    logger.info(
      `[EVENT-ROUTER] event=${eventType} workspaceId=${workspaceId} candidates=${candidates.length} enqueued=${enqueued} chain=${chain.join(' → ') || '∅'}`,
    );
  }

  private async findCandidates(
    event: AutomationEvent,
    workspaceId: string,
  ): Promise<Workflow[]> {
    const mappedEventType = triggerTypeToEventType(event.type);
    const baseWhere = {
      eventType: mappedEventType,
      status: AutomationStatus.ACTIVE,
      workspaceId,
    };

    if (event.type !== EMAIL_RECEIVED_EVENT || typeof event.payload.channelId !== 'string') {
      const workflows = await db.workflow.findMany({
        where: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          ...baseWhere,
        },
      });

      // Thread replies are much more frequent than new channel conversations.
      // Drop automations that cannot match before creating execution rows and
      // queue jobs; legacy configurations remain new-conversation-only.
      if (
        event.type === MESSAGE_RECEIVED_EVENT &&
        event.payload.messageLocation === MessageLocation.THREAD_REPLY
      ) {
        return workflows.filter(workflow => {
          const config = parseAutomationConfig(workflow.context);
          return messageLocationMatches(
            config.trigger.config.messageLocation,
            event.payload.messageLocation,
          );
        });
      }

      return workflows;
    }

    const [generalAutomations, deskRules] = await Promise.all([
      db.workflow.findMany({
        where: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          ...baseWhere,
        },
      }),
      db.deskAutoLabelRuleReference.findMany({
        where: {
          workspaceId,
          channelId: event.payload.channelId,
          workflow: {
            workflowType: DESK_AUTOMATION_WORKFLOW_TYPE,
            ...baseWhere,
          },
        },
        include: { workflow: true },
      }),
    ]);

    return [...generalAutomations, ...deskRules.map(rule => rule.workflow)];
  }
}

export const eventRouter = new EventRouter();
