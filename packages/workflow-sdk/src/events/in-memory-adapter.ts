/**
 * The default {@link EventBusAdapter}: a process-local `Map` of topics to listeners.
 *
 * Correct — and the right choice — whenever everything that publishes and
 * everything that subscribes shares one process: a single-process deployment, the
 * demo server, tests. It is exactly wrong the moment they do not, because it will
 * not tell you; see the port's docs for that failure mode.
 */

import type {
  BusEvent,
  BusListener,
  EventBusAdapter,
  EventTopic,
  Unsubscribe,
} from './types.js';

export class InMemoryEventBus implements EventBusAdapter {
  private readonly listeners = new Map<EventTopic, Set<BusListener>>();

  publish(topic: EventTopic, event: BusEvent): Promise<void> {
    const set = this.listeners.get(topic);
    if (set) {
      // Snapshot before dispatch: a listener is allowed to unsubscribe itself (the
      // SSE route does exactly that on a terminal event), and mutating the set
      // being iterated makes which listeners run depend on insertion order.
      for (const listener of [...set]) {
        try {
          listener(event);
        } catch {
          // A subscriber's failure is its own. The publisher is usually the
          // executor mid-run, and must not learn about it.
        }
      }
    }
    return Promise.resolve();
  }

  subscribe(topic: EventTopic, listener: BusListener): Promise<Unsubscribe> {
    let set = this.listeners.get(topic);
    if (!set) {
      set = new Set();
      this.listeners.set(topic, set);
    }
    set.add(listener);
    const own = set;

    return Promise.resolve(() => {
      // Identity guard, so that unsubscribing twice cannot evict somebody else.
      // Without it: A subscribes, A unsubscribes (topic pruned), B subscribes
      // (fresh set), A's handle is invoked again — and the stale closure sees its
      // own empty set and prunes the topic out from under B.
      if (this.listeners.get(topic) !== own) return;
      own.delete(listener);
      if (own.size === 0) this.listeners.delete(topic);
    });
  }
}
