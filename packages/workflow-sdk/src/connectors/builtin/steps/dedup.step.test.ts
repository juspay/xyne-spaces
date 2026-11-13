import { describe, it, expect, vi } from 'vitest';
import { DedupStep, DedupStepConfigSchema } from './dedup.step.js';
import { createMockStepContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';

function createCtxWithStore(
  keyPath: string,
  keyValue: unknown,
) {
  const store = new Map<string, unknown>();

  const ctx = createMockStepContext({
    workflow: createMockContext({
      triggerData: { id: keyValue },
      triggerType: 'TEST',
    }),
    staticData: {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
  });

  return { ctx, store };
}

describe('DedupStep', () => {
  const step = new DedupStep();

  it('has correct metadata', () => {
    expect(step.type).toBe('DEDUP');
    expect(step.kind).toBe('action');
    expect(step.category).toBe('data');
  });

  describe('config schema', () => {
    it('validates valid config', () => {
      const config = DedupStepConfigSchema.parse({ keyPath: 'trigger.id' });
      expect(config.keyPrefix).toBe('dedup:');
    });

    it('rejects empty keyPath', () => {
      expect(() =>
        DedupStepConfigSchema.parse({ keyPath: '' }),
      ).toThrow();
    });
  });

  describe('execute', () => {
    it('marks first occurrence as not duplicate', async () => {
      const { ctx } = createCtxWithStore('trigger.id', 'evt_1');

      const result = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:' },
        ctx,
      );

      expect(result.duplicate).toBe(false);
      expect(result.key).toBe('dedup:evt_1');
    });

    it('marks second occurrence as duplicate', async () => {
      const { ctx } = createCtxWithStore('trigger.id', 'evt_1');

      await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:' },
        ctx,
      );
      const result = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:' },
        ctx,
      );

      expect(result.duplicate).toBe(true);
    });

    it('different keys are not duplicates', async () => {
      const store = new Map<string, unknown>();
      const makeCtx = (id: string) =>
        createMockStepContext({
          workflow: createMockContext({
            triggerData: { id },
            triggerType: 'TEST',
          }),
          staticData: {
            get: async (key: string) => store.get(key),
            set: async (key: string, value: unknown) => { store.set(key, value); },
            delete: async (key: string) => { store.delete(key); },
          },
        });

      const r1 = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:' },
        makeCtx('a'),
      );
      const r2 = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:' },
        makeCtx('b'),
      );

      expect(r1.duplicate).toBe(false);
      expect(r2.duplicate).toBe(false);
    });

    it('respects TTL — expired key treated as new', async () => {
      const store = new Map<string, unknown>();
      const ctx = createMockStepContext({
        workflow: createMockContext({
          triggerData: { id: 'evt_ttl' },
          triggerType: 'TEST',
        }),
        staticData: {
          get: async (key: string) => store.get(key),
          set: async (key: string, value: unknown) => { store.set(key, value); },
          delete: async (key: string) => { store.delete(key); },
        },
      });

      // Seed an old entry
      store.set('dedup:evt_ttl', { seenAt: Date.now() - 10_000 });

      const result = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:', ttlMs: 5000 },
        ctx,
      );

      expect(result.duplicate).toBe(false);
    });

    it('respects TTL — recent key treated as duplicate', async () => {
      const store = new Map<string, unknown>();
      const ctx = createMockStepContext({
        workflow: createMockContext({
          triggerData: { id: 'evt_ttl' },
          triggerType: 'TEST',
        }),
        staticData: {
          get: async (key: string) => store.get(key),
          set: async (key: string, value: unknown) => { store.set(key, value); },
          delete: async (key: string) => { store.delete(key); },
        },
      });

      // Seed a recent entry
      store.set('dedup:evt_ttl', { seenAt: Date.now() - 1000 });

      const result = await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'dedup:', ttlMs: 5000 },
        ctx,
      );

      expect(result.duplicate).toBe(true);
    });

    it('throws when key resolves to undefined', async () => {
      const ctx = createMockStepContext({
        staticData: {
          get: async () => undefined,
          set: async () => {},
          delete: async () => {},
        },
      });

      await expect(
        step.execute(
          { keyPath: 'trigger.nonexistent', keyPrefix: 'dedup:' },
          ctx,
        ),
      ).rejects.toThrow('resolved to undefined');
    });

    it('uses custom key prefix', async () => {
      const { ctx, store } = createCtxWithStore('trigger.id', 'evt_1');

      await step.execute(
        { keyPath: 'trigger.id', keyPrefix: 'custom:' },
        ctx,
      );

      expect(store.has('custom:evt_1')).toBe(true);
      expect(store.has('dedup:evt_1')).toBe(false);
    });
  });
});
