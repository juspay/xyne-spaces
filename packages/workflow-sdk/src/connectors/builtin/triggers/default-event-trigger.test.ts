import { describe, it, expect } from 'vitest';
import { DefaultEventTrigger } from './default-event-trigger.js';
import { BuiltinTriggerType } from '../../../types/known-types.js';
import type { TriggerEvent } from '../../../ingest/types.js';

const trigger = new DefaultEventTrigger();

const event = (type: string): TriggerEvent => ({ type, payload: { id: 'x' } });

describe('DefaultEventTrigger', () => {
  it('is the builtin EVENT trigger', () => {
    expect(trigger.type).toBe(BuiltinTriggerType.EVENT);
  });

  it('accepts only the event type it was configured for', () => {
    expect(trigger.accepts(event('order.created'), { eventType: 'order.created' })).toBe(true);
    expect(trigger.accepts(event('order.shipped'), { eventType: 'order.created' })).toBe(false);
  });

  it('matches nothing else by accident — a host that fans every event out to every EVENT workflow still only starts the right ones', () => {
    const config = { eventType: 'ticket.updated' };
    const types = ['ticket.created', 'ticket.updated', 'ticket.commented'];
    expect(types.filter((t) => trigger.accepts(event(t), config))).toEqual(['ticket.updated']);
  });
});
