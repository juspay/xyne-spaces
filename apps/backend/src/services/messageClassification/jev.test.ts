jest.mock('@/config/env', () => ({
  config: {
    messageClassification: {
      model: 'open-fast',
      jev: { enabled: true, logEnabled: false, replace: true },
    },
    jev: { apiKey: 'test-key', url: 'https://jev.internal', model: 'jev-test' },
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

import { runJevBeforeLlm } from './jev';

/**
 * Replace mode must never write a partial classification. The write path reconciles every
 * message in the thread against the answer, so a type or a citation missing from it strips
 * a tag the model had applied. A batch with any unusable answer has to fail the whole
 * answer, which sends the thread to the LLM instead.
 *
 * fetch is mocked rather than askJev, so these pin the real client's all-or-nothing reply
 * handling as well as the classifier's own check behind it.
 */

const vocabulary = ['ISSUE', 'HOW_TO', 'QUESTION'].map(name => ({
  name,
  label: name,
  color: '#000000',
  summary: '',
  description: `${name} description`,
}));

const input = {
  root_is_bot: false,
  thread_messages: ['m1', 'm2', 'm3'].map(id => ({
    id,
    text: `text of ${id}`,
    author_display_name: 'A',
    timestamp_iso: '2026-09-29T00:00:00.000Z',
  })),
};

const meta = { conversationId: 'conv-1', workspaceId: 'ws-1' };

type JevBody = { questions: Record<string, { type: string }> };

/** Answers each request with `reply(questions)`, recording how many requests were made. */
const mockJev = (reply: (questions: JevBody['questions']) => Record<string, unknown>) => {
  const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
    const { questions } = JSON.parse(init.body) as JevBody;
    return new Response(JSON.stringify({ answers: reply(questions) }), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const isTypeBatch = (questions: JevBody['questions']) =>
  Object.values(questions).every(q => q.type === 'noul');

const choice = (picked: string, probabilities: Record<string, number>) => ({
  choice: picked,
  probabilities,
});

const validTypes = {
  ISSUE: { noul: 0.91 },
  HOW_TO: { noul: 0.78 },
  QUESTION: { noul: 0.2 },
};

const validEvidence = {
  ISSUE: choice('m1', { m1: 0.84, m2: 0.1, m3: 0.06 }),
  HOW_TO: choice('m3', { m3: 0.9, m1: 0.05, m2: 0.05 }),
};

describe('message classification Jev — replace mode', () => {
  it('returns the classification when every answer in both batches is usable', async () => {
    const fetchMock = mockJev(q => (isTypeBatch(q) ? validTypes : validEvidence));

    const jev = await runJevBeforeLlm(input, vocabulary, meta);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jev?.answer).toEqual({
      threadTypes: [
        { name: 'ISSUE', sourceMessageIds: ['m1'] },
        { name: 'HOW_TO', sourceMessageIds: ['m3'] },
      ],
    });
  });

  it('falls back to the LLM when one type answer in the type batch is unusable', async () => {
    // ISSUE, the strongest type, comes back malformed. A partial read would drop it and
    // write HOW_TO alone, removing ISSUE from the thread and from its evidence message.
    const fetchMock = mockJev(q =>
      isTypeBatch(q) ? { ...validTypes, ISSUE: { noul: 'high' } } : validEvidence,
    );

    const jev = await runJevBeforeLlm(input, vocabulary, meta);

    expect(jev?.answer).toBeNull();
    // Failed at the type batch: the evidence batch is never asked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the LLM when one type answer in the type batch is missing', async () => {
    const withoutQuestion = { ISSUE: validTypes.ISSUE, HOW_TO: validTypes.HOW_TO };
    mockJev(q => (isTypeBatch(q) ? withoutQuestion : validEvidence));

    expect((await runJevBeforeLlm(input, vocabulary, meta))?.answer).toBeNull();
  });

  it('falls back to the LLM when one answer in the evidence batch is unusable', async () => {
    // HOW_TO's evidence names a message that was never offered. A partial read would keep
    // HOW_TO with no citations and strip HOW_TO from m3.
    mockJev(q =>
      isTypeBatch(q)
        ? validTypes
        : { ...validEvidence, HOW_TO: choice('m9', { m9: 0.9 }) },
    );

    expect((await runJevBeforeLlm(input, vocabulary, meta))?.answer).toBeNull();
  });

  it('falls back to the LLM when one answer in the evidence batch is missing', async () => {
    mockJev(q => (isTypeBatch(q) ? validTypes : { ISSUE: validEvidence.ISSUE }));

    expect((await runJevBeforeLlm(input, vocabulary, meta))?.answer).toBeNull();
  });

  it('falls back to the LLM when an evidence answer has no probability for its choice', async () => {
    mockJev(q =>
      isTypeBatch(q) ? validTypes : { ...validEvidence, HOW_TO: choice('m3', {}) },
    );

    expect((await runJevBeforeLlm(input, vocabulary, meta))?.answer).toBeNull();
  });
});
