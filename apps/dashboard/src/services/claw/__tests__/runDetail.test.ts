import { describe, expect, it } from 'vitest';
import {
  RUN_SOURCE_LABEL,
  formatRunDuration,
  runElapsedMs,
  runModelLabel,
  runTimeSplit,
  runTraceHref,
} from '../runDetail';

describe('runDetail', () => {
  it('formats run durations like v3', () => {
    expect(formatRunDuration(null)).toBe('—');
    expect(formatRunDuration(undefined)).toBe('—');
    expect(formatRunDuration(850)).toBe('850ms');
    expect(formatRunDuration(12_400)).toBe('12s');
    expect(formatRunDuration(185_000)).toBe('3m 5s');
    expect(formatRunDuration(7_440_000)).toBe('2h 4m');
  });

  it('measures elapsed time to completion, or to now while running', () => {
    const startedAt = '2026-10-22T10:00:00.000Z';
    expect(runElapsedMs({ startedAt, completedAt: '2026-10-22T10:00:42.000Z' })).toBe(42_000);
    expect(runElapsedMs({ startedAt, completedAt: null }, Date.parse('2026-10-22T13:00:00Z'))).toBe(
      3 * 60 * 60 * 1000,
    );
    expect(runElapsedMs({ startedAt: 'not a date', completedAt: null })).toBeNull();
  });

  it('splits time between the LLM and tools', () => {
    expect(runTimeSplit({ llmTotalMs: 3000, toolMs: 1000 })).toEqual({
      llmMs: 3000,
      toolMs: 1000,
      llmShare: 0.75,
    });
    expect(runTimeSplit({ llmTotalMs: null, toolMs: 500 })?.llmShare).toBe(0);
    expect(runTimeSplit({ llmTotalMs: null, toolMs: null })).toBeNull();
  });

  it('labels the model with its provider', () => {
    expect(runModelLabel({ model: 'open-fast', provider: 'spaces' })).toBe('open-fast · spaces');
    expect(runModelLabel({ model: 'claude-opus-4-8', provider: null })).toBe('claude-opus-4-8');
    expect(runModelLabel({ model: null, provider: 'spaces' })).toBe('—');
  });

  it('links chat runs to their debug trace in the chat, and nothing else', () => {
    const run = {
      sessionId: 'run-1',
      agentSlug: 'pokemon-dex',
      conversationId: 'chat-abc',
      triggerSource: 'chat' as const,
    };
    expect(runTraceHref(run)).toBe('/ai/chat/chat-abc?debugRun=run-1&debugAgent=pokemon-dex');
    expect(runTraceHref({ ...run, triggerSource: 'scheduled' })).toBeNull();
    expect(runTraceHref({ ...run, conversationId: null })).toBeNull();
  });

  it('names every run source', () => {
    expect(Object.keys(RUN_SOURCE_LABEL).sort()).toEqual([
      'automation',
      'awakening',
      'delegated',
      'people',
      'scheduled',
      'workflow',
    ]);
  });
});
