import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import type { ActivityContextResolverInput, ActivityContextOutput } from '../types';
import { EMPTY_ACTIVITY_CONTEXT } from '../types';
import { ENTITY_URL_PATTERNS } from '../entityUrlPatterns';

// Hard upper bounds
const MAX_LOOKBACK_MINUTES = 60;
const MAX_EVENTS = 100;

interface RawEvent {
  id: string;
  userId: string;
  eventCategory: string;
  eventName: string;
  eventLabel: string | null;
  url: string;
  triggerType: string;
  contextMetadata: unknown;
  platform: string;
  timestamp: Date;
}

class ActivityContextResolver {
  async resolve(input: ActivityContextResolverInput): Promise<ActivityContextOutput> {
    const { actor, trigger, options } = input;

    // Enforce hard limits
    const lookbackMinutes = Math.min(options.lookbackMinutes, MAX_LOOKBACK_MINUTES);
    const maxEvents = Math.min(options.maxEvents, MAX_EVENTS);

    const now = new Date(trigger.timestamp);
    const windowFrom = new Date(now.getTime() - lookbackMinutes * 60 * 1000);

    // Fetch recent activity events
    let rawEvents: RawEvent[];
    try {
      rawEvents = await db.userActivityEvent.findMany({
        where: {
          userId: actor.userId,
          timestamp: {
            gte: windowFrom,
            lte: now,
          },
          ...(options.allowedCategories?.length
            ? { eventCategory: { in: options.allowedCategories } }
            : {}),
          ...(options.allowedPlatforms?.length
            ? { platform: { in: options.allowedPlatforms } }
            : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: maxEvents,
      });
    } catch (error) {
      logger.warn('[ActivityContextResolver] Failed to fetch events', {
        userId: actor.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.buildEmptyOutput(actor, trigger, lookbackMinutes, windowFrom, now);
    }

    // Process events
    const droppedReasonCounts: Record<string, number> = {};
    let droppedEvents = 0;

    const keptEvents: RawEvent[] = [];
    for (const event of rawEvents) {
      // Drop events with empty category or name
      if (!event.eventCategory?.trim() || !event.eventName?.trim()) {
        droppedEvents++;
        droppedReasonCounts['empty_category_or_name'] = (droppedReasonCounts['empty_category_or_name'] ?? 0) + 1;
        continue;
      }
      keptEvents.push(event);
    }

    // Build recent actions
    const recentActions = keptEvents.map((event) => ({
      ts: event.timestamp.toISOString(),
      category: event.eventCategory.toUpperCase().trim(),
      name: event.eventName.toUpperCase().trim(),
      label: event.eventLabel?.trim() || undefined,
      url: event.url || undefined,
      platform: event.platform as 'WEB' | 'ELECTRON' | 'MOBILE',
      triggerType: event.triggerType,
      confidence: this.computeRecencyConfidence(event.timestamp, now, lookbackMinutes),
    }));

    // Extract entities
    const entityMap = new Map<string, {
      surfaceType: ActivityContextOutput['topEntities'][number]['surfaceType'];
      id: string;
      evidence: Array<{ ts: string; reason: string }>;
      lastSeenAt: Date;
      hitCount: number;
    }>();

    for (const event of keptEvents) {
      // Extract from URL
      if (event.url) {
        for (const { pattern, surfaceType, idGroup } of ENTITY_URL_PATTERNS) {
          const match = event.url.match(pattern);
          if (match?.[idGroup]) {
            const entityId = match[idGroup]!;
            this.addEntity(entityMap, surfaceType, entityId, event.timestamp, `url_match:${event.eventName}`);
          }
        }
      }

      // Extract from contextMetadata
      if (event.contextMetadata && typeof event.contextMetadata === 'object') {
        const metadata = event.contextMetadata as Record<string, unknown>;
        if (typeof metadata.ticketId === 'string') {
          this.addEntity(entityMap, 'TICKET', metadata.ticketId, event.timestamp, `metadata:ticketId`);
        }
        if (typeof metadata.messageId === 'string') {
          this.addEntity(entityMap, 'MESSAGE', metadata.messageId, event.timestamp, `metadata:messageId`);
        }
        if (typeof metadata.canvasId === 'string') {
          this.addEntity(entityMap, 'CANVAS', metadata.canvasId, event.timestamp, `metadata:canvasId`);
        }
        if (typeof metadata.channelId === 'string') {
          this.addEntity(entityMap, 'CHANNEL', metadata.channelId, event.timestamp, `metadata:channelId`);
        }
        if (typeof metadata.conversationId === 'string') {
          this.addEntity(entityMap, 'CONVERSATION', metadata.conversationId, event.timestamp, `metadata:conversationId`);
        }
        if (typeof metadata.callId === 'string') {
          this.addEntity(entityMap, 'CALL', metadata.callId, event.timestamp, `metadata:callId`);
        }
      }
    }

    // Score and sort entities
    const topEntities = Array.from(entityMap.values())
      .map((entity) => ({
        surfaceType: entity.surfaceType,
        id: entity.id,
        confidence: this.computeEntityConfidence(entity.hitCount, entity.lastSeenAt, now, lookbackMinutes),
        evidence: entity.evidence.slice(0, 5),
        lastSeenAt: entity.lastSeenAt.toISOString(),
        hitCount: entity.hitCount,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);

    // Build signals
    const activeChannelIds = [...new Set(
      topEntities.filter((e) => e.surfaceType === 'CHANNEL').map((e) => e.id),
    )];
    const activeConversationIds = [...new Set(
      topEntities.filter((e) => e.surfaceType === 'CONVERSATION').map((e) => e.id),
    )];

    const hasStrongEntityContext = topEntities.some((e) => e.confidence > 0.7 && e.hitCount >= 2);

    // Build prompt hints
    const promptHints: string[] = [];
    if (activeChannelIds.length > 0) {
      promptHints.push(`User has been active in ${activeChannelIds.length} channel(s) recently.`);
    }
    const ticketEntities = topEntities.filter((e) => e.surfaceType === 'TICKET');
    if (ticketEntities.length > 0) {
      promptHints.push(`User has viewed ${ticketEntities.length} ticket(s) recently.`);
    }
    if (hasStrongEntityContext) {
      promptHints.push('User has strong recent context on specific entities.');
    }

    return {
      version: 'v1',
      generatedAt: new Date().toISOString(),
      source: {
        userId: actor.userId,
        projectId: actor.projectId,
        triggerEntityId: trigger.messageId ?? '',
      },
      window: {
        from: windowFrom.toISOString(),
        to: now.toISOString(),
        lookbackMinutes,
      },
      stats: {
        fetchedEvents: rawEvents.length,
        keptEvents: keptEvents.length,
        droppedEvents,
        droppedReasonCounts,
      },
      recentActions,
      topEntities,
      signals: {
        activeChannelIds,
        activeConversationIds,
        probableIntentTags: [],
        hasStrongEntityContext,
      },
      promptHints,
    };
  }

  private addEntity(
    map: Map<string, {
      surfaceType: ActivityContextOutput['topEntities'][number]['surfaceType'];
      id: string;
      evidence: Array<{ ts: string; reason: string }>;
      lastSeenAt: Date;
      hitCount: number;
    }>,
    surfaceType: ActivityContextOutput['topEntities'][number]['surfaceType'],
    id: string,
    timestamp: Date,
    reason: string,
  ): void {
    const key = `${surfaceType}:${id}`;
    const existing = map.get(key);
    if (existing) {
      existing.hitCount++;
      existing.evidence.push({ ts: timestamp.toISOString(), reason });
      if (timestamp > existing.lastSeenAt) {
        existing.lastSeenAt = timestamp;
      }
    } else {
      map.set(key, {
        surfaceType,
        id,
        evidence: [{ ts: timestamp.toISOString(), reason }],
        lastSeenAt: timestamp,
        hitCount: 1,
      });
    }
  }

  private computeRecencyConfidence(eventTime: Date, now: Date, lookbackMinutes: number): number {
    const elapsed = (now.getTime() - eventTime.getTime()) / (1000 * 60);
    return Math.max(0, 1 - elapsed / lookbackMinutes);
  }

  private computeEntityConfidence(hitCount: number, lastSeen: Date, now: Date, lookbackMinutes: number): number {
    const recency = this.computeRecencyConfidence(lastSeen, now, lookbackMinutes);
    const frequency = Math.min(hitCount / 5, 1);
    return 0.6 * recency + 0.4 * frequency;
  }

  private buildEmptyOutput(
    actor: ActivityContextResolverInput['actor'],
    trigger: ActivityContextResolverInput['trigger'],
    lookbackMinutes: number,
    windowFrom: Date,
    windowTo: Date,
  ): ActivityContextOutput {
    return {
      ...EMPTY_ACTIVITY_CONTEXT,
      generatedAt: new Date().toISOString(),
      source: {
        userId: actor.userId,
        projectId: actor.projectId,
        triggerEntityId: trigger.messageId ?? '',
      },
      window: {
        from: windowFrom.toISOString(),
        to: windowTo.toISOString(),
        lookbackMinutes,
      },
    };
  }
}

export const activityContextResolver = new ActivityContextResolver();
