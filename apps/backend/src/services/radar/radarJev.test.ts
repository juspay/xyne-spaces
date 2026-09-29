jest.mock('@/config/env', () => ({
  config: {
    radar: { jev: { enabled: true, logEnabled: false, replace: true } },
    jev: { apiKey: 'test-key', url: 'https://jev.internal', model: 'jev-test' },
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import { runJevBeforeLlm } from './radarJev';
import type { ParserInput } from './radarParser';

/**
 * Replace mode on a reaction pass: Jev's answer is final unless it is unusable, in which
 * case the parser decides. An answer Jev could not fully give must reach the parser rather
 * than quietly resolve nothing. fetch is mocked rather than askJev, so the real client's
 * reply handling is covered too.
 */

const input: ParserInput = {
  open_items: [
    { id: 'it1', title: 'Share the deploy logs', context: null, requested_by: ['u_a'], pending_on: ['u_r'], source_message_id: 'm0' },
    { id: 'it2', title: 'Review PR 25', context: null, requested_by: ['u_a'], pending_on: ['u_p'], source_message_id: 'm9' },
  ],
  new_messages: [
    { id: 'm2', author: { id: 'u_a', name: 'Anita' }, text: 'here are the logs', mentions: [], timestamp_iso: '2026-09-29T00:00:00.000Z' },
  ],
  context_messages: [],
  known_users: { u_a: 'Anita', u_r: 'Ravi', u_p: 'Priya' },
  reaction: { by: 'Anita', emoji: 'white_check_mark' },
};

const mockJev = (answers: Record<string, unknown>) => {
  global.fetch = jest.fn(
    async () => new Response(JSON.stringify({ answers }), { status: 200 }),
  ) as unknown as typeof fetch;
};

describe('Radar Jev — replace mode, reaction pass', () => {
  it('resolves the item when both answers are usable and clear', async () => {
    mockJev({
      completion: { noul: 0.95 },
      settles: { choice: 'it1', probabilities: { it1: 0.9, it2: 0.05, none: 0.05 } },
    });

    const jev = await runJevBeforeLlm(input, 'conv-1');

    expect(jev?.answer).toEqual(
      expect.objectContaining({
        decidedBy: 'jev',
        operations: [expect.objectContaining({ op: 'resolve', itemId: 'it1', sourceMessageId: 'm2' })],
      }),
    );
  });

  it('falls back to the parser when one of the two answers is unusable', async () => {
    mockJev({
      completion: { noul: 0.95 },
      settles: { choice: 'it7', probabilities: { it7: 0.9 } },
    });

    expect((await runJevBeforeLlm(input, 'conv-1'))?.answer).toBeNull();
  });

  it('falls back to the parser when the chosen item has no probability', async () => {
    mockJev({ completion: { noul: 0.95 }, settles: { choice: 'it1', probabilities: {} } });

    expect((await runJevBeforeLlm(input, 'conv-1'))?.answer).toBeNull();
  });
});
