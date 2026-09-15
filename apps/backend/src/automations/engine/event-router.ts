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

// Wire payload carries only ticketId, so the scope ids come off the ticket row.
const TICKET_SCOPED_EVENTS: ReadonlySet<string> = new Set([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_COMMENTED',
]);

// Read for every active automation in the workspace on every event — only the columns used here.
const CANDIDATE_SELECT = {
  id: true,
  workspaceId: true,
  workflowType: true,
  context: true,
  metadata: true,
} as const;

type WorkflowCandidate = {
  id: string;
  workspaceId: string;
  workflowType: string | null;
  context: string | null;
  metadata: string | null;
};

// Filter keys this event's matcher honours as scope, mapped to the id the event carries. A key
// the matcher ignores must never appear — judging it would drop runs that should have fired.
// null = never pre-filtered: EMAIL_SENT's wire payload is { emailId } only and hydrating it
// would add queries to the awaited reply-send path; WEBHOOK has no scope.
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

// True only when matchFilters is guaranteed to reject. An unset filter or an id we cannot
// read yields false — the pre-filter never guesses, the worker decides.
function isDefiniteScopeMismatch(
  scope: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(scope).some(([key, actual]) => {
    const wanted = configuredIds(filter, key);
    if (wanted.length === 0 || typeof actual !== 'string' || !actual) return false;
    // Raw and trimmed: ticket/message matchers trim configured ids, email/tag ones do not.
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

    // Skip candidates whose scope cannot match; the worker's matchFilters stays the backstop.
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

  /** Ids of candidates whose configured scope cannot match. Fails open at every step. */
  private async scopeMismatches(
    eventType: string,
    payload: Record<string, unknown>,
    candidates: WorkflowCandidate[],
    workspaceId: string,
  ): Promise<Set<string>> {
    const skip = new Set<string>();
    const keys = Object.keys(eventScope(eventType, {}) ?? {});
    if (keys.length === 0) return skip;

    // parseAutomationConfig is an unvalidated JSON.parse ("null" and "{}" both parse fine),
    // so read defensively — a config that is not this event's trigger is left to the worker.
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
    // Three columns, not the trigger's hydratePayload — that fans out to board/project/channel/
    // user lookups the worker repeats anyway. TICKET_COMMENTED's hydration also falls back to the
    // conversation's channelId; here a null stays null, so nothing is skipped and the worker decides.
    if (scope && TICKET_SCOPED_EVENTS.has(eventType)) {
      const ticketId = payload['ticketId'];
      if (typeof ticketId !== 'string' || !ticketId) return skip;
      // Same tenant scope the worker hydrates under, so both see the same rows.
      const ticket = await runAsServiceActor('automation', workspaceId, () =>
        db.ticket
          .findUnique({
            where: { id: ticketId },
            select: { boardId: true, projectId: true, channelId: true },
          })
          .catch(() => null),
      );
      scope = eventScope(eventType, { ...payload, ticket: ticket ?? {} });
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
  ): Promise<WorkflowCandidate[]> {
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
        select: CANDIDATE_SELECT,
      });
    }

    const [generalAutomations, deskRules] = await Promise.all([
      db.workflow.findMany({
        where: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          ...baseWhere,
        },
        select: CANDIDATE_SELECT,
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
        select: { workflow: { select: CANDIDATE_SELECT } },
      }),
    ]);

    return [...generalAutomations, ...deskRules.map(rule => rule.workflow)];
  }
}

export const eventRouter = new EventRouter();
