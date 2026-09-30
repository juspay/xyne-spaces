import type { JevQuestion } from '@/services/queryIntent/jevClient';

jest.mock('@/config/env', () => ({
  config: { litellm: { baseUrl: 'https://gateway.test/', apiKey: 'test-key' }, jev: {} },
}));
jest.mock('@/services/otel/assistantMetrics', () => ({
  getAssistantJevDuration: () => ({ record: jest.fn() }),
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

type Gateway = typeof import('./gateway');

const choice = (options: string[]): JevQuestion => ({
  type: 'choice',
  instructions: 'Pick one.',
  criteria: Object.fromEntries(options.map((option) => [option, option])),
});
const QUESTIONS = {
  action: choice(['send_dm', 'none']),
  'send_dm.recipient': choice(['p0', 'none']),
};
const picked = (option: string): unknown => ({ choice: option, probabilities: { [option]: 0.9 } });
const ANSWERS = { action: picked('send_dm'), 'send_dm.recipient': picked('p0') };

function answering(answers: Record<string, unknown>): Response {
  return { ok: true, json: async () => ({ answers }) } as Response;
}

function failing(status: number): Response {
  return { ok: false, status, body: { cancel: async () => undefined } } as unknown as Response;
}

/** A request that never answers, and fails the way `fetch` does once it is cancelled. */
function hanging(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
  });
}

const spyOnFetch = () => jest.spyOn(globalThis, 'fetch');

describe('asking Jev in time', () => {
  let gateway: Gateway;
  let fetch: ReturnType<typeof spyOnFetch>;
  const inTime = (): number => Date.now() + gateway.JEV_TURN_MS;

  beforeEach(async () => {
    // The breaker is kept per process, so every test starts with a fresh one.
    jest.resetModules();
    gateway = await import('./gateway');
    fetch = spyOnFetch();
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the first answer without asking again', async () => {
    fetch.mockResolvedValue(answering(ANSWERS));

    const answers = await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(answers?.action).toMatchObject({ choice: 'send_dm' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again after a short pause when the request fails', async () => {
    fetch.mockResolvedValueOnce(failing(503)).mockResolvedValueOnce(answering(ANSWERS));

    const answers = await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(answers?.action).toMatchObject({ choice: 'send_dm' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('waits out a busy gateway, pausing longer each time', async () => {
    fetch
      .mockResolvedValueOnce(failing(429))
      .mockResolvedValueOnce(failing(429))
      .mockResolvedValueOnce(answering(ANSWERS));
    const startedAt = Date.now();

    const answers = await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(answers?.action).toMatchObject({ choice: 'send_dm' });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(3 * gateway.JEV_RETRY_PAUSE_MS);
  });

  it('never stops asking because the gateway is busy', async () => {
    fetch.mockResolvedValue(failing(429));
    for (let turn = 0; turn < 3; turn += 1) {
      expect(await gateway.askJevInTime('request', QUESTIONS, Date.now() + 100)).toBeNull();
    }
    fetch.mockReset().mockResolvedValue(answering(ANSWERS));

    expect(await gateway.askJevInTime('request', QUESTIONS, inTime())).not.toBeNull();
  });

  it('asks again alongside a slow request, and cancels the slow one', async () => {
    fetch.mockImplementationOnce(hanging).mockResolvedValueOnce(answering(ANSWERS));
    const startedAt = Date.now();

    const answers = await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(answers?.action).toMatchObject({ choice: 'send_dm' });
    expect(Date.now() - startedAt).toBeLessThan(gateway.JEV_SECOND_ASK_MS + 1_000);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('does not ask once the turn is out of time', async () => {
    const answers = await gateway.askJevInTime('request', QUESTIONS, Date.now() - 1);

    expect(answers).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the answers it can read when a detail is unreadable', async () => {
    fetch.mockResolvedValue(answering({ action: picked('send_dm'), 'send_dm.recipient': {} }));

    const answers = await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(answers).toEqual({ action: expect.objectContaining({ choice: 'send_dm' }) });
  });

  it('has no answer, and does not ask again, when the action is unreadable', async () => {
    fetch.mockResolvedValue(answering({ action: {}, 'send_dm.recipient': picked('p0') }));

    expect(await gateway.askJevInTime('request', QUESTIONS, inTime())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops asking after three outages in a row', async () => {
    fetch.mockResolvedValue(failing(503));
    for (let turn = 0; turn < 3; turn += 1) {
      await gateway.askJevInTime('request', QUESTIONS, Date.now() + 100);
    }
    fetch.mockClear();

    expect(await gateway.askJevInTime('request', QUESTIONS, inTime())).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps asking when requests are unreadable rather than refused', async () => {
    fetch.mockResolvedValue(answering({}));
    for (let turn = 0; turn < 3; turn += 1) {
      await gateway.askJevInTime('request', QUESTIONS, inTime());
    }
    fetch.mockClear();

    await gateway.askJevInTime('request', QUESTIONS, inTime());

    expect(fetch).toHaveBeenCalled();
  });
});
