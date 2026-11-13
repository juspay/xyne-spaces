import { describe, it, expect } from 'vitest';
import { DefaultManualTrigger } from './default-manual-trigger.js';

describe('DefaultManualTrigger', () => {
  const trigger = new DefaultManualTrigger();

  describe('resolveOutputJsonSchema', () => {
    it('returns a permissive object when inputSchema is absent', () => {
      const schema = trigger.resolveOutputJsonSchema({});
      expect(schema).toEqual({ type: 'object', additionalProperties: true });
    });

    it('returns a permissive object when inputSchema is empty', () => {
      const schema = trigger.resolveOutputJsonSchema({ inputSchema: {} });
      expect(schema).toEqual({ type: 'object', additionalProperties: true });
    });

    it('passes the author-supplied inputSchema through verbatim', () => {
      const inputSchema = {
        type: 'object',
        properties: {
          documentText: { type: 'string', description: 'Paste document content' },
          researchTopic: { type: 'string' },
        },
        required: ['documentText', 'researchTopic'],
      };
      const schema = trigger.resolveOutputJsonSchema({ inputSchema });
      expect(schema).toEqual(inputSchema);
    });
  });
});
