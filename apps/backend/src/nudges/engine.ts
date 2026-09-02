import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { userActivityService } from '@/services/userActivityService';
import { superpositionClient } from '@/services/superpositionClient';
import { type UserActivityEvent } from '@prisma/client';
import { SurfaceAreaType, Platform } from '@xyne/shared';
import { nudgeRegistry } from './registry';
import { AgentsConfig } from '@/agents/config';
import { activityContextResolver } from './services/activityContextResolver';
import { nudgeService } from './services/surfaceNudgeService';
import { surfaceLinkService } from './services/surfaceLinkService';
import type {
  ActivityEventNudgePayload,
  ActivityHistoryEvent,
  ActivityHistoryWindow,
  MessageNudgePayload,
  NudgeCandidate,
  NudgeDefinition,
  ActivityContextOutput,
} from './types';
import { EMPTY_ACTIVITY_CONTEXT } from './types';

const HISTORY_WINDOW_MINUTES = 30;
const HISTORY_MAX_EVENTS = 100;

export class NudgeEvaluationEngine {
  async evaluateActivityEvent(event: ActivityEventNudgePayload): Promise<void> {
    // 1. Look up definitions matching this event type
    const definitions = nudgeRegistry.getForTrigger(event.eventCategory, event.eventName);
    if (definitions.length === 0) {
      return;
    }

    // 2. Enrich the activity event via UserActivityService
    const eventUser = await db.user.findUniqueOrThrow({
      where: { id: event.userId },
      select: { workspaceId: true },
    });
    const enrichedActivity = await userActivityService.resolveActivity(
      this.toUserActivityEvent(event, eventUser.workspaceId),
    );
    const enrichedMeta = (enrichedActivity.contextMetadata as Record<string, unknown>) ?? {};

    // Extract domain payload for message events
    const messagePayload =
      event.eventCategory === 'MESSAGE'
        ? this.extractMessagePayload(event, enrichedMeta)
        : undefined;

    const effectivePayload = messagePayload ?? event;
    const persistenceSourceId = this.resolveSourceIdForPersistence(
      event,
      messagePayload?.messageId ?? null,
    );

    // 3. Fetch activity history once for all trigger lookback handlers
    const history = await this.fetchActivityHistory(event.userId);

    // 4. Run trigger lookback handlers in parallel
    const triggerResults = await Promise.all(
      definitions.map(async (def) => {
        if (!def.trigger.lookbackHandler) {
          return { definition: def, passed: true };
        }
        try {
          const passed = await def.trigger.lookbackHandler(event, history);
          return { definition: def, passed };
        } catch (error) {
          logger.warn('[NudgeEngine] Definition lookback failed', {
            nudgeKind: def.kind,
            eventCategory: event.eventCategory,
            eventName: event.eventName,
            userId: event.userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return { definition: def, passed: false };
        }
      }),
    );

    const passedDefinitions: NudgeDefinition<any>[] = [];
    for (const result of triggerResults) {
      if (result.passed) {
        passedDefinitions.push(result.definition);
      }
    }

    if (passedDefinitions.length === 0) {
      return;
    }

    // 4b. Filter by superposition config (skip disabled nudge kinds)
    const enabledDefinitions = await this.filterByConfig(passedDefinitions);
    if (enabledDefinitions.length === 0) {
      logger.info('[NudgeEngine] All nudge definitions disabled by config', {
        disabledKinds: passedDefinitions.map((d) => d.kind),
      });
      return;
    }

    // 5. Build shared activity context (once per trigger)
    let activityContext: ActivityContextOutput;
    try {
      activityContext = await activityContextResolver.resolve({
        actor: {
          userId: event.userId,
          projectId: typeof enrichedMeta.projectId === 'string' ? enrichedMeta.projectId : null,
        },
        trigger: {
          eventCategory: event.eventCategory,
          eventName: event.eventName,
          timestamp: event.timestamp.toISOString(),
          ...(messagePayload
            ? {
                messageId: messagePayload.messageId,
                conversationId: messagePayload.conversationId,
                channelId: messagePayload.channelId,
                messageText: messagePayload.messageText,
              }
            : {}),
        },
        options: {
          lookbackMinutes: 20,
          maxEvents: 40,
        },
      });
    } catch (err) {
      logger.warn('[NudgeEngine] Activity context resolver failed, using empty context', {
        eventCategory: event.eventCategory,
        eventName: event.eventName,
        error: err instanceof Error ? err.message : String(err),
      });
      activityContext = {
        ...EMPTY_ACTIVITY_CONTEXT,
        generatedAt: new Date().toISOString(),
        source: {
          userId: event.userId,
          projectId: typeof enrichedMeta.projectId === 'string' ? enrichedMeta.projectId : null,
          triggerEntityId: persistenceSourceId,
        },
      };
    }

    // 6. Fetch agents config for nudge model names (once per trigger, shared across all definitions)
    const agentsConfig = await AgentsConfig.fetch().catch(() => AgentsConfig.defaults());

    // 7. Run evaluate() in parallel for all enabled definitions
    const evaluationResults = await Promise.allSettled(
      enabledDefinitions.map(async (def) => {
        const startedAt = Date.now();
        try {
          const context = await def.buildContext(effectivePayload, activityContext, {
            event,
            enrichedActivity,
            messagePayload,
            agentsConfig,
          });
          let candidates = await def.evaluate(context, effectivePayload);

          if (def.postProcess && candidates.length > 0) {
            candidates = await def.postProcess(candidates, effectivePayload);
          }

          return { definition: def, candidates };
        } catch (error) {
          logger.error('[NudgeEngine] Definition execution failed', {
            nudgeKind: def.kind,
            eventCategory: event.eventCategory,
            eventName: event.eventName,
            sourceId: persistenceSourceId,
            userId: event.userId,
            durationMs: Date.now() - startedAt,
            error: error,
          });
          throw error;
        }
      }),
    );

    // 8. Collect and persist/execute all surviving candidates
    const allCandidates: Array<{
      definition: NudgeDefinition<any>;
      candidates: NudgeCandidate[];
    }> = [];

    for (const result of evaluationResults) {
      if (result.status === 'fulfilled' && result.value.candidates.length > 0) {
        allCandidates.push(result.value);
      }
    }

    for (const { definition, candidates } of allCandidates) {
      if (definition.mode === 'implicit') {
        await this.executeImplicitActions(candidates, persistenceSourceId, eventUser.workspaceId, event.userId);
      } else {
        await nudgeService.persistCandidates({
          sourceId: persistenceSourceId,
          sourceType: definition.direction.from,
          nudgeKind: definition.kind,
          workspaceId: eventUser.workspaceId,
          candidates,
          priority: definition.priority,
        });
      }
    }
  }

  private async executeImplicitActions(
    candidates: NudgeCandidate[],
    sourceId: string,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    for (const candidate of candidates) {
      const actions = candidate.actions as Record<string, unknown> | undefined;
      if (!actions) continue;

      const actionType = actions.actionType as string | undefined;

      if (actionType === 'CREATE_SURFACE_LINK') {
        await surfaceLinkService.createLink({
          sourceType: (actions.sourceType as any) ?? 'MESSAGE',
          sourceId: (actions.sourceId as string) ?? sourceId,
          targetType: actions.targetType as any,
          targetId: actions.targetId as string,
          linkKind: actions.linkKind as any,
          createdBy: userId,
          workspaceId,
        });
      } else if (actionType === 'DELETE_SURFACE_LINKS') {
        const deleteSourceId = (actions.sourceId as string) ?? sourceId;
        await surfaceLinkService.deleteLinksForSource(
          (actions.sourceType as any) ?? 'MESSAGE',
          deleteSourceId,
        );
        await nudgeService.dismissNudgesForSource(
          deleteSourceId,
          ((actions.sourceType as SurfaceAreaType | undefined) ?? SurfaceAreaType.MESSAGE),
        );
      } else {
        logger.warn('[NudgeEngine] Unknown implicit action type', { actionType, sourceId });
      }
    }
  }

  private toUserActivityEvent(event: ActivityEventNudgePayload, workspaceId: string): UserActivityEvent {
    return {
      id: '',
      workspaceId,
      userId: event.userId,
      sessionId: event.sessionId,
      eventCategory: event.eventCategory,
      eventName: event.eventName,
      eventLabel: event.eventLabel ?? null,
      url: event.url,
      triggerType: event.triggerType,
      contextMetadata: (event.contextMetadata ?? null) as UserActivityEvent['contextMetadata'],
      platform: event.platform as Platform,
      timestamp: event.timestamp,
    };
  }

  private extractMessagePayload(
    event: ActivityEventNudgePayload,
    enrichedMeta: Record<string, unknown>,
  ): MessageNudgePayload | undefined {
    const messageId = typeof enrichedMeta.messageId === 'string' ? enrichedMeta.messageId : undefined;
    const conversationId =
      typeof enrichedMeta.conversationId === 'string' ? enrichedMeta.conversationId : undefined;
    const channelId = typeof enrichedMeta.channelId === 'string' ? enrichedMeta.channelId : undefined;
    const projectId = typeof enrichedMeta.projectId === 'string' ? enrichedMeta.projectId : undefined;

    if (!messageId || !conversationId || !channelId || !projectId) {
      return undefined;
    }

    // UserActivityService enriches contextMetadata.message with the raw HTML content
    const rawContent = typeof enrichedMeta.message === 'string' ? enrichedMeta.message : '';
    let messageText = extractPlainTextFromHtml(rawContent).trim();
    if (!messageText) {
      messageText = 'Sent an attachment';
    }

    const createdAt = enrichedMeta.createdAt;
    const messageCreatedAt =
      createdAt instanceof Date
        ? createdAt.toISOString()
        : typeof createdAt === 'string'
          ? createdAt
          : event.timestamp.toISOString();

    return {
      messageId,
      conversationId,
      channelId,
      projectId,
      senderId: event.userId,
      messageText,
      messageCreatedAt,
    };
  }

  private resolveSourceIdForPersistence(
    event: ActivityEventNudgePayload,
    resolvedSourceId: string | null,
  ): string {
    if (resolvedSourceId && resolvedSourceId.trim().length > 0) {
      return resolvedSourceId;
    }

    const contextKeys = [
      'messageId',
      'ticketId',
      'canvasId',
      'callId',
      'conversationId',
      'channelId',
      'entityId',
      'id',
    ];

    for (const key of contextKeys) {
      const value = this.extractContextString(event.contextMetadata, key);
      if (value) {
        return value;
      }
    }

    return `activity:${event.eventCategory}.${event.eventName}:${event.timestamp.getTime()}:${event.userId}`;
  }

  private extractContextString(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    if (!metadata) return null;
    const value = metadata[key];
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  /**
   * Check superposition config to filter out disabled nudge kinds.
   * Flag key format: `nudge_<kind_lowercase>_enabled` (e.g. `nudge_create_ticket_from_message_enabled`).
   * Defaults to true (enabled) if the flag is not configured or superposition is unavailable.
   * Uses a single resolveAllConfigDetails() call to batch-fetch all flags.
   */
  private async filterByConfig(
    definitions: NudgeDefinition<any>[],
  ): Promise<NudgeDefinition<any>[]> {
    try {
      const allConfigs = await superpositionClient.resolveAllConfigDetails();

      return definitions.filter((def) => {
        const flagKey = `nudge_${def.kind.toLowerCase()}_enabled`;
        const flagValue = allConfigs[flagKey]?.value;

        // If the flag isn't configured at all, default to enabled
        if (flagValue === undefined) return true;

        const enabled = flagValue === true || flagValue === 'true';
        if (!enabled) {
          logger.info('[NudgeEngine] Nudge kind disabled by config', {
            nudgeKind: def.kind,
            flagKey,
          });
        }
        return enabled;
      });
    } catch (error) {
      logger.warn('[NudgeEngine] Superposition config check failed, all nudges enabled by default', {
        error: error instanceof Error ? error.message : String(error),
      });
      return definitions;
    }
  }

  private async fetchActivityHistory(userId: string): Promise<ActivityHistoryWindow> {
    const windowFrom = new Date(Date.now() - HISTORY_WINDOW_MINUTES * 60 * 1000);

    try {
      const rawEvents = await db.userActivityEvent.findMany({
        where: {
          userId,
          timestamp: { gte: windowFrom },
        },
        orderBy: { timestamp: 'desc' },
        take: HISTORY_MAX_EVENTS,
        select: {
          eventCategory: true,
          eventName: true,
          eventLabel: true,
          url: true,
          triggerType: true,
          contextMetadata: true,
          platform: true,
          timestamp: true,
        },
      });

      const events: ActivityHistoryEvent[] = rawEvents.map((e) => ({
        eventCategory: e.eventCategory,
        eventName: e.eventName,
        eventLabel: e.eventLabel ?? undefined,
        url: e.url,
        triggerType: e.triggerType,
        contextMetadata: e.contextMetadata as Record<string, unknown> | undefined,
        platform: e.platform,
        timestamp: e.timestamp,
      }));

      return {
        events,
        windowMinutes: HISTORY_WINDOW_MINUTES,
        userId,
      };
    } catch (error) {
      logger.warn('[NudgeEngine] Failed to fetch activity history', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { events: [], windowMinutes: HISTORY_WINDOW_MINUTES, userId };
    }
  }
}

export const nudgeEvaluationEngine = new NudgeEvaluationEngine();
