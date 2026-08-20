import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';

/**
 * Claw is reached through Spaces, not directly.
 *
 * These pin the property that makes that true: every Claw call goes to the same
 * origin, under `/api/sdk`, carrying the same API key as everything else. When
 * Claw had its own credential and its own base URL, forgetting either produced a
 * bare 404 that read like a missing route rather than a missing login.
 */

interface Captured {
  url: string;
  init: RequestInit;
}

let requests: Captured[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  requests = [];
});

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

/** Respond differently per call, for the polling loop. */
function stubSequence(bodies: unknown[]): void {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

const client = () =>
  createClient({ baseUrl: 'https://spaces.example.com', token: 'xyne_sk_test' });

describe('claw operations', () => {
  it('reaches Claw through the Spaces origin with the Spaces credential', async () => {
    stubFetch([{ id: 'a1', slug: 'ask-ai', name: 'Ask AI' }]);

    const agents = await client().claw.listAgents();

    expect(requests[0]?.url).toBe('https://spaces.example.com/api/sdk/claw/agents');
    expect((requests[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer xyne_sk_test'
    );
    expect(agents[0]?.slug).toBe('ask-ai');
  });

  it('returns an empty list rather than throwing when the payload is not a list', async () => {
    stubFetch({ unexpected: true });
    await expect(client().claw.listAgents()).resolves.toEqual([]);
  });

  it('dispatches a run and reports its session id', async () => {
    stubFetch({ sessionId: 'session-9' });

    const result = await client().claw.run({ agent: 'ask-ai', task: 'Summarise today' });

    expect(requests[0]?.url).toBe('https://spaces.example.com/api/sdk/claw/runs');
    expect(requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      agent: 'ask-ai',
      task: 'Summarise today',
    });
    expect(result.sessionId).toBe('session-9');
  });

  it('forwards the Spaces delivery target when given one', async () => {
    stubFetch({ sessionId: 's' });

    await client().claw.run({ agent: 'ask-ai', task: 'go', channelId: 'channel-1' });

    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      channelId: 'channel-1',
    });
  });

  it('escapes the session id when reading a run', async () => {
    stubFetch({ sessionId: 'a/b', status: 'completed' });

    await client().claw.getRun('a/b');

    expect(requests[0]?.url).toBe('https://spaces.example.com/api/sdk/claw/runs/a%2Fb');
  });

  it('polls until the run reaches a terminal status', async () => {
    stubSequence([
      { sessionId: 's1' },
      { sessionId: 's1', status: 'running' },
      { sessionId: 's1', status: 'completed', result: 'done' },
    ]);

    const run = await client().claw.runAndWait({ agent: 'ask-ai', task: 'go' });

    expect(run.status).toBe('completed');
    expect(run.result).toBe('done');
    // dispatch + two polls
    expect(requests).toHaveLength(3);
  });

  it('names the session id when it gives up waiting, so the run can still be read', async () => {
    stubSequence([{ sessionId: 's1' }, { sessionId: 's1', status: 'running' }]);

    await expect(
      client().claw.runAndWait({ agent: 'ask-ai', task: 'go', timeoutMs: 1_200 })
    ).rejects.toThrow(/s1/);
  });
});

describe('claw carries no credential of its own', () => {
  it('sends nothing when the client has no token', async () => {
    stubFetch([]);

    await createClient({ baseUrl: 'https://spaces.example.com' }).claw.listAgents();

    const headers = requests[0]?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('picks up the Spaces token set after construction', async () => {
    stubFetch([]);
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });
    sdk.setToken('xyne_sk_later');

    await sdk.claw.listAgents();

    expect((requests[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer xyne_sk_later'
    );
  });
});
