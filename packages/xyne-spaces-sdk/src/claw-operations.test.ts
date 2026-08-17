import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import type { ClawTokenStore } from './core/claw-auth.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const requests: CapturedRequest[] = [];

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
});

describe('claw operations', () => {
  it('calls the claw path prefix with the claw token', async () => {
    stubFetch({ success: true, data: [{ slug: 'ask-ai', name: 'Ask AI' }] });
    const sdk = createClient({
      baseUrl: 'https://spaces.example.com',
      token: 'spaces-token',
      clawToken: 'xyne_cli_abc',
    });

    await expect(sdk.claw.listAgents()).resolves.toEqual([{ slug: 'ask-ai', name: 'Ask AI' }]);

    const request = requests[0];
    expect(request?.url).toBe('https://spaces.example.com/claw/api/v1/agents');
    // The claw credential, never the Spaces one — they are not interchangeable.
    expect(request?.init.headers).toMatchObject({ Authorization: 'Bearer xyne_cli_abc' });
  });

  it('unwraps the success/data envelope for runs', async () => {
    stubFetch({ success: true, data: { status: 'completed', result: 'done' } });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawToken: 't' });

    const { run } = await sdk.claw.getRun('session-1');

    expect(run).toEqual({ sessionId: 'session-1', status: 'completed', result: 'done' });
    expect(requests[0]?.url).toBe('https://spaces.example.com/claw/api/v1/runs/session-1');
  });

  it('finds a list nested under a named key inside the envelope', async () => {
    stubFetch({ success: true, data: { runs: [{ sessionId: 's1', status: 'completed' }] } });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawToken: 't' });

    await expect(sdk.claw.listSessions(5)).resolves.toEqual([
      { sessionId: 's1', status: 'completed' },
    ]);
    expect(requests[0]?.url).toContain('limit=5');
  });

  it('clamps the session limit', async () => {
    stubFetch({ success: true, data: [] });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawToken: 't' });

    await sdk.claw.listSessions(9999);
    expect(requests[0]?.url).toContain('limit=100');
  });

  it('always sends a conversationId and reports it back', async () => {
    stubFetch({ success: true, data: { sessionId: 'session-9' } });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawToken: 't' });

    const { sessionId, conversationId } = await sdk.claw.runAgent({
      agent: 'ask-ai',
      task: 'summarise',
    });

    expect(sessionId).toBe('session-9');
    // Without a conversationId the run row is never written, so it cannot be optional.
    expect(conversationId).toMatch(/^sdk-[0-9a-f-]{36}$/);

    const body = JSON.parse(String(requests[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      agentSlug: 'ask-ai',
      task: 'summarise',
      triggerSource: 'api',
      conversationId,
    });
  });

  it('forwards the spaces delivery target when given one', async () => {
    stubFetch({ success: true, data: { sessionId: 's' } });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawToken: 't' });

    await sdk.claw.runAgent({ agent: 'a', task: 't', channelId: 'channel-1' });

    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      channelId: 'channel-1',
    });
  });
});

describe('claw auth is independent of spaces auth', () => {
  it('setToken does not grant claw access, and setClawToken does not grant spaces access', async () => {
    stubFetch({ success: true, data: [] });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });

    sdk.setToken('spaces-token');
    expect(sdk.hasToken()).toBe(true);
    expect(sdk.hasClawToken()).toBe(false);

    sdk.setClawToken('xyne_cli_x');
    expect(sdk.hasClawToken()).toBe(true);

    // Spaces token untouched by the claw setter.
    sdk.clearClawToken();
    expect(sdk.hasClawToken()).toBe(false);
    expect(sdk.hasToken()).toBe(true);
  });

  it('loads a stored claw token on first use without an explicit login', async () => {
    stubFetch({ success: true, data: [] });
    let cleared = false;
    const store: ClawTokenStore = {
      get: () => 'xyne_cli_stored',
      set: () => undefined,
      clear: () => {
        cleared = true;
      },
    };
    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawTokenStore: store });

    await sdk.claw.listAgents();
    expect(requests[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer xyne_cli_stored',
    });

    await sdk.claw.logout();
    expect(cleared).toBe(true);
    expect(sdk.hasClawToken()).toBe(false);
  });

  it('uses a separate claw base url when one is given', async () => {
    stubFetch({ success: true, data: [] });
    const sdk = createClient({
      baseUrl: 'https://spaces.example.com',
      clawBaseUrl: 'https://claw.example.com',
      clawToken: 't',
    });

    await sdk.claw.listAgents();
    expect(requests[0]?.url).toBe('https://claw.example.com/claw/api/v1/agents');
  });
});

describe('claw device-flow login', () => {
  it('prompts with the verification url, then adopts and persists the token', async () => {
    const saved: string[] = [];
    const store: ClawTokenStore = {
      get: () => undefined,
      set: (token) => {
        saved.push(token);
      },
      clear: () => undefined,
    };

    // start → pending → token
    stubSequence([
      { deviceCode: 'dev-1', userCode: 'WXYZ', verifyUrl: 'https://x/verify', interval: 0 },
      { error: 'authorization_pending' },
      { token: 'xyne_cli_new', email: 'me@example.com' },
    ]);

    const sdk = createClient({ baseUrl: 'https://spaces.example.com', clawTokenStore: store });

    const prompts: string[] = [];
    const result = await sdk.claw.login({
      onPrompt: ({ verifyUrl, userCode }) => {
        prompts.push(`${verifyUrl}|${userCode}`);
      },
    });

    expect(prompts).toEqual(['https://x/verify|WXYZ']);
    expect(result.token).toBe('xyne_cli_new');
    expect(result.email).toBe('me@example.com');
    expect(saved).toEqual(['xyne_cli_new']);
    expect(sdk.hasClawToken()).toBe(true);

    expect(requests[0]?.url).toBe('https://spaces.example.com/claw/api/v1/cli/auth/start');
    expect(requests[1]?.url).toBe('https://spaces.example.com/claw/api/v1/cli/auth/token');
  });

  it('fails clearly when the deployment has CLI tokens disabled', async () => {
    stubFetch({ success: true, data: {} });
    const sdk = createClient({ baseUrl: 'https://spaces.example.com' });

    await expect(sdk.claw.login()).rejects.toThrow(/malformed device-authorization/i);
  });
});

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return jsonResponse(body);
    })
  );
}

/** Respond with a different body per call, for multi-step flows. */
function stubSequence(bodies: unknown[]): void {
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return jsonResponse(body);
    })
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
