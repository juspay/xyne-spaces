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
import { EMAIL_RECEIVED_EVENT } from '../triggers/email-received.trigger';
import type { AutomationEvent } from '../types/automation-events';

type ScopeIds = Record<'boardIds' | 'projectIds' | 'channelIds', string | undefined>;

// Scope ids the event carries, or null if they can't be established. Reads only entity columns
// and emitter-stamped ids — never a value from a secondary lookup, so these can't be absent for
// lookup reasons the way hasAttachments / isReply / performedBy.membership can.
function eventScopeIds(eventType: string, payload: Record<string, unknown>): ScopeIds | null {
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const byChannel = (channelIds: string | undefined): ScopeIds => ({
    boardIds: undefined,
    projectIds: undefined,
    channelIds,
  });
  const ticket = payload['ticket'] as Record<string, unknown> | undefined;
  const email = payload['email'] as Record<string, unknown> | undefined;
  switch (eventType) {
    case 'TICKET_CREATED':
    case 'TICKET_UPDATED':
    case 'TICKET_COMMENTED':
      return ticket == null
        ? null
        : {
            boardIds: str(ticket['boardId']),
            projectIds: str(ticket['projectId']),
            channelIds: str(ticket['channelId']),
          };
    case 'EMAIL_RECEIVED':
    case 'EMAIL_SENT':
      return email == null ? null : byChannel(str(email['channelId']));
    case 'MESSAGE_RECEIVED':
      return payload['deleted'] === true ? null : byChannel(str(payload['channelId']));
    case 'TAG_GENERATED':
      return byChannel(str(payload['channelId']));
    default:
      return null; // CALL_EVENT / WEBHOOK / unknown — no reliable scope, never pre-filter
  }
}

// Only board / project / channel are judged; every other filter is left to the worker. Sound
// because the matchers AND their scope dimensions together and OR within one, so judging a subset
// can never reject a candidate the matcher would have accepted. Must not throw — the caller's
// catch does not create a row.
function isDefiniteScopeMismatch(
  eventType: string,
  filterConfig: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const scope = eventScopeIds(eventType, payload);
  if (scope === null) return false;
  for (const key of ['boardIds', 'projectIds', 'channelIds'] as const) {
    const configured = filterConfig[key];
    if (!Array.isArray(configured)) continue;
    const wanted = configured.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (wanted.length === 0) continue;
    const actual = scope[key];
    if (actual === undefined) return true;
    // Raw and trimmed: matchTicketScopeFilters and the message matcher trim configured ids,
    // the email matchers' asStringArray does not.
    if (!wanted.some(v => v === actual || v.trim() === actual)) return true;
  }
  return false;
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
        // context being evaluated with the wrong trigger's filter logic.
        const filterConfig = (candidateConfig.trigger.config ?? {}) as Record<string, unknown>;
        const canPreFilter =
          preCheckEnabled &&
          hydratedPayload &&
          candidateConfig.schedule?.type !== 'SCHEDULED' &&
          candidateConfig.trigger.type === eventType;

        if (canPreFilter && hydratedPayload &&
            isDefiniteScopeMismatch(eventType, filterConfig, hydratedPayload)) {
          preFiltered += 1;
          continue;
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
