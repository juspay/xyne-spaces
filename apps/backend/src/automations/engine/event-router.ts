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
import { triggerRegistry } from '../triggers/trigger-registry';
import {
  EMAIL_RECEIVED_EVENT,
  matchEmailReceived,
  type EmailReceivedConfig,
  type EmailReceivedPayload,
} from '../triggers/email-received.trigger';
import {
  matchEmailSent,
  type EmailSentConfig,
  type EmailSentPayload,
} from '../triggers/email-sent.trigger';
import type { AutomationEvent } from '../types/automation-events';

// Was the entity actually found by hydration, or did the lookup fail (each hydrator already
// signals this: ticket/email omitted, or deleted:true)? A "not found" is inconclusive, not a
// real mismatch — callers must fail open on false. TAG_GENERATED excluded: its matchFilters()
// still catches its own errors and returns false (same swallow issue EMAIL_RECEIVED/EMAIL_SENT
// had) — matchTagGenerated isn't exported yet, so the same bypass used below for email isn't
// wired up for it. CALL_EVENT/unknown: no reliable found signal either way. Never pre-filter.
function hydrationFoundEntity(eventType: string, payload: Record<string, unknown>): boolean {
  switch (eventType) {
    case 'TICKET_CREATED':
    case 'TICKET_UPDATED':
    case 'TICKET_COMMENTED':
      return payload['ticket'] != null;
    case 'EMAIL_RECEIVED':
    case 'EMAIL_SENT':
      return payload['email'] != null;
    case 'MESSAGE_RECEIVED':
      return payload['deleted'] !== true;
    default:
      return false;
  }
}

// EMAIL_RECEIVED/EMAIL_SENT bypass triggerImpl.matchFilters() on purpose: that class method
// catches its own exceptions internally and returns false, which would be indistinguishable
// from a real mismatch here. matchEmailReceived/matchEmailSent are the same unwrapped
// comparison logic — calling them directly lets a genuine error reach OUR try/catch below,
// which correctly fails open instead of silently eating it.
function evaluateMatch(
  eventType: string,
  triggerImpl: { matchFilters(filter: Record<string, unknown>, payload: Record<string, unknown>): boolean },
  filterConfig: Record<string, unknown>,
  hydratedPayload: Record<string, unknown>,
): boolean {
  switch (eventType) {
    case 'EMAIL_RECEIVED':
      return matchEmailReceived(filterConfig as EmailReceivedConfig, hydratedPayload as EmailReceivedPayload);
    case 'EMAIL_SENT':
      return matchEmailSent(filterConfig as EmailSentConfig, hydratedPayload as EmailSentPayload);
    default:
      return triggerImpl.matchFilters(filterConfig, hydratedPayload);
  }
}

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

    // Pre-check: hydrate once for the whole batch (all candidates share this eventType's trigger
    // impl) and skip creating a row + queue job for automations whose filters can't match. Does
    // NOT replace the downstream filter checks — those stay as the correctness backstop.
    const triggerImpl = triggerRegistry.has(eventType) ? triggerRegistry.get(eventType) : null;
    let hydratedPayload: Record<string, unknown> | null = null;
    if (triggerImpl) {
      try {
        hydratedPayload =
          typeof triggerImpl.hydratePayload === 'function'
            ? await triggerImpl.hydratePayload(payload as unknown as Record<string, unknown>)
            : (payload as unknown as Record<string, unknown>);
      } catch (err) {
        logger.warn(
          `[EVENT-ROUTER] hydratePayload failed for event=${eventType} workspaceId=${workspaceId} — skipping pre-filter, falling back to per-candidate creation:`,
          err,
        );
        hydratedPayload = null;
      }
    }
    const preCheckEnabled = triggerImpl !== null && hydratedPayload !== null;

    let enqueued = 0;
    let preFiltered = 0;

    for (const workflow of candidates) {
      try {
        const candidateConfig = parseAutomationConfig(workflow.context);
        // SCHEDULED automations always get a row (unchanged) — deferring is only meaningful for
        // candidates that already matched. trigger.type check guards against a stale/mismatched
        // context being evaluated with the wrong trigger's matchFilters.
        const canPreFilter =
          preCheckEnabled &&
          triggerImpl &&
          hydratedPayload &&
          candidateConfig.schedule?.type !== 'SCHEDULED' &&
          candidateConfig.trigger.type === eventType &&
          hydrationFoundEntity(eventType, hydratedPayload);

        if (canPreFilter && triggerImpl && hydratedPayload) {
          const filterConfig = (candidateConfig.trigger.config ?? {}) as Record<string, unknown>;
          let matches: boolean;
          try {
            matches = evaluateMatch(eventType, triggerImpl, filterConfig, hydratedPayload);
          } catch (err) {
            logger.warn(
              `[EVENT-ROUTER] matchFilters threw for automation=${workflow.id} event=${eventType} — failing open (creating row):`,
              err,
            );
            matches = true;
          }
          if (!matches) {
            preFiltered += 1;
            continue;
          }
        }

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
      `[EVENT-ROUTER] event=${eventType} workspaceId=${workspaceId} candidates=${candidates.length} preFiltered=${preFiltered} enqueued=${enqueued} chain=${chain.join(' → ') || '∅'}`,
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
      return db.workflow.findMany({
        where: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          ...baseWhere,
        },
      });
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
