import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { BaseTrigger } from './base-trigger.js';
import type { HydrateResult } from './base-trigger.js';
import type { TriggerEvent } from '../ingest/types.js';
import { TriggerCategory } from '../types/categories.js';

// ─── Concrete test trigger ───

const TestTriggerConfigSchema = z.object({
  channelId: z.string(),
  keywords: z.array(z.string()).optional(),
});

const TestTriggerOutputSchema = z.object({
  messageId: z.string(),
  content: z.string(),
});

type TestConfig = z.infer<typeof TestTriggerConfigSchema>;
type TestOutput = z.infer<typeof TestTriggerOutputSchema>;

/**
 * What arrives before enrichment — ids, not objects. A type alias rather than an
 * interface on purpose: only an alias satisfies the `Record<string, unknown>`
 * constraint through TypeScript's implicit index signature.
 */
type RawMessageEvent = { messageId: string; channelId: string; content: string };

const rawEvent = (
  payload: RawMessageEvent,
  type = 'TEST_EVENT',
): TriggerEvent<RawMessageEvent> => ({ type, payload });

const CONFIG: TestConfig = { channelId: 'ch_1' };

class TestTrigger extends BaseTrigger<typeof TestTriggerConfigSchema> {
  readonly type = 'TEST_EVENT';
  readonly configSchema = TestTriggerConfigSchema;
  readonly name = 'Test Event';
  readonly description = 'Fires when a test event occurs';
  readonly outputSchema = TestTriggerOutputSchema;
  readonly category = TriggerCategory.EVENT;
  override readonly icon = 'bell';
}

/**
 * A fully declared trigger: its config, the shape it emits, and the shape it is
 * sent. Every hook below reads real fields — no string indexing, and a typo is a
 * compile error rather than a rule that quietly never matches.
 */
class FilteredTrigger extends BaseTrigger<
  typeof TestTriggerConfigSchema,
  typeof TestTriggerOutputSchema,
  RawMessageEvent
> {
  readonly type = 'FILTERED_EVENT';
  readonly configSchema = TestTriggerConfigSchema;
  readonly name = 'Filtered Event';
  readonly description = 'Fires with filter matching';
  readonly outputSchema = TestTriggerOutputSchema;
  readonly category = TriggerCategory.WEBHOOK;
  override readonly requiresScopeFilter = true;
  override readonly scopeFilterFields = ['channelId'] as const;

  /**
   * Everything this trigger has to say about an event, said once on what arrived:
   * the channel it watches, and the words the message must carry. Both are facts
   * of the delivery, so neither needs enrichment — and neither can change its
   * answer while a delayed run waits.
   */
  override accepts(e: TriggerEvent<RawMessageEvent>, config: TestConfig): boolean {
    if (config.channelId && config.channelId !== e.payload.channelId) return false;
    const keywords = config.keywords ?? [];
    if (keywords.length === 0) return true;
    return keywords.some((word) => e.payload.content.includes(word));
  }
}

class HydratingTrigger extends BaseTrigger<
  typeof TestTriggerConfigSchema,
  typeof TestTriggerOutputSchema,
  RawMessageEvent
> {
  readonly type = 'HYDRATING_EVENT';
  readonly configSchema = TestTriggerConfigSchema;
  readonly name = 'Hydrating Event';
  readonly description = 'Enriches payload';
  readonly outputSchema = TestTriggerOutputSchema;
  readonly category = TriggerCategory.EVENT;

  override hydrationKey(e: TriggerEvent<RawMessageEvent>): string {
    return e.payload.messageId;
  }

  override async hydrate(
    e: TriggerEvent<RawMessageEvent>,
  ): Promise<HydrateResult<TestOutput>> {
    if (e.payload.messageId === 'deleted') {
      return { kind: 'gone', reason: 'message was deleted' };
    }
    return {
      kind: 'payload',
      payload: { messageId: e.payload.messageId, content: 'hello' },
    };
  }
}

// ─── Tests ───

