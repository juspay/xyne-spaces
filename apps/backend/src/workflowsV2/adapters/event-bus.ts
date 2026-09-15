/**
 * Redis-backed {@link EventBusAdapter} — how a live execution's events reach a
 * browser that is connected to a different process than the one running the step.
 */
import type { Redis } from 'ioredis';
import type {
  BusEvent,
  BusListener,
  EventBusAdapter,
  EventTopic,
  Unsubscribe,
} from '@xyne/workflow-sdk';
import { createRedisClient } from '@/services/redisFactory';
import { logger } from '@/utils/logger';

const CHANNEL_PREFIX = 'workflows:events:';

const channelFor = (topic: EventTopic): string => `${CHANNEL_PREFIX}${topic}`;

interface TopicState {
  readonly listeners: Set<BusListener>;
  readonly ready: Promise<void>;
}

export class RedisEventBus implements EventBusAdapter {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly topics = new Map<EventTopic, TopicState>();

  constructor() {
    this.publisher = createRedisClient('workflows-events-pub');
    this.subscriber = createRedisClient('workflows-events-sub');
    this.subscriber.on('message', (channel: string, payload: string) => {
      this.dispatch(channel, payload);
    });
  }

  async publish(topic: EventTopic, event: BusEvent): Promise<void> {
    await this.publisher.publish(channelFor(topic), JSON.stringify(event));
  }

  async subscribe(topic: EventTopic, listener: BusListener): Promise<Unsubscribe> {
    let state = this.topics.get(topic);
    if (!state) {
      state = {
        listeners: new Set(),
        ready: this.subscriber.subscribe(channelFor(topic)).then(() => undefined),
      };
      this.topics.set(topic, state);
    }
    const own = state;
    own.listeners.add(listener);

    try {
      await own.ready;
    } catch (err) {
      this.detach(topic, listener, own);
      throw err;
    }

    return () => this.detach(topic, listener, own);
  }

  async close(): Promise<void> {
    this.topics.clear();
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  private detach(topic: EventTopic, listener: BusListener, state: TopicState): void {
    if (this.topics.get(topic) !== state) return;
    state.listeners.delete(listener);
    if (state.listeners.size > 0) return;

    this.topics.delete(topic);
    void this.subscriber.unsubscribe(channelFor(topic)).catch((err: unknown) => {
      logger.warn(`[workflows] event bus unsubscribe failed for ${topic}`, {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private dispatch(channel: string, payload: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const topic = channel.slice(CHANNEL_PREFIX.length) as EventTopic;

    const state = this.topics.get(topic);
    if (!state) return;

    let event: BusEvent;
    try {
      event = JSON.parse(payload) as BusEvent;
    } catch {
      logger.warn(`[workflows] event bus received unparseable payload on ${topic}`);
      return;
    }

    for (const listener of [...state.listeners]) {
      try {
        listener(event);
      } catch (err: unknown) {
        logger.warn(`[workflows] event bus listener threw for ${topic}`, {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
