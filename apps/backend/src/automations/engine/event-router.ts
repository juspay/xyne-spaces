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

// Filter keys this event's matcher honours as scope, mapped to the id the event carries.
// Only honoured keys may appear: judging a key the matcher ignores (a stray boardIds on an
// email config) would drop runs that should have fired. Returning null means never
// pre-filtered — EMAIL_SENT because its wire payload is { emailId } only and hydrating it
// would add queries to the awaited reply-send path, WEBHOOK because it has no scope.
function eventScope(
  eventType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const ticket = (payload['ticket'] ?? {}) as Record<string, unknown>;
  switch (eventType) {
    case 'TICKET_CREATED':
    case 'TICKET_UPDATED':
    case 'TICKET_COMMENTED': // mirrors matchTicketScopeFilters
      return {
        boardIds: ticket['boardId'],
        projectIds: ticket['projectId'],
        channelIds: ticket['channelId'],
      };
    case 'EMAIL_RECEIVED':
    case 'TAG_GENERATED':
    case 'CALL_EVENT':
      return { channelIds: payload['channelId'] };
    case 'MESSAGE_RECEIVED':
      return { channelIds: payload['channelId'], fromUserIds: payload['authorId'] };
    default:
      return null;
  }
}

function configuredIds(filter: Record<string, unknown>, key: string): string[] {
  const raw = filter[key];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

// True only when matchFilters is guaranteed to reject: some honoured key is configured and
// the event's actual id is known and absent from it. An unset filter or an id we cannot read
// yields false — the pre-filter never guesses, and the worker decides.
function isDefiniteScopeMismatch(
  scope: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(scope).some(([key, actual]) => {
    const wanted = configuredIds(filter, key);
    if (wanted.length === 0 || typeof actual !== 'string' || !actual) return false;
    // Raw and trimmed: the ticket/message matchers trim configured ids, the email/tag
    // asStringArray does not. Comparing both ways can only keep a candidate, never drop one.
    return !wanted.some(v => v === actual || v.trim() === actual);
  });
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

    // Skip creating a row + queue job for candidates whose scope cannot match this event.
    // Does NOT replace the worker's matchFilters — that stays the correctness backstop.
    const skipIds = await this.scopeMismatches(
      eventType,
      payload as unknown as Record<string, unknown>,
      candidates,
      workspaceId,
    ).catch(err => {
      logger.warn(`[EVENT-ROUTER] pre-filter failed for event=${eventType} — enqueuing all:`, err);
      return new Set<string>();
    });

    let enqueued = 0;
    let preFiltered = 0;

    for (const workflow of candidates) {
      if (skipIds.has(workflow.id)) {
        preFiltered += 1;
        continue;
      }

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
      `[EVENT-ROUTER] event=${eventType} workspaceId=${workspaceId} candidates=${candidates.length} preFiltered=${preFiltered} enqueued=${enqueued} chain=${chain.join(' → ') || '∅'}`,
    );
  }

  /**
   * Ids of candidates whose configured scope cannot match this event. Fails open at every
   * step — an event with no scope, a config that does not parse into this trigger's shape,
   * nothing scoped, a failed hydration — so an unjudged candidate still gets its row.
   */
  private async scopeMismatches(
    eventType: string,
    payload: Record<string, unknown>,
    candidates: Workflow[],
    workspaceId: string,
  ): Promise<Set<string>> {
    const skip = new Set<string>();
    const keys = Object.keys(eventScope(eventType, {}) ?? {});
    if (keys.length === 0) return skip;

    // Only a candidate whose stored trigger is this event can be judged with this event's
    // scope semantics. parseAutomationConfig is an unvalidated JSON.parse ("null" and "{}"
    // both parse fine), so read defensively — an unreadable config is simply not judged.
    const scoped: Array<[string, Record<string, unknown>]> = [];
    for (const workflow of candidates) {
      const config = parseAutomationConfig(workflow.context) as {
        trigger?: { type?: string; config?: unknown };
      } | null;
      if (config?.trigger?.type !== eventType) continue;
      const filter = (config.trigger.config ?? {}) as Record<string, unknown>;
      if (keys.some(key => configuredIds(filter, key).length > 0)) scoped.push([workflow.id, filter]);
    }
    if (scoped.length === 0) return skip; // nothing to judge — never hydrate

    let scope = eventScope(eventType, payload);
    // Ticket events are exactly the events carrying boardIds, and exactly the events whose
    // wire payload has only ticketId — so hydrate once for the batch. Everything else is
    // judged on wire data alone and never hydrates.
    if (scope && 'boardIds' in scope) {
      const impl = triggerRegistry.has(eventType) ? triggerRegistry.get(eventType) : null;
      const hydrate = impl?.hydratePayload?.bind(impl);
      if (!hydrate) return skip;
      // Same tenant scope the worker hydrates under, so both see the same rows.
      const hydrated = await runAsServiceActor('automation', workspaceId, () => hydrate(payload));
      scope = eventScope(eventType, hydrated);
    }
    if (!scope) return skip;

    for (const [id, filter] of scoped) {
      if (isDefiniteScopeMismatch(scope, filter)) skip.add(id);
    }
    return skip;
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