describe('BaseTrigger', () => {
  const trigger = new TestTrigger();

  it('has correct metadata', () => {
    expect(trigger.type).toBe('TEST_EVENT');
    expect(trigger.name).toBe('Test Event');
    expect(trigger.description).toBe('Fires when a test event occurs');
    expect(trigger.category).toBe(TriggerCategory.EVENT);
    expect(trigger.icon).toBe('bell');
  });

  it('validates valid config', () => {
    const result = trigger.validate({ channelId: 'ch_1' });
    expect(result).toEqual({ channelId: 'ch_1' });
  });

  it('validates config with optional fields', () => {
    const result = trigger.validate({
      channelId: 'ch_1',
      keywords: ['urgent'],
    });
    expect(result).toEqual({ channelId: 'ch_1', keywords: ['urgent'] });
  });

  it('rejects invalid config', () => {
    expect(() => trigger.validate({})).toThrow();
    expect(() => trigger.validate({ channelId: 42 })).toThrow();
  });

  it('accepts defaults to true', () => {
    expect(trigger.accepts({ type: 'TEST_EVENT', payload: {} }, CONFIG)).toBe(true);
    expect(
      trigger.accepts({ type: 'TEST_EVENT', payload: { channelId: 'ch_9' } }, CONFIG),
    ).toBe(true);
  });

  it('decorateConfigSchema is identity by default', () => {
    const schema = { type: 'object', properties: {} };
    expect(trigger.decorateConfigSchema(schema)).toBe(schema);
  });

  it('hydrate and hydrationKey are undefined by default', () => {
    expect(trigger.hydrate).toBeUndefined();
    expect(trigger.hydrationKey).toBeUndefined();
  });

  it('scope filter fields are undefined by default', () => {
    expect(trigger.requiresScopeFilter).toBeUndefined();
    expect(trigger.scopeFilterFields).toBeUndefined();
  });
});

describe('BaseTrigger with an accepts override', () => {
  const trigger = new FilteredTrigger();

  it('has scope filter metadata', () => {
    expect(trigger.requiresScopeFilter).toBe(true);
    expect(trigger.scopeFilterFields).toEqual(['channelId']);
  });

  const message = (over: Partial<RawMessageEvent> = {}) =>
    rawEvent({ messageId: 'm_1', channelId: 'ch_1', content: 'hello', ...over });

  it('accepts an event in the watched channel', () => {
    expect(trigger.accepts(message(), CONFIG)).toBe(true);
  });

  it('rejects an event from another channel', () => {
    expect(trigger.accepts(message({ channelId: 'ch_2' }), CONFIG)).toBe(false);
  });

  it('judges the words the config asked for', () => {
    const config: TestConfig = { channelId: 'ch_1', keywords: ['urgent'] };
    expect(trigger.accepts(message({ content: 'urgent: card declined' }), config)).toBe(true);
    expect(trigger.accepts(message({ content: 'all good' }), config)).toBe(false);
  });

  it('accepts anything when the config sets no keywords', () => {
    expect(trigger.accepts(message({ content: 'anything' }), CONFIG)).toBe(true);
  });

  it('will not compile against the wrong shapes', () => {
    // These are the point of the generics: each line below is a COMPILE error,
    // caught here because this file is in `tsconfig.test.json`.

    // @ts-expect-error — `boardId` is not part of this trigger's config
    trigger.accepts(message(), { boardId: 'b_1' });
    // @ts-expect-error — the raw event carries ids and text, not a hydrated message
    trigger.accepts({ type: 'TEST_EVENT', payload: { hydrated: true } }, CONFIG);

    expect(true).toBe(true);
  });
});

describe('BaseTrigger with hydrate', () => {
  const trigger = new HydratingTrigger();

  it('enriches the payload', async () => {
    const result = await trigger.hydrate(rawEvent({ messageId: 'm_1', channelId: 'ch_1', content: 'hello' }));
    expect(result).toEqual({
      kind: 'payload',
      payload: { messageId: 'm_1', content: 'hello' },
    });
  });

  it('reports a subject that no longer exists instead of throwing', async () => {
    const result = await trigger.hydrate(rawEvent({ messageId: 'deleted', channelId: 'ch_1', content: 'hello' }));
    expect(result).toEqual({ kind: 'gone', reason: 'message was deleted' });
  });

  it('keys hydration by the subject, so one read can serve many workflows', () => {
    expect(trigger.hydrationKey(rawEvent({ messageId: 'm_1', channelId: 'ch_1', content: 'hello' }))).toBe('m_1');
  });
});
