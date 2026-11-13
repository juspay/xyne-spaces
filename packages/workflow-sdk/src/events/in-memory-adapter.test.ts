import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from './in-memory-adapter.js';
import { executionTopic } from './types.js';
import type { BusEvent } from './types.js';

const evt = (status: string): BusEvent => ({ event: 'execution_completed', data: { status } });

describe('InMemoryEventBus', () => {
  it('delivers a published event to a subscriber of that topic', async () => {
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    await bus.subscribe(executionTopic('e1'), (e) => got.push(e));
    await bus.publish(executionTopic('e1'), evt('COMPLETED'));

    expect(got).toEqual([evt('COMPLETED')]);
  });

  it('delivers synchronously, so a publisher that does not await still fans out', async () => {
    // The executor deliberately does not await `publish` — see its `emitEvent`.
    // In-process, delivery must therefore not be deferred to a microtask.
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    await bus.subscribe(executionTopic('e1'), (e) => got.push(e));
    void bus.publish(executionTopic('e1'), evt('COMPLETED'));

    expect(got).toHaveLength(1);
  });

  it('delivers to every subscriber of a topic', async () => {
    const bus = new InMemoryEventBus();
    const a: BusEvent[] = [];
    const b: BusEvent[] = [];

    await bus.subscribe(executionTopic('e1'), (e) => a.push(e));
    await bus.subscribe(executionTopic('e1'), (e) => b.push(e));
    await bus.publish(executionTopic('e1'), evt('COMPLETED'));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('does not leak across topics', async () => {
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    await bus.subscribe(executionTopic('e1'), (e) => got.push(e));
    await bus.publish(executionTopic('e2'), evt('COMPLETED'));

    expect(got).toEqual([]);
  });

  it('publishing to a topic nobody listens on is a no-op, not a throw', async () => {
    const bus = new InMemoryEventBus();
    await expect(bus.publish(executionTopic('nobody'), evt('COMPLETED'))).resolves.toBeUndefined();
  });

  it('stops delivering after unsubscribe', async () => {
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    const unsub = await bus.subscribe(executionTopic('e1'), (e) => got.push(e));
    await bus.publish(executionTopic('e1'), evt('COMPLETED'));
    unsub();
    await bus.publish(executionTopic('e1'), evt('FAILED'));

    expect(got).toHaveLength(1);
  });

  it('unsubscribing twice does not evict a later subscriber of the same topic', async () => {
    // The stale-closure trap: A's teardown prunes the topic, B then creates a
    // fresh listener set, and a second (idempotent) call of A's handle must not
    // take B's set down with it.
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    const unsubA = await bus.subscribe(executionTopic('e1'), () => {});
    unsubA();
    await bus.subscribe(executionTopic('e1'), (e) => got.push(e));
    unsubA();

    await bus.publish(executionTopic('e1'), evt('COMPLETED'));
    expect(got).toHaveLength(1);
  });

  it('lets a listener unsubscribe itself mid-dispatch without skipping the others', async () => {
    // The SSE route does exactly this when it sees a terminal event.
    const bus = new InMemoryEventBus();
    const order: string[] = [];

    const unsubFirst = await bus.subscribe(executionTopic('e1'), () => {
      order.push('first');
      unsubFirst();
    });
    await bus.subscribe(executionTopic('e1'), () => order.push('second'));

    await bus.publish(executionTopic('e1'), evt('COMPLETED'));

    expect(order).toEqual(['first', 'second']);
  });

  it('isolates a throwing listener from its peers and from the publisher', async () => {
    const bus = new InMemoryEventBus();
    const got: BusEvent[] = [];

    await bus.subscribe(executionTopic('e1'), () => {
      throw new Error('subscriber blew up');
    });
    await bus.subscribe(executionTopic('e1'), (e) => got.push(e));

    await expect(bus.publish(executionTopic('e1'), evt('COMPLETED'))).resolves.toBeUndefined();
    expect(got).toHaveLength(1);
  });
});
